---
status: draft
issue: 5
spec: spec/2026-09-21-5-first-down-skips-row.md
---

# Plan: the first ↓ lands on the first row

Approved decision: a pure `Model.stepCursor(active, index, delta, total)`
returns `{ active, index, toFilter }`, and `MicrovmView.moveCursor` calls
it. `setCursor` (mouse) is unchanged.

| state | delta | result |
| --- | --- | --- |
| no rows | any | `toFilter` |
| inactive | +1 | row 0, active |
| inactive | −1 | `toFilter` |
| inactive | 0 | `clampCursor(index)`, active (today's behaviour, used by the filter's ↓ at `MicrovmView.qml:488`) |
| active, row 0 | −1 | `toFilter`, inactive |
| active | ±1 | `clampCursor(index + delta)` |
| active | 0 | `clampCursor(index)` |

(The spec's "0: unchanged" means today's behaviour for `delta 0`; the table
spells out what that is.)

## Steps

1. `tests/model/rows.test.js`: a table test with one case per row above, on
   three rows. → Verify with `node tests/run.js`, where it fails
   (`stepCursor` is undefined).
2. `Model.js`: add `stepCursor` next to `clampCursor`, with a comment on the
   inactive rows. → Verify that the tests pass.
3. `MicrovmView.qml:195–210`: `moveCursor` applies the result. If
   `toFilter`, focus the filter and set `cursorActive = false`; otherwise
   set `cursorActive`, `cursorIndex`, and `cursorFromKeyboard = true`.
   → Verify with `qs log` on razer showing no QML errors.
4. Live on razer, with `demo-a`, `demo-b` and `demo-c`: in the popup, ↓ then
   `y` pastes `demo-a` (compare with `wl-paste`). The same in the menu. `/`
   then ↓ activates `demo-a`. ↑ from `demo-a` returns to the filter. Tear
   down with `nixarchy vm rm`. → Verify with the pastes as listed.
5. Check and ship: `nix flake check`, the fresh-clone validate, a PR with
   "Closes #5". → Verify that CI is green.

## Tests

`node tests/run.js` · `nix flake check` · the step 4 pastes.

## Rollback

Revert the PR. The only effect is the old off-by-one.
