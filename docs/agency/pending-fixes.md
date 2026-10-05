# Pending Orca Agency release notes

Read this file during each weekly update. Include pending fixes in the release notes only after the source, Claude review, package, installed functionality and visual checks pass. Then record the published release next to each included item.

## October 3, 2026 update

1. **Resumed chat status:** For tabs closed after this update, resuming their saved chat in a replacement tab returns it to In Progress and its open pane group. Resume metadata does not change its activity time. A real prompt clears the previous Done status, including Claude quick turns that finish before working-state history is retained. An explicit Mark done choice survives closing and resuming until a new prompt. Older completion records also return to In Progress on their next prompt; they do not record whether Done came from a tab close or a manual choice.

   **Cold restart grouping:** A verified Claude resume stays attached to its open tab and pane bracket while hooks reconnect. The saved connection must match the execution host, workspace, tab, stable pane and launcher. Conflicting live or saved provider evidence prevents reuse. Closed tabs remain separate history, and recovery does not invent activity.

Status: installed and visually verified on October 2 in Agency 1.4.1002. A running client chat remained in In Progress and in its pane bracket after restart, with all 7 terminals, 21 tabs and 74 saved chat entries preserved. Pending repeated validation against the Saturday stable merge and release publication. Regression: `src/renderer/src/components/sidebar/chat-sidebar-reopened-completion.test.ts` and `chat-sidebar-saved-claude-tab.test.ts`.

2. **Installer connection recovery:** A timed-out renderer debugging connection can use the existing desktop close fallback. The fallback verifies the exact desktop process and executable, preserves unsaved-file checks and requests normal close confirmation. It never kills a terminal. Claude approved the change; 12 helper fixture checks and the October 2 installed retry passed.

Installed check: resume a previously closed chat, send a prompt, and place it with two other chats in three panes. Confirm it remains in In Progress and in the full three-pane bracket after the working event ends and after restart. Also confirm resume alone preserves its earlier activity time and an explicit Mark done choice survives closing.

## October 4, 2026 candidate

- **Product name:** Orca Agency in application and installer display names and the real GitHub fork. Retain existing executable and profile identities for update compatibility.
- **Pane dragging:** Terminal tabs can move from bottom panes and onto whole-window edges, including switching top/bottom panes to side-by-side.
- **Separate chat:** Move a prompted terminal out of nesting without stopping its process or marking it Done. Pane X removes the view and retains conversations. Tab X keeps the existing Done behavior.
- **History reopening:** Focus an existing matching session. Closed history reopens separately and does not restore its previous nested slot. Confirmed failed launches clean up only their empty new workspace; uncertain remote launches retain their workspace.
- **Focused runs:** The focused running window group sorts first, preserving its entire bracket and conversation activity times. Idle viewing does not stamp Now.
- **Move persistence:** Preserve PTY and pane identities, execution folder, completion status and saved resume ownership across moves and restarts. Protect moved processes from deletion of the original workspace.
- **Moved terminal replay:** Restore scrollback for the exact moved tab even while its original workspace remains open. Preserve the same live process and accept new output after moving.
- **Publication:** Use the real `brooksgolden/Orca-Agency` fork, preserve public edits, and export the verified tree with only public and proven upstream ancestry. The weekly automation remains Saturday at 8 am in America/New_York.

- **Startup profile:** Keep the existing Orca profile and encryption identity when displaying Orca Agency. Candidate 1.4.1006 supersedes 1.4.1005, whose rollout was reverted after it selected an empty profile.
- **Terminal recovery:** Reconnect surviving terminals to their exact pane, retain their process handle across temporary layout loss, and refuse to overwrite a different terminal occupying that pane.
- **CI repairs:** Check README links to tracked directories, align fixtures with current terminal and folder behavior, and keep tab closing functional if saved-chat bookkeeping fails.
- **Email-triggered repairs:** Refresh active review leases from real progress, reject stale completions safely, and repair launch failures immediately rather than deferring them to Saturday.
- **Installer verification:** Bound debugging timeouts, tolerate the new desktop's startup delay, and verify the expected version and original profile before accepting a restart.

Release gate: actual Claude Opus 5.5 extra high review, Codex regressions, packaged checks and rendered sidebar verification. The failed 1.4.1005 package must not be installed or published. The October 4 instruction authorizes publication before local installation, but requires Brooks's approval before installing this update. Keep the scheduled weekly update at Saturday 8 am America/New_York.

## Immediate CI hotfix, October 4, 2026

Candidate 1.4.1008 includes the reviewed 1.4.1006 changes above, plus:

- Restore the workflows compatible with stable v1.4.219 after its incomplete future-main workflow sync. Keep full unit, Node 24/26, Windows, Bun and SSH checks.
- Index tab ownership once per immutable snapshot instead of repeatedly scanning all tabs during startup recovery.
- Keep remote terminal cleanup away from local registry entries, including same-ID workspaces on different hosts.
- Reject undefined SQLite parameters consistently across supported Node versions; valid null remains accepted.
- Update test fixtures for current onboarding labels, pane moves, saved-chat restoration and asynchronous terminal attention.

Claude Opus 5.5 extra high audited the CI fixes and rechecked the remote cleanup repair. Release requires the exact packaged smoke checks and relevant GitHub reruns. Local installation and installed visual checks are held for Brooks's approval. A failed run from an older source commit is evidence for repair, not evidence that the current installed package failed.

## Quadrant dragging, October 4, 2026

- Keep the dragged tab preview transparent to pointer detection so it cannot hide the destination pane.
- Use pane proportions to select a local split. Corner areas of a full-height or full-width pane target quadrants; outer edge midpoints retain full-window splits.
- Keep blue internal tab-group splits usable at the body quarters while preserving the central merge area and tab-strip reorder behavior.
- Exercise actual pointer drags into all four workspace quadrants, including outer-side corner drops, and the blue bottom-right split. Check preview bounds, final pane geometry, retained conversations and sidebar brackets.
- Unpack the complete compiled main-module set so the packaged Node CLI can load its profile, SQLite and agent-hook dependencies. Keep the existing packaged runtime guard enabled.

Candidate 1.4.1007 failed its packaging guard and was not installed or published. Candidate 1.4.1008 passed 71 scoped unit checks, web typecheck, changed-code quality and all three actual pointer smoke scenarios. Every quadrant, outer-divider half-window drops, native blue bottom-right splits and nested-chat edge detachment passed. Terminal output and ownership survived. Claude reviewed the repairs with no code blockers. Hidden packaged launch and GitHub reruns remain release gates. Publish after verification; ask Brooks before local installation.
