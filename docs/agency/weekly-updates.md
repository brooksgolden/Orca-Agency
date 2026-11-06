# Orca Agency update process

Saturday and biweekly automatic stable integrations are disabled. Upstream stable releases are integrated opportunistically after code review while preserving Agency features. Merges remain local to the maintainer environment; downloading Orca Agency schedules no automated tasks on other systems.

## Review and release process

1. Compare the targeted upstream stable tag against the recorded upstream base, merge changes, and resolve conflicts against the feature contract.
2. Run regressions, typechecks, code-quality checks, hidden renderer checks, and packaged-app tests.
3. Conduct independent code review of all changes and test results. Failed checks or review findings require code edits and another full verification pass.
4. Assign a unique Agency version when binaries change, commit with standard hooks, and require a clean tree before building. Build each Windows artifact with its matching native toolchain, record the architecture and commit in the package manifest, and test that exact artifact. The installer stages complete files, closes the desktop gracefully, preserves running terminals and chat data, installs, and restarts.
5. Compare installed hashes and retained session identities. Verify functionality and inspect screenshots of the installed sidebar, panes, folders, and Automations.
6. Publish the verified source and artifact to [Orca Agency](https://github.com/brooksgolden/Orca-Agency). Include the upstream base, test summaries, known limitations, and SHA-256 checksums.

An unavailable credential or external service produces a clear failure receipt and preserves the previous working installation. A blocked run is never reported as a successful release. No announcement is posted. When neither upstream stable nor Agency source has changed, verify the existing release and record that no update is needed.

## Feature contract

| Area          | Preserve through every update                                                                                                                                                                                                                            |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chat identity | Prompted and resumed chats, exact saved-session recovery, manual names, provider icons                                                                                                                                                                   |
| Activity      | Running chats first; opening or resuming does not refresh activity; closed prompted tabs become separate Done chats; tabs closed after this update return to In Progress when resumed; older or explicitly marked Done chats return on their next prompt |
| Sidebar       | Elbows for tabs sharing a pane; brackets for separate panes; 1 folder label per pane; compact rows; collapsible status groups                                                                                                                            |
| Restart       | Idle open tabs retain their identities, nesting, and pane layout                                                                                                                                                                                         |
| Layout        | Drag live, idle, and Done chats; drag blank headers; horizontal and vertical splits, including full-width edges; close empty panes                                                                                                                       |
| Folders       | Directory-based picker, default Uncategorized, configurable default, folder inheritance, change-folder menu, full folder-collapse membership                                                                                                             |
| Files         | Native Copy Path; verified relative file links; file opens stay in their workspace                                                                                                                                                                       |
| Automations   | Background runs remain outside Chats; Windows tasks and Hermes services remain discoverable                                                                                                                                                              |
| Installation  | Verified staging, graceful shutdown, restart, bounded managed backups, terminal and transcript preservation                                                                                                                                              |

Use the existing regression suites for these areas. Six focused packaged journeys and installed verification cover release artifacts. Visual review supplements those tests.

## Versioning and platforms

The current release 1.4.1072 integrates upstream v1.4.246. Six focused packaged journeys and installed verification are complete. The native ARM64 zip is verified, and an older x64 release remains available. There are no new native mobile, macOS, or Linux binaries.

Later binary changes use a new plain semantic version greater than both the previous Agency version and the merged upstream version. Follow upstream major and minor advances, such as 1.5.1000 for a 1.5.x base, and advance the patch when required. Record the upstream stable base separately. Reusing an app version can reuse an older Windows terminal-host runtime, so package metadata must match source and identify new bytes with a new version.

Use each workspace frozen lockfile, including the separate mobile workspace. On Windows, use the toolchain matching the artifact architecture and short test-output paths. Preserve compatibility with existing terminal daemons and remote clients. The ARM64 package omits native speech; external dictation tools remain usable. Slow first history discovery and terminal slowdowns remain known limitations. A completed foreground turn with detached work is displayed as Monitoring without changing whether the chat was explicitly marked Done.

## Workflow configuration

New upstream workflow automatic triggers must not be enabled by merging stable releases. Preserve authorized existing event scopes. All new workflow infrastructure stays manual or reusable only.

All new or revised GitHub copy, including README text, repository descriptions, release notes, and documentation, must be drafted and reviewed with Gemini applying the Content skill (content-principles). Verify every claim against live repository source and packaged artifacts before publishing, preserving human edits, technical caveats, and the distinction between source-only changes and shipped installers. Check any biological or performance statement against credible external evidence. Write clearly for workspace practitioners using plain language, literal headings, and sparse marine cues. This policy governs editorial copy only and introduces no infrastructure or scheduling changes.
