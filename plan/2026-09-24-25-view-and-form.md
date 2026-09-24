---
status: approved
issue: 25
spec: spec/2026-09-24-25-view-and-form.md
---

# Plan: one focus owner, one refusal rule, a review that does not abbreviate

Nine findings, three rules, three PRs.

**One focus owner per state.** Exactly one item holds the keyboard at any moment, and
which one is a pure function of the state, never of what held it last.
`focusForMode()` (`MicrovmView.qml:74-79`) is that function and becomes
`Model.focusTarget({mode, confirmOpen})` → `"confirm" | "log" | "form" | "review" |
"list"`. `"confirm"` focuses `keyCatcher`, **not** the dialog: `ConfirmDialog.qml:4`
is a plain `Item`, not a `FocusScope`, with no `focus` property and no `Keys` handler,
so it cannot hold focus. `keyCatcher` is `focus: true` (`PanelKeyCatcher.qml:46`) and
returns immediately while `blocked` (`:49`), so its keys bubble to
`keyRoot.Keys.onPressed` (`MicrovmView.qml:252-255`), which delegates to
`confirmDialog.handleKey`. The focus call exists to take the keyboard **off** the
filter. `handleKey` (`ConfirmDialog.qml:23-39`) knows only Escape,
Left/Right/Tab/Backtab and Return/Enter, so the intent's y and n are this
repository's keys and need two new lines in `keyRoot`.

The same rule governs `fieldIndex`: one navigation writer, `moveField(delta)` / the
new `moveFieldTo(index)`, and a closed list of four others — `begin()`
(`CreateForm.qml:95`), `submit()` (`:148`, `:153`), `input.onActiveFocusChanged`
(`:407`), and the new `onFieldsChanged` clamp. That clamp calls `Model.clampCursor`
(`Model.js:497`) **directly** and marks nothing `touched`: a field set shrinking under
the user is not the user leaving a field.

**A boolean return is a permission answer.** `MicrovmState.submit`
(`MicrovmState.qml:261-264`) returns `run()`'s answer, and `run()` refuses while the
lock is held (`:217-218`), setting `lastError` to `busyText()`. `submitForm`
(`MicrovmView.qml:110-114`) branches on it and changes nothing when it is false.
Nothing new is drawn: the footer's error row (`:550-595`) is outside the mode switch.
`askAgent`'s silent refusals are #23's, not this issue's.

**The review does not abbreviate.** No token truncated, one wrapped line per command,
and a token byte-identical to something already shown in full becomes a named
reference to it. Pure `Model.reviewCommandLines(argvs, snippet, optPath)`.

**Layout is interim only.** The four `Math.max(0, …)` guards stop Qt being handed a
negative geometry. They do **not** make the name visible — a zero-width `Text` is as
invisible as a negative-width one. #24 owns the layout contract and supersedes them.

## Steps

### PR A — confirmation and submit (findings 1, 2, 3)

`MicrovmView.qml`, `Model.js`, tests, docs. The data-loss and keyboard-lockout fixes.
No `MicrovmState.qml` change.

1. `Model.js`: add `focusTarget(state)` returning `"confirm"` when `state.confirmOpen`,
   else `state.mode` when it is `"log"`, `"form"` or `"review"`, else `"list"`; export
   it. → verify by the new Node table test in step 2's file (`node tests/run.js`).
2. `tests/model/form.test.js`: one `test()` over the full table — `list|form|review|log`
   × `confirmOpen` true/false, eight cases, every true case `"confirm"`; plus an
   unknown mode with `confirmOpen: false` → `"list"`. → verify by `node tests/run.js`
   showing 71 passed.
3. `MicrovmView.qml:74-79`: `focusForMode()` switches on
   `Model.focusTarget({ mode: root.mode, confirmOpen: root.confirmOpen })`, with
   `"confirm"` and `"list"` both falling through to `keyCatcher.forceActiveFocus()`
   and a comment saying why. `ask()` (`:166-174`) and `closeConfirm()` (`:191-194`)
   each end with `Qt.callLater(root.focusForMode)`; `ask()` keeps
   `confirmDialog.selectedIndex = 0`. `reset()` (`:59-70`) already calls
   `closeConfirm()` before its own deferred call, so the ordering holds — do not
   reorder it. → verify by live check 1.
4. `MicrovmView.qml:252-255`: in `keyRoot.Keys.onPressed`, before the delegation, add
   ```qml
   if (event.text === "y") { root.confirmAccepted(); event.accepted = true; return }
   if (event.text === "n") { root.closeConfirm(); event.accepted = true; return }
   ```
   after the existing `if (!root.confirmOpen) return`. Both functions exist
   (`:186-195`). → verify by live check 1.
5. `MicrovmView.qml:110-114`: `submitForm(form)` becomes
   `if (!MicrovmState.submit(form)) return` before `root.reviewForm = null` and
   `setMode("list")`, so a refused submit clears nothing and moves nowhere. The
   review's Enter (`:386`) calls the same function and inherits the fix. → verify by
   live check 2.
