---
status: draft
issue: 3
author: olafkfreund
---

# Intent: Showcase the plugin with captures from a full verified run

## Problem

The captures in `docs/img` are seven files from the first release: five
stills and one create recording. They show neither a VM actually running
(build log, console), the mutation lock, deleting, editing a permanent VM, nor
AI assist end to end. The README and the Pages site can only show what those
files show. The nixarchy Pages site mentions the plugin in
`docs/manual/sandboxes.md` and `docs/manual/plugins.md` but shows none of it.

A full keyboard-driven run on razer (2026-09-21, 1920×1080, plugin at
`481e6c5`) produced new captures of every flow and verified each one. The run
also found six bugs, listed below. They are out of scope here, but the
captures must not show a bug as if it were intended behaviour.

## Test results (razer, 2026-09-21)

| # | Flow | Result |
| - | ---- | ------ |
| 1 | Popup, empty state | pass |
| 2 | List, badges, `?` sheet (scrolls), `/` filter | pass; bug F |
| 3 | `c` create disposable (`demo-new`, node) | pass |
| 4 | `s` start with the build log in the panel; running dot; accent glyph; `s` stop | pass |
| 5 | `e` console (guest prompt, Ctrl-] detaches, VM keeps running); `y` copy; `m` set-template | pass; bugs A, B |
| 6 | One mutation at a time: second `s` refused, "Busy: run demo-python" | pass |
| 7 | `x` delete: Cancel is the default; Delete removes the VM and its state dir | pass |
| 8 | Menu by IPC, by `{"create":true}`, and by SUPER+ALT+V | pass |
| 9 | Permanent `p1`: form → review → write → *pending apply*; `m` edit (opt replace); `x` remove | pass after a workaround; bug C |
| 10 | AI assist: describe → form filled (permanent, python, 4096, 2 cores, autostart) → review | pass after `claude` re-login; bugs D, E |
| 11 | Teardown: demo VMs gone, `apps.nix` and `services.nix` byte-identical to the snapshot, DND and workspace restored | pass |

Bugs found, to be filed as their own issues:

- **A.** `Model.hiddenReason` (`Model.js:1210`) says `m` needs set-template
  even when set-template is detected, so every stopped disposable row carries
  a false hint.
- **B.** The first ↓ after a surface opens skips the first row: `reset()` sets
  `cursorIndex = 0`, and `moveCursor(+1)` makes it 1. In the test this sent
  `s` to the wrong VM.
- **C.** Permanent create fails at the very last step when the user's
  `services.nix` predates the `#@ microvm` row ("no service 'microvm'"). The
  form and review give no warning.
- **D.** Agent errors are never shown: `CreateForm.start()` assigns
  `agentError = ""`, which breaks the binding to `MicrovmState.agentError`.
- **E.** The agent error text comes from stderr, but `claude -p
  --output-format json` reports failures in stdout (`is_error`, `result`), for
  example an expired login.
- **F.** In the `?` sheet, the key label "tab ↓ / shift+tab ↑" prints over its
  description.

## Proposed outcome

- This repo's README and Pages site show the new captures, one per flow: the
  popup, running a VM with its build log, the console, the lock, delete, the
  menu, the permanent form and review, and AI assist. There are short looping
  videos (WebM and MP4) for create, start, permanent and assist.
- The nixarchy Pages site has a short showcase of the plugin that links to
  this repo's site, using the same files.
- The outdated sentence in `docs/usage.md` is fixed. It says Enter opens
  `nixarchy vm run` today, but on a nixarchy with `run --detach`, `s` starts
  the VM with the log in the panel.

## Affected users and systems

- This repo: `README.md`, `docs/index.md`, `docs/usage.md`, `docs/img/`.
- nixarchy repo: `docs/manual/sandboxes.md` or `plugins.md`, and its image
  folder.
- Readers of both sites. No runtime code changes.

## Constraints

- `docs/img/` must stay under 8 MB, and CI enforces it. The candidate set is
  about 6.1 MB.
- Real captures only, showing nothing but the plugin, `demo-*` VMs, `p1` and
  the wallpaper. No SSH public key or key filename appears in any capture.
  The permanent recording was retaken without the key picker for that reason.
- Every still and every video frame sheet has been looked at.
- No symlinks. No hardcoded colours in the pages.
- The nixarchy repo has its own workflow and is on another branch
  (`docs/836-nested-claude-md`). Its change goes through that repo's process.

## Open questions

1. nixarchy's site: copy the media into that repo, or link or embed them from
   this repo's Pages? Copying is self-contained but duplicates about 2 MB.
2. nixarchy's side needs its own issue and artifacts there. Should I open
   them after this intent is approved?
3. Bugs A–F: file six issues now, or first fix B and D, which change what the
   captures show?
4. The `create` recording shows bug A's false hint in its first and last
   seconds. Keep it as it is, or retake after fixing A?
