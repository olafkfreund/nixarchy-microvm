---
status: draft
issue: 46
spec: spec/2026-11-16-46-review-findings.md
coders:
  1: codex   # small, tricky validation logic (name rules per kind, edit vs create)
  2: coder   # one QML Text plus moving keysMatching into Model.js
  3: codex   # numeric port comparison and the mount set, in a fixture-heavy test file
  4: coder   # a one-string argv change and two tests
  5: coder   # QML and Model plumbing for the list failure
  6: codex   # removal detection is subtle (marker, unit/no-unit, reason order)
  7: codex   # the console rule and the pendingSync generation race
  8: coder   # QML wiring across five files, with no Node test
  9: coder   # a one-line guard and one dead property
  10: coder  # three doc sentences
  11: coder  # QML layout, with care for the sizing rule
  12: coder  # a one-condition change
  13: agy    # README and usage prose across many sections: large and mechanical
reviewers:
  - codex    # an independent read of the diff against this plan
  - agy      # a second independent read; disagreement is the point
---

# Plan: twelve bugs from the 1.0.0 reviews

Branch `fix/46-review-findings`, based on `27e5992`. One PR, with one commit
per step. Each commit subject cites its step, for example
`fix: B1 edit name rule (#46, step 1)`.

Codex and agy reviewed the first draft of this plan, and this version takes
in their findings. The note `(review)` marks a change that came from them.

## Approved decisions, carried over from the spec

- **One PR, commits in three groups:**
  - validation (steps 1–4);
  - state and lifecycle (steps 5–10);
  - display (steps 11–13).

  Each cleanup goes in the commit whose code it touches, as the spec says
  (review).
- **B6:** hide the console on any pending machine change. A memory-only edit
  hides it too.
- **B8:** narrow the "one mutation at a time" rule in AGENTS.md, the README
  and `docs/usage.md`. The terminal start gets no lock, and there is no
  other code change.
- **B3:** a name counts as removed only when nixarchy-pkg's change is
  `"removed"` and `apps.nix` has no line for it.
- **B9:**
  - Every agent call has an owner, `"bar"` or `"menu"`. Ask, cancel, reset,
    thinking, error and reply are all scoped to it.
  - Every caller passes an owner; there is no default for one without.
  - While the other surface's call runs, `i` and Enter on describe are both
    refused, with a notice.
- **B1:** a hidden field's error goes into a form-wide line, not into
  `agentError`.
- **B10:** the format becomes `"\\n%f\\t"`, so the newline comes before each
  name.
- **Tests:**
  - every `Model.js` change gets a test that fails on `27e5992`;
  - every existing assertion that changes is named in the commit body.

## Repo traps, which apply to every step

- **Logic goes in `Model.js`, with a Node test.** QML only draws and wires.
- **No hardcoded colours** (`checked: colours`). The error colour is
  `Color.urgent`, as `CreateForm.qml:488` uses it. There is no
  `Color.error`.
- **No new root files** (`checked: files-list`). This plan adds none.
- **Argv arrays only, never `sh -c`.** A builder returns `null` on bad
  input.
- **A list read through a QObject `var` is a sequence wrapper.** Walk it by
  `.length`, never `Array.isArray`.
- **No `pacman` or `yay`**, not even in comments.
- **Do not touch `qmldir`.**
- **A surface's height is derived, not set** (AGENTS.md sizing rule).
  `implicitHeight` stays natural, and a child is capped only through its
  assigned height. A cap inside `implicitHeight` makes a binding loop
  through `MicrovmView.qml:22-38` (review).
- **After each step,** run `node tests/run.js`. After steps 4, 10 and 13,
  run `nix flake check` as well.

## Steps

### Group 1: validation

1. **`Model.js:936` `validateForm`, and a new `hiddenFieldError` (B1).**
   - When `f.editing === true`, the name is checked with
     `isNixAttrName(name)` (permanent) or `isReportedName(name)`
     (disposable). A create keeps `isVmName`. The duplicate-name check is
     unchanged.
   - Add `hiddenFieldError(fields, errors)` after `firstErrorIndex`
     (`Model.js:1128`). It returns `"<label>: <message>"` for the first key
     in `errors` that is not in `fields`, and `""` otherwise. The label comes
     from the field table `visibleFields` reads (`Model.js:1114`).
   - Tests in `tests/model/form.test.js`:
     - an edit of `Old_VM` (permanent) is ok, and so is an edit of `1box`
       (disposable);
     - a create of either is refused;
     - `hiddenFieldError` returns `"Name: …"` when name is hidden, and `""`
       when every error is visible.
   - → `node tests/run.js`

