---
status: draft
issue: 46
intent: intent/2026-11-16-46-review-findings.md
---

# Spec: twelve bugs from the 1.0.0 reviews

## Design

One branch and one PR, as the owner confirmed. The commits come in three
groups, so each group can be read, and reverted, on its own:

1. **Validation:** B1, B5, B10.
2. **State and lifecycle:** B2, B3, B4, B6, B8, B9, B11.
3. **Display:** B7, B12, and the cleanup.

Every `Model.js` change has a test in `tests/model/` that fails on
`27e5992` and passes after the fix. Existing fixtures that a fix
legitimately changes are updated in the same commit, and the commit names
each one (listed per item below).

Codex and agy both reviewed the first draft. This version takes in their
findings, and the "Review" note under each item says which.

### Group 1: validation

**B1: an edit is never refused over its own name.**

- **The name rule.** In `validateForm` (`Model.js:945`), when
  `f.editing === true`, the name is checked with the rule the writer already
  accepts:
  - a permanent VM uses `isNixAttrName`, as `optReplaceArgv` does
    (`Model.js:1289`);
  - a disposable VM uses `isReportedName`, as `setTemplateArgv` does
    (`Model.js:1249`).

  A create still uses `isVmName`.
- **The message.**
  - A new pure function, `Model.hiddenFieldError(fields, errors)`, returns
    `"<label>: <message>"` for the first error on a field that is not
    visible, and `""` otherwise.
  - `CreateForm` draws it in its own `Text` under the field list, visible
    while non-empty after Enter (`attempted`).
  - It does **not** use `agentError`. That property is bound from the view
    (`MicrovmView.qml:487`), and writing it would break the binding. It is
    also drawn only under describe (`CreateForm.qml:470`), which an edit
    hides. *Review: both.*
- **Tests:**
  - an edit of `Old_VM` (permanent) and of `1box` (disposable) passes;
  - a create with either name is refused;
  - `hiddenFieldError` returns the name error when name is hidden, and
    `""` when every error is on a visible field.

**B5: one host port per machine, one mount per guest path.**

- **Port.** For a permanent form with a non-empty port, `validateForm`
  compares `parseInt(port, 10)` with every *other* permanent row's port.
  - "Other" means `row.name !== trim(f.name)`.
  - The comparison is numeric, so `02222` collides with `2222`.
    `isInteger` accepts leading zeros, and the emitter writes the number.
    *Review: both.*
  - A collision sets:

    ```text
    errors.sshPort = "Port 2222 is already used by <name>"
    ```

  - Only rows read from `apps.nix` carry a port. A machine declared
    elsewhere in the flake is not checked, and `docs/usage.md` says so.
- **Mounts.** `parseShares` (`Model.js:837`) keeps a set of normalized guest
  paths. A second share on the same path returns:

  ```text
  { error: "Two shares mount at /mnt/a" }
  ```

- **Fixtures that change:** in `tests/model/form.test.js`, the port-2222
  fixtures (line 116) and the duplicate-mount case
  `"/a:/mnt/a /b:/mnt/a"` (lines 158–165). The mount case flips from
  accepted to refused; the port fixtures get distinct ports. *Review: agy.*
- **New tests:**
  - ports that collide, including `02222` against `2222`;
  - an edit that keeps its own port;
  - two shares on one guest path;
  - the same guest path on two different VMs, which stays allowed.

**B10: keys with no final newline.**

- `sshKeysArgv` (`Model.js:1636`) changes its format from `"%f\\t"` to
  `"\\n%f\\t"`.
- The newline is printed *before* each name, so it cannot be skipped. The
  rejected version, a `-printf "\n"` after `-exec cat`, was skipped whenever
  `cat` failed. *Review: agy.*
- Extra empty lines are already ignored by `parseSshKeys`, because they hold
  no tab.
- Tests: the format string; the concatenated sample from the intent, in the
  new format, yields both keys.

### Group 2: state and lifecycle

**B2: a failed list keeps its rows and says why.** `MicrovmState` gains
three properties:

- `listOk`: a list has succeeded at least once;
- `vmsStale`;
- `listError`.

`everLoaded` keeps its meaning, "a poll finished". It cannot tell success
from failure. *Review: Codex.*

