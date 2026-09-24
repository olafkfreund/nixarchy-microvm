---
status: approved
issue: 25
intent: intent/2026-09-24-25-view-and-form.md
---

# Spec: one focus owner, one refusal rule, a review that does not abbreviate

## Design

The nine findings are three rules and two lists. Ranked as the intent ranks them.

### 1. One focus owner per state (findings 1, 4, 5, 6)

Four sites move focus or the cursor on their own — `ask()` does not move it at all
(`MicrovmView.qml:166-174`), the form's `MouseArea` writes `fieldIndex` directly
(`CreateForm.qml:326-330`), `fields` shrinking leaves `fieldIndex` past the end
(`CreateForm.qml:57-58`), and `onAgentFormChanged` (`MicrovmView.qml:364-372`) resets
the form's data but none of its cursor state. One mistake four times: focus and
selection treated as history rather than as a function of the current state.

**The rule: at any moment exactly one item holds the keyboard, and which one is a
pure function of the state — never of what held it last. Every event that changes
that state ends by asking the one function again.**

The view already has that function: `focusForMode()` (`MicrovmView.qml:74-79`), the
authority `reset()` and `setMode()` defer to. It is incomplete — it knows four modes
and not the confirmation. The branch moves to
`Model.focusTarget({mode, confirmOpen})` → `"confirm" | "log" | "form" | "review" |
"list"`, six lines with a Node table test, and `ask()` and `closeConfirm()` become
state changes like any other: set the flag, then `Qt.callLater(root.focusForMode)`.

#### What `"confirm"` focuses, and why it is not the dialog

The first draft named `keyRoot` as the item whose `Keys.onPressed` feeds
`confirmDialog.handleKey` and stopped there. That is not a focus operation, and
without one the filter keeps the keyboard and finding 1 is unfixed. The host component
settles it: `$OMARCHY_PATH/shell/Ui/ConfirmDialog.qml`, 133 lines, whole API —

```qml
Item {                              // :4  — not a FocusScope, no focus: true
  property bool opened               // :7
  property string message            // :8
  property string cancelText         // :9
  property string confirmText        // :10
  property int selectedIndex: 1      // :11  — 0 cancel, 1 confirm
  signal canceled()                  // :20
  signal confirmed()                 // :21
  function handleKey(event)          // :23-39 — returns true when it handled one
  visible: opened                    // :41
}
```

No focus property, no `focus: true`, no `Keys` handler, and nothing to call
`forceActiveFocus()` on that would receive a key — its only children are a scrim
`MouseArea` (`:47`) and two button ones (`:117-126`). It is a drawing of a question
plus a key interpreter the host calls. **So the dialog cannot be the focus owner, and
`"confirm"` must take focus away from the filter rather than give it to the dialog.**

The item that takes it is `keyCatcher`. `PanelKeyCatcher`
(`$OMARCHY_PATH/shell/Ui/PanelKeyCatcher.qml`) is `focus: true` (`:46`) and starts its
handler with `if (blocked) return` (`:49`); its own comment (`:31-32`) says that while
blocked "ALL keys are forwarded to descendants without triggering signals" — it accepts
nothing, so the event walks up to `keyRoot`'s `Keys.onPressed`
(`MicrovmView.qml:252-255`), the path the comment at `:245-247` already describes. What
was missing is that someone has to be *holding* the keyboard for a key to enter it.

```qml
function focusForMode() {
  var t = Model.focusTarget({ mode: root.mode, confirmOpen: root.confirmOpen })
  if (t === "log") logView.forceActiveFocus()
  else if (t === "form") createForm.focusCurrent()
  else if (t === "review") review.forceActiveFocus()
  // "confirm" and "list" are both keyCatcher: blocked while a question is open
  // (:260), so its keys bubble to keyRoot and the dialog answers them.
  else keyCatcher.forceActiveFocus()
}
```

