---
status: approved
issue: 23
intent: intent/2026-09-24-23-lock-and-lifecycle.md
---

# Spec: a process that never reports must not be the end of the story

## Design

Two findings are unverified: whether `Process` emits `exited(code)` when exec
itself fails (1), and whether the host destroys the menu component without
calling `close()` (5). Each choice below is stated in both worlds, and each
degrades to dead code if its finding turns out not to be a bug.

### 0. What Quickshell's `Process` actually does

The escape below terminates a running command, so the termination has to be
something the API offers rather than something we hope for. Quickshell 0.3.1
ships the answer in its own typelib,
`lib/qt-6/qml/Quickshell/Io/quickshell-io.qmltypes`, `Component name:
"Process"`: a readonly `processId`, a `signal(int)` method, and a `running`
property whose setter is `setRunning`. There is no `terminate()` and no
`kill()`; `signal(int)` is the whole facility.

Measured on razer against that same Quickshell, in a four-process bench config
outside this plugin (not the plugin itself, and one version only):

| what was done | what happened |
| --- | --- |
| `running = false` on `sleep` | SIGTERM; `exited(15, CrashExit)`; `running` stayed **true** until the child was reaped, then went false and `processId` went null |
| `running = false` on a child that traps TERM | SIGTERM; child alive 1.7 s later; `running` still true; no `exited`; Quickshell never escalated |
| `signal(9)` on the same child | `exited(9, CrashExit)`; `running` false; `processId` null |
| exec of a missing binary, through this plugin's own `launch()` (`:207`) | one WARN on Quickshell's log, **no `started`, no `exited`**, `running` false, `processId` null |

Three consequences drive the rest of this document:

- **`running` is reap-accurate.** It does not drop when we ask for the kill; it
  drops when the child is gone. So `mutating` (`:130`) is already an honest
  answer to "is a write in flight", and the correct design never assigns
  `running = false` to release a lock — it asks the process to die and lets the
  existing `onExited` release it.
- **SIGTERM alone is not termination.** A child that ignores it survives and
  Quickshell does not escalate, so any escape has to escalate itself.
- **The last row is finding 1, and it read as real on this bench.** Stated
  loudly because the owner approved this spec without that check: it is bench
  evidence, not the live plugin test, and the plan must still run Verification
  step 1. Nothing in the design changes either way — it only means the watchdog
  in §1 is probably not dead code after all.

### 1. The lock

`mutating` keeps its three holders, and **no timer ever clears a hold a live
process owns**. The two ways it can outlive its work need opposite answers, so
they are separated.

**The queue hold is bounded automatically.** `queue.length > 0 &&
!actionProcess.running && !streamProcess.running` should exist for exactly one
`Qt.callLater` tick (`:537`-`:541`). If it lasts, nothing is running and
nothing will ever fire, so clearing it cannot interrupt anything — by
construction, not by judgement, and now also by the measurement above: in that
state `processId` is null and no child exists. A single-shot 5 s `Timer`, armed
only on that condition, empties `queue`, reports `Model.processFailure`, and
lets the next mutation through. 5 s because the only legitimate occupant of
that state is one event-loop tick.
*If (1) is a non-bug*, `onExited`'s failure path clears `queue` in the same
tick (`:531`), the condition never holds for 5 s, and the timer never fires —
dead code on a healthy host, which is what a watchdog should be.

**What the watchdog names.** The reviewer is right that `queue` holds argv
arrays (`:224`) and `pendingVerb` names the multi-step action, not the command
that hung, and that `queue[0]` is the *next* command, not the one that failed
to start. So the report is changed, not the queue: `launch()` (`:207`) gains
one line, `root.pendingCommand = Model.commandName(argv)`, set at every launch
including the `Qt.callLater` handoff, so it always names the command currently
owed an exit. `Model.commandName(argv)` is the basename of `argv[0]` with
nixarchy.pkg's adapter mapped to `nixarchy-pkg` — the mapping the review screen
already open-codes (`MicrovmView.qml:427`), lifted into `Model.js` and called
from both. The watchdog reports
`Model.processFailure({verb, command: root.pendingCommand, reason: "did not start"})`,
which reads "creating p1: nixarchy-service-enable did not start".

