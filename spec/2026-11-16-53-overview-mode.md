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

Code starts after #51 and #52 merge, rebased onto `main`.

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
  ["systemctl", "--user" (dropped when system), "show", "--timestamp=unix",
   "-p", "Id,MemoryCurrent,CPUUsageNSec,ActiveEnterTimestamp", "--", ...units]
  ```

  - It returns `null` for an empty list.
  - Unit names are built only from names that pass `isReportedName`:
    `nixarchy-vm-<name>.service` and `microvm@<name>.service`.
- **`parseUnitStats(text)`** returns `{ "<unit id>": { mem, cpuNs, since } }`.
  - It reads the blocks separated by blank lines.
  - `[not set]`, an empty value and anything not a number become `null`.
  - `since` is the number of seconds after `@`.
- **`parseMeminfo(text)`** returns `{ totalKiB, availableKiB }` from
  `/proc/meminfo`, or `null` when unreadable.
- **`cpuPercent(prev, cur)`** takes `prev` and `cur` as
  `{ cpuNs, atMs }` and returns `100 * Δns / (Δms * 1e6)`, so 100 means one
  full core. It returns `null` when:
  - either side is missing;
  - Δms ≤ 0;
  - the count went backwards, which happens after a restart.
- **`pushSample(list, value, cap)`** appends and keeps the last `cap`
  values (`cap` 30). `null` values are kept as gaps.
- **`formatMemory(bytes)`** gives binary units: `"512 MiB"`, `"7.0 GiB"`,
  and `"—"` for `null`.
- **`formatUptime(sinceSec, nowMs)`** gives `"3 min"`, `"2 h"` or `"4 d"`,
  and `"—"` for `null`.
- **`overviewCard(row, stat, history)`** returns a card record:
  - `running`;
  - `memText` (in use, or "—");
  - `configText` (for example `"configured 2.0 GiB · 2 cores"`, or `""` when
    unknown);
  - `uptimeText`;
  - `cpuTrend` (the history, or `[]` when fewer than 2 samples);
  - `cpuText` (the last value, or "—").

  A row that isn't running gets only `configText`, and its state comes from
  the existing `statusText`. A permanent VM's configured size is taken from
  the row's **applied** values only: when `row.pending` is set, `configText`
  is `""`, so a pending edit is never shown as the running size (intent:
  configured is labelled as configured).
- **`overviewSummary(rows, stats, meminfo)`** returns `{ hostUsedText,
  vmShareText, partial, counts }`.
  - `hostUsed` is `total - available`.
  - `vmShare` is the sum of the running VMs' `mem` that could be read.
  - `partial` is true when any running VM had no reading, and
    `vmShareText` then ends in `" (partial)"`.
  - `counts` reuses `Model.counts(rows)`.
- **`cardColumns(width, minCardWidth)`** returns `max(1, floor(width /
  minCardWidth))`.

### 2. When readings are taken (`MicrovmState.qml`)

- **Holders.** `acquire`/`release` (`:45-53`) gain the kind `"stats"`, with
  `property int statsHolders`, and `readonly property bool wantStats:
  active && statsHolders > 0`.
- **The readings.** In `refresh()` (`:192`), after `readPending()`, call
  `readStats()`. It returns at once unless `wantStats`. Otherwise it starts:
  - `statsUserProcess` for the running disposable VMs' units;
  - `statsSystemProcess` for the running permanent VMs' units;
  - a `FileView` reload of `/proc/meminfo`.

  Each runs only if not already running and only if it has units, so
  nothing new runs while every surface is closed, or in list mode.
- **Keeping the result.**
  - `stats` is merged from both results, and `statsAt` is the time.
  - `history`, keyed by unit id, gets one `pushSample(cpuPercent(prev,
    cur))` per reading.
  - When a VM stops, its history is dropped.
- **A failed or refused read** (for example, the system bus refusing
  `microvm@`) keeps the last values for that side, and is never set as
  `lastError` (decision 3). The card then shows configured values and "—".
- **The list never waits:** the readings are separate processes, and the
  rows never wait on them.

### 3. The view (`MicrovmView.qml`, new `VmCards.qml`)

- **The view state.** `MicrovmView` gains `property string view: "list"`.
  - `reset()` sets it from `MicrovmState.settings.overviewByDefault`.
  - `v`, in list mode with the filter not focused, toggles it.
- **Holding the readings.** When the view is `"overview"` and the surface is
  open, the view holds `MicrovmState.acquire("stats")`. It releases on leaving
  the overview, on `dismiss()` and on destruction, as the view holder already
  works.
- **The body.** `VmList` (`:669`) shows when `view === "list"`, and the new
  `VmCards.qml` shows when it is `"overview"`. Both bind the same `rows`,
  `cursorIndex`, `pendingKey`/`pendingVerb` and `features`.
  - The cursor stays one-dimensional: `j` and `k` move one card. Every row
    key (Enter, `s`, `r`, `l`, `m`, `x`, `y`) acts on the card under the
    cursor through the existing `actionFor` path, so confirmations and the
    lock are unchanged.
- **`VmCards.qml`** is a `GridView`.
  - Its columns come from `cardColumns(width, Style.space(260))`.
  - Its width and height come from the body its host gives it. It does not
    size itself (the AGENTS.md sizing rule).
  - Each card has a fixed height, holding:
    - the name and the kind badge;
    - the template;
    - the uptime;
    - memory in use and the configured size;
    - a CPU strip, drawn as a small `Canvas` sparkline of `cpuTrend` with
      "—" until 2 samples. Its height is fixed (decision 2).
  - A card that isn't running shows its state and configured size in the
    same height.
  - Colours: `Commons.Color.*` for text and accent, and the existing row
    highlight for the cursor card.
- **The header.** In the overview, the header's meta line shows
  `overviewSummary`: `"host 120 GiB used · VMs 7.0 GiB (partial) · 1 running
  · 1 pending"`. In list mode, the existing `summaryText` is unchanged.
