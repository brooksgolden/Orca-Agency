# Orca Agency

## Every chat, in one sidebar

Keep your Claude and Codex chats visible as you move between projects.

Orca Agency is an independent, unofficial fork of [Orca](https://github.com/stablyai/orca) (MIT license, Lovecast Inc., no OpenAI or Anthropic affiliation). It brings a familiar Codex and Claude style chat list to agency operators who need to multitask across multiple client folders.

Orca brings agents, terminals, files, browsers, and automations into one app. This fork makes your individual chats easier to find and work on:

- **Find your chats:** Start or resume an LLM conversation and find it in Chats, with its provider icon beside the name. Unused launches stay out. Tabs sharing a pane appear as a main chat with indented sub-chats and one folder label. Search titles, filter folders, and reopen saved conversations when their transcripts are available. File and browser tabs stay out of the chat list.
- **Chat ordering and status:** Active runs sort first, followed by latest agent activity. Viewing or reopening a chat does not make it newly active. Group by In progress / Done, Recent, or Folder, and collapse status sections independently. Compact rows show chat titles, folder names, "Now" while running, and elapsed time afterward.
- **Names and status:** Your saved sidebar names override generated chat titles. Closing a sub-tab removes it from nesting and leaves its saved chat separately in Done to resume later. Submitting a new prompt reactivates it. Delete marks the selected chat Done.

- **Arrange your view:** Drag open chats or blank workspace header space to arrange workspaces, or drop a saved chat to resume it in a pane. Idle and Done chats can be dragged too. Add panes beside, above or below others, including a full-width pane above or below an existing split. Brackets connect separate panes, each with its own folder label; elbows connect tabs sharing a pane. Close a pane directly, or close its last tab to collapse it. File links open within their workspace.

- **Choose a folder:** New chat uses one folder picker with directory names. Uncategorized is the initial default; change it in Settings. Right-click a chat to change its folder without interrupting its running terminal. The new working directory takes effect when the chat is resumed.

- **Less toolbar clutter:** The Command button is off by default. Enable it in Quick Commands settings for supported repository panes.
- **Copy file paths:** Editor tab Copy Path uses Windows backslashes for Windows paths and preserves Mac/Linux path formats.
- **Open short file links:** Click relative file paths printed by an agent. Orca checks the terminal's folder, then existing files identified by paths printed earlier in that pane. Ambiguous matches stay unlinked.
- **Automations tab:** Discover Windows scheduled tasks and Hermes services. Background automation runs stay out of your Chats sidebar.
- **Managed installer updates:** The Windows installer stages and verifies complete files before closing Orca, restarts after successful installation, and retains two managed rollback versions while safely preserving original AI chat transcripts and caches in place.

### Build status

Orca Agency 1.4.1000 is based on Orca v1.4.218. Source review, packaged-app checks, installer preservation checks and live visual inspection are complete. Slow first history discovery and detached Claude background-session status remain known issues, as do terminal slowdowns. Mac and Linux release builds are not yet verified for this fork.

### Download

[Download Windows x64](https://github.com/brooksgolden/orca-agency/releases/latest)

Extract the entire ZIP into its own folder, close the existing Orca desktop, and launch `Orca.exe`. This is a portable Windows package. The reviewed upgrade scripts are in [config/scripts](config/scripts); they require an existing Orca installation. Mac and Linux binaries are not included.

### Updates and development

The maintainer checks upstream stable releases weekly and preserves the Agency features through Codex implementation, Claude audit, final Codex review, and installed-app checks. See [the update process](docs/agency/weekly-updates.md).

For development and upstream documentation, see the [original README](README.upstream.md). Orca Agency retains the upstream [MIT license](LICENSE).
