---
status: draft
issue: 53
intent: intent/2026-11-16-53-overview-mode.md
---

# Spec: an overview of what the VMs cost

## Design

**Where the line numbers come from:**
- `origin/feat/49-simplify-create-delete`, unless marked otherwise;
- `Menu.qml` references come from `origin/feat/50-card-menu`.

Code starts after #51 and #52 merge, rebased onto `main`. After that merge,
`Menu.qml` binds the view's `opened`, which #49 step 8 added. The plan checks
it.

**Revised after Codex and agy reviewed the first draft.** Every point below
marked "(review)" comes from them.

**Facts checked on this host:**
- `systemctl show` takes many units in one call. It prints one block per
  unit, separated by a blank line. An unknown unit gives `[not set]` or an
  empty value, and still exits 0.
- `--timestamp=unix` prints the start time as `@<seconds>`.
- **An example block** (the disposable VM `live1`):

  ```text
  Id=nixarchy-vm-live1.service
  ActiveEnterTimestamp=@1794833520
  MemoryCurrent=7528833024
  CPUUsageNSec=6504197705000
  ```

### 1. Readings (`Model.js`, pure, with Node tests)

- **`statsArgv(units, system)`** returns:

  ```text
  ["systemctl", ("--user" unless system), "show", "--timestamp=unix", "-p",
   "Id,ActiveState,MemoryCurrent,CPUUsageNSec,ActiveEnterTimestamp", "--", ...units]
  ```

  - It returns `null` for an empty list.
  - Units are built only from names that pass `isReportedName`.
- **`parseUnitStats(text, atMs)`** returns `{ "<unit id>": { mem, cpuNs,
  since, atMs } }`.
  - It reads the blocks separated by blank lines.
  - It keeps a unit only when `ActiveState=active`. A unit that stops
    between the list and this read never contributes numbers from after it
    exited (review).
  - `[not set]`, an empty value, `@0` and anything not a number become
    `null`.
  - `atMs` is the time that process's result arrived, kept per unit. The
    user and system reads end at different times, so a shared timestamp
    would corrupt CPU percentages (review).
- **`parseMeminfo(text)`** returns `{ totalKiB, availableKiB }`, or `null`.
- **`cpuPercent(prev, cur)`** works on `{ cpuNs, atMs }` and returns `100 *
  Δns / (Δms * 1e6)`, so 100 means one core. It returns `null` when:
  - either side is missing;
  - Δms ≤ 0;
  - the count went backwards, as after a restart.
- **`pushSample(list, value, cap = 30)`** appends; a `null` is kept as a gap.
- **`cpuTrend(history)`** returns the history only when it holds at least
  **two non-null** samples, otherwise `[]`. `cpuText` follows: the last
  non-null value, or "—" (review).
- **`formatMemory(bytes)`** gives binary units ("512 MiB", "7.0 GiB"), and
  "—" for `null`.
- **`formatUptime(sinceSec, nowMs)`** gives "3 min", "2 h" or "4 d", and "—"
  for `null`.
- **`overviewCard(row, stat, history)`** returns:
  - `running`;
  - `memText`;
  - `configText`;
  - `uptimeText`;
  - `cpuTrend`;
  - `cpuText`.
- **What `configText` says** (review):
  - Normally: "configured 2.0 GiB · 2 cores", from the row's values.
  - A **running** VM with a pending edit shows `""`, because the line's new
    size is not what is running.
  - A **non-running** pending VM (a new, unbuilt one) shows "configured
    2.0 GiB · 2 cores (pending)".
  - It is `""` when unknown, as for a flake-declared VM.
- **`overviewSummaryText(rows, stats, meminfo, state)`** returns the
  formatted header line (review: the logic lives in `Model.js`).
  - **Errors first, in `summaryText`'s order:** not reachable, then
    `upstreamError`, then `listError`.
  - **Otherwise**, for example: "host 120 GiB used · VMs 7.0 GiB (partial) ·
    1 running · 1 pending · 1 failed".
  - **The VMs' share** is "—" when no running VM was readable, never "0 MiB"
    (review). It ends with "(partial)" when only some were readable.
  - **The counts** use `Model.counts(rows)`, failed included.
- **`cardColumns(width, minCardWidth)`** returns `max(1, floor(width /
  minCardWidth))`.
