---
status: approved
issue: 21
spec: spec/2026-09-24-21-cursor-identity.md
---

# Plan: the cursor is a row key, the index is a cache

The cursor stops being a position and becomes an identity. `MicrovmView.qml`
gains `property string cursorKey: ""` beside `cursorIndex` (`MicrovmView.qml:41`).
**`cursorKey` is the source of truth; `cursorIndex` becomes a recomputed cache**
of where that machine sits in `rows` (`:47`), because two consumers need a
number: `ListView.currentIndex` (`VmList.qml:81`) and the highlight
`hasCursor: root.cursorActive && rowIndex === root.cursorIndex` (`VmList.qml:111`).
The highlight itself is unchanged.

`cursorRow` (`:48`) stops being `rows[cursorIndex]` and becomes
`Model.rowByKey(rows, cursorKey)` — `rowByKey` exists (`Model.js:423`) and is
already how `dispatch` (`:140`) re-resolves. It returns `null` when the key is
gone, the guard `keyAtCursor` (`:154`), `hintText` (`:234`) and
`onDeleteRequested` (`:272`) already apply. Nothing downstream changes.

One new pure function, `Model.resolveCursor(rows, key, index) -> { key, index }`,
lives beside `clampCursor`. **The departed-row rule is the position, clamped:**
if the key is still in `rows` the cursor follows it wherever it moved; if the
key is gone or empty the cursor keeps its position —
`i = clampCursor(index, rows.length)` — so the row that slides up into the slot
gets the highlight, and at the end of the list the clamp pulls it up one.
`clampCursor` (`Model.js:497`) keeps its behaviour and its `stepCursor` caller
(`:507`), so the ↓/↑ rules settled in #5 are untouched.

**The hover coupling is in scope.** `signal cursorRequested(int index)`
(`VmList.qml:33`) becomes `cursorRequested(string key)`, `VmList.qml:123` sends
`rowSurface.row.key`, and `setCursor` takes a key. Leaving the mouse path on
indices would mean one input writes a position while the other writes an
identity. **A key that is not in `rows` is a no-op** — `setCursor` leaves
`cursorKey` and `cursorIndex` untouched and returns, rather than clearing the
selection or falling back to index 0. This is settled in the approved spec, not
a call this plan makes: `setCursor` is a public interaction boundary, hover
normally supplies a visible key but IPC and a mid-poll delegate can supply a
stale one, and losing the user's selection to a stale hover would reintroduce
the bug in a new form. **`reset()` (`:59`) clears `cursorKey`** alongside
`cursorIndex = 0` and `cursorActive = false`, so a keep-loaded surface carries
no selection into the next `open()`.

**What is guaranteed, and what is not.** The approved spec narrows the intent's
wording deliberately, and this plan is built to that narrower promise:

- *Acting* on the right row is **absolute**. Every action resolves through the
  keyed `cursorRow`, so no reorder, insert or delete can make a key press hit a
  machine other than the one the key names. There is no case where this fails.
- *Drawing* the right row is **steady state**. Two cases are accepted rather
  than closed:
  1. **The one frame after a `rows` change.** `VmList.sync()` applies
     `reconcilePlan`'s remove/move/insert (`Model.js:510-540`) from the same
     `rows` change but in an independent handler, so for one frame
     `currentIndex` (`VmList.qml:81`) can point into the pre-sync model and the
     highlight shows on the wrong row. Closing it would mean `MicrovmView`
     driving `VmList`'s model mutation — coupling the two across the surface
     boundary for a cosmetic artefact that cannot dispatch an action.
  2. **A stationary pointer after a reorder.** The keyed hover signal fixes the
     pointer/cursor disagreement only as far as Qt re-delivers hover when a
     delegate moves under a pointer that has not moved. If it does not, the
     highlight stays on the machine the pointer *was* over until the pointer
     moves a pixel. That is today's behaviour, not a regression, and hover
     never dispatches an action.

  Tests below verify the acting guarantee unconditionally and do not assert the
  drawing guarantee in either excluded case.

## Steps

One commit per step, each citing the step.

1. **`Model.js`: add `resolveCursor`, with its tests in the same commit.**
   Tests ship *with* the function, not before it, so the tree passes at every
   commit. Insert `function resolveCursor(rows, key, index)` after
   `clampCursor` (`Model.js:497`), above `stepCursor` (`:507`). Returns
   `{ key: String, index: Number }`: empty or absent `rows` →
   `{ key: "", index: 0 }`; `key` found (first match, the scan `rowByKey` does)
   → `{ key: key, index: <that index> }`; `key` empty or not present →
   `i = clampCursor(index, rows.length)`, `{ key: rows[i].key, index: i }`. It
   calls `clampCursor`; it does not change it. No export list to update —
   `tests/harness.js:20` loads the whole file into a `vm` sandbox. Add the five
   cases under **Tests** to `tests/model/rows.test.js` beside the `clampCursor`
   case (`:71`), in the existing `test`/`eq`/`ok` style.
   → verify by `node tests/run.js` → `75 passed, 0 failed`.

2. **`MicrovmView.qml`: the key becomes the source of truth.** Add
   `property string cursorKey: ""` after `:41`. Rewrite `cursorRow` (`:48`) as
   `Model.rowByKey(rows, cursorKey)`. Replace `onRowsChanged` (`:52`): instead
   of `clampCursor`, call
   `var c = Model.resolveCursor(rows, root.cursorKey, root.cursorIndex)` and
   assign both `root.cursorKey = c.key` and `root.cursorIndex = c.index`. In
   `moveCursor` (`:202`) keep `stepCursor` exactly as it is and, on the
   non-`toFilter` path, also set `cursorKey = rows[next.index].key`. In
   `reset()` (`:59`) add `cursorKey = ""` beside `cursorIndex = 0` (`:62`). In
   the filter field's `onTextChanged` (`:482`) add `root.cursorKey = ""` beside
   `root.cursorIndex = 0` (`:484`). Leave `VmList`'s bindings (`:504-505`)
   alone — they stay index-based.
   → verify by `grep -n 'rows\[cursorIndex\]\|clampCursor' MicrovmView.qml`
   returning nothing, then `nix flake check`.

