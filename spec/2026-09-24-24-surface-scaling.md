---
status: draft
issue: 24
intent: intent/2026-09-24-24-surface-scaling.md
---

# Spec: the view consumes the height its host gives it, and the menu stops magnifying

## Design

### What the host actually offers

`Style` (`$OMARCHY_PATH/shell/Commons/Style.qml`) has no screen token, confirming
the intent. `space(px)` is `Math.max(1, Math.round(px * effectiveSpacingScale))`
(:219-223), `spaceReal` the unrounded form (:213-217), and
`effectiveSpacingScale = spacingScale * (spacingScaleWithFont ? fontScale : 1)`
(:211) with `fontScale = Math.max(1/12, fontBaseSize / 12)` (:284). `spacing.*`
(:230-261) and `font.*` (:320-338) are all derived from those two. Nothing in the
file reads a screen.

The screen only reaches a plugin through its host. `KeyboardPanel` exposes
`screenW`/`screenH` (:151-152), `availableCardWidth` (:153-155, that screen's
width minus the bar strip and margins, floored at 120) and `availableCardHeight`
(:156-158). `fittedContentWidth(width, cap)` (:161-166) clamps a desired width to
`availableCardWidth` and to an optional `cap`; `fittedContentHeight(implicitHeight,
cap)` (:168-173) adds `verticalContentInset` (:159, padding ×2 plus both borders)
and clamps to `availableCardHeight`. So `contentHeight` is card-outer and the view
inside `contentHolder` (:403-409) gets that minus the insets. The menu has no such
helper: `Menu.qml` reads `panel.width`/`panel.height` off its own `PanelWindow`.

### 1. The height budget, and why it cannot loop

`MicrovmView.qml:22` is `implicitHeight: column.implicitHeight` and `root.height`
is read nowhere. The fix is not to make the children read `root.height` directly —
that is the loop the lead names, and it is real: `view.implicitHeight` →
`fittedContentHeight` → `contentHeight` → `view.height` → child height →
`column.implicitHeight` → `view.implicitHeight`.

The cycle is broken by making `implicitHeight` depend only on *natural* sizes,
and `height` flow only downward. Concretely, `column` is split into three stacked
items:

- `headerBlock` — `PanelHero`, and the filter field in list mode.
- `body` — exactly one of `VmList` / `CreateForm` / `LogView`, the only stretchy item.
- `footerBlock` — the hairline, the error row, the notice line, the counts row.

Neither block reads `root.height`. `MicrovmView` then gains:

```qml
readonly property int bodyNatural: root.mode === "form" ? createForm.implicitHeight
  : root.mode === "log" ? logView.implicitHeight
  : root.mode === "review" ? review.implicitHeight : list.implicitHeight
readonly property int chromeHeight: headerBlock.implicitHeight + footerBlock.implicitHeight
  + column.spacing * 2
implicitHeight: chromeHeight + bodyNatural
readonly property int bodyHeight: root.height > 0
  ? Math.max(Style.space(90), root.height - chromeHeight) : 0
```

`implicitHeight` no longer goes through `column.implicitHeight` (Qt's Column sums
child *heights*, which is exactly the back-edge). Every term of `chromeHeight` and
`bodyNatural` is a natural content size, so `implicitHeight` is stable before the
host has sized anything; the host derives `root.height` from it; `bodyHeight`
derives from `root.height`; `body.height` derives from `bodyHeight`. One
direction, and it terminates because no node downstream of `bodyHeight` is read
upstream of it.

Each of the three children then binds `height: budget > 0 ? budget : implicitHeight`
with `budget` handed down:

- `VmList` — `maxHeight` (`VmList.qml:27`, declared and never assigned today) becomes
  `property int maxHeight: 0`, and `listView.height` (`:71`) becomes
  `rowModel.count > 0 ? (root.maxHeight > 0 ? Math.min(contentHeight, root.maxHeight) : contentHeight) : 0`.
  `implicitHeight` stays the unclamped content height.
