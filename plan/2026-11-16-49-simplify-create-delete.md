---
status: approved
issue: 49
spec: spec/2026-11-16-49-simplify-create-delete.md
coders:
  1: codex   # the verdict and the parser/flag removal: logic plus many test updates
  2: coder   # MicrovmState/MicrovmView wiring of readiness and gating
  3: codex   # the continuation: lock-sensitive and easy to get subtly wrong
  4: coder   # startNow field and the log-mode switch
  5: codex   # the stop-and-delete wait: timing, fresh-list and resend logic
  6: coder   # openForm(kind, field) across four files
  7: coder   # the advanced switch across Model and CreateForm
  8: coder   # Apply now: signal, opened binding, question
  9: agy    # docs across README, usage, upstream, AGENTS.md, manifest: large and mechanical
reviewers:
  - codex    # an independent read of the diff against this plan
  - agy      # a second independent read
---

# Plan: simpler create and delete; require current nixarchy and nixarchy-pkg

Branch `feat/49-simplify-create-delete`. Code starts only after PR #47 merges.
The branch is then rebased onto `main`; its line numbers below are on
`fix/46-review-findings`, which equals `main` after that merge.

Each step is one commit, with a subject citing the step, for example
`feat: upstream verdict (#49, step 1)`.

## Revision after approval (Codex plan review, 2026-11-16)

The owner approved the first draft. Codex's plan review then found three
blockers and four gaps, all confirmed in the code. They are fixed below, and
the plan needs re-approval:

1. **Chained actions refused themselves.** `next` was set before `run()`,
   whose busy check (`MicrovmState.qml:241`) then saw the lock. `run()` now
   takes the next step as an argument and installs it after its own check
   (steps 3–5).
2. **The 90 s limit was only checked on a list result.** A hung stop or list
   would wait forever. A separate deadline timer now enforces it (step 5).
3. **The create's output never reached the log.** `startStream` resets the
   log (`:296`), and `actionProcess` output is never appended. The create
   now writes the log, and the stream appends to it (steps 3–4).
4. **Global actions were not gated.** `listActions` (`Model.js:1470`) offered
   create, assist and apply before readiness. They are gated now, including
   `MicrovmState.apply()` (step 1–2).
5. **`continueAfter` was tested but not used.** It now drives every
   transition, and QML only executes what it returns (step 3).
6. **The polling check was wrong with a bar widget installed.** The bar
   widget keeps a slow poll (`MicrovmState.qml:42`, allowed by AGENTS.md). The
   check is corrected (Final verification).

### Further corrections from agy's plan review

These were each confirmed in the code. **Where they differ from the step
text below, they win.**

7. **Readiness must wait for the package check.**
   - `pkgScript` starts as `""`, so `optDone || !pkgScript` was true before
     `pkgFile` had loaded.
   - Add `pkgDone`: true once `pkgFile` loads or fails.
   - `upstreamReady` is `helpDone && pkgDone && (optDone || !pkgScript)`.
   - A `pkgFile` reload resets `optDone` and `optReply`.
8. **Declare `listTooOld`.** It is a `property bool listTooOld: false`, and
   it feeds `upstreamError` (the nixarchy message) alongside the verdict.
9. **Priority.**
   - `summaryText` and `emptyText` keep `!everLoaded`, `!reachable` and
     `filtered` first.
   - `upstreamError` ranks just above `listError`, as the spec says, not
     above everything.
   - The callers are `MicrovmView.qml:410` (`summaryText`), `:685`
     (`emptyText`) and `Panel.qml:91`.
10. **Show the reason with no row selected.** The hint line in
    `MicrovmView.qml` (`:768-781`) shows `"checking nixarchy…"` or
    `upstreamError` when `!featureState.upstreamOk`, ahead of the other
    branches. `hiddenReason` only reaches the footer when a cursor row
    exists.
