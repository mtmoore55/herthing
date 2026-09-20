const defaultDebugUrl = 'http://127.0.0.1:9333'

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function visibleText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

export function museBrowserConfig() {
  return {
    debugUrl: process.env.HERTHING_MUSE_BROWSER_DEBUG_URL || defaultDebugUrl,
    chatUrl: process.env.HERTHING_MUSE_BROWSER_CHAT_URL || null,
    timeoutMs: Number(process.env.HERTHING_MUSE_BROWSER_TIMEOUT_MS || 90000),
    settleMs: Number(process.env.HERTHING_MUSE_BROWSER_SETTLE_MS || 450)
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
  const candidates = () => [...document.querySelectorAll('[data-message-author-role="assistant"], [data-testid*="assistant"], [class*="group/msg"][class*="justify-start"]')]
    .filter(visible)
    .map((element) => ({ element, text: text(element) }))
    .filter((entry) => entry.text);
  window.__herthingMuse = {
    composer,
    snapshot() {
      const entries = candidates();
      return { ready: Boolean(composer()), count: entries.length, texts: entries.map((entry) => entry.text) };
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
  constructor(config = museBrowserConfig()) {
    this.config = config
  }

  async targets() {
    const response = await fetch(`${this.config.debugUrl}/json`, { signal: AbortSignal.timeout(3000) })
    if (!response.ok) throw new Error(`Muse browser debugger returned ${response.status}`)
    return response.json()
  }

  async ask(text) {
    let submitted = false
    let cdp = null
    try {
      const target = chooseMuseTarget(await this.targets(), this.config.chatUrl)
      if (!target?.webSocketDebuggerUrl) {
        throw new Error('Dedicated Muse browser is not open. Start it with scripts/start-muse-browser.sh')
      }
      cdp = new CdpSession(target.webSocketDebuggerUrl)
      await cdp.connect()
      await cdp.send('Runtime.enable')
      const before = await cdp.evaluate(pageHelpers)
      if (!before?.ready) throw new Error('Muse is not signed in or its message composer is unavailable')
      const focused = await cdp.evaluate('window.__herthingMuse.focusComposer()')
      if (!focused) throw new Error('Could not focus the Muse message composer')
      await cdp.send('Input.insertText', { text })
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
      submitted = true

      const deadline = Date.now() + this.config.timeoutMs
      let last = before.texts?.at(-1) || ''
      let stableSince = 0
      while (Date.now() < deadline) {
        await sleep(150)
        const current = await cdp.evaluate('window.__herthingMuse.snapshot()')
        const candidate = visibleText(current?.texts?.at(-1))
        const changed = current?.count > before.count || (candidate && candidate !== before.texts?.at(-1))
        if (!changed || !candidate) continue
        if (candidate !== last) {
          last = candidate
          stableSince = Date.now()
          continue
        }
        if (stableSince && Date.now() - stableSince >= this.config.settleMs) return candidate
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

export async function askMuseBrowser(text) {
  return new MuseBrowserClient().ask(text)
}
