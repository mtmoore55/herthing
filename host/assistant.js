import { readFileSync } from 'node:fs'

const museBinary = process.env.HERTHING_MUSE_BINARY || 'muse'
const museModel = process.env.HERTHING_MUSE_MODEL || 'muse-spark-1.3'
const metaBaseUrl = process.env.HERTHING_META_BASE_URL || 'https://api.meta.ai/v1'
let previousMetaResponseId = null

export function resetAssistantConversation() {
  previousMetaResponseId = null
}

function minutesUntil(event) {
  const start = event?.start || event?.start_time || event?.starts_at
  if (!start) return null
  return Math.round((new Date(start).getTime() - Date.now()) / 60000)
}

function localResponse(text, context) {
  const normalized = text.toLowerCase()
  if (/weather|temperature|outside/.test(normalized) && context.weather) {
    const temperature = Math.round(context.weather.temperature ?? context.weather.temperature_f)
    const condition = context.weather.condition || context.weather.summary || 'current conditions'
    return `It's ${temperature} degrees and ${condition.toLowerCase()}.`
  }
  if (/next (meeting|event)|calendar|what.*next/.test(normalized)) {
    if (!context.next_event) return "You don't have another event on the calendar."
    const minutes = minutesUntil(context.next_event)
    const title = context.next_event.title || context.next_event.summary || 'Your next event'
    if (minutes === null) return `${title} is next.`
    if (minutes <= 0) return `${title} is happening now.`
    if (minutes > 180) {
      const start = new Date(context.next_event.starts_at || context.next_event.start)
      const when = new Intl.DateTimeFormat('en-US', { weekday: 'long', hour: 'numeric', minute: '2-digit' }).format(start)
      return `${title} is next, on ${when}.`
    }
    return `${title} starts in ${minutes} minute${minutes === 1 ? '' : 's'}.`
  }
  if (/what.*(song|playing)|who.*playing/.test(normalized) && context.now_playing) {
    return `${context.now_playing.track || context.now_playing.title} by ${context.now_playing.artist}.`
  }
  if (/what time|current time/.test(normalized)) {
    return `It's ${new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date())}.`
  }
  return `I heard you say, ${text}. Muse is ready to connect once its CLI is signed in.`
}

function musePrompt(text, context) {
  const visible = {
    weather: context.weather,
    next_event: context.next_event,
    now_playing: context.now_playing
  }
  return [
    'You are the assistant behind HerThing, an ambient voice appliance.',
    'Reply conversationally in one or two short spoken sentences. Do not use markdown.',
    `Current device context: ${JSON.stringify(visible)}`,
    `User: ${text}`
  ].join('\n')
}

function parseMuseJsonl(output) {
  let final = ''
  let streamed = ''
  for (const line of output.split('\n')) {
    if (!line.trim().startsWith('{')) continue
    try {
      const record = JSON.parse(line)
      if (record.payload_type === 'run.output.delta') streamed += record.payload?.text || ''
      if (record.payload_type === 'run.terminal.completed') final = record.payload?.text || final
    } catch {
      // Ignore non-protocol diagnostics written alongside JSONL.
    }
  }
  return (final || streamed).trim()
}

function metaApiKey() {
  if (process.env.MODEL_API_KEY) return process.env.MODEL_API_KEY
  const authPath = process.env.HERTHING_MUSE_AUTH_FILE || `${process.env.HOME}/.config/muse/auth.json`
  return JSON.parse(readFileSync(authPath, 'utf8'))?.providers?.meta?.api_key
}

function parseMetaResponse(response) {
  if (response.output_text) return String(response.output_text).trim()
  return (response.output || [])
    .flatMap((item) => item.content || [])
    .filter((item) => item.type === 'output_text' || item.type === 'text')
    .map((item) => item.text || '')
    .join('')
    .trim()
}

async function metaResponse(text, context) {
  const key = metaApiKey()
  if (!key) throw new Error('Meta Model API key is not configured')
  const body = {
    model: museModel,
    instructions: 'You are HerThing, an ambient personal assistant. Reply naturally in one or two short spoken sentences. Never use markdown.',
    input: musePrompt(text, context),
    reasoning: { effort: process.env.HERTHING_META_REASONING_EFFORT || 'minimal' },
    // Muse may spend roughly 100 hidden reasoning tokens even on a very short
    // spoken answer. Leave enough room that reasoning cannot consume the
    // entire response budget before output_text is emitted.
    max_output_tokens: 800
  }
  if (previousMetaResponseId) body.previous_response_id = previousMetaResponseId
  const response = await fetch(`${metaBaseUrl}/responses`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45000)
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result?.error?.message || `Meta Model API returned ${response.status}`)
  const output = parseMetaResponse(result)
  if (!output) throw new Error('Meta Model API returned no assistant text')
  previousMetaResponseId = result.id || previousMetaResponseId
  return output
}

async function museResponse(text, context) {
  const child = Bun.spawn([
    museBinary, 'exec', '--model', museModel, '--reasoning-effort', 'low',
    '--json', '--trust-workspace', '--disable-shell', '--disable-write',
    '--disable-web-tools', '--approval-mode', 'never', '--no-session-log', '--max-model-steps', '1',
    musePrompt(text, context)
  ], { stdout: 'pipe', stderr: 'pipe', cwd: process.env.HERTHING_PROJECT_ROOT || `${import.meta.dir}/..` })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited
  ])
  if (exitCode !== 0) throw new Error(stderr.trim() || `Muse exited ${exitCode}`)
  const response = parseMuseJsonl(stdout)
  if (!response) throw new Error('Muse returned no assistant text')
  return response
}

export function assistantConfig() {
  return { provider: process.env.HERTHING_ASSISTANT_PROVIDER || 'local' }
}

export async function askAssistant(text, context = {}) {
  const { provider } = assistantConfig()
  const started = performance.now()
  const response = provider === 'meta'
    ? await metaResponse(text, context)
    : provider === 'muse' ? await museResponse(text, context) : localResponse(text, context)
  return { text: response, provider, elapsed_ms: Math.round(performance.now() - started) }
}

export { localResponse, parseMetaResponse, parseMuseJsonl }