3. **`VmList.qml` + `MicrovmView.qml`: hover sends a key.** `VmList.qml:33`
   becomes `signal cursorRequested(string key)`; `:123` becomes
   `root.cursorRequested(rowSurface.row.key)`. `setCursor` (`MicrovmView.qml:214`)
   becomes `setCursor(key)`: scan `rows` for the key and, **if it is not there,
   return without touching `cursorKey`, `cursorIndex`, `cursorActive` or
   `cursorFromKeyboard`** — the no-op settled in the spec. Otherwise set
   `cursorActive = true`, `cursorFromKeyboard = false`, `cursorKey = key`,
   `cursorIndex = <found>`. Update the handler that wires the signal,
   `onCursorRequested` at `MicrovmView.qml:511`, to pass the key through:
   `function(key) { root.setCursor(key) }`.
   → verify by `grep -n cursorRequested VmList.qml MicrovmView.qml` showing
   `string key` at every site, then `nix flake check`.

4. **`docs/usage.md` + `README.md`: one line each.** The behaviour *is*
   user-visible: the highlight now travels with the machine instead of staying
   on a slot, and the departed-row rule is what a user sees after `x`. Add one
   sentence above the README's key table (`README.md:63-66`) and to the
   keyboard prose in `docs/usage.md`. No binding changes, so `Model.SHORTCUTS`
   and `ShortcutSheet.qml` are untouched and get no step.
   → verify by `nix flake check` and reading the two diffs.

## Tests

Five new cases in `tests/model/rows.test.js`. All five exercise
`resolveCursor`, which is the acting guarantee: what `cursorRow` resolves to is
what a key press acts on.

- `resolveCursor follows the row when the list re-sorts` — the intent's
  reproduction as a regression test. Rows
  `[t2/running, p1/stopped, t1/stopped, t3/stopped]`, cursor `index 2`,
  `key "disposable:t1"`. Re-sort with `t1` running and assert
  `{ key: "disposable:t1", index: 0 }` — **not** `p1`, which now holds index 2
  and is what `s` acts on today.
- `resolveCursor keeps the position when the row is gone` — drop index 2 of a
  four-row list: assert `index: 2` and the key of the row that slid up. Drop
  the last row with the cursor on it: assert `rows.length - 1` and that row's
  key.
- `resolveCursor on an empty list` — `resolveCursor([], "disposable:t1", 3)`
  and `resolveCursor(null, "", 0)` both give `{ key: "", index: 0 }`. This is
  the filter narrowed to zero rows.
- `resolveCursor with no key falls back to the index` — `key: ""`, `index: 1`
  gives `rows[1].key`; `index: 99` gives the last row. What `reset()` and a
  cleared filter rely on.
- `resolveCursor takes the first row with the key` — two rows sharing a key.
  Not reachable through `rowKey` (`Model.js:328`), which is `kind:name` and
  unique per list; the case pins first-match semantics anyway.

The existing `clampCursor` (`:71`) and `stepCursor` (`:119`) cases stay
untouched, proving the #5 rules survive. `node tests/run.js` →
`75 passed, 0 failed` (70 today). `nix flake check` runs those plus the
manifest, entry-point, no-symlink and no-hex-colour checks, proving the QML
edits did not break the package.

Live, per AGENTS.md "Verifying live": `nix build`, install with the shell
stopped, wait for `omarchy-shell shell ping`, confirm the bar is healthy
(`qs log -i <instance> | grep -c pluginBarApiFor` is 0). Disposable `t1`, `t2`,
`t3` and the host's own permanent machine — **never run `nixarchy-apply`**.
Checks 1, 2 and 4 are the acting guarantee and must pass outright. Check 3 is
the drawing guarantee in steady state and is read after the list has settled,
not during the frame a poll lands; check 5 is state, not drawing:

1. Put the cursor on a stopped VM that is not first in the sort and let two
   polls pass while another VM changes state. The highlight stays on the name.
2. Press `s`: the row travels to the top carrying the highlight, and a second
   `s` stops the same VM — the same machine both times, which is the whole
   point of the fix.
3. Park the pointer on a row, let a poll reorder the list, **move the pointer
   one pixel**, and check the highlighted row is the row under the pointer.
   Moving the pointer is what makes this a fair check: without it the test is
   the stationary-pointer case the spec excludes, where Qt may not re-deliver
   hover and the highlight legitimately lags. A single wrong frame as the list
   re-sorts is also out of scope and not a failure.
4. Press `x`: the dialog still names that VM, and afterwards the highlight
   sits on the row that took its place.
5. Close and reopen: cursor inactive, filter empty.

Tear down with `nixarchy vm rm t1 t2 t3`.

## Rollback

One branch, `fix/21-cursor-identity`, four commits of pure view logic.
`git revert` the range, or `git checkout main -- Model.js MicrovmView.qml
VmList.qml tests/model/rows.test.js docs/usage.md README.md`.

No step writes a file, a unit, `apps.nix` or disposable state, so nothing is
left behind: the only artifacts outside the repo are the plugin folder copied
to `~/.config/omarchy/plugins/nixarchy.microvm` for the live check — replaced
by the same stop-swap-start — and any `t1`/`t2`/`t3` from it.

After reverting: `node tests/run.js` → `70 passed, 0 failed`, `nix flake check`
green, and the bar healthy after a shell restart. The bug returns, unchanged.
