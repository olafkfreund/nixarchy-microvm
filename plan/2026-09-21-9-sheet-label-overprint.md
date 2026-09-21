---
status: approved
issue: 9
spec: spec/2026-09-21-9-sheet-label-overprint.md
---

# Plan: the ? sheet's labels don't overlap

Approved decisions: `Model.SHORTCUTS` splits `tab ↓ / shift+tab ↑` into two
entries, `tab  ↓` "Next field" and `shift+tab  ↑` "Previous field".
`ShortcutSheet.qml`'s key `Text` elides. A test caps every `keys` label at
12 characters. The README table is unchanged.

## Steps

1. `tests/model/form.test.js`: every `Model.SHORTCUTS[i].keys.length <= 12`,
   and both new entries are present. → Verify that the test fails on the
   old entry (21 characters).
2. `Model.js:56`: the two entries. → Verify that the test passes.
3. `ShortcutSheet.qml` `entryKeys`: add `elide: Text.ElideRight`.
   → Verify with `qs log` clean on razer.
4. Live on razer: `?` in the popup and in the menu, scrolled to Form, with
   every row readable. → Verify with two stills.
5. Check and ship: `nix flake check`, the fresh-clone validate, a PR with
   "Closes #9". → Verify that CI is green.

*Live result (razer, 2026-09-21):* pass. The Form group reads "tab ↓ · Next field" and "shift+tab ↑ · Previous field", with no overlap in the 456 px popup or in the menu. The check ran on one test
build that merged every fix branch, installed as a copy per AGENTS.md, so
one control grant covered #4–#9. Razer was restored afterwards: its plugin
link, no demo VMs, do-not-disturb off, and `apps.nix`/`services.nix`
byte-identical.

## Tests

`node tests/run.js` · `nix flake check` · the stills in step 4.

## Rollback

Revert the PR.
