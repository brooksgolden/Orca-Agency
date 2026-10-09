const { createHash } = require('node:crypto')
const { readFileSync, renameSync, rmSync, writeFileSync } = require('node:fs')
const { join, resolve } = require('node:path')

/**
 * Release the ConPTY teardown handles a relay's npm-installed node-pty never releases.
 *
 * Two files, and the ORDER of one of the edits is the whole fix.
 *
 * `windowsPtyAgent.js` -- `kill()` flips `readable` on both sockets and destroys neither.
 * `_cleanUpProcess` destroys `_outSocket`, so the conout handle comes back; nothing ever destroys
 * `_inSocket`, and it wraps a real Windows named-pipe handle from `fs.openSync(term.conin, 'w')`.
 * Every terminal leaks one File handle for the life of the host process.
 *
 * Releasing it before `_getConsoleProcessList()` forks was measurably worse than leaving the leak
 * alone: teardown aborted partway, the forked helper was not reaped, and both pipes stayed alive.
 * This asset and the desktop patch now release it after the fork and native kill.
 *
 * Measured on a Windows SSH host, 20 spawn/kill cycles, handles bucketed by NT object type
 * (identical numbers standalone and through a real relay). Every row is the NON-DLL branch, which
 * is the branch a relay runs and current Windows ARM64 desktop panes can now run:
 *
 *   published node-pty        File +1/terminal,  Process flat
 *   previous desktop patch    File +2/terminal,  Process +1/terminal
 *   released last             File flat,         Process flat
 *
 * `windowsTerminal.js` carries the desktop's error-listener hunks verbatim. The conin listener is
 * what keeps a pipe error retiring one terminal instead of the host -- its own comment names the
 * failure mode: "Without a listener, Node promotes errors such as write EAGAIN to uncaughtException".
 * It is not what fixes the leak (adding it changed nothing on its own), but it is the guard that
 * makes destroying conin safe at all.
 *
 * Why this ships as a relay asset rather than only in config/patches/node-pty@1.1.0.patch: pnpm
 * patches do not cross the SSH boundary -- a relay host runs the tree `npm install` put there.
 *
 * Both desktop and relay can take the non-DLL branch. The relay omits `useConptyDll` and the
 * desktop selects system ConPTY for supported Windows ARM64 builds. Both must preserve the late
 * conin release. The numbers above came from relay-style spawn/kill cycles; verify the desktop
 * build independently before attributing that exact leak rate to it.
 *
 * If you extend this enumeration, grep for `node-pty` rather than for a static import: those two
 * probes were missed three times because they use `await import('node-pty')`.
 *
 * THE SELF-EXIT LEAK: FIXED FOR THE DESKTOP BY #18635, STILL LIVE ON A RELAY. A terminal that exits
 * on its own is also torn down through `kill()` -- both hosts call `destroy()` on natural exit and
 * `WindowsTerminal.destroy()` is `kill()` -- but the shell is already gone by then, so the ordering
 * this asset relies on does not hold. Measured over 20 self-exit cycles on the NON-DLL branch:
 * published +3 File/+1 Process per terminal, previous desktop placement +2/+1, this tree +2/+1.
 * This relay asset alone does not close it.
 *
 * #18635 does, in `config/patches/node-pty@1.1.0.patch`: the baton outlives the shell so `PtyKill`
 * still reaches `ClosePseudoConsole`, plus an unconditional conout dispose on the DLL branch. That
 * fix does not reach a Windows relay, and no hunk in THIS file can carry it, because it is mostly
 * NATIVE (`src/win/conpty.cc`) and this asset only rewrites `lib/*.js`. Three delivery paths exist
 * and none currently covers Windows:
 *
 *   - the pnpm patch does not cross the SSH boundary -- the remote `npm install` yields upstream's
 *     unpatched node-pty;
 *   - the orcad prebuild matrix has no win32 entry (`MATRIX_SLOTS`,
 *     `config/scripts/build-orcad-prebuilds.mjs`), so no Windows binary is ever compiled from
 *     patched source to ship;
 *   - a relay asset CAN patch native source and rebuild on the host -- that is exactly what
 *     `node-pty-1.1.0-master-cloexec-patch.cjs` does -- but it returns
 *     `skipped:unsupported-platform` for anything but linux/darwin. Extending it to win32 means
 *     requiring an MSVC toolchain on the relay host, a far heavier precondition than on Linux,
 *     where node-gyp already runs at install time.
 *
 * So a Windows SSH relay still leaks a pseudoconsole per self-exiting terminal, and closing it is a
 * DELIVERY problem, not another hunk here. Do not read #18635's flat self-exit relay numbers as
 * covering deployed relays: they were measured against a locally rebuilt binary, so they describe
 * the relay CODE PATH on a patched tree, not the tree a relay host actually installs.
 */