- `CreateForm` — `flick.height` (`CreateForm.qml:273`, `Math.min(fieldsColumn.implicitHeight,
  Style.space(400))`) becomes `Math.min(fieldsColumn.implicitHeight, root.fieldBudget > 0 ?
  root.fieldBudget : fieldsColumn.implicitHeight)`, where `fieldBudget` is
  `bodyHeight` minus the form's own fixed rows (its header and key hints, which do
  not depend on the budget).
- `LogView` — `logList.height` (`LogView.qml:98`, `Style.space(340)`) becomes
  `root.listBudget > 0 ? root.listBudget : Style.space(220)`, where `listBudget` is
  `bodyHeight - header.implicitHeight - hint.implicitHeight - Style.spacing.md * 2`,
  i.e. `LogView.qml:26`'s own `implicitHeight` formula run backwards. This is the
  case the intent calls the worst: a build log stops being a 340-unit band.

**When `root.height` is 0** — the first frame, and the keep-loaded reopen before
the host re-sizes — every budget is 0 and every child falls back to its natural
height. That is today's behaviour exactly, so a reopen is never blank and never
collapsed; it is merely unstretched for one frame. The `Math.max(Style.space(90), …)`
floor keeps a pathologically short card from producing a negative or zero body:
the body then overflows into the footer's space and clips, which is visible and
recoverable, where a negative height is a Qt warning and an invisible list.

### 2. `implicitHeight` survives

Yes, in the reformulated shape above. Both hosts still need a natural size:
`Panel.qml:107` passes it to `fittedContentHeight`, and `Menu.qml:114` caps it at
`panel.height * 0.85`. When content is short, `root.height == implicitHeight`, so
`bodyHeight == bodyNatural` and nothing stretches — a three-VM list does not become
a tall empty card. When content is tall, the host clamps, and the body absorbs the
difference. The two are the same expression evaluated on either side of a clamp.

### 3. Widths

Both card widths become a fraction of the space the host reports, bounded by
`Style.space()` so text size still moves them.

`Panel.qml:106` — pass the cap argument `fittedContentWidth` has always taken and
this repo has never used:

```qml
contentWidth: panel.fittedContentWidth(
  Math.max(Style.space(380), Math.round(panel.availableCardWidth * 0.30)),
  Style.space(620))
```

0.30 of a 2560-wide screen is 768, capped at 620; of 1920, 576; of 1366, 410,
which the 380 floor leaves alone. A bar popup that is a third of the screen is
about as wide as it can be before it stops reading as a popout, and
`fittedContentWidth` still clamps to `availableCardWidth` on a narrow output.

`Menu.qml:31` — a full-screen surface can take more:

```qml
readonly property int viewWidth: Math.max(Style.space(560),
  Math.min(Style.space(1100), Math.round(panel.width * 0.55)))
```

1100 is `nixarchy.pkg/Menu.qml:28`'s `cardWidth`, so the family stays consistent,
and it is close to today's effective 1028 at base text size — the menu keeps its
present size on DP-1 and starts shrinking on 1080p and growing beyond it. The
existing `Math.min(…, panel.width * 0.9)` at `Menu.qml:112-113` stays as the hard
ceiling.

### 4. The 1.45× — removed, with no replacement factor

Settling the intent's first open question: **the menu keeps no magnification
factor at all.** `Menu.qml:30`, the `scale:`/`transformOrigin` pair at `:141-142`
and the `width: frame.width / root.uiScale` division at `:138-139` all go; the
view is hosted at 1:1 like the popup.

The reason is not taste, it is that the `textScale` + `px()` shape cannot reach
this view. `nixarchy.pkg` can multiply its own text because `Card.qml` and
`OptionForm.qml` are its files start to finish. `MicrovmView` is assembled from
the host kit, and the host kit does not expose the knob:
`PanelHero.qml:57,84,98` hardcode `Style.font.title`, `.body` and `.caption` with
only `iconSize` (`:13`) overridable; `ConfirmDialog.qml:79,114` hardcode
`Style.font.title` and `.caption` with no size property at all. A `textScale` on
`MicrovmView` would reach this repo's own 46 `Style.font.*` sites and leave the
hero title, the confirmation dialog and the shortcut sheet's host chrome at base
size — one surface drawn at two sizes, which is worse than the raster blur it
replaces.