6. `Model.js`: add `reviewCommandLines(argvs, snippet, optPath)` → one string per
   argv, tokens joined with a space, no `slice`; a first token starting with `/`
   renders as `nixarchy-pkg`; a token `=== snippet` renders as `‹the line above›`;
   a token `=== optPath` is left alone. Export it. `MicrovmView.qml:427` renders
   `Model.reviewCommandLines(root.reviewArgvs, root.reviewSnippet,
   root.reviewForm ? Model.optPath(root.reviewForm.name) : "").join("\n")`, prefixed
   `"Runs:\n"`, `wrapMode: Text.WrapAnywhere`. Add one `test()` in
   `tests/model/commands.test.js`: no output token is a prefix of its input token;
   the snippet argument renders as the reference and not as its text; a
   `/nix/store/…` first token renders as `nixarchy-pkg`; `[]` → `[]`. → verify by
   `node tests/run.js` showing 72 passed, and live check 3.
7. `Model.js` `SHORTCUTS` (`:34-66`): add the Question group. *(Deviation,
   recorded at implementation: adding a group also changes
   `rows.test.js:115`, which pins the exact group order — the plan said the
   total would stay at 72 and did not mention that existing assertion. The
   order becomes Move, VM, All VMs, Panel, Question, Form, Log, and the test is
   updated in the same commit.)* Two entries, because
   `tests/model/form.test.js:159` caps `keys` at 12 characters:
   `{ group: "Question", keys: "y  enter", text: "Answer yes" }` and
   `{ group: "Question", keys: "n  esc", text: "Answer no (the default)" }`. Add the
   same two rows to the README's key tables and a sentence to `docs/usage.md`'s
   "### Delete" (`:200-205`) saying the question can be answered from the keyboard
   with y, n, enter or esc. → verify by `node tests/run.js` (still 72) and live
   check 9.

### PR B — form focus (findings 4, 5, 6)

`CreateForm.qml`, plus the `Connections` block at `MicrovmView.qml:362-373` — the one
region A and B share. A touches `:74-79`, `:110-114`, `:166-195`, `:252-255` and
`:427` and never the `Connections` block, so the two do not collide textually; land A
first anyway, since B applies A's rule and cites it. #23 also edits this block.

8. `CreateForm.qml:126-135`: split `moveField(delta)` into `moveFieldTo(index)` —
   marks `root.current.key` `touched`, sets `listIndex = -1`, writes
   `root.fieldIndex = Model.clampCursor(index, root.fields.length)`, defers
   `focusCurrent` — with `moveField(delta)` becoming
   `moveFieldTo(root.fieldIndex + delta)`. → verify by `node tests/run.js` unchanged
   and live check 6.
9. `CreateForm.qml:324-331`: the field `MouseArea`'s `onClicked` becomes
   `root.moveFieldTo(fieldItem.index)` and nothing else — drop the direct
   `root.fieldIndex` write, drop `root.activate()`, drop the trailing
   `Qt.callLater(root.focusCurrent)` that `moveFieldTo` now owns. A click selects;
   only space or enter changes a value. → verify by live checks 4 and 6.
10. `CreateForm.qml:57`: add
    `onFieldsChanged: { var at = Model.clampCursor(root.fieldIndex, root.fields.length);
    if (at !== root.fieldIndex) { root.fieldIndex = at; Qt.callLater(root.focusCurrent) } }`.
    Not through `moveFieldTo`: nothing is marked `touched`. In
    `MicrovmView.qml:364-372`, after `createForm.setForm(got.form)` and
    `createForm.reasoning = got.reasoning`, call `createForm.begin()`, then set
    `createForm.attempted = true` (`begin()` clears it, `:92`) and drop the trailing
    `Qt.callLater(createForm.focusCurrent)`, which `begin()` already defers. Leave the
    existing `MicrovmState.agentError` write at `:370` for #23; add no new one. If #23
    has landed, `openForm`/`openEdit` (`:86`, `:96`) call `MicrovmState.resetAgent()`
    instead of assigning `agentError`; if it has not, leave those two lines untouched
    rather than inventing the function. → verify by live check 5.

### PR C — what is drawn and what is documented (findings 7, 8, 9)

Abandonable on its own. **If #24 has merged, step 11 is dropped entirely, not
rebased** — the arithmetic is gone and there is nothing left to floor. Steps 12–14
are unaffected: the footer elide and the sheet are this repository's, not #24's.

11. Wrap four width expressions in `Math.max(0, …)`: `VmList.qml:185`,
    `CreateForm.qml:266`, `CreateForm.qml:368`, and `LogView.qml:76` (which has no
    `Math.min` today — it becomes `Math.max(0, parent.width - Style.space(120))`).
    Four sites; `LogView.qml:342` does not exist, the file is 130 lines. → verify by
    live check 7.
12. `MicrovmView.qml:637-646`: give `keysText` `width: Math.min(implicitWidth,
    parent.width / 2)` and `elide: Text.ElideRight`, so the legend gives way before
    `countsText` (`:624-635`), which already elides. → verify by live check 8.