In `listProcess.onExited` (`MicrovmState.qml:490`):

- **Exit 0:** `listOk = true`, `vmsStale = false`, `listError = ""`, and
  the rows are read as today.
- **Non-zero, with `!listOk` and empty stderr:** `reachable = false`.
  This is what a missing binary looks like, and only that case reads
  "not found".
- **Any other non-zero exit:**
  - `vms` is kept;
  - `vmsStale = true`;
  - `listError = Model.listFailure(listErr.text, code)`. This is
    `errorText(stderr)`, or `"exit <code>"` when stderr is empty.
    *Review: agy.*

Places that change:

- `summaryText(rows, reachable, listError)` returns
  `"VM list failed: <error>"` when there is an error. Both callers pass it:
  `MicrovmView.qml` and `Panel.qml:90`.
- `emptyText` (`Model.js:677`) gains the same case.
- `staleList` (`Model.js:1696`) gains `vms`.
- `statusJson()` adds `listError`.

Tests: `summaryText`, `emptyText`, `listFailure` and `staleList` for not
found, failed with stderr, failed with none, and fine.

**B3 and B4: a removed machine keeps a row until apply.**

- **Which names count as removed.** In `permanentRows` (`Model.js:397`), a
  name counts as removed only when `pending.machines[name] === "removed"`
  and `apps.nix` has no line for it.
  - nixarchy-pkg emits `"removed"` for a line that left (checked in its
    `cmd_pending`).
  - Requiring the marker means a pending poll that arrives before the file
    is re-read cannot fake a removal. *Review: Codex.*
  - The loop over `pending.machines` uses `Object.keys`, so inherited keys
    never count. *Review: agy.*
- **The row:**
  - if a unit exists, its row's ownership becomes `"removed"` instead of
    `"flake"` (B4);
  - if no unit exists, a row is added with `ownership: "removed"` and
    `runtime: "none"` (B3).
- **What follows from that:**
  - The row has `pending: true`, so `counts.pending` counts it and Apply is
    offered.
  - Edit, remove and console are already limited to managed rows
    (`Model.js:1352`). Only the *reason* changes: `hiddenReason` handles
    `"removed"` first, for every verb, with `"removed; a applies it"`.
    Without that it would fall through to "not managed here".
    *Review: agy.*
  - For a removed row, the status column (`statusText`, `Model.js:479`)
    reads `"removed, pending apply"`. `ownershipText` returns `""`, so the
    subtitle does not say it a second time. *Review: agy.*
  - Start, stop and logs still work on a unit that exists, because the
    machine runs until apply.
- **Tests:**
  - a pending-only removal gives one row, and Apply is offered;
  - a removal with a unit gives ownership `removed`;
  - a flake machine with no marker stays `flake`;
  - a pending `"added"` with no line yet adds no row.

**B6: no console on an unapplied change, and the user is told.**

- **The rule.**
  - In `actionsFor` (`Model.js:1353`), the permanent console also needs
    `!row.pending && !s.pendingSync`.
  - `hiddenReason` checks pending *after* port, key and running. The
    existing reasons and the test at `tests/model/commands.test.js:134`
    stay as they are. *Review: agy.*
  - Its text: `"apply the queued change first"`.
- **The window before the pending poll.**
  - `apps.nix` reloads on its own, before the pending poll
    (`MicrovmState.qml:597`), so for up to one tick the new port shows while
    `pending` is still false.
  - `MicrovmState` sets `pendingSync = true` whenever the `apps.nix` text
    changes, and starts a pending poll at once.
  - The next pending result clears it. *Review: Codex.*
- **The footer.**
  - The apply banner (`MicrovmView.qml:725`) is shown before `hintText`, so
    the reason would never be seen. *Review: both.*
  - When the selected row is pending, the line shows
    `hintText + "   a applies"` instead.
  - When it is not pending, the order stays as it is.
- **Decision (intent question 2):** the owner confirmed on 2026-11-16 to
  hide the console. A memory-only edit hides it too.
- **Fixtures that change:**
  - in `tests/model/commands.test.js`, fixture `p1` is `pending: true`;
  - the console assertions at lines 126–128, 144 and 163 either use a new
    non-pending row, or expect the new reason;
  - each assertion that changes is named in the commit. *Review: agy.*

