---
status: approved
issue: 24
intent: intent/2026-09-24-24-surface-scaling.md
---

# Spec: the view consumes the height its host gives it, and the menu stops magnifying

## Design

### 0. The host API this design rests on, quoted from disk

None of the host lives in this repository, so an independent reviewer cannot check
any claim below without a nixarchy desktop. Every property this design depends on
is therefore quoted here with the path it was read from. The tree is the one
`$OMARCHY_PATH` pointed at while this was written,
`/nix/store/rp5i87d4pwxhiwi1pgwll2qjxlb815y8-nixarchy-omarchy-tree` (a store path,
so it is immutable; a later rebuild moves it, the line numbers are what matter).

| path:line | source |
| --- | --- |
| `shell/Commons/Style.qml:211` | `readonly property real effectiveSpacingScale: spacingScale * (spacingScaleWithFont ? fontScale : 1)` |
| `shell/Commons/Style.qml:213-217` | `function spaceReal(px) { … return n * effectiveSpacingScale }` |
| `shell/Commons/Style.qml:219-223` | `function space(px) { var n = spaceReal(px); … return Math.max(1, Math.round(n)) }` |
| `shell/Commons/Style.qml:284` | `readonly property real fontScale: Math.max(1 / 12, fontBaseSize / 12)` |
| `shell/Commons/Style.qml:279` | `property int fontBaseSize: 12` |
| `shell/Commons/Style.qml:231-261` | the whole `spacing` object, every token `root.spacingToken(key, n)` → `space(n)` |
| `shell/Commons/Style.qml:321-339` | the whole `font` object, every token `root.fontPx(mult)` → `Math.round(fontBaseSize * mult)` |
| `shell/Commons/Style.qml:384` | `function applyShellValues(values)`, which writes `fontBaseSize` (`:434`) and `spacingScaleWithFont` (`:433`) live |
| `shell/Ui/KeyboardPanel.qml:151-152` | `readonly property real screenW: screen ? screen.width : 0` / `screenH` |
| `shell/Ui/KeyboardPanel.qml:153-155` | `availableCardWidth`: `Math.max(120, screenW - ((barPos === "left" \|\| barPos === "right") ? barW + gap + margin : margin * 2))` |
| `shell/Ui/KeyboardPanel.qml:156-158` | `availableCardHeight`, the same minus the bar on the top/bottom axis |
| `shell/Ui/KeyboardPanel.qml:159` | `readonly property real verticalContentInset: padding * 2 + Border.top(borderSpec) + Border.bottom(borderSpec)` |
| `shell/Ui/KeyboardPanel.qml:161-166` | `fittedContentWidth(width, cap)` — clamps to `availableCardWidth` and to `cap` when given |
| `shell/Ui/KeyboardPanel.qml:168-173` | `fittedContentHeight(implicitHeight, cap)` — adds `verticalContentInset`, clamps to `availableCardHeight` |
| `shell/Ui/KeyboardPanel.qml:383-384` | `width: root.contentWidth` / `height: root.contentHeight` on the card |
| `shell/Ui/KeyboardPanel.qml:63` | `default property alias contentItem: contentHolder.children` |
| `shell/Ui/KeyboardPanel.qml:403-409` | `contentHolder` fills the card minus all four content insets |
| `shell/Ui/PanelHero.qml:26` | `implicitHeight: Math.max(iconLoader.implicitHeight, heroLabels.implicitHeight, trailingLoader.implicitHeight)` |
| `shell/Ui/PanelHero.qml:13` | `property real iconSize: Style.font.display` — the *only* size knob on the hero |
| `shell/Ui/PanelHero.qml:57` | `font.pixelSize: Style.font.title` (the hero title) |
| `shell/Ui/PanelHero.qml:84` | `font.pixelSize: Style.font.body` (the detail line) |
| `shell/Ui/PanelHero.qml:98` | `font.pixelSize: Style.font.caption` (the meta line) |
| `shell/Ui/ConfirmDialog.qml:79` | `font.pixelSize: Style.font.title` |
| `shell/Ui/ConfirmDialog.qml:114` | `font.pixelSize: Style.font.caption` |
| `shell/Ui/ConfirmDialog.qml:7-18` | its whole property list: `opened`, `message`, `cancelText`, `confirmText`, `selectedIndex`, four colours, `fontFamily`, `cornerRadius`. No size property |
| `~/.config/omarchy/plugins/nixarchy.pkg/Menu.qml:30` | `readonly property int cardWidth: Style.space(1100)` |
| `~/.config/omarchy/plugins/nixarchy.pkg/Menu.qml:35-36` | `readonly property real textScale: 1.45` / `function px(base) { return Math.round(base * root.textScale) }` |
| `~/.config/omarchy/plugins/nixarchy.pkg/Menu.qml:158` | `width: Math.min(root.cardWidth, Math.round(panel.width * 0.72))` |