- **`cardsNaturalHeight(count, columns, cardHeight, spacing)`** is the
  overview's natural height.

### 2. When readings are taken (`MicrovmState.qml`)

- **Holders.** `acquire`/`release` (`:45-53`) gain a `"stats"` kind, with an
  explicit `else if`, so it never falls into the `views` branch (review).
  - Add `statsHolders`, and `readonly property bool wantStats: active &&
    statsHolders > 0`.
  - Add `onWantStatsChanged: if (wantStats) readStats()`, so the first
    reading comes straight away, not 3 s later (review).
- **`readStats()`**, called from `refresh()` (`:192`) and from that handler:
  - It returns unless `wantStats`.
  - It starts `statsUserProcess` for the running disposable VMs' units, and
    `statsSystemProcess` for the running permanent VMs'. Each starts only if
    it is not running and has units.
  - The `/proc/meminfo` `FileView` binds `path: wantStats ? "/proc/meminfo" :
    ""`, so list-only use never reads it (review), and is reloaded here.
- **Each process's exit:**
  - **Success:** it replaces its side of `stats` with
    `parseUnitStats(text, Date.now())`, and pushes one `cpuPercent(prev,
    cur)` per unit into `history`.
  - **Failure or refusal:** it clears its side of `stats` and its
    baselines. The cards then show "—", and the header says partial
    (review: no frozen values), with no `lastError` (decision 3).
  - **Pruning:** `stats` and `history` drop any unit not in the running set
    (review).
- **`statusJson()`** adds `statsHolders` and `statsReads`, a count of stats
  reads started. A check can then see that no stats are read while closed,
  even when the bar's glyph poll raises `polls` (review).

### 3. The view (`MicrovmView.qml`, `VmList.qml`; no new file)

- **The view state.** `MicrovmView` gains `property string view: "list"`.
  - `reset()` sets it from `MicrovmState.settings.overviewByDefault`.
  - `v`, handled in `handleTextKey` in list mode with the filter not
    focused, toggles it.
- **Holding the readings.** One tracked boolean decides when the view holds
  the readings (review):
  - `readonly property bool wantsStats: opened && mode === "list" && view
    === "overview"`;
  - `onWantsStatsChanged` calls `acquire("stats")` or `release("stats")`,
    guarded by a private `holdsStats` flag so it never double-counts;
  - `Component.onDestruction` releases it if held.

  The reset, `v`, the form, the log, `dismiss()` and the open order of
  either host then cannot leak or double-release it.