13. `Model.js` `SHORTCUTS`: add Log `PageUp  PageDn` scroll and `↑ ↓` scroll
    (`LogView.qml:47-50`); Form `j  k` — "Move between fields; on a text field they
    type instead, so use tab or the arrows" (`CreateForm.qml:221-222`); Panel
    `tab  shift+tab` panel switching (`MicrovmView.qml:277`); Form `↓` into the
    inline picker (`CreateForm.qml:483`). Keep every `keys` string ≤ 12 characters.
    → verify by `node tests/run.js` and live check 9.
14. New `tests/model/keys.test.js`: one `test()`, the drift alarm of the spec's §5,
    with its allowlist and alias map written out in the file. Update the README's
    list/form/log tables and `docs/usage.md` for the entries added in step 13 —
    the README's form row for `j` `k` (`README.md:98`) is reworded to the sheet's new
    text. → verify by `node tests/run.js` showing 73 passed.

## Tests

**Node — `node tests/run.js`, today 70 passed, 0 failed.** Three new `test()` calls,
one per new pure function plus the alarm: `focusTarget` (step 2), `reviewCommandLines`
(step 6), the drift alarm (step 14). The harness counts one pass per `test()`
(`tests/harness.js:25-32`), so the end state is **73 passed, 0 failed** — 71 after A's
step 2, 72 after A's step 6, 73 after C's step 14. The `fieldIndex` clamp adds no test:
it reuses `Model.clampCursor`, already covered.

The drift alarm's grammar and its blind spots are written into the test file, per the
spec's §5: it scans only this repository's `.qml` files, its aliases are a hand-written
map, and its allowlist names `PanelKeyCatcher.qml:51-83` and `ConfirmDialog.qml:26-36`
as the binder of the host keys it cannot see. Both directions asserted.

**Live, per AGENTS.md "Verifying live".** Stop the shell, `cp -rL result` into
`~/.config/omarchy/plugins/nixarchy.microvm`, restart, wait for
`omarchy-shell shell ping`, and confirm the bar is healthy (`pluginBarApiFor` count 0,
`target omarchy.bar` count 1) before anything else. Popup first — 7 and 8 show at the
narrowest card; measure that card rather than assuming 456 px, since #24 derives it
from the screen.

`wtype` types into whatever has focus, and a stray Enter on the list row under the
cursor starts that VM in a terminal, which then takes the rest of the take. Before
every send: check the ai-mirror grant is held and `hyprctl layers -j` shows
`omarchy-keyboard-panel` or `nixarchy-microvm-menu`, park the pointer off the card
with `hl.dsp.cursor.move`, and send the whole take as one `wtype` process under
`timeout` with `-s` delays (`-` as `-k minus`). Test VMs are `t1`, `t2`, removed with
`nixarchy vm rm`; the permanent one is a single `p1` line, removed with
`nixarchy-opt-remove programs.nixarchy.services.microvm.machines.p1`. Never run
`nixarchy-apply`.

1. Press `/`, type something, then click a row's ✗ with the mouse. y, n, enter and esc
   each answer it; esc no longer clears the filter while the question is open; the
   filter text survives and the cursor is back on the list. (A, steps 3–4.)
2. `s` on a disposable VM so a build streams; `c`, fill a permanent VM, enter, enter at
   the review. Every field is still there, the footer shows the busy text, and enter
   after the build completes writes the line. (A, step 5.)
3. At the review, on both surfaces: the full `opt set` command, its value shown as the
   reference to the snippet above it, no token cut. (A, step 6.)
4. `c`, click the "Kind" row: the cursor moves, the kind does not flip. Space flips it.
   Click it again: still nothing. (B, step 9.)
5. Permanent form, assist on: enter on describe, tab to sshKey, reply with
   `kind: "disposable"`. The cursor lands on a real field, the footer hint is not
   blank, and space works without a tab first. (B, step 10.)
6. Type an invalid name, click another field: the name's error shows. (B, steps 8–9.)
7. Popup, a permanent row with five buttons: `qs log -i <instance>` reports no
   negative-width or invalid-geometry warning for the row. The name being *readable*
   again is #24's check, not this one's. (C, step 11.)
8. Assist and apply both enabled, popup: the legend elides, the counts do not vanish.
   (C, step 12.)
9. `?` on both surfaces: the Question group is there, and the form's j/k line reads
   true on a text field and on a switch row. (A step 7, C steps 13–14.)

## Rollback

Three PRs, three independent reverts; none depends on another's code.

- **A** — `git revert` the merge. `Model.focusTarget` and `Model.reviewCommandLines`
  go with it and nothing else calls them. The confirmation returns to being
  mouse-only and a refused submit to discarding the form; no data written by A needs
  undoing.
- **B** — revert alone. `moveFieldTo` is new and only the `MouseArea` and `moveField`
  call it; the `onFieldsChanged` clamp is one binding. The `Connections` edit reverts
  to the three lines it replaced. If #23 landed in between and B's step 10 swapped in
  `resetAgent()`, revert that hunk by hand to `resetAgent()`'s new form rather than to
  the `agentError` assignment.
- **C** — revert alone, or abandon before merge. The four guards are single tokens,
  the elide is two properties, `SHORTCUTS`/`keys.test.js`/docs are one list and its
  alarm. Reverting C takes `tests/run.js` back to 72.
