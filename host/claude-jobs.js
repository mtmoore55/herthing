import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'

// Voice requests that hand work on this computer to Claude Code. Whisper
// often hears "Claude" as a near-homophone, so those are accepted too.
const claudeName = '(?:claude|claud|clawed|clod)'
const fillerPrefix = /^(?:(?:hey|ok|okay|so|and|ziggy|can you|could you|would you|please|i want you to|i need you to|go ahead and)[\s,]+)*/i

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

// Returns { kind: 'task' | 'followup' | 'status', task } or null.
export function matchClaudeIntent(value) {
  const text = clean(value)
  const lower = text.toLowerCase()
  if (new RegExp(`\\b(?:what did|what has|what's|whats|is|has)\\s+${claudeName}\\b.*\\b(?:find|found|doing|done|finished|working|up to|status)\\b`, 'i').test(lower) ||
      new RegExp(`\\b${claudeName}(?:'s)?\\s+status\\b`, 'i').test(lower)) {
    return { kind: 'status', task: null }
  }
  const request = text.replace(fillerPrefix, '')
  const tell = request.match(new RegExp(`^(?:tell|let)\\s+${claudeName}\\s+(?:to\\s+|that\\s+)?(.+)$`, 'i'))
  if (tell) return { kind: 'followup', task: clean(tell[1]) }
  const ask = request.match(new RegExp(`^(?:ask|have|get|use)\\s+${claudeName}\\s+(?:to\\s+)?(.+)$`, 'i')) ||
    request.match(new RegExp(`^${claudeName}[,:]?\\s+(.+)$`, 'i'))
  if (ask) return { kind: 'task', task: clean(ask[1]) }
  // "have the computer look into why …" names the machine rather than Claude.
  if (/\b(?:have|get|ask)\s+(?:the|this|my)\s+computer\b/i.test(request) ||
      /\b(?:look into|investigate|figure out|debug|troubleshoot|check|fix)\b.*\b(?:on|in)\s+(?:this|the|my)\s+computer\b/i.test(request)) {
    return { kind: 'task', task: text }
  }
  return null
}

// The job runs unattended; the spoken summary is parsed from its last line.
export const voiceJobInstructions = [
  'This task was started by a voice request relayed by HerThing, the voice assistant ("Ziggy") running on this computer (Omarchy / Arch Linux).',
  'The user is not watching this session and cannot answer questions, so investigate on your own and do not ask for input.',
  'Make fixes only when they are local, safe and easy to reverse. For anything destructive, outward-facing, needing sudo, or otherwise risky, stop and describe what you would do instead.',
  'Finish with a concise written report of what you found and did.',
  'The very last line must be `SPOKEN: ` followed by one or two short plain-English sentences to be read aloud: no markdown, paths, code or URLs.'
].join('\n')

