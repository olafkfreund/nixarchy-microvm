---
status: draft
issue: 23
intent: intent/2026-09-24-23-lock-and-lifecycle.md
---

# Spec: a process that never reports must not be the end of the story

## Design

Two findings are unverified: whether `Process` emits `exited(code)` when exec
itself fails (1), and whether the host destroys the menu component without
calling `close()` (5). Each choice below is stated in both worlds.

### 1. The lock

`mutating` (`MicrovmState.qml:130`) keeps its three holders, and no timer ever
clears a hold a live process owns. The two ways it can outlive its work need
opposite answers, so they are separated.

**The queue hold is bounded automatically.** `queue.length > 0 &&
!actionProcess.running && !streamProcess.running` should exist for exactly one
`Qt.callLater` tick (`:537`-`:541`). If it lasts, nothing is running and
nothing will ever fire, so clearing it cannot interrupt anything — by
construction, not by judgement. A single-shot 5 s `Timer`, armed only on that
condition, empties `queue`, reports `Model.processFailure` for the verb that
did not start, and lets the next mutation through. 5 s because the only
legitimate occupant of that state is one event-loop tick.
*If (1) is a non-bug*, `onExited`'s failure path clears `queue` in the same
tick (`:531`), the condition never holds for 5 s, and the timer never fires —
dead code on a healthy host, which is what a watchdog should be. *If (1) is
real*, this is the fix.

**A hold owned by a running `Process` is never cleared by a timer.** A
`systemctl start microvm@p1` on a cold guest, or a `nixarchy vm run --detach`
build, is genuinely slow and a timer cannot tell it from a hang; clearing it
would let a second mutation start beside a live one, the rule this repository
cares most about. So the escape is the user's: once `actionProcess` has held
the lock for 60 s, `busyText()` (`:193`) gains "press X to give up waiting",
and `X` — a button on the existing error banner (`MicrovmView.qml:552`) —
calls `abandon()`: `actionProcess.running = false`, `queue = []`, `lastError`
= "gave up waiting for <verb> — it may still be running". 60 s because every
command `actionProcess` runs is a unit verb or one of nixarchy.pkg's writers,
all of which finish in seconds. Never offered while `streamProcess` holds the
lock: that one draws its own log and prints its own exit line. Because
`abandon()` terminates the process it releases, two mutations still cannot run
at once.

This settles the intent's open question 3: **both**, for different reasons. It
touches `MicrovmView.qml`, one `SHORTCUTS` row (`Model.js:34`) and
`docs/usage.md`.

### 2. One way a failure reaches the user

`Model.processFailure({verb, code, stdout, stderr, refused})` becomes the
single constructor of every "it did not work" line, wrapping `Model.errorText`
(`:581`) and `Model.writerError` (`:1456`). `actionProcess` (`:526`),
`streamProcess` (`:559`), `abandon()` and `askAgent`'s refusals all call it, so
the sentence shape is decided once and tested once.

Finding 2 is fixed by removing the string sentinel, not adding a second one.
`agentEnded` ("" | "cancelled" | "timeout" | "closed") is set by whoever ends
the call, and `agentProcess.onExited` (`:569`) returns early whenever it is
non-empty instead of testing `agentError === "cancelled"` (`:571`). One rule
covers every terminal reason, including later ones. The ordering is
runtime-dependent, so state the assumption: *if* `exited` fires after the timer
(`:363`), the early return preserves "the agent took too long (90 s)"; *if* it
never fires, the timer's message already stands. Both orderings give the same
sentence — the point of the flag.

The swallowed exit codes are **in scope** (open question 2). Same defect — a
process reported nothing and the plugin invented an answer — and each is a
one-line change of the shape `listProcess` already has (`:405`).
`unitsProcess` (`:419`) and `pendingProcess` (`:425`) keep their last good
value on a non-zero exit; `helpProcess` (`:437`) collects stderr as
`serviceHelpProbe` does (`:452`) and keeps the previous `features` when the
combined text is empty. What this buys: a permanent VM no longer flickers to
not-running for one poll when `systemctl list-units` hiccups. Deliberately no
banner for these — the user cannot act on a stale read that self-heals within
one poll — but `statusJson()` (`:370`) gains a `stale` list, so it stays
measurable from outside. Only `listProcess` keeps driving a visible message.

### 3. The agent's lifecycle

One `resetAgent()` on the singleton stops any call (`agentEnded = "closed"`)
and clears `reasoning`, `agentForm` and `agentError`. Called from
`MicrovmView.dismiss()` (`:130`), from `openForm`/`openEdit` (`:86`, `:96`,
which stop clearing `agentError` by hand), and from `setMode` (`:123`) when the
form is left — a reply that lands with no form has nowhere to go. **Not** from
`reset()`: that runs on open, where the rule about not touching the stream or
the log applies for the same reason.

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
appear at once regardless. A feature appearing mid-session is visible within
ten minutes of the next open, and ten toggles spawn one set of probes, not
fifty.

### 5. Menu teardown

`Menu.qml` gains exactly `Panel.qml`'s shape (`:43`-`:46`):

    Component.onDestruction: if (root.opened) MicrovmState.release("view")

*If (5) is a non-bug* and the host always calls `close()` first, `root.opened`
is already false (`Menu.qml:73`) and the handler does nothing. *If (5) is
real*, the hold goes back. `release()` floors at zero (`:51`), and the `opened`
guard means a menu teardown can never release the popup's hold. Three lines,
right in both worlds, symmetric with the surface that already works.