**A hold owned by a running `Process` is never cleared by a timer.** A
`systemctl start microvm@p1` on a cold guest, or a `nixarchy vm run --detach`
build, is genuinely slow and a timer cannot tell it from a hang. So the escape
is the user's, and it is a kill, not a lock release:

    function abandon() {
      if (!actionProcess.running) return
      root.lastError = "giving up on " + pendingVerb + " — asking it to stop"
      actionProcess.signal(15)
      killTimer.restart()          // single-shot 3 s: if (running) signal(9)
    }

`abandon()` never touches `mutating`, `queue` or `running`. The child dies, the
existing `actionProcess.onExited` runs with code 15 or 9, takes its ordinary
failure path (`:523`), clears `queue`, and writes the `Model.processFailure`
line. The lock is released by the reap and by nothing else, so **there is no
window in which the UI says idle while a write is alive** — not by wording, not
by a 60 s assumption, but because `running` is the kernel's answer. The 3 s
escalation exists because the bench shows Quickshell does not escalate; SIGKILL
cannot be ignored, so the only survivor is a process wedged in uninterruptible
sleep, and there `mutating` correctly stays true and the escape has refused to
lie rather than overlapped a write. Never offered while `streamProcess` holds
the lock: that one draws its own log and prints its own exit line.

**Where the escape lives, and when.** The reviewer is right that the error
banner (`MicrovmView.qml:552`) is `visible: MicrovmState.lastError !== ""` and
that a slow `actionProcess` sets no `lastError`, so a button there would be
invisible in the only case it exists for. It moves to the one thing that *is*
on screen during a long mutation: the footer's right-hand line
(`MicrovmView.qml:640`), today `MicrovmState.mutating ? "working…" : …`. That
string becomes `Model.workingText({verb, key, escapable})`:

- while `actionProcess` runs — `working… creating p1`;
- once it has run 60 s — `working… creating p1 — X gives up`;
- while `streamProcess` runs — unchanged, `working…`, no offer.

`escapable` is a plain bool on the singleton, set by a single-shot 60 s `Timer`
armed in `launch()` for `actionProcess` and cleared on every launch and every
exit. 60 s because every command `actionProcess` runs is a unit verb or one of
nixarchy.pkg's writers, all of which finish in seconds. `X` joins
`handleTextKey` (`MicrovmView.qml:220`) and gets its `SHORTCUTS` row
(`Model.js:34`), so the sheet lists it for free; beside the footer text a
`PanelActionButton` visible on `escapable` gives the mouse the same escape. The
text is the discovery path — the user is already reading that line, because it
is the line that has been saying `working…` for a minute.

This settles the intent's open question 3: **both**, for different reasons. It
touches `MicrovmView.qml`, one `SHORTCUTS` row and `docs/usage.md`.

**Why `mutating` cannot be false while a write is pending.** The reviewer
called the old argument event-loop-dependent, and it was. It is now structural,
and it needs one reordering. `mutating` is false only when `actionProcess`
and `streamProcess` are both not running *and* `queue` is empty, and `queue` is
emptied in exactly two places:

1. the failure path in `onExited` (`:531`), where `actionProcess` has already
   been reaped and only one child ever exists, so nothing is in flight;
2. the `Qt.callLater` handoff, which today slices `queue` *before* it launches
   (`:538`-`:540`). Reordered to launch first and slice after —
   `root.launch(actionProcess, root.queue[0]); root.queue = root.queue.slice(1)`
   — `running` is already true when the last element leaves, so the two holders
   overlap instead of abutting and no reader, synchronous or deferred, can
   observe both false.

The `Qt.callLater` delay then does not matter at all: for as long as it is
owed, `queue` is non-empty and `mutating` is true. A late tick makes the plugin
slow, never unsafe. Verification step 8 tests this with a deliberately delayed
second command.

### 2. One way a failure reaches the user

`Model.processFailure({verb, command, code, stdout, stderr, refused, reason})`
becomes the single constructor of every "it did not work" line, wrapping
`Model.errorText` (`:581`) and `Model.writerError` (`:1456`). `actionProcess`
(`:526`), `streamProcess` (`:559`), the §1 watchdog, `abandon()`'s own line and
`askAgent`'s refusals all call it, so the sentence shape is decided once and
tested once.