2. **`CreateForm.qml`: show the hidden-field error (B1), and move
   `keysMatching` (cleanup).**
   - Add `readonly property string hiddenError:
     Model.hiddenFieldError(root.fields, root.check.errors)`.
   - Under the field `Repeater` (`CreateForm.qml:316`), add a `Text`:
     - visible when `root.attempted && root.hiddenError !== ""`;
     - colour `Color.urgent`;
     - `PlainText`;
     - `width: parent.width`.
   - `submit()` (`:168`) is unchanged. Do **not** write `agentError`.
   - **Cleanup.** Move `keysMatching` (`CreateForm.qml:84-92`) to
     `Model.keysMatching(keys, query)`, walking `keys || []` by `.length`,
     with a test. `CreateForm` calls it.
   - → `node tests/run.js && nix build`

3. **`Model.js` `validateForm` and `parseShares:837` (B5).**
   - **Port.**
     - Applies to a permanent form whose port `isPort` accepts and is not
       empty.
     - Compare `parseInt(f.sshPort, 10)` with every row in `rows` where
       `kind === "permanent"`, `name !== trim(f.name)`, and the port is not
       empty. Use `parseInt` on both sides, and walk `rows` by `.length`.
     - A match sets:

       ```text
       errors.sshPort = "Port " + n + " is already used by " + row.name
       ```

   - **Mounts.**
     - `parseShares` keeps an object of normalized guest paths, checked
       with `Object.prototype.hasOwnProperty.call`.
     - A second share on the same path returns:

       ```text
       { error: "Two shares mount at " + guest }
       ```

   - **Assertions that change** (review), each named in the commit body:
     - `tests/model/form.test.js:116`: the port-2222 validation fixture.
     - `form.test.js:158` and `:165-167`: `snippet({... sshPort: "2222"})`
       for `t1` now collides with fixture `p1` on 2222 (`form.test.js:242`).
       Change those two to another port, for example `"2223"`, and update
       the expected `SNIPPET`.
     - `form.test.js:160`: `"/a:/mnt/a /b:/mnt/a"` now gives `null`.
       Replace the expected line with `eq(…, null)`, and keep a two-share
       case on distinct paths for the tag-suffix coverage.
     - The round-trip test (`form.test.js:170`): if its rows collide with
       1024 or 65535, change that fixture and name it.
   - **New tests:**
     - `02222` against `2222` collides;
     - an edit that keeps its own port is ok;
     - two shares on one guest path are refused;
     - one guest path on two VMs is ok.
   - → `node tests/run.js`

4. **`Model.js:1634` `sshKeysArgv` (B10).**
   - Change `"%f\\t"` to `"\\n%f\\t"`. `parseSshKeys` is unchanged.
   - Tests (find the existing ones with `grep -rn sshKeysArgv tests`):
     - the argv holds `"\\n%f\\t"`;
     - this input yields two keys:

       ```text
       "\na.pub\t<key>\nb.pub\t<key> c\n"
       ```

   - → `node tests/run.js && nix flake check`

### Group 2: state and lifecycle

5. **B2: a failed list keeps its rows.**
   - **`Model.js`:**
     - new `listFailure(stderr, code)`: `errorText(stderr)`, or
       `"exit " + code` when that is empty;
     - `summaryText(rows, reachable, listError)` (`:664`): returns
       `"VM list failed: " + listError` when it is set, checked before the
       counts;
     - `emptyText(state)` (`:677`) gets a `listError` branch, checked after
       `everLoaded`, `reachable` and `filtered` (review). The function
       receives no rows; the caller only uses it when the list is empty;
     - `staleList(flags)` (`:1696`) adds `"vms"` first when `flags.vms` is
       set.
   - **`MicrovmState.qml`:**
     - add `listOk: false`, `vmsStale: false` and `listError: ""`;
     - `listProcess.onExited` (`:490`), in this order:
       - **exit 0:** `listOk = true`, `vmsStale = false`,
         `listError = ""`, `reachable = true`, then read as today;
       - **`!listOk` and `trim(listErr.text) === ""`:**
         `reachable = false`, `vms = []`, `vmsStale = false`,
         `listError = ""`;
       - **otherwise:** `reachable = true`, `vms` is kept,
         `vmsStale = listOk`,
         `listError = Model.listFailure(listErr.text, code)` (review);
     - the `staleList` call (`:473`) passes `vms: root.vmsStale`;
     - `statusJson()` (`:455`) adds `listError`.
   - **Callers:**
     - pass `MicrovmState.listError` third at `MicrovmView.qml:385` and at
       `Panel.qml:90`;
     - pass `listError` in the `emptyText` state object in
       `MicrovmView.qml` (around `:635`).
   - **Tests:**
     - `summaryText` for not found, failed, and fine;
     - `listFailure` with stderr and with none;
     - `emptyText` with `listError`;
     - `staleList({vms: true, units: true})`.
   - → `node tests/run.js`
   - Trap: `everLoaded` keeps its meaning, "a poll finished".

