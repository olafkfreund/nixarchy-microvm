---
status: draft
issue: 49
intent: intent/2026-11-16-49-simplify-create-delete.md
---

# Spec: simpler create and delete; require current nixarchy and nixarchy-pkg

## Design

Line numbers are on `fix/46-review-findings` (PR #47), which this builds on.
The work starts only after #47 merges, rebased onto `main`.

The two failure rules the intent sets apply to every new multi-step action
below:

- each action holds the single mutation lock from its first step to its
  last;
- a failed step stops the rest.

### 1. One upstream verdict instead of feature flags

- **The verdict.** A new pure function,
  `Model.upstreamVerdict(helpText, optReply, pkgPresent)`, returns `""` when
  the host is new enough. Otherwise it returns one message naming what to
  update:
  - **nixarchy** is new enough when `nixarchy-vm help` names `--detach`,
    `console` and `set-template`. These are the three subcommands of #762
    that show in help; `list --json` came in the same release.
  - **nixarchy-pkg** is new enough when `opt replace` answers with a usage
    line (`optReplaceSupported`, unchanged). This is checked only when
    `pkgPresent`, meaning the nixarchy.pkg plugin is installed.
  - **The message** is, for example: "This plugin needs nixarchy with `nixarchy
    vm run --detach` (nixarchy#762); update nixarchy." For nixarchy-pkg, the
    same with #19.
- **`MicrovmState.qml`.** The two probes stay, since they are the "cheap
  check" the owner approved.
  - `features`, `vmJson` and `optReplace` give way to one `upstreamError`
    string, set from the verdict.
  - `featureState` loses `vmDetach`, `vmConsole`, `vmSetTemplate` and
    `optReplace`, and gains `upstreamOk`.
- **When the verdict is not empty:**
  - every mutation action is absent (`actionsFor` returns only `copy` when
    `!s.upstreamOk`);
  - the list header and the empty text show `upstreamError`;
  - `c` and `i` say it in the footer instead of opening the form;
  - listing still works, so the user sees their VMs.
- **Removed code:**
  - the text fallbacks in `parseVmList` and `parseTemplates`
    (`Model.js:210-280`). Output that is not JSON becomes a list error,
    which B2's "VM list failed" path shows;
  - `startTerminal`, both from the actions (`Model.js:1412`, `1415`) and
    from `MicrovmState.qml:379-386`, plus `runTerminalArgv`;
  - the `#762` and `#19` reasons in `hiddenReason` (`Model.js:1488-1504`);
  - `detectFeatures`. Its regexes move into `upstreamVerdict`.
- **What stays:** the #843 detection (`serviceHeals`), because #843 is still
  open.

### 2. Create starts the VM (disposable)

- **A new form field** `startNow` (`widget: "bool"`, label "Start it now",
  disposable only), default `true` in `emptyForm`.
  - It is not an agent field, so `schema.json` and `AGENT_FIELDS` are
    unchanged.
  - It is not part of an edit.
- **`MicrovmState.submit`.** For a disposable create with `startNow`, it
  records `startAfter = name` and runs the create as today.
  - In `actionProcess.onExited` (`:680-712`), on success, with an empty
    queue and `startAfter` set, it calls `startStream` for that VM in the
    same handler. There is no `Qt.callLater`, so `mutating` never drops
    between the create and the start.
  - `startStream` takes the lock itself.
  - On failure, `startAfter` is cleared and nothing starts.
- **A failed start** shows in the stream log and the hint line, as any
  failed stream does today. The row shows as stopped (the next poll), and
  nothing is retried.
- **Tests:**
  - `emptyForm("disposable").startNow === true`;
  - `visibleFields` shows `startNow` only for a disposable create;
  - a new `Model.startAfterCreate(form)` returns the name, or `""` for an
    edit, a permanent form, or `startNow: false`.

### 3. Delete handles a running disposable VM

- **The reason it can't be a plain queue.** `nixarchy vm stop` runs
  `microvm-shutdown`, which asks the guest to power down and returns at once
  (`nixarchy-vm`, `stop_vm`), and `rm` refuses a running VM. So the delete
  becomes a three-part action under one lock:
  1. **stop:** `stop` runs through `actionProcess`.
  2. **wait:** on success, `MicrovmState` enters `removeWait = {name,
     since}`, and `mutating` includes `removeWait !== null`. A 2 s timer
     reruns the list.
     - When the VM shows as stopped, it runs `rm` (`rmVmArgv`), and the
       wait ends.
     - At 30 s, `stop` is sent once more. This was observed live on
       2026-11-16: a guest still booting ignored the first power-down, and
       the second one stopped it.
     - At 90 s, the wait ends with
       `lastError = "<name> did not stop within 90 s; nothing was deleted"`.
  3. **rm**, under the same lock.
- **`removeMessage`** (`Model.js:1518`) for a running disposable VM says:
  "Stop and delete <name>, and everything in <dir>?" The question is asked
  once, through the existing `ask`.
- **`X` (abandon)** also ends `removeWait`, with "gave up waiting for <name>
  to stop; nothing was deleted".
- **Tests:**
  - `removeMessage` for running and for stopped;
  - a new `Model.removeWaitStep(state, rows, now)`, which returns `"rm"`,
    `"resend"`, `"timeout"` or `"wait"`.

### 4. One key per job

- `openForm(kind, field)` in `MicrovmView.qml` takes the field to start on:
  - `c`, IPC `create` (`Panel.qml`) and the menu's `{"create": true}`
    (`Menu.qml:66`) start at `"name"`;
  - `i` starts at `"describe"`.
- The cursor index comes from a new `Model.fieldIndexOf(fields, key)`, with
  a test. `CreateForm.start(kind, field)` passes it on.

### 5. A short permanent form

- **A new UI-only field** `advanced` (`widget: "bool"`, label "SSH and
  shares", permanent only), default `false`.
- **`visibleFields(form, state, errors)`** hides `sshPort`, `sshKey` and
  `shares` unless one of these holds:
  - `form.advanced`;
  - any of the three is non-empty in `form`;
  - `errors` names one of them.

  The third argument is optional, and every caller passes `check.errors`.
  So an edit (`formFromRow`), an agent reply and a refused Enter always show
  them, as the intent requires.
- **`advanced` is never emitted** into the snippet: `machineSnippet` reads
  only its own keys, which are unchanged.
- **Tests:** each of those three cases shows the fields, and an empty new
  permanent form hides them.

### 6. "Apply now?" after a permanent create or edit

- **The signal.** When `actionProcess` drains with no failure,
  `pendingVerb` is `creating` or `editing`, and the key is `permanent:`,
  `MicrovmState` emits `permanentWritten(name)`.
- **Who asks.** A `MicrovmView` that is open, in list mode, and owns the
  submit asks:

  > Apply now? nixarchy-apply rebuilds the whole system from apps.nix, in a
  > terminal.

  The existing `ask` (default No) handles it, and Yes calls `apply()`.
  - The owner is the surface that called `submitForm`. The same `surface`
    from #46/B9 is reused: `MicrovmState.submit(form, owner)` records it.
  - A delete never asks.
- **Tests:** a new `Model.offerApply(verb, key, failed)`, which returns a
  bool, covers create and edit (true), delete and disposable (false), and a
  failure (false).

### 7. Words

- **The agent prompt** (`Model.js:1564`) drops "only while attached":
  disposable VMs run detached now.
- **AGENTS.md:**
  - "Every `nixarchy vm` feature is detected, not assumed" becomes "The
    plugin requires nixarchy with #762, and nixarchy-pkg with #19 when
    nixarchy.pkg is installed. One verdict says what to update. #843 is
    still detected";
  - the #46 sentence about the untracked terminal start is removed, since
    there is no terminal start any more;
  - "One mutation at a time" adds that create-and-start and stop-and-delete
    hold the lock throughout.
- **README key tables:**
  - `c` (at the name), `i` (at the description);
  - `x` on a running disposable VM;
  - the "Start it now" and "SSH and shares" switches;
  - the upstream note.
- **`docs/usage.md`:** the create, delete and apply flows, and "too old".
- **`docs/upstream.md`:** #762 and #19 become requirements, not optional;
  #843 stays optional.
- **`manifest.json`:** the description is checked for "detected" wording.

## Alternatives rejected

- **Queue `[stop, rm]` directly.** `stop` returns before the VM is down, so
  `rm` refuses it. This was observed live with `t1`.
- **`systemctl --user stop nixarchy-vm-<name>`** for a synchronous stop.
  AGENTS.md says disposable state is touched only through `nixarchy-vm`.
- **Upstream `nixarchy vm stop --wait`** (or `rm --force`). It is the
  cleaner long-term fix, but this task would then depend on a new upstream
  release. It is noted for the agent-sandbox upstream issue (roadmap A1).
- **Drop detection entirely and let the first command fail.** The owner
  chose one clear verdict.
- **Ctrl+Enter for "create stopped"** instead of a switch. It is invisible,
  and it isn't on the shortcut sheet without extra keys. A switch is data in
  the form, and it is testable.
- **"Apply now?" after a delete.** The owner's decision is create and edit
  only.

## Risks

- **A VM may never show as stopped.** For example, the guest hangs on
  shutdown. Then the 90 s wait ends with an error and nothing is deleted. The
  lock is held for up to 90 s, which `X` can end.
- **Older hosts lose every action** until they update. That is intended, and
  the verdict says what to update.
- **`startAfter` and a closed surface.** The stream runs whether or not a
  surface is open, as `s` does today. Polling rules are unchanged.
- **Field count.** `startNow` and `advanced` add fields, so the shortcut
  sheet and the form-height budget change. Check the menu and the popup at
  text size 12.
- **Merge order.** This rewrites lines #47 touches, so it is rebased after
  #47 merges.

## Verification

- `node tests/run.js` passes with the new tests: `upstreamVerdict` (old
  nixarchy, old nixarchy-pkg, no nixarchy.pkg, current), `startAfterCreate`,
  `removeWaitStep`, `fieldIndexOf`, the `visibleFields` cases, `offerApply`
  and `removeMessage`. Existing tests that relied on the removed text parsers
  or feature flags are updated, and each one is named in its commit.
- `nix flake check`, `--all-systems --no-build`, `nix build`, and a
  fresh-clone `omarchy plugin validate` all pass.
- Live, by AGENTS.md "Verifying live", with an ai-mirror grant and the
  owner's desktop free:
  1. `c` opens at the name. Type `t1`, then Enter: the build streams and
     `t1` runs.
  2. `x` on running `t1`, then yes: the footer shows the wait, `t1` stops,
     and it is deleted.
  3. `c`, name `t2`, "Start it now" off, Enter: `t2` is created stopped.
     Then `rm` it.
  4. `c`, Kind permanent: SSH and shares are hidden, and the switch shows
     them. Enter, then the review, then write `p1`: "Apply now?" is asked.
     Answer No. Then remove `p1` with `nixarchy-opt-remove`.
  5. `i` opens at the description.
  6. The bar is healthy, there are no plugin warnings, and `apps.nix`
     matches its snapshot.
- The too-old path can't be reproduced on this host. It is covered by the
  `upstreamVerdict` tests only.