Finding 2 is fixed by removing the string sentinel, not adding a second one.
`agentEnded` ("" | "cancelled" | "timeout" | "closed") is set by whoever ends
the call, and `agentProcess.onExited` (`:569`) returns early whenever it is
non-empty instead of testing `agentError === "cancelled"` (`:571`). One rule
covers every terminal reason, including later ones. The ordering is
runtime-dependent, so state the assumption: *if* `exited` fires after the timer
(`:363`), the early return preserves "the agent took too long (90 s)"; *if* it
never fires, the timer's message already stands. Both orderings give the same
sentence — the point of the flag. (The agent timer and `cancelAgent` keep
`running = false`; per §0 that is a SIGTERM whose reap flips `thinking` off,
which is what the UI wants there. Only the *lock* may not be released that way.)

### 2b. The degraded reads, and `stale`

The swallowed exit codes are **in scope** (open question 2), and the reviewer
is right that "keep the last good value" is a user-visible semantic change that
needs its own design rather than a clause. It is this:

- `unitsProcess` (`:419`) and `pendingProcess` (`:425`) keep their last good
  value on a non-zero exit instead of parsing or blanking.
- `helpProcess` (`:437`) collects stderr as `serviceHelpProbe` does (`:452`)
  and keeps the previous `features` when the combined text is empty.
- Three plain bools on the singleton — `unitsStale`, `pendingStale`,
  `helpStale` — each set true on the non-zero exit that made the plugin keep an
  old value and false on the next zero exit. Nothing binds to them but the
  status hook.
- `statusJson()` (`:370`) gains `stale: Model.staleList({units, pending, help})`
  — one pure function returning the fixed-order subset of
  `["units", "pending", "help"]` whose flag is true, `[]` when none is, so the
  field is always an array and IPC readers need no special case.

What this buys: a permanent VM no longer flickers to not-running for one poll
when `systemctl list-units` hiccups. Deliberately no banner — the user cannot
act on a stale read that self-heals within one poll — but it stays measurable
from outside. Only `listProcess` (`:405`) keeps driving a visible message.
Tests: `Model.staleList` over each subset and the empty case, and
`Model.detectFeatures` over stdout+stderr combined and over empty input.

### 3. The agent's lifecycle

**#23 owns the agent lifecycle.** One `resetAgent()` on the singleton stops any
call (`agentEnded = "closed"`) and clears `reasoning`, `agentForm` and
`agentError`. Called from `MicrovmView.dismiss()` (`:130`), from
`openForm`/`openEdit` (`:86`, `:96`, which today clear `MicrovmState.agentError`
by hand and stop doing so), and from `setMode` (`:123`) when the form is left —
a reply that lands with no form has nowhere to go. **Not** from `reset()`: that
runs on open, where the rule about not touching the stream or the log applies
for the same reason.

#25 (`spec/2026-09-24-25-view-and-form.md`) also restructures `openForm`,
`openEdit` and the form transitions. The division, so the two PRs cannot both
edit the same lines: **#23 defines `resetAgent()` and places the calls; #25 may
move or rename the handlers that call it, but reintroduces no direct
`MicrovmState.agentError = ""` and no direct `agentProcess` handling.** If #25
lands first, those two assignments stay as they are until this PR replaces them.

`schemaFile` (`:508`) gains `onLoadFailed: root.schemaText = ""`, and
`schemaLoaded` joins `featureState` (`:75`). `Model.listActions` (`:1232`)
gates `assist` on the schema as well as the agent, so with an unreadable
`schema.json` the `i` key is **absent**, per "a key that needs a missing
feature is absent, not broken" — and the sheet and footer follow for free, all
reading the same table. `askAgent` (`:334`) still sets `agentError` on each
refusal, for the IPC and paste paths that skip the key.

### 4. probe() and staleness

`onActiveChanged` (`:182`) calls only `refresh()`, which keeps its
`if (!root.probed)` guard (`:150`). `probe()` records `probedAt` and guards
each spawn with `if (!p.running)`, so a probe in flight is never clobbered.
`refresh()` re-probes when `Model.probeStale(Date.now(), root.probedAt)` — ten
minutes. Ten because toggling the popup must cost nothing, while a user who has
just rebuilt should see the new keys by the time they return; the file-backed
features (`pkgFile`, `appsFile`, `servicesFile`) are watched `FileView`s and
appear at once regardless. Ten toggles spawn one set of probes, not fifty.

### 5. Menu teardown

`Menu.qml` gains exactly `Panel.qml`'s shape (`:43`-`:46`):

    Component.onDestruction: if (root.opened) MicrovmState.release("view")

