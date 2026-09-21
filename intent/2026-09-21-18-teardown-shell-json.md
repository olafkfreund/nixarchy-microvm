---
status: draft
issue: 18
author: olafkfreund
---

# Intent: capture teardown and live testing leave the bar alone

Closes #18.

## Problem

Two steps in this repo's own procedures make the running shell reload, and
the reload blanks the bar (olafkfreund/nixarchy#847). Only the chevron is
left, every bar IPC target disappears, and the ai-mirror control dialog,
which is drawn by a bar widget, can't appear, so control requests lapse
silently. Both happened on razer on 2026-09-21:

- **`docs/capture.sh --teardown`** restores all four saved files with
  `rm -f` + `cp -a`, including `~/.config/omarchy/shell.json`, even when
  they're byte-identical to what's there. Saving `shell.json` while the
  shell runs triggers the reload. That blanked the bar at 18:18:18.
- **AGENTS.md "Verifying live" step 1** replaces the plugin folder while
  the shell runs. The shell logs `Local plugin changed, reloading` and
  reloads. That blanked the bar at 12:48:01. Step 2 does restart the shell,
  but the reload has already happened, and in practice the restart didn't
  always clear it.

## Proposed outcome

- Teardown writes a saved file back only if it actually changed, so an
  untouched `shell.json` is never rewritten.
- The live-verify procedure installs a copy without a live reload
  blanking the bar, or says exactly how to recover. In either case it
  checks the bar (and its IPC) before asking for control.
- The capture procedure notes that ai-mirror before its #26 fix can't type
  into layer-shell panels, and what to use instead.

## Affected users and systems

`docs/capture.sh`, `AGENTS.md` ("Verifying live" and "Retaking the
captures"). Anyone, human or agent, running either procedure on a nixarchy
desktop. No plugin runtime code.

## Constraints

- Teardown must still restore a file that did change, byte for byte,
  symlink or not (`cp -a`), as today.
- nixarchy#847 itself is nixarchy's to fix; this only stops our procedures
  from triggering it.

## Open questions

1. **Live install:** is it enough to stop the shell, swap the folder, then
   start the shell, so no live reload happens? Or should the procedure use
   a separate plugin id for the test copy? My lean is stop, swap, start: it
   keeps the id and there's no reload window.