**B8: the terminal start and the lock.**

- **Decision (intent question 1):** the owner confirmed on 2026-11-16 to
  narrow the rule rather than hold the lock. Both reviewers agree that a
  lock cleared by a poll or a timeout cannot guarantee "one change at a
  time":
  - the terminal's `nix build` is not a process this plugin can stop
    (`MicrovmState.qml:353`);
  - with no bar widget, polling stops once the surface closes, so the lock
    would never clear.
- The rule gets one sentence in each of three places:
  - AGENTS.md "One mutation at a time";
  - the README's "One change at a time" bullet;
  - `docs/usage.md`.

  The sentence: on nixarchy without `run --detach` (#762), a start opens a
  terminal that is not tracked, so it does not hold the lock.
- There is no other code change. Roadmap item S5 removes that path.

**B9: each surface owns its agent call.**

- **Ownership.**
  - `MicrovmView` gains `property string surface`. Panel sets it to
    `"bar"`, Menu to `"menu"`.
  - `MicrovmState.askAgent(text, owner)` sets `agentOwner` only after the
    launch succeeds.
  - `cancelAgent(owner)` and `resetAgent(owner)` do nothing unless `owner`
    matches `agentOwner`, or no call is running.
  - Every caller passes an owner: the four `resetAgent` calls (150, 159,
    193, 206), `cancelAgent` (492) and `askAgent` (491). So there is no
    default for callers without an owner. *Review: Codex.*
- **The form shows only its own call.** `CreateForm` binds:

  ```qml
  thinking: MicrovmState.thinking && MicrovmState.agentOwner === root.surface
  agentError: MicrovmState.agentOwner === root.surface ? MicrovmState.agentError : ""
  ```

  `onAgentFormChanged` (`MicrovmView.qml:499`) applies a reply only for the
  owner. Without these, Escape in the other surface's form cancelled the
  call, and its describe field was disabled. *Review: both.*
- **One call at a time.** While another surface's call runs, `i` and
  Enter on describe are refused, with `"the other surface is asking the
  agent"`. That is the one-call-at-a-time rule seen from the second
  surface.
- **Testing.** This is QML wiring, with no Node test. It is checked live.

**B11.** `pkgFile.onLoaded` (`MicrovmState.qml:583`) starts `optProbe` only
if it is not already running, the same guard as `probe()` at line 96.

### Group 3: display and cleanup

**B7: the review scrolls, and its footer stays put.**

- **Layout.**
  - The review's content (the line and the commands) moves into a
    `Flickable`.
  - The review's own footer (Enter writes, Esc back) stays **outside** it,
    pinned at the bottom, so it can never scroll away. *Review: agy.*
  - The column and every `Text` get `width: parent.width`, so
    `WrapAnywhere` wraps.
  - The review keeps its natural height up to the body height
    (`MicrovmView.qml:28-38`, the AGENTS.md sizing rule).
- **Behaviour.**
  - `openReview` sets `contentY = 0`. *Review: both.*
  - `j`/`k` and the arrow keys scroll; Enter still writes.
  - The pinned footer adds `"↓ more"` while content is below the fold.
- **Keys.**
  - The scroll keys go into the existing review entries of
    `Model.SHORTCUTS`. No new group is added.
  - `tests/model/rows.test.js:156` is updated if the entry count changes.
    *Review: agy.*

**B12: the legend stays during a stream.** The footer legend
(`MicrovmView.qml:779`) uses `workingText` only when
`MicrovmState.mutating && !MicrovmState.streaming`. The hint line already
says "… o to watch".

**Cleanup**, each in the commit whose code it touches:

- `Model.pendingName(pendingKey)` replaces the four
  `pendingKey.split(":")[1]` (`MicrovmState.qml:209`, `337`, `635`;
  `MicrovmView.qml:780`).
- A new `Model.ownershipText(row)`:
  - `VmList.qml:214` uses `Model.join([row.template,
    Model.ownershipText(row)], " · ")`, so an empty template leaves no
    stray separator;
  - `subtitleText` calls it too;
  - the kind stays a badge only. *Review: agy.*
- `keysMatching` moves to `Model.keysMatching(keys, query)`.
  - It walks `keys || []` by `.length`, because a QObject list is a
    sequence wrapper (AGENTS.md).
  - It gets a test.
- Unused code is removed:
  - the `optPath` argument of `reviewCommandLines`;
  - `probed`;
  - the unreachable `continue` at `Model.js:1596`.

### Docs

- **README:**
  - the "One change at a time" bullet (B8);
  - the console row gets "not while a change waits for apply" (B6).
- **`docs/usage.md`:**
  - the B2 message;
  - B4's "removed, pending apply";
  - B5's two refusals, and the limit that flake machines are not checked;
  - B6;
  - B8.
- **AGENTS.md:** the B8 sentence.

## Alternatives rejected

- **B8, hold the lock until the VM shows as running, with a timeout.**
  Neither the timeout nor `X` stops the terminal's build. Polling stops when
  every surface closes. It adds new lifecycle code to a path S5 deletes.
- **B1, show the hidden error through `agentError`.** It breaks a binding,
  and it is drawn under a field that an edit hides.
- **B6, read the applied port from the unit or `/var/lib/microvms`.**
  AGENTS.md forbids touching either, and the unit does not expose the port.
- **B10, a `-printf "\n"` after `cat`.** It is skipped when `cat` fails.
- **B10, a `FileView` per key file.** It means more code and more
  processes.
- **B3, treat any pending name with no line as a removal.** A pending poll
  that arrives before the file is re-read would fake one.
- **B9, a default for `resetAgent()` with no owner.** Every caller is in
  this repo and passes one, so a default only hides a missed caller.
- **Three separate PRs.** The owner chose one PR, with commits grouped.

## Risks

- **B5** refuses a port that the user already had duplicated in `apps.nix`.
  Editing that machine shows the error until a new port is chosen. This is
  intended, but it changes behaviour.
- **B3** shows rows for removals made outside this plugin, for example
  `nixarchy-opt-remove` run in a terminal. They really are pending.
- **B6** hides the console for one poll after any `apps.nix` change. That is
  at most about 3 s with a surface open.
- **B9** refuses `i` in one surface while the other has a call running. This
  is new, but it is one-call-at-a-time made visible.
- **B7**'s `Flickable` must not take keys outside review mode.
- **Host:** only the plugin folder changes. There is no `nixarchy-apply`,
  and `apps.nix` changes only for the `p1` test line below.

## Verification

- `node tests/run.js` passes. Every new test fails on `27e5992`. Every
  fixture that was changed is listed in its commit.
- These pass:

  ```bash
  nix flake check
  nix flake check --all-systems --no-build
  nix build
  omarchy plugin validate "$(readlink -f result)"
  ```

- Live, following AGENTS.md "Verifying live", with `t1`/`t2` and one
  permanent `p1` line (never applied):
  - **B1:** write `p1` as `P_1` with `opt set` by hand, then `m`, change the
    memory, Enter: the review is shown. With an invalid hidden field, the
    message is shown.
  - **B3/B4:** `x` on the line. The row reads "removed, pending apply", and
    `a` is offered.
  - **B5:** a second permanent VM on the same port, typed as `0` + the port,
    is refused.
  - **B6:** right after an edit, Enter on `p1` is absent, and the footer
    says why.
  - **B7:** a review with five long shares scrolls, and its footer stays
    visible.
  - **B9:**
    1. `i` in the menu, then open the popup's form and press Escape there.
       The menu's call still completes.
    2. Close the popup. The call is still unaffected.
  - **B12:** `s` on `t1`. The legend stays during the build.
  - **B2:** while the panel is open, `nixarchy-vm list` exits non-zero
    through a `PATH` shim in the test shell only. The rows stay, and "VM
    list failed: …" shows.
  - **The bar is healthy:** the `pluginBarApiFor` count is 0.
- Teardown: run the commands below, then diff `apps.nix` against the
  snapshot taken before:

  ```bash
  nixarchy vm rm t1
  nixarchy vm rm t2
  nixarchy-opt-remove programs.nixarchy.services.microvm.machines.p1
  ```