Two claims in the approved intent do **not** survive this re-read, and the
correction matters:

- `grep -in 'screen\|dpi\|devicePixel' Style.qml` returns two comment lines (`:8`,
  `:14`) and nothing else. So the intent is right that `Style` has no screen token,
  and this is now checkable rather than asserted.
- `Style.applyShellValues` is at `:384`, not "`:400+`" as the first draft of this
  spec said. The behaviour is unchanged: `:433-434` assign `spacingScaleWithFont`
  and `fontBaseSize`, so a live theme change does move every `Style.space()` in
  this design.

One consequence of the quoted card geometry that the first draft did not state,
and that decides §1 below: `contentHeight = min(view.implicitHeight + inset,
availableCardHeight)` (`:168-173`) and `card.height = contentHeight` (`:384`),
so **`view.height` is never greater than `view.implicitHeight`.** The body can only
ever receive *less* than it asked for. The menu has the same relation through
`Menu.qml:114-115`. Nothing in this design ever stretches a body beyond its
natural size; what it fixes is that a body currently stops at a fixed rem cap
while the card still had room.

### 1. The height budget, and the exact binding graph

`MicrovmView.qml:22` is `implicitHeight: column.implicitHeight` and `root.height`
is read nowhere in the file. The naive fix — let the children read `root.height` —
closes a real cycle: `view.implicitHeight` → `fittedContentHeight` →
`contentHeight` → `view.height` → child height → `column.implicitHeight` →
`view.implicitHeight`.

The cycle is cut by giving every item two *disjoint* height sources: a **natural**
source (its `implicitHeight`, made of content sizes and constant tokens only) and
an **assigned** source (its `height`, derived from `root.height`). Nothing in the
natural column may name anything in the assigned column.

**Structure.** `column` (`MicrovmView.qml:280-283`, a `Column` with
`anchors.fill: parent`) is replaced by three items inside `keyCatcher`, positioned
by anchors rather than by a positioner — a `Column` sums child *heights*, which is
the back-edge itself:

- `headerBlock` — anchored top/left/right. Holds `PanelHero`
  (`MicrovmView.qml:285-337`) and `filterField` (`:472-494`, list mode only).
- `footerBlock` — anchored **bottom**/left/right. Holds the hairline (`:543-548`),
  the error row (`:550-595`), the notice line (`:600-617`) and the counts row
  (`:619-648`).
- `body` — anchored top to `headerBlock.bottom` + `Style.spacing.panelGap`, left
  and right to the edges, with an explicit height. `clip: true`. Holds `list`
  + the empty-state column (`:496-536`), `createForm` (`:339-374`), `review`
  (`:377-456`) and `logView` (`:458-470`), each `anchors.fill: parent` and
  `visible` in exactly one mode.

`MicrovmView` then declares:

```qml
readonly property int chromeHeight: headerBlock.implicitHeight
  + footerBlock.implicitHeight + Style.spacing.panelGap * 2
readonly property int bodyNatural: root.mode === "form" ? createForm.implicitHeight
  : root.mode === "log" ? logView.implicitHeight
  : root.mode === "review" ? review.implicitHeight
  : list.implicitHeight + (emptyState.visible ? emptyState.implicitHeight : 0)
implicitHeight: chromeHeight + bodyNatural
readonly property int bodyHeight: root.height > 0
  ? Math.max(0, root.height - chromeHeight) : bodyNatural
```

and `body.height: root.bodyHeight`.

**The binding graph.** Every item that has a height in either surface, its natural
source and its assigned source:

