---
status: draft
issue: 23
spec: spec/2026-09-24-23-lock-and-lifecycle.md
---

# Plan: the lock follows the process, and every failure has one sentence

`mutating` stays exactly as honest as `Process.running`, which Quickshell flips
on the reap and not on the request, so no timer ever clears a hold a live child
owns. The two ways the lock outlives its work get opposite answers: the inert
queue-only hold is cleared automatically after 5 s, because in that state
nothing is running by construction; a hold owned by a running `actionProcess`
is never cleared, and instead the footer offers `X` after 60 s, which sends
signal 15, escalates to signal 9 after 3 s, and lets the ordinary `onExited`
path release the lock. Every "it did not work" line comes from one
`Model.processFailure`. `agentEnded` replaces the `"cancelled"` string
sentinel; `resetAgent()` ties the agent call to the form; an unreadable
`schema.json` hides `i` rather than breaking it; `probe()` re-runs at most
every ten minutes and never clobbers a probe in flight; degraded `units`,
`pending` and `help` reads keep their last good value and say so in
`statusJson().stale`; `Menu.qml` releases its view hold on destruction as
`Panel.qml` already does.

Two findings are unverified: whether `Process` emits `exited(code)` on a failed
exec (the §0 bench says yes — one Quickshell, outside this plugin), and whether
the host destroys the menu component without calling `close()`. The design is
correct in both worlds and must stay so; nothing below is dropped because a
determination comes back "not a bug". Steps 1 and 2 record the live answers in
this file before any code is written.

Order: the two readings first; then pure `Model.js` functions with their tests,
so each later QML step wires something already proven; then the lock, the
escape, its UI, the degraded reads, the agent, `probe()`, the menu; docs last,
once the key exists to document. The tree builds and `node tests/run.js` passes
after every step.

## Steps

1. **Live determination: finding 1.** No code. Install the current HEAD copy by
   the Tests section's procedure, take `nixarchy-service-enable` off `PATH`,
   press `c` through a permanent create for `p1`, read `omarchy shell
   nixarchy.microvm.bar status` at once and again after 10 s, run `pgrep -f
   nixarchy-service-enable`. → verify by adding a `## Findings` section to this
   file: `finding 1: exit emitted | no exit emitted`, with both `mutating`
   readings, whether a pid was visible, the date and the host. Commit
   `docs(plan): record finding 1 on razer (#23)`.
2. **Live determination: finding 5.** No code. Open the menu (`omarchy-shell
   shell toggle nixarchy.microvm '{}'`), trigger a plugin reload, then with
   nothing open read `views` and `polls` twice, 30 s apart. → verify by
   appending `finding 5: hold leaked | hold not leaked` with both readings to
   `## Findings`. Commit `docs(plan): record finding 5 on razer (#23)`.
3. **`Model.js`: the three pure strings.** `commandName(argv)` — basename of
   `argv[0]`, `"nixarchy-pkg"` when the path ends
   `/nixarchy.pkg/bin/nixarchy-pkg`, `""` for null or empty argv.
   `processFailure({verb, command, code, stdout, stderr, refused, reason})` —
   wraps `writerError` (`Model.js:1456`) and `errorText` (`:581`), falls back to
   `verb + " failed (exit " + code + ")"`, and returns `verb + ": " + command +
   " " + reason` when `reason` is set. `workingText({verb, key, escapable})` —
   `"working…"` with no verb, `"working… creating p1"` with one, `" — X gives
   up"` appended when `escapable`. New `tests/model/failure.test.js`.
   `MicrovmView.qml:427` drops its open-coded adapter mapping for
   `Model.commandName(a)`. → verify by `node tests/run.js` and by the review
   screen still printing `Runs: nixarchy-pkg opt set …`.
4. **`MicrovmState.qml`: one failure constructor.** `actionProcess.onExited`
   (`:526`), `streamProcess.onExited` (`:559`) and `askAgent`'s refusal
   (`:336`) build their line through `Model.processFailure`. QML-only wiring.
   → verify by `nix flake check`, and live by stopping an already-stopped VM
   and reading the line.