So there is nothing for the shared view to be parameterised by, and the sharing
problem dissolves: `MicrovmView` gains no scale property, and the two surfaces
differ only in the width and height their hosts hand down, which is what points 1
and 3 already establish. The owner's "read it larger" need is served by
`omarchy display text size`, which feeds `fontScale` → `Style.font.*` and
`Style.space()` → both card bounds, end to end, for the first time.

Two comments die with the transform: `Menu.qml:27-29` and `CreateForm.qml:14-16`
("A Popup is reparented to the overlay and would ignore the menu's scale"). The
inline-list design that comment justifies stays — it is better regardless — but
the justification must be rewritten, not left pointing at a mechanism that is gone.

### 5. Scope

microvm only, as the intent says. Verified on this host: `uiScale` + a raster
transform is also in `nixarchy.distrobox`, `nixarchy.podman`, `nixarchy.devenv`
and `io.github.olafkfreund.nixarchy-plugin-browser`; `textScale` + `px()` is in
`nixarchy.pkg`, `nixarchy.flatsnap`, `nixarchy.herdr`, `olafkfreund.github-actions`
and `olafkfreund.gitlab-pipelines`.

Nothing in this repo should be built to be copied. Plugins are independent clones
with no shared import path — the only code they share is the host's `qs.Ui` and
`qs.Commons` — so a "shared helper" here would be a file the siblings can only
copy-paste, which is what they would do with the diff anyway. What this repo
contributes is the rule written into AGENTS.md (a surface derives its card from
the screen and its body from the height the host gave it; no render transform)
and a worked diff for the sibling issues to link. If the shape proves out, its
real home is a `fittedContentHeight`-style budget helper in `qs.Ui`, which belongs
in `docs/upstream.md` as an upstream ask, not in five plugins.

### 5a. Coordination with #25

#25 (`spec/2026-09-24-25-view-and-form.md`, drafted in parallel with this one)
ships `Math.max(0, …)` guards at `VmList.qml:185`, `CreateForm.qml:266`,
`CreateForm.qml:368`, `LogView.qml:342` and `LogView.qml:76`, and assigns the
structural rework to this issue under a written invariant:

> No width expression in either surface may evaluate below zero at a 456 px card.

This spec adopts that invariant. It holds here in the stronger form that the
rework must make a negative width unreachable rather than clamped: once
`identity` is sized from a budget rather than from
`Math.min(implicitWidth, parent − constant)`, the subtraction that can go
negative is gone, and #25's guards become redundant tokens on lines this issue
rewrites. Removing them along with the arithmetic is correct; removing them
without replacing the arithmetic is not.

Note for the plan: #25's spec describes this issue as being at approved-intent
with "no spec, no plan". That was true when #25 was written and is not now —
both specs were drafted in the same pass. The sequencing claim in #25 §4 should
be read as the invariant hand-off, which stands, not as a statement of this
issue's state. Whichever of the two lands first, the other rebases; the guards
and the rework are compatible in either order, and the invariant is what keeps
them so.

### 6. Docs

- `AGENTS.md:45` — "It scales the view 1.45×" becomes "It sizes its card from the
  focused screen and hosts the view unscaled." The claim that this is the factor
  nixarchy-pkg uses goes with it.
- AGENTS.md "Rules" gains one line for the pattern above, next to the
  no-hardcoded-colours rule it mirrors: token discipline for *what* a dimension is
  made of, this rule for *where* it comes from.
- AGENTS.md "Retaking the captures", step 3 — "the popup card is 456 px wide, the
  menu card 1028 px" stops being true of anything but one monitor at one text size.
  The numbers become a rule plus a recorded measurement: the card width is
  screen- and text-derived, so **measure the card before cropping**, and the
  numbers in the file are labelled as what they are on DP-1 at text size 12.
  `docs/capture.sh --shot NAME X,Y WxH` keeps its fixed geometry — a crop must be
  exact and reproducible, and computing it would be worse — but the section must
  say that the geometry is valid only for that monitor and text size, and that a
  full-output shot is taken first to read the card rectangle off. Whether
  `capture.sh` grows a `--probe` for that is the plan's call.
