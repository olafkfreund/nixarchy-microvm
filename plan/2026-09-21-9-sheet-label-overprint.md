---
status: draft
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

## Tests

`node tests/run.js` · `nix flake check` · the stills in step 4.

## Rollback

Revert the PR.
