---
status: approved
issue: 21
author: olafkfreund
---

# Intent: the cursor follows the row, not the index

Closes #21.

## Problem

`cursorIndex` (`MicrovmView.qml:41`) is a bare integer index into `rows`,
and `rows` (`:47`) is `Model.filterRows(MicrovmState.rows, filterText)`
over a list that `Model.mergeRows` (`Model.js:413`) keeps sorted by
`compareRows` (`Model.js:404-411`): running first, then failed, then
pending, then by name. A 3 s poll (`MicrovmState.qml:175-180`) refreshes
that list while a surface is open. `onRowsChanged` (`MicrovmView.qml:52`)
only calls `Model.clampCursor` (`Model.js:497`), which bounds the index to
the list length and never tracks *which* row the user had selected. So any
VM changing state re-sorts the list and silently repoints the cursor at a
different machine.

Reproduced under Node:

```
before:    t2/running  p1/stopped  t1/stopped  t3/stopped
cursor 2 → t1        (user presses s to START t1)
after 3s:  t1/running  t2/running  p1/stopped  t3/stopped
cursor 2 → p1        (same key now STOPS the permanent VM p1)
```

`s` (start/stop) and `r` (restart) take no confirmation, so the wrong
machine is acted on with no prompt. `x` (delete) names the VM in its
confirmation, so a careful user can catch it there. The plugin's own create
also inserts a row in name order, which shifts the cursor the same way.

A second defect sits in the same area. `VmList.qml:123`
(`onContainsMouseChanged: if (containsMouse) root.cursorRequested(rowIndex)`)
drives the keyboard cursor from hover. When the poll reorders rows under a
stationary pointer there is no `containsMouse` transition, so nothing
re-sends the cursor while the highlight (`VmList.qml:111`) stays
index-based: the pointer and the cursor then disagree about which row is
selected.

## Proposed outcome

An action always applies to the row the user selected, whatever the list did
underneath. A poll that re-sorts the list, or a create that inserts a row,
moves the highlight with the selected machine instead of leaving it on a
fixed position. If the selected machine leaves the list altogether (deleted,
or filtered out), the cursor lands somewhere predictable rather than on an
arbitrary neighbour.

Under a stationary pointer, the highlighted row and the row the pointer is
over stay the same row after a refresh.

## Affected users and systems

Anyone with a surface open while VMs change state: both the popup and the
full-screen menu, on any host, and only while the 3 s poll is running. The
more VMs there are and the more of them change state, the likelier the
cursor lands somewhere else — and starting a VM is itself a state change, so
the common case is a user acting twice in a row on the list they just
changed.

## Constraints

- Logic goes in `Model.js` with a Node test; QML stays drawing and wiring
  (AGENTS.md).
- The surfaces are keep-loaded, and `open()` resets the view. Whatever the
  cursor holds must survive a poll and be reset by `reset()` like the rest.
- No change to the delete confirmation flow: `x` keeps naming the VM.
- `Model.clampCursor` and the ↓/↑ rules settled in #5 keep their behaviour.

## Open questions

1. Is the hover-cursor coupling (`VmList.qml:123`) part of this issue, or a
   separate one? It is the same wrong-row symptom and the same code path,
   but fixing it touches the mouse path, which #5 explicitly left alone.
