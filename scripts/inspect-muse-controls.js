const debugUrl = process.env.HERTHING_MUSE_BROWSER_DEBUG_URL || 'http://127.0.0.1:9333'
const targets = await (await fetch(`${debugUrl}/json`)).json()
const target = targets.find((entry) => entry.type === 'page' && entry.url.startsWith('https://muse.ai'))
if (!target) throw new Error('Muse page not found')

const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.onopen = resolve
  socket.onerror = reject
})

const expression = `
JSON.stringify([...document.querySelectorAll('button, a, [role="button"]')]
  .filter((element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
  })
  .map((element) => ({
    tag: element.tagName,
    text: (element.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 100),
    aria: element.getAttribute('aria-label'),
    title: element.getAttribute('title'),
    href: element.getAttribute('href')
  })))
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

console.log(JSON.stringify(JSON.parse(result || '[]'), null, 2))
socket.close()