- `docs/usage.md` and the README each gain a line: the surfaces follow the screen
  and the desktop text size, and the menu is no longer magnified.

### Model.js candidates

Two pure helpers, both arithmetic with real edge cases, both belonging in
`Model.js` under the repo's own rule:

- `Model.cardWidth(available, fraction, min, max)` — the expressions in point 3,
  with `available <= 0` and `min > max` to pin down.
- `Model.bodyBudget(total, chrome, floor)` — `total <= 0 ? 0 : Math.max(floor,
  total - chrome)`, the expression in point 1, where the zero case *is* the
  first-frame contract.

Everything else in this change is QML binding and cannot be tested under Node.

## Alternatives rejected

**Read `Screen.devicePixelRatio` for layout.** Wayland hands a layer-shell surface
a logical-pixel coordinate space; the compositor multiplies by the output scale
when it composites. `screen.width` in `KeyboardPanel.qml:151` is already logical.
Multiplying a logical dimension by the device pixel ratio would make every card on
a scale-2 output twice its intended logical size and then be scaled again by the
compositor — 4× on screen. The host uses it only for raster `sourceSize`, where
asking for more texture pixels is exactly right, and never for layout.

**A new plugin setting for card size.** `manifest.json` already carries four
settings, and this would add a number the user has to tune per monitor, for a
quantity the shell can read. It also does not fix the problem: a fixed number in
`shell.json` is the same blindness as a fixed number in the QML, moved somewhere
harder to find. `omarchy display text size` is the setting that already exists for
"make it bigger", and this change is what finally makes it apply to the card.

**Keep the raster transform and fix only the heights.** It is the smaller diff, and
it leaves half the owner's report unanswered: menu text stays hinted for the base
size and rasterised 1.45× larger, the card border at `Menu.qml:119` still renders
at a fractional width, and wrap and elide are still computed against
`frame.width / 1.45` rather than the width the text is drawn at — so a name that
fits visually still elides, and one that overflows still does not wrap. Keeping it
also keeps `Menu.qml` sizing its view by division, which fights point 1's budget:
`bodyHeight` would have to be divided too, and every off-by-a-pixel would land in
the scroll arithmetic.

## Risks

- **Binding loops.** The named edge is `view.implicitHeight` →
  `KeyboardPanel.contentHeight` (`Panel.qml:107`) / `card.height` (`Menu.qml:114`) →
  `view.height` → `bodyHeight` → `list.maxHeight` / `flick.height` /
  `logList.height` → back into `implicitHeight`. The design cuts the last hop by
  computing `implicitHeight` from `chromeHeight + bodyNatural` rather than
  `column.implicitHeight`. If any child's `implicitHeight` is left depending on its
  own clamped `height`, the loop returns; `VmList.qml:36-37`
  (`implicitHeight: listView.height`) is precisely that shape today and must change.
  Qt reports these as runtime warnings, not failures, so `qs log` is the only
  detector — see Verification.
- **One view, two hosts.** Removing the transform means the menu is no longer a
  magnified popup but the same layout at a different size, and every proportion
  that was implicitly tuned for the popup now shows at menu width: the hero's
  trailing controls, the row action buttons (`VmList.qml:259`, `Style.space(22)`),
  the footer's two-column split. Nothing breaks, but the menu will look sparser
  than it does today and that is a judgement the owner has to see rather than read.
- **A small screen.** On a short output with a tall header and footer,
  `root.height - chromeHeight` can go below the `Style.space(90)` floor, or at a
  large text size below one row's height. The body then clips rather than scrolls
  gracefully. HDMI-A-1 at 1920×1080 with `display text size` at 18 is the realistic
  worst case and must be looked at.
- **Keep-loaded reopen.** `open()` calls `reset()` then `Qt.callLater(focusForMode)`
  (`MicrovmView.qml:59-70`). `reset()` changes `mode`, which changes `chromeHeight`
  (the filter field is list-only) and `bodyNatural` in the same frame the host is
  re-deriving `root.height`. A visible one-frame jump, or a body sized for the
  previous mode, is the failure to watch for — especially the IPC create path that
  lands straight in the form.
