---
status: draft
issue: 21
intent: intent/2026-09-24-21-cursor-identity.md
---

# Spec: the cursor is a row key, the index is a cache

## Design

**The key is the source of truth.** `MicrovmView.qml` gains
`property string cursorKey: ""` beside `cursorIndex` (`MicrovmView.qml:41`).
`cursorKey` names the machine; `cursorIndex` stays, but only as a cache of
where that machine currently sits in `rows` (`:47`). Everything that changes
the selection sets both, and `rowsChanged` recomputes both from the key.

The index survives because two consumers need a number and nothing else:
`ListView.currentIndex` (`VmList.qml:81`), which drives `positionViewAtIndex`
for keyboard scrolling, and the highlight
`hasCursor: root.cursorActive && rowIndex === root.cursorIndex`
(`VmList.qml:111`). Deriving that index inside `VmList` from a key would be a
linear scan per delegate per frame; keeping it in the view costs one scan per
poll. The highlight is unchanged.

`cursorRow` (`MicrovmView.qml:48`) becomes `Model.rowByKey(rows, cursorKey)` —
the function exists (`Model.js:423`) and is already how `dispatch` (`:139`)
re-resolves a row before acting. It returns `null` when the key is absent,
which is the guard `keyAtCursor` (`:155`), `hintText` (`:235`) and
`onDeleteRequested` (`:272`) already apply. Nothing downstream changes.

**The resolver**, one pure function in `Model.js` beside `clampCursor`:

```js
// Where the cursor sits after the list changed underneath it: on the row it
// was on, wherever that moved to; or, if that row is gone, on whatever now
// holds the position it held.
function resolveCursor(rows, key, index)  // -> { key: String, index: Number }
```

`rows` is the filtered list the view draws. Empty list → `{ key: "", index: 0 }`.
`key` found → `{ key: key, index: <its index> }`. `key` empty or gone →
`i = clampCursor(index, rows.length)`, result `{ key: rows[i].key, index: i }`.
`clampCursor` (`Model.js:497`) keeps its behaviour and its callers:
`resolveCursor` uses it, and `stepCursor` (`:507`) still calls it, so the ↓/↑
rules settled in #5 are untouched.

**Call sites.** `onRowsChanged` (`:52`) stops calling `clampCursor` and assigns
both fields from `resolveCursor(rows, cursorKey, cursorIndex)`. `moveCursor`
(`:202`) and `setCursor` (`:214`) keep computing an index and additionally set
`cursorKey` from `rows[index].key`. The filter field's `onTextChanged` (`:482`)
clears `cursorKey` as well as setting `cursorIndex = 0`.

**The departed-row rule: the position, clamped.** When the selected machine
leaves the list the cursor stays where it is on screen and the row that slid up
into that slot becomes selected. Delete the third row and the highlight stays
on the third slot, now holding what was fourth — how every list and text editor
behaves. At the end of the list the clamp pulls it up one. Nothing unsafe
follows from it: a row is gone only after a delete the user confirmed by name,
or after a filter change, which clears the key anyway.

**Hover is in scope, and also keyed.** `signal cursorRequested(int index)`
(`VmList.qml:33`) becomes `cursorRequested(string key)`, and `VmList.qml:123`
sends `rowSurface.row.key`; `setCursor` takes a key and finds its index. It
belongs here: same symptom, same property, and leaving the mouse path on
indices means one input writes a position while the other writes an identity —
half a fix by construction, and a longer paragraph to justify than to do.

**reset() and keep-loaded.** `reset()` (`:59`) clears `cursorKey` next to
`cursorIndex = 0` and `cursorActive = false`, so every `open()` lands
unanchored on the first row as today. The stream and the log stay untouched.

## Alternatives rejected

**Keep the index, re-resolve it on `rowsChanged`.** Nearly the chosen design,
differing only in which field the rest of the file reads. Rejected because
`cursorRow` (`:48`) would still be `rows[cursorIndex]`: correct only as long as
the last resolution holds, and silently wrong for any read between a `rows`
change and the handler running — which is the shape of the bug being fixed.
Through `rowByKey`, a stale index cannot produce a wrong row at all; its worst
failure is a highlight one row off for a frame.

**Sort stably, or freeze the order while a surface is open.** Tempting: no
reorder, no bug, no new function. Wrong on both counts. It is not a fix —
`mergeRows` (`Model.js:413`) is not the only thing that moves a row; a create
inserts in name order and a delete removes, both while a surface is open, both
shifting every index below, and the intent names the create case. And it costs
the feature the sort exists for: running first, failed next (`compareRows`,
`Model.js:404-411`), the reason the list reads at a glance. A user would start
a VM and watch it stay filed under "stopped" until the surface was reopened. A
frozen order also has to thaw somewhere, and every thaw point is this same bug
with a longer fuse.

