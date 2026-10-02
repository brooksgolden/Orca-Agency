# Pending Orca Agency release notes

Read this file during each weekly update. Include pending fixes in the release notes only after the source, Claude review, package, installed functionality and visual checks pass. Then record the published release next to each included item.

## October 3, 2026 update

1. **Resumed chat status:** For tabs closed after this update, resuming their saved chat in a replacement tab returns it to In Progress and its open pane group. Resume metadata does not change its activity time. A real prompt clears the previous Done status, including Claude quick turns that finish before working-state history is retained. An explicit Mark done choice survives closing and resuming until a new prompt. Older completion records also return to In Progress on their next prompt; they do not record whether Done came from a tab close or a manual choice.

Status: pending installation and visual verification in the Saturday update. Regression: `src/renderer/src/components/sidebar/chat-sidebar-reopened-completion.test.ts`.

Installed check: resume a previously closed chat, send a prompt, and place it with two other chats in three panes. Confirm it remains in In Progress and in the full three-pane bracket after the working event ends and after restart. Also confirm resume alone preserves its earlier activity time and an explicit Mark done choice survives closing.
