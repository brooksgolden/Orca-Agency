# GitHub notification email review

Windows maintenance scripts for the repository owner's email automation. These are not an Orca app feature or a scheduled GitHub poll.

The authenticated Composio Outlook webhook delivers notification events to a hidden WebSocket listener. A matching Orca automation owns the review prompt and run history, with its clock schedule disabled. A logon-only Windows task starts the listener. Only incoming notifications and connection recovery read email. Active Orca reviews are monitored separately.

Runtime configuration, Composio context, credentials and mail state belong in a private support folder. Never commit them here. The operational copy reads `config.json`, `outlook-trigger-params.json` and the existing Composio user account. `install-email-listener.ps1` requires the matching Orca automation before registering its logon task.

Commands: `setup`, `listen`, `pending`, `replay --message-id ID`, `finish --key KEY --reason TEXT --run-token TOKEN [--reply-file FILE]`, and `complete-run --run-token TOKEN`. Retain the batch token returned by `pending`. Replies check the exact thread, exclude self and bots, and record attempts before posting to prevent duplicates after uncertain responses.

Run the focused tests with `python -m unittest test_email_bridge`. They cover routing, cross-linked subjects, exact-thread checks, chunk delivery, batch recovery, pagination and duplicate prevention. The runtime requires Python, websocket-client, pywin32, the existing Composio CLI, GitHub CLI and Orca CLI.
