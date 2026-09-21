---
status: approved
issue: 5
author: olafkfreund
---

# Intent: the first ↓ lands on the first row

Closes #5.

## Problem

After the popup or the menu opens, the first ↓ puts the cursor on the second
row. `reset()` sets `cursorActive = false` and `cursorIndex = 0`, then
`moveCursor(+1)` clamps `0 + 1`. On razer this sent `y` and then `s` to
demo-new instead of demo-shell, so a VM started that nobody meant to start.
The row keys act on whatever the cursor is on, so this is a wrong-target
bug, not a cosmetic one.

## Proposed outcome

With no active cursor, ↓ activates the first row and ↑ goes to the filter,
as today. After that, ↓ and ↑ move one row. The same holds after
`/`-filtering and leaving the filter with ↓.

## Affected users and systems

`MicrovmView.qml` (`moveCursor`, `:195`), and `Model.js` if the rule moves
there with a test. Both surfaces.

## Constraints

Logic in `Model.js` with a Node test where possible. Mouse `setCursor` is
unchanged.

## Open questions

None.