11. **`X` during a multi-step action.**
    - `launch()` (`:228-230`) and `actionProcess.onExited` (`:700-701`)
      reset `escapable` and stop `escapeTimer` only when `next === null`.
      The 60 s timer starts in `run()`.
    - `abandon()` with `next !== null` and no process running also clears
      `pendingVerb`, `pendingKey`, `escapable` and `escapeTimer`.
12. **`next` has a terminal marker.**
    - When `advance()` launches a `stream` or `rm` step, it sets
      `next = {kind: "last", name}`.
    - That keeps the lock, and tells `onExited` (via `continueAfter`) that
      this exit ends the action: `done`, and nothing re-runs.
    - Every place that clears `pendingVerb` also clears `pendingKey`.
13. **Wait-loop details.**
    - A failing re-send clears `next.resending` and restarts `waitTimer`.
    - `afterGen` is recorded when the `stop` *exits*, not when `run()`
      starts.
    - A list result counts only if its generation is greater.
    - `removeWaitStep` checks `timeout` before `resend`.
14. **Test fixtures that change.**
    - In step 1, the `ALL` and `NONE` states, and any test passing `{}`, need
      `upstreamOk: true`: `tests/model/commands.test.js:86-93`, `:129`,
      `:157`; `tests/model/rows.test.js:52`.
    - In step 7, three tests change, each named in the commit:
      - `tests/model/agent.test.js:82` compares `advanced`;
      - `tests/model/form.test.js:278` must not become `-1 === -1`;
      - `applyAgentReply` must ignore `{sshPort: null, shares: []}` when it
        sets `advanced` (`agent.test.js:74`).
15. **`CreateForm.start(kind, field)`** sets `fieldIndex` *after* `begin()`
    (`CreateForm.qml:103`), or `begin()` resets it.
16. **Step 9's scope also includes:**
    - `Model.SHORTCUTS` (`Model.js:45-49`), for `c` and `i`;
    - `docs/usage.md:20`, `:176-179`, `:222-223`, `:304-307`, `:340-351`;
    - `docs/index.md:157-162`.

    Because step 9 edits `Model.js` (the agent prompt), its check is
    `node tests/run.js && nix flake check`.

## Approved decisions, carried over from the spec

- **One verdict.**
  - The plugin needs `nixarchy-vm help` to name `--detach`, `console` and
    `set-template`, and, only when nixarchy.pkg is installed,
    `opt replace` to answer with usage.
  - Every action is absent until both probes finish ("checking nixarchy…").
    On failure, one message names what to update.
  - Submit, run and `openForm` all refuse in that state, which covers IPC.
- **Old hosts.**
  - On an old host the disposable list is not read: it shows the message
    and no rows. Permanent rows still show.
  - Non-JSON output on exit 0 counts as "too old".
  - `upstreamError` outranks `listError`.
- **Removed:**
  - the text parsers;
  - `detectFeatures`;
  - the `features`, `vmJson` and `optReplace` flags;
  - every `startTerminal` path;
  - the #762 and #19 hidden reasons.
- **Kept:** the #843 detection.
- **The continuation.**
  - `next` (`stream` | `wait` | `rm`) is part of `mutating`.
  - A step's success schedules `Qt.callLater(advance)`, and `advance()`
    launches before clearing or replacing `next`.
  - A failure clears it. `X` clears it.
  - `escapable` counts from the action's start.
- **Create and start.**
  - A `startNow` switch, default on, disposable create only.
  - After the create, `runDetachArgv` streams.
  - The submitting surface goes to log mode, and a failed start retries
    nothing.
- **Stop and delete.**
  - `stop`, then a 2 s wait loop needing a *fresh, successful* list.
  - `stop` is re-sent once at 30 s, and a failing re-send is ignored.
  - At 90 s the action ends with "nothing was deleted".
  - The wait polls while closed, as a bounded exception recorded in
    AGENTS.md.
- **Keys.** `c`, IPC `create` and `{"create":true}` open at the name; `i`
  opens at the description.