| item | natural: `implicitHeight` ← | assigned: `height` ← |
| --- | --- | --- |
| `MicrovmView` (root) | `chromeHeight + bodyNatural` | the host: `contentHolder` via `anchors.fill` (popup) / `frame.height` (menu) |
| `headerBlock` | `hero.implicitHeight` + (list mode: `panelGap + filterField.implicitHeight`) | its own `implicitHeight` |
| `PanelHero` | host, `PanelHero.qml:26`: max of three child implicit heights | its own `implicitHeight` |
| `filterField` | host `TextField`, font metrics + padding | its own `implicitHeight` |
| `footerBlock` | `Style.spacing.hairline + errorRow.implicitHeight + notice.implicitHeight + counts.implicitHeight` + three gaps | its own `implicitHeight`; anchored to the bottom edge |
| `errorRow` | `max(errorText.implicitHeight, Style.space(20))` (`:553`, `errorDismiss.size` is a constant token) | its own `implicitHeight` |
| `body` | `bodyNatural` | `root.bodyHeight` |
| `list` (`VmList`) | `listView.contentHeight` | `anchors.fill: body` |
| `listView` (inside `VmList`) | — | `VmList.height` |
| `emptyState` | its `Text.implicitHeight` + padding | its own `implicitHeight` |
| `createForm` | `formChrome + fieldsColumn.implicitHeight` | `anchors.fill: body` |
| `flick` (inside `CreateForm`) | — | `Math.max(0, CreateForm.height - formChrome)` |
| `review` | `reviewColumn.implicitHeight` | `anchors.fill: body` |
| `logView` | `logChrome + Style.space(340)` | `anchors.fill: body` |
| `logList` (inside `LogView`) | — | `LogView.height > 0 ? Math.max(0, LogView.height - logChrome) : Style.space(340)` |

The two columns are disjoint by inspection: the left column names only
`implicitHeight` of content items, `Style.*` tokens and `contentHeight`; the right
column names only `root.height` and items downstream of it. No identifier appears
in both. One direction, and it terminates because nothing downstream of
`bodyHeight` is read upstream of it.

**The three files, named property by property:**

- `VmList` — delete `maxHeight` (`VmList.qml:27`; declared, never assigned by
  either surface, and the budget replaces it), and delete both
  `implicitHeight: listView.height` (`:36`) and `height: implicitHeight` (`:37`).
  New: `implicitHeight: listView.contentHeight`, and `listView.height: root.height`
  (`:71`, replacing `rowModel.count > 0 ? Math.min(contentHeight, root.maxHeight) : 0`).
  `listView.interactive: contentHeight > height` (`:76`) reads both sides but
  produces a bool, not a geometry, so it is not in the graph.
- `CreateForm` — `implicitHeight: formColumn.implicitHeight` (`:66`) is replaced,
  because `formColumn` (`:227-229`) sums `flick.height`, which is about to become a
  budget. The form gets the same two-source split as its parent:
  `readonly property int formChrome: headerRow.implicitHeight + hints.implicitHeight
  + formColumn.spacing * 2` (ids added to the header `Row` at `:232` and the key-hint
  `Text` at `:474`), `implicitHeight: formChrome + fieldsColumn.implicitHeight`, and
  `flick.height` (`:273`, today `Math.min(fieldsColumn.implicitHeight, Style.space(400))`)
  becomes `Math.max(0, root.height - formChrome)`. `formColumn` keeps
  `anchors.fill: parent` and so takes the assigned height; it is no longer read for
  a natural one. This differs from the first draft, which passed a `fieldBudget` down
  from `MicrovmView`: deriving it inside `CreateForm` from its own height is one
  property fewer and one file-crossing fewer, for the same arithmetic.
- `LogView` — `implicitHeight` (`:26`) today reads `logList.height`, which is the
  circular shape. New: `readonly property int logChrome: header.implicitHeight
  + hint.implicitHeight + Style.spacing.md * 2` and
  `implicitHeight: logChrome + Style.space(340)`. `logList.height` (`:98`, today the
  bare `Style.space(340)`) becomes `root.height > 0 ? Math.max(0, root.height - logChrome)
  : Style.space(340)`. **340 survives, but changes meaning**: it stops being a cap
  the log can never exceed and becomes the height the log *asks* for. On a 1440-tall
  screen the host grants far more, which is the case the intent calls the worst.

**The one residual feedback path, disclosed.** `listView.contentHeight` is not
strictly independent of `listView.height`: Qt only instantiates the delegates it
needs, and estimates the rest, so `contentHeight` is exact once every row has been
created and an estimate before that. Growing `listView.height` creates more
delegates, which can refine `contentHeight`, which feeds `implicitHeight`. This is
not a Qt binding loop — it is a value settling over frames, not a cyclic binding —
and it terminates: the refinement is bounded above by `availableCardHeight`
(`KeyboardPanel.qml:156-158`) and by `panel.height * 0.85`, and `contentHeight`
only grows as rows materialise. `VmList.qml:71` already reads `contentHeight`
today, so this path exists in the current build too; what changes is that the
value now reaches `implicitHeight`. Verification step 1 is what proves it settles.

