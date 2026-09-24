const REQUEST_TIMEOUT_MS = Number(process.env.HERTHING_REQUEST_TIMEOUT_MS || 6500)

function plainText(text) {
  return { type: 'PlainText', text }
}

function response(text, { end = false, reprompt = 'What else?', attributes = {} } = {}) {
  const result = {
    version: '1.0',
    sessionAttributes: attributes,
    response: { outputSpeech: plainText(text), shouldEndSession: end }
  }
  if (!end && reprompt) result.response.reprompt = { outputSpeech: plainText(reprompt) }
  return result
}

function sessionAttributes(event) {
  return { ...(event.session?.attributes || {}), conversationId: event.session?.sessionId }
}

function applicationId(event) {
  return event.session?.application?.applicationId || event.context?.System?.application?.applicationId
}

function metadata(event) {
  return {
    locale: event.request?.locale,
    device_id: event.context?.System?.device?.deviceId,
    user_id: event.context?.System?.user?.userId
  }
}

async function herThing(body) {
  const endpoint = process.env.HERTHING_ENDPOINT
  const token = process.env.HERTHING_ALEXA_GATEWAY_TOKEN
  if (!endpoint || !token) throw new Error('HerThing endpoint is not configured')
  const upstream = await fetch(endpoint, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })
  if (!upstream.ok) throw new Error(`HerThing returned ${upstream.status}`)
  return upstream.json()
}

function queryValue(event) {
  return event.request?.intent?.slots?.query?.value?.trim()
}

function isEndIntent(name) {
  return ['AMAZON.StopIntent', 'AMAZON.CancelIntent', 'GoodbyeIntent', 'ThanksZiggyIntent'].includes(name)
}

export async function handler(event) {
  const expectedSkillId = process.env.ALEXA_SKILL_ID
  if (expectedSkillId && applicationId(event) !== expectedSkillId) throw new Error('Unexpected Alexa skill ID')

  const requestType = event.request?.type
  const attributes = sessionAttributes(event)
  const conversationId = attributes.conversationId

  if (requestType === 'LaunchRequest') {
    return response("Hey Matt. What's up?", { attributes })
  }
  if (requestType === 'SessionEndedRequest') {
    await herThing({ type: 'end', conversation_id: conversationId }).catch(() => {})
    return { version: '1.0', response: {} }
  }
  if (requestType !== 'IntentRequest') return response("I couldn't understand that request.", { end: true })

  const intent = event.request.intent?.name
  if (isEndIntent(intent)) {
    await herThing({ type: 'end', conversation_id: conversationId }).catch(() => {})
    return response('Anytime. Talk to you later.', { end: true, attributes })
  }
  if (intent === 'AMAZON.HelpIntent') {
    return response('Ask me anything, or say goodbye when you are done.', { attributes })
  }
  if (intent === 'AMAZON.FallbackIntent') {
    return response("I didn't catch that. Try saying, ask Ziggy followed by your question.", { attributes })
  }

  const text = queryValue(event)
  if (!text) return response('What would you like to ask?', { attributes })
  try {
    const result = await herThing({ type: 'turn', conversation_id: conversationId, text, ...metadata(event) })
    return response(result.speech, {
      end: Boolean(result.should_end_session),
      reprompt: result.reprompt || 'What else?',
      attributes
    })
  } catch (error) {
    console.error(`[ziggy] request failed: ${error.message || error}`)
    return response("Sorry, I couldn't reach Ziggy in time. Please try again.", { end: true, attributes })
  }
}

export { queryValue, response }
