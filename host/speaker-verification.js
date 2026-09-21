import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const root = `${import.meta.dir}/..`
const runtime = process.env.HERTHING_SPEAKER_RUNTIME || `${root}/.artifacts/bin/herthing-speaker-embedding`
const model = process.env.HERTHING_SPEAKER_MODEL || `${root}/.artifacts/models/wespeaker_en_voxceleb_resnet34.onnx`
const profilePath = process.env.HERTHING_SPEAKER_PROFILE || `${process.env.HOME}/.config/herthing/speaker-profile.json`

export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return null
  let dot = 0, left = 0, right = 0
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i]
    left += a[i] * a[i]
    right += b[i] * b[i]
  }
  return left && right ? dot / Math.sqrt(left * right) : null
}

export function averageEmbeddings(embeddings) {
  if (!embeddings.length) return null
  return embeddings[0].map((_, i) => embeddings.reduce((sum, item) => sum + item[i], 0) / embeddings.length)
}

export async function extractSpeakerEmbedding(pcm) {
  if (!existsSync(runtime) || !existsSync(model)) return null
  const child = Bun.spawn([runtime, model], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' })
  child.stdin.write(pcm)
  child.stdin.end()
  const [code, output, error] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  if (code !== 0) throw new Error(error.trim() || `speaker embedding exited ${code}`)
  return JSON.parse(output)
}

export async function readSpeakerProfile() {
  try { return JSON.parse(await readFile(profilePath, 'utf8')) } catch { return null }
}

export async function addEnrollmentSample(embedding, name = 'owner') {
  const current = await readSpeakerProfile()
  const samples = [...(current?.pipeline_version === 3 ? current.samples || [] : []), embedding].slice(-5)
  const profile = { version: 1, pipeline_version: 3, name, samples, embedding: averageEmbeddings(samples), updated_at: new Date().toISOString() }
  await mkdir(dirname(profilePath), { recursive: true, mode: 0o700 })
  const temporary = `${profilePath}.tmp`
  await writeFile(temporary, `${JSON.stringify(profile)}\n`, { mode: 0o600 })
  await rename(temporary, profilePath)
  return { name, samples: samples.length }
}

export async function verifySpeaker(pcm, threshold = Number(process.env.HERTHING_SPEAKER_THRESHOLD || 0.55)) {
  const profile = await readSpeakerProfile()
  if (!profile?.embedding || profile.pipeline_version !== 3 || profile.samples?.length < 3) return { enabled: false, match: true, score: null }
  const embedding = await extractSpeakerEmbedding(pcm)
  const score = cosineSimilarity(profile.embedding, embedding)
  return { enabled: true, match: score != null && score >= threshold, score, threshold, name: profile.name }
}
