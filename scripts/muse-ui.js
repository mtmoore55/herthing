const debugUrl = process.env.HERTHING_MUSE_BROWSER_DEBUG_URL || 'http://127.0.0.1:9333'
const [action, ...valueParts] = process.argv.slice(2)
const value = valueParts.join(' ')

if (!action || !value) throw new Error('usage: bun scripts/muse-ui.js <click-text|click-aria|click-row|row-options> <value>')

const targets = await (await fetch(`${debugUrl}/json`)).json()
const target = targets.find((entry) => entry.type === 'page' && entry.url.startsWith('https://muse.ai'))
if (!target) throw new Error('Muse page not found')

const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.onopen = resolve
  socket.onerror = reject
})

const wanted = JSON.stringify(value.toLowerCase())
const expression = `
(() => {
  const visible = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
  };
  const controls = [...document.querySelectorAll('button, a, [role="button"]')].filter(visible);
  const wanted = ${wanted};
  if (${JSON.stringify(action)} === 'click-row' || ${JSON.stringify(action)} === 'row-options') {
    const row = [...document.querySelectorAll('[data-testid="hatch-thread-row"]')]
      .find((entry) => (entry.innerText || '').replace(/\\s+/g, ' ').trim().toLowerCase().includes(wanted));
    if (!row) return { ok: false, reason: 'row not found' };
    if (${JSON.stringify(action)} === 'click-row') {
      row.click();
      return { ok: true, text: (row.innerText || '').replace(/\\s+/g, ' ').trim() };
    }
    const options = row.querySelector('button') || [...row.querySelectorAll('[role="button"]')].find((entry) => entry !== row);
    if (!options) return { ok: false, reason: 'row options not found' };
    options.click();
    return { ok: true, aria: options.getAttribute('aria-label') };
  }
  const element = controls.find((entry) => {
    const candidate = ${JSON.stringify(action)} === 'click-aria'
      ? (entry.getAttribute('aria-label') || '')
      : (entry.innerText || entry.textContent || '');
    return candidate.replace(/\\s+/g, ' ').trim().toLowerCase().includes(wanted);
  });
  if (!element) return { ok: false };
  element.click();
  return { ok: true, text: (element.innerText || '').replace(/\\s+/g, ' ').trim(), aria: element.getAttribute('aria-label') };
})()
`

const result = await new Promise((resolve, reject) => {
  const id = 1
  socket.onmessage = (event) => {
    const message = JSON.parse(String(event.data))
    if (message.id !== id) return
    if (message.error) reject(new Error(message.error.message))
    else resolve(message.result?.result?.value)
  }
  socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }))
})

console.log(JSON.stringify(result))
socket.close()