**Resolve in QML, as a binding on `cursorIndex`.** It cannot be a binding: the
departed-row rule needs the *previous* index, so the property would derive
itself from its own old value. It would also be untestable under Node, against
AGENTS.md's "Logic goes in `Model.js`, with a Node test".

## Risks

- **A stale `cursorKey`.** A key not in `rows` makes `cursorRow` `null`, and
  every guarded handler (`:155`, `:235`, `:272`) becomes a no-op. The failure
  is a dead key press, not a wrong machine, and `resolveCursor` keeps it from
  outliving one `rowsChanged`.
- **The filter.** `rows` (`:47`) is filtered, so the key must resolve against
  it and never against `MicrovmState.allRows` — that would index the wrong
  array and highlight a row the user cannot see. `onTextChanged` (`:482`)
  clearing the key is what stops a narrowing filter stranding the cursor.
- **`reconcilePlan`'s ListModel sync.** `VmList.sync()` applies
  remove/move/insert (`Model.js:510-540`) from the same `root.rows` change, but
  in an independent handler; a frame where `currentIndex` (`VmList.qml:81`)
  points into the pre-sync model shows the highlight briefly on the wrong row.
  It cannot fire an action: actions go through the keyed `cursorRow`.
- **Hover after a reorder.** The keyed signal fixes the pointer/cursor
  disagreement only as far as Qt re-delivers hover when a delegate moves under
  a stationary pointer. If it does not, the highlight stays on the machine the
  pointer *was* over until the pointer moves a pixel — today's behaviour, not a
  regression, and hover never dispatches an action.
- **The delete path is unaffected.** `askRemove` (`:176-195`) already captures
  `row.key` and re-resolves with `Model.rowByKey(MicrovmState.allRows, key)`
  inside the confirmation closure, so it already names and acts on the row the
  user saw. It now receives a keyed `cursorRow`, which can only be more
  correct. No change to the flow, per the intent's constraint.
- **Keep-loaded reset.** Forgetting `cursorKey` in `reset()` (`:59`) would
  carry a selection into the next open and, with the filter cleared,
  pre-select a machine silently.

## Verification

New cases in `tests/model/rows.test.js`, in the existing `test`/`eq`/`ok`
style:

- `resolveCursor follows the row when the list re-sorts` — the intent's
  reproduction as a regression test: rows ordered `t2/running, p1, t1, t3`,
  `index 2` / `key "disposable:t1"`; re-sort with `t1` running and assert
  `{ key: "disposable:t1", index: 0 }`, not `p1`. This is the case that makes
  `s` act on the wrong machine today.
- `resolveCursor keeps the position when the row is gone` — drop the row at
  index 2, assert index 2 and the key of the row that slid up; drop the last
  row, assert the clamp gives `rows.length - 1`.
- `resolveCursor on an empty list` — `{ key: "", index: 0 }`.
- `resolveCursor with no key falls back to the index` — `key: ""`, `index: 1`
  gives `rows[1].key`, which is what `reset()` and the filter rely on.
- The existing `clampCursor` and `stepCursor` tests (`:71`, `:119`) stay as
  they are, proving the #5 ↓/↑ rules survive.

`node tests/run.js` proves the rule and that nothing else in `Model.js` moved.
`nix flake check` runs those plus the repo checks (manifest, entry points, no
symlinks, no hex colours), proving the QML edits did not break the package.

Live, per AGENTS.md "Verifying live": `nix build`, install with the shell
stopped, wait for `omarchy-shell shell ping`, confirm the bar is healthy
(`qs log -i <instance> | grep -c pluginBarApiFor` is 0). With disposable `t1`,
`t2`, `t3`:

1. Open the menu, put the cursor on a stopped VM that is not first in the sort,
   and let two polls pass with another VM changing state. The highlight must
   still be on the same name — the bug, observed rather than simulated.
2. Press `s` there and watch the row travel to the top with the highlight; a
   second `s` must stop the same VM.
3. Park the pointer on a row, let a poll reorder the list, and check the
   highlighted row is the row under the pointer.
4. Press `x`: the dialog still names that VM, and afterwards the highlight sits
   on the row that took its place.
5. Close and reopen: cursor inactive, filter empty — `reset()` cleared the key
   on a keep-loaded surface.

Tear down with `nixarchy vm rm t1 t2 t3`.
