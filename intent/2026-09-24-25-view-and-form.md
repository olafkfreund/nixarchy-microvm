---
status: draft
issue: 25
author: olafkfreund
---

# Intent: the view keeps the user's focus, input and truth

Closes #25.

## Problem

The interaction layer assumes the user's focus, cursor and form state are still
where the user put them, and acts without checking. Nothing re-reads where the
keyboard actually is before it blocks keys, nothing asks whether a mutation can
run before it throws the form away, and nothing checks that what it draws still
fits or is still complete. Nine places pay for that. Three of them cost the user
their typed input, hide what is about to be written to their config, or take the
keyboard away entirely. Ranked, worst first.

**1. A confirmation opened while the filter has focus cannot be answered from
the keyboard.** `MicrovmView.qml:166-174` — `ask()` puts the dialog up but never
takes focus off the filter, and the catcher's `blocked:` already counts
`filterField.activeFocus || root.confirmOpen`. Printable keys type into the
TextField, Return is eaten by it, and `Keys.onEscapePressed` clears the filter
text instead of reaching the key handler at `:252`. Press `/`, then click a row's
✗ with the mouse: the question is on screen and y, n, Enter and Esc all go to the
filter box. Only a mouse click on Cancel gets out.

**2. Submitting while the mutation lock is held throws the whole form away.**
`MicrovmView.qml:110-114` — `MicrovmState.submit` returns false while `mutating`
(`MicrovmState.qml:218`), but `submitForm` ignores the return value and calls
`setMode("list")` regardless; the review's Enter at `:386` goes the same way.
Press `s` on a disposable VM so a build streams, press `c`, fill out a permanent
VM, Enter, Enter at the review: the footer shows the busy text and every field
the user typed is gone. The lock is right; only the view's reaction to it is
wrong, and the user pays with their work.

**3. The review does not show what will actually run.** `MicrovmView.qml:427`
maps each argv through `a.slice(0, 4)` with no ellipsis. For
`nixarchy-pkg opt set <path> <value>` the value — the entire line being written
into `apps.nix` — is cut, and the tail of the service-enable variants vanishes
with nothing to mark it. The snippet above at `:415` is complete, so the "this
line goes into apps.nix" claim holds; the "Runs:" line beneath it is a half-truth
presented as fact, on the one screen whose job is to be believed before a write.

**4. Clicking a form field to focus it also mutates it.**
`CreateForm.qml:324-331` — `onClicked` sets `root.fieldIndex` *and* calls
`root.activate()`, which flips a bool or the kind. There is no way to click a
switch row just to put the cursor on it, and clicking the focused row flips it
again. Open `c`, click the "Kind" row: the form swings disposable↔permanent and
the whole field set changes under the pointer.

**5. `fieldIndex` is never clamped when `fields` shrinks.**
`CreateForm.qml:57-58` — `fields` has no `onFieldsChanged` clamp, though the
counterpart exists at `MicrovmView.qml:52`. An agent reply with
`kind: "disposable"` drops six fields: on a permanent form with assist on, Enter
on describe, Tab to sshKey (index 8), reply lands disposable, `fields.length` is
4, `current` is null, the footer hint blanks, focus falls to the key sink and
space is dead until Tab. `onAgentFormChanged` (`MicrovmView.qml:364-372`) resets
neither `fieldIndex`, `touched` nor `listIndex`, so the form the agent filled
carries the cursor state of the form the user was on.

**6. Clicking into a field skips `moveField`.** `CreateForm.qml:326-330` — the
field being left is never marked `touched` and `listIndex` is never reset. Errors
need `touched` or `attempted` (`:111-113`), so typing an invalid name and then
clicking another field shows nothing: validation ran and stayed silent.

**7. Negative widths in the narrow popup.** `VmList.qml:185`,
`CreateForm.qml:266`, `CreateForm.qml:368` and `LogView.qml:76` all compute
`Math.min(implicitWidth, <parent> − constant)` with no floor. `identity` is
anchored between `stateDot.right` and `rowActions.left`, so a permanent row with
five buttons in the 456 px popup leaves `identity.width` under `kindBadge.width`
and the VM name renders at negative width — invisible, not elided. Long names
elide correctly; it is the container that collapses.

