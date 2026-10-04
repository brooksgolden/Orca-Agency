import { readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { expect, type ElectronApplication } from '@stablyai/playwright-test'
import { retryTransientMainEvaluate } from './electron-main-evaluate-retry'

export async function assertPackagedExecutableIdentity(
  app: ElectronApplication,
  executablePath: string | undefined
): Promise<void> {
  if (!executablePath) {
    throw new Error('Packaged executable path is required')
  }
  const identity = await retryTransientMainEvaluate(() =>
    app.evaluate(({ app }) => ({
      exePath: process.execPath,
      version: app.getVersion(),
      packaged: app.isPackaged
    }))
  )
  const expectedVersion = JSON.parse(readFileSync(path.resolve('package.json'), 'utf8')).version
  expect(identity.packaged).toBe(true)
  expect(identity.version).toBe(expectedVersion)
  expect(realpathSync(identity.exePath).toLowerCase()).toBe(
    realpathSync(executablePath).toLowerCase()
  )
  console.log(`ORCA_SMOKE_IDENTITY:${JSON.stringify(identity)}`)
}
