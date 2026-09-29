import type { AiVaultAgent } from './ai-vault-types'
import type { ExecutionHostId } from './execution-host'

export type ChatSidebarCompletion = {
  activityAt: number
  at: number
  done?: boolean
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
  /** Host-built resume command; only remote hosts need it. */
  resumeCommand?: string
}

export type ChatSidebarSessionEntry = {
  worktreeId: string
  /** Pins which chat shows its workspace's manual name once sibling chats appear. */
  ownsWorkspaceName?: boolean
  snapshot?: ChatSidebarSessionSnapshot
}

export type ChatSidebarSettings = {
  view?: 'chats' | 'workspaces'
  groupBy?: 'recent' | 'status' | 'folder'
  /** Unchecked folder labels; new folders remain visible by default. */
  hiddenFolders?: string[]
  /** Automation-owned tab/pane and provider identities; retained after run cleanup. */
  automationChats?: string[]
  /** Next launch destination; never changes the owner of a running terminal. */
  folderAssignments?: Record<string, { worktreeId: string; executionHostId: ExecutionHostId }>
  historySince?: number
  completed?: Record<string, ChatSidebarCompletion>
  defaultRepoId?: string
  /** Keyed by `JSON.stringify([executionHostId, agent, sessionId])`. */
  sessions?: Record<string, ChatSidebarSessionEntry>
  hidden?: string[]
  titles?: Record<string, string>
}
