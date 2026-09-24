---
status: approved
issue: 24
spec: spec/2026-09-24-24-surface-scaling.md
---

# Plan: the view consumes the height its host gives it, and the menu stops magnifying

Both surfaces already compute a screen-derived size; the view discards it.
`MicrovmView.qml:22` is `implicitHeight: column.implicitHeight` and `root.height`
is read nowhere, so three scrollers fall back to fixed rem caps (`VmList.qml:27`
520, `CreateForm.qml:273` 400, `LogView.qml:98` 340) and both card widths are
constants (`Panel.qml:106` 470, `Menu.qml:31` 680). The menu then magnifies the
finished layout with a raster transform (`Menu.qml:30`, `uiScale: 1.45`), which
is why its text is soft.

Approved decisions this plan carries:

- `column` (`MicrovmView.qml:280-283`) becomes three anchored blocks —
  `headerBlock` (top), `footerBlock` (bottom), `body` (between). A `Column` sums
  child *heights*, which is the back-edge of the cycle.
- Every item gets two disjoint height sources: **natural** (`implicitHeight`,
  only content implicitHeights and `Style` tokens) and **assigned** (`height`,
  only things downstream of `root.height`). The full table is spec §1.
- **No floor under the body.** `fittedContentHeight` plus `card.height` mean
  `view.height <= view.implicitHeight` by construction, so the body can only get
  less than it asked for; the first draft's `Style.space(90)` floor is removed
  and the body clamps to 0. Below the chrome threshold: chrome only, footer intact.
- `VmList.qml:27`, `:35`, `:36`, `:37` are deleted; `CreateForm` and `LogView`
  each get a `chrome + budget` split. Widths become popup
  `fittedContentWidth(max(space(380), availableCardWidth*0.30), space(620))` and
  menu `clamp(space(560), panel.width*0.55, space(1100))`.
- The 1.45× is removed outright, no replacement factor: the host kit exposes no
  font-size knob (`PanelHero.qml:57,84,98`; `ConfirmDialog.qml:79,114`), so a
  `textScale` would draw one surface at two sizes. `omarchy display text size`
  is the size knob, and this change is what makes it reach the card.
- This issue owns the final layout contract for `VmList.qml`, `CreateForm.qml`
  and `LogView.qml`; #25 yields on scaling.

**The one disclosed feedback path.** `listView.contentHeight` is Qt's estimate
until every delegate exists, so growing `listView.height` materialises rows and
refines `contentHeight`, which feeds `implicitHeight`. That is a value settling
over frames, not a cyclic binding: it only grows, and it is bounded by
`availableCardHeight` (`KeyboardPanel.qml:156-158`) and `panel.height * 0.85`.
`VmList.qml:71` already reads `contentHeight` today. Test 1 is what tells the two
apart — a loop is a `qs log` warning past a recorded boundary; settling is a list
that reaches its size a frame or two late and stays there.

## Steps

Order: three cheap, independent commits first (pure helpers, the transform, the
widths), each verifiable alone; then the structural split carrying the one child
that makes the budget observable; then one budget child per commit; docs last. A
binding loop shows only at runtime, so every commit must be openable and a
warning must be attributable to the commit that caused it. The split lands
*before* the other children consume a budget — they cannot consume one until it
exists, and the split alone is visually a no-op for them, since `CreateForm` and
`LogView` keep their natural heights inside a taller body. `VmList` rides in the
split commit because its `height: implicitHeight` (`:37`) conflicts with the
`anchors.fill` the split gives it; they cannot be separated.

1. **`Model.js`, `tests/run.js`: two pure helpers.**
   `Model.cardWidth(available, fraction, min, max)` →
   `available <= 0 ? min : Math.max(min, Math.min(max, Math.round(available * fraction)))`;
   `Model.bodyBudget(total, chrome)` → `total <= 0 ? 0 : Math.max(0, total - chrome)`.
   Cases: `available <= 0`, `min > max`, a fraction landing under `min` and over
   `max`, `total <= 0`, `total < chrome`, `total == chrome`, exact arithmetic.
   → verify by `node tests/run.js`; state the new total in the commit message.
