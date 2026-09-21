---
status: approved
issue: 5
intent: intent/2026-09-21-5-first-down-skips-row.md
---

# Spec: the first ↓ lands on the first row

## Design

A new pure function in `Model.js`:

```js
// Where the cursor goes on ↓/↑. With no active cursor, ↓ activates the first
// row; ↑ from the first row (or with none) leaves for the filter.
function stepCursor(active, index, delta, total) -> { active, index, toFilter }
```

| state | delta | result |
| --- | --- | --- |
| no rows | any | `toFilter` |
| inactive | +1 | row 0, active |
| inactive | −1 | `toFilter` |
| active, row 0 | −1 | `toFilter`, inactive |
| active | ±1 | `clampCursor(index + delta)` |
| any | 0 | unchanged (`:488` re-clamps with 0) |

`MicrovmView.moveCursor` (`:195–210`) becomes a call to it, which sets
`cursorActive`, `cursorIndex` and `cursorFromKeyboard`, or focuses the
filter. The filter's own ↓ (`:264`) goes through the same function, so
walking out of the filter lands on row 0 too. `setCursor` (mouse) is
unchanged.

## Alternatives rejected

- **`reset()` setting `cursorIndex = -1`.** It spreads a sentinel that
  `clampCursor`, the hint and the highlight would each have to handle.

## Risks

It changes what ↓ does in both surfaces. That is the point, and there is
nothing else to break: row keys already act on `cursorRow`.

## Verification

- A table test in `tests/model/rows.test.js` covering every row above.
- Live on razer, with three VMs: open the popup, ↓ then `y`, and `wl-paste`
  gives the first row's name. Do the same in the menu, and from `/` then ↓.