`"confirm"` and `"list"` resolve to the same item today, because `askRemove` is only
reachable from the list; the distinction is what makes the rule true if a question is
ever asked over the form, the review or the log, and the table test pins it before that
happens. `keyCatcher.onActiveFocusChanged` (`:262`) re-defers when `mode !== "list"`
and is idempotent here: `focusForMode` reads `confirmOpen` first and hands the keyboard
straight back.

#### y and n are this repository's keys, not the dialog's

`handleKey` (`:26-36`) knows Escape, Left/Right/Tab/Backtab and Return/Enter and
**nothing else** — there is no `y` or `n` anywhere in the file. The intent's promise
that "y, n, Enter and Esc answer it" therefore needs two lines in `keyRoot`'s handler
before it delegates: `y` → `confirmAccepted()`, `n` → `closeConfirm()`, both of which
exist (`:186-195`). `ask()` keeps `confirmDialog.selectedIndex = 0` (`:170-172`): a
write to a declared property, so it stays legal.

A question then owns the keyboard from wherever focus was (finding 1); leaving it
returns focus by mode, not to the filter — the filter *text* survives, its focus does
not.

#### The form's own scope

The form is its own `FocusScope` with its own authority, `focusCurrent()`
(`CreateForm.qml:119-124`). The same rule applies to `fieldIndex`, stated accurately
this time: the first draft claimed it "is written by `moveField()` and nothing else",
which is false — it is written at `:95`, `:133`, `:148`, `:153`, `:327` and `:407`.
The rule is narrower and checkable:

**User navigation writes `fieldIndex` through one helper. Every other writer is
lifecycle, correction or focus synchronisation, and this is the closed list:**

| Site | Why it may write |
| --- | --- |
| `moveField(delta)` / new `moveFieldTo(index)` (`:126-135`) | the only navigation writer; marks the field being left `touched`, resets `listIndex`, clamps, re-focuses |
| `begin()` (`:95`) | lifecycle: a fresh form starts at field 0 |
| `submit()` (`:148`, `:153`) | correction: jump to the first error, or to the kind row when `blocked` |
| `input.onActiveFocusChanged` (`:407`) | synchronisation: Qt focused a field, so the index follows the keyboard rather than fighting it |
| new `onFieldsChanged` clamp | the field set shrank under the cursor |

Anything else is a spec change. That settles three findings:

- the `MouseArea` (`:324-331`) calls `moveFieldTo(fieldItem.index)` instead of
  assigning, so the field being left is marked `touched` and its error appears (6),
  and it drops `activate()`, so a click selects and only space/Enter changes a value
  (4 — the glyph is a state indicator, not a checkbox). Clicking the row that already
  has the cursor then does nothing, which is the point;
- `onFieldsChanged` calls `Model.clampCursor(root.fieldIndex, root.fields.length)`
  **directly** and re-focuses if the index moved, so a shrinking field set cannot
  leave `current` null (5). The first draft said this clamps "through the existing
  `Model.clampCursor` (`MicrovmView.qml:52`)"; that line clamps `cursorIndex`, a
  different property, and #21 is rewriting `onRowsChanged` in parallel. The reused
  thing is the tested pure function (`Model.js:497-502`), not that line. The clamp
  does **not** go through `moveFieldTo`: a field set changing under the user is not the
  user leaving a field, so it must not mark anything `touched`;
- `onAgentFormChanged` calls the form's own `begin()` (`CreateForm.qml:91-97`), which
  already resets `touched`, `listIndex` and `fieldIndex` and re-focuses, so the
  agent's form lands on a form reset to receive it (5, second half).

### 2. A boolean return is a permission answer (finding 2)

`MicrovmState.submit` (`MicrovmState.qml:261-264`) returns `run()`'s answer, and
`run()` refuses while the lock is held at `MicrovmState.qml:217-218`, setting
`lastError` to `busyText()` itself. (The first draft credited `:218` to `submit`; the
refusal is in `run`, which `submit` returns.) `submitForm` (`MicrovmView.qml:110-114`)
throws that away and leaves for the list, taking the form with it.

