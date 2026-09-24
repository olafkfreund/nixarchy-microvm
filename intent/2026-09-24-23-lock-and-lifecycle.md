---
status: approved
issue: 23
author: olafkfreund
---

# Intent: the state layer has one story for a process that does not report

Closes #23.

## Problem

`MicrovmState.qml` assumes a process starts, exits, and reports. Most of the
time it does. Where one does not — the binary is missing, the file will not
load, the timer fires first, the surface closes mid-call — there is no
fallback, and the result is a silent no-op, a wrong message, or a lock nobody
can clear. Six places found in one review, all the same shape.

**1. The mutation lock has one holder and no way out.** `mutating` is
`actionProcess.running || streamProcess.running || queue.length > 0` (`:130`),
and `queue` is emptied only inside `actionProcess.onExited` (`:524`, `:532`,
`:538`). No timeout, no manual reset anywhere in the file. A permanent create
is two commands: `run()` sets `queue = argvs.slice(1)` and launches the first
(`:224`-`:225`), `nixarchy-service-enable`. AGENTS.md records that a missing
command fails silently inside a QML `Process`. If such a launch never produces
an exit, `queue` stays non-empty and every later start, stop, restart, create
and delete is refused from both surfaces (`:218`) with a stale
`Busy: creating …` for as long as the shell runs.

**This one is unverified.** It hinges on whether Quickshell's `Process` emits
`exited(code)` when exec itself fails. If it does, the lock clears and this is
a design fragility — one holder, no watchdog, no escape — rather than a live
bug. The check, on razer: take `nixarchy-service-enable` off `PATH`, press `c`
through a permanent create, then read `mutating` from
`omarchy shell nixarchy.microvm.bar status` and try a second action.

**2. The agent timeout tells the user the wrong reason.** `agentTimer`
(`:360`-`:368`) sets `agentError` to "the agent took too long (90 s)" and then
kills the process. `agentProcess.onExited` (`:569`-`:578`) runs next and
`Model.agentFailure` (`Model.js:1371`) replaces it with "the agent failed
(exit -15)". `cancelAgent` (`:353`-`:358`) survives the same collision through
the `agentError === "cancelled"` sentinel (`:571`); the timeout has no
equivalent. #7 and #8 made this message visible and right — this is the case
they missed.

**3. AI assist can fail silently and permanently.** `schemaFile`
(`:508`-`:513`) has `onLoaded` but no `onLoadFailed`, so an unreadable
`schema.json` leaves `schemaText` empty, and `askAgent` returns false on
`!root.schemaText` (`:335`) **without setting `agentError`**. The `i` key is
still offered: `Model.listActions` gates the describe field on the agent alone
(`Model.js:1237`, `:950`), never on the schema. The user types a description,
presses Enter, and nothing happens and nothing is said. The same silent false
covers the `agentProcess.running` case.

**4. A pending agent call outlives the surface.** Neither `reset()`
(`MicrovmView.qml:59`) nor `dismiss()` (`:130`) calls `cancelAgent`. Closing
mid-think leaves `claude` running for up to 90 s; reopening and pressing `i`
then lands on the silent false from (3). AGENTS.md's rule that `open()` never
touches the stream or the log is deliberate for those two; the agent was never
decided either way, and that gap is the bug.

**5. `Menu.qml` can leak a view hold.** `Panel.qml:43`-`:46` releases both its
holds in `Component.onDestruction`. `Menu.qml` (`:61`-`:74`) has no
`Component.onDestruction`; `views` is decremented only in `close()` (`:71`). A
leaked count keeps `active` true, and the 3 s fast poll (`:175`-`:180`) then
runs with every surface closed — a direct contradiction of the "nothing polls
while every surface is closed" rule. **Unverified:** whether omarchy-shell ever
destroys or reloads a keepLoaded menu component without calling `close()`. The
check: open the menu, trigger a plugin reload, then read `views` and `polls`
from the status hook with nothing open.

**6. `probe()` re-runs on every open.** `onActiveChanged: if (active) {
root.probe(); refresh() }` (`:182`) calls it unconditionally, bypassing
`refresh()`'s own `if (!root.probed)` guard (`:150`). Each open re-assigns
`.command` and sets `running = true` on five detection processes
(`:88`-`:101`), including while a previous run is in flight, where Quickshell
drops the new command with no sign. Toggling the popup ten times is roughly
fifty spawns, and detection becomes last-probe-wins with no staleness control.

Lower rank, same shape: `unitsProcess` and `pendingProcess` (`:416`-`:426`)
apply their parse regardless of exit code and collect no stderr, so a
transient `systemctl list-units` failure flips every permanent VM to
not-running for one poll with nothing said — `listProcess` (`:402`-`:413`) has
a `reachable` flag for exactly this. And `helpProcess` (`:434`-`:438`) reads
stdout only and applies `detectFeatures` regardless of exit code, so if
`nixarchy-vm help` ever wrote its usage to stderr, three features would
disappear unexplained; `serviceHelpProbe` (`:448`-`:453`) concatenates both
streams, which is the pattern that works.

## Proposed outcome

- A mutation can never leave the lock held for the shell's lifetime. Whatever
  the cause, the user ends up able to act again, and is told why the last
  thing did not happen.
- Every failure of the agent call reports its own reason, the timeout
  included, and no later handler overwrites it.
- AI assist is offered only when it can work, and says so when it refuses. No
  key produces silence.
- Closing a surface does not leave an agent call running against nothing.
- Nothing polls while every surface is closed, whatever the host does to the
  menu component.
- Feature detection runs when it is needed, and a probe in flight is not
  clobbered by another.

## Affected users and systems

`MicrovmState.qml` throughout, `Menu.qml`'s lifecycle, `MicrovmView.qml`'s
`reset`/`dismiss`, and whatever moves into `Model.js`. Both surfaces, and
anyone driving them over IPC. Most visible on a host missing
`nixarchy-service-enable` or nixarchy.pkg's adapter, and to anyone using AI
assist. No change to what any command does.

## Constraints

- One mutation at a time, via the singleton, from either surface. A fix must
  not let a mutation start while another is genuinely running.
- Listing, console, logs, copy, apply and the agent call never lock.
- Nothing polls while every surface is closed; the bar's slow poll for the
  glyph is the only exception.
- The surfaces are keep-loaded: `open()` resets the view and focuses the final
  mode's target, and does not touch the stream or the log.
- Every `nixarchy vm` feature is detected, not assumed. A key that needs a
  missing feature is absent, not broken.
- Logic goes in `Model.js` with a Node test; QML stays drawing and wiring.
- The status hook keeps reporting enough (`polls`, `views`, `mutating`) to
  measure all of this from outside.

## Open questions

1. **Should (1) and (5) be confirmed on a live desktop before this proceeds?**
   Both checks are written above and both need razer. If `Process` does emit an
   exit on a failed exec, (1) is hardening rather than a fix, and its priority
   in the spec changes. Proposal: run both, record the answers in the spec.
2. **Do the swallowed exit codes belong here?** `unitsProcess`,
   `pendingProcess` and `helpProcess` are the same failure-reporting problem,
   but fixing them means deciding what stale or degraded data looks like on
   screen, which is a visible-behaviour change. Here, or a separate issue?
3. **What does a stuck lock look like to the user?** A timeout that clears it
   by itself, a key that clears it, or both, is a spec decision — but it
   decides whether this issue touches `MicrovmView.qml` and the shortcut sheet
   at all, and so whether docs change in the same PR.
