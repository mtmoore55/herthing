const debugUrl = process.env.HERTHING_MUSE_BROWSER_DEBUG_URL || 'http://127.0.0.1:9333'
const needle = process.argv.slice(2).join(' ')

if (!needle) throw new Error('usage: bun scripts/inspect-muse-dom.js <exact visible text>')

const targets = await (await fetch(`${debugUrl}/json`)).json()
const target = targets.find((entry) => entry.type === 'page' && entry.url.startsWith('https://muse.ai'))
if (!target) throw new Error('Muse page not found')

const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.onopen = resolve
  socket.onerror = reject
})

const expression = `
JSON.stringify([...document.querySelectorAll('*')]
  .filter((element) => (element.innerText || '').trim() === ${JSON.stringify(needle)})
  .slice(-8)
  .map((element) => ({
    tag: element.tagName,
    class: String(element.className || ''),
    role: element.getAttribute('role'),
    testid: element.getAttribute('data-testid'),
    parent: {
      tag: element.parentElement?.tagName,
      class: String(element.parentElement?.className || ''),
      role: element.parentElement?.getAttribute('role'),
      testid: element.parentElement?.getAttribute('data-testid')
    }
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
  socket.send(JSON.stringify({
    id,
    method: 'Runtime.evaluate',
    params: { expression, returnByValue: true }
  }))
})

console.log(JSON.stringify(JSON.parse(result || '[]'), null, 2))
socket.close()