**The rule: a `MicrovmState` method that returns a boolean has answered whether it
may run. A caller that changes mode on the strength of it must branch on it.**
`submitForm` returns early on false and changes nothing: the user stays where they
were, form or review, every field intact. Nothing new is drawn — the footer's error
row (`:550-595`) is outside the mode switch and already shows `busyText()` in both.

Grepping the view for the same shape: `console_`, `startTerminal`, `logs`, `start` and
`apply` are branched on (`:143-149`, `:161`). `stop`, `restart` (`:150-151`) and
`remove` (`:182`) ignore theirs but change no view state and set `lastError`
themselves — left alone.

The same grep found `MicrovmState.askAgent(text)` (`MicrovmView.qml:356`) refusing
silently at `MicrovmState.qml:335` and `:338`. **That fix is #23's and this spec drops
it:** #23's spec §3 already has `askAgent` "still sets `agentError` on each refusal,
for the IPC and paste paths that skip the key".

### 2a. The agent lifecycle belongs to #23

`openForm` and `openEdit` (`MicrovmView.qml:82-98`) clear `MicrovmState.agentError`
by hand. #23 replaces that with one `resetAgent()` on the singleton, called from
`openForm`, `openEdit`, `setMode` and `dismiss()`. **This issue calls `resetAgent()`
and reintroduces no direct `agentError` write.** Where the two touch the same lines —
`:86`, `:96`, `:123`, `:130` and the `Connections` block at `:362-373` — #23 lands the
lifecycle and PR B lands the cursor reset (`createForm.begin()`), in either order.

### 3. The review does not abbreviate (finding 3)

`MicrovmView.qml:427` cuts every argv to four tokens with nothing marking the cut, on
the one screen whose job is to be believed before a write.

**No token is truncated. Each command is one wrapped line. A token that is byte-
identical to something already shown in full on this screen is replaced by a named
reference to it** — the `opt set` value *is* the snippet drawn at `:413-421`, so it
is rendered as `‹the line above›` rather than printed twice. The `/nix/store/…`
adapter path keeps its existing substitution to `nixarchy-pkg`: that names the
command rather than hiding it.

A pure function, `Model.reviewCommandLines(argvs, snippet, optPath)` → array of
strings, with a Node test. It takes no widths and no card size, so it stays correct at
whatever size #24 derives from the screen. Cost is a few wrapped lines under a snippet
that already wraps.

### 4. Width guards as an interim, layout contract in #24 (findings 7, 8)

`Math.max(0, …)` at `VmList.qml:185`, `CreateForm.qml:266`, `CreateForm.qml:368` and
`LogView.qml:76` is a guard, not a fix. Three corrections to the first draft, all
verified:

- **`LogView.qml:342` does not exist.** `LogView.qml` is 130 lines. The real site in
  that file is `:76`, `width: parent.width - Style.space(120)`, which has no
  `Math.min` at all and no floor — the first draft listed it as an aside and invented
  a second one. There are four sites, not five. The approved intent carries the same
  bad citation, and #24's spec §5a copied it from here; both should drop it.
- **The guard does not make the name visible.** `Math.max(0, …)` turns a negative
  width into a zero one, and a zero-width `Text` is just as invisible. What it buys is
  that Qt stops being handed a negative geometry — a logged warning and undefined
  layout. Restoring the name needs the structural fix, so the first draft's live check
  7 ("the VM name is visible, elided if long") was not this issue's to promise; it is
  corrected below.
