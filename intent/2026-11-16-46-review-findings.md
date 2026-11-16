---
status: draft
issue: 46
author: olafkfreund
---

# Intent: twelve bugs from the 1.0.0 reviews

Closes #46.

## Problem

Codex (gpt-6.1-sol), agy (model not reported) and Fable each reviewed 1.0.0
read-only and independently. Twelve of their findings hold up against the
code. Three were reproduced in Node against `Model.js` on `main` at `27e5992`:
B1 (by Codex), B3 (by Codex) and B10 (here).

The twelve are not equally serious. Grouped by what the user sees:

**Something the user asked for silently does nothing, or is lost.**

- **B1.** Editing a VM whose existing name does not meet the *create* rule
  does nothing on Enter. `validateForm` checks `isVmName` even when
  `editing` is true (`Model.js:945`). A managed permanent line only needs
  `isNixAttrName` (`Model.js:194`), which allows `Old_VM`, so such a VM is
  offered for editing but can never be submitted. The name field is hidden
  in an edit, so `submit()` returns with no message (`CreateForm.qml:170`).
  A disposable VM whose reported name starts with a digit (`isReportedName`,
  `Model.js:180`) hits the same wall.
- **B3.** If a machine has no loaded unit (for instance an applied machine
  with autostart off) and its line is deleted, it leaves no row. `listActions` derives Apply from the row counts (`Model.js:1403`),
  so `a` disappears while a change is still queued. Reproduced: a pending
  removal on its own gives `rows: []`, `apply: false`.
- **B10.** A `~/.ssh/*.pub` without a trailing newline swallows the key
  that `find` lists after it. `sshKeysArgv` prints `name\t` and then `cat`s
  the file, with no separator in between (`Model.js:1636`). The next file's
  name therefore lands on the same line. Reproduced: two valid keys, the first
  without a comment or newline, parse to `[]`. With a comment, the first key
  survives and the second is lost. The last file is unaffected.

**The list misreports state.**

- **B2.** One failed `nixarchy-vm list` (any non-zero exit) clears every
  disposable row and sets `reachable = false` (`MicrovmState.qml:493`). The
  summary then says nixarchy-vm is not found (`Model.js:664`). Units and
  pending keep their last value and are marked stale. Only the list does not.
- **B4.** After `x` on a permanent VM, its line is gone but its unit
  remains. The row is rebuilt as `ownership: "flake"` (`Model.js:421`), and
  its hint says "edit it there" (`Model.js:1431`), which is wrong.
- **B6.** A row combines the SSH port and key from `apps.nix` with the
  running unit (`Model.js:411`, `425`). A port or key that has changed but is
  not applied yet is used by the console (`MicrovmState.qml:361`), which then
  points at a port nothing listens on or offers a key the guest does not
  know.
- **B12.** While a build streams, the footer shows a bare "working…"
  instead of the key legend (`MicrovmView.qml:778`).

**Validation lets a broken machine through.**

- **B5.** Two VMs can be given the same host SSH port, and one VM can mount
  two shares at the same guest path. `isPort` (`Model.js:958`) checks only the
  range, although `validateForm` already holds every row with its port.
  `parseShares` (`Model.js:849`) accepts duplicate guest paths. The line is
  written; how and when the guest then fails was not verified.

**Concurrency and lifecycle.**

- **B8.** The fallback for nixarchy older than #762 starts a VM in a
  detached terminal that no lock tracks (`MicrovmState.qml:365`). While it
  builds, a second start or a delete is accepted. This breaks the rule that
  only one mutation runs at a time.
- **B9.** Closing one surface calls `resetAgent()` (`MicrovmView.qml:206`).
  The agent state is shared, so that kills an agent call the other surface
  started. `openForm` and `openEdit` (`MicrovmView.qml:150`, `159`) reset it
  too, and a reply is applied to every surface that is in form mode
  (`MicrovmView.qml:499`).
