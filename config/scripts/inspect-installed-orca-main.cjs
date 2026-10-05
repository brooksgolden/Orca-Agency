const fs = require('node:fs')
;(async () => {
  const targets = await (
    await fetch('http://127.0.0.1:9229/json/list', { signal: AbortSignal.timeout(5000) })
  ).json()
  const ws = new WebSocket(targets.find((t) => t.type === 'node').webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.close()
      reject(new Error('Inspector connection timeout'))
    }, 5000)
    ws.onopen = () => {
      clearTimeout(timer)
      resolve()
    }
    ws.onerror = (error) => {
      clearTimeout(timer)
      ws.close()
      reject(error)
    }
  })
  const expression =
    process.argv[2] === '--file'
      ? fs.readFileSync(process.argv[3], 'utf8')
      : process.argv[2] ||
        "({pid:process.pid,exe:process.execPath,userData:process.mainModule.require('electron').app.getPath('userData'),version:process.mainModule.require('electron').app.getVersion(),windows:process.mainModule.require('electron').BrowserWindow.getAllWindows().map(w=>({id:w.id,url:w.webContents.getURL(),visible:w.isVisible(),destroyed:w.isDestroyed()}))})"
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.close()
      reject(new Error('Inspector timeout'))
    }, 10000)
    ws.onerror = (error) => {
      clearTimeout(timer)
      ws.close()
      reject(error)
    }
    ws.onmessage = (e) => {
      const r = JSON.parse(e.data)
      if (r.id === 1) {
        clearTimeout(timer)
        resolve(r)
      }
    }
    ws.send(
      JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true, awaitPromise: true }
      })
    )
  })
  ws.close()
  if (result.error || result.result?.exceptionDetails) {
    throw new Error(JSON.stringify(result.error || result.result.exceptionDetails))
  }
  console.log(JSON.stringify(result))
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