6. **B3 and B4: a removed machine keeps its row. Cleanup: `ownershipText`.**
   - **`Model.js` `permanentRows` (`:397`).**
     - The machines loop also records each name it saw in
       `var fromLine = Object.create(null)`.
     - After the units loop, walk `Object.keys(p)` (`p` is
       `pending.machines`). For each name where `p[name] === "removed"` and
       `!fromLine[name]`:
       - if `byName[name]` exists, set its ownership to `"removed"`;
       - otherwise set `byName[name] = baseRow("permanent", name)` with
         ownership `"removed"`, and push the **name** onto `order` (review:
         `order` holds names).
     - The existing pending loop then sets `pending: true`.
   - **New `ownershipText(row)`.**
     - It returns `"declared in your flake"` for `flake`,
       `"apps.nix, edited by hand"` for `managed-unsupported`, and `""`
       otherwise, `removed` included.
     - These strings come from `subtitleText` at `Model.js:487-488`
       (review). `subtitleText` calls it, and keeps its kind prefix.
   - **`statusText` (`:477`).** For `ownership === "removed"`, it returns
     `"removed, pending apply"`, ahead of the other pending text.
   - **`hiddenReason` (`:1416`).** For a permanent row with
     `ownership === "removed"`, it returns `"removed, pending apply"` for
     every verb, checked first. The footer adds "a applies" itself (step 7),
     so the reason must not say it too (review).
   - **Cleanup.** `VmList.qml:214` uses
     `Model.join([row.template, Model.ownershipText(row)], " · ")`, so an
     empty template leaves no stray separator.
   - **Tests:**
     - a pending-only removal gives one row, and
       `listActions(...).apply === true`, with `pkgScript` set;
     - a removal with a unit gives ownership `removed`;
     - a flake unit with no marker stays `flake`;
     - an `"added"` with no line adds no row;
     - `statusText`, `hiddenReason` and `ownershipText` for each ownership.
   - → `node tests/run.js && nix build`

7. **B6: no console on an unapplied change. Cleanup: `pendingName`.**
   - **`Model.js`.**
     - The permanent console in `actionsFor` (`:1353`) also needs
       `!row.pending && !s.pendingSync`.
     - The last check of `hiddenReason`'s console branch, after port, key
       and running:

       ```js
       if (row.pending || s.pendingSync) return "apply the queued change first"
       ```

   - **`MicrovmState.qml`: the pendingSync generation** (review).
     - Add `pendingSync: false`, `appsGen: 0` and `pendingGen: 0`.
     - When `appsFile` (`:593`) loads changed text, and only when
       `root.active && root.pkgScript` (the condition that lets the pending
       poll run, `:175`): `appsGen++`, `pendingSync = true`, and start a
       pending read now, if one is not running.
     - Starting a pending read sets `pendingGen = appsGen`.
     - In `pendingProcess.onExited`:
       - if `pendingGen === appsGen`, set `pendingSync = false`;
       - otherwise start another read (the result predates the last file
         change).
     - A failed read also clears `pendingSync` when the generations match.
       `pendingStale` already reports the failure.
     - When the last surface closes (`!root.active`), `pendingSync = false`.
       Nothing is drawn, and the next open refreshes.
     - Pass `pendingSync` in the state that `actionsFor` and `hiddenReason`
       receive.
   - **`MicrovmView.qml` hint line (`:719-727`).** Before the
     `listActions.apply` branch: when
     `root.cursorActive && root.hintText !== "" && root.cursorRow &&
     root.cursorRow.pending`, return `root.hintText + "   a applies"`.
     This is gated on `cursorActive`, so the filter does not trigger it
     (review).
   - **Cleanup.** `Model.pendingName(pendingKey)` returns the part after
     `:`, or `""`, with a test. Use it at `MicrovmState.qml:209`, `:337`
     and `:635`, and at `MicrovmView.qml:780`.
   - **Assertions that change** in `tests/model/commands.test.js`: `p1` is
     `pending: true`, so the console assertions at about lines 126–128, 144
     and 163 move to a copy of `p1` with `pending: false`. Name each one.
     The assertion at about line 134 must pass unchanged.
   - **New tests:**
     - a pending, managed, running row with port and key: no console, and
       the reason;
     - `pendingSync: true`: the same;
     - not pending: unchanged;
     - `pendingName`.
   - → `node tests/run.js && nix build`

