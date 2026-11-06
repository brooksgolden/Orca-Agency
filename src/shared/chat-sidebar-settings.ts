import type { AiVaultAgent } from './ai-vault-types'
import type { ExecutionHostId } from './execution-host'

export type ChatSidebarCompletion = {
  activityAt: number
  at: number
  done?: boolean
  /** Automatic tab-close completion; a replacement tab reopens the saved chat. */
  closedTabId?: string
  /** The chat was working when marked done; title-only chats reopen after that turn ends. */
  working?: boolean
}

/** Enough of a closed chat to list and resume it while the history scan is slow or failing. */
export type ChatSidebarSessionSnapshot = {
  executionHostId: ExecutionHostId
  executionHostPlatform?: NodeJS.Platform | null
  agent: AiVaultAgent
  sessionId: string
  title: string
  cwd: string | null
  filePath: string
  codexHome: string | null
  createdAt: string | null
  updatedAt: string | null
  modifiedAt: string
  /** Present after an exact Claude transcript was classified. */
  isHeadless?: boolean
  /** Latest real Claude prompt timestamp retained across no-history restarts. */
  lastHumanTurnAt?: string
  /** Host-built resume command; only remote hosts need it. */
  resumeCommand?: string
}

/** Provider-reported `/resume` link bound to the terminal pane that issued it. */
export type ChatSidebarResumeLauncher = {
  agent: 'claude'
  sessionId: string
  transcriptPath: string
  tabId: string
  paneKey: string
  targetSessionIdPrefix: string
}

export type ChatSidebarSessionEntry = {
  worktreeId: string
  /** Stable chat creation order, retained after the original terminal closes. */
  createdAt?: number
  /** Pins which chat shows its workspace's manual name once sibling chats appear. */
  ownsWorkspaceName?: boolean
  snapshot?: ChatSidebarSessionSnapshot
  resumeLauncher?: ChatSidebarResumeLauncher
}

/** Done Closed = Done with no open tab, Done Open = Done with an open tab, idle = grey idle dot (not Done). */
export type ChatStateChecks = {
  doneClosed?: boolean
  doneOpen?: boolean
  idle?: boolean
}

export type ChatSidebarSettings = {
  view?: 'chats' | 'workspaces'
  groupBy?: 'recent' | 'status' | 'folder'
  /** Legacy Hide Done flag; mirrored from `hideChats` so a rollback keeps the same view. */
  showOnlyInProgress?: boolean
  /** Chat states hidden by the Hide Chats menu. Absent means the legacy Done flag decides. */
  hideChats?: ChatStateChecks
  showOnlyOpenChats?: boolean
  /** Legacy Collapse Done flag; mirrored from `collapseFolders` for rollback safety. */
  collapseDoneFolders?: boolean
  /** Chat states whose all-matching folders collapse. Absent means the legacy Done flag decides. */
  collapseFolders?: ChatStateChecks
  /** Folder headings manually expanded while automatic Done-folder collapse is enabled. */
  expandedDoneFolders?: string[]
  /** Unchecked folder labels; new folders remain visible by default. */
  hiddenFolders?: string[]
  /** Automation-owned tab/pane and provider identities; retained after run cleanup. */
  automationChats?: string[]
  /** Chats a person submitted a message in; they stay in the sidebar after the tab closes. */
  humanChats?: string[]
  /** Pane keys an agent spawned, with host; kept so a session the hook reports after restart is still tagged. */
  agentSpawnedPanes?: Record<string, string>
  /** Receipt of the one-time agent-spawn backlog migration; `addedKeys` were hidden and can be restored. */
  agentSpawnBacklogMigration?: { id: string; appliedAt: string; addedKeys: string[] }
  /** Exact tabs the user reopened from session history, even when the provider was automated. */
  userResumedTabs?: string[]
  /** Next launch destination; never changes the owner of a running terminal. */
  folderAssignments?: Record<string, { worktreeId: string; executionHostId: ExecutionHostId }>
  /** All resident chats in a workspace share this folder, including newly created tabs. */
  workspaceFolderAssignments?: Record<
    string,
    { worktreeId: string; executionHostId: ExecutionHostId }
  >
  historySince?: number
  completed?: Record<string, ChatSidebarCompletion>
  defaultRepoId?: string
  defaultFolder?: { projectGroupId: string; executionHostId: ExecutionHostId }
  /** Keyed by `JSON.stringify([executionHostId, agent, sessionId])`. */
  sessions?: Record<string, ChatSidebarSessionEntry>
  /** Hidden history entries; opening a conversation restores its visibility. */
  hidden?: string[]
  titles?: Record<string, string>
}