- **Runtime theme and font changes.** `Style.applyShellValues` (`Style.qml:400+`)
  rewrites `fontBaseSize` and `spacingScale` live, so every `Style.space()` bound
  in the new expressions changes at once while a surface is open. The budget must
  re-settle rather than oscillate; a theme switch with the popup open is a real
  thing the owner does.
- **Captures.** Every still and recording in `docs/img/` was framed against a
  456/1028-wide card. All of them are wrong after this lands, and the crop
  geometry in the capture procedure is wrong with them. Retaking is a separate
  piece of work with its own staging cost, and the PR must say whether it is in
  scope or deferred.

## Verification

Honest first: almost none of this is Node-testable. `node tests/run.js` and
`nix flake check` prove that `Model.js` is unchanged in behaviour, that no hex
colour or bare `sh -c` crept in, that the manifest and entry points are intact and
that there are no symlinks — and nothing whatever about whether a card is the
right size. If the two helpers in *Model.js candidates* are added, their edge cases
(`available <= 0`, `total <= 0`, `min > max`) get Node coverage; that is the whole
of the automated surface.

Everything else is live, on razer, following AGENTS.md "Verifying live" — build,
stop the shell, swap the folder, start, wait for `omarchy-shell shell ping`.

1. **No binding loops.** Get the instance from `qs list --all`, then
   `qs log -i <instance> | grep -i 'binding loop'` must be empty after exercising
   every mode on both surfaces. This is the check the whole design exists to pass;
   run it last, over the whole session's log, not per step.
2. **The bar is healthy** before anything else: `grep -c pluginBarApiFor` is 0 and
   `qs ipc -p "$OMARCHY_PATH/shell" show | grep -cx 'target omarchy.bar'` is 1.
3. **Both surfaces on all three monitors.** DP-1 and DP-2 are 2560×1440, HDMI-A-1
   is 1920×1080, all at Hyprland scale 1, so the only variable is width. Open the
   popup from the bar on each output (`omarchy shell nixarchy.microvm.bar open`) and
   the menu on each (`omarchy-shell shell toggle nixarchy.microvm '{}'`, which lands
   on the focused monitor — `hyprctl layers -j` says which). Correct: the popup card
   is visibly narrower on HDMI-A-1 than on DP-1; the menu card is visibly wider than
   the popup on the same screen; neither touches the screen edges.
4. **A list longer than the card.** Create `t1`…`t8` disposable VMs. The list must
   fill the card down to the footer and show strictly more rows on DP-1 than on
   HDMI-A-1, with the scrollbar appearing only once the rows exceed the budget and
   the footer staying put. Remove them with `nixarchy vm rm` after.
5. **The log, the case the intent names.** Start a disposable VM so the nix build
   streams, press `o`. The log must run from the header to the footer rather than
   stopping in a 340-unit band, and following the tail must still work at the new
   height. Check on both surfaces.
6. **The form.** `c`, then Tab through every field on both surfaces and on the
   1080 monitor. The field area must scroll inside the card; the footer and the
   key hints must never be pushed out of it. Then the permanent path as far as the
   review (`p1`), without applying.
7. **Text size.** `omarchy-display-text-size 9`, restart the shell, repeat steps
   3-6; then `18`, restart, repeat; then restore `12`. Correct at 9: narrower card,
   more rows, everything legible and nothing clipped. Correct at 18: wider card,
   fewer rows, footer still inside the card on HDMI-A-1 — that combination is the
   worst case named in Risks. Neither value may produce a binding-loop warning.
8. **Sharpness, the other half of the report.** With the menu open on DP-1, take a
   1:1 crop of the hero title and the card's top border, and compare against the
   same crop from the current build. Glyph edges must be hinted rather than
   interpolated and the border must be a whole pixel. This is the only evidence
   that removing the transform did what it was removed to do.
9. **Keep-loaded reopen.** Open and close each surface five times, then open the
   menu straight into the form with `'{"create":true}'`. The card must be the same
   size every time, and there must be no visible frame where the body is collapsed
   or sized for the previous mode.
10. **Runtime theme switch.** Change theme with both surfaces closed, then again
    with the popup open. The card re-lays out, the bar survives, and step 1's grep
    is still empty.