**When `root.height` is 0** — the first frame, and the keep-loaded reopen before
the host re-sizes — `bodyHeight` falls back to `bodyNatural` and each child to its
natural height. That is today's behaviour exactly: a reopen is never blank and
never collapsed.

**When the card is too short for the chrome** — `root.height < chromeHeight` —
`bodyHeight` clamps to 0. There is no floor, and there is deliberately none: the
first draft's `Math.max(Style.space(90), …)` could hand the body more space than
the card had, which is what made it contradict the footer requirement. With the
clamp at 0 the arithmetic is exact — `headerBlock.implicitHeight + panelGap +
bodyHeight + panelGap + footerBlock.implicitHeight == root.height` whenever
`root.height >= chromeHeight` — so the body's bottom edge meets the footer's top
edge and never crosses it. Below that threshold the surface shows the hero, the
filter and the footer with no body at all; the footer is anchored to the bottom
edge, so it is what stays, and the header is what the footer paints over. That is
the honest answer to "what does a too-small screen show": **no rows, chrome only,
footer intact.** It is a corner rather than a case — on HDMI-A-1 (1080 tall) at
`display text size` 18 the chrome is under 300 logical pixels against an
`availableCardHeight` over 900 — but it is now stated rather than clipped.

### 2. `implicitHeight` survives

Yes, in the reformulated shape above. Both hosts need a natural size:
`Panel.qml:107` passes it to `fittedContentHeight`, and `Menu.qml:114` caps it at
`panel.height * 0.85`. When content is short, `root.height == implicitHeight`, so
`bodyHeight == bodyNatural` and nothing changes — a three-VM list does not become a
tall empty card. When content is tall, the host clamps and the body absorbs the
whole difference instead of the list stopping at 520 with the card still short.
The two are the same expression evaluated on either side of a clamp.

### 3. Widths

Both card widths become a fraction of the space the host reports, bounded by
`Style.space()` so text size still moves them.

`Panel.qml:106` — pass the cap argument `fittedContentWidth` has always taken
(`KeyboardPanel.qml:161-166`) and this repo has never used:

```qml
contentWidth: panel.fittedContentWidth(
  Math.max(Style.space(380), Math.round(panel.availableCardWidth * 0.30)),
  Style.space(620))
```

0.30 of a 2560-wide screen is 768, capped at 620; of 1920, 576; of 1366, 410,
which the 380 floor leaves alone. `fittedContentWidth` still clamps to
`availableCardWidth` on a narrow output.

`Menu.qml:31` — a full-screen surface can take more:

```qml
readonly property int viewWidth: Math.max(Style.space(560),
  Math.min(Style.space(1100), Math.round(panel.width * 0.55)))
```

1100 is `nixarchy.pkg/Menu.qml:30`'s `cardWidth`, so the family stays consistent,
and it is close to today's effective 1028 at base text size: the menu keeps its
present size on DP-1 and starts shrinking on 1080p. The existing
`Math.min(…, panel.width * 0.9)` at `Menu.qml:112-113` stays as the hard ceiling.
(For the record, pkg's own ceiling is `panel.width * 0.72`,
`nixarchy.pkg/Menu.qml:158`; matching it is not required, since our card is a third
narrower.)

### 4a. Amendment: removed, and replaced by a role ladder (#27)

