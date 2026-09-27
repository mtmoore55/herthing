const defaultDebugUrl = 'http://127.0.0.1:9333'

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function visibleText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

// The chat renders the submitted message with its own whitespace and may
// clip or reflow its start; the final words are the most distinctive part.
export function submissionNeedle(text) {
  return visibleText(text).slice(-48)
}

export function museBrowserConfig() {
  return {
    debugUrl: process.env.HERTHING_MUSE_BROWSER_DEBUG_URL || defaultDebugUrl,
    chatUrl: process.env.HERTHING_MUSE_BROWSER_CHAT_URL || null,
    timeoutMs: Number(process.env.HERTHING_MUSE_BROWSER_TIMEOUT_MS || 90000),
    settleMs: Number(process.env.HERTHING_MUSE_BROWSER_SETTLE_MS || 450),
    stallMs: Number(process.env.HERTHING_MUSE_BROWSER_STALL_MS || 2500)
  }
}

export function chooseMuseTarget(targets, chatUrl = null) {
  if (chatUrl) {
    return targets.find((target) => target.type === 'page' && target.url === chatUrl)
  }
  return targets.find((target) => target.type === 'page' && /^https:\/\/(?:www\.)?muse\.ai(?:\/|$)/.test(target.url))
}

export async function museBrowserHealth(config = museBrowserConfig()) {
  try {
    const response = await fetch(`${config.debugUrl}/json`, { signal: AbortSignal.timeout(3000) })
    if (!response.ok) return { ok: false, reason: `debugger returned ${response.status}` }
    const target = chooseMuseTarget(await response.json(), config.chatUrl)
    return target
      ? { ok: true, title: target.title || null, url: target.url }
      : { ok: false, reason: 'Muse page not found' }
  } catch (error) {
    return { ok: false, reason: error.message || String(error) }
  }
}

class CdpSession {
  constructor(url) {
    this.url = url
    this.nextId = 1
    this.pending = new Map()
    this.socket = null
  }

  async connect() {
    if (this.socket?.readyState === WebSocket.OPEN) return
    await new Promise((resolve, reject) => {
      const socket = new WebSocket(this.url)
      const timer = setTimeout(() => reject(new Error('Timed out connecting to Muse browser')), 5000)
      socket.onopen = () => {
        clearTimeout(timer)
        this.socket = socket
        resolve()
      }
      socket.onerror = () => {
        clearTimeout(timer)
        reject(new Error('Could not connect to Muse browser'))
      }
      socket.onmessage = (event) => {
        const message = JSON.parse(String(event.data))
        if (!message.id || !this.pending.has(message.id)) return
        const { resolve: finish, reject: fail } = this.pending.get(message.id)
        this.pending.delete(message.id)
        if (message.error) fail(new Error(message.error.message))
        else finish(message.result || {})
      }
      socket.onclose = () => {
        for (const { reject: fail } of this.pending.values()) fail(new Error('Muse browser disconnected'))
        this.pending.clear()
      }
    })
  }

  send(method, params = {}) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Muse page evaluation failed')
    return result.result?.value
  }

  close() {
    this.socket?.close()
  }
}

const pageHelpers = String.raw`
(() => {
  const visible = (element) => {
    if (!element) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
  };
  const composer = () => [...document.querySelectorAll('textarea, [contenteditable="true"]')].find(visible);
  const text = (element) => (element?.innerText || element?.textContent || '').replace(/\s+/g, ' ').trim();
  const userMessages = () => [...document.querySelectorAll('[data-message-author-role="user"], [class*="group/msg"][class*="items-end"]')]
    .filter(visible);
  const assistantMessages = () => [...document.querySelectorAll('[data-message-author-role="assistant"], [data-testid*="assistant"], [class*="group/msg"][class*="justify-start"]')]
    .filter(visible);
  const follows = (element, anchor) => Boolean(anchor.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING);
  // Prefer the rendered markdown body: it excludes reaction/copy controls and
  // any tool-status chrome, and exposes whether the reply is still streaming.
  const replyText = (element) => {
    const bodies = [...element.querySelectorAll('[data-hatch-markdown-streaming]')];
    return bodies.length ? bodies.map(text).filter(Boolean).join(' ') : text(element);
  };
  const streaming = (element) => Boolean(element.querySelector('[data-hatch-markdown-streaming="true"]'));
  window.__herthingMuse = {
    composer,
    // needle is the tail of the text HerThing just submitted. Only assistant
    // bubbles after the user bubble containing it count as the reply, so a
    // lazily loaded or re-rendered history can never be mistaken for one.
    snapshot(needle = '') {
      const input = composer();
      const composerEmpty = input ? !(input.value ?? input.textContent ?? '').trim() : false;
      const users = userMessages();
      const anchor = needle ? [...users].reverse().find((element) => text(element).includes(needle)) : null;
      const replies = anchor ? assistantMessages().filter((element) => follows(element, anchor)) : [];
      return {
        ready: Boolean(input),
        composerEmpty,
        user_count: users.length,
        anchored: Boolean(anchor),
        reply: replies.map(replyText).filter(Boolean).join(' '),
        streaming: replies.some(streaming)
      };
    },
    focusComposer() {
      const element = composer();
      if (!element) return false;
      element.focus();
      if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')?.set;
        setter?.call(element, '');
      } else {
        element.textContent = '';
      }
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
      return true;
    }
  };
  return window.__herthingMuse.snapshot();
})()
`