**8. The footer key legend is not elided.** `MicrovmView.qml:624-647` —
`keysText` has neither a width nor an elide, while `countsText` anchors to
`keysText.left` and does elide. With assist and apply both enabled the legend is
wide enough in the 456 px popup to squeeze `countsText` to zero, so the counts
disappear rather than truncate: the wrong one of the two gives way.

**9. Keys bound in code but absent from the `?` sheet.** `ShortcutSheet.qml`
renders `Model.shortcutGroups()` faithfully, so the gaps are in `Model.js:34-66`:
`LogView.qml:49-50` PageUp/PageDown and `:47-48` ↑/↓ scrolling (the Log group
lists only j/k); `CreateForm.qml:221-222` j/k field movement, mode-dependent and
so the most confusing omission — on a text field they type, on a switch row they
navigate; `MicrovmView.qml:277` Tab and Shift+Tab to switch panels from the list;
and the inline picker, documented by the footer at `CreateForm.qml:483` but not
by the sheet. Nothing in the sheet is unbound, and undetected features are
already handled right.

Two findings deliberately left out. `ask()` (`MicrovmView.qml:166-174`) has no
guard against replacing a question already open — unverified, it needs a running
shell to know whether ConfirmDialog swallows the second click. And
`VmList.qml:151,196` use the literal `"transparent"`, invisible to the flake's
hex-colour check; that belongs to #26.

## Proposed outcome

The view checks before it acts:

- A question on screen owns the keyboard, from wherever focus was when it was
  asked, and y/n/Enter/Esc answer it.
- A submit that cannot run leaves the form and everything typed into it intact,
  and says why.
- The review shows the commands in full, or marks plainly where it stopped.
- Clicking a field selects it; only space, Enter or a key changes its value, and
  clicking away marks the field touched so its error appears.
- A form whose field set shrinks keeps a valid cursor, and an agent reply lands
  on a form reset to receive it.
- Both surfaces draw correctly at 456 px: no negative widths, and the footer
  sheds the legend before it sheds the counts.
- The `?` sheet lists every bound key, including the mode-dependent ones.

## Affected users and systems

`MicrovmView.qml`, `CreateForm.qml`, `VmList.qml`, `LogView.qml` and the
`SHORTCUTS` list in `Model.js`. Both surfaces, the popup harder than the menu,
since the narrow card is where 7 and 8 show. `docs/usage.md` and the README quote
the key list, so 9 reaches them.

## Constraints

- Keyboard-first, and one view shared by the bar popup and the full-screen menu:
  a fix has to hold at 456 px and at 1.45×.
- The surfaces are keep-loaded; `open()` resets the view and then focuses
  whatever belongs to the *final* mode via `Qt.callLater`. Focus changes must
  live with that ordering.
- Logic goes in `Model.js` with a Node test; QML stays drawing and wiring.
- No hardcoded colours.
- A user-visible change updates `docs/usage.md` and the README in the same PR.
- The `?` sheet is generated from `Model.shortcutGroups()`, so a key change is
  one edit in one place.

## Open questions

1. **One PR or several?** They split cleanly: 1–3 are confirmation and submit in
   `MicrovmView.qml`, 4–6 form focus in `CreateForm.qml`, 7–8 layout across four
   files, 9 one list in `Model.js`. Shipping 1–3 first gets the data-loss fixes
   out sooner. Or is one reviewable diff worth more here?
2. **Should the mouse and the keyboard share one cursor at all?** 4 and 6 are
   both a click doing the keyboard's job, and #21 already covers the hover
   coupling. Worth deciding the model once, across both issues.
3. **How should the review show a long command?** An ellipsis, a wrapped full
   argv, or only the count with the snippet carrying the detail — it changes how
   wide that screen has to be in the popup.
