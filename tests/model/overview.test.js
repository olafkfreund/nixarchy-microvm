const { test, eq, ok, Model } = require("../harness.js")

const user = "nixarchy-vm-live1.service"
const system = "microvm@p1.service"
const live = { kind: "disposable", name: "live1", runtime: "running", memory: "", cores: "", pending: false }
const permanent = { kind: "permanent", name: "p1", runtime: "running", memory: "4096", cores: "2", pending: false }

test("unitFor and statsArgv keep names and argv safe", () => {
  eq(Model.unitFor(live), user)
  eq(Model.unitFor(permanent), system)
  eq(Model.unitFor({ kind: "permanent", name: "bad.name" }), "")
  eq(Model.unitFor({ kind: "other", name: "p1" }), "")
  eq(Model.statsArgv([user], false), ["systemctl", "--user", "show", "--timestamp=unix", "-p",
    "Id,ActiveState,MemoryCurrent,CPUUsageNSec,ActiveEnterTimestamp", "--", user])
  eq(Model.statsArgv([system], true), ["systemctl", "show", "--timestamp=unix", "-p",
    "Id,ActiveState,MemoryCurrent,CPUUsageNSec,ActiveEnterTimestamp", "--", system])
  eq(Model.statsArgv([], true), null)
  eq(Model.statsArgv([user, "bad;unit"], false), null)
})

test("parseUnitStats reads the real live1 block and skips inactive units", () => {
  const text = `Id=nixarchy-vm-live1.service
ActiveState=active
ActiveEnterTimestamp=@1794833520
MemoryCurrent=7528833024
CPUUsageNSec=6504197705000

Id=microvm@p1.service
ActiveState=inactive
MemoryCurrent=10
CPUUsageNSec=20`
  eq(Model.parseUnitStats(text, 1000), {
    [user]: { mem: 7528833024, cpuNs: 6504197705000, since: 1794833520, atMs: 1000 }
  })
  eq(Model.parseUnitStats(text, 2000)[user].atMs, 2000)
})

test("parseUnitStats maps unset, empty, bad and @0 to unknown", () => {
  const text = `Id=${system}
ActiveState=active
MemoryCurrent=[not set]
CPUUsageNSec=
ActiveEnterTimestamp=@0

Id=${user}
ActiveState=active
MemoryCurrent=nope
CPUUsageNSec=broken
ActiveEnterTimestamp=@bad`
  eq(Model.parseUnitStats(text, 9), {
    [system]: { mem: null, cpuNs: null, since: null, atMs: 9 },
    [user]: { mem: null, cpuNs: null, since: null, atMs: 9 }
  })
})

test("parseMeminfo requires both values", () => {
  eq(Model.parseMeminfo("MemTotal: 16384 kB\nMemFree: 1 kB\nMemAvailable: 8192 kB\n"),
    { totalKiB: 16384, availableKiB: 8192 })
  eq(Model.parseMeminfo("MemTotal: 16384 kB\n"), null)
})

test("cpuPercent uses one core as 100 percent, and samples preserve gaps", () => {
  eq(Model.cpuPercent({ cpuNs: 0, atMs: 1000 }, { cpuNs: 1000000000, atMs: 2000 }), 100)
  eq(Model.cpuPercent(null, { cpuNs: 1, atMs: 2 }), null)
  eq(Model.cpuPercent({ cpuNs: null, atMs: 1 }, { cpuNs: 1, atMs: 2 }), null)
  eq(Model.cpuPercent({ cpuNs: 1, atMs: 2 }, { cpuNs: 2, atMs: 2 }), null)
  eq(Model.cpuPercent({ cpuNs: 2, atMs: 1 }, { cpuNs: 1, atMs: 2 }), null)
  eq(Model.pushSample([1, null], 3, 3), [1, null, 3])
  eq(Model.pushSample([1, null, 3], 4, 3), [null, 3, 4])
  eq(Model.pushSample([1], 2, 0), [])
  eq(Model.pushSample(Array(30).fill(1), null).length, 30)
  eq(Model.cpuTrend([null, 5]), [])
  eq(Model.cpuTrend([null, 5, 7]), [null, 5, 7])
  eq(Model.cpuText([null, 12.4, null]), "—") // the latest is unknown: never an older figure
  eq(Model.cpuText([null]), "—")
})