export class MuseBrowserClient {
  constructor(config = museBrowserConfig(), createSession = (url) => new CdpSession(url)) {
    this.config = config
    this.createSession = createSession
  }

  async targets() {
    const response = await fetch(`${this.config.debugUrl}/json`, { signal: AbortSignal.timeout(3000) })
    if (!response.ok) throw new Error(`Muse browser debugger returned ${response.status}`)
    return response.json()
  }

  async ask(text, { onSubmitted, onPartial } = {}) {
    let submitted = false
    let cdp = null
    try {
      const target = chooseMuseTarget(await this.targets(), this.config.chatUrl)
      if (!target?.webSocketDebuggerUrl) {
        throw new Error('Dedicated Muse browser is not open. Start it with scripts/start-muse-browser.sh')
      }
      cdp = this.createSession(target.webSocketDebuggerUrl)
      await cdp.connect()
      await cdp.send('Runtime.enable')
      const before = await cdp.evaluate(pageHelpers)
      if (!before?.ready) throw new Error('Muse is not signed in or its message composer is unavailable')
      const focused = await cdp.evaluate('window.__herthingMuse.focusComposer()')
      if (!focused) throw new Error('Could not focus the Muse message composer')
      await cdp.send('Input.insertText', { text })
      // Once Enter is attempted, retrying via another provider could duplicate the request.
      submitted = true
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
      let notified = false

      const needle = submissionNeedle(text)
      const deadline = Date.now() + this.config.timeoutMs
      let last = ''
      let stableSince = 0
      while (Date.now() < deadline) {
        await sleep(150)
        const current = await cdp.evaluate(`window.__herthingMuse.snapshot(${JSON.stringify(needle)})`)
        const candidate = visibleText(current?.reply)
        // Composer clearing is the page accepting submission, not a delivery/read receipt.
        if (!notified && (current?.composerEmpty || current?.anchored)) {
          notified = true
          try { await onSubmitted?.() } catch (error) {
            console.error('[earcon] submission cue failed:', error.message || error)
          }
        }
        if (!current?.anchored || !candidate) continue
        if (candidate !== last) {
          last = candidate
          stableSince = Date.now()
          try { onPartial?.(candidate, { streaming: Boolean(current.streaming) }) } catch (error) {
            console.error('[assistant:muse-browser] partial handler failed:', error.message || error)
          }
          continue
        }
        const stableMs = Date.now() - stableSince
        if (!current.streaming && stableMs >= this.config.settleMs) return candidate
        // The page can leave a finished reply flagged as streaming. Text that
        // has not changed for this long is treated as complete regardless.
        if (stableMs >= this.config.stallMs) {
          console.warn(`[assistant:muse-browser] reply still flagged as streaming after ${stableMs} ms unchanged; treating as complete`)
          return candidate
        }
      }
      if (last) {
        console.warn('[assistant:muse-browser] timed out before the reply settled; using the text received so far')
        return last
      }
      throw new Error('Timed out waiting for Muse to finish responding')
    } catch (error) {
      if (!submitted) error.code = 'MUSE_BROWSER_UNAVAILABLE'
      throw error
    } finally {
      cdp?.close()
    }
  }
}

export async function askMuseBrowser(text, options) {
  return new MuseBrowserClient().ask(text, options)
}