const EXPECTED_NODE_PTY_VERSION = '1.1.0'

const CONSOLE_LIST_BEFORE =
  "    WindowsPtyAgent.prototype._getConsoleProcessList = function () {\n        var _this = this;\n        return new Promise(function (resolve) {\n            var agent = child_process_1.fork(path.join(__dirname, 'conpty_console_list_agent'), [_this._innerPid.toString()]);\n            agent.on('message', function (message) {\n                clearTimeout(timeout);\n                resolve(message.consoleProcessList);\n            });\n            var timeout = setTimeout(function () {\n                // Something went wrong, just send back the shell PID\n                agent.kill();\n                resolve([_this._innerPid]);\n            }, 5000);\n        });\n    };\n"
const CONSOLE_LIST_AFTER =
  "    WindowsPtyAgent.prototype._getConsoleProcessList = function () {\n        var _this = this;\n        return new Promise(function (resolve) {\n            var fallback = [_this._innerPid];\n            var agent;\n            try {\n                agent = child_process_1.fork(path.join(__dirname, 'conpty_console_list_agent'), [_this._innerPid.toString()]);\n            }\n            catch (_a) {\n                resolve(fallback);\n                return;\n            }\n            var settled = false;\n            var finish = function (list) {\n                if (settled) {\n                    return;\n                }\n                settled = true;\n                clearTimeout(timeout);\n                resolve(list);\n            };\n            agent.on('message', function (message) {\n                finish(message && Array.isArray(message.consoleProcessList) ? message.consoleProcessList : fallback);\n            });\n            // A failed helper must not crash the daemon or abort ConPTY teardown.\n            agent.on('error', function () { finish(fallback); });\n            var timeout = setTimeout(function () {\n                // Something went wrong, just send back the shell PID\n                try {\n                    agent.kill();\n                }\n                catch (_a) {\n                    // The helper may already have exited.\n                }\n                finish(fallback);\n            }, 5000);\n        });\n    };\n"

/** Each entry is one published file, its patched form, and the edits between them. */
const PATCH_TARGETS = [
  {
    relativePath: ['lib', 'windowsPtyAgent.js'],
    originalSha256: '8636d16b38266112204061a22b135734177c242837982fd3a4055be726efa64a',
    patchedSha256: '7c3d43d2f08f58e4012555f7e50aaf972422a166045782005f82d75445e65f80',
    replacements: [
      [
        '                this._ptyNative.kill(this._pty, this._useConptyDll);\n                this._conoutSocketWorker.dispose();\n',
        '                this._ptyNative.kill(this._pty, this._useConptyDll);\n                this._conoutSocketWorker.dispose();\n                // Orca: released AFTER the console-list fork and the native kill, not before them.\n                // Destroying conin first aborts teardown partway -- measured on a Windows SSH relay\n                // as +2 File and +1 Process handles per terminal, against +1 File unpatched.\n                this._inSocket.destroy();\n'
      ],
      [CONSOLE_LIST_BEFORE, CONSOLE_LIST_AFTER]
    ]
  },
  {
    relativePath: ['lib', 'windowsTerminal.js'],
    originalSha256: 'c3a65716f53fed0135a8a633373d5f9c2ab092544d651f27ef0a67096dd3bcd9',
    patchedSha256: '8247ecd69be8b18257050fb026b290024612c5ffc6d492ff1d46f81e613be2cf',
    replacements: [
      [
        '        _this._agent = new windowsPtyAgent_1.WindowsPtyAgent(file, args, parsedEnv, cwd, _this._cols, _this._rows, false, opt.useConpty, opt.useConptyDll, opt.conptyInheritCursor);\n        _this._socket = _this._agent.outSocket;\n        // Not available until `ready` event emitted.\n        _this._pid = _this._agent.innerPid;',
        "        _this._agent = new windowsPtyAgent_1.WindowsPtyAgent(file, args, parsedEnv, cwd, _this._cols, _this._rows, false, opt.useConpty, opt.useConptyDll, opt.conptyInheritCursor);\n        _this._socket = _this._agent.outSocket;\n        // Attach before readiness so a broken ConPTY output pipe cannot be unhandled.\n        _this._socket.on('error', function (err) {\n            var code = err && err.code;\n            // PTY output can report EPIPE before `_close()` wins the race.\n            _this._close();\n            if (code === 'EPIPE' || code === 'ERR_STREAM_PUSH_AFTER_EOF' || code === 'ERR_STREAM_DESTROYED') {\n                return;\n            }\n            // EIO, happens when someone closes our child process: the only process\n            // in the terminal.\n            // node < 0.6.14: errno 5\n            // node >= 0.6.14: read EIO\n            if (typeof code === 'string') {\n                if (~code.indexOf('errno 5') || ~code.indexOf('EIO'))\n                    return;\n            }\n            // Throw anything else.\n            if (_this.listeners('error').length < 2) {\n                throw err;\n            }\n        });\n        // Not available until `ready` event emitted.\n        _this._pid = _this._agent.innerPid;"
      ],
      [
        "                }\n            });\n            // Shutdown if `error` event is emitted.\n            _this._socket.on('error', function (err) {\n                // Close terminal session.\n                _this._close();\n                // EIO, happens when someone closes our child process: the only process\n                // in the terminal.\n                // node < 0.6.14: errno 5\n                // node >= 0.6.14: read EIO\n                if (err.code) {\n                    if (~err.code.indexOf('errno 5') || ~err.code.indexOf('EIO'))\n                        return;\n                }\n                // Throw anything else.\n                if (_this.listeners('error').length < 2) {\n                    throw err;\n                }\n            });\n            // Cleanup after the socket is closed.\n            _this._socket.on('close', function () {",
        "                }\n            });\n            // Cleanup after the socket is closed.\n            _this._socket.on('close', function () {"
      ],
      [
        '        _this._readable = true;\n        _this._writable = true;\n        _this._forwardEvents();\n        return _this;',
        "        _this._readable = true;\n        _this._writable = true;\n        // A ConPTY input-pipe error must retire only this terminal. Without a listener, Node promotes\n        // errors such as write EAGAIN to uncaughtException and kills every PTY in the daemon.\n        _this._agent.inSocket.on('error', function () {\n            if (!_this._writable) {\n                return;\n            }\n            _this._close();\n            try {\n                _this._agent.kill();\n            }\n            catch (_a) {\n                // The failing pipe may have raced process exit; the terminal is already unwritable.\n            }\n        });\n        _this._forwardEvents();\n        return _this;"
      ],
      [
        'exports.WindowsTerminal = WindowsTerminal;\n//# sourceMappingURL=windowsTerminal.js.map',
        'exports.WindowsTerminal = WindowsTerminal;\n//# sourceMappingURL=windowsTerminal.js.map\n'
      ]
    ]
  }
]

