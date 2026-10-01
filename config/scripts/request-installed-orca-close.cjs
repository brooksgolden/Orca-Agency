const path = require('node:path')
const { chromium } = require(
  require.resolve('playwright', {
    paths: [
      process.cwd(),
      path.resolve(__dirname, '../..'),
      path.join(process.env.USERPROFILE || process.cwd(), 'dev/orca')
    ]
  })
)
const approvedCloseScript = `
(async () => {
  window.api.ui.requestClose();
  for (let attempt = 0; attempt < 225; attempt++) {
    if ([...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].some(d => d.innerText.includes('Unsaved Changes'))) throw new Error('Unsaved editor changes need saving before restart');
    const dialog = [...document.querySelectorAll('[role="dialog"]')].find(d => d.innerText.includes('Close Window?'));
    if (dialog) {
      const button = [...dialog.querySelectorAll('button')].find(b => b.textContent.trim() === 'Close');
      if (!button) throw new Error('Expected close confirmation button missing');
      setTimeout(() => button.click(), 50);
      return 'Confirmed authorized desktop restart';
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('Close confirmation did not appear within 45 seconds; installed files remain untouched');
})()`
function desktopExited() {
  const pid = Number(process.env.ORCA_DESKTOP_QUIT_PID)
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return false
  }
  try {
    process.kill(pid, 0)
    return false
  } catch (error) {
    return error.code === 'ESRCH'
  }
}
async function requestCloseThroughMainProcess() {
  const expectedPid = Number(process.env.ORCA_DESKTOP_QUIT_PID)
  if (!Number.isSafeInteger(expectedPid) || expectedPid <= 0) {
    throw new Error('Desktop PID required for main-process close fallback')
  }
  const targets = await (
    await fetch('http://127.0.0.1:9229/json/list', { signal: AbortSignal.timeout(3000) })
  ).json()
  const target = targets.find((t) => t.type === 'node')
  if (!target) {
    throw new Error('No local main-process inspector target')
  }
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  let id = 0
  async function evaluate(expression) {
    const requestId = ++id
    return await new Promise((resolve, reject) => {
      function cleanup() {
        clearTimeout(timer)
        socket.removeEventListener('message', onMessage)
        socket.removeEventListener('close', onClose)
      }
      function onClose() {
        cleanup()
        reject(new Error('Main-process inspector closed'))
      }
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error('Main-process inspector timeout'))
      }, 55000)
      function onMessage(event) {
        const message = JSON.parse(event.data)
        if (message.id !== requestId) {
          return
        }
        cleanup()
        if (message.error || message.result?.exceptionDetails) {
          reject(new Error(JSON.stringify(message.error || message.result.exceptionDetails)))
        } else {
          resolve(message.result.result.value)
        }
      }
      socket.addEventListener('message', onMessage)
      socket.addEventListener('close', onClose, { once: true })
      socket.send(
        JSON.stringify({
          id: requestId,
          method: 'Runtime.evaluate',
          params: { expression, returnByValue: true, awaitPromise: true }
        })
      )
    })
  }
  try {
    const identity = await evaluate(
      '({pid:process.pid,exe:process.execPath,hasRequire:typeof require})'
    )
    const expectedExe = path.join(process.env.LOCALAPPDATA, 'Programs', 'orca', 'Orca.exe')
    if (
      identity.pid !== expectedPid ||
      path.normalize(identity.exe).toLowerCase() !== path.normalize(expectedExe).toLowerCase()
    ) {
      throw new Error('Inspector is not the expected installed Orca desktop')
    }
    try {
      const confirmation = await evaluate(
        `(() => { const electron = process.mainModule.require('electron'); const window = electron.BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('index.html')); if (!window) throw new Error('Installed renderer missing'); return window.webContents.executeJavaScript(${JSON.stringify(approvedCloseScript)}); })()`
      )
      console.log(confirmation)
    } catch (error) {
      // No confirmation is shown when every terminal is idle; the renderer can disappear first.
      let rendererClosed = desktopExited()
      if (!rendererClosed && socket.readyState === WebSocket.OPEN) {
        rendererClosed = await evaluate(
          `!process.mainModule.require('electron').BrowserWindow.getAllWindows().some(w => w.webContents.getURL().includes('index.html'))`
        ).catch(() => desktopExited())
      }
      if (!rendererClosed) {
        throw error
      }
      console.log('Orca closed without requiring confirmation.')
    }
  } finally {
    socket.close()
  }
}
;(async () => {
  let browser
  try {
    browser = await chromium.connectOverCDP('http://127.0.0.1:19387', { timeout: 3000 })
  } catch (error) {
    if (!String(error.message).includes('ECONNREFUSED')) {
      throw error
    }
    await requestCloseThroughMainProcess()
    return
  }
  try {
    const page = browser
      .contexts()[0]
      .pages()
      .find((p) => p.url().includes('index.html'))
    if (!page) {
      throw new Error('No installed Orca renderer')
    }
    try {
      await page.evaluate(approvedCloseScript)
    } catch (error) {
      if (!page.isClosed() && !desktopExited()) {
        throw error
      }
    }
    console.log('Sent Orca window close request through its own IPC action.')
  } finally {
    await browser.close()
  }
})().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})