- **The owner has ruled on scaling.** #24 removes the 1.45× entirely and owns the
  final layout contract for `VmList.qml`, `CreateForm.qml` and `LogView.qml`. **This
  issue yields on scaling and defers every final width and height to #24.** The
  approved intent's constraint "a fix has to hold at 456 px and at 1.45×" is
  superseded: there is no 1.45×, and 456 px stops being a fixed number
  (#24 spec §3, §4, §6). Verification below reads #24's screen-derived card instead.

The structural fix is that `identity` (`VmList.qml:169-173`) is anchored between two
siblings, so a wide `rowActions` drives its width negative and every child inherits
that; a layout sized from a budget cannot produce it. #24's spec §5a has adopted this
issue's invariant —

> No width expression in either surface may evaluate below zero at the narrowest card
> the host will hand the view.

— in the stronger form that the rework makes a negative width *unreachable* rather
than clamped, and states that removing the guards along with the arithmetic is
correct. Agreed, and the first draft's description of #24 as at "no spec, no plan" is
struck: both specs were drafted in the same pass and #24's exists.

**Do the guards still ship?** Yes, in PR C, as an interim: four single-token edits
that stop a logged negative geometry today, in an independently abandonable PR, while
#24 is a structural rework needing live verification on both surfaces. If #24 lands
first, C's four guard hunks are **dropped**, not rebased — the arithmetic is gone and
there is nothing left to floor.

Finding 8 is the same class one level up, and is **not** #24's: `keysText`
(`MicrovmView.qml:637-646`) has neither width nor elide while `countsText` (`:624-635`)
anchors to it and does, so the legend squeezes the counts to nothing. That is a
missing `elide` in this repository's own footer, not a card dimension. The legend
gives way first — it is the repeatable information, the counts are not. Give `keysText`
a maximum of roughly half the row and `elide: Text.ElideRight`.

### 5. The sheet gets the missing entries, and a drift alarm (finding 9)

Not a derivation. Making the key handlers read `Model.SHORTCUTS` would be a
dispatch-table refactor across four QML files for a documentation bug, and the
bindings that matter most — the VM group — are already derived, through
`actionsFor`/`verbForKey` (`Model.js:1166`, `:1223`), where the bug cannot recur.

So: add the entries to `SHORTCUTS` (`Model.js:34-66`) — log PageUp/PageDown
(`LogView.qml:49-50`) and ↑/↓ (`:47-48`, which the intent cites as `:315-316` and
`:313-314`; those lines do not exist), form j/k (`CreateForm.qml:221-222`), Tab and
Shift+Tab panel switching (`MicrovmView.qml:277`), the inline picker
(`CreateForm.qml:483`), and — new, because §1 makes them real keys — a Question group
for y, n, enter and esc.

The test is a **drift alarm, not a proof of coverage**, and the first draft
overclaimed it. Its grammar, and what it cannot see:

- **It reads only this repository's `.qml` files.** It collects `Qt.Key_<Name>`
  tokens, comparisons against `event.text`, and the letters of `handleTextKey`'s
  `"esrlmxy"` (`MicrovmView.qml:230`).
- **Aliases are a hand-written map in the test**, not derived: `e` → the `enter`
  verb (`:230`), `Qt.Key_Backtab` → `shift+tab`, `Qt.Key_G`/`Qt.Key_End` → `G  end`,
  the arrow names → `↑ ↓`.
- **Host-bound keys are an explicit allowlist, not a finding.** j, k, h, l, x, space,
  Enter, Escape, Tab and the arrows are bound in
  `$OMARCHY_PATH/shell/Ui/PanelKeyCatcher.qml:51-83`, a file this repository does not
  ship and the scan cannot read; the allowlist names it as the binder. Escape, the
  arrows, Tab/Backtab and Enter in the confirmation are likewise
  `ConfirmDialog.qml:26-36`.
- **It does not see** mouse-only actions (every row button, the hero's three
  `PanelActionButton`s, the picker's `MouseArea` at `CreateForm.qml:435-438`), mode
  dependence (j/k navigate a switch row and type into a text field), or the footer
  hint strings.

It asserts both directions: every key the scan finds has an entry, and every key an
entry names is in the scan or the allowlist. That kills the class of bug the intent
found — a key bound in this repo's QML and absent from the sheet — and nothing wider.

The form's j/k is mode-dependent and the sheet says so in the entry's own text —
"Move between fields; on a text field they type instead, so use tab or the arrows".
One line, true in both cases, and it is the line the docs quote.

### 6. Three PRs

- **A — confirmation and submit** (1, 2, 3): `MicrovmView.qml`, `Model.js`
  (`focusTarget`, `reviewCommandLines`), tests. The data-loss and keyboard-lockout
  fixes, first. No `MicrovmState.qml` change any more: the one it had is #23's.
- **B — form focus** (4, 5, 6): `CreateForm.qml`, plus the `Connections` block at
  `MicrovmView.qml:362-373`, which is the one file both PRs touch and which #23 also
  edits. Applies A's rule in the form's scope; depends on A for the statement, not
  for code.
- **C — what is drawn and what is documented** (7, 8, 9): the four width guards, the
  footer elide, the `SHORTCUTS` entries and their drift alarm, `docs/usage.md` and
  the README.

One PR would put a keyboard change needing live verification in the same diff as four
`Math.max` calls. C is the one touching #24's files, so it has to be able to land, or
be abandoned, without holding A hostage.

## Alternatives rejected

- **Focus `keyRoot` itself instead of `keyCatcher`.** More honest on paper — the item
  whose handler answers would own the keyboard. Rejected: `keyRoot` is a plain `Item`
  with `focus` defaulting false, sitting in the same focus scope as `keyCatcher`'s
  `focus: true` (`PanelKeyCatcher.qml:46`), so which of the two ends up with scope
  focus is a question this repository cannot answer without a running shell.
  `keyCatcher` is the item both existing modes already focus, and the bubble to
  `keyRoot` is the path the code is written around (`MicrovmView.qml:245-247`).
- **Give `ConfirmDialog` a focus target upstream** (`docs/upstream.md`). Correct in
  the long run; rejected for now, since it blocks a data-loss fix on someone else's
  release and `handleKey` is a workable contract as it stands.
- **Patch the four focus sites independently.** Smaller diff, same assumption left in
  place: the next site to write `fieldIndex` or open an overlay reintroduces it.
  Finding 5 is already finding 1's mistake a second time in another file.
- **Drop the width guards entirely and let #24 carry 7 and 8.** The right answer for
  7's *structure*; rejected for the guards on the grounds in §4, and rejected outright
  for 8, a missing `elide` in this repository's footer with nothing to do with card
  size.
- **Restructure the row into a layout now.** Correct, and a direct collision with
  #24 in the three files it owns. Rejected on ownership, not on merit.
- **Derive every binding from `Model.SHORTCUTS`.** Rejected in §5: refactor cost far
  above the bug, and the alarm buys the guarantee that matters.
- **Elide the review's argv with a count.** Rejected: on the screen whose job is to be
  believed, "and 3 more" is the same half-truth the current `slice(0, 4)` is.
- **Show a new message on a refused submit.** Rejected: the footer already shows
  `busyText()` in every mode, and a second message in the review would be two places
  saying one thing.
- **Fix `askAgent`'s silent refusals here.** Rejected in §2: #23 owns it.

## Risks

- **`"confirm"` resolving to `keyCatcher` is reasoned from the host's source, not from
  a running shell.** The chain — `focus: true`, `blocked`, nothing accepted, bubble to
  `keyRoot` — is quoted link by link above, but check 1 below is the first thing to
  run; if a key still reaches the filter, focus `keyRoot` instead (priced above).
- **#24 owns three of the files C touches.** Mitigated by the shared invariant in §4
  and #24 §5a, and by C being abandonable, guard hunks included.
- **#23 owns the agent lifecycle and edits four of the same lines.** Mitigated by
  §2a: this issue calls `resetAgent()` and writes no `agentError`.
- **#21 is rewriting `MicrovmView.qml:52`.** The form's clamp calls
  `Model.clampCursor` directly and does not depend on that line's shape.
- **Focus in a keep-loaded surface.** `open()` → `reset()` →
  `Qt.callLater(focusForMode)` (`MicrovmView.qml:59-70`) now has a branch that reads
  `confirmOpen`. `reset()` calls `closeConfirm()` *before* the deferred call, so the
  ordering is already right — but the new branch must be read in that order, and
  `keyCatcher.onActiveFocusChanged` (`:262`) re-defers too. Wrong ordering costs the
  keyboard on open, on both surfaces.
- **Escape while the filter has text changes meaning** when a question is open: today
  it clears the filter, after the fix it cancels the question. Intended, and still a
  change to a learned key.
- **The `?` sheet and the footer hints are separate strings.** `Model.shortcutGroups()`
  feeds only `ShortcutSheet.qml`; the footer legends at `MicrovmView.qml:641` and
  `CreateForm.qml:477-487` are hand-written and the drift alarm does not check them.
  They can still drift; this issue does not close that.
- **The confirmation's appearance is unchanged**, deliberately — only who can answer
  it changes. It survives #24 untouched: its card is already
  `Math.min(parent.width - Style.space(32), Style.space(370))`
  (`ConfirmDialog.qml:51`), derived from its host. Drift there lands on the delete
  path, the one destructive key.
- The intent's two deferred findings (a second `ask()` while one is open; the literal
  `"transparent"` at `VmList.qml:151,196`) stay out; the second belongs to #26.

## Verification

**Node (`node tests/run.js`), no desktop:**

- `Model.focusTarget` over the full table: list/form/review/log × `confirmOpen`
  true/false — every true case returns `"confirm"`. The test that catches finding 1.
- `Model.reviewCommandLines`: no output token is a prefix of its input token; the argv
  element equal to the snippet renders as the reference and not as the text; a
  `/nix/store/…` first token renders as `nixarchy-pkg`; an empty argv list yields an
  empty array.
- `SHORTCUTS` drift alarm, both directions, with the allowlist and alias map of §5
  written out in the test so what it does not cover is readable there too.
- `fieldIndex` clamping reuses `Model.clampCursor` (`Model.js:497-502`), already
  tested — no new test.

**Live, on a nixarchy desktop** (install per AGENTS.md "Verifying live"; both
surfaces, popup first, since 7 and 8 show at the narrowest card). `wtype` types into
whatever has focus: confirm a plugin layer is up in `hyprctl layers -j` before every
send, and send each take as one `wtype` process. Steps 7 and 8 read the card #24
derives from the screen — measure it, per AGENTS.md as #24 rewrites it, rather than
assuming 456 px.

1. Press `/`, type something, then click a row's ✗ with the mouse. y, n, Enter and
   Esc each answer the question; Esc no longer clears the filter while it is open;
   the filter text is still there afterwards and the cursor is back on the list.
2. `s` on a disposable VM so a build streams; `c`, fill a permanent VM, Enter, Enter at
   the review. Every field is still there, the footer shows the busy text, and Enter
   after the build completes writes the line.
3. At the review, read the "Runs:" block: the full `opt set` command, with the value
   shown as the reference to the snippet above it. Read it on both surfaces.
4. `c`, click the "Kind" row: the cursor moves, the kind does not flip. Space flips it.
   Click it again: still nothing.
5. Permanent form with assist on: Enter on describe, Tab to sshKey, reply with
   `kind: "disposable"`. The cursor is on a real field, the footer hint is not blank,
   and space works without a Tab first.
6. Type an invalid name, click another field: the name's error shows.
7. Popup, a permanent row with five buttons: `qs log -i <instance>` reports no
   negative-width or invalid-geometry warning for the row. The name being *readable*
   again at that width is #24's check, not this one's.
8. Assist and apply both enabled, popup: the legend elides, the counts do not vanish.
9. `?` on both surfaces: the new entries are there, the Question group included, and
   the form's j/k line reads true on a text field and on a switch row.