5. **`MicrovmState.qml`: the lock's shape.** `property string pendingCommand:
   ""` beside `pendingVerb` (`:126`); `launch()` (`:207`) gains
   `root.pendingCommand = Model.commandName(argv)`. The `Qt.callLater` handoff
   (`:537`-`:541`) is reordered to `root.launch(actionProcess, root.queue[0]);
   root.queue = root.queue.slice(1)`, so the two holders overlap. Add `Timer {
   id: queueWatchdog; interval: 5000; running: root.queue.length > 0 &&
   !actionProcess.running && !streamProcess.running; onTriggered: { root.queue
   = []; root.lastError = Model.processFailure({verb: root.pendingVerb,
   command: root.pendingCommand, reason: "did not start"}); root.pendingVerb =
   ""; root.pendingKey = "" } }` — `repeat` left false, armed only by that
   condition. QML-only, not unit-testable. → verify by `nix flake check` and
   live checks 1 and 8.
6. **`MicrovmState.qml`: the escape.** `property bool escapable: false`; `Timer
   { id: escapeTimer; interval: 60000; onTriggered: root.escapable = true }`,
   restarted in `launch()` only when `proc === actionProcess`, with `escapable
   = false` and `escapeTimer.stop()` at every launch and in
   `actionProcess.onExited`. `Timer { id: killTimer; interval: 3000;
   onTriggered: if (actionProcess.running) actionProcess.signal(9) }`. And:
   `function abandon() { if (!actionProcess.running) return; root.lastError =
   "giving up on " + root.pendingVerb + " — asking it to stop";
   actionProcess.signal(15); killTimer.restart() }`, which touches neither
   `mutating`, `queue` nor `running`. QML-only. → verify by live check 4.
7. **`MicrovmView.qml`: where the escape is offered.** The footer's right-hand
   line (`:640`) becomes `MicrovmState.mutating ? Model.workingText({verb:
   MicrovmState.pendingVerb, key: MicrovmState.pendingKey, escapable:
   MicrovmState.escapable && !MicrovmState.streaming}) : "? keys …"`. `X` joins
   `handleTextKey` (`:220`) as `if (key === "X") { MicrovmState.abandon();
   return }`, above the row-key line so it can never be read as `x`. A
   `PanelActionButton` beside the footer text, `visible: MicrovmState.escapable
   && !MicrovmState.streaming`, `onClicked: MicrovmState.abandon()`. QML-only.
   → verify by live check 4, and that `x` still deletes the row under the cursor.
8. **Degraded reads and `stale`.** `Model.staleList({units, pending, help})`
   returns the fixed-order subset of `["units", "pending", "help"]` whose flag
   is true, `[]` when none is. `unitsProcess` (`:419`) and `pendingProcess`
   (`:425`) parse only on `code === 0` and otherwise keep their last value;
   `helpProcess` (`:437`) gains a `stderr` `StdioCollector` and applies
   `Model.detectFeatures(helpOut.text + "\n" + helpErr.text)`, keeping the
   previous `features` when the combined text is empty. Bools `unitsStale`,
   `pendingStale`, `helpStale`, each true on the non-zero exit that kept an old
   value and false on the next zero exit. `statusJson()` (`:370`) gains `stale:
   Model.staleList(…)`, `command: root.pendingCommand` and `pid:
   actionProcess.processId`. → verify by `node tests/run.js` and live check 7.
9. **The agent's lifecycle.** `property string agentEnded: ""`, set
   `"cancelled"` in `cancelAgent` (`:353`), `"timeout"` in `agentTimer`
   (`:363`), `"closed"` in `resetAgent()`, cleared in `askAgent`;
   `agentProcess.onExited` (`:569`) returns early on `root.agentEnded !== ""`
   instead of testing `agentError === "cancelled"` (`:571`). `function
   resetAgent()` sets `agentEnded = "closed"`, stops `agentTimer`, sets
   `agentProcess.running = false`, and clears `reasoning`, `agentForm` and
   `agentError`. `MicrovmView.qml` calls it from `dismiss()` (`:130`), from
   `openForm` (`:86`) and `openEdit` (`:96`) in place of their direct
   `MicrovmState.agentError = ""`, and from `setMode` (`:123`) when leaving
   `"form"` — **never** from `reset()` (`:59`). `schemaFile` (`:508`) gains
   `onLoadFailed: root.schemaText = ""`; `featureState` (`:75`) gains
   `schemaLoaded: root.schemaText !== ""`; `Model.listActions` (`:1232`) gates
   `assist` on `s.schemaLoaded !== false` as well as the agent. → verify by
   `node tests/run.js` and live check 5. Per the spec's division with #25, this
   PR owns `resetAgent()` and its call sites.
10. **`probe()` and staleness.** `Model.probeStale(now, probedAt)` is true when
    `probedAt` is falsy or `now - probedAt >= 600000` (ten minutes). `probe()`
    (`:88`) sets `property double probedAt: 0` to `Date.now()` and guards every
    spawn with `if (!p.running)`. `refresh()` (`:149`) opens with `if
    (Model.probeStale(Date.now(), root.probedAt)) root.probe()`.
    `onActiveChanged` (`:182`) drops its direct `root.probe()` and calls only
    `refresh()`. → verify by `node tests/run.js` and live check 6.
11. **`Menu.qml` teardown.** Beside `close()` (`:70`): `Component.onDestruction:
    if (root.opened) MicrovmState.release("view")` — `Panel.qml:43`-`:46`'s
    shape, a no-op when the host did call `close()`. QML-only. → verify by
    repeating live check 2 with the menu left open across the reload: `views`
    is 0 afterwards.
12. **Docs.** `SHORTCUTS` (`Model.js:34`) gains `{ group: "Panel", keys: "X",
    text: "Give up on a change that has been running a minute" }`, so the `?`
    sheet lists it for free. The README key table gains the same row after `u`
    (`README.md:81`). `docs/usage.md`'s Troubleshooting gains a paragraph under
    the "Busy: …" entry (`:310`): a change running longer than a minute offers
    `X` on the footer; `X` asks the command to stop and kills it three seconds
    later; the lock is released only once the command is actually gone.
    → verify by `nix flake check` and by reading the `?` sheet on the desktop.
    No new runtime file exists anywhere in this plan, so `flake.nix`'s `files`
    list does not change, and `tests/` is copied whole (`flake.nix:90`), so
    `tests/model/failure.test.js` needs no entry either.

## Tests

**Node — `node tests/run.js`.** 70 cases pass today. This adds 25, counted one
`test(...)` call per named case below, so a green run reads **95 passed, 0
failed**. All go in a new `tests/model/failure.test.js` except the `listActions`
pair, which belongs beside the existing action tests in `tests/model/rows.test.js`.

- `Model.commandName` — 4: a plain name (`["systemctl","start",…]` →
  `"systemctl"`); an absolute path → `"systemctl"`; nixarchy.pkg's adapter path
  → `"nixarchy-pkg"`; `null` and `[]` → `""`.
- `Model.processFailure` — 5: non-zero exit with stderr (the stderr line wins);
  a writer refusal on stdout at exit 0 (the refusal wins); non-zero exit with
  empty stderr (`"<verb> failed (exit <code>)"`); the `reason: "did not start"`
  form (`"creating p1: nixarchy-service-enable did not start"`); the
  half-done permanent create keeps its "service queued, machine not written"
  wording.
- `Model.workingText` — 3: no verb → `"working…"`; verb and key, not escapable
  → `"working… creating p1"`; escapable → `"working… creating p1 — X gives up"`.
- `Model.staleList` — 3: nothing stale → `[]`; one flag → `["units"]`; all
  three → `["units","pending","help"]` in that order.
- `Model.detectFeatures` — 2: a help text split across stdout and stderr and
  concatenated detects all three features; empty input returns all three false.
- `Model.listActions` — 2: `schemaLoaded: true` with an agent offers `assist`;
  `schemaLoaded: false` with the same agent does not.
- `Model.probeStale` — 2: `probedAt` 0 is stale and nine minutes ago is not;
  ten minutes and one second ago is stale.

**Not unit-testable, and the plan does not pretend otherwise.** Steps 4–7, the
QML halves of 8–10, and 11 are `Process` signal ordering, `signal()` delivery,
`Timer` arming, `FileView.onLoadFailed` and component destruction — Quickshell
runtime behaviour this repository cannot run under Node. Only the live checks
cover them.

**`nix flake check`** after every step: manifest, entry points, the `files`
list, no symlinks, no `pacman`/`yay`, no hex colours, and `node tests/run.js`.

**Live, on razer**, per AGENTS.md's "Verifying live": `nix build`, then with the
shell stopped — `while quickshell kill -p "$OMARCHY_PATH/shell" --any-display
>/dev/null 2>&1; do :; done`, `rm -rf
~/.config/omarchy/plugins/nixarchy.microvm`, `cp -rL result
~/.config/omarchy/plugins/nixarchy.microvm`, `chmod -R u+w
~/.config/omarchy/plugins/nixarchy.microvm`, `omarchy-restart-shell` — then wait
until `omarchy-shell shell ping` answers and **confirm the bar is not blank**
(`qs log -i <instance> | grep -c pluginBarApiFor` is 0, `qs ipc -p
"$OMARCHY_PATH/shell" show | grep -cx 'target omarchy.bar'` is 1) before
anything else. Test VMs `t1` and `t2` disposable, `p1` permanent.
**`nixarchy-apply` is never run as part of any of this.**

1. *Finding 1 and the queue-only orphan.* `nixarchy-service-enable` off `PATH`,
   `c` through a permanent create for `p1`, read `status` at once and branch on
   `pid`. **Null** (a queue-only orphan, what the §0 bench predicts): `command`
   is `nixarchy-service-enable`, `pgrep -f nixarchy-service-enable` is empty,
   and within 5 s `mutating` goes false and `lastError` names that command.
   **Non-null** (a live child): `mutating` is *still true* after 10 s, because
   the watchdog must not fire beside a live process; check 4 is the way out.
   Failing either branch fails the check.
2. *Finding 5.* Menu open, plugin reload, then with nothing open read `views`
   and `polls` twice 30 s apart: `views` 0, `polls` unchanged.
3. *No concurrent mutation.* Start `t1` from the menu, and while it builds try
   to stop `t2` from the popup: refused, and the footer reads `working…` with
   no `X` (the hold is `streamProcess`).
4. *The escape.* Start a slow `p1`. Before 60 s the footer reads `working…
   starting p1` with no offer; after 60 s it offers `X`. Note `pid`, press `X`,
   and check the order: the process leaves `ps`, `mutating` goes false only
   after it does, and the message names the verb. Repeat once with a wrapper
   that traps SIGTERM, to prove the 3 s SIGKILL escalation lands. Then confirm
   the next mutation is accepted.
5. *The agent.* `i`, describe a VM, let the 90 s timer fire with the network
   down: the message is the timeout's, not `exit -15`. `esc` mid-think, and
   separately close the panel mid-think: no `claude` survives (`pgrep`). Rename
   `schema.json`: `i` is absent from the list, the sheet and the footer, and
   `status` reports `schemaLoaded: false`.
6. *`probe()`.* Toggle the popup ten times inside ten minutes and count
   `nixarchy-vm help` spawns in the journal: one, not ten.
7. *Degraded reads.* `systemctl` off `PATH` for one poll: permanent rows keep
   their state and `status` reports `stale: ["units"]`. Restore it; `stale`
   returns to `[]`.
8. *The multi-step handoff under delay.* Create `p1` with the second command
   wrapped in a 10 s `sleep` on `PATH`, hammering start/stop on `t1` from the
   other surface across the whole run, including the moment the first command
   exits. Poll `status` every 200 ms: every attempt is refused, `mutating`
   never reads false, and the create completes.

Tear down: `nixarchy vm rm t1 t2`, `nixarchy-opt-remove
programs.nixarchy.services.microvm.machines.p1`, restore `PATH`, and put the
owner's plugin back in the same stop-swap-start order.

## Rollback

One commit per step, and nothing here writes outside the repository — no state
directory, no `apps.nix`, no unit file. `git revert`, or `git checkout main --
.` plus the install procedure above, restores today's behaviour exactly.

**Can a partial application leave the lock worse than today?** One ordering
could: a watchdog without the reordered handoff might fire beside a
`Qt.callLater` that has not yet run. Step 5 lands both in the same commit, and
the watchdog's condition also requires both processes stopped, so no
intermediate tree is worse than `main`. Steps 6 and 7 are additive in either
order — without 7 the `X` key does not exist and `abandon()` is unreachable;
without 6 the footer never turns escapable. Step 11 can only decrement a hold
the menu itself took. Reverting step 9 restores the `"cancelled"` sentinel,
which is the current bug, not a new one.

**If the shell is mid-build when the user reverts.** Reverting means killing
the shell. A `nixarchy vm run` or a `microvm@p1` start is detached or
systemd-owned and survives it; the plugin loses the stream and its log, and the
VM finishes unwatched. Wait it out, or read the outcome afterwards from
`nixarchy vm list` and `systemctl status microvm@p1`. Do not revert during an
`opt set`: the window is milliseconds, but a half-written `apps.nix` is
repaired with `nixarchy-opt-remove` on that machine, never by hand.
