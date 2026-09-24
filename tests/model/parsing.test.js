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

test("parseSshKeys lists ~/.ssh/*.pub lines that are keys, by file", () => {
  const raw = "id_ed25519.pub\tssh-ed25519 AAAAC3Nza me@host\nid_rsa.pub\tssh-rsa AAAAB3Nza\nbroken.pub\tnot a key\nno-tab\n"
  eq(Model.parseSshKeys(raw), [{ file: "id_ed25519.pub", key: "ssh-ed25519 AAAAC3Nza" }, { file: "id_rsa.pub", key: "ssh-rsa AAAAB3Nza" }])
  eq(Model.parseSshKeys(""), [])
  eq(Model.sshKeysArgv("/home/user/")[1], "/home/user/.ssh")
  eq(Model.sshKeysArgv(""), null)
})

test("writerError reads nixarchy-pkg's {ok:false,error} and nothing else", () => {
  eq(Model.writerError('{"ok":false,"error":"p1 is already in apps.nix -- remove it first"}'), "p1 is already in apps.nix -- remove it first")
  eq(Model.writerError('{"ok":true,"message":"set …"}'), "")
  eq(Model.writerError("enabled microvm in services.nix (1 queued)\n"), "")
  eq(Model.writerError(""), "")
})

test("a line an earlier version wrote reads back as managed (#22)", () => {
  const PATH = "programs.nixarchy.services.microvm.machines."
  const line = (name, tag) => "  " + PATH + name + " = { template = \"shell\"; autostart = false; " +
    "memory = 1024; cores = 1; sshPort = null; shares = [ { source = \"/home/user/x\"; " +
    "mountPoint = \"/mnt/x\"; tag = \"" + tag + "\"; } ]; };  #@opt " + PATH + name
  const at = (nix, name) => Model.parseMachineLines(nix).filter(m => m.name === name)[0]

  // Tags this emitter can no longer produce, but an earlier one did.
  eq(at(line("a", "c++"), "a").ownership, "managed")
  ok(at(line("a", "c++"), "a").fields, "and its fields are usable")
  eq(at(line("b", "x".repeat(100)), "b").ownership, "managed")

  // A .. on the host side stays readable too: the line still means what it
  // meant, and only a save of it is refused.
  const dots = "  " + PATH + "c = { template = \"shell\"; autostart = false; memory = 1024; " +
    "cores = 1; sshPort = null; shares = [ { source = \"/home/user/../etc\"; " +
    "mountPoint = \"/mnt/x\"; tag = \"x\"; } ]; };  #@opt " + PATH + "c"
  eq(at(dots, "c").ownership, "managed")

  // Still refused: a builtin tag, and a tag carrying a quote.
  eq(at(line("d", "ro-store"), "d").ownership, "managed-unsupported")
  eq(at(line("e", 'a\\"b'), "e").ownership, "managed-unsupported")
})

test("names from Object.prototype are rows, not prototype members (#22)", () => {
  const P = "programs.nixarchy.services.microvm.machines."
  const NAMES = ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"]
  const nix = NAMES.map(n => "  " + P + n + " = { template = \"shell\"; };  #@opt " + P + n).join("\n")

  // Before Object.create(null), seen["constructor"] was truthy on a fresh {} and
  // the line the plugin had just written became invisible: a declared machine
  // the UI denied existed, unreachable for edit or delete.
  eq(Model.parseMachineLines(nix).map(m => m.name), NAMES)

  const units = NAMES.map(n => ({ name: n, active: "active" }))
  eq(Model.permanentRows(units, [], null).map(r => r.name), NAMES)

  // And byName[name].runtime = … no longer assigns onto the Object constructor,
  // which in a .pragma library singleton would outlive the call.
  eq(Object.prototype.runtime, undefined)
  eq(Object.prototype.pending, undefined)
  eq(({}).constructor.runtime, undefined)
})
