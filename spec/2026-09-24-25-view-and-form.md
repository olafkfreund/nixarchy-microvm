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
and not the confirmation, which is a fifth owner: `keyRoot` (`:248-255`) is the item
whose `Keys.onPressed` feeds `confirmDialog.handleKey`, and the catcher already goes
`blocked` for it (`:260`). `ask()` and `closeConfirm()` become state changes like any
other: set the flag, then re-ask. A question then owns the keyboard from wherever
focus was (finding 1); leaving it returns focus by mode, not to the filter — the
filter *text* survives, its focus does not.

The branch moves to `Model.focusTarget({mode, confirmOpen})` →
`"confirm" | "log" | "form" | "review" | "list"`. Six lines, and it is the branch that
was incomplete; a Node table test over every state is the only way to catch a missing
case without a running shell.

The form is its own `FocusScope` and keeps its own authority, `focusCurrent()`
(`CreateForm.qml:119-124`), with the same rule for `fieldIndex`: **it is written by
`moveField()` and nothing else.** That settles three findings at once:

- the `MouseArea` calls `moveField`-with-a-target instead of assigning, so the field
  being left is marked `touched` and its error appears (6), and it drops `activate()`,
  so a click selects and only space/Enter changes a value (4 — the glyph is a state
  indicator, not a checkbox);
- `onFieldsChanged` re-asks the same setter, which clamps through the existing
  `Model.clampCursor` (`MicrovmView.qml:52`, already tested), so a shrinking field set
  cannot leave `current` null (5);
- `onAgentFormChanged` calls the form's own `begin()` (`CreateForm.qml:91-97`), which
  already resets `touched`, `listIndex` and `fieldIndex` and re-focuses, so the
  agent's form lands on a form reset to receive it (5, second half).

### 2. A boolean return is a permission answer (finding 2)

`MicrovmState.submit` returns false while the lock is held (`MicrovmState.qml:218`)
and sets `lastError` to `busyText()` itself. `submitForm` (`MicrovmView.qml:110-114`)
throws that away and leaves for the list, taking the form with it.

**The rule: a `MicrovmState` method that returns a boolean has answered whether it
may run. A caller that changes mode on the strength of it must branch on it.**
`submitForm` returns early on false and changes nothing: the user stays where they
were, form or review, every field intact. Nothing new is drawn — the footer's error
row (`:550-595`) is outside the mode switch and already shows `busyText()` in both.

Grepping the view for the same shape: `console_`, `startTerminal`, `logs`, `start` and
`apply` are branched on (`:143-149`, `:161`). `stop`, `restart` (`:150-151`) and
`remove` (`:182`) ignore theirs but change no view state and set `lastError`
themselves — left alone. One real second offender, not in the intent, found by this
grep: **`MicrovmState.askAgent(text)` (`MicrovmView.qml:356`) returns false at
`MicrovmState.qml:335` and `:338` without setting `agentError`.** Enter on describe
with the agent already running, or with no schema, does nothing and says nothing. One
line in `askAgent` — give those two refusals the text the third already has — and it
ships with this cluster.

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
strings, with a Node test. It takes no widths and no card size: the review reads
correctly at 456 px and at 1.45× because it never measures anything, which is also how
it stays correct whatever #24 does to card widths. Cost in the popup is a few wrapped
lines under a snippet that already wraps.

### 4. Width guards now, layout rework in #24 (findings 7, 8)

`Math.max(0, …)` at `VmList.qml:185`, `CreateForm.qml:266`, `CreateForm.qml:368` and
`LogView.qml:342` (plus `LogView.qml:76`, `parent.width - Style.space(120)` with no
`Math.min` at all, same defect) is a guard, not a fix. The fix is that `identity`
(`VmList.qml:169-173`) is anchored between two siblings, so a wide `rowActions` drives
its width negative and every child inherits that; a layout with an explicit minimum
could not produce it. **That restructuring is #24's.** #24's approved intent already
names `VmList.qml:27`, `CreateForm.qml:273`, `LogView.qml:98` and the 1.45× transform,
and it is at approved-intent only — no spec, no plan, no code on
`fix/24-surface-scaling`. So this issue ships the guards and hands #24 the invariant:

> No width expression in either surface may evaluate below zero at a 456 px card.

The guards are single-token edits on lines #24 will rewrite; a rewrite that removes
them removes the arithmetic too, and #24's spec is expected to cite this invariant
rather than re-derive it. That is cheaper than serialising the two issues or
splitting files between them.

Finding 8 is the same class one level up: `keysText` (`MicrovmView.qml:637-647`) has
neither width nor elide while `countsText` anchors to it and does, so the legend
squeezes the counts to nothing. The legend gives way first — it is the repeatable
information, the counts are not. Give `keysText` a maximum of roughly half the row
and `elide: Text.ElideRight`.

### 5. The sheet gets the four missing entries, and a test that it cannot happen again (finding 9)

Not a derivation. Making the key handlers read `Model.SHORTCUTS` would be a
dispatch-table refactor across four QML files for a documentation bug, and the
bindings that matter most — the VM group — are already derived, through
`actionsFor`/`verbForKey` (`Model.js:1166`, `:1223`), where the bug cannot recur. What
is missing is a check, not a mechanism.