## Alternatives rejected

- **A watchdog on `mutating` as a whole.** The obvious reading of the intent,
  and wrong: it cannot tell a five-minute `microvm@p1` boot from a hang, so at
  its timeout it either refuses a real mutation too long or clears the lock
  beside a live command. Splitting the inert queue hold from the process hold
  removes the judgement call.
- **Restructuring the lock into a state machine with one owner token.** Cleaner
  on paper; rewrites every mutation path and the multi-step queue to fix a case
  that may not exist (finding 1 unverified), and the rewrite is itself the
  larger risk to "one mutation at a time".
- **Automatic clearing with no user escape.** Leaves a stuck
  `actionProcess.running` — the case the 90 s agent timer proves can happen to
  a `Process` here — with no way out.
- **A handler per failing site.** Six patches, six sentence shapes, nothing
  testable in Node, and the seventh site gets forgotten.
- **A second string sentinel beside `"cancelled"`.** Narrowest fix for finding
  2; recreates the bug the next time a terminal reason is added.
- **Deferring the swallowed exit codes.** They are the intent's stated defect
  verbatim, and keeping the last good value is smaller than the issue it would
  take to describe them.
- **A banner for a stale `systemctl` or `help` read.** Names something the user
  cannot act on and that clears itself within one poll.
- **Rewriting the menu lifecycle instead of adding `onDestruction`.**
  Speculation about a host behaviour nobody has observed.

## Risks

- **A lock fix that permits two concurrent mutations.** The top risk.
  Prevented structurally: the automatic watchdog arms only when no `Process`
  holds the lock, so there is no live command to race; the 60 s escape is
  user-initiated and terminates the process before clearing the queue. No timer
  ever clears a hold owned by a running `Process`.
- **`abandon()` releasing a command still alive.** If `running = false` does
  not reap the child, an `opt set` could still be writing. Mitigated by the
  wording, by 60 s being far past any of these commands, and by the writers
  being idempotent per name.
- **Hiding `i` on a spurious `onLoadFailed`.** `schemaText` is only cleared on
  failure and restored on a later load, so the key goes missing briefly, not
  permanently.
- **Ten-minute staleness delays a just-installed feature.** Accepted: the
  file-backed half is watched, and `u` (`MicrovmView.qml:224`) forces a refresh
  that now re-probes.
- **Keeping the last good `units` masks a persistent `systemctl` failure**,
  showing VMs running when the plugin can no longer tell. Bounded by
  `statusJson().stale`, and `listProcess` still reports unreachable.
- **`X` against muscle memory for `x` (delete).** It lives on the error banner,
  only while offered, and does nothing destructive.

## Verification

`node tests/run.js` proves only the pure functions, and the honest list is
short: `Model.processFailure` (exit codes, writer refusals, empty stderr),
`Model.listActions` with and without `schemaLoaded` (the `i` key's presence),
`Model.probeStale` at its boundary, the busy and escape text, and
`Model.detectFeatures` over stdout+stderr combined. Everything that matters
about the lock is QML: `Process` signal ordering, `Timer` arming,
`FileView.onLoadFailed` and component destruction are runtime behaviour this
repository does not and cannot unit-test. The plan must not claim otherwise.
`nix flake check` covers the manifest, the `files` list and the usual bans.

Live, on razer, per AGENTS.md's "Verifying live": install a copy with the shell
stopped, wait for `omarchy-shell shell ping`, confirm the bar is healthy first.
Test VMs `t1`, `t2` disposable and `p1` permanent. **`nixarchy-apply` is not
run as part of any of this.**

1. **Finding 1, now design validation.** Take `nixarchy-service-enable` off
   `PATH`, press `c` through a permanent create for `p1`, then read `mutating`,
   `pending` and `lastError` from `omarchy shell nixarchy.microvm.bar status`.
   Record whether the exit arrives. Either way a second action is accepted
   within 5 s, and the message names the command that did not start.
2. **Finding 5, now design validation.** Open the menu
   (`omarchy-shell shell toggle nixarchy.microvm '{}'`), trigger a plugin
   reload, then with nothing open read `views` and `polls` twice, 30 s apart:
   `views` 0, `polls` unchanged.
3. **No concurrent mutation.** Start `t1` from the menu and, while it builds,
   try to stop `t2` from the popup: refused, and no escape offered (the hold is
   `streamProcess`).
4. **The escape.** Start a slow `p1`, wait past 60 s, press `X`: the lock
   releases, the message names the verb, the next mutation is accepted.
5. **The agent.** Press `i`, describe a VM, let the 90 s timer fire with the
   network down — the message is the timeout's, not "exit -15". Press `esc`
   mid-think, and separately close the panel mid-think: no `claude` survives
   (`pgrep`). Rename `schema.json`: `i` is gone from the list, the sheet and
   the footer, and `status` reports `schemaLoaded: false`.
6. **probe().** Toggle the popup ten times and count `nixarchy-vm help` spawns
   in the journal: one, not ten.
7. **Degraded reads.** Take `systemctl` off `PATH` for one poll: permanent rows
   keep their state and `status` reports them stale.

Tear down with `nixarchy vm rm t1 t2`, `nixarchy-opt-remove
programs.nixarchy.services.microvm.machines.p1`, restore `PATH`, and put the
owner's plugin back in the same stop-swap-start order.