2. **`Menu.qml`: remove the raster transform.** Delete `uiScale` (`:30`) and its
   comment (`:27-29`). Drop `* root.uiScale` from `card.width` (`:112`) and
   `card.height` (`:114`), leaving `root.viewWidth + insets` and
   `view.implicitHeight + insets`. Delete `width: frame.width / root.uiScale`,
   `height: frame.height / root.uiScale`, `scale`, `transformOrigin` and the
   comment (`:136-142`); the view gets `anchors.fill: parent`. → verify by opening
   the menu: same content, card ~1/1.45 of yesterday's, glyph edges hinted.
3. **`Panel.qml:106`, `Menu.qml:31`: screen-derived widths.**
   `contentWidth: panel.fittedContentWidth(Model.cardWidth(panel.availableCardWidth,
   0.30, Style.space(380), Style.space(620)), Style.space(620))`, and
   `readonly property int viewWidth: Model.cardWidth(panel.width, 0.55,
   Style.space(560), Style.space(1100))`. `Menu.qml:112`'s `Math.min(…,
   panel.width * 0.9)` stays as the hard ceiling. → verify by test 3.
4. **`MicrovmView.qml` + `VmList.qml`: the split, and the list on a budget.**
   Delete `column` (`:280-283`) and `implicitHeight: column.implicitHeight`
   (`:22`). Inside `keyCatcher`, three siblings, each with
   `spacing: Style.spacing.panelGap`:
   - `Column { id: headerBlock; anchors { top; left; right } }` — `PanelHero`
     (`:285-337`) and `filterField` (`:472-494`). Both children have natural
     heights only, so a positioner is safe here and its `implicitHeight` is
     exactly the spec's expression.
   - `Column { id: footerBlock; anchors { bottom; left; right } }` — the hairline
     (`:543-548`), the error `Item` (`:550-595`), the notice `Text` (`:600-617`)
     and the counts `Item` (`:619-648`), in that order, unchanged.
   - `Item { id: body; clip: true; height: root.bodyHeight; anchors { top:
     headerBlock.bottom; topMargin: Style.spacing.panelGap; left; right } }` —
     holding `createForm` (`:339-374`), `review` (`:377-456`), `logView`
     (`:458-470`), `list` (`:496-512`) and the empty-state `Column` (`:514-536`,
     which gains `id: emptyState`), each `anchors.fill: parent`, each keeping its
     `visible`. Delete every `width: parent.width` / `height: visible ?
     implicitHeight : 0` on those five (`:342-343`, `:380-381`, `:461-462`,
     `:499`, `:516`).

   Then on `MicrovmView`, verbatim:
   ```qml
   readonly property int chromeHeight: headerBlock.implicitHeight
     + footerBlock.implicitHeight + Style.spacing.panelGap * 2
   readonly property int bodyNatural: root.mode === "form" ? createForm.implicitHeight
     : root.mode === "log" ? logView.implicitHeight
     : root.mode === "review" ? review.implicitHeight
     : list.implicitHeight + (emptyState.visible ? emptyState.implicitHeight : 0)
   implicitHeight: chromeHeight + bodyNatural
   readonly property int bodyHeight: root.height > 0
     ? Model.bodyBudget(root.height, chromeHeight) : bodyNatural
   ```
   In `VmList.qml` delete `property int maxHeight: Style.space(520)` (`:27`),
   `width: parent ? parent.width : implicitWidth` (`:35`, which would fight the
   anchor), `implicitHeight: listView.height` (`:36`) and `height: implicitHeight`
   (`:37`); add `implicitHeight: listView.contentHeight`; replace `listView`'s
   `height` (`:71`) with `height: root.height`. `interactive: contentHeight >
   height` (`:76`) stays — it reads both sides but yields a bool, not a geometry.
   → verify by tests 1 and 4.
5. **`CreateForm.qml`: chrome + budget.** Give the header `Row` (`:232`)
   `id: headerRow` and the key-hint `Text` (`:474`) `id: hints`. Replace
   `implicitHeight: formColumn.implicitHeight` (`:66`) with
   ```qml
   readonly property int formChrome: headerRow.implicitHeight + hints.implicitHeight
     + formColumn.spacing * 2
   implicitHeight: formChrome + fieldsColumn.implicitHeight
   ```
   and `flick.height` (`:273`) with `Math.max(0, root.height - root.formChrome)`.
   `formColumn` keeps `anchors.fill: parent` (`:229`) and is no longer read for a
   natural height. Rewrite the comment at `:14-16`: the inline pickers stay
   because they are better, not because of a transform that is gone.
   → verify by test 6.
6. **`LogView.qml`: chrome + budget.** Replace `implicitHeight` (`:26`) with
   ```qml
   readonly property int logChrome: header.implicitHeight + hint.implicitHeight
     + Style.spacing.md * 2
   implicitHeight: logChrome + Style.space(340)
   ```
   and `logList.height` (`:98`) with `root.height > 0 ? Math.max(0, root.height -
   root.logChrome) : Style.space(340)`. 340 survives with a new meaning: the
   height the log *asks* for, not a cap it can never exceed. → verify by test 5.
7. **#25's guards.** If #25 landed first its `Math.max(0, …)` width guards sit on
   `VmList.qml:185`, `CreateForm.qml:266`, `CreateForm.qml:368` and
   `LogView.qml:76`. Spec §5a rules them superseded *by the arithmetic that
   replaces them* — and §1 and §3 specify no replacement for those four width
   expressions, which subtract a constant from a parent width and are untouched by
   steps 1-6. So **leave them in place**, add none where absent, and put the
   contradiction to the owner before the PR: deleting a guard whose arithmetic
   nothing replaced is the one move §5a itself calls incorrect. No commit unless
   the owner rules otherwise.
8. **Docs.** `AGENTS.md:45` — "It scales the view 1.45×" becomes "It sizes its
   card from the focused screen and hosts the view unscaled." `AGENTS.md:142` —
   keep "456 px" and "1028 px", relabelled as the measurement on DP-1 at text
   size 12, plus the rule that the card is screen- and text-derived, so a
   full-output shot is taken first and the card rectangle read off it before
   cropping; `capture.sh` keeps its fixed `--shot` geometry and gains **no
   `--probe` flag**. AGENTS.md "Rules" gains one line: a surface derives its card
   from the screen and its body from the height its host gave it; no render
   transform. `docs/usage.md` and `README.md` each gain a line: the surfaces
   follow the screen and the desktop text size, and the menu is no longer
   magnified. → verify by `nix flake check`.

## Tests

Honest first: almost none of this is Node-testable. `node tests/run.js` and
`nix flake check` prove `Model.js` behaviour, no hex colour, no symlink, no
`pacman`, an intact manifest and entry points — and nothing about whether a card
is the right size. The only genuinely pure logic is step 1's two helpers;
everything else is QML binding. `node tests/run.js` is 70 passed / 0 failed
today and must rise by exactly the cases step 1 adds, and by nothing else.

Live, on razer, per AGENTS.md "Verifying live": `nix build`, kill the shell until
nothing is left to kill, `rm -rf ~/.config/omarchy/plugins/nixarchy.microvm`,
`cp -rL result` into place, `chmod -R u+w`, `omarchy-restart-shell`, wait for
`omarchy-shell shell ping`.

1. **Binding loops, against a boundary.** On the fresh instance, after `ping`
   answers and **before opening either surface**: `inst=$(qs list --all | …)`,
   `base=$(qs log -i "$inst" | wc -l)`, and record `qs log -i "$inst" | grep -ci
   'binding loop'` (expect 0). Run tests 3-9, then `qs log -i "$inst" | tail -n
   +$((base + 1)) | grep -i 'binding loop'` — must be empty. Take the same
   boundary on the current build as a control, so a warning that predates this
   change is visible as such. A list that reaches its size a frame late is the
   disclosed settling and is not a finding; a `binding loop` line past the
   boundary is. Run this last.
2. **The bar is healthy** before anything else: `qs log -i <instance> | grep -c
   pluginBarApiFor` is 0, and `qs ipc -p "$OMARCHY_PATH/shell" show | grep -cx
   'target omarchy.bar'` is 1. A blank bar means restart before continuing.
3. **Both surfaces on all three monitors** — DP-1 and DP-2 2560×1440, HDMI-A-1
   1920×1080, all at Hyprland scale 1, so width is the only variable. Popup on
   the monitor holding the bar widget, menu on the focused monitor; `hyprctl
   layers -j` confirms where each landed (`omarchy-keyboard-panel`,
   `nixarchy-microvm-menu`). Correct: the popup is visibly narrower on HDMI-A-1
   than on DP-1, the menu visibly wider than the popup on the same screen,
   neither touching a screen edge.
4. **A long list** — `t1`…`t8` via `nixarchy vm`. The list fills the card down to
   the footer, shows strictly more rows on DP-1 than on HDMI-A-1, the scrollbar
   appears only once the rows exceed the budget, and the footer does not move.
   `nixarchy vm rm` after.
5. **A long log** — start a disposable VM so the nix build streams, press `o`.
   The log runs header-to-footer instead of stopping in a 340-unit band, and
   following the tail still works at the new height. Both surfaces.
6. **Form and review** — `c`, Tab through every field, on both surfaces and on
   HDMI-A-1: the field area scrolls inside the card and the key hints are never
   pushed out of it. Then the permanent path as far as the review (`p1`), without
   applying — the review has no scroller, so clipping would show here. Remove
   `p1` with `nixarchy-opt-remove`; never run `nixarchy-apply`.
7. **Text size** — `omarchy-display-text-size 9`, restart the shell, repeat 3-6;
   then `18`, restart, repeat; then restore `12`. At 9: a narrower card, more
   rows, nothing clipped. At 18: a wider card, fewer rows, footer still inside
   the card on HDMI-A-1. Neither value may add a binding-loop warning past
   test 1's boundary.
8. **Sharpness** — with the menu open on DP-1, take a 1:1 crop of the hero title
   and of the card's top border and compare with the same crop from the current
   build. Glyph edges hinted rather than interpolated, border a whole pixel. This
   is the only evidence that removing the transform did what it was removed to do.
9. **Reopen and theme** — open and close each surface five times, then
   `omarchy-shell shell toggle nixarchy.microvm '{"create":true}'`: the same card
   size every time, no visible frame where the body is collapsed or sized for the
   previous mode. Then switch theme with both surfaces closed, and again with the
   popup open: the card re-lays out, nothing oscillates, the bar survives.

## Rollback

Per commit, `git revert <sha>`; whole change, revert steps 2-6 in reverse order
or `git checkout main -- Menu.qml Panel.qml MicrovmView.qml VmList.qml
CreateForm.qml LogView.qml`. Step 1's helpers can stay — pure, tested and then
unreferenced. Step 8's docs revert with the code, or AGENTS.md describes a build
that does not exist.

This is the one task whose result the owner sees every time they open the menu,
so a revert is not neutral: it restores the 1.45× raster magnification, which is
the blurry text they reported. Say so when offering it. After reverting:
rebuild, swap with the shell stopped, wait for `omarchy-shell shell ping`, run
test 2's bar check, open both surfaces on DP-1 and HDMI-A-1, and take test 1's
boundary again — a revert that leaves a half-applied binding is as broken as the
loop it was undoing.