So: add the four entries to `SHORTCUTS` (`Model.js:34-66`) — log PageUp/PageDown and
↑/↓, form j/k, Tab/Shift+Tab panel switching, the inline picker — and add a Node test
that scans the QML sources for bound keys (`Qt.Key_*` in `Keys.onPressed`, the letters
in `handleTextKey`'s `"esrlmxy"`) and asserts each appears in some entry. The class of
bug dies in CI, at the cost of one test rather than a refactor.

The form's j/k is mode-dependent and the sheet says so in the entry's own text —
"Move between fields; on a text field they type instead, so use tab or the arrows".
One line, true in both cases, and it is the line the docs quote.

### 6. Three PRs

- **A — confirmation and submit** (1, 2, 3, plus the silent `askAgent` refusal):
  `MicrovmView.qml`, `MicrovmState.qml`, `Model.js` (`focusTarget`,
  `reviewCommandLines`), tests. The data-loss and keyboard-lockout fixes, first.
- **B — form focus** (4, 5, 6): `CreateForm.qml`, plus the three-line `Connections`
  block at `MicrovmView.qml:362-373`, which is the one file both PRs touch. Applies
  A's rule in the form's scope; depends on A for the statement, not for code.
- **C — what is drawn and what is documented** (7, 8, 9): the width guards, the
  footer elide, the `SHORTCUTS` entries and their coverage test, `docs/usage.md` and
  the README.

One PR would put a keyboard change needing live verification in the same diff as four
`Math.max` calls. Four would split 7/8 from 9 for nothing — both are "the panel tells
the truth about itself", both are one file plus docs. C is the one touching #24's
files, so it has to be able to land, or be abandoned, without holding A hostage.

## Alternatives rejected

- **Patch the four focus sites independently.** Smaller diff, same assumption left in
  place: the next site to write `fieldIndex` or open an overlay reintroduces it.
  Finding 5 is already finding 1's mistake a second time in another file.
- **`Math.max(0, …)` as the whole answer to finding 7.** Right edit, wrong claim: the
  container can still go negative and every future child of `identity` inherits it.
  Taken as a guard, the structural fix assigned to #24 as a written invariant.
- **Restructure the row into a layout now.** Correct, and a direct collision with
  #24 in the three files it is already scoped to rework. Rejected on sequencing, not
  on merit.
- **Derive every binding from `Model.SHORTCUTS`.** Rejected in §5: refactor cost far
  above the bug, and a test buys the same guarantee.
- **Elide the review's argv with a count.** Rejected: on the screen whose job is to be
  believed, "and 3 more" is the same half-truth the current `slice(0, 4)` is.
- **Show a new message on a refused submit.** Rejected: the footer already shows
  `busyText()` in every mode, and a second message in the review would be two places
  saying one thing.

## Risks

- **#24 overlaps in `VmList.qml`, `CreateForm.qml` and `LogView.qml`.** C's guards sit
  on lines #24 rewrites. Mitigated by the invariant above being part of this spec and
  cited by #24's, and by C being an independently abandonable PR.
- **Focus in a keep-loaded surface.** `open()` → `reset()` → `Qt.callLater(focusForMode)`
  (`MicrovmView.qml:59-70`) now has a branch that can claim focus for a dialog.
  `reset()` calls `closeConfirm()` *before* the deferred call, so the ordering is
  already right — but the new branch must be read in that order, and
  `keyCatcher.onActiveFocusChanged` (`:262`) re-defers too. Wrong ordering costs the
  keyboard on open, on both surfaces.
- **Escape while the filter has text changes meaning** when a question is open: today
  it clears the filter, after the fix it cancels the question. Intended, and still a
  change to a learned key.
- **The `?` sheet and the footer hints are separate strings.** `Model.shortcutGroups()`
  feeds only `ShortcutSheet.qml`; the footer legends at `MicrovmView.qml:641` and
  `CreateForm.qml:477-487` are hand-written and the new coverage test does not check
  them. They can still drift; this issue does not close that.
- **The confirmation's appearance is unchanged**, deliberately — only who can answer
  it changes. Drift there lands on the delete path, the one destructive key.
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
- `SHORTCUTS` coverage: scan the QML sources for bound keys, assert each has an entry
  and that every entry's keys are bound somewhere (the sheet has no phantom keys
  today; the test keeps it that way).
- `fieldIndex` clamping reuses `Model.clampCursor`, already tested — no new test.

**Live, on a nixarchy desktop** (install per AGENTS.md "Verifying live"; both surfaces,
popup first, since 7 and 8 only show at 456 px). `wtype` types into whatever has focus:
confirm a plugin layer is up in `hyprctl layers -j` before every send, and send each
take as one `wtype` process.

1. Press `/`, then click a row's ✗ with the mouse. y, n, Enter and Esc each answer the
   question; Esc no longer clears the filter while it is open.
2. `s` on a disposable VM so a build streams; `c`, fill a permanent VM, Enter, Enter at
   the review. Every field is still there, the footer shows the busy text, and Enter
   after the build completes writes the line.
3. At the review, read the "Runs:" block: the full `opt set` command, with the value
   shown as the reference to the snippet above it. Check at 456 px and at 1.45×.
4. `c`, click the "Kind" row: the cursor moves, the kind does not flip. Space flips it.
5. Permanent form with assist on: Enter on describe, Tab to sshKey, reply with
   `kind: "disposable"`. The cursor is on a real field, the footer hint is not blank,
   and space works without a Tab first.
6. Type an invalid name, click another field: the name's error shows.
7. Popup, a permanent row with five buttons: the VM name is visible, elided if long.
8. Assist and apply both enabled, popup: the legend elides, the counts do not vanish.
9. `?` on both surfaces: the four new entries are there and the form's j/k line reads
   true on a text field and on a switch row.
