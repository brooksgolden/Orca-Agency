import { describe, expect, it } from 'vitest'
import type { ProjectGroup } from '../../../../shared/project-group-types'
import type { Repo } from '../../../../shared/repo-types'
import { folderWorkspaceRepoId } from '../../../../shared/folder-workspace-worktree'
import type { Worktree } from '../../../../shared/worktree/types'
import {
  chatFolderDestinations,
  chatFolderHeadingLabels,
  chatFolderPickerGroups,
  isUnregisteredChatFolder
} from './chat-folder-destinations'
import { chatFolderLabel, chatSidebarWorktrees } from './chat-sidebar-worktrees'
import { chatState, chatWorktree } from './chat-sidebar-test-fixtures'
import { chatSessionKey } from './chat-sidebar-types'

// Live shapes behind the sidebar heading "Example Capital": a registered project group, a
// worktree whose repo has no project group and no display name (the heading comes from the
// worktree path), and a folder workspace that reaches its heading through a project group.
const initioGroup: ProjectGroup = {
  id: 'group-exampleCapital',
  name: 'Example Capital',
  parentPath: '/clients/Example Capital',
  parentGroupId: null,
  createdFrom: 'manual',
  tabOrder: 0,
  isCollapsed: false,
  color: null,
  createdAt: 1,
  updatedAt: 1
}

function groupBackedState() {
  const state = chatState({ projectGroups: [initioGroup] })
  state.repos = [{ ...state.repos[0], projectGroupId: initioGroup.id }]
  state.worktreesByRepo = {
    repo: [{ ...chatWorktree, path: '/clients/Example Capital/lead-gen' }]
  }
  return state
}

function pathOnlyState() {
  const state = chatState()
  const { displayName: _displayName, ...looseRepo } = state.repos[0]
  const loose: Repo = {
    ...looseRepo,
    id: 'loose',
    path: '/clients/Example Capital'
  } as Repo
  state.repos = [...state.repos, loose]
  state.worktreesByRepo = {
    ...state.worktreesByRepo,
    loose: [
      {
        ...chatWorktree,
        id: 'loose::/clients/Example Capital',
        repoId: 'loose',
        path: '/clients/Example Capital'
      }
    ]
  }
  return state
}

function folderWorkspaceState() {
  const state = chatState({ projectGroups: [initioGroup] })
  const folder: Worktree = {
    ...chatWorktree,
    id: 'folder:fw-exampleCapital',
    repoId: folderWorkspaceRepoId(initioGroup.id),
    path: '/clients/Example Capital/gtm',
    hostId: 'local'
  }
  state.worktreesByRepo = { [folder.repoId]: [folder] }
  return state
}

describe.each([
  ['registered project group', groupBackedState],
  ['path-only worktree', pathOnlyState],
  ['folder workspace in a project group', folderWorkspaceState]
] as const)('chat folder heading through a %s', (_shape, makeState) => {
  it('lists the sidebar heading once in the Change folder menu and the pickers', () => {
    const state = makeState()
    const heading = chatSidebarWorktrees(state)
      .map((worktree) => chatFolderLabel(state, worktree))
      .find((label) => label === 'Example Capital')
    expect(heading).toBe('Example Capital')
    const menu = chatFolderDestinations(state).filter(
      (destination) => destination.label === 'Example Capital' && destination.hostId === 'local'
    )
    expect(menu).toHaveLength(1)
    const picker = chatFolderPickerGroups(state).filter(
      (folder) => folder.name === 'Example Capital' && folder.executionHostId !== 'ssh:box'
    )
    expect(picker).toHaveLength(1)
  })

  it('files a chat under the same heading it was chosen from', () => {
    const state = makeState()
    const destination = chatFolderDestinations(state).find(
      (item) => item.label === 'Example Capital' && item.hostId === 'local'
    )!
    expect(destination).toBeDefined()
    if (destination.worktreeId) {
      const worktree = chatSidebarWorktrees(state).find(
        (item) => item.id === destination.worktreeId
      )!
      expect(chatFolderLabel(state, worktree)).toBe('Example Capital')
    } else {
      // A filed folder workspace takes the project group's folder name as its heading.
      const filed: Worktree = {
        ...chatWorktree,
        repoId: folderWorkspaceRepoId(destination.projectGroupId!),
        path: destination.path
      }
      expect(chatFolderLabel(state, filed)).toBe('Example Capital')
    }
  })
})

