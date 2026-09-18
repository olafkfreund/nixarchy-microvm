const fs = require("fs")
const path = require("path")
const { test, eq, ok, Model, TEMPLATES, LIST_JSON } = require("../harness.js")

const SCHEMA_TEXT = fs.readFileSync(path.join(__dirname, "..", "..", "schema.json"), "utf8")
const SCHEMA = JSON.parse(SCHEMA_TEXT)
const HOME = "/home/user"
const rows = Model.disposableRows(Model.parseVmList(LIST_JSON))
const reply = { kind: "permanent", name: "py-box", template: "python", memory: 4096, cores: 2, sshPort: 2222, autostart: true,
  shares: [{ source: "~/src", mountPoint: "/mnt/src" }], reasoning: "You asked for SSH, so permanent; python for the toolchain." }
const envelope = (obj) => JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "", structured_output: obj })

test("schema.json is the one copy, strict, and names exactly the form's agent fields", () => {
  eq(SCHEMA.additionalProperties, false)
  eq(Object.keys(SCHEMA.properties).sort(), ["autostart", "cores", "kind", "memory", "name", "reasoning", "shares", "sshPort", "template"])
  ok(!("sshKey" in SCHEMA.properties))
  eq(SCHEMA.properties.shares.items.additionalProperties, false)
  ok(!("SCHEMA" in Model))
})

test("agentFor: claude only", () => {
  eq(Model.agentFor("claude"), "claude")
  for (const other of ["codex", "opencode", "gemini", "copilot", "crush", "grok", "antigravity", "pi", "omp", "", undefined, "claude; id"]) eq(Model.agentFor(other), "")
})

test("agentArgv carries the exact no-tools flags, and the prompt as one element", () => {
  const prompt = "a python box with 4 GB; $(id) `id` \"quoted\""
  const argv = Model.agentArgv("claude", SCHEMA_TEXT, prompt)
  eq(argv, ["claude", "-p", "--output-format", "json", "--json-schema", SCHEMA_TEXT, "--restricted", "--strict-mcp-config", "--tools", "", "--no-session-persistence", prompt])
  for (const flag of ["--restricted", "--strict-mcp-config", "--tools", "--no-session-persistence"]) ok(argv.indexOf(flag) !== -1, flag)
  eq(argv[argv.indexOf("--tools") + 1], "")
  eq(Model.agentArgv("codex", SCHEMA_TEXT, prompt), null)
  eq(Model.agentArgv("claude", "", prompt), null)
  eq(Model.agentArgv("claude", SCHEMA_TEXT, ""), null)
  eq(Model.agentArgv("claude", SCHEMA_TEXT, "a\nb"), null)
  eq(Model.agentArgv("claude", SCHEMA_TEXT, "x".repeat(501)), null)
})

test("agentPrompt names every template once and holds the request once, as data", () => {
  const p = Model.agentPrompt("a python box with my ~/src shared", TEMPLATES)
  for (const t of TEMPLATES) {
    eq((p.match(new RegExp("^- " + t.name + " \\(", "mg")) || []).length, 1, t.name)
    ok(p.indexOf(t.note) !== -1)
  }
  eq(p.split("<request>").length, 2)
  ok(p.indexOf("<request>\na python box with my ~/src shared\n</request>") !== -1)
  ok(p.indexOf("never invent a path") !== -1)
})

test("parseAgentReply: the claude envelope, a bare object, prose around JSON, nothing", () => {
  eq(Model.parseAgentReply(envelope(reply)), reply)
  eq(Model.parseAgentReply(JSON.stringify({ type: "result", result: JSON.stringify(reply) })), reply)
  eq(Model.parseAgentReply(JSON.stringify(reply)), reply)
  eq(Model.parseAgentReply("Sure! Here you go:\n" + JSON.stringify(reply) + "\nHope that helps."), reply)
  eq(Model.parseAgentReply(JSON.stringify({ type: "result", result: "I cannot help with that." })), null)
  eq(Model.parseAgentReply(""), null)
  eq(Model.parseAgentReply("[1,2]"), null)
  eq(Model.parseAgentReply("{broken"), null)
})

test("applyAgentReply converts per field, rejects wrong types, drops unknown keys", () => {
  const got = Model.applyAgentReply(reply, Model.emptyForm("disposable"))
  eq(got.rejected, [])
  eq(got.reasoning, reply.reasoning)
  const f = got.form
  eq([f.kind, f.name, f.template, f.memory, f.cores, f.sshPort, f.autostart, f.shares, f.sshKey], ["permanent", "py-box", "python", "4096", "2", "2222", true, "~/src:/mnt/src", ""])
  const wrong = Model.applyAgentReply({ kind: "vm", name: 12, template: ["x"], memory: "4096", cores: 2.5, sshPort: "2222", autostart: "yes",
    shares: "~/src:/mnt/src", reasoning: null, sshKey: "ssh-ed25519 AAAA", command: "rm -rf /" }, Model.emptyForm("permanent"))
  eq(wrong.rejected.sort(), ["autostart", "cores", "kind", "memory", "name", "reasoning", "shares", "sshPort", "template"])
  eq(wrong.form, Model.emptyForm("permanent"))
  eq(Model.applyAgentReply({ sshPort: null, shares: [] }, Model.emptyForm("permanent")).form.sshPort, "")
  eq(Model.applyAgentReply({ shares: [{ source: "/a" }] }, Model.emptyForm("permanent")).rejected, ["shares"])
  eq(Model.applyAgentReply(null, Model.emptyForm()).form, Model.emptyForm())
})

test("fill → validate → snippet equals a typed form; hostile values only reach the validator", () => {
  const filled = Model.applyAgentReply(reply, Model.emptyForm("disposable")).form
  const typed = Object.assign(Model.emptyForm("permanent"), { name: "py-box", template: "python", memory: "4096", cores: "2", sshPort: "2222", shares: "~/src:/mnt/src" })
  eq(filled, typed)
  eq(Model.validateForm(filled, rows, TEMPLATES, HOME).errors, {})
  eq(Model.machineSnippet(filled, rows, TEMPLATES, HOME), Model.machineSnippet(typed, rows, TEMPLATES, HOME))
  const hostile = Model.applyAgentReply({ kind: "permanent", name: "x; rm -rf /", template: "$(id)", shares: [{ source: "/etc", mountPoint: "/nix/store" }], reasoning: "x" }, Model.emptyForm()).form
  const check = Model.validateForm(hostile, rows, TEMPLATES, HOME)
  ok(check.errors.name && check.errors.template && check.errors.shares)
  eq(Model.machineSnippet(hostile, rows, TEMPLATES, HOME), null)
  eq(Model.submitArgvs(hostile, rows, TEMPLATES, HOME, { pkgScript: "/x" }), null)
})
