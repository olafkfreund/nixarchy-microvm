const fs = require("fs")
const os = require("os")
const path = require("path")
const cp = require("child_process")
const { test, eq, ok, Model, TEMPLATES } = require("../harness.js")

const record = (file, body) => "\x1e" + file + "\x1f" + body
const parsed = text => Model.parsePreset(JSON.stringify(text))

test("presetsArgv is exact, bounded and uses argv only", () => {
  const expected = ["timeout", "2", "find", "-L", "/home/u/.config/nixarchy/microvm/presets",
    "-maxdepth", "1", "-type", "f", "-name", "*.json", "!", "-name", ".*",
    "(", "-size", "+16k", "-printf", "\\036%f\\037\\025", "-o",
    "-printf", "\\036%f\\037", "-exec", "cat", "{}", ";", ")"]
  eq(Model.presetsArgv("/home/u/.config"), expected)
  eq(Model.presetsArgv("/home/u/.config/"), expected)
  eq(Model.presetsArgv(""), null)
  eq(Model.presetsArgv("  "), null)
  ok(!expected.includes("sh") && !expected.includes("-c"))
})

test("presetsArgv reads regular visible JSON and marks oversized files", () => {
  if (cp.spawnSync("find", ["--version"], { stdio: "ignore" }).error) return
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "microvm-presets-"))
  const dir = path.join(home, "nixarchy/microvm/presets")
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, "a.json"), "{}")
    fs.writeFileSync(path.join(dir, "b.txt"), "{}")
    fs.writeFileSync(path.join(dir, ".h.json"), "{}")
    fs.mkdirSync(path.join(dir, "d.json"))
    fs.writeFileSync(path.join(dir, "z.json"), "x".repeat(20 * 1024))
    const run = cp.spawnSync(Model.presetsArgv(home)[0], Model.presetsArgv(home).slice(1), { encoding: "utf8" })
    eq(run.status, 0)
    eq(run.stdout.split("\x1e").filter(Boolean).sort(), ["a.json\x1f{}", "z.json\x1f\x15"])
  } finally { fs.rmSync(home, { recursive: true, force: true }) }
})

test("parsePreset rejects invalid JSON and unknown keys in file order", () => {
  for (const text of ["", "{", "[]", "null"]) eq(Model.parsePreset(text).error, "not valid JSON")
  eq(parsed({ length: 0 }).error, 'unknown key "length"')
  for (const key of ["startNow", "sshKey", "describe", "editing", "__proto__"]) {
    const reply = JSON.parse('{"' + key + '":"SECRET_SENTINEL"}')
    eq(parsed(reply).error, 'unknown key "' + key + '"')
  }
  eq(Model.parsePreset('{"x":"SECRET_SENTINEL","y":1}').error, 'unknown key "x"')
})

test("parsePreset rejects wrong types, share shape and excess lengths", () => {
  for (const [reply, error] of [
    [{ memory: "4096" }, "wrong type: memory"], [{ kind: "SECRET_SENTINEL" }, "wrong type: kind"],
    [{ shares: "SECRET_SENTINEL" }, "wrong type: shares"], [{ shares: { source: "/a" } }, "wrong type: shares"],
    [{ shares: { length: 1 } }, "wrong type: shares"],
    [{ shares: [{ source: "/a", mountPoint: "/b", extra: "SECRET_SENTINEL" }] }, "wrong type: shares"],
    [{ shares: [{ source: 1, mountPoint: "/b" }] }, "wrong type: shares"],
    [{ shares: Array(17).fill({ source: "/a", mountPoint: "/b" }) }, "too many shares (over 16)"],
    [{ name: "x".repeat(65) }, "too long: name"], [{ template: "x".repeat(33) }, "too long: template"],
    [{ reasoning: "x".repeat(281) }, "too long: reasoning"],
    [{ shares: [{ source: "x".repeat(4097), mountPoint: "/b" }] }, "too long: shares"]
  ]) {
    const result = parsed(reply)
    eq(result, { ok: false, reply: null, error })
    ok(!result.error.includes("SECRET_SENTINEL"))
  }
  eq(Model.parsePreset("x".repeat(16385)).error, "too large (over 16 KiB)")
  eq(Model.parsePreset("\x15").error, "too large (over 16 KiB)")
})

test("parsePreset accepts blank, ignored name, null port and every allowed key", () => {
  eq(parsed({}), { ok: true, reply: {}, error: "" })
  eq(parsed({ name: "ignored", sshPort: null }).error, "")
  const full = { kind: "permanent", name: "ignored", template: "python", memory: 4096,
    cores: 2, sshPort: 2222, autostart: false,
    shares: [{ source: "~/src", mountPoint: "/mnt/src" }], reasoning: "because" }
  eq(parsed(full), { ok: true, reply: full, error: "" })
})