describe('chat folder destinations across storage shapes', () => {
  it('lists every heading from every shape once, with no duplicates', () => {
    const state = chatState({ projectGroups: [initioGroup] })
    state.repos = [
      { ...state.repos[0], projectGroupId: initioGroup.id },
      { ...state.repos[0], id: 'loose', path: '/clients/Example Capital' }
    ]
    const { displayName: _displayName, ...rest } = state.repos[1]
    state.repos = [state.repos[0], rest as Repo]
    state.worktreesByRepo = {
      repo: [{ ...chatWorktree, path: '/clients/Example Capital/lead-gen' }],
      loose: [
        { ...chatWorktree, id: 'loose::x', repoId: 'loose', path: '/clients/Example Capital' }
      ],
      [folderWorkspaceRepoId(initioGroup.id)]: [
        {
          ...chatWorktree,
          id: 'folder:fw-exampleCapital',
          repoId: folderWorkspaceRepoId(initioGroup.id),
          path: '/clients/Example Capital/gtm'
        }
      ]
    }
    const labels = chatFolderDestinations(state).map((item) => item.label)
    expect(labels.filter((label) => label === 'Example Capital')).toHaveLength(1)
    expect(new Set(labels).size).toBe(labels.length)
    const pickerNames = chatFolderPickerGroups(state).map((folder) => folder.name)
    expect(pickerNames.filter((name) => name === 'Example Capital')).toHaveLength(1)
  })

  it('keeps a path-only folder unregistered until a new chat is filed under it', () => {
    const state = pathOnlyState()
    const folder = chatFolderPickerGroups(state).find((item) => item.name === 'Example Capital')!
    expect(isUnregisteredChatFolder(folder)).toBe(true)
    expect(folder.parentPath).toBe('/clients/Example Capital')
    expect(folder.executionHostId).toBe('local')
  })

  it('keeps a registered project group as the picker entry, not an unregistered copy', () => {
    const folder = chatFolderPickerGroups(groupBackedState()).find(
      (item) => item.name === 'Example Capital'
    )!
    expect(folder.id).toBe(initioGroup.id)
    expect(isUnregisteredChatFolder(folder)).toBe(false)
  })

  it('keeps a real standalone project listed under its own heading', () => {
    const state = chatState()
    const { displayName: _displayName, ...standalone } = state.repos[0]
    state.repos = [{ ...standalone, id: 'standalone', path: '/dev/example-gtm-dashboard' } as Repo]
    state.worktreesByRepo = {
      standalone: [
        {
          ...chatWorktree,
          id: 'standalone::x',
          repoId: 'standalone',
          path: '/dev/example-gtm-dashboard'
        }
      ]
    }
    expect(
      chatFolderDestinations(state, {
        headingLabels: new Set(['Example Capital'])
      }).map((item) => item.label)
    ).toEqual([])
    expect(
      chatFolderPickerGroups(state, {
        headingLabels: new Set(['Example Capital'])
      }).map((item) => item.name)
    ).toEqual([])
  })

  it('derives picker headings from the same saved and resident chats as the sidebar', () => {
    const state = pathOnlyState()
    const key = chatSessionKey('local', 'codex', 'exampleCapital-chat')
    state.settings!.chatSidebar = {
      sessions: {
        [key]: {
          worktreeId: 'loose::/clients/Example Capital',
          snapshot: {
            executionHostId: 'local',
            agent: 'codex',
            sessionId: 'exampleCapital-chat',
            title: 'Research entrepreneurial newsletter',
            cwd: '/clients/Example Capital',
            filePath: '/sessions/exampleCapital-chat.jsonl',
            codexHome: '/codex',
            createdAt: new Date(1_000).toISOString(),
            updatedAt: new Date(2_000).toISOString(),
            modifiedAt: new Date(2_000).toISOString()
          }
        }
      }
    }
    expect([...chatFolderHeadingLabels(state, 10_000)]).toContain('Example Capital')
    expect(
      chatFolderPickerGroups(state, {
        headingLabels: chatFolderHeadingLabels(state, 10_000)
      }).map((item) => item.name)
    ).toContain('Example Capital')
  })

  it.each([groupBackedState, pathOnlyState])(
    'omits an explicitly hidden folder from shared new-chat and change-folder destinations',
    (createState) => {
      const state = createState()
      state.settings!.chatSidebar = { hiddenFolders: ['Example Capital'] }
      const headingLabels = chatFolderHeadingLabels(state, 10_000)
      expect([...headingLabels]).not.toContain('Example Capital')
      expect(
        chatFolderPickerGroups(state, { headingLabels }).map((folder) => folder.name)
      ).not.toContain('Example Capital')
    }
  )

  it('retains an empty registered destination when reusing the already-built sidebar rows', () => {
    const state = groupBackedState()
    const headingLabels = chatFolderHeadingLabels(state, 10_000, [])
    expect(
      chatFolderDestinations(state, { headingLabels }).map((folder) => folder.label)
    ).toContain('Example Capital')
  })
})

