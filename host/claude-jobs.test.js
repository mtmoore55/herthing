import { describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { ClaudeJobs, matchClaudeIntent, parseClaudeResult } from './claude-jobs.js'

describe('matchClaudeIntent', () => {
  test('routes requests addressed to Claude or to the computer', () => {
    expect(matchClaudeIntent('Can you ask Claude to look into why the shed speaker is missing?'))
      .toEqual({ kind: 'task', task: 'look into why the shed speaker is missing?' })
    expect(matchClaudeIntent('Have clawed check my disk space.')).toEqual({ kind: 'task', task: 'check my disk space.' })
    expect(matchClaudeIntent("Can you have the computer show why, or look into why the shed speaker's not showing up?")?.kind).toBe('task')
    expect(matchClaudeIntent('Figure out why Bluetooth is flaky on this computer.')?.kind).toBe('task')
  })

  test('recognises follow-ups and status questions', () => {
    expect(matchClaudeIntent('Tell Claude to go ahead and fix it.')).toEqual({ kind: 'followup', task: 'go ahead and fix it.' })
    expect(matchClaudeIntent('What did Claude find?')).toEqual({ kind: 'status', task: null })
    expect(matchClaudeIntent('Is Claude done yet?')).toEqual({ kind: 'status', task: null })
  })

  test('leaves ordinary requests to the assistant', () => {
    expect(matchClaudeIntent("What's on the schedule for today?")).toBeNull()
    expect(matchClaudeIntent('Can you play some music in here?')).toBeNull()
    expect(matchClaudeIntent('Check the weather.')).toBeNull()
  })
})

test('parses the spoken summary from a Claude result', () => {
  const stdout = JSON.stringify({
    type: 'result', subtype: 'success', is_error: false, session_id: 'abc',
    result: 'Librespot is not installed.\n\nSPOKEN: The shed speaker is missing because Librespot isn\'t installed.'
  })
  expect(parseClaudeResult(stdout)).toMatchObject({
    ok: true, session_id: 'abc', spoken: "The shed speaker is missing because Librespot isn't installed."
  })
})

test('runs one job at a time and continues the last session on follow-up', async () => {
  const calls = []
  const spawn = (args) => {
    calls.push(args)
    const body = JSON.stringify({ result: 'Done.\nSPOKEN: All set.', session_id: 'session-1', is_error: false })
    return { stdout: new Response(body).body, stderr: new Response('').body, exited: Promise.resolve(0) }
  }
  const finished = []
  const jobs = new ClaudeJobs({
    binary: 'claude', cwd: '/tmp', directory: mkdtempSync(`${tmpdir()}/claude-jobs-`),
    permissionMode: 'auto', timeoutMinutes: 5, followupWindowMs: 60000
  }, { spawn, onFinished: (job) => finished.push(job) })

  const first = jobs.start('check disk space')
  expect(() => jobs.start('another')).toThrow('already running')
  expect(jobs.statusText()).toContain('still working')
  await first.done
  expect(finished[0]).toMatchObject({ ok: true, spoken: 'All set.', session_id: 'session-1' })
  expect(calls[0]).toContain('systemd-run')
  expect(calls[0]).not.toContain('--resume')

  await jobs.start('go ahead', { followup: true }).done
  expect(calls[1].slice(-2)).toEqual(['--resume', 'session-1'])
  expect(jobs.statusText()).toBe('All set.')
})
