const { test, eq, ok, Model, LIST_JSON, UNITS_JSON, APPS_NIX, PENDING_JSON } = require("../harness.js")

const disposable = () => Model.disposableRows(Model.parseVmList(LIST_JSON))
const permanent = () => Model.permanentRows(Model.parseUnits(UNITS_JSON), Model.parseMachineLines(APPS_NIX), Model.parsePending(PENDING_JSON))

test("disposableRows: kind, state ownership, runtime from the lock", () => {
  const rows = disposable()
  eq(rows.map(r => [r.key, r.kind, r.ownership, r.runtime, r.template]), [
    ["disposable:alice", "disposable", "state", "stopped", "shell"],
    ["disposable:bob", "disposable", "state", "running", "python"]
  ])
})

test("permanentRows joins units and apps.nix lines by name, three axes apart", () => {
  const rows = permanent()
  const by = {}
  for (const r of rows) by[r.name] = r
  // p1: our line and a running unit, queued for apply.
  eq([by.p1.runtime, by.p1.pending], ["running", true])
  // p2 and p3: units only, declared somewhere we cannot edit.
  eq([by.p2.ownership, by.p2.runtime], ["flake", "failed"])
  eq([by.p3.ownership, by.p3.runtime, by.p3.pending], ["flake", "stopped", false])
  // p4: our marker, not our grammar; no unit yet.
  eq([by.p4.ownership, by.p4.runtime], ["managed-unsupported", "none"])
  ok(!("p5" in by))
  eq(Model.permanentRows([], [], null), [])
})

test("mergeRows: running, failed, pending, then by name", () => {
  const rows = Model.mergeRows(disposable().concat(permanent()))
  eq(Model.rowNames(rows), ["p1", "bob", "p2", "alice", "p3", "p4", "p7"])
})

test("rowsFor derives status and subtitle per row", () => {
  const rows = Model.rowsFor(disposable().concat(permanent()))
  const by = {}
  for (const r of rows) by[r.name] = r
  eq(by.bob.status, "running")
  eq(by.bob.subtitle, "disposable · python")
  eq(by.p1.status, "changed, pending apply")
  eq(by.p2.status, "failed")
  eq(by.p2.subtitle, "permanent · declared in your flake")
  eq(by.p4.status, "not built yet")
  eq(by.p4.subtitle, "permanent · apps.nix, edited by hand")
  eq([by.bob.up, by.p2.failing], [true, true])
})

test("filterRows matches name, template and kind, case-insensitively", () => {
  const rows = disposable().concat(permanent())
  eq(Model.rowNames(Model.filterRows(rows, "BOB")), ["bob"])
  eq(Model.rowNames(Model.filterRows(rows, "python")), ["bob", "p1"])
  ok(Model.filterRows(rows, "perm").every(r => r.kind === "permanent"))
  eq(Model.filterRows(rows, "  ").length, rows.length)
})

test("rowRecord types every field", () => {
  const rec = Model.rowRecord({ key: "k", name: "n", up: "yes", memory: 4096 })
  eq(rec.up, false)
  eq(rec.pending, false)
  eq(rec.memory, "4096")
  eq(rec.subtitle, "")
  eq(Object.keys(rec).length, Model.ROW_FIELDS.length + 1)
})

test("rowByName finds a row of one kind only", () => {
  const rows = disposable().concat(permanent())
  eq(Model.rowByName(rows, "disposable", "bob").kind, "disposable")
  eq(Model.rowByName(rows, "permanent", "bob"), null)
})

test("clampCursor keeps the cursor inside the list", () => {
  eq(Model.clampCursor(5, 3), 2)
  eq(Model.clampCursor(-1, 3), 0)
  eq(Model.clampCursor(4, 0), 0)
})

test("resolveCursor follows the row when the list re-sorts (#21)", () => {
  const before = [{ key: "disposable:t2", name: "t2", kind: "disposable", runtime: "running" }, { key: "permanent:p1", name: "p1", kind: "permanent", runtime: "stopped" }, { key: "disposable:t1", name: "t1", kind: "disposable", runtime: "stopped" }, { key: "disposable:t3", name: "t3", kind: "disposable", runtime: "stopped" }]
  eq(before[2].key, "disposable:t1")
  const after = [{ key: "disposable:t1", name: "t1", kind: "disposable", runtime: "running" }, { key: "disposable:t2", name: "t2", kind: "disposable", runtime: "running" }, { key: "permanent:p1", name: "p1", kind: "permanent", runtime: "stopped" }, { key: "disposable:t3", name: "t3", kind: "disposable", runtime: "stopped" }]
  const c = Model.resolveCursor(after, "disposable:t1", 2)
  eq(c.key, "disposable:t1")
  eq(c.index, 0)
  ok(after[2].key === "permanent:p1", "p1 now holds the old index")
})

test("resolveCursor keeps the position when the row is gone (#21)", () => {
  const gone = [{ key: "disposable:t2", name: "t2", kind: "disposable", runtime: "running" }, { key: "disposable:t3", name: "t3", kind: "disposable", runtime: "stopped" }, { key: "permanent:p1", name: "p1", kind: "permanent", runtime: "stopped" }]
  const c = Model.resolveCursor(gone, "disposable:t1", 2)
  eq(c.index, 2)
  eq(c.key, gone[2].key)
  const last = Model.resolveCursor(gone, "disposable:zz", 9)
  eq(last.index, gone.length - 1)
  eq(last.key, gone[gone.length - 1].key)
})