// Live shape: repo "Example Capital" stored with backslashes, its main checkout reported with
// forward slashes (the git listing spelling). The exact-path rule must still match it.
describe('registered project whose path spelling differs from its checkout', () => {
  function separatorState(checkoutPath: string) {
    const state = chatState()
    state.repos = [
      {
        ...state.repos[0],
        id: 'exampleCapital',
        displayName: 'Example Capital',
        path: 'C:\\Users\\example-user\\dev\\claude\\Example Capital'
      }
    ]
    state.worktreesByRepo = {
      exampleCapital: [
        {
          ...chatWorktree,
          id: 'exampleCapital::main',
          repoId: 'exampleCapital',
          path: checkoutPath,
          isMainWorktree: true
        }
      ]
    }
    return state
  }

  it('lists the project when the checkout uses forward slashes', () => {
    const state = separatorState('C:/Users/example-user/dev/claude/Example Capital')
    expect(chatFolderDestinations(state).map((item) => item.label)).toEqual(['Example Capital'])
  })

  it('lists the project when the checkout differs only in case', () => {
    const state = separatorState('c:/users/example-user/dev/claude/example capital')
    expect(chatFolderDestinations(state).map((item) => item.label)).toEqual(['Example Capital'])
  })
})

describe('branch checkouts never become menu entries unless their heading is shown', () => {
  function branchState() {
    const state = chatState()
    const { displayName: _displayName, ...bare } = state.repos[0]
    state.repos = [{ ...bare, id: 'app', path: '/dev/app' } as Repo]
    state.worktreesByRepo = {
      app: [
        { ...chatWorktree, id: 'app::main', repoId: 'app', path: '/dev/app', isMainWorktree: true },
        {
          ...chatWorktree,
          id: 'app::feature',
          repoId: 'app',
          path: '/dev/app-worktrees/feature-login',
          isMainWorktree: false
        }
      ]
    }
    return state
  }

  it('omits a branch checkout name from the menu and the pickers by default', () => {
    const state = branchState()
    expect(chatFolderDestinations(state).map((item) => item.label)).toEqual(['app'])
    expect(chatFolderPickerGroups(state).map((item) => item.name)).toEqual(['app'])
  })

  it('offers a branch checkout only when the sidebar is showing its heading', () => {
    const state = branchState()
    const labels = chatFolderDestinations(state, {
      headingLabels: new Set(['app', 'feature-login'])
    }).map((item) => item.label)
    expect(labels).toEqual(['app', 'feature-login'])
  })
})