test("commitStats succeeds without mutating prior state", () => {
  const first = { [user]: { mem: 1048576, cpuNs: 1000000000, since: 1, atMs: 1000 } }
  const empty = { stats: {}, history: {}, base: {} }
  const one = Model.commitStats(empty, "user", first, [user], 1000)
  eq(one.stats, first)
  eq(one.history[user], [null])
  eq(one.base[user], { cpuNs: 1000000000, atMs: 1000, since: 1 })
  eq(empty, { stats: {}, history: {}, base: {} })
  const second = { [user]: { mem: 2097152, cpuNs: 2000000000, since: 1, atMs: 2000 } }
  const two = Model.commitStats(one, "user", second, [user], 2000)
  eq(two.history[user], [null, 100])
  eq(two.stats[user], second[user])
  eq(one.history[user], [null])
})

test("commitStats failure clears only its side, including history and baseline", () => {
  const old = {
    stats: { [user]: { mem: 1 }, [system]: { mem: 2 } },
    history: { [user]: [5], [system]: [8] },
    base: { [user]: { cpuNs: 1, atMs: 1 }, [system]: { cpuNs: 2, atMs: 2 } }
  }
  eq(Model.commitStats(old, "user", null, [user], 3), {
    stats: { [system]: { mem: 2 } }, history: { [system]: [8] }, base: { [system]: { cpuNs: 2, atMs: 2 } }
  })
})

test("commitStats cannot revive a stopped unit from a late result", () => {
  const old = { stats: { [user]: { mem: 1 } }, history: { [user]: [5] }, base: { [user]: { cpuNs: 1, atMs: 1 } } }
  const late = { [user]: { mem: 2, cpuNs: 2, atMs: 2 } }
  eq(Model.commitStats(old, "user", late, [], 2), { stats: {}, history: {}, base: {} })
})

test("commitStats preserves the other side and clears missing active units", () => {
  const old = {
    stats: { [user]: { mem: 1 }, [system]: { mem: 2 } },
    history: { [user]: [5], [system]: [8] },
    base: { [user]: { cpuNs: 1, atMs: 1 }, [system]: { cpuNs: 2, atMs: 2 } }
  }
  eq(Model.commitStats(old, "user", {}, [user], 3), {
    stats: { [system]: { mem: 2 } }, history: { [system]: [8] }, base: { [system]: { cpuNs: 2, atMs: 2 } }
  })
})

test("memory, uptime and grid size use the specified units", () => {
  eq(Model.formatMemory(null), "—")
  eq(Model.formatMemory(1073741823), "1024 MiB")
  eq(Model.formatMemory(1610612736), "1.5 GiB")
  eq(Model.formatUptime(null, 0), "—")
  eq(Model.formatUptime(0, 59000), "0 min")
  eq(Model.formatUptime(0, 3600000), "1 h")
  eq(Model.formatUptime(0, 86400000), "1 d")
  eq(Model.cardColumns(780, 260), 3)
  eq(Model.cardColumns(100, 260), 1)
  eq(Model.cardColumns(100, 0), 1)
  eq(Model.cardsNaturalHeight(5, 2, 100), 300)
  eq(Model.cardsNaturalHeight(0, 2, 100), 0)
})

test("overviewCard running with a stat", () => {
  eq(Model.overviewCard(permanent, { [system]: { mem: 1610612736, since: 0 } },
    { [system]: [null, 12.4, 15] }, 7200000), {
    running: true, memText: "1.5 GiB", configText: "configured 4.0 GiB · 2 cores",
    uptimeText: "2 h", cpuTrend: [null, 12.4, 15], cpuText: "15%",
    vitalsText: "up 2 h · 1.5 GiB", cpuLabel: "cpu 15%"
  })
})

test("overviewCard running without a stat", () => {
  eq(Model.overviewCard(live, {}, {}, 0), {
    running: true, memText: "—", configText: "", uptimeText: "—", cpuTrend: [], cpuText: "—",
    vitalsText: "up — · —", cpuLabel: "cpu —"
  })
})

test("overviewCard stopped shows configured size", () => {
  eq(Model.overviewCard({ ...permanent, runtime: "stopped" }, { [system]: { mem: 123, since: 0 } },
    { [system]: [5, 6] }, 0), {
    running: false, memText: "—", configText: "configured 4.0 GiB · 2 cores",
    uptimeText: "—", cpuTrend: [], cpuText: "—", vitalsText: "", cpuLabel: "cpu —"
  })
})