*If (5) is a non-bug* and the host always calls `close()` first, `root.opened`
is already false (`Menu.qml:73`) and the handler does nothing. *If (5) is
real*, the hold goes back. `release()` floors at zero (`:51`), and the `opened`
guard means a menu teardown can never release the popup's hold. Three lines,
right in both worlds, symmetric with the surface that already works.

### 6. What the status hook gains

`command: root.pendingCommand` and `pid: actionProcess.processId`, beside the
existing `mutating` and `pending`, plus `stale` from §2b. Without the pid,
Verification step 1 cannot tell a queue-only orphan from a live child from
outside, which is the whole point of that step.

## Alternatives rejected

- **`abandon()` as `actionProcess.running = false` plus `queue = []`.** The
  first draft of this spec, and wrong twice over: §0 shows `running = false` is
  a SIGTERM request that a child may ignore, and that `running` does not drop
  until the reap — so the assignment either does nothing or is redundant, while
  the `queue = []` beside it would be the thing that released the lock, exactly
  the overlap this design exists to prevent.
- **A watchdog on `mutating` as a whole.** The obvious reading of the intent,
  and wrong: it cannot tell a five-minute `microvm@p1` boot from a hang, so at
  its timeout it either refuses a real mutation too long or clears the lock
  beside a live command. Splitting the inert queue hold from the process hold
  removes the judgement call.
- **The escape on the error banner.** Unreachable in its own case:
  `MicrovmView.qml:552` shows that banner only when `lastError` is set, and a
  slow command sets none.
- **Queueing `{verb, key, argv}` records instead of argv arrays.** Touches
  `run()`, the handoff and every caller to carry a label that one property set
  in `launch()` carries for free, and for the failing case it would carry the
  wrong element anyway.
- **Restructuring the lock into a state machine with one owner token.** Cleaner
  on paper; rewrites every mutation path and the multi-step queue to fix a case
  that may not exist, and the rewrite is itself the larger risk to "one
  mutation at a time".
- **Automatic clearing with no user escape.** Leaves a stuck
  `actionProcess.running` — the case the 90 s agent timer proves can happen to
  a `Process` here — with no way out.
- **A handler per failing site.** Six patches, six sentence shapes, nothing
  testable in Node, and the seventh site gets forgotten.
- **A second string sentinel beside `"cancelled"`.** Narrowest fix for finding
  2; recreates the bug the next time a terminal reason is added.
- **Deferring the swallowed exit codes to their own issue.** They are the
  intent's stated defect verbatim, and §2b is smaller than the issue it would
  take to describe them.
- **A banner for a stale `systemctl` or `help` read.** Names something the user
  cannot act on and that clears itself within one poll.
- **Rewriting the menu lifecycle instead of adding `onDestruction`.**
  Speculation about a host behaviour nobody has observed.

## Risks

- **A lock fix that permits two concurrent mutations.** The top risk, and now
  closed structurally rather than by wording: the automatic watchdog arms only
  when no `Process` holds the lock; `abandon()` kills and never releases;
  `mutating` follows `running`, which Quickshell clears on the reap; and the
  handoff launches before it slices. No code path clears a hold owned by a live
  child.
- **A child that survives SIGKILL** (uninterruptible sleep). `mutating` stays
  true and the user is stuck — accepted, because the alternative is releasing
  the lock beside a live `opt set`. The message says the command was asked to
  stop, so the state on screen is at least true.
- **`signal()` racing the reap.** `abandon()` and the escalation both re-check
  `actionProcess.running` first; signalling a dead process is a no-op in
  Quickshell (`processId` is null and it has nothing to signal).
- **`X` against muscle memory for `x` (delete).** It is offered only while a
  mutation has run 60 s, and its worst outcome is killing the command the user
  was already waiting on.
- **Hiding `i` on a spurious `onLoadFailed`.** `schemaText` is only cleared on
  failure and restored on a later load, so the key goes missing briefly, not
  permanently.
- **Ten-minute staleness delays a just-installed feature.** Accepted: the
  file-backed half is watched, and `u` (`MicrovmView.qml:224`) forces a refresh
  that now re-probes.
- **Keeping the last good `units` masks a persistent `systemctl` failure**,
  showing VMs running when the plugin can no longer tell. Bounded by
  `statusJson().stale`, and `listProcess` still reports unreachable.
- **§0 was measured on one Quickshell (0.3.1) in a bench config.** If a future
  version reaps `running` eagerly, the §1 proof weakens to the old timing
  argument. The `signal()` and `processId` API is declared in the typelib and
  is the stable part; Verification step 4 re-measures the rest on the real
  plugin.