- **The SSH-and-shares switch.** `advanced` hides SSH and shares. It turns
  itself on in `formFromRow`, in `applyAgentReply`, and on a refused Enter
  with a hidden error.
- **Apply now.**
  - Asked only after a successful permanent create or edit.
  - Asked only by the submitting surface, while it is `opened`.
  - The button label is "Apply". A delete never asks.
- **Deferred:** SSH key pre-fill, and S7.

## Repo traps

- **Logic goes in `Model.js`, with a Node test.** QML wires.
- **Every colour is read as `Commons.Color`** (#45).
- **Argv only.** Disposable VMs only through `nixarchy-vm`. Permanent writes
  only through nixarchy.pkg.
- **QObject lists are sequence wrappers:** walk them by `.length`.
- **Keep-loaded surfaces:** `open()` resets the view and never touches the
  stream.
- **No new root files.**
- **After each step,** run `node tests/run.js`. After steps 2, 5, 8 and 9,
  run `nix flake check` too.
- **Every existing assertion that changes is named in the commit body.**

## Steps

1. **`Model.js`: the verdict, and the removals.**
   - **Add the verdict.** Add `upstreamVerdict(helpText, optReply,
     pkgPresent)` beside `detectFeatures` (`:1219`), then delete
     `detectFeatures`.
     - It returns `""`, or "This plugin needs nixarchy with nixarchy vm run
       --detach, console and set-template (nixarchy#762); update nixarchy",
       or the nixarchy-pkg#19 equivalent.
     - `optReplaceSupported` stays, and is used inside the verdict.
   - **`parseVmList` (`:227`) and `parseTemplates` (`:257`):** keep only the
     JSON branch. Non-JSON input returns `[]`. Add
     `isTooOldList(raw)`: true for non-empty output that is not JSON.
   - **`actionsFor` (`:1404`):**
     - drop the `vmConsole`, `vmDetach` and `vmSetTemplate` branches: a
       running disposable VM always has console; a stopped one has `start`
       and `edit`;
     - drop both `startTerminal` actions and the `optReplace` condition;
     - when `!s.upstreamOk`, return only `copy`.
   - **`hiddenReason` (`:1483`):** remove the #762 and #19 lines. Add, first:
     `if (!s.upstreamOk) return s.upstreamError || "checking nixarchy…"`.
   - **Delete `runTerminalArgv`** (`:1295`).
   - **`submitArgvs` (`:1371`):** return `null` when `!s.upstreamOk`, and
     drop the `optReplace` and `vmSetTemplate` conditions.
   - **`listActions` (`:1470`):** `create`, `assist` and `apply` are all false
     when `!s.upstreamOk`, so every global action is absent until the verdict
     is in (revision item 4). Tests cover it.
   - **`summaryText` (`:685`) and `emptyText` (`:699`):** `upstreamError`
     comes first. Add a parameter or a state field, and update the callers in
     step 2.
   - **Tests:**
     - `upstreamVerdict`: all current; old nixarchy; old nixarchy-pkg with
       pkg present; old nixarchy-pkg with pkg absent, which is ok;
     - `isTooOldList`;
     - `actionsFor` with `upstreamOk` false;
     - the summary priority.
   - Update and name every existing test that used text output, feature
     flags or `startTerminal` (`grep -rn "vmDetach\|vmConsole\|vmSetTemplate\|optReplace\|startTerminal\|detectFeatures" tests`).
   - → `node tests/run.js`

2. **The state, readiness and the gates.**
   - **`MicrovmState.qml`:**
     - **Replace the flags.** `features`, `vmJson` and `optReplace`
       (`:59-63`) give way to `property bool helpDone`, `property bool
       optDone`, `property string helpText`, `property string optReply`,
       `readonly property bool upstreamReady: helpDone && (optDone ||
       !pkgScript)` and `readonly property string upstreamError:
       upstreamReady ? Model.upstreamVerdict(helpText, optReply,
       !!pkgScript) : ""`.
     - **`featureState` (`:75-85`):** drop the old flags; add `upstreamOk:
       upstreamReady && upstreamError === ""` and `upstreamError`.
     - **`helpProcess` (`:574`)** sets `helpText` and `helpDone`.
       **`optProbe` (`:588`)** sets `optReply` and `optDone`. In `pkgFile`
       (`:620`), `onLoadFailed` sets `optDone = true`.
     - **`listProcess`** (`:512`), on exit 0 with
       `Model.isTooOldList(listOut.text)`: set `listTooOld = true` and
       `vms = []`, and skip parsing. On JSON, set `listTooOld = false`.
       `upstreamError` also reports when `listTooOld`.
     - **Gates.** `run()` (`:240`), `submit()` (`:284`) and `apply()` refuse
       with `lastError = upstreamError || "checking nixarchy…"` when not ok.
     - **Remove `startTerminal`** (`:379-386`), the start-terminal notice
       (`:364-365`), and the `statusJson` fields for the removed flags
       (`:491-494`). Add `upstreamError`.
   - **`MicrovmView.qml`:**
     - **`openForm` (`:152`)** refuses, with the footer notice, when
       `!MicrovmState.featureState.upstreamOk`. That covers `c`, `i`, IPC and
       the menu payload.
     - **Remove** the `startTerminal` verb (`:238`) and its footer mention
       (`:776`).
     - **Pass `upstreamError`** to `summaryText` and `emptyText` (`:385`,
       and the `emptyText` call).
   - **`Panel.qml:90`:** pass `upstreamError` to `summaryText`.
   - **`VmList.qml:130-131`:** remove the `startTerminal` tooltip branch.
   - → `node tests/run.js && nix build && nix flake check`

3. **The continuation (`MicrovmState.qml`, `Model.js`).**
   - **`Model.js`: `continueAfter(next, event)` decides every transition.**
     - `event` is `{ type: "exit", ok, phase }` for the end of a process, or
       `{ type: "tick", listOk, listGen, stopped, now }` for the wait timer.
     - It returns one action: `{ do: "stream", name }`, `{ do: "rm", name }`,
       `{ do: "stop", name }` (the one re-send), `{ do: "wait" }`,
       `{ do: "done" }` or `{ do: "fail", message }`, plus the `next` value
       to hold afterwards.
     - It uses `removeWaitStep` (step 5) for ticks.
     - QML only executes the action it returns (revision item 5).
     - Tests cover every `kind` × `event`, including a failure at each phase.
   - **The lock.** `property var next: null`; `mutating` (`:152`) adds
     `|| next !== null`.
   - **`run(argvs, verb, key, nextStep)` (`:240`).**
     - The busy and upstream checks run *first*, against the current lock.
     - Only then: `root.next = nextStep || null`, `pendingVerb`/`pendingKey`
       are set, and the first command launches.
     - Callers never set `next` themselves (revision item 1).
   - **`beginStream(argv, title, keepLog)`.** It is the body of
     `startStream` (`:290`) without the busy check.
     - `keepLog` true appends `"$ " + title` to the existing log instead of
       resetting it (revision item 3).
     - `startStream` calls `beginStream(argv, title, false)` after its
       check.
   - **`actionProcess.onExited` (`:679-720`).**
     - It calls `continueAfter(next, {type: "exit", ok, phase})`.
     - For `stream`, `rm` or `stop`, it keeps `pendingVerb` and `pendingKey`
       and launches through `Qt.callLater`, launching before it sets `next`
       to the returned value.
     - For `fail`, it clears `next` and runs the existing failure path.
     - For `done`, it clears `next` and `pendingVerb`.
   - **`streamProcess.onExited`** treats the stream as the last phase: it
     clears `next` and `pendingVerb`.
   - **Abandon.**
     - `escapable` is set by a 60 s timer started in `run()`, not restarted
       per process.
     - `abandon()` (`:337`): when `next !== null`, it stops `waitTimer` and
       `deadlineTimer`, sets `next = null` and the message "gave up waiting
       for <name>; nothing was deleted" for a `wait` or `rm`, then signals
       any running process as today.
     - The lock drops only when that process has exited.
   - → `node tests/run.js && nix build`
   - Traps: launch before you clear; never call `startStream` from inside
     `onExited`.

4. **Create and start.**
   - **`Model.js`:**
     - `FORM_FIELDS` (`:1142`) gains `{ key: "startNow", widget: "bool",
       label: "Start it now", disposable: true, create: true }`;
     - `emptyForm` (`:927`) sets `startNow: true`;
     - `visibleFields` (`:1157`) skips `disposable` fields for a permanent
       form;
     - new `startAfterCreate(form)`: the trimmed name when
       `kind === "disposable" && !editing && startNow !== false`, else `""`.
       It has tests.
   - **`MicrovmState.submit(form, owner)`** (`:284`): when
     `startAfterCreate(form)` names the VM, call `run(argvs, "creating", key,
     {kind: "stream", name})`, and record `submitOwner = owner`.
   - **The create writes the log** (revision item 3).
     - When `nextStep.kind === "stream"`, `run()` starts the log with
       `log = ["$ create " + name]`, `streamTitle = "create " + name` and
       `streamExit = -1`.
     - `actionProcess.onExited` appends the create's stdout and stderr
       (`Model.capLog`, `Model.stripAnsi`) before continuing.
     - The stream then uses `beginStream(..., keepLog: true)`, so the log
       reads the create, then the build.
   - **`MicrovmView.submitForm`** (`:195`) passes `root.surface`. On success,
     when `Model.startAfterCreate(form)` is set, it calls `setMode("log")`;
     otherwise it calls `setMode("list")`, as today.
   - **`CreateForm.qml`:** the `bool` widget already draws switches. Check
     that `startNow` renders and toggles with space.
   - → `node tests/run.js && nix build`

5. **Stop and delete.**
   - **`Model.js`:**
     - `removeMessage` (`:1514`): for a running disposable VM, "Stop and
       delete <name>, and everything in <dir>?";
     - new `removeWaitStep(wait, listOk, listGen, stopped, now)`, which
       returns `"rm" | "resend" | "timeout" | "wait"`:
       - `"rm"` only when `listOk && listGen > wait.afterGen && stopped`;
       - `"resend"` when `now - wait.since >= 30000 && !wait.resent`;
       - `"timeout"` at 90000.
     - Tests cover each branch, including a stale list (`listGen <=
       afterGen`) and a failed list (`!listOk`).
   - **`MicrovmState.qml`:**
     - `listGen`, incremented each time `listProcess` *starts*, recorded per
       read, and `lastListOk` for the read that just finished.
     - `remove(row)` (`:277`), for a running disposable VM, calls
       `run([Model.stopVmArgv(name)], "deleting", row.key, {kind: "wait",
       name, since: Date.now(), resent: false, afterGen: listGen})`.
     - **`deadlineTimer`** (90 s, single-shot) starts in `run()` whenever the
       next step is a `wait`. It is independent of list results (revision
       item 2). When it fires:
       - `next = null`, and `lastError` is "<name> did not stop within 90 s;
         nothing was deleted";
       - if `actionProcess` is still running (a hung stop), it is signalled
         as `abandon()` does, through the existing kill timer;
       - the lock drops only when that process exits;
       - a hung `listProcess` is left alone: it holds no lock.
     - `waitTimer` (2 s, single-shot), started by `advance()`: refresh the
       list, then on its result call `removeWaitStep`:
       - **`rm`:** `next = {kind: "rm", name}`, then `advance()`;
       - **`resend`:** set `resent`, then launch `stopVmArgv` through
         `actionProcess`. A non-zero exit of this re-send does not fail the
         action: tag it with `next.resending`;
       - **`timeout`:** cannot happen here any more, since `deadlineTimer`
         owns the limit; `removeWaitStep` keeps it only as a guard;
       - **`wait`:** restart the timer.
     - While a wait is active, the list refresh runs even with every surface
       closed. This is the recorded exception.
   - → `node tests/run.js && nix build && nix flake check`

6. **One key per job.**
   - **`Model.js`:** `fieldIndexOf(fields, key)`, which returns 0 when the
     key is absent. It has tests.
   - **`MicrovmView.openForm(kind, field)`** (`:152`) passes the field to
     `createForm.start(kind, field)`.
     - `c` (`:333`) → `"name"`;
     - `i` (`:334`) → `"describe"`.
   - **`CreateForm.start(kind, field)`:**
     `fieldIndex = Model.fieldIndexOf(fields, field)`.
   - **`Panel.qml:71`** and **`Menu.qml:66`:**
     `openForm("disposable", "name")`.
   - → `node tests/run.js && nix build`

7. **The SSH-and-shares switch.**
   - **`Model.js`:**
     - `FORM_FIELDS` gains `{ key: "advanced", widget: "bool", label: "SSH
       and shares", permanent: true }` before `sshPort`, and `sshPort`,
       `sshKey` and `shares` gain `advanced: true`;
     - `emptyForm` sets `advanced: false`;
     - `visibleFields` skips `advanced` fields unless `form.advanced`;
     - `formFromRow` (`:944`) sets `advanced` when the row has a port, a key
       or shares;
     - `applyAgentReply` (`:1661`) sets `advanced` when it set any of the
       three.
     - **Tests:** each case, and `machineSnippet` never contains
       `advanced`.
   - **`CreateForm.submit()`:** on a refused Enter, when `check.errors` names
     `sshPort`, `sshKey` or `shares` and `!form.advanced`, call
     `setValue("advanced", true)` before choosing the first error.
   - → `node tests/run.js && nix build`

8. **Apply now.**
   - **`Model.js`:** `offerApply(verb, key, failed)`: true only for
     `creating`/`editing` with a `permanent:` key and no failure. It has
     tests.
   - **`MicrovmState.qml`:**
     - add `signal permanentWritten(string name, string owner)`;
     - emit it in `actionProcess.onExited` when the queue drains and
       `offerApply(...)` is true, using `submitOwner`.
   - **`MicrovmView.qml`:**
     - add `property bool opened: false`;
     - add a `Connections` on `MicrovmState.onPermanentWritten`: if
       `root.opened && owner === root.surface && !root.confirmOpen`, call
       `ask(function() { root.apply() }, "Apply now? nixarchy-apply rebuilds
       the whole system from apps.nix, in a terminal.", "Apply")`.
   - **`Panel.qml`** (the `MicrovmView` at `:116`) and **`Menu.qml`**
     (`:139`): bind `opened: root.opened`.
   - → `node tests/run.js && nix build && nix flake check`

9. **Words.**
   - **The agent prompt** (`Model.js:1559-1570`) drops "only while
     attached".
   - **AGENTS.md:**
     - the "detected, not assumed" rule becomes the minimum and the one
       verdict, with #843 still detected;
     - remove #46's terminal-start sentence;
     - "One mutation at a time" adds that the multi-step actions hold the
       lock throughout;
     - "Nothing polls while every surface is closed" adds the stop-and-delete
       exception (90 s at most);
     - the "Layout" and "Known follow-ups" lines that mention detection.
   - **README:**
     - the key tables: `c` at the name, `i` at the description;
     - `x` on a running disposable VM;
     - the two switches;
     - the "Detects what your nixarchy can do" bullet becomes the
       requirement.
   - **`docs/usage.md`:** the create, delete and apply flows, "checking
     nixarchy…", and the update message.
   - **`docs/upstream.md`:** #762 and #19 become requirements; #843 stays
     optional.
   - **`manifest.json`:** check the description and the widget description
     for "detected" wording.
   - → `nix flake check`

## Final verification (mine, not delegated)

- **Checks:** `node tests/run.js`, the flake checks (`--all-systems
  --no-build` too), `nix build`, and a fresh-clone `omarchy plugin
  validate`.
- **New tests fail on the base:** run them against `Model.js` from the
  rebased base.
- **Live:** run spec Verification 1–6.
  - Snapshot `apps.nix` and `services.nix` first.
  - Install with the shell stopped, using `t1`, `t2` and `p1`.
  - In check 2, close the menu during the wait. The delete must still
    complete. Then check polling with `status` (the menu's `status()` IPC):
    - **with no bar widget on any bar** (this host): `polls` stops rising
      once the delete is done;
    - **with a bar widget:** it falls back to the slow `refreshIntervalSec`
      rate (`MicrovmState.qml:42`, allowed by AGENTS.md) instead of the 2 s
      wait rate (revision item 6).
  - Tear down, diff against the snapshots, restore the Home Manager link,
    and check the bar.
- **Reviews:** Opus, plus Codex and agy (`reviewers:`).
- **The PR:** link the three artifacts, close #49, name the coder per step,
  and list any deviations.

## Tests

- `node tests/run.js`: every new test passes and fails on the base, and
  every changed assertion is named.
- The flake checks are green.
- The live checks pass.

## Rollback

- Each step is one commit.
- Steps 3–5 depend on each other (the continuation), and step 8 on step 4's
  `submitOwner`. Revert them together.
- Before merge, drop the branch. After merge, revert the merge commit.

## Deviations recorded during implementation

- **Step 1** was implemented by Codex through `agent-run`, not
  `herdr-team`: `herdr-team` refused to launch in the `/tmp` worktree ("the
  launcher did not start").
- **Step 2:** an old-format list (`listTooOld`) reports
  `Model.upstreamVerdict("", "", false)`, the nixarchy#762 message itself,
  rather than a separate string.
- **Step 3** also adds `Model.removeWaitStep`, which the plan placed in step
  5, because `continueAfter` uses it for ticks. Its tests are in the new
  `tests/model/continuation.test.js`. Step 5 wires the wait timer, the
  deadline and `remove()`, and adds no new pure logic.
- **Step 4** sets up the log (`"$ create <name>"`, `streamTitle`,
  `streamExit`) in `submit()` right after `run()` succeeds, not inside
  `run()`. QML is single-threaded, so the create cannot exit before
  `submit()` returns, and `run()` stays free of stream code. `submitOwner`
  is recorded on every successful submit, not only on create-and-start,
  because step 8 needs it for permanent writes.
- **Final review (Opus, Codex)**, all confirmed in the code and fixed in one
  commit:
  1. **A finished delete never finished** (both reviewers; also seen live:
     `pending` stayed "deleting disposable:t1"). The rm's exit returned
     `done`, but `advance()` had no `done` branch. A new `finishAction()`
     clears the pending row, the timers and `escapable`, then refreshes. Both
     `done` and `fail` use it.
  2. **The 30 s re-send waited on a list read** (Codex). Each wait tick now
     also checks the clock alone, so a hung list cannot hold up the re-send.
     The 90 s limit already had its own timer.
  3. **`X` during `rm` said "nothing was deleted"** (both). That is only said
     during the wait now. During `rm` it says "<name>; it may be partly
     deleted".
  4. **A failed create left the log open** (both). The log gets its own
     `── exit N · failed` line, and `streamExit` is set.
  5. **The stopped check was logic in QML** (Codex). It is now
     `Model.isStopped`, with tests, plus `continueAfter` tests for "no second
     re-send" and "a fresh stopped list wins over a re-send".
  6. **The verdict flickered on every re-probe** (Opus). A `pkgFile` reload
     of the same path keeps the last verdict, and resets only when the path
     changes.