test("resolveCursor on an empty list (#21)", () => {
  const e = Model.resolveCursor([], "disposable:t1", 3)
  eq(e.key, "")
  eq(e.index, 0)
  const n = Model.resolveCursor(null, "", 0)
  eq(n.key, "")
  eq(n.index, 0)
})

test("resolveCursor with no key falls back to the index (#21)", () => {
  const rows = [{ key: "disposable:t1", name: "t1", kind: "disposable", runtime: "running" }, { key: "disposable:t2", name: "t2", kind: "disposable", runtime: "running" }, { key: "disposable:t3", name: "t3", kind: "disposable", runtime: "stopped" }]
  eq(Model.resolveCursor(rows, "", 1).key, rows[1].key)
  eq(Model.resolveCursor(rows, "", 99).key, rows[rows.length - 1].key)
  eq(Model.resolveCursor(rows, "", 99).index, rows.length - 1)
})

test("resolveCursor takes the first row with the key (#21)", () => {
  const dup = [{ key: "disposable:t9", name: "t9", kind: "disposable", runtime: "stopped" }, { key: "disposable:t1", name: "t1", kind: "disposable", runtime: "stopped" }, { key: "disposable:t1", name: "t1", kind: "disposable", runtime: "running" }]
  eq(Model.resolveCursor(dup, "disposable:t1", 2).index, 1)
})

test("reconcilePlan turns one key order into another", () => {
  const apply = (keys, rows) => {
    const out = keys.slice()
    for (const op of Model.reconcilePlan(keys, rows)) {
      if (op.op === "remove") out.splice(op.index, 1)
      else if (op.op === "insert") out.splice(op.index, 0, op.row.key)
      else out.splice(op.to, 0, out.splice(op.from, 1)[0])
    }
    return out
  }
  const rows = (...keys) => keys.map(key => ({ key }))
  eq(apply(["a", "b", "c"], rows("c", "a", "d")), ["c", "a", "d"])
  eq(apply([], rows("a")), ["a"])
  eq(apply(["a"], []), [])
  eq(Model.reconcilePlan(["a", "b"], rows("a", "b")), [])
})

test("counts, summaryText and footerText", () => {
  const rows = disposable().concat(permanent())
  eq(Model.counts(rows), { total: 7, running: 2, stopped: 5, failing: 1, pending: 1 })
  eq(Model.summaryText(rows, true), "2 of 7 running")
  eq(Model.summaryText([], true), "No VMs")
  eq(Model.summaryText(rows, false), "nixarchy-vm not found")
  eq(Model.footerText(rows), "7 VMs · 2 running · 1 pending")
  eq(Model.footerText(disposable().slice(1)), "1 VM · 1 running")
})

test("emptyText says why the list is empty", () => {
  const base = { everLoaded: true, reachable: true, filtered: false, showStopped: true }
  eq(Model.emptyText(Object.assign({}, base, { everLoaded: false })), "Loading…")
  eq(Model.emptyText(Object.assign({}, base, { reachable: false })), "nixarchy-vm is not on PATH")
  eq(Model.emptyText(Object.assign({}, base, { filtered: true })), "Nothing matches that filter")
  eq(Model.emptyText(Object.assign({}, base, { showStopped: false })), "No running VMs")
  eq(Model.emptyText(base), "No VMs yet — press c to create one")
})

test("every shortcut group renders, in the order first seen", () => {
  const groups = Model.shortcutGroups()
  eq(groups.map(g => g.title), ["Move", "VM", "All VMs", "Panel", "Form", "Log"])
  ok(groups.every(g => g.entries.length > 0))
})

test("stepCursor: the first ↓ lands on the first row (#5)", () => {
  const S = (active, index, delta, total) => Model.stepCursor(active, index, delta, total)
  eq(S(false, 0, 1, 0), { active: false, index: 0, toFilter: true })   // no rows
  eq(S(true, 1, -1, 0), { active: false, index: 0, toFilter: true })
  eq(S(false, 0, 1, 3), { active: true, index: 0, toFilter: false })   // inactive ↓: row 0
  eq(S(false, 2, 1, 3), { active: true, index: 0, toFilter: false })
  eq(S(false, 0, -1, 3), { active: false, index: 0, toFilter: true })  // inactive ↑: filter
  eq(S(false, 2, 0, 3), { active: true, index: 2, toFilter: false })   // filter's ↓ (delta 0), as today
  eq(S(false, 7, 0, 3), { active: true, index: 2, toFilter: false })
  eq(S(true, 0, -1, 3), { active: false, index: 0, toFilter: true })   // ↑ from row 0: filter
  eq(S(true, 0, 1, 3), { active: true, index: 1, toFilter: false })
  eq(S(true, 2, 1, 3), { active: true, index: 2, toFilter: false })    // clamped at the end
  eq(S(true, 2, -1, 3), { active: true, index: 1, toFilter: false })
  eq(S(true, 1, 0, 3), { active: true, index: 1, toFilter: false })
})

test("hiddenReason: the m hint names set-template only when it is missing (#4)", () => {
  const stopped = { kind: "disposable", name: "demo", runtime: "stopped" }
  const running = { kind: "disposable", name: "demo", runtime: "running" }
  eq(Model.hiddenReason(stopped, { vmSetTemplate: true }, "edit"), "")
  eq(Model.hiddenReason(stopped, { vmSetTemplate: false }, "edit"), "changing the template needs nixarchy vm set-template (nixarchy#762)")
  eq(Model.hiddenReason(running, { vmSetTemplate: true }, "edit"), "stop it first to change the template")
})
