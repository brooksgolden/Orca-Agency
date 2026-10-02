# Pending Orca Agency release notes

Read this file during each weekly update. Include pending fixes in the release notes only after the source, Claude review, package, installed functionality and visual checks pass. Then record the published release next to each included item.

## October 3, 2026 update

1. **Resumed chat status:** For tabs closed after this update, resuming their saved chat in a replacement tab returns it to In Progress and its open pane group. Resume metadata does not change its activity time. A real prompt clears the previous Done status, including Claude quick turns that finish before working-state history is retained. An explicit Mark done choice survives closing and resuming until a new prompt. Older completion records also return to In Progress on their next prompt; they do not record whether Done came from a tab close or a manual choice.

   **Cold restart grouping:** A verified Claude resume stays attached to its open tab and pane bracket while hooks reconnect. The saved connection must match the execution host, workspace, tab, stable pane and launcher. Conflicting live or saved provider evidence prevents reuse. Closed tabs remain separate history, and recovery does not invent activity.

Status: installed and visually verified on October 2 in Agency 1.4.1002. The running Anthony CPA chat remained in In Progress and in its pane bracket after restart, with all 7 terminals, 21 tabs and 74 saved chat entries preserved. Pending repeated validation against the Saturday stable merge and release publication. Regression: `src/renderer/src/components/sidebar/chat-sidebar-reopened-completion.test.ts` and `chat-sidebar-saved-claude-tab.test.ts`.

2. **Installer connection recovery:** A timed-out renderer debugging connection can use the existing desktop close fallback. The fallback verifies the exact desktop process and executable, preserves unsaved-file checks and requests normal close confirmation. It never kills a terminal. Claude approved the change; 12 helper fixture checks and the October 2 installed retry passed.

Installed check: resume a previously closed chat, send a prompt, and place it with two other chats in three panes. Confirm it remains in In Progress and in the full three-pane bracket after the working event ends and after restart. Also confirm resume alone preserves its earlier activity time and an explicit Mark done choice survives closing.