test("overviewCard hides a running pending edit's configured size", () => {
  eq(Model.overviewCard({ ...permanent, pending: true }, {}, {}, 0).configText, "")
})

test("overviewCard shows a new pending machine's configured size", () => {
  eq(Model.overviewCard({ ...permanent, runtime: "none", pending: true }, {}, {}, 0).configText,
    "configured 4.0 GiB · 2 cores (pending)")
})

test("overviewSummaryText gives errors priority", () => {
  const rows = [live]
  eq(Model.overviewSummaryText(rows, {}, null, { reachable: false, upstreamError: "update", listError: "bad" }), "nixarchy-vm not found")
  eq(Model.overviewSummaryText(rows, {}, null, { reachable: true, upstreamError: "update", listError: "bad" }), "update")
  eq(Model.overviewSummaryText(rows, {}, null, { reachable: true, listError: "bad" }), "VM list failed: bad")
})

test("overviewSummaryText shows unknown when no running VM is readable", () => {
  eq(Model.overviewSummaryText([live], {}, null, { reachable: true }), "host — used · VMs — · 1 running")
})

test("overviewSummaryText marks a partly readable running total", () => {
  const p = { ...permanent, pending: false }
  eq(Model.overviewSummaryText([live, p], { [user]: { mem: 1048576 } },
    { totalKiB: 4096, availableKiB: 2048 }, { reachable: true }),
  "host 2 MiB used · VMs 1 MiB (partial) · 2 running")
})

test("overviewSummaryText adds pending and failed counts", () => {
  eq(Model.overviewSummaryText([live, { ...permanent, runtime: "failed", pending: true }],
    { [user]: { mem: 1073741824 } }, null, { reachable: true }),
  "host — used · VMs 1.0 GiB · 1 running · 1 pending · 1 failed")
})

test("commitStats starts a fresh history after a restart (#53 review)", () => {
  const id = "nixarchy-vm-t1.service"
  const a = Model.commitStats({ stats: {}, history: {}, base: {} }, "user",
    { [id]: { mem: 1, cpuNs: 1000000000, since: 100, atMs: 0 } }, [id], 0)
  const b = Model.commitStats(a, "user", { [id]: { mem: 1, cpuNs: 2000000000, since: 100, atMs: 1000 } }, [id], 1000)
  eq(b.history[id], [null, 100])
  // a new start time: the old samples are dropped
  const c = Model.commitStats(b, "user", { [id]: { mem: 1, cpuNs: 3000000000, since: 200, atMs: 2000 } }, [id], 2000)
  eq(c.history[id], [null])
  // a counter that went back on the same start time is a restart too
  const d = Model.commitStats(b, "user", { [id]: { mem: 1, cpuNs: 10, since: 100, atMs: 2000 } }, [id], 2000)
  eq(d.history[id], [null])
})

test("commitStats with an empty result clears a side whose VMs all stopped (#53 review)", () => {
  const id = "nixarchy-vm-t1.service"
  const a = Model.commitStats({ stats: {}, history: {}, base: {} }, "user",
    { [id]: { mem: 1, cpuNs: 1, since: 1, atMs: 0 } }, [id], 0)
  const b = Model.commitStats(a, "user", {}, [], 1000)
  eq([b.stats, b.history, b.base], [{}, {}, {}])
})

test("cardStatusText and sparkPoints (#53 review)", () => {
  eq(Model.cardStatusText({ up: true, pending: false, status: "running" }, false, ""), "")
  eq(Model.cardStatusText({ up: false, status: "stopped" }, false, ""), "stopped")
  eq(Model.cardStatusText({ up: true, status: "x" }, true, "deleting"), "deleting…")
  eq(Model.sparkPoints([50], 100, 10), [])
  const p = Model.sparkPoints([0, null, 100], 100, 10)
  eq(p.map(q => q.move), [true, true])
  eq(p[0].x, 0); eq(p[1].x, 100); eq(p[1].y, 1)
})

test("overviewSummaryText without partial when every running VM is readable (#53 review)", () => {
  const rows = [{ kind: "disposable", name: "t1", runtime: "running" }]
  eq(Model.overviewSummaryText(rows, { "nixarchy-vm-t1.service": { mem: 1073741824 } },
    { totalKiB: 2097152, availableKiB: 1048576 }, { reachable: true }), "host 1.0 GiB used · VMs 1.0 GiB · 1 running")
})