8. **B9: each surface owns its agent call. Cleanup: the unreachable
   `continue`.**
   - **`MicrovmView.qml`:**
     - add `property string surface: ""`;
     - add `property string agentNotice: ""`, which is per view (review).
   - **Hosts:** `Panel.qml:115` sets `surface: "bar"`; `Menu.qml:138` sets
     `surface: "menu"`.
   - **`MicrovmState.qml`:**
     - add `agentOwner: ""`;
     - `askAgent(prompt, owner)` (`:393`):
       - first, if `agentProcess.running && owner !== agentOwner`, return
         `"busy"` and change nothing;
       - otherwise set `agentOwner = owner` *before* the pre-launch checks
         (`:397-401`), so a pre-launch `agentError` reaches the asking form
         (review);
       - return `true` on launch, `false` otherwise;
     - `cancelAgent(owner)` and `resetAgent(owner)` return at once when
       `agentProcess.running && owner !== agentOwner`;
     - `resetAgent` clears `agentOwner` at its end;
     - add `function agentBusyFor(owner)`, which returns
       `agentProcess.running && agentOwner !== owner`.
   - **`MicrovmView.qml`:**
     - **Owners.** Every call passes `root.surface`: `resetAgent` at
       `:150`, `:159`, `:193` and `:206`; `askAgent` at `:491`;
       `cancelAgent` at `:492`.
     - **Bindings** for `CreateForm` (`:486-487`):

       ```qml
       thinking: MicrovmState.thinking && MicrovmState.agentOwner === root.surface
       agentError: MicrovmState.agentOwner === root.surface ? MicrovmState.agentError : root.agentNotice
       ```

     - **Replies.** `onAgentFormChanged` (`:499`) returns early unless
       `MicrovmState.agentOwner === root.surface`.
     - **Enter on describe.** When `askAgent` returns `"busy"`, set
       `root.agentNotice = "the other surface is asking the agent"`.
     - **`i` at `:314`** (review). When
       `MicrovmState.agentBusyFor(root.surface)`, set
       `root.agentNotice` to the same text and show it in the list footer.
       The footer's error `Text` near `:668` shows `root.agentNotice` when
       `MicrovmState.lastError` is empty. The form does not open.
     - **Clearing the notice.** `agentNotice` is cleared on `openForm`,
       `openEdit`, `setMode` and `dismiss`.
   - **Check:** `grep -n "resetAgent\|cancelAgent\|askAgent" *.qml` shows
     no call without an owner.
   - **Cleanup.** Remove the unreachable `if (!type) continue`
     (`Model.js:1596`), part of the agent reply code this step's area owns.
     → `node tests/run.js`
   - → `nix build`. There is no Node test for the wiring; it is checked live
     in the final verification.
   - Trap: keep-loaded surfaces. `open()` does not touch the stream, and
     `dismiss()` resets only its own call.

9. **`MicrovmState.qml` (B11). Cleanup: `probed`.**
   - Wrap the two `optProbe` lines at `:583-584` in
     `if (!optProbe.running) { … }`.
   - Remove `probed` (`:73`, and its write at `:94`).
   - → `nix build`