function inspectTarget(relayDir, target) {
  const nodePtyDir = resolve(relayDir, 'node_modules', 'node-pty')
  const packageJson = JSON.parse(readFileSync(join(nodePtyDir, 'package.json'), 'utf8'))
  if (packageJson.version !== EXPECTED_NODE_PTY_VERSION) {
    throw new Error(
      `Refusing to patch node-pty ${packageJson.version}; expected ${EXPECTED_NODE_PTY_VERSION}`
    )
  }
  const filePath = join(nodePtyDir, ...target.relativePath)
  return { filePath, source: readFileSync(filePath, 'utf8') }
}

function assertPatchedNodePtyWindowsTeardown(relayDir = process.cwd()) {
  for (const target of PATCH_TARGETS) {
    const inspected = inspectTarget(relayDir, target)
    if (sourceSha256(inspected.source) !== target.patchedSha256) {
      throw new Error(
        `node-pty ConPTY teardown release is not installed in ${target.relativePath.join('/')}`
      )
    }
  }
}

function patchNodePtyWindowsTeardown(relayDir = process.cwd()) {
  for (const target of PATCH_TARGETS) {
    const inspected = inspectTarget(relayDir, target)
    const sourceHash = sourceSha256(inspected.source)
    if (sourceHash === target.patchedSha256) {
      continue
    }
    if (sourceHash !== target.originalSha256) {
      throw new Error(
        `Refusing to patch unexpected node-pty source in ${target.relativePath.join('/')}`
      )
    }
    let patchedSource = inspected.source
    for (const [from, to] of target.replacements) {
      // Why the count check: an anchor that matched twice would patch the wrong site silently, and
      // the hash below would then reject a tree this script had already rewritten.
      if (patchedSource.split(from).length - 1 !== 1) {
        throw new Error(`Refusing to patch ${target.relativePath.join('/')}; anchor is not unique`)
      }
      patchedSource = patchedSource.replace(from, to)
    }
    const temporaryPath = `${inspected.filePath}.orca-patch-${process.pid}`
    // Why: a terminated remote install must leave either known source version recoverable on reconnect.
    try {
      writeFileSync(temporaryPath, patchedSource)
      renameSync(temporaryPath, inspected.filePath)
    } finally {
      rmSync(temporaryPath, { force: true })
    }
  }
  assertPatchedNodePtyWindowsTeardown(relayDir)
}

function sourceSha256(source) {
  return createHash('sha256').update(source).digest('hex')
}

if (require.main === module) {
  patchNodePtyWindowsTeardown()
}

module.exports = {
  assertPatchedNodePtyWindowsTeardown,
  patchNodePtyWindowsTeardown
}
