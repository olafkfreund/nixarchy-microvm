---
status: draft
issue: 17
author: olafkfreund
---

# Intent: the site shows creating a VM again

Closes #17.

## Problem

Creating a disposable VM is the first thing a new user does, and the Pages
site no longer shows it. #10 removed `rec-create`, because the old clip ended
on the pre-#762 "started in a terminal" behaviour. The retake from the razer
run couldn't be used either, because it showed #4's false "m: changing the
template needs set-template" hint. #4 is now fixed (#14), but razer still runs
the plugin from before the fix until olafkfreund/nixarchy#844 is merged and
razer is rebuilt.

## Proposed outcome

A short looping `rec-create` (WebM and MP4) on the site: `c`, a name, ↓
into the template list with its notes, Enter, and the new row appearing as
*stopped*. No false hint anywhere in it, and nothing on screen but the
plugin, `demo-*` VMs and the wallpaper.

## Affected users and systems

- `docs/img/rec-create.{webm,mp4}` (new) and `docs/index.md` (one figure).
- razer, for the capture: a test VM created and removed, and
  do-not-disturb and the workspace restored.

## Constraints

- It needs razer on the fixed plugin, which means #844 merged and razer's
  `nixarchy` input bumped and rebuilt. The rebuild needs your go-ahead,
  since it's a system change.
- The `docs/img` budget is 8 MB. It's 4.47 MB now, and a create clip is
  about 1.4 MB for both formats.
- A frame sheet of every second of the clip is looked at before commit.
  #11 showed that a sparse sheet misses short stretches.
- The capture procedure in AGENTS.md "Retaking the captures".

## Open questions

1. Where does it go on the page? Either under "A form for either kind",
   before the permanent recording, or as a second hero beside
   `rec-start`. My lean is the form section, with the hero unchanged.
