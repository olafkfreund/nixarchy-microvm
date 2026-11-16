---
status: draft
issue: 53
spec: spec/2026-11-16-53-overview-mode.md
coders:
  1: codex   # all the pure readings, maths and formatting: many edge cases, all tested
  2: coder   # MicrovmState wiring: the stats holder, two processes, meminfo, status
  3: coder   # VmList card mode: GridView over the shared model, card delegate, sparkline
  4: coder   # MicrovmView: view state, v, wantsStats, header, sizing, empty state
  5: coder   # the setting: manifest and Panel, plus the v test
  6: agy     # README, usage and manifest words: large and mechanical
reviewers:
  - codex    # an independent read of the diff against this plan
  - agy      # a second independent read
---

# Plan: an overview of what the VMs cost

Branch `feat/53-overview-mode`. `main` is merged in (#47, #51, #52). Line
numbers below are on that merged tree. Each step is one commit, with a
subject citing the step, for example `feat: overview readings (#53, step 1)`.

## Approved decisions, carried over from the spec

**Behaviour**
- **Opt-in.** The setting `overviewByDefault` defaults to false.
- **`v` switches the view.** It works in list mode, when the filter is not
  focused.
- **Every row the list shows gets a card.** The same model, cursor, mouse and
  keys apply.
- **A running VM's card** shows uptime, memory in use, its configured size,
  and a CPU trend.
- **The header** in the overview is `overviewSummaryText`, with errors first.

**What the readings show**
- **Unknown is "—", never 0.** A total that misses some VMs ends in
  "(partial)". A total with nothing readable is "—".
- **A failed read clears its side.** There are no frozen values and no
  `lastError`.
- **CPU: 100% is one core.** A trend needs at least two real samples, until
  then it shows "—". Its slot keeps a fixed height.
- **Memory is in binary units.**
- **Configured size:**
  - a running VM with a pending edit shows no configured size;
  - a non-running pending VM shows "configured … (pending)".

**When readings are taken**
- **Only while open, in list mode, in the overview.** One tracked
  `wantsStats` boolean decides it, and drives `acquire("stats")` and
  `release("stats")`.
- **The first reading comes at once** (`onWantStatsChanged`).
- **No new polling while closed.** `/proc/meminfo` is read only while
  wanted.
- **The data:**
  - per-unit `{cpuNs, atMs}`;
  - only units whose `ActiveState=active`;
  - `@0` is unknown.

**Layout and packaging**
- **The grid lives inside `VmList.qml`.** There is no new file, and
  `flake.nix` is unchanged.
- **Sizing.** The natural height comes from the cards, and the host assigns
  the body's height. There is no render transform.
- **The empty state** checks `root.rows.length`.

## Repo traps

- Logic goes in `Model.js`, with a Node test. QML only draws and wires.
- Every colour is read as `Commons.Color` (#45, Qt 6.12).
- Argv only. Unit names come only from names that pass `isReportedName`.
- QObject lists are sequence wrappers: walk them by `.length`.
- Keep-loaded surfaces: `open()`/`reset()` runs again while open. The stats
  holder must not double-count.
- `implicitHeight` reads counts and sizes, never `height`, so there is no
  binding loop.
- No new root files.
- After each step, run `node tests/run.js`. After steps 2–6, run `nix build`
  as well. After steps 5 and 6, run `nix flake check` too.

## Steps

1. **`Model.js`: readings, maths and text.** Add these after `isStopped`
   (`:1551`), unless placed elsewhere below.
   - **`statsArgv(units, system)`** (spec §1).
   - **`parseUnitStats(text, atMs)`:**
     - blocks separated by blank lines;
     - only `ActiveState=active`;
     - `[not set]`, an empty value, `@0` and anything not a number become
       `null`.
   - **`parseMeminfo(text)`**, and **`cpuPercent(prev, cur)`**, returning
     `null` when a side is missing, when Δms ≤ 0, or when the count went
     backwards.
   - **`pushSample(list, value, cap = 30)`**, and **`cpuTrend(history)`**,
     which needs at least two non-null samples.
   - **`formatMemory(bytes)`** in binary units, and
     **`formatUptime(sinceSec, nowMs)`**.
   - **`overviewCard(row, stat, history)`**, with the `configText` rules
     above.
   - **`overviewSummaryText(rows, stats, meminfo, state)`**, which follows
     `summaryText`'s error order (`:679`).
   - **`cardColumns(width, minCardWidth)`** and
     **`cardsNaturalHeight(count, columns, cardHeight, spacing)`**, beside
     `cardWidth` (`:536`).
   - **Tests,** in a new `tests/model/overview.test.js`. The test directory
     is not part of the package. Each case named in the spec's
     Verification gets a test, including:
     - the real `live1` block;
     - a `[not set]` block;
     - an inactive unit;
     - two `atMs` values;
     - `[null, x]`, which stays "—";
     - the four `overviewCard` cases;
     - the four `overviewSummaryText` cases.
   - → `node tests/run.js`

2. **`MicrovmState.qml`: when readings are taken.**
   - **The holder.** `acquire` and `release` (`:45-53`) gain a `"stats"`
     kind with an explicit `else if`. Add `property int statsHolders`,
     `readonly property bool wantStats: active && statsHolders > 0`, and
     `onWantStatsChanged: if (wantStats) readStats()`.
   - **The readings.** Add `readStats()`, called from `refresh()` (`:192`)
     after `readPending()`:
     - it returns unless `wantStats`;
     - it starts `statsUserProcess` for the running disposable VMs' units,
       as `nixarchy-vm-<name>.service`;
     - it starts `statsSystemProcess` for the running permanent VMs' units,
       as `microvm@<name>.service`;
     - each starts only if it is not already running and has units;
     - it increments `statsReads`.
   - **`/proc/meminfo`.** Add a `FileView { path: root.wantStats ?
     "/proc/meminfo" : "" }`, reloaded in `readStats()`, which sets `meminfo
     = Model.parseMeminfo(text())`.
   - **Each process's exit:**
     - **exit 0:** replace its side of `stats` with
       `Model.parseUnitStats(text, Date.now())`, and push one
       `cpuPercent(prev, cur)` per unit into `history`;
     - **non-zero exit:** clear its side of `stats` and its baselines, with
       no `lastError`.
   - **Pruning.** On every list or units result, drop the `stats`,
     `history` and baseline entries for any unit that isn't running.
   - **`statusJson()`** (`:583`) adds `statsHolders` and `statsReads`.
   - → `node tests/run.js && nix build`
   - Trap: never start a stats process when `!wantStats`. That is what
     keeps closed and list-only use free.

3. **`VmList.qml`: card mode.**
   - **New properties:**
     - `property bool cards: false`;
     - `property bool large: false`;
     - `property var stats: ({})`;
     - `property var history: ({})`.
   - **The grid.** A `GridView` (`id: gridView`) sits beside the `ListView`
     (`:68`). It is visible when `cards`, while the `ListView` is visible
     when `!cards`. Both share `model: rowModel` (`:40`), `currentIndex`,
     and the cursor-follow handlers (`:84-89`).
   - **Columns.** `cellWidth = width / Model.cardColumns(width,
     Style.space(large ? 360 : 260))`, and `cellHeight` is the fixed card
     height plus spacing.
   - **The card delegate** reuses `VmRow`'s properties and action buttons
     (`:91-126`), so `hasCursor` (`:112`), clicks, hover and the row actions
     behave the same. It lays out a fixed-height card from
     `Model.overviewCard(row, stats[unit], history[unit])`:
     - the name, the kind badge, and the template with its ownership;
     - the status line, including the pending verb;
     - for a running VM: uptime, memory in use, `configText`, and a CPU strip
       of fixed height. The strip is a `Canvas` sparkline of `cpuTrend`
       drawn in `Commons.Color.accent`, repainted on the trend's change, or
       "—";
     - for a non-running VM: its status and `configText`.
   - **The natural height.** `implicitHeight` (`:38`) is
     `cards ? Model.cardsNaturalHeight(rowModel.count, columns,
     cardHeight, spacing) : listView.contentHeight`.
   - → `node tests/run.js && nix build`
   - Traps: `Commons.Color` only, and no logic beyond picking text out of
     `overviewCard`. The `#21` cursor-identity behaviour must still hold.

4. **`MicrovmView.qml`: the view state, `v`, holding readings, header,
   sizing.**
   - **The view.** Add `property string view: "list"`. `reset()` (`:118`)
     sets it to `MicrovmState.settings.overviewByDefault === true ?
     "overview" : "list"`.
   - **`v`.** In `handleTextKey` (`:339`), in list mode with the filter not
     focused, `v` toggles `view`.
   - **Holding the readings.**
     - Add `readonly property bool wantsStats: opened && mode === "list" &&
       view === "overview"`, with a private `holdsStats` flag.
     - `onWantsStatsChanged` calls `MicrovmState.acquire("stats")` when it
       turns true and `!holdsStats`, and `release("stats")` when it turns
       false and `holdsStats`. It sets the flag either way.
     - `Component.onDestruction` releases the hold if it is held.
   - **`VmList`** (`:669`) gains `cards: root.view === "overview"`,
     `large: root.large`, `stats: MicrovmState.stats` and `history:
     MicrovmState.history`.
   - **The empty state** (`:690`) checks `root.rows.length === 0` instead of
     `list.count`.
   - **The header** (`:423`): in the overview, the meta line is
     `Model.overviewSummaryText(MicrovmState.allRows, MicrovmState.stats,
     MicrovmState.meminfo, {reachable, listError, upstreamError})`. In the
     list, it is the existing `summaryText`.
   - **Sizing.** `bodyNatural` (`:31`) already reads `list.implicitHeight`
     in list mode, which step 3 makes card-aware. Confirm that, and change
     nothing else.
   - → `node tests/run.js && nix build`
   - Trap: the hold must be balanced across `reset()` while open, the form,
     the log, `dismiss()` and destruction. The live check covers it through
     `statsHolders`.

5. **The setting, and the `v` test.**
   - **`manifest.json`:**
     - `barWidget.defaults` gains `"overviewByDefault": false`;
     - `schema` gains a boolean entry, label "Open on the overview",
       description "Show VMs as cards with live memory, CPU and uptime when
       the panel opens. v switches either way.";
     - `barWidget.description` gains ", v switches to the overview".
   - **`Panel.qml`:** add `readonly property bool overviewByDefault:
     setting("overviewByDefault", false) === true` (by `:22`), add it to
     `pushSettings()` (`:27`), and add an `onOverviewByDefaultChanged`
     handler (`:36-39`).
   - **`Model.SHORTCUTS`** (`:34`) gains `{ group: "Panel", keys: "v", text:
     "Switch between the list and the overview" }`.
   - **`tests/model/keys.test.js`** gains an assertion that `MicrovmView.qml`
     contains `key === "v"` and that `SHORTCUTS` has `"v"`. The scanner at
     `:58-60` does not see `handleTextKey` keys.
   - **Menu.** Confirm `Menu.qml:143` binds `opened: root.opened`, which it
     does after #52, and that the settings reach it through
     `Model.settingsFor`.
   - → `node tests/run.js && nix build && nix flake check`

6. **Words.**
   - **README:** the key table (`v`), and the settings table
     (`overviewByDefault`).
   - **`docs/usage.md`:** a section "The overview", covering:
     - what a card shows;
     - "—", "configured", "(pending)" and "(partial)";
     - that 100% CPU is one core;
     - that readings are taken only while the overview is shown.
   - → `node tests/run.js && nix flake check`

## Final verification (mine, not delegated)

- **Checks:** `node tests/run.js`, `nix flake check` (also with
  `--all-systems --no-build`), `nix build`, and a fresh-clone `omarchy plugin
  validate`.
- **New tests fail on the base:** run them against `Model.js` from
  `origin/main`.
- **Live:** the spec's Verification 1–7, with a running `live1` (the owner's
  VM is only read) and a stopped `t1`. Restore the Home Manager link
  afterwards, and check the bar.
- **Reviews:** Opus, then Codex and agy (`reviewers:`).
- **The PR:** it links the three artifacts, closes #53, and names the coder
  for each step.

## Tests

- `node tests/run.js` passes, including `overview.test.js` and the `v`
  assertion.
- The flake checks are green.
- The live checks pass.

## Rollback

- Each step is one commit.
- Steps 2–4 depend on step 1, and step 4 depends on 2 and 3. Revert them
  together.
- The setting defaults to off. A partial rollback that keeps step 5 leaves
  `v` with nothing to switch to, so revert step 5 with step 4.
