---
status: approved
issue: 49
intent: intent/2026-11-16-49-simplify-create-delete.md
---

# Spec: simpler create and delete; require current nixarchy and nixarchy-pkg

## Design

- **Line numbers** are on `fix/46-review-findings` (PR #47), which this
  builds on. The work starts only after #47 merges, rebased onto `main`.
- **Revised after Codex and agy reviewed the first draft.** The revision
  adds or changes:
  - one explicit way to chain a step to the next (the continuation);
  - gating at the root (the singleton and `openForm`, not the keys);
  - the build log opening on create-and-start;
  - a stop-and-delete wait that can be abandoned and is held by the lock;
  - a simpler "SSH and shares" switch;
  - an `opened` flag for the "Apply now?" question.

### 0. The continuation: one way to chain steps under the lock

Today `mutating` is `actionProcess.running || streamProcess.running ||
queue.length > 0` (`MicrovmState.qml:152`). Between two queued commands, the
non-empty queue holds the lock across the `Qt.callLater` tick (`:704-712`).
The new multi-step actions use the same idea.

- **`property var next: null`.** It holds the step that must run after the
  current one:
  - `{kind: "stream", name}` for create-and-start;
  - `{kind: "wait", name, since, resent}` for stop-and-delete;
  - `{kind: "rm", name}` for the delete itself.
- **The lock.** `mutating` adds `|| next !== null`.
- **How a step hands over.**
  - A step that finishes with success and an empty queue does not clear
    `pendingVerb` or `pendingKey`. It schedules
    `Qt.callLater(root.advance)`.
  - `advance()` runs `next`, through internal entry points that skip the
    public busy check: `beginStream(argv, title)` and `launch()`. It
    launches *before* it clears or replaces `next`, as the queue does
    today, so the lock never drops.
- **Failure.** A failed step sets `lastError`, sets `next = null`, and
  clears `pendingVerb`, as today. Nothing further runs.
- **Abandon.** `abandon()` (`X`, `:338`) also handles a step held in `next`:
  it sets `next = null` with "gave up waiting for <name>; nothing was
  deleted". `escapable` turns true 60 s after the action began, measured
  from its start rather than from the last process exit, so it also covers
  the wait.
- **Tests.** A new pure `Model.continueAfter(next, result)` decides what
  follows each step. Its Node tests cover every branch.

### 1. One upstream verdict, gated at the root

- **`Model.upstreamVerdict(helpText, optReply, pkgPresent)`** returns `""`,
  or one message naming what to update:
  - **nixarchy** must name `--detach`, `console` and `set-template` in
    `nixarchy-vm help`;
  - **nixarchy-pkg** must answer `opt replace` with a usage line, and only
    when nixarchy.pkg is installed (`pkgPresent`).
- **Readiness.** `MicrovmState` gains `upstreamReady` and `upstreamError`.
  - `upstreamReady` turns true only when every required probe has finished:
    help always; `optProbe` only when `pkgScript` is set. Until then,
    actions are absent and the footer says "checking nixarchy…".
  - When ready, `upstreamError` is set from the verdict.
- **Gating happens where it can't be bypassed:**
  - `MicrovmState.submit` and `run` refuse when `!upstreamReady ||
    upstreamError`, and say why;
  - `MicrovmView.openForm` refuses the same way. That covers `c`, `i`, IPC
    `create` (`Panel.qml:69`) and the menu's `{"create": true}`
    (`Menu.qml:66`);
  - `actionsFor` returns only `copy` when `!s.upstreamOk`.
- **Listing on an old host.** The text parsers are removed. On nixarchy
  older than #762, the disposable list cannot be read, so it shows
  `upstreamError` and no disposable rows.
  - Permanent rows (systemd and `apps.nix`) still show.
  - `listProcess` treats non-JSON output on exit 0 as "too old".
  - `upstreamError` takes priority over `listError` in `summaryText` and
    `emptyText`.

  This replaces the first draft's "listing still works", which could not be
  true without the parser.
- **Removed:**
  - the text fallbacks in `parseVmList` and `parseTemplates`
    (`Model.js:210-280`);
  - `detectFeatures`, whose regexes move into the verdict;
  - the `features`, `vmJson` and `optReplace` flags;
  - `startTerminal` and `runTerminalArgv`, along with every leftover:
    `MicrovmView.qml:238`, `:776`; `VmList.qml:130-131`;
    `MicrovmState.qml:364-365`, `:379-386`; the `statusJson` fields
    `:491-494`;
  - the #762 and #19 reasons in `hiddenReason` (`Model.js:1488-1504`).
- **Kept:** detection of #843.

### 2. Create starts the VM, and shows the build

- **A new form field** `startNow` (`bool`, "Start it now", disposable create
  only), default `true`. It is not an agent field, and not part of an edit.
- **Submitting.** `MicrovmState.submit(form, owner)` sets
  `next = {kind: "stream", name}` when `Model.startAfterCreate(form)` names
  the VM, then runs the create.
- **After the create.** On success, `advance()` calls
  `beginStream(Model.runDetachArgv(name), "run " + name)`, which is the same
  argv as `s` today. On failure, nothing starts.
- **The build log opens.** For create-and-start, `MicrovmView.submitForm`
  goes to `setMode("log")`, as `s` does (`MicrovmView.qml:243`), instead of
  `"list"`. The log follows the create's output first, then the stream's.
- **A failed start** shows in the log and the hint line, the row reads
  stopped, and nothing is retried.

### 3. Delete handles a running disposable VM

- **The steps.** `remove(row)` on a running disposable VM runs `stop` with
  `next = {kind: "wait", name, since: now, resent: false}`.
- **The wait.** `advance()` for a `wait` step starts a 2 s single-shot timer.
  On each tick, `Model.removeWaitStep(next, list, now)` decides:
  - **`"rm"`** once a *fresh, successful* list shows the VM stopped. Fresh
    means a list read that started after the stop; a failed read retains old
    rows (`MicrovmState.qml:527`), so it never counts. Then `next = {kind:
    "rm", name}`, and `advance()` launches `rmVmArgv`.
  - **`"resend"`** once, at 30 s with `resent` false. It sends `stop` again
    and sets `resent: true`. A failing resend is ignored: the guest may just
    have gone, and `microvm-shutdown` then has no socket.
  - **`"timeout"`** at 90 s. `lastError` reads "<name> did not stop within
    90 s; nothing was deleted", and `next = null`.
  - **`"wait"`** otherwise. The list is refreshed, and the timer restarts.
- **Polling.** This is the one exception to "nothing polls while every
  surface is closed". A stop-and-delete in progress polls the list until it
  finishes, for at most 90 s. AGENTS.md records it.
- **The question.** `removeMessage` for a running disposable VM says: "Stop
  and delete <name>, and everything in <dir>?" It is asked once.
- **Tests:** `removeWaitStep` covers fresh vs stale, stopped, 30 s,
  resent, and 90 s; plus `removeMessage` for running and for stopped.

### 4. One key per job

- `openForm(kind, field)`:
  - `c`, IPC `create` and `{"create": true}` start at `"name"`;
  - `i` starts at `"describe"`.
- `Model.fieldIndexOf(fields, key)` returns 0 when the key is absent. It
  has a test.

### 5. A short permanent form

- **A new UI-only field** `advanced` (`bool`, "SSH and shares", permanent
  only), default `false`. `visibleFields(form, state)` hides `sshPort`,
  `sshKey` and `shares` unless `form.advanced` is set.
- **`advanced` turns true by itself** whenever there is something to see,
  so the switch always matches what is shown (agy):
  - `formFromRow` sets it when the line has a port, a key or shares;
  - `applyAgentReply` sets it when the reply set any of the three;
  - `CreateForm.submit` sets it on a refused Enter when `check.errors`
    names any of the three.
- **`advanced` is never part of the snippet**, so the grammar is unchanged.
- **Tests:**
  - `formFromRow` with and without SSH;
  - `applyAgentReply` with a port;
  - `visibleFields` with `advanced` true and false.

### 6. "Apply now?" after a permanent create or edit

- **The signal.** `MicrovmState` emits `permanentWritten(name, owner)` when
  a permanent create or edit finishes with no failure.
  `Model.offerApply(verb, key, failed)` decides it, with a test.
- **The question.** `MicrovmView` gains `property bool opened`. `Panel.qml`
  and `Menu.qml` bind it to their own `opened`, because a keep-loaded view
  is visible even when closed.
  - The view asks only when `opened && owner === root.surface &&
    !root.confirmOpen`.
  - It uses `ask(..., "Apply now? nixarchy-apply rebuilds the whole system
    from apps.nix, in a terminal.", "Apply")`. The default answer is No, and
    Yes calls `apply()`.
- **Deletes never ask.**

### 7. Words

- **The agent prompt** (`Model.js:1564`) drops "only while attached".
- **AGENTS.md:**
  - the "detected, not assumed" rule becomes the stated minimum and the one
    verdict, with #843 still detected;
  - #46's sentence about the untracked terminal start is removed;
  - "One mutation at a time" adds that a create-and-start and a
    stop-and-delete hold the lock throughout;
  - "Nothing polls while every surface is closed" adds the bounded
    exception: a stop-and-delete in progress, at most 90 s.
- **README key tables, `docs/usage.md` and `docs/upstream.md`:** as the
  intent lists them. `manifest.json` is checked for "detected" wording.

## Alternatives rejected

- **Calling `startStream` from inside `onExited`.** Its public busy check
  rejects its own continuation, and `actionProcess.running` may still be
  true there. That is why the queue uses `Qt.callLater` (Codex, agy).
- **Queueing `[stop, rm]`.** `stop` returns before the VM is down, as
  observed with `t1`.
- **`systemctl --user stop`.** AGENTS.md routes disposable VMs only through
  `nixarchy-vm`.
- **Upstream `nixarchy vm stop --wait`.** Cleaner, but it needs a release.
  It is noted for roadmap A1.
- **A `visibleFields` that also looks at values and errors.** The switch
  would disagree with what is shown, and the fields would vanish mid-typing
  (agy).
- **Ctrl+Enter for "create stopped".** It is invisible. A switch is data,
  and testable.

## Risks

- **A guest that never stops:** the action holds the lock for up to 90 s,
  `X` can end it after 60 s, and nothing is deleted.
- **Older hosts lose their actions, and their disposable list,** until they
  update. That is intended, and the message says what to update.
- **The `next` handoffs are QML wiring.** Only `continueAfter`,
  `removeWaitStep` and `startAfterCreate` are unit-tested. The handoffs
  themselves are verified live.
- **Two new form fields** change the form's height. Check the popup and the
  menu at text size 12.
- **Merge order:** after #47.

## Verification

- `node tests/run.js` passes with the new tests:
  - `upstreamVerdict`, `continueAfter`, `startAfterCreate`,
    `removeWaitStep`, `fieldIndexOf`, `offerApply`;
  - the `advanced` cases, and `removeMessage`.

  Existing tests that relied on the parsers or the flags are updated, and
  each is named in its commit.
- `nix flake check`, `--all-systems --no-build`, `nix build` and a
  fresh-clone `omarchy plugin validate` all pass.
- Live, by AGENTS.md "Verifying live", with an ai-mirror grant and the
  owner's desktop free. `apps.nix` is snapshotted first.
  1. `c` opens at the name. Type `t1`, then Enter: the log opens, the
     create's output is followed by the build, and `t1` runs. While it
     builds, `s` on another row is refused as busy (the lock holds across the
     handoff).
  2. `x` on running `t1`, then yes. The footer shows the wait, `t1` stops,
     and it is deleted. Close the menu during the wait: the delete still
     completes, and polling stops afterwards (`polls` in `status` stops
     rising).
  3. `c`, name `t2`, "Start it now" off: `t2` is created stopped. Then
     `rm` it.
  4. `c`, Kind permanent: SSH and shares are hidden, and the switch shows
     them. Enter, the review, write `p1`: "Apply now?" is asked once, by this
     surface only. Answer No, then remove `p1`.
  5. `i` opens at the description. IPC `create` opens at the name.
  6. The bar is healthy, there are no plugin warnings, and `apps.nix`
     matches its snapshot.
- The too-old path is covered by the `upstreamVerdict` tests. It cannot be
  reproduced on this host.