**This supersedes §4 below, which is kept because its evidence is still good and
its conclusion is still half right.** §4 removed the transform and stopped. That
is incomplete: the factor existed because a full-screen surface is read from
further away, and deleting it leaves the menu at bar-popup text size.
nixarchy.devenv shipped exactly this deletion and filed a regression against
itself (nixarchy-devenv#37); nixarchy.distrobox reached the replacement
independently. Filed here as #27.

**The replacement is not a multiplier.** `MicrovmView` gains a
`property bool large: false`, and each named text role resolves to a rung of the
host's own font ladder — one rung higher when `large`. `Menu.qml` passes
`large: true`; `Panel.qml` passes nothing, so the popup keeps the base rungs.
Every rung derives from `[font] base-size`, so the menu moves *with* the desktop
text size instead of pulling a fixed percentage away from it, and nothing is
magnified after layout.

§4's objection — that the host kit exposes no knob, so a multiplier would grow
this repo's text and leave `PanelHero` and `ConfirmDialog` behind — was reasoned
from "the file hardcodes sizes" without checking *which element uses which rung*.
Checked (nixarchy.devenv, verified on the owner's display with both components
unmodified):

| Element | Hardcoded | At `large` |
| --- | --- | --- |
| `ConfirmDialog` message (`:76-79`) | `Style.font.title` | matches |
| `PanelHero` title (`:57`) | `Style.font.title` | matches |
| `ConfirmDialog` buttons (`:110-114`) | `caption` | one rung low |
| `PanelHero` meta/detail (`:84`, `:98`) | `body` / `caption` | one rung low |

The primary text in both host components already lands on the large rung,
because `title` is where the `caption` role climbs to. What is left is two button
captions and a meta line sitting one rung low — a polish gap, not the half-grown
surface §4 rejected a multiplier over. The mapping must therefore send
`caption → title` for this to hold; that is a requirement of this amendment, not
an accident.

**The width is settled in the same change, or not at all.** `viewWidth` was
`Style.space(680)` *because* 1.45 stretched it to ~986: the number was written to
be multiplied. nixarchy-devenv#37 removed the multiplier and left the width, and
shipped a menu a third narrower — every check passed and the live check confirmed
the text looked right, which it did. §3 of this spec already replaces `viewWidth`
with `cardWidth(panel.width, 0.55, space(560), space(1100))`, which measures
wider than 986 on every monitor this host has (1100 on the 2560s, 1056 on the
1920) and narrower only on a small laptop (751 on a 1366). That is retained; the
1366 case is recorded on PR #31 as a behaviour change on untested hardware.

**Not separable from the removal.** Reverting the removal alone now yields
`round(1100 × 1.45)` = a 1595 px magnified card, because §3 already made
`viewWidth` screen-derived. The transform removal and the role ladder are one
change.

### 4. The 1.45× — removed, with no replacement factor

*(Superseded by §4a. The evidence below is accurate and was re-verified on disk;
the conclusion "no replacement" is what §4a corrects.)*

Settling the intent's first open question: **the menu keeps no magnification
factor at all.** `Menu.qml:30`, the `scale:`/`transformOrigin` pair at `:141-142`
and the `width: frame.width / root.uiScale` division at `:138-139` all go; the view
is hosted 1:1 like the popup.

The reason is not taste. The `textScale` + `px()` shape cannot reach this view.
`nixarchy.pkg` can multiply its own text because `Card.qml` and `OptionForm.qml`
are its files start to finish. `MicrovmView` is assembled from the host kit, and
the host kit exposes no knob — re-verified on disk for this amendment, since the
owner is accepting smaller menu text on the strength of it:

- `PanelHero.qml:57` `font.pixelSize: Style.font.title`, `:84`
  `font.pixelSize: Style.font.body`, `:98` `font.pixelSize: Style.font.caption`.
  The hero's only size property is `iconSize` (`:13`) — and this repo does not even
  use it, because `MicrovmView.qml:292-297` supplies its own `iconComponent` with
  `font.pixelSize: Style.font.display`. So the hero's title, meta and detail are
  unreachable from a caller.
- `ConfirmDialog.qml:79` `font.pixelSize: Style.font.title` and `:114`
  `font.pixelSize: Style.font.caption`. Its full property list is `:7-18` —
  `opened`, `message`, `cancelText`, `confirmText`, `selectedIndex`, four colours,
  `fontFamily`, `cornerRadius`. There is no size property to pass.

A `textScale` on `MicrovmView` would therefore reach this repo's own 46
`Style.font.*` sites and leave the hero title and the confirmation dialog at base
size: one surface drawn at two sizes, which is worse than the raster blur it
replaces. So there is nothing for the shared view to be parameterised by, and the
sharing problem dissolves: `MicrovmView` gains no scale property, and the two
surfaces differ only in the width and height their hosts hand down. The owner's
"read it larger" need is served by `omarchy display text size`, which feeds
`fontScale` → `Style.font.*` and `Style.space()` → both card bounds, end to end,
for the first time.

Two comments die with the transform: `Menu.qml:27-29` and `CreateForm.qml:14-16`
("A Popup is reparented to the overlay and would ignore the menu's scale"). The
inline-list design that comment justifies stays — it is better regardless — but the
justification is rewritten rather than left pointing at a mechanism that is gone.

### 5. Scope

microvm only, as the intent says. Verified on this host: `uiScale` + a raster
transform is also in `nixarchy.distrobox`, `nixarchy.podman`, `nixarchy.devenv` and
`io.github.olafkfreund.nixarchy-plugin-browser`; `textScale` + `px()` is in
`nixarchy.pkg`, `nixarchy.flatsnap`, `nixarchy.herdr`, `olafkfreund.github-actions`
and `olafkfreund.gitlab-pipelines`.

Nothing in this repo should be built to be copied. Plugins are independent clones
with no shared import path — the only code they share is the host's `qs.Ui` and
`qs.Commons` — so a "shared helper" here would be a file the siblings can only
copy-paste. What this repo contributes is the rule written into AGENTS.md (a
surface derives its card from the screen and its body from the height the host gave
it; no render transform) and a worked diff for the sibling issues to link. If the
shape proves out, its real home is a `fittedContentHeight`-style budget helper in
`qs.Ui`, which belongs in `docs/upstream.md` as an upstream ask, not in five
plugins.

### 5a. Coordination with #25 — the ownership ruling

The owner has ruled on the overlap, and both specs record the same ruling:

> **#24 removes the 1.45× and owns the final layout contract for `VmList.qml`,
> `CreateForm.qml` and `LogView.qml`. #25 yields on scaling and defers the final
> width and height implementation to this spec.**

Concretely:

- #25's verification "at 456 px and at 1.45×" (`spec/2026-09-24-25-view-and-form.md:91,223`)
  is wrong after this lands — there is no 1.45×, and 456 px is one monitor at one
  text size. #25 is being amended in parallel to drop it.
- #25's `Math.max(0, …)` width guards **stay, and coexist with this rework**. An
  earlier version of this section claimed they were superseded because §1 and §3
  remove the subtraction that can go negative. That was wrong, and checking the
  four sites shows why: `VmList.qml:185` is
  `Math.min(implicitWidth, identity.width − kindBadge.width − Style.spacing.md)`,
  `CreateForm.qml:266` subtracts from `formColumn.width`, `:368` from `body.width`,
  and `LogView.qml:76` from `parent.width`. §1 changes heights and §3 changes the
  two card widths; neither rewrites any of those four expressions. This section's
  own next sentence already said removing the guards without replacing the
  arithmetic is not correct — and since the arithmetic is not replaced, the guards
  are what holds the invariant.

  So the ruling narrows: this spec owns the layout contract and the 1.45×
  removal, and #25 keeps findings 7 and 8. If a later change does replace one of
  those four expressions with a budget, the guard on that line goes with it, in
  that change.
- This spec adopts #25's invariant unchanged: **no width expression in either
  surface may evaluate below zero at a 456 px card** — and meets it in the stronger
  form that a negative width becomes unreachable rather than clamped.
- One citation correction: #25 §4 lists `LogView.qml:342`. `LogView.qml` is 130
  lines; the line meant is `:76`, `width: parent.width - Style.space(120)`. The
  first draft of this spec copied the bad citation.
- #25 also describes this issue as "approved intent only — no spec, no plan". That
  was true when #25 was written; both specs were drafted in the same pass. Whichever
  lands first, the other rebases.

### 6. Docs

- `AGENTS.md:45` — "It scales the view 1.45×" becomes "It sizes its card from the
  focused screen and hosts the view unscaled." The claim that this is the factor
  nixarchy-pkg uses goes with it.
- AGENTS.md "Rules" gains one line for the pattern above, next to the
  no-hardcoded-colours rule it mirrors: token discipline for *what* a dimension is
  made of, this rule for *where* it comes from.
- AGENTS.md "Retaking the captures", step 3 — "the popup card is 456 px wide, the
  menu card 1028 px" stops being true of anything but one monitor at one text size.
  The two numbers stay, relabelled as what they are: the measurement on DP-1 at text
  size 12. The step gains the rule that the card is screen- and text-derived, so a
  full-output shot is taken first and the card rectangle read off it before
  cropping. `docs/capture.sh --shot NAME X,Y WxH` keeps its fixed geometry — a crop
  must be exact and reproducible — and **gains no `--probe` flag**: `hyprctl layers
  -j` and a full-output shot already give the rectangle, and a flag that computes it
  would be a second thing to keep correct.
- `docs/usage.md` and the README each gain a line: the surfaces follow the screen
  and the desktop text size, and the menu is no longer magnified.

### Model.js candidates

Two pure helpers, both arithmetic with real edge cases, both belonging in `Model.js`
under the repo's own rule:

- `Model.cardWidth(available, fraction, min, max)` — the expressions in §3, with
  `available <= 0` and `min > max` to pin down.
- `Model.bodyBudget(total, chrome)` — `total <= 0 ? 0 : Math.max(0, total - chrome)`,
  the expression in §1, where the zero cases *are* the first-frame contract and the
  too-short-card contract.

Everything else in this change is QML binding and cannot be tested under Node.

## Alternatives rejected

**Read `Screen.devicePixelRatio` for layout.** Wayland hands a layer-shell surface a
logical-pixel coordinate space; the compositor multiplies by the output scale when
it composites. `screen.width` in `KeyboardPanel.qml:151` is already logical.
Multiplying a logical dimension by the device pixel ratio would make every card on a
scale-2 output twice its intended logical size and then be scaled again by the
compositor — 4× on screen. The host uses it only for raster `sourceSize`, where
asking for more texture pixels is exactly right, and never for layout.

**A new plugin setting for card size.** `manifest.json` already carries four
settings, and this would add a number the user has to tune per monitor for a
quantity the shell can read. It also does not fix the problem: a fixed number in
`shell.json` is the same blindness as a fixed number in the QML, moved somewhere
harder to find. `omarchy display text size` is the setting that already exists for
"make it bigger", and this change is what makes it apply to the card.

**Keep the `Column` and give it a stretchy child.** Qt's `Column` is a positioner:
it has no stretch, and its `implicitHeight` is the sum of child *heights* — the
back-edge of the cycle. Any arrangement that keeps `column.implicitHeight` as the
view's natural height re-creates the loop the moment one child's height comes from a
budget. Three anchored blocks are both smaller and the only shape where the
disjointness in §1's table is checkable by reading.

**Keep the raster transform and fix only the heights.** The smaller diff, and it
leaves half the owner's report unanswered: menu text stays hinted for the base size
and rasterised 1.45× larger, the card border at `Menu.qml:119` still renders at a
fractional width, and wrap and elide are still computed against `frame.width / 1.45`
rather than the width the text is drawn at — so a name that fits visually still
elides. Keeping it also keeps `Menu.qml` sizing its view by division, which fights
§1's budget: `bodyHeight` would have to be divided too, and every off-by-a-pixel
would land in the scroll arithmetic.

## Risks

- **Binding loops.** The named edge is `view.implicitHeight` →
  `KeyboardPanel.contentHeight` (`Panel.qml:107`) / `card.height` (`Menu.qml:114`) →
  `view.height` → `bodyHeight` → `listView.height` / `flick.height` /
  `logList.height` → back into `implicitHeight`. §1's table cuts the last hop in
  every child. The residual is `listView.contentHeight`, disclosed in §1 with its
  termination argument. Qt reports loops as runtime warnings, not failures, so
  `qs log` is the only detector — see Verification step 1.
- **The review does not scroll.** `review` (`MicrovmView.qml:377-456`) is the one
  body child with no scroller; `bodyHeight <= bodyNatural` always (§0), so on a card
  the host had to clamp, the review clips instead of scrolling. Its content is five
  short texts plus a wrapped snippet, so this needs a very short screen and a very
  long machine name. If verification step 6 shows it, the fix is a `Flickable`
  around `reviewColumn` — not designed now, because designing for it unprompted is
  how the 340 cap got there.
- **One view, two hosts.** Without the transform the menu is the same layout at a
  different size, and every proportion implicitly tuned for the popup now shows at
  menu width: the hero's trailing controls, the row action buttons
  (`VmList.qml:259`, `Style.space(22)`), the footer's two-column split. Nothing
  breaks, but the menu will look sparser and that is a judgement the owner has to
  see rather than read.
- **A small screen.** §1 states what happens below the chrome threshold. The
  realistic worst case, HDMI-A-1 at 1920×1080 with `display text size` 18, is nowhere
  near it, and step 7 looks at it anyway.
- **Keep-loaded reopen.** `open()` calls `reset()` then `Qt.callLater(focusForMode)`
  (`MicrovmView.qml:59-70`). `reset()` changes `mode`, which changes `chromeHeight`
  (the filter field is list-only) and `bodyNatural` in the same frame the host is
  re-deriving `root.height`. A visible one-frame jump, or a body sized for the
  previous mode, is the failure to watch for — especially the IPC create path that
  lands straight in the form.
- **Runtime theme and font changes.** `Style.applyShellValues` (`Style.qml:384`,
  writing `fontBaseSize` at `:434`) rewrites the scale live, so every `Style.space()`
  in the new expressions changes at once while a surface is open. The budget must
  re-settle rather than oscillate; a theme switch with the popup open is a real thing
  the owner does.
- **Captures.** Every still and recording in `docs/img/` was framed against a
  456/1028-wide card, and the crop geometry with them. Retaking is a separate piece
  of work with its own staging cost; the PR must say whether it is in scope or
  deferred.

## Verification

Honest first: almost none of this is Node-testable. `node tests/run.js` and
`nix flake check` prove `Model.js` is unchanged in behaviour, that no hex colour or
bare `sh -c` crept in, that the manifest and entry points are intact and that there
are no symlinks — and nothing about whether a card is the right size. If the two
helpers in *Model.js candidates* are added, their edge cases (`available <= 0`,
`total <= 0`, `min > max`) get Node coverage; that is the whole automated surface.

Everything else is live, on razer, following AGENTS.md "Verifying live" — build,
stop the shell, swap the folder, start, wait for `omarchy-shell shell ping`.

1. **No binding loops, measured against a boundary.** A whole-session grep proves
   nothing: the log carries warnings from before the swap and from other plugins.
   So, on the fresh instance, immediately after `omarchy-shell shell ping` answers
   and **before opening either surface**:
   ```bash
   inst=$(qs list --all | …)            # the new instance
   base=$(qs log -i "$inst" | wc -l)
   qs log -i "$inst" | grep -ci 'binding loop'   # record it; expect 0 on a fresh shell
   ```
   Then run steps 3-9, and finish with
   `qs log -i "$inst" | tail -n +$((base + 1)) | grep -i 'binding loop'`, which must
   be empty. The same boundary is taken on the current build as a control, so a
   warning that predates this change is visible as such. This is the check the whole
   design exists to pass; run it last.
2. **The bar is healthy** before anything else: `grep -c pluginBarApiFor` is 0 and
   `qs ipc -p "$OMARCHY_PATH/shell" show | grep -cx 'target omarchy.bar'` is 1.
3. **Both surfaces on all three monitors.** DP-1 and DP-2 are 2560×1440, HDMI-A-1 is
   1920×1080, all at Hyprland scale 1, so the only variable is width. Correct: the
   popup card is visibly narrower on HDMI-A-1 than on DP-1; the menu card is visibly
   wider than the popup on the same screen; neither touches the screen edges.
4. **A list longer than the card** (`t1`…`t8`). The list fills the card down to the
   footer and shows strictly more rows on DP-1 than on HDMI-A-1, with the scrollbar
   appearing only once the rows exceed the budget and the footer staying put. Remove
   them with `nixarchy vm rm` after.
5. **The log, the case the intent names.** Start a disposable VM so the nix build
   streams, press `o`. The log runs from the header to the footer rather than
   stopping in a 340-unit band, and following the tail still works at the new height.
   Both surfaces.
6. **The form and the review.** `c`, Tab through every field on both surfaces and on
   the 1080 monitor: the field area scrolls inside the card, and the footer and key
   hints are never pushed out of it. Then the permanent path as far as the review
   (`p1`), without applying — this is where the no-scroller risk would show.
7. **Text size.** `omarchy-display-text-size 9`, restart the shell, repeat 3-6; then
   `18`, restart, repeat; then restore `12`. At 9: narrower card, more rows, nothing
   clipped. At 18: wider card, fewer rows, footer still inside the card on HDMI-A-1.
   Neither value may add a binding-loop warning past step 1's boundary.
8. **Sharpness, the other half of the report.** With the menu open on DP-1, take a
   1:1 crop of the hero title and the card's top border, and compare against the same
   crop from the current build. Glyph edges must be hinted rather than interpolated
   and the border must be a whole pixel. This is the only evidence that removing the
   transform did what it was removed to do.
9. **Keep-loaded reopen and theme switch.** Open and close each surface five times,
   then open the menu straight into the form with `'{"create":true}'`: the card is
   the same size every time, with no visible frame where the body is collapsed or
   sized for the previous mode. Then change theme with both surfaces closed, and
   again with the popup open: the card re-lays out and the bar survives.
