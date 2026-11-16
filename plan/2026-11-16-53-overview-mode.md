---
status: approved
issue: 53
spec: spec/2026-11-16-53-overview-mode.md
coders:
  1: codex   # every pure reading, maths, text and commit rule, all tested
  2: coder   # MicrovmState wiring: holder, two processes, meminfo, commit, status
  3: coder   # VmList card mode: GridView over the shared model, card delegate, sparkline
  4: coder   # MicrovmView: view state, v, wantsStats, header, empty state
  5: coder   # the setting (manifest, Panel), the v shortcut and its test
  6: agy     # README and docs/usage.md words: large and mechanical
reviewers:
  - codex    # an independent read of the diff against this plan
  - agy      # a second independent read
---

# Plan: an overview of what the VMs cost

**Branch:** `feat/53-overview-mode`. `main` is merged in (#47, #51, #52).
Line numbers below are on that merged tree.

**Commits:** each step is one commit, with a subject citing the step, for
example `feat: overview readings (#53, step 1)`.

**Revised after Codex and agy reviewed the first draft.** It is
self-contained: every contract that step 1 implements is copied here.

## Approved decisions, carried over from the spec

**Behaviour**
- **The setting:** `overviewByDefault`, off by default.
- **`v` switches the view.** It works in list mode, with the filter not
  focused.
- **Every row the list shows gets a card,** through the same model, cursor,
  mouse and keys.
- **The header** in the overview is `overviewSummaryText`, with errors first.

**What the readings show**
- **Unknown is "—", never 0.** A total that misses some VMs ends in
  "(partial)". A total with nothing readable is "—".
- **A failed read clears its side** of the stats, the history and the
  baselines. Nothing frozen stays on screen, and nothing is set as
  `lastError`.
- **CPU: 100% is one core.** A trend needs two real samples, and until then
  shows "—", in a slot of fixed height.
- **Memory is in binary units.**
- **Configured size:**
  - a running VM with a pending edit shows no configured size;
  - a non-running pending VM shows "configured … (pending)".

**When readings are taken**
- **Only while open, in list mode, in the overview.** One tracked
  `wantsStats` boolean decides it. Everything clears when it turns off.
- **No new polling while closed.** `/proc/meminfo` is read only while
  wanted.
- **The data:** only units whose `ActiveState=active`; `@0` is unknown; one
  `{cpuNs, atMs}` per unit.

**Layout and packaging**
- **The grid lives inside `VmList.qml`.** There is no new file.
- **Sizing.** The natural height comes from the cards, and the host assigns
  the body's height.

## Repo traps

- Logic goes in `Model.js`, with a Node test. QML only wires, and never
  builds a unit name or chooses a text.
- Every colour is read as `Commons.Color` (#45, Qt 6.12).
- Argv only. Unit names come only from `Model.unitFor`.
- QObject lists are sequence wrappers: walk them by `.length`.
- A `property var` holding a map is *reassigned*, never mutated in place, or
  bindings do not update.
- Keep-loaded surfaces: `open()` runs again while open.
- `implicitHeight` never reads `height`.
- No new root files.
- After each step, run `node tests/run.js`. After steps 2–6, run `nix build`
  as well. After steps 5 and 6, run `nix flake check` too.

## Steps

1. **`Model.js`: the contracts.** Add each of these after `isStopped`
   (`:1551`), unless placed elsewhere below. Tests go in a new
   `tests/model/overview.test.js`.
   - **`unitFor(row)`.**
     - `"nixarchy-vm-" + name + ".service"` for `kind === "disposable"`;
     - `"microvm@" + name + ".service"` for `"permanent"`;
     - `""` when `!isReportedName(row.name)`.
   - **`statsArgv(units, system)`.** `units` must each match
     `/^(nixarchy-vm-|microvm@)[A-Za-z0-9_-]+\.service$/`. It returns `null`
     if any does not, or if the list is empty. Otherwise:

     ```text
     ["systemctl", ...(system ? [] : ["--user"]), "show", "--timestamp=unix",
      "-p", "Id,ActiveState,MemoryCurrent,CPUUsageNSec,ActiveEnterTimestamp", "--", ...units]
     ```

   - **`parseUnitStats(text, atMs)`** returns `{ [id]: { mem, cpuNs, since,
     atMs } }`.
     - It reads the blocks separated by blank lines.
     - It keeps a block only when `ActiveState=active`.
     - `mem` and `cpuNs` are integers, or `null` for `[not set]`, an empty
       value or anything not a number.
     - `since` is the number after `@`, or `null` for `@0`, an empty value
       or a bad value.
   - **`parseMeminfo(text)`** returns `{ totalKiB, availableKiB }`, or
     `null` when either is missing.
   - **`cpuPercent(prev, cur)`** returns `100 * (cur.cpuNs - prev.cpuNs) /
     ((cur.atMs - prev.atMs) * 1e6)`. It returns `null` when either side or
     `cpuNs` is missing, when Δms ≤ 0, or when Δns < 0.
   - **`pushSample(list, value, cap)`** keeps the last 30 samples by
     default, and keeps `null` as a gap.
   - **`commitStats(state, side, parsed, running, atMs)`** is the one rule
     for adding a result (review). It is pure.
     - `state` is `{ stats, history, base }`. `side` is `"user"` or
       `"system"`. `parsed` is the result of `parseUnitStats`, or `null` for
       a failed read. `running` is the list of unit IDs running *now*.
     - It returns a **new** `{ stats, history, base }`:
       - It **drops every entry not in `running`**, so a late result cannot
         bring back a VM that has stopped.
       - For a **failed** side, it removes that side's units from all
         three.
       - For a **successful** side, it sets each unit's stat, pushes
         `cpuPercent(base[id], {cpuNs, atMs})` onto its history, and sets
         `base[id]`.
     - A unit's side is decided by its prefix: `microvm@` is system,
       everything else is user.
   - **`cpuTrend(history)`** returns `history` when it has at least two
     non-null samples, otherwise `[]`. **`cpuText(history)`** gives the last
     non-null sample rounded, as "12%", or "—".
   - **`formatMemory(bytes)`:**
     - `null` gives "—";
     - under 1 GiB gives "<n> MiB", rounded;
     - from 1 GiB gives "<n.n> GiB".
   - **`formatUptime(sinceSec, nowMs)`:**
     - `null` gives "—";
     - under an hour gives "<m> min";
     - under a day gives "<h> h";
     - otherwise "<d> d".
   - **`overviewCard(row, stats, history, nowMs)`** looks up `unitFor(row)`
     itself. It returns `{ running, memText, configText, uptimeText,
     cpuTrend, cpuText }`.
     - **Without a stat,** `memText`, `uptimeText` and `cpuText` are "—", and
       `cpuTrend` is `[]`.
     - **`configText`:**
       - `""` when the row has no `memory`;
       - otherwise `"configured " + formatMemory(memory * 1048576) +
         (cores ? " · " + cores + " cores" : "")`, since `row.memory` is in
         MiB;
       - `""` for a running row with `pending`;
       - `+ " (pending)"` for a non-running row with `pending`.
   - **`overviewSummaryText(rows, stats, meminfo, state)`.** `state` is
     `{ reachable, listError, upstreamError }`.
     - **Errors come first**, as in `summaryText` (`:679`): not reachable,
       then `upstreamError`, then `listError`.
     - **Otherwise** the line is `"host " + used + " used · VMs " + share +
       " · " + n + " running"`:
       - `used` is `formatMemory((total - available) * 1024)`, or "—" when
         `meminfo` is null;
       - `share` is the sum of the readable running VMs' `mem`: "—" when
         none is readable, and with " (partial)" when some are not;
       - " · N pending" and " · N failed" are added only when N > 0, from
         `Model.counts(rows)`.
   - **`cardColumns(width, minCardWidth)`** returns `max(1, floor(width /
     minCardWidth))`, and 1 when `minCardWidth <= 0`.
   - **`cardsNaturalHeight(count, columns, cellHeight)`** returns
     `ceil(count / columns) * cellHeight`. `cellHeight` includes the gap, so
     it equals `GridView.contentHeight` and nothing scrolls (review).
   - **Tests** cover each function. Among them:
     - `parseUnitStats` with the real `live1` block, a `[not set]` block, an
       inactive unit, `@0`, and two `atMs` values;
     - `commitStats` for success, failure, and a late result for a stopped
       unit;
     - `cpuTrend([null, 5])` is `[]`;
     - **five** `overviewCard` cases: running with a stat; running without;
       stopped; running with a pending edit; new and pending;
     - **four** `overviewSummaryText` cases: an error; none readable;
       partial; with pending and failed;
     - `statsArgv` refusing a bad unit.
   - → `node tests/run.js`

2. **`MicrovmState.qml`: when readings are taken.**
   - **The holder.** `acquire` and `release` (`:45-53`) gain `else if (kind
     === "stats")`, with `property int statsHolders` (`Math.max(0, …)` on
     release).
     - Add `readonly property bool wantStats: active && statsHolders > 0`.
     - `onWantStatsChanged`: when true, call `readStats()`; when false,
       reset `stats`, `history` and `base` to `{}` and `meminfo` to `null`,
       so nothing old flashes on reopen (review).
   - **The data.** `property var stats: ({})`, `property var history: ({})`,
     `property var base: ({})`, `property var meminfo: null`, and `property
     int statsReads: 0`.
   - **`runningUnits(system)`.** It returns `Model.unitFor(row)` for each
     running row of that kind in `allRows`, walked by `.length`.
   - **`readStats()`.**
     - It returns unless `wantStats`.
     - For each side whose units are not empty and whose process is not
       running, it sets `command = Model.statsArgv(units, system)` and
       starts the process.
     - It calls `meminfoFile.reload()` and increments `statsReads`.
     - **Where it is called:** from `onWantStatsChanged`, and at the end of
       `listProcess.onExited` and `unitsProcess.onExited`. So the first
       reading comes as soon as the running set is known (review), and is
       **not** called from `refresh()`.
   - **The two processes**, `statsUserProcess` and `statsSystemProcess`,
     each collect stdout. On exit:

     ```text
     var r = Model.commitStats({stats, history, base}, side,
         code === 0 ? Model.parseUnitStats(out.text, Date.now()) : null,
         runningUnits(side === "system"), Date.now())
     ```

     Then reassign `stats`, `history` and `base` from `r`.
   - **`/proc/meminfo`.** A `FileView { id: meminfoFile; path:
     root.wantStats ? "/proc/meminfo" : ""; printErrors: false; onLoaded:
     root.meminfo = Model.parseMeminfo(text()); onLoadFailed: root.meminfo
     = null }`. It parses in `onLoaded`, because `reload()` is asynchronous
     (review).
   - **`statusJson()`** (`:583`) adds `statsHolders` and `statsReads`.
   - → `node tests/run.js && nix build`

3. **`VmList.qml`: card mode.**
   - **New properties:** `property bool cards: false`, `property bool large:
     false`, `property var stats: ({})`, `property var history: ({})`.
   - **Sizes.**
     - `readonly property int columns: Model.cardColumns(width,
       Style.space(large ? 360 : 260))`;
     - `readonly property int cellHeight: cardHeight + Style.spacing.md`,
       where `cardHeight` is fixed from the font sizes: five lines of text
       plus the sparkline slot.
   - **The grid.** Add a `GridView` (`id: gridView`) beside the `ListView`
     (`:68`), visible when `cards`, with the list visible when `!cards`. It
     uses:
     - `model: rowModel` (`:40`);
     - `cellWidth: Math.max(1, Math.floor(width / columns))`;
     - `cellHeight: root.cellHeight`;
     - the same `currentIndex` binding and the same
       `cursorFromKeyboard`/`keepCurrentVisible` handlers (`:84-89`).
     - When it becomes visible, it calls `keepCurrentVisible`, so switching
       views shows an off-screen cursor (review).
   - **The card delegate.** It gets the same `row` data, `hasCursor`
     (`:112`), click and hover handling, and the row action buttons
     (`:237-262`), with their tooltips (`:128-132`). It is inset by
     `Style.spacing.md / 2`, since `GridView` has no spacing. Its text comes
     from `Model.overviewCard(row, root.stats, root.history, Date.now())`:
     - the name, the kind badge, and the template with its ownership;
     - the status line, including the pending verb;
     - for a running VM: `uptimeText`, `memText`, `configText`, and a CPU
       slot of fixed height. The slot is a `Canvas` sparkline of `cpuTrend`
       in `Commons.Color.accent`, painted when the trend changes, and
       showing `cpuText` beside it. With no trend it shows "—";
     - for a non-running VM: its status and `configText`.
   - **The natural height.** `implicitHeight` (`:38`) becomes `cards ?
     Model.cardsNaturalHeight(rowModel.count, columns, cellHeight) :
     listView.contentHeight`.
   - → `node tests/run.js && nix build`
   - Trap: the #21 cursor identity rides on the shared `rowModel` and
     `cursorKey`. Do not add a second model.

4. **`MicrovmView.qml`: the view state, `v`, holding readings, header, empty
   state.**
   - **The view.** Add `property string view: "list"`.
     - `reset()` (`:118`) sets it to `MicrovmState.settings.overviewByDefault
       === true ? "overview" : "list"`.
     - `dismiss()` sets it to `"list"`. A reopen then never holds the
       readings for a stale view before `reset()` runs (review: `Panel.qml`
       acquires before it resets).
   - **`v`.** In `handleTextKey` (`:339`), in list mode with the filter not
       focused, `v` toggles `view`.
   - **Holding the readings.**
     - Add `readonly property bool wantsStats: opened && mode === "list" &&
       view === "overview"`, with a private `holdsStats` flag.
     - `onWantsStatsChanged`: when true and not held, `acquire("stats")` and
       set the flag; when false and held, `release("stats")` and clear it.
     - `Component.onDestruction`: `if (holdsStats && MicrovmState) {
       MicrovmState.release("stats"); holdsStats = false }`.
   - **`VmList`** (`:669`) gains `cards: root.view === "overview"`, `large:
     root.large`, `stats: MicrovmState.stats` and `history:
     MicrovmState.history`.
   - **The empty state** (`:690`) checks `root.rows.length === 0`.
   - **The header** (`:423`). In the overview:

     ```text
     Model.overviewSummaryText(MicrovmState.allRows, MicrovmState.stats,
         MicrovmState.meminfo, { reachable: MicrovmState.reachable,
         listError: MicrovmState.listError, upstreamError: MicrovmState.upstreamError })
     ```

     Otherwise, the existing `summaryText`.
   - **Sizing.** `bodyNatural` (`:31`) reads `list.implicitHeight` in list
     mode, which step 3 makes card-aware. Confirm it, and change nothing
     else.
   - → `node tests/run.js && nix build`

5. **The setting, the `v` shortcut and its test.**
   - **`manifest.json`:**
     - `barWidget.defaults` gains `"overviewByDefault": false`;
     - `schema` gains `{ "key": "overviewByDefault", "type": "boolean",
       "label": "Open on the overview", "description": "Show VMs as cards
       with live memory, CPU and uptime when the panel opens. v switches
       either way.", "defaultValue": false }`;
     - `barWidget.description` gains ", v switches to the overview", placed
       before ", and ? lists…" (review).
   - **`Panel.qml`:** add `readonly property bool overviewByDefault:
     setting("overviewByDefault", false) === true` (by `:22`), add it to
     `pushSettings()` (`:27`), and add `onOverviewByDefaultChanged:
     pushSettings()` (`:36-39`).
   - **`Model.SHORTCUTS`.** Add `{ group: "Panel", keys: "v", text: "Switch
     between the list and the overview" }` **inside the existing "Panel"
     block** (`:52-57`). `tests/model/rows.test.js:193` checks the order in
     which groups first appear (review).
   - **`tests/model/keys.test.js`** gains an assertion that `MicrovmView.qml`
     contains `key === "v"` and that `SHORTCUTS` has `"v"`.
   - **Menu.** Confirm `Menu.qml:143` binds `opened: root.opened` and that
     its settings come from `Model.settingsFor`. Change nothing there.
   - → `node tests/run.js && nix build && nix flake check`

6. **Words.**
   - **README:** the key table (`v`), and the settings table
     (`overviewByDefault`).
   - **`docs/usage.md`:**
     - a section "The overview": what a card shows; "—", "configured",
       "(pending)" and "(partial)"; that 100% CPU is one core; that readings
       are taken only while the overview is shown;
     - add `overviewByDefault` to the settings list (`:280-281`).
   - → `node tests/run.js && nix flake check`

## Final verification (mine, not delegated)

- **Checks:** `node tests/run.js`, `nix flake check` (also with
  `--all-systems --no-build`), `nix build`, and a fresh-clone `omarchy plugin
  validate`. Run the new tests against `Model.js` from `origin/main`: they
  must fail there.
- **Live**, by AGENTS.md "Verifying live", with a running `live1` (the
  owner's VM is only read) and a stopped `t1`. The `status` IPC gives the
  holder counts.

  | Action | Expected `statsHolders` | Other checks |
  | --- | --- | --- |
  | open the menu (list) | 0 | `statsReads` does not rise |
  | `v` | 1 | first reading at once |
  | `c` (form) | 0 | |
  | Esc back | 1 | |
  | `o` (log), then Esc | 0, then 1 | |
  | IPC `toggle` while open, which reopens and resets | 1 | stays 1 |
  | close | 0 | `statsReads` stops rising |

  Then:
  - **The cards:** `live1` shows uptime and memory, and its CPU goes from
    "—" to a trend after two polls. `t1` shows "stopped" and its configured
    size.
  - **The header** shows host memory and the VMs' share.
  - **The grid:**
    - `j`/`k`, a click, hover, the action buttons, and `s` on `t1` all work;
    - when `t1` starts, it moves to the top and the cursor follows it;
    - when a VM is removed, the cursor stays in place;
    - with the cursor on a row that's off-screen in the list, `v` shows it.
  - **Fit:** it fits in the menu, at text size 12.
  - **Health:** the bar is healthy, and there are no plugin warnings.
  - **Not testable on this host:** two surfaces overlapping (2 → 1 → 0),
    because the bar widget isn't on this bar.
- **Afterwards:** restore the Home Manager link, and remove `t1`.
- **Reviews:** Opus, then Codex and agy (`reviewers:`).
- **The PR:** it links the three artifacts, closes #53, and names the coder
  for each step.

## Tests

- `node tests/run.js` passes, including `overview.test.js`, the `v`
  assertion, and the unchanged group-order test.
- The flake checks are green.
- The live checks and the holder table pass.

## Rollback

- Each step is one commit.
- Steps 2–4 depend on step 1, and step 4 depends on 2 and 3. Revert them
  together.
- Step 5 depends on step 4: revert them together.

## Deviations recorded during implementation

- **Step 2** adds a small `commitSide(side, out, code)` helper, so the two
  processes share one `commitStats` call. It holds no logic of its own. It
  also returns early when `!wantStats` (lead), so a read that finishes after
  the overview closed cannot refill the maps that closing cleared.
