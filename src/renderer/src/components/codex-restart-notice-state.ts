type CodexRestartNoticeState =
  | {
      restartRequested?: true
      dismissed?: true
      homeRouteChanged?: true
      previousAccountId?: string | null
      nextAccountId?: string | null
    }
  | null
  | undefined

function isUsableCodexConfigurationNotice(notice: CodexRestartNoticeState): boolean {
  // A configuration migration does not justify interrupting an existing conversation.
  return Boolean(
    notice?.homeRouteChanged &&
    !notice.restartRequested &&
    notice.previousAccountId !== undefined &&
    notice.nextAccountId !== undefined &&
    notice.previousAccountId === notice.nextAccountId
  )
}

/** Block input until a requested restart actually switches accounts; dismissal explicitly accepts keeping the current account. */
export function blocksCodexPaneInput(notice: CodexRestartNoticeState): boolean {
  return Boolean(notice) && !notice?.dismissed && !isUsableCodexConfigurationNotice(notice)
}

export function awaitsCodexRestartAnswer(notice: CodexRestartNoticeState): boolean {
  return blocksCodexPaneInput(notice) && !notice?.restartRequested
}