test("parsePresets sorts, caps, sanitizes and counts omitted entries", () => {
  eq(Model.parsePresets(record("b.json", "{}") + record("a.json", "{}") + "\x1ejunk").presets.map(p => p.label), ["a", "b"])
  const ten = Array.from({ length: 10 }, (_, i) => record(String(i).padStart(2, "0") + ".json", "{}")).join("")
  eq([Model.parsePresets(ten).presets.length, Model.parsePresets(ten).more], [9, 1])
  const forty = Array.from({ length: 40 }, (_, i) => record(String(i).padStart(2, "0") + ".json", "{}")).join("")
  eq([Model.parsePresets(forty).presets.length, Model.parsePresets(forty).more], [9, 31])
  const bad = Model.parsePresets(record("big.json", "\x15") + record("grown.json", "x".repeat(16385)) +
    record("empty.json", "") + record("bi\u202edi.json", "{") + record("\x01.json", "{"))
  eq(bad.errors.length, 5)
  ok(bad.errors.includes("big.json: too large (over 16 KiB)"))
  ok(bad.errors.includes("grown.json: too large (over 16 KiB)"))
  ok(bad.errors.includes("empty.json: not valid JSON"))
  ok(bad.errors.includes("bidi.json: not valid JSON"))
  ok(bad.errors.includes("(unnamed).json: not valid JSON"))
})

test("a forged record boundary is confined to user folder data", () => {
  const got = Model.parsePresets(record("first.json", '{"x":"') + record("forged.json", "{}"))
  eq(got.errors, ["first.json: not valid JSON"])
  eq(got.presets, [{ label: "forged", reply: {} }])
})

test("presetForm starts blank, ignores name and leaves validation to validateForm", () => {
  const a = { label: "a", reply: { kind: "permanent", name: "ignored", template: "python", memory: 4096, sshPort: 2222 } }
  const b = { label: "b", reply: { template: "shell" } }
  const one = Model.presetForm(a)
  eq(one, Model.presetForm(a))
  eq([one.kind, one.name, one.describe, one.preset, one.startNow, one.sshKey, one.advanced],
    ["permanent", "", "", "a", true, "", true])
  eq(Model.presetForm(b).memory, "1024")
  const valid = Object.assign({}, one, { name: "new-box" })
  eq(Model.validateForm(valid, [], TEMPLATES, "/home/u").errors, {})
  const bad = { label: "bad", reply: { template: "missing" } }
  eq(parsed(bad.reply).error, "")
  ok(Model.validateForm(Object.assign(Model.presetForm(bad), { name: "new-box" }), [], TEMPLATES, "/home/u").errors.template)
  ok(Model.presetForm({ label: "shares", reply: { kind: "permanent", shares: [{ source: "/a", mountPoint: "/b" }] } }).advanced)
})

test("presetTouched keeps supplied form keys except name and reasoning", () => {
  eq(Model.presetTouched({ name: "x", reasoning: "y", template: "python", shares: [], sshPort: null, startNow: true }),
    { template: true, shares: true, sshPort: true })
})

test("preset row visibility, digit index and captions", () => {
  const form = Model.emptyForm()
  const keys = state => Model.visibleFields(form, state).map(f => f.key)
  eq(keys({ presets: 1 })[0], "preset")
  ok(!keys({}).includes("preset"))
  eq(keys({ presetErrors: 1 })[0], "preset")
  ok(!Model.visibleFields(Object.assign(form, { editing: true }), { presets: 1 }).some(f => f.key === "preset"))
  eq(Model.fieldIndexOf(Model.visibleFields(Model.emptyForm(), { presets: 1 }), "name"),
    Model.fieldIndexOf(Model.visibleFields(Model.emptyForm(), {}), "name") + 1)
  for (let n = 1; n <= 9; n++) eq(Model.presetIndex(String(n), 9), n - 1)
  for (const value of ["0", "10", "a", "", undefined]) eq(Model.presetIndex(value, 9), -1)
  eq(Model.presetIndex("2", 1), -1)
  eq(Model.presetLine([{ label: "python-4g" }, { label: "web" }]), "1 python-4g   2 web")
})

test("startHere and emptyText agree on the last branch", () => {
  const state = { everLoaded: true, reachable: true, filtered: false, upstreamError: "", listError: "", showStopped: true, presets: 1 }
  ok(Model.startHere(state))
  eq(Model.emptyText(state), "No VMs yet — press c to create one, or start from a preset")
  eq(Model.emptyText(Object.assign({}, state, { presets: 0 })), "No VMs yet — press c to create one")
  for (const change of [{ everLoaded: false }, { reachable: false }, { filtered: true },
    { upstreamError: "down" }, { listError: "down" }, { showStopped: false }]) {
    const other = Object.assign({}, state, change)
    ok(!Model.startHere(other))
    ok(!Model.emptyText(other).includes("start from a preset"))
  }
})

test("presetNote bounds errors and reports shown count", () => {
  eq(Model.presetNote([], 0, 0), "")
  eq(Model.presetNote(["bad"], 0, 0), "1 preset skipped: bad")
  eq(Model.presetNote(["a", "b", "c"], 9, 5), "3 presets skipped: a; b; +1 more   9 of 14 shown")
  ok(Model.presetNote(["x".repeat(130)], 0, 0).includes("x".repeat(119) + "…"))
  eq(Model.presetNote([], 9, 5), "9 of 14 shown")
})

test("shortcut entries use existing groups and short key labels", () => {
  for (const group of ["Form", "All VMs"]) {
    const entries = Model.SHORTCUTS.filter(s => s.group === group && s.keys === "1-9")
    eq(entries.length, 1)
    ok(entries[0].keys.length <= 12)
  }
})