- **B11.** `optProbe` is started from `pkgFile.onLoaded` without checking
  whether it is already running (`MicrovmState.qml:581`). Every other probe
  checks (`MicrovmState.qml:96`). Setting `command` on a running `Process`
  drops the call.

**Display.**

- **B7.** The permanent review has no width limit and no scroll
  (`MicrovmView.qml:463`, `527`). Long shares or a long key are cut off,
  yet Enter still writes the line. The user confirms text they could not
  see.

**Cleanup** that touches the same lines, so it goes in the same change:

- `VmList.qml:214` rebuilds the ownership part of `Model.subtitleText`
  (the kind part is already a badge).
- `pendingKey.split(":")[1]` appears four times.
- `keysMatching` (`CreateForm.qml:84`) is logic with no test.
- Unused code: `reviewCommandLines(…, optPath)`, `probed`, and the
  unreachable `continue` at `Model.js:1596`.

## Proposed outcome

- An edit of an existing VM is never refused over its own name, and when
  Enter is refused the user sees why.
- `a` is offered whenever `apps.nix` has a change waiting, including a
  removal.
- Every `.pub` key in `~/.ssh` is offered, whether or not the file ends in
  a newline.
- A failed list keeps the last rows, marks them stale, and shows the real
  error instead of "not found".
- A removed permanent VM reads "removed, pending apply", not "declared in
  your flake".
- The console never connects with a port or key that is not applied yet,
  and the footer says why.
- Two VMs cannot share an SSH port. One VM cannot mount two shares at the
  same guest path.
- The review shows the whole line, scrolling when it has to.
- With a nixarchy older than #762, one change at a time still holds.
- Closing one surface never cancels the other's agent call.
- `optProbe` is never started while it is already running (B11).
- While a build streams, the footer keeps the key legend (B12).
- None of this loosens validation: an edit is refused only for a value the
  user can see and fix, and only key types `normalizeSshKey` already accepts
  are offered.
- Each fix to `Model.js` has a Node test that fails on `main` and passes
  after the fix.

## Affected users and systems

- Everyone running the plugin on nixarchy.
- B8 matters only on nixarchy from before #762.
- The files: `Model.js`, `MicrovmState.qml`, `MicrovmView.qml`,
  `CreateForm.qml`, `VmList.qml`, and `tests/`.
- No change to `apps.nix` format, the snippet grammar or any upstream tool.

## Constraints

- All AGENTS.md rules hold:
  - argv only;
  - logic in `Model.js` with a Node test;
  - no hardcoded colours;
  - one `singleton MicrovmState`;
  - every permanent write goes through nixarchy.pkg;
  - features detected, not assumed.
- The snippet grammar does not change. `parse(emit(f)) == f` keeps
  passing.
- Retiring the compatibility branches (roadmap item S5) is **not** part of
  this task. B8 and B11 are fixed in place, not by deleting the fallback.
- No new keys and no new settings. Every user-visible change updates the
  README and `docs/usage.md` in the same PR (AGENTS.md rule).
- `nix flake check` passes, and the live check from AGENTS.md "Verifying
  live" passes on this host with test VMs `t1` and `t2`. `nixarchy-apply`
  is not run.

## Open questions

1. **B8:** should the terminal start hold the lock until the next poll sees
   the VM running, or should AGENTS.md and the README narrow the promise to
   "on nixarchy with #762"? The first keeps the promise, but needs a way out
   when the build fails or the terminal is closed, or the lock never clears.
   The second is smaller and changes a written rule.
2. **B6:** while a machine's change is pending, should the console be
   hidden (with a reason in the footer)? `row.pending` flags any edit, not
   only SSH, so this would hide it for a memory change too. The alternative,
   reading the applied port, needs the unit or `/var/lib/microvms`, which
   AGENTS.md forbids. Both reviewers favour hiding.
3. Should these twelve be one PR, or split, with the validation fixes
   (B1, B5, B10) going first?
