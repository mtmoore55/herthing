import { timingSafeEqual } from 'node:crypto'

const MAX_BODY_BYTES = 16 * 1024
const MAX_TEXT_LENGTH = 2000

function sameSecret(actual, expected) {
  const left = Buffer.from(actual || '')
  const right = Buffer.from(expected || '')
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right)
}

function bearerToken(request) {
  return request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1] || ''
}

export function validateConversationRequest(body) {
  if (!body || typeof body !== 'object') return 'JSON object required'
  if (typeof body.conversation_id !== 'string' || !body.conversation_id.trim() || body.conversation_id.length > 256) {
    return 'conversation_id must be a non-empty string of at most 256 characters'
  }
  if (body.type === 'end') return null
  if (body.type !== 'turn') return 'type must be turn or end'
  if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > MAX_TEXT_LENGTH) {
    return `text must be a non-empty string of at most ${MAX_TEXT_LENGTH} characters`
  }
  return null
}

export function createAlexaConversationHandler({ secret, resolveTurn, endConversation, timeoutMs = 6500, logger = console }) {
  return async function handleAlexaConversation(request) {
    const requestId = crypto.randomUUID()
    if (!secret) return Response.json({ error: 'Alexa gateway is not configured' }, { status: 503 })
    if (!sameSecret(bearerToken(request), secret)) {
      logger.warn(`[alexa:${requestId}] rejected unauthorized request`)
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (Number(request.headers.get('content-length') || 0) > MAX_BODY_BYTES) {
      return Response.json({ error: 'Request too large' }, { status: 413 })
    }

    let body
    try {
      const raw = await request.text()
      if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return Response.json({ error: 'Request too large' }, { status: 413 })
      body = JSON.parse(raw)
    } catch {
      return Response.json({ error: 'Valid JSON required' }, { status: 400 })
    }
    const validationError = validateConversationRequest(body)
    if (validationError) return Response.json({ error: validationError }, { status: 400 })

    if (body.type === 'end') {
      endConversation(body.conversation_id)
      logger.info(`[alexa:${requestId}] session ended`)
      return Response.json({ ok: true })
    }

    const startedAt = performance.now()
    logger.info(`[alexa:${requestId}] turn received`)
    let timeout
    try {
      const result = await Promise.race([
        resolveTurn(body.text.trim(), body.conversation_id, {
          locale: body.locale,
          device_id: body.device_id,
          user_id: body.user_id
        }),
        new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Ziggy response timed out')), timeoutMs) })
      ])
      if (!result?.text?.trim()) throw new Error('Ziggy returned no speech')
      logger.info(`[alexa:${requestId}] turn complete in ${Math.round(performance.now() - startedAt)} ms (${result.provider || 'unknown'})`)
      return Response.json({ speech: String(result.text || '').trim(), reprompt: 'What else?', should_end_session: false })
    } catch (error) {
      logger.error(`[alexa:${requestId}] turn failed after ${Math.round(performance.now() - startedAt)} ms: ${error.message || error}`)
      return Response.json({ error: 'Ziggy is unavailable right now' }, { status: 504 })
    } finally {
      clearTimeout(timeout)
    }
  }
}
