const { test, eq, ok, Model, LIST_TEXT, LIST_JSON, TEMPLATES_TEXT, TEMPLATES_JSON, UNITS_JSON, PATH, APPS_NIX, PENDING_JSON } = require("../harness.js")

test("parseVmList reads today's text and the JSON the upstream PR adds, the same way", () => {
  const text = Model.parseVmList(LIST_TEXT)
  eq(text.map(v => [v.name, v.template, v.running]), [["alice", "shell", false], ["bob", "python", true]])
  eq(text[0].dir, "")
  const json = Model.parseVmList(LIST_JSON)
  eq(json.map(v => [v.name, v.template, v.running]), text.map(v => [v.name, v.template, v.running]))
  eq(json[1].dir, "/home/user/.local/state/nixarchy/microvm/bob")
  ok(!Model.isJsonList(LIST_TEXT))
  ok(Model.isJsonList("  " + LIST_JSON))
})

test("parseVmList returns [] for no VMs, garbage, and rows it cannot act on", () => {
  eq(Model.parseVmList("No VMs yet. 'nixarchy vm create <name>' to make one.\n"), [])
  eq(Model.parseVmList(""), [])
  eq(Model.parseVmList(undefined), [])
  eq(Model.parseVmList("[not json"), [])
  eq(Model.parseVmList('{"name":"x"}'), [])
  eq(Model.parseVmList("  bad name        template=shell      stopped\n"), [])
  eq(Model.parseVmList(JSON.stringify([{ name: "a;b", template: "shell", running: false }])), [])
  eq(Model.parseVmList(JSON.stringify([{ name: "ok", template: "$(id)", running: "yes" }])), [{ name: "ok", template: "?", running: false, dir: "" }])
})

test("parseTemplates reads both formats and joins the note to its template", () => {
  const text = Model.parseTemplates(TEMPLATES_TEXT)
  eq(text.map(t => t.name), ["shell", "python"])
  eq(text[0].label, "Shell")
  ok(text[0].note.indexOf("throwaway prompt") !== -1)
  eq(text[1].note, "python3 and uv, 3 GiB of RAM.")
  eq(Model.parseTemplates(TEMPLATES_JSON), text)
  eq(Model.parseTemplates(""), [])
  eq(Model.parseTemplates("Templates:\n"), [])
  eq(Model.templateNames(text), ["shell", "python"])
})

test("parseUnits keeps the instance name and the two state words", () => {
  eq(Model.parseUnits(UNITS_JSON), [
    { name: "p1", active: "active", sub: "running" },
    { name: "p2", active: "failed", sub: "failed" },
    { name: "p3", active: "inactive", sub: "dead" }
  ])
  eq(Model.parseUnits(""), [])
  eq(Model.parseUnits("[]"), [])
  eq(Model.parseUnits(JSON.stringify([{ unit: "sshd.service", active: "active" }, { unit: "microvm@a b.service", active: "active" }])), [])
})

test("parseMachineLines tells our lines from the ones it must not touch", () => {
  const lines = Model.parseMachineLines(APPS_NIX)
  eq(lines.map(l => [l.name, l.ownership]), [
    ["p1", "managed"],                // the full grammar, as opt set wrote it
    ["p4", "managed-unsupported"],   // a hand-added `modules = [ ./mine.nix ]`
    ["p7", "managed-unsupported"]    // the marker says p7, the assignment says p6
  ])
  // p5 is commented out: nixarchy would not build it, so it is not a row.
  ok(!lines.some(l => l.name === "p5"))
  ok(lines[0].line.indexOf("#@opt " + PATH + "p1") !== -1)
  eq(Model.parseMachineLines(""), [])
  eq(Model.parseMachineLines("{ pkgs, ... }:\n{\n}\n"), [])
})

test("parsePending takes nixarchy-pkg's answer and nothing else", () => {
  const p = Model.parsePending(PENDING_JSON)
  eq(p, { ok: true, neverApplied: false, machines: { p1: "added" }, service: true })
  eq(Model.parsePending('{"ok":false,"error":"no apps.nix"}').ok, false)
  eq(Model.parsePending("").ok, false)
  eq(Model.parsePending("garbage").machines, {})
  eq(Model.parsePending(JSON.stringify({ ok: true, changes: [{ marker: "opt:services.foo" }] })).machines, {})
})

test("parseJsonLines keeps object lines and skips noise and broken JSON", () => {
  const raw = '{"ok":true}\nWARN something\n{broken\n\n{"ok":false}\n'
  eq(Model.parseJsonLines(raw), [{ ok: true }, { ok: false }])
  eq(Model.parseJsonLines(undefined), [])
})

test("stripAnsi removes colour, OSC and \\r redraws", () => {
  eq(Model.stripAnsi("\x1b[32m [ OK ]\x1b[0m done"), " [ OK ] done")
  eq(Model.stripAnsi("\x1b]0;title\x07text"), "text")
  eq(Model.stripAnsi("10%\r50%\r100% complete"), "100% complete")
  eq(Model.stripAnsi("line\r"), "line")
})

test("capLine cuts at 2 KB", () => {
  eq(Model.capLine("short"), "short")
  const long = Model.capLine("x".repeat(5000))
  eq(long.length, 2048)
  ok(long.endsWith("…"))
})

test("errorText picks the CLI's own refusal over its progress", () => {
  eq(Model.errorText("building…\nnixarchy-vm: 'a' is already running.\n"), "'a' is already running.")
  eq(Model.errorText("Failed to start microvm@p1.service: Interactive authentication required.\n"), "Failed to start microvm@p1.service: Interactive authentication required.")
  eq(Model.errorText("\x1b[31msome text\x1b[0m"), "some text")
  eq(Model.errorText(""), "")
})
