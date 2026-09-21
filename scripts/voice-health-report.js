#!/usr/bin/env bun

const since = process.argv[2] || '24 hours ago'
const child = Bun.spawn(['journalctl', '--user', '-u', 'herthing-host.service', '--since', since, '--no-pager', '-o', 'cat'], { stdout: 'pipe', stderr: 'pipe' })
const [output, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
if (code !== 0) throw new Error(error.trim() || `journalctl exited ${code}`)

const lines = output.split('\n')
const count = (pattern) => lines.filter((line) => pattern.test(line)).length
const scores = lines.flatMap((line) => {
  const match = line.match(/\[speaker\] (accepted|ignored) .* score=([\d.-]+)/)
  return match ? [{ decision: match[1], score: Number(match[2]) }] : []
})
const average = (items) => items.length ? items.reduce((sum, value) => sum + value, 0) / items.length : null
const report = {
  window: since,
  wake_detections: count(/\[wake:kws\]/),
  wake_fallback_candidates: count(/\[wake:fallback\] local speech candidate/),
  wake_fallback_rejections: count(/\[wake:fallback\] rejected locally/),
  wake_turn_caps: count(/\[vad\] wake turn capped/),
  empty_conversation_cycles: count(/\[conversation\] no speech/),
  spotify_rate_limits: count(/Spotify .* returned 429/),
  speaker_accepted: scores.filter((item) => item.decision === 'accepted').length,
  speaker_ignored: scores.filter((item) => item.decision === 'ignored').length,
  accepted_score_average: average(scores.filter((item) => item.decision === 'accepted').map((item) => item.score)),
  ignored_score_average: average(scores.filter((item) => item.decision === 'ignored').map((item) => item.score))
}

console.log(JSON.stringify(report, null, 2))
