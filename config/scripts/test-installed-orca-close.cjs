const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const source = fs.readFileSync(
  require('node:path').join(__dirname, 'request-installed-orca-close.cjs'),
  'utf8'
)
const script = source.match(/const approvedCloseScript = `([\s\S]*?)`/)[1]

async function simulate({ appearsAt = 0, unsaved = false, missingButton = false }) {
  let polls = 0
  let requested = 0
  let clicked = 0
  const scheduled = []
  const button = { textContent: 'Close', click: () => clicked++ }
  const dialog = {
    innerText: 'Close Window?',
    querySelectorAll: () => (missingButton ? [] : [button])
  }
  const context = {
    window: { api: { ui: { requestClose: () => requested++ } } },
    document: {
      querySelectorAll: () =>
        unsaved ? [{ innerText: 'Unsaved Changes' }, dialog] : polls >= appearsAt ? [dialog] : []
    },
    setTimeout: (callback, delay) => {
      if (delay === 50) {
        scheduled.push(callback)
      } else {
        polls++
        callback()
      }
    }
  }
  let error
  try {
    await vm.runInNewContext(script, context)
  } catch (caught) {
    error = caught
  }
  assert.equal(clicked, 0, 'Confirmation must return before closing the app')
  scheduled.forEach((callback) => callback())
  return { requested, clicked, polls, error }
}

;(async () => {
  assert.equal((await simulate({})).clicked, 1)
  assert.equal((await simulate({ appearsAt: 60 })).clicked, 1, 'Slow confirmation is still handled')
  const dirty = await simulate({ unsaved: true })
  assert.match(dirty.error.message, /Unsaved editor/)
  assert.equal(dirty.clicked, 0)
  const timeout = await simulate({ appearsAt: Infinity })
  assert.match(timeout.error.message, /did not appear/)
  assert.equal(timeout.clicked, 0)
  assert.match((await simulate({ missingButton: true })).error.message, /button missing/)
  const probe = source.slice(
    source.indexOf('function desktopExited()'),
    source.indexOf('async function requestCloseThroughMainProcess')
  )
  for (const [code, expected] of [
    ['ESRCH', true],
    ['EPERM', false],
    [null, false]
  ]) {
    const exited = vm.runInNewContext(`${probe}\ndesktopExited()`, {
      process: {
        env: { ORCA_DESKTOP_QUIT_PID: '123' },
        kill: (pid, signal) => {
          assert.equal(pid, 123)
          assert.equal(signal, 0)
          if (code) {
            throw Object.assign(new Error(code), { code })
          }
        }
      }
    })
    assert.equal(exited, expected)
  }
  const connectionPolicy = source.slice(
    source.indexOf('function canUseMainProcessClose'),
    source.indexOf(';(async () => {')
  )
  for (const [message, expected] of [
    ['connect ECONNREFUSED 127.0.0.1:19387', true],
    ['browserType.connectOverCDP: Timeout 3000ms exceeded.', true],
    ['No installed Orca renderer', false],
    ['Inspector is not the expected installed Orca desktop', false]
  ]) {
    assert.equal(
      vm.runInNewContext(`${connectionPolicy}\ncanUseMainProcessClose(error)`, {
        error: { message }
      }),
      expected
    )
  }
  console.log('12 close-confirmation, process-exit and connection-policy checks passed')
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