- **The empty state** is the existing `emptyText`, in both views.

### 4. The setting (`manifest.json`, `Panel.qml`, `Menu.qml`)

- **`manifest.json`.** `barWidget.defaults` gains `"overviewByDefault":
  false`, and `schema` gains a boolean "Open on the overview" with that
  default. The schema already has only integer and boolean types.
  `barWidget.description`, which lists every key, adds "v switches to the
  overview".
- **The surfaces.**
  - `Panel.qml` gains `readonly property bool overviewByDefault:
    setting("overviewByDefault", false) === true`, a key in
    `pushSettings()`, and an `on…Changed` handler. Without that,
    `pushSettings()` replaces the setting (agy).
  - `Menu.qml` reads all settings through `Model.settingsFor`, so it needs
    no change.

### 5. Keys and words

- **`Model.SHORTCUTS`** gains `{ group: "Panel", keys: "v", text: "Switch
  between the list and the overview" }`. `tests/model/keys.test.js` then
  sees the binding, and the drift test passes.
- **README:** the key table and the settings table.
- **`docs/usage.md`:** a short "The overview" section:
  - what a card shows;
  - what "—", "configured" and "(partial)" mean;
  - that 100% CPU is one core;
  - that readings are taken only while it is shown.
- **`flake.nix`:** `VmCards.qml` joins the `files` list (`checked:
  files-list`).

## Alternatives rejected

- **Cards for running VMs only.** Stopped, failed and pending VMs would be
  unreachable in the overview (both reviewers).
- **Reading stats on every poll, in either view.** It costs list-only users
  processes for nothing. The intent says they pay nothing.
- **Host CPU in the header.** It is out of scope (intent).
- **A two-dimensional cursor (h/l across columns).** It is more code and
  more keys. `j` and `k` over the same rows keep "the same keys".
- **A `select`-type setting for the view.** The manifest schema in use has
  only integer and boolean types, so a boolean is used.

## Risks

- **`GridView` keyboard focus.** The cursor and keys must stay with
  `MicrovmView`, as they do for `VmList`. `VmCards` takes no focus.
- **The `Canvas` sparkline** must repaint when `cpuTrend` changes, and only
  then.
- **The system bus.** `systemctl show microvm@…` may be refused on a
  locked-down host. It is handled by decision 3, and no error appears.
- **CPU after a VM restart:** `CPUUsageNSec` resets, and `cpuPercent` returns
  `null` for that sample. There is a test for it.
- **Merge order:** after #51 and #52.

## Verification

- `node tests/run.js` passes with new tests for:
  - `statsArgv`, and `parseUnitStats` (with the `live1` block above, and a
    `[not set]` block);
  - `parseMeminfo`, and `cpuPercent` (normal, backwards, missing);
  - `pushSample`, `formatMemory`, `formatUptime`;
  - `overviewCard` (running with stats, running without, stopped, a pending
    edit), and `overviewSummary` (partial and full);
  - `cardColumns`;
  - the keys drift test with `v`.
- These pass:

  ```bash
  nix flake check
  nix flake check --all-systems --no-build
  nix build
  ```

  So does `omarchy plugin validate` on a fresh clone.
- **Live**, by AGENTS.md "Verifying live", with the owner's desktop free:
  1. `v` in the menu shows cards for `live1` and a stopped `t1`. `live1`
     shows uptime, memory in use and a CPU "—" that becomes a trend after
     two polls.
  2. The header shows host memory and the VMs' share.
  3. `v` again shows the list.
  4. In list mode and with the menu closed, `status` shows no stats process
     running: `polls` rises only with the menu open, and no `systemctl show`
     process appears.
  5. `j`/`k` and `s` on the `t1` card work.
  6. The bar is healthy, and there are no plugin warnings.
