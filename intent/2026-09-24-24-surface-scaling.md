---
status: draft
issue: 24
author: olafkfreund
---

# Intent: the surfaces follow the screen, and the menu stops magnifying itself

Closes #24.

## Problem

The owner's report: "the text and the windows needs to follow the desktop size
and scale."

The obvious reading — someone hardcoded pixels — is wrong, and saying so is the
most useful thing in this document. The token discipline here is already close
to exemplary: every font size is a `Style.font.*` token, every dimension goes
through `Style.space()` or `Style.spacing.*`, and across roughly 2,469 lines of
QML there are four bare numeric literals. There is nothing to convert. The
problem sits one layer beneath the tokens.

**`Style.space()` is a rem unit, not a screen unit.** It computes
`round(n × fontScale × spacingScale)`, and `fontScale` derives from
`omarchy display text size` (`shell.toml [font] base-size`, range 0.75–1.667)
and from nothing else. So the surfaces track the desktop *text* scale and are
completely blind to the *screen*. Every card dimension is the same physical
size on a 1920-wide panel and on a 3840-wide one. The host `Style` singleton
exposes no scale, dpi or screen token at all. `Screen.devicePixelRatio` appears
in the host shell only for raster icon `sourceSize`, never for layout — which
is correct, because Wayland hands layer-shell surfaces logical pixels and
reading it for layout would double-scale.

**The view discards the height its host hands it.** `MicrovmView.qml:22` is
`implicitHeight: column.implicitHeight`, and `root.height` is never read
anywhere in that file. Both hosts already compute a correct screen-derived
height and the view then ignores it: the popup has
`KeyboardPanel.availableCardHeight` (that screen's height minus bar, gap and
margin), and the menu caps at `panel.height * 0.85` (`Menu.qml:127-132`).
`view.height` *is* already set correctly, at `Menu.qml:139` and via anchors in
the popup — the view simply never looks at it. Because of that, three scrollers
inside fall back to fixed rem caps. `VmList.maxHeight` is declared at
`VmList.qml:27` and is never assigned by either surface, so the list is
permanently capped at a fixed value.

The five caps that should derive from the screen:

| file:line | value | note |
| --- | --- | --- |
| `Menu.qml:31` | `Style.space(680)` | menu card width |
| `Panel.qml:106` | `Style.space(470)` | popup card width; `fittedContentWidth` already takes an optional cap this repo never passes |
| `VmList.qml:27` | `Style.space(520)` | never overridden by either surface |
| `CreateForm.qml:273` | `Style.space(400)` | form scroller |
| `LogView.qml:98` | `Style.space(340)` | worst case: a long build log capped at 340 on a 2160-tall screen |

AGENTS.md's capture measurements ("the popup card is 456 px wide, the menu card
1028 px") are these numbers at the default text size.

**The menu's 1.45× is a raster transform, not a layout.** `Menu.qml:30` is
`readonly property real uiScale: 1.45`, a bare constant relative to nothing,
applied at `Menu.qml:138-140` as an `Item` render transform
(`width: frame.width / uiScale; scale: uiScale`). It magnifies a surface that
has already been laid out: glyphs hinted for the base size are rasterised 1.45×
larger, so menu text is soft and unhinted; the border at `Menu.qml:119` renders
at a fractional width; and wrap and elide are computed at the small size and
then stretched, so nothing reflows. `nixarchy.pkg` uses the same 1.45, but as a
layout-time multiplier into font sizes
(`function px(base) { return Math.round(base * textScale) }`), with no
transform. **AGENTS.md:45's claim that this is "the same factor nixarchy-pkg's
menu uses" is true of the number and false of the mechanism**; the line needs
correcting alongside any fix.

Across the installed plugin family this splits into two camps:

```
uiScale + scale-transform:  microvm, distrobox, podman, devenv, plugin-browser
textScale + px() (correct): pkg, flatsnap, herdr
```

Another session found the same construct in nixarchy-distrobox and is fixing it
there. Scope here is microvm only.

For honesty about what the owner is actually seeing: `omarchy-display-text-size`
reports 12 (the default), no `~/.config/omarchy/shell.toml` exists, and all
three monitors (DP-1 2560×1440, DP-2 2560×1440, HDMI-A-1 1920×1080) are at
Hyprland scale 1 — verified on this machine. So the complaint is about screen
size and text sharpness, not about compositor scale.

## Proposed outcome

- Both surfaces use the space the screen actually offers: the card and every
  scroller inside it grow on a large monitor and shrink on a small one, instead
  of landing at the same physical size everywhere. A long build log on a
  2160-tall screen fills the height available to it.
- The desktop text-size setting keeps working exactly as it does now, on top of
  that: making text larger still makes the surfaces larger.
- Menu text is rendered at its true size rather than magnified, so glyphs are
  hinted and crisp, the card border is a whole pixel, and text wraps and elides
  against the width it is actually drawn at.
- Nothing about the theme tokens changes: no hex colour, no bare pixel count
  appears anywhere new.

## Affected users and systems

- `Menu.qml`, `Panel.qml`, `MicrovmView.qml`, `VmList.qml`, `CreateForm.qml`,
  `LogView.qml`.
- `AGENTS.md:45` (the 1.45 claim) and its capture section, whose "456 px" /
  "1028 px" card widths stop being fixed constants.
- `docs/usage.md`, the README and any still or recording whose framing depends
  on the current card size.
- Every nixarchy host running this plugin, on any monitor; razer and p620 for
  verification.
- The other four plugins in the `uiScale` camp are a cross-repo follow-up, not
  this issue.

## Constraints

- No hardcoded colours, and the existing token discipline must survive: the fix
  cannot reintroduce bare pixel counts.
- The surfaces are keep-loaded, and `open()` must keep resetting the view
  without touching the stream or the log.
- The popup and the menu share one `MicrovmView`; whatever it learns to read
  has to be correct for both a bar popup and a full-screen menu.
- Do not read `Screen.devicePixelRatio` for layout. Wayland gives layer-shell
  surfaces logical pixels, and using it would double-scale.
- The fix must honour the desktop text-size setting, not replace it.
- `AGENTS.md:45` is corrected in the same PR.
- A user-visible change updates `docs/usage.md` and the README in the same PR.

## Open questions

1. **Does the menu keep a magnification factor at all?** Once layout is derived
   from the screen, a full-screen surface may need nothing beyond that — or it
   may still want to read larger from further away, in which case the
   nixarchy.pkg-style text multiplier is the obvious shape. Which?
2. **What fraction of the screen should the menu target?** The height cap is
   already `0.85`; width has no equivalent. A fraction, a clamp between a
   minimum and a maximum, or both?
3. **The cross-repo follow-up.** File the issue for distrobox, podman, devenv
   and plugin-browser now, while the finding is fresh, or after this one lands
   and the shape is proven?

Minor, in scope if convenient: `VmList.qml:152` and `VmList.qml:197` use
`border.width: 1` where `Style.spacing.hairline` exists — two of the four bare
literals in the repo.
