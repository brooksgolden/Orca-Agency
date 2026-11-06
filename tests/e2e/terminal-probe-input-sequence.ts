import { nodeTerminalCommand } from './terminal-node-command'

export function buildFreshShellProbeInputSequence(command: string): readonly string[] {
  // Avoid startup Ctrl+C on ConPTY: literal ^C can corrupt the next PowerShell command.
  return [command]
}

export function buildSettledShellProbeInputSequence(
  command: string,
  platform: NodeJS.Platform = process.platform
): readonly string[] {
  // Ctrl+U is POSIX-only; send native Windows Ctrl+C separately after readiness so ConPTY cannot join it to command input.
  return platform === 'win32' ? ['\x03', command] : ['\x03\x15', command]
}
export function encodedShellMarkerCommand(marker: string): string {
  // Encoding prevents terminal command echo from satisfying the readiness check.
  const encoded = Buffer.from(marker, 'utf8').toString('base64')
  return `${nodeTerminalCommand([
    '-e',
    `console.log(Buffer.from('${encoded}', 'base64').toString('utf8'))`
  ])}\r`
}
