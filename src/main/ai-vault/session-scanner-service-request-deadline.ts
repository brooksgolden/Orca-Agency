import type { AiVaultServicePendingCall } from './session-scanner-service-client-state'
import type { AiVaultServiceRequest } from './session-scanner-service-protocol'
import type { AiVaultScanWork } from '../../shared/ai-vault-scan-progress'

export const AI_VAULT_SERVICE_INTERACTIVE_TIMEOUT_MS = 15_000

export type AiVaultServiceScanListener = {
  work: (work: AiVaultScanWork) => void
}

// Large scans run until completion, cancellation, or child exit; history size must not time them out.
function armAiVaultServiceRequestDeadline(
  call: AiVaultServicePendingCall,
  onTimeout: (error: Error) => void,
  onTitleTimeout?: () => void
): void {
  if (call.request.operation === 'scan') {
    return
  }
  const timeoutMs = AI_VAULT_SERVICE_INTERACTIVE_TIMEOUT_MS
  if (call.timer) {
    clearTimeout(call.timer)
  }
  // Remote clients humanize this text, so a new wording would reach older ones as "stopped unexpectedly".
  call.timer = setTimeout(() => {
    if (call.request.operation === 'titles' && onTitleTimeout) {
      // A title batch may need to read many large transcripts. Timing it out
      // must not discard the scanner child's incremental parse cache.
      onTitleTimeout()
      return
    }
    onTimeout(new Error(`AI Vault service timed out after ${timeoutMs}ms.`))
  }, timeoutMs)
  call.timer.unref?.()
}

/**
 * Startup time does not count toward request deadlines. A title batch that
 * times out is cancelled through onTitleTimeout without retiring the child.
 */
export function sendAiVaultServiceCall(
  child: { send(request: AiVaultServiceRequest): unknown },
  call: AiVaultServicePendingCall,
  isActive: () => boolean,
  onTimeout: (error: Error) => void,
  onTitleTimeout?: () => void
): void {
  if (call.cancelled || !isActive()) {
    return
  }
  armAiVaultServiceRequestDeadline(call, onTimeout, onTitleTimeout)
  call.sent = true
  child.send(call.request)
}

export function noteAiVaultServiceScanProgress(
  call: AiVaultServicePendingCall,
  work: AiVaultScanWork
): void {
  if (call.cancelled || !call.sent || call.request.operation !== 'scan') {
    return
  }
  call.scanListener?.work(work)
}