export function parseClaudeResult(stdout) {
  let record = null
  for (const line of String(stdout).trim().split('\n').reverse()) {
    if (!line.trim().startsWith('{')) continue
    try {
      record = JSON.parse(line)
      break
    } catch {
      // Diagnostics may precede the final JSON object.
    }
  }
  if (!record) return { ok: false, report: clean(stdout).slice(0, 2000), spoken: null, session_id: null }
  const report = String(record.result || '').trim()
  const spokenLine = report.split('\n').reverse().find((line) => /^\s*SPOKEN:/i.test(line))
  const spoken = spokenLine
    ? clean(spokenLine.replace(/^\s*SPOKEN:\s*/i, '').replace(/[`*_#]/g, ''))
    : clean(report.replace(/[`*_#>]/g, '')).split(/(?<=[.!?])\s/).slice(0, 2).join(' ')
  return {
    ok: !record.is_error && record.subtype !== 'error',
    report,
    spoken: spoken || null,
    session_id: record.session_id || null,
    cost_usd: record.total_cost_usd ?? null,
    duration_ms: record.duration_ms ?? null
  }
}

export function claudeJobsConfig(env = process.env) {
  const home = env.HOME || '/home'
  return {
    enabled: env.HERTHING_CLAUDE_ENABLED !== '0',
    binary: env.HERTHING_CLAUDE_BINARY || `${home}/.local/share/mise/installs/claude/latest/claude`,
    cwd: env.HERTHING_CLAUDE_CWD || home,
    directory: env.HERTHING_CLAUDE_JOBS_DIR || `${home}/.local/share/herthing/claude-jobs`,
    permissionMode: env.HERTHING_CLAUDE_PERMISSION_MODE || 'auto',
    timeoutMinutes: Number(env.HERTHING_CLAUDE_TIMEOUT_MINUTES || 20),
    // Follow-ups within this window continue the previous job's session.
    followupWindowMs: Number(env.HERTHING_CLAUDE_FOLLOWUP_MINUTES || 60) * 60 * 1000
  }
}

// Runs one Claude Code job at a time. Each job is a transient systemd user
// unit, not a child of the host: the host service is sandboxed read-only
// over $HOME, which would leave Claude unable to work.
export class ClaudeJobs {
  constructor(config = claudeJobsConfig(), { spawn = Bun.spawn, onFinished = () => {} } = {}) {
    this.config = config
    this.spawn = spawn
    this.onFinished = onFinished
    this.active = null
    this.last = this.loadLast()
  }

  loadLast() {
    try {
      const latest = readdirSync(this.config.directory).filter((name) => name.endsWith('.json')).sort().at(-1)
      return latest ? JSON.parse(readFileSync(`${this.config.directory}/${latest}`, 'utf8')) : null
    } catch {
      return null
    }
  }

  canContinue() {
    return Boolean(this.last?.session_id && Date.now() - Date.parse(this.last.finished_at) < this.config.followupWindowMs)
  }

  start(task, { followup = false } = {}) {
    if (this.active) throw new Error('A Claude job is already running')
    const resume = followup && this.canContinue() ? this.last.session_id : null
    const startedAt = new Date()
    const id = `${startedAt.toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID().slice(0, 6)}`
    const args = [
      'systemd-run', '--user', '--quiet', '--collect', '--pipe',
      `--unit=herthing-claude-${id.slice(-6)}`,
      `--working-directory=${this.config.cwd}`,
      `--property=RuntimeMaxSec=${Math.round(this.config.timeoutMinutes * 60)}`,
      '--description=HerThing voice task for Claude Code',
      this.config.binary, '-p', task,
      '--output-format', 'json',
      '--permission-mode', this.config.permissionMode,
      '--append-system-prompt', voiceJobInstructions
    ]
    if (resume) args.push('--resume', resume)
    const job = { id, task, followup: Boolean(resume), resumed_session: resume, started_at: startedAt.toISOString() }
    const child = this.spawn(args, { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
    this.active = job
    job.done = (async () => {
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited
      ])
      const result = parseClaudeResult(stdout)
      const finished = {
        ...job,
        done: undefined,
        finished_at: new Date().toISOString(),
        exit_code: exitCode,
        ok: exitCode === 0 && result.ok,
        spoken: result.spoken || (exitCode === 0 ? null : 'Claude stopped before it could finish.'),
        session_id: result.session_id || resume,
        cost_usd: result.cost_usd,
        report_file: `${this.config.directory}/${id}.md`,
        error: exitCode === 0 ? null : clean(stderr).slice(0, 500) || `exit ${exitCode}`
      }
      this.save(finished, result.report)
      this.active = null
      this.last = finished
      await this.onFinished(finished)
      return finished
    })()
    return job
  }

  save(job, report) {
    try {
      mkdirSync(this.config.directory, { recursive: true })
      writeFileSync(`${this.config.directory}/${job.id}.json`, JSON.stringify(job, null, 2))
      writeFileSync(job.report_file, [
        `# ${job.task}`, '',
        `Started ${job.started_at}; finished ${job.finished_at}${job.ok ? '' : ` (failed: ${job.error || 'see report'})`}.`,
        job.session_id ? `Continue in a terminal: \`claude --resume ${job.session_id}\`` : '', '',
        report || '(no report)'
      ].join('\n'))
    } catch (error) {
      console.error('[claude] could not save job record:', error.message || error)
    }
  }

  statusText(now = Date.now()) {
    if (this.active) {
      const minutes = Math.max(1, Math.round((now - Date.parse(this.active.started_at)) / 60000))
      return `Claude is still working on it; ${minutes} minute${minutes === 1 ? '' : 's'} so far.`
    }
    if (!this.last) return "Claude hasn't worked on anything yet."
    return this.last.spoken || (this.last.ok ? 'Claude finished, but left no summary.' : 'Claude stopped before it could finish.')
  }
}