- **The grid lives inside `VmList.qml`** (review, agy's smaller design):
  - `VmList` gains `property bool cards`.
  - When `cards` is set, a `GridView` replaces the `ListView`, using the
    **same** reconciled `ListModel` (`VmList.qml:40-67`) and the same
    cursor, hover, click and action-button wiring
    (`VmList.qml:84-126`, `:237-262`).
  - So cursor identity, `cursorActive`, `cursorFromKeyboard`, mouse
    behaviour and every row key work as in the list, and `flake.nix`'s
    `files` list is unchanged.
- **What a card draws**, at a fixed height:
  - the name, the kind badge, and the template with its `ownershipText`;
  - the status line, including pending text and `pendingVerb`;
  - for a running VM: uptime, memory in use, `configText`, and a CPU strip.
    The strip is a token-coloured `Canvas` sparkline of `cpuTrend`, or "—",
    in a slot of fixed height (decision 2). It repaints only when the trend
    changes;
  - for a non-running VM: its state and `configText`, in the same height.
- **Columns.** `cardColumns(width, Style.space(large ? 360 : 260))`, so the
  menu's larger text gets wider cards (review).
- **Sizing (review).**
  - `MicrovmView`'s `bodyNatural` (`:31-35`) uses
    `list.implicitHeight`, which `VmList` computes from
    `cardsNaturalHeight(...)` in card mode, or from rows as today.
  - The assigned body height still comes only from the host. There is no
    render transform and no binding loop: `implicitHeight` reads counts and
    sizes, never `height`.
- **Visibility.** `VmList` keeps its `root.mode === "list"` guard (`:671`).
  `emptyState` checks `root.rows.length === 0` instead of `list.count`
  (`:690`, review).
- **The header.** In the overview, the meta line is `overviewSummaryText(...)`.
  In the list, `summaryText` is unchanged.

### 4. The setting

- **`manifest.json`.**
  - `barWidget.defaults` gains `"overviewByDefault": false`.
  - `schema` gains a boolean "Open on the overview".
  - `barWidget.description` gains "v switches to the overview".
- **`Panel.qml`** gains `overviewByDefault` in its settings properties, in
  `pushSettings()` and in a change handler. Without that, `pushSettings()`
  replaces the setting.
- **`Menu.qml`** reads all settings through `Model.settingsFor`, so the
  setting needs nothing there. It needs `opened: root.opened` on its view,
  from #49. The plan confirms that after the rebase (review).

### 5. Keys and words

- **`Model.SHORTCUTS`** gains `{ group: "Panel", keys: "v", text: "Switch
  between the list and the overview" }`.
- **A new test.** `tests/model/keys.test.js`'s scanner sees only `Qt.Key_*`,
  not printable keys that go through `handleTextKey` (`:58-60`). So a small
  new assertion checks `MicrovmView.qml` for `key === "v"` and checks
  `SHORTCUTS` for its entry (review).
- **README:** the key table and the settings table.
- **`docs/usage.md`:** "The overview":
  - what a card shows;
  - what "—", "configured", "(pending)" and "(partial)" mean;
  - that 100% CPU is one core;
  - that readings are taken only while it is shown.

## Alternatives rejected

- **Cards for running VMs only.** Stopped, failed and pending VMs would be
  unreachable.
- **A separate `VmCards.qml`.** It would duplicate the model sync, the
  cursor, the mouse and the action wiring (agy).
- **Keeping the last values after a failed read.** It would show frozen
  numbers as current.
- **Reading stats in both views, or while a form or log covers the
  overview.** It costs readings nobody sees.
- **Host CPU in the header** is out of scope. **A two-dimensional cursor**
  means more keys. **A `select`-type setting** is not supported by the
  schema in use.

## Risks

- **`GridView` and `ListView` swapping in one item** must keep the
  reconciled model and the cursor-identity behaviour (#21) intact. That is
  checked live, with a VM starting and stopping under the cursor.
- **The `Canvas` repaint cost** is limited to trend changes, at most one per
  poll per running VM.
- **System-bus refusal** is handled silently (decision 3). **CPU after a
  restart** gives `null` for one sample, and a test covers it.
- **Merge order:** after #51 and #52. The `Menu.qml` `opened` binding is
  checked after the rebase.

## Verification

- `node tests/run.js` passes with new tests for:
  - `statsArgv`, and `parseUnitStats`: the `live1` block, a `[not set]`
    block, an inactive unit, `@0`, and two `atMs` values;
  - `parseMeminfo`, and `cpuPercent` (normal, backwards, missing);
  - `pushSample`, and `cpuTrend` (`[null, x]` is still "—");
  - `formatMemory`, `formatUptime`;
  - `overviewCard`:
    - running with stats, and running without;
    - stopped;
    - running with a pending edit (`configText` `""`);
    - new and pending ("(pending)");
  - `overviewSummaryText`: errors first; none readable is "—"; partial;
    failed counted;
  - `cardColumns`, `cardsNaturalHeight`;
  - the `v` handler and its sheet entry.
- These pass:

  ```bash
  nix flake check
  nix flake check --all-systems --no-build
  nix build
  ```

  So does `omarchy plugin validate` on a fresh clone.
- **Live**, by AGENTS.md "Verifying live", with the owner's desktop free:
  1. `v` in the menu shows cards for `live1` and a stopped `t1`:
     - the first reading arrives at once;
     - `live1` shows uptime and memory;
     - its CPU shows "—", then a trend after the second poll;
     - `t1` shows "stopped" and its configured size.
  2. The header shows host memory and the VMs' share.
  3. `c` opens the form, and `statsHolders` drops to 0. Esc back: it is 1
     again.
  4. `v` again shows the list. With the menu closed, `statsReads` does not
     rise, even with the bar's glyph poll running.
  5. `j`/`k`, a click, and `s` on the `t1` card work. A VM that starts under
     the cursor keeps the cursor on it.
  6. The overview fits the popup width and the menu.
  7. The bar is healthy, and there are no plugin warnings.