10. **B8 docs.**
    - **AGENTS.md** Rules, "One mutation at a time", gains one sentence: on
      nixarchy without `run --detach` (#762), a start opens a terminal that
      is not tracked, so it does not hold the lock.
    - The **README**'s "One change at a time" bullet and
      **`docs/usage.md`** say the same, in user words.
    - → `nix flake check` (docs-sync stays green).
    - Trap: do not add a `(checked: …)` tag.

### Group 3: display

11. **`MicrovmView.qml:517-589` (B7). Cleanup: `reviewCommandLines`.**
    - **Layout.** `review` holds a `Flickable` (`id: reviewScroll`) and,
      pinned below it, the review footer `Text` moved out of
      `reviewColumn`.
    - **Heights** (review: avoid the binding loop):
      - `review.implicitHeight` stays natural:
        `reviewColumn.implicitHeight + footer.implicitHeight + spacing`;
      - `reviewScroll` sets `width: parent.width`,
        `height: review.height - footer.height - spacing`, `clip: true`,
        and `contentHeight: reviewColumn.implicitHeight`;
      - the footer sets `width: parent.width`.
    - **Wrapping.** `reviewColumn` and every `Text` inside it get
      `width: parent.width`, so `WrapAnywhere` wraps.
    - **Behaviour:**
      - `openReview` (`:168`) sets `reviewScroll.contentY = 0`;
      - in review mode, `j`/`↓` and `k`/`↑` move `contentY` by one line
        height, clamped;
      - the footer adds `"   ↓ more"` while
        `reviewScroll.contentY + reviewScroll.height <
        reviewScroll.contentHeight`.
    - **Shortcut sheet.** Add one entry to the existing `Form` group of
      `Model.SHORTCUTS` (`Model.js:34`), after the `enter` entry:

      ```js
      { group: "Form", keys: "j  k  ↑ ↓", text: "In the review: scroll the line" }
      ```

      The key label is 9 characters, inside the limit
      `form.test.js:268` checks (review: there are no review entries).
    - **Cleanup.** Drop the unused `optPath` parameter of
      `reviewCommandLines` (`Model.js:563`). Update its callers,
      `MicrovmView.qml:560` and `tests/model/commands.test.js:208-225`
      (review).
    - → `node tests/run.js && nix build`

12. **`MicrovmView.qml:778` (B12).**
    - The legend condition becomes
      `MicrovmState.mutating && !MicrovmState.streaming`.
    - → `nix build`

13. **README and `docs/usage.md`.**
    - **README** key tables (the AGENTS.md rule says keys live there):
      - the console row in "The list" gets "not while a change waits for
        apply" (B6);
      - "The form" gets the review scroll row from step 11 (B7) (review).
    - **`docs/usage.md`** prose, with no key tables:
      - B2's "VM list failed: …";
      - B4's "removed, pending apply";
      - B5's two refusals, and that a flake-declared machine's port is not
        checked;
      - B6's reason;
      - B9's "the other surface is asking the agent".
    - → `nix flake check`

### Final verification (mine, not delegated)

1. Run:

   ```bash
   node tests/run.js
   nix flake check
   nix flake check --all-systems --no-build
   nix build
   ```

2. Validate a fresh clone:

   ```bash
   d=$(mktemp -d) && git clone -q . "$d/p" && rm -rf "$d/p/.git" && omarchy plugin validate "$d/p"
   ```

3. Show that the new tests fail on `27e5992`:
   - copy `Model.js` from that commit into a scratch tree with this
     branch's `tests/`;
   - run it;
   - record which new tests fail, in the PR.
4. Live, by AGENTS.md "Verifying live", with a snapshot of `apps.nix`
   taken first:
   - run each check in the spec's Verification list (B1–B12);
   - the bar is healthy;
   - teardown of `t1`, `t2` and `p1`;
   - diff `apps.nix` against the snapshot.
5. Reviews:
   - Opus reviews `git diff 27e5992..` against this plan;
   - Codex and agy review it (`reviewers:`). A coder's own step is never
     its only review.
6. The PR:
   - it links intent, spec and plan;
   - it closes #46;
   - it says which coder did each step.

## Tests

- `node tests/run.js`: every new test passes, and every changed assertion is
  named in its commit.
- `nix flake check` passes, and so does the same with
  `--all-systems --no-build`.
- The fresh-clone validate passes.
- The live checks pass, and the bar is healthy.

## Rollback

- Each step is one commit, so `git revert <sha>` undoes it.
- Revert these pairs together:
  - step 2 depends on step 1 (`hiddenFieldError`);
  - step 13 documents steps 6–8 and 11.
- Before merge, drop the branch. After merge, revert the merge commit.
- Nothing outside the plugin changes, except the test line `p1`, which
  teardown removes.