## Verification

`node tests/run.js` proves only the pure functions, and the honest list is
short: `Model.processFailure` (exit codes, writer refusals, empty stderr, the
`did not start` reason), `Model.commandName` (plain name, absolute path, the
adapter, `null` argv), `Model.workingText` in its three states,
`Model.staleList` over each subset and empty, `Model.listActions` with and
without `schemaLoaded` (the `i` key's presence), `Model.probeStale` at its
boundary, and `Model.detectFeatures` over stdout+stderr combined. Everything
that matters about the lock is QML: `Process` signal ordering, `signal()`
delivery, `Timer` arming, `FileView.onLoadFailed` and component destruction are
runtime behaviour this repository does not and cannot unit-test. The plan must
not claim otherwise. `nix flake check` covers the manifest, the `files` list
and the usual bans.

Live, on razer, per AGENTS.md's "Verifying live": install a copy with the shell
stopped, wait for `omarchy-shell shell ping`, confirm the bar is healthy first.
Test VMs `t1`, `t2` disposable and `p1` permanent. **`nixarchy-apply` is not
run as part of any of this.**

1. **Finding 1, and the queue-only orphan.** Take `nixarchy-service-enable` off
   `PATH`, press `c` through a permanent create for `p1`, then read
   `omarchy shell nixarchy.microvm.bar status` immediately. Record whether an
   exit arrives. The step passes on whichever branch the reading shows, and the
   two branches are not the same outcome:
   - **orphan** — `pid` null, `command` `nixarchy-service-enable`, `mutating`
     true from `queue` alone, and `pgrep -f nixarchy-service-enable` empty. Then
     and only then, within 5 s, `mutating` goes false and `lastError` names that
     command. (This is what the §0 bench predicts.)
   - **live child** — `pid` non-null. Then the watchdog must **not** have fired:
     assert `mutating` is still true after 10 s. That is the safety rule, and
     step 4 is the way out.
   Failing either branch fails the step; "a second action is accepted within
   5 s" is not asserted unconditionally.
2. **Finding 5.** Open the menu (`omarchy-shell shell toggle nixarchy.microvm
   '{}'`), trigger a plugin reload, then with nothing open read `views` and
   `polls` twice, 30 s apart: `views` 0, `polls` unchanged.
3. **No concurrent mutation.** Start `t1` from the menu and, while it builds,
   try to stop `t2` from the popup: refused, and no escape offered (the hold is
   `streamProcess`, and the footer says `working…` with no `X`).
4. **The escape, and the §0 measurement on the real plugin.** Start a slow
   `p1`. Before 60 s the footer reads `working… starting p1` with no offer.
   After 60 s it offers `X`. Note `pid` from `status`, press `X`, and watch
   three things in order: the process dies (`ps` on that pid), `mutating` goes
   false only after it does, and the message names the verb. Repeat once with a
   command wrapped so it ignores SIGTERM, to prove the 3 s SIGKILL escalation
   lands. Then confirm the next mutation is accepted.
5. **The agent.** Press `i`, describe a VM, let the 90 s timer fire with the
   network down — the message is the timeout's, not "exit -15". Press `esc`
   mid-think, and separately close the panel mid-think: no `claude` survives
   (`pgrep`). Rename `schema.json`: `i` is gone from the list, the sheet and
   the footer, and `status` reports `schemaLoaded: false`.
6. **probe().** Toggle the popup ten times and count `nixarchy-vm help` spawns
   in the journal: one, not ten.
7. **Degraded reads.** Take `systemctl` off `PATH` for one poll: permanent rows
   keep their state and `status` reports `stale: ["units"]`. Restore it and
   confirm `stale` returns to `[]`.
8. **The multi-step handoff under delay.** Create `p1` with the second command
   wrapped in a 10 s `sleep` on `PATH`, and hammer start/stop on `t1` from the
   other surface across the whole run, including the moment the first command
   exits: every attempt is refused, `mutating` never reads false in `status`
   polled every 200 ms, and the create completes. This is the test for the
   reordered handoff and for a `Qt.callLater` that is not prompt.

Tear down with `nixarchy vm rm t1 t2`, `nixarchy-opt-remove
programs.nixarchy.services.microvm.machines.p1`, restore `PATH`, and put the
owner's plugin back in the same stop-swap-start order.
