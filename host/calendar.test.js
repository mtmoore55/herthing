import { describe, expect, test } from 'bun:test'
import { calendarConfig, fetchCalendarState, fetchNextEvent, findEventsBetween, findNextEvent } from './calendar.js'

const calendar = `BEGIN:VCALENDAR\r
VERSION:2.0\r
BEGIN:VEVENT\r
UID:later\r
DTSTART:20260919T180000Z\r
SUMMARY:Design Review\r
LOCATION:Shed\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:sooner\r
DTSTART:20260919T170000Z\r
SUMMARY:Call Andy\r
END:VEVENT\r
END:VCALENDAR\r
`

describe('calendar adapter', () => {
  test('requires an explicitly configured feed', () => {
    expect(calendarConfig({})).toBeNull()
    expect(calendarConfig({ HERTHING_CALENDAR_ICS_URL: ' https://example.test/me.ics ' }))
      .toEqual({ url: 'https://example.test/me.ics' })
  })

  test('selects and normalizes the next future event', () => {
    expect(findNextEvent(calendar, new Date('2026-09-19T16:00:00Z'))).toEqual({
      title: 'Call Andy',
      starts_at: '2026-09-19T17:00:00.000Z',
      location: null,
      all_day: false
    })
  })

  test('expands recurring events', () => {
    const recurring = `BEGIN:VCALENDAR\r
VERSION:2.0\r
BEGIN:VEVENT\r
UID:standup\r
DTSTART:20260918T170000Z\r
RRULE:FREQ=DAILY;COUNT=4\r
SUMMARY:Standup\r
END:VEVENT\r
END:VCALENDAR\r
`
    expect(findNextEvent(recurring, new Date('2026-09-19T18:00:00Z'))?.starts_at)
      .toBe('2026-09-20T17:00:00.000Z')
  })

  test('fetches a read-only ICS feed', async () => {
    const fakeFetch = async () => new Response(calendar)
    const event = await fetchNextEvent(
      { url: 'https://example.test/me.ics' },
      new Date('2026-09-19T16:00:00Z'),
      fakeFetch
    )
    expect(event?.title).toBe('Call Andy')
  })

  test('returns an ordered agenda within a day', () => {
    const events = findEventsBetween(calendar, new Date('2026-09-19T16:00:00Z'), new Date('2026-09-20T00:00:00Z'))
    expect(events.map((event) => event.title)).toEqual(['Call Andy', 'Design Review'])
  })

  test('fetches the next event and today agenda together', async () => {
    const result = await fetchCalendarState(
      { url: 'https://example.test/me.ics' },
      new Date('2026-09-19T16:00:00Z'),
      async () => new Response(calendar)
    )
    expect(result.next_event?.title).toBe('Call Andy')
    expect(result.today_events).toHaveLength(2)
  })

  test('leaves the display empty when the next event is not today', async () => {
    const result = await fetchCalendarState(
      { url: 'https://example.test/me.ics' },
      new Date('2026-09-19T23:00:00Z'),
      async () => new Response(calendar)
    )
    expect(result.next_event).toBeNull()
    expect(result.today_events).toEqual([])
  })
})
