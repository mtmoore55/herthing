import ICAL from 'ical.js'

export function calendarConfig(env = process.env) {
  const url = env.HERTHING_CALENDAR_ICS_URL?.trim()
  return url ? { url } : null
}

function occurrences(event, now, horizon) {
  if (!event.isRecurring()) return [event.startDate.toJSDate()]
  const iterator = event.iterator(event.startDate)
  const starts = []
  let next
  let inspected = 0
  while ((next = iterator.next())) {
    if (++inspected > 10000) break
    const date = next.toJSDate()
    if (date > horizon || starts.length >= 2) break
    if (date < now) continue
    starts.push(date)
  }
  return starts
}

export function findNextEvent(ics, now = new Date()) {
  const root = new ICAL.Component(ICAL.parse(ics))
  const horizon = new Date(now.getTime() + 366 * 24 * 60 * 60 * 1000)
  let next = null

  for (const component of root.getAllSubcomponents('vevent')) {
    const event = new ICAL.Event(component)
    if (!event.summary || component.getFirstPropertyValue('status') === 'CANCELLED') continue
    for (const startsAt of occurrences(event, now, horizon)) {
      if (startsAt < now || startsAt > horizon) continue
      if (!next || startsAt < next.startsAt) {
        next = {
          title: event.summary,
          startsAt,
          location: event.location || null,
          allDay: event.startDate.isDate
        }
      }
    }
  }

  if (!next) return null
  return {
    title: next.title,
    starts_at: next.startsAt.toISOString(),
    location: next.location,
    all_day: next.allDay
  }
}

export async function fetchNextEvent(config, now = new Date(), fetchImpl = fetch) {
  const response = await fetchImpl(config.url, {
    headers: { accept: 'text/calendar, text/plain;q=0.9' },
    redirect: 'follow'
  })
  if (!response.ok) throw new Error(`calendar feed returned HTTP ${response.status}`)
  return findNextEvent(await response.text(), now)
}
