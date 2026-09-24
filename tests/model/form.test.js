const { test, eq, ok, Model, TEMPLATES, SNIPPET, LIST_JSON, UNITS_JSON, APPS_NIX, PENDING_JSON } = require("../harness.js")

const HOME = "/home/user"
const rows = Model.disposableRows(Model.parseVmList(LIST_JSON))
  .concat(Model.permanentRows(Model.parseUnits(UNITS_JSON), Model.parseMachineLines(APPS_NIX), Model.parsePending(PENDING_JSON)))
const KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGtestkey"
const form = (over, kind) => Object.assign(Model.emptyForm(kind || "permanent"), { name: "t1" }, over || {})
const errors = (over, kind) => Model.validateForm(form(over, kind), rows, TEMPLATES, HOME).errors
const snippet = (over) => Model.machineSnippet(form(over), rows, TEMPLATES, HOME)

// Everything that means something to a shell or to Nix's string syntax.
const HOSTILE = ["$(id)", "`id`", "a;b", "a|b", "a&b", "a>b", "a<b", "a'b", 'a"b', "a\\b", "a\nb", "${HOME}", "a b"]

test("nixSafe is the set nixString may be handed (#22)", () => {
  ok(!Model.nixSafe('a"b'), "a quote ends the Nix string")
  ok(!Model.nixSafe("a\\b"), "a backslash escapes in Nix")
  ok(!Model.nixSafe("a${b}"), "${ interpolates at eval time")
  ok(!Model.nixSafe("a\u0001b"), "control characters")
  ok(Model.nixSafe("/home/user/c++"), "a plain path is fine")
  ok(Model.nixSafe(""), "empty is writable")
})

test("isHostHome and isHostPath reject what the emitter cannot write (#22)", () => {
  ok(Model.isHostHome("/home/user"))
  ok(!Model.isHostHome(""), "empty HOME cannot expand ~/")
  ok(!Model.isHostHome("~/x"), "HOME is absolute, never ~/-relative")
  ok(!Model.isHostHome("/home/a\"b"), "a quote would break the emitted string")
  ok(!Model.isHostHome("/home/${x}"), "interpolation")
  ok(!Model.isHostHome("/home/../root"), "no .. segment")
  ok(Model.isHostPath("~/src"), "the host side may be ~/-relative")
  ok(Model.isHostPath("/srv/a.b"), "a dot inside a name is not a segment")
  ok(!Model.isHostPath("~/../etc"), "no .. segment")
  ok(!Model.isHostPath("/srv/./etc"), "no . segment")
})

test("a pathological HOME blocks ~/ shares, not absolute ones (#22)", () => {
  const BAD = ["/home/${builtins.currentTime}", 'a"b'.replace("a", "/home/"), "/home/a\\b", "", "/home/a b", "~/x", "/home/../root"]
  for (const bad of BAD) {
    const f = form({ shares: "~/src:/mnt/src" })
    ok(Model.validateForm(f, rows, TEMPLATES, bad).errors.shares, "shares error for HOME " + JSON.stringify(bad))
    eq(Model.machineSnippet(f, rows, TEMPLATES, bad), null)
    eq(Model.expandHome("~/src", bad), null)
    // An absolute share never needs HOME, so it is unaffected.
    const abs = form({ shares: "/srv:/mnt/srv" })
    eq(Model.validateForm(abs, rows, TEMPLATES, bad).errors, {})
    ok(Model.machineSnippet(abs, rows, TEMPLATES, bad), "absolute share still writes under a bad HOME")
    eq(Model.expandHome("/srv", bad), "/srv")
  }
})

test("the host side of a share rejects . and .. segments (#22)", () => {
  ok(errors({ shares: "~/../etc:/mnt/etc" }).shares)
  ok(errors({ shares: "/srv/../etc:/mnt/etc" }).shares)
  ok(errors({ shares: "/srv/./etc:/mnt/etc" }).shares)
  eq(errors({ shares: "/srv/a.b:/mnt/a" }), {})
})

test("emptyForm: strings and bools only, disposable by default", () => {
  const f = Model.emptyForm()
  eq(f.kind, "disposable")
  eq(Model.emptyForm("permanent").kind, "permanent")
  eq(Model.emptyForm("anything").kind, "disposable")
  ok(Object.keys(f).every(k => typeof f[k] === "boolean" || typeof f[k] === "string"))
  eq(errors({}, "disposable"), {})
  eq(errors({}), {})
})

test("name rules differ per kind, and a name in use is refused only on create", () => {
  ok(errors({ name: "" }).name)
  for (const bad of HOSTILE.concat(["1abc", "Abc", "a_b", "-x", "x".repeat(33)])) ok(errors({ name: bad }).name, JSON.stringify(bad))
  eq(errors({ name: "dev-box-2" }), {})
  for (const bad of HOSTILE.concat(["1abc", "-x", "x".repeat(65)])) ok(errors({ name: bad }, "disposable").name, JSON.stringify(bad))
  eq(errors({ name: "Dev_box" }, "disposable"), {})
  ok(errors({ name: "bob" }, "disposable").name)      // exists as a disposable VM
  eq(errors({ name: "bob" }), {})                       // but not as a permanent one
  ok(errors({ name: "p1" }).name)
  eq(Model.validateForm(Object.assign(form({ name: "p1" }), { editing: true }), rows, TEMPLATES, HOME).errors, {})
})

test("template must come from the parsed list", () => {
  for (const bad of ["", "nope", "$(id)", "Shell"]) ok(errors({ template: bad }).template, bad)
  eq(errors({ template: "python" }), {})
  eq(Model.templatesMatching(TEMPLATES, "py").map(t => t.name), ["python"])
  eq(Model.templatesMatching(TEMPLATES, "").length, 2)
})

test("memory, cores and port are bounded integers; the port may be empty", () => {
  for (const bad of ["", "0", "255", "131073", "4G", "1e3", "-1", "4096.0", "$(id)"]) ok(errors({ memory: bad }).memory, bad)
  ok(!errors({ memory: "9000" }).memory)
  ok(Model.validateForm(form({ memory: "9000" }), rows, TEMPLATES, HOME).warnings.memory)
  for (const bad of ["", "0", "65", "two"]) ok(errors({ cores: bad }).cores, bad)
  for (const bad of ["22", "80", "65536", "abc", "22 22"]) ok(errors({ sshPort: bad }).sshPort, bad)
  eq(errors({ sshPort: "" }), {})
  eq(errors({ sshPort: "2222", sshKey: KEY }), {})
  ok(Model.validateForm(form({ sshPort: "2222" }), rows, TEMPLATES, HOME).warnings.sshKey)
})

test("the SSH key keeps its type and blob, drops the comment, refuses the rest", () => {
  eq(Model.normalizeSshKey(KEY + " user@host\n"), KEY)
  eq(Model.normalizeSshKey("  " + KEY), KEY)
  eq(Model.normalizeSshKey("ecdsa-sha2-nistp256 AAAA== c"), "ecdsa-sha2-nistp256 AAAA==")
  for (const bad of HOSTILE.concat(["ssh-dss AAAA", "ssh-ed25519", "ssh-ed25519 AAA$A", 'ssh-ed25519 AAAA"; x = "y', "ssh-ed25519 AAAA====", "AAAA"])) {
    eq(Model.normalizeSshKey(bad), "", JSON.stringify(bad))
    ok(errors({ sshKey: bad }).sshKey, JSON.stringify(bad))
  }
  eq(errors({ sshKey: "" }), {})
})

test("shares: host:guest pairs, guest normalised, reserved paths refused", () => {
  for (const bad of HOSTILE.filter(s => s !== "a b" && s !== "a\nb")) {
    ok(errors({ shares: "/a:/" + bad }).shares, "guest " + JSON.stringify(bad))
    ok(errors({ shares: "/" + bad + ":/x" }).shares, "host " + JSON.stringify(bad))
  }
  for (const bad of ["/a", "/a:/b:/c", "relative:/x", "/a:relative", "/a:/x/../etc", "/a:/x/./y", "/a:/", "/a:/nix", "/a:/nix/store", "/a:/mnt/host", "/a:/mnt/host/"]) {
    ok(errors({ shares: bad }).shares, bad)
  }
  eq(errors({ shares: "~/src:/mnt/src  /srv:/mnt//srv/" }), {})
  eq(Model.parseShares("~/src:/mnt/src /srv:/mnt//srv/", HOME).shares, [
    { source: "/home/user/src", mountPoint: "/mnt/src" },
    { source: "/srv", mountPoint: "/mnt/srv" }
  ])
  eq(Model.normalizeGuestPath("/mnt//a/b/"), "/mnt/a/b")
  eq(Model.normalizeGuestPath("/"), "/")
  eq(Model.normalizeGuestPath("/a/../b"), null)
  ok(Model.validateForm(form({ shares: "~:/mnt/home" }), rows, TEMPLATES, HOME).warnings.shares === undefined)
  ok(Model.validateForm(form({ shares: HOME + ":/mnt/home" }), rows, TEMPLATES, HOME).warnings.shares)
})

test("share tags are the guest basename, unique, and never a built-in", () => {
  const tags = (list) => Model.shareTags(list.map(p => ({ source: "/h", mountPoint: p })))
  eq(tags(["/mnt/src", "/data/src", "/x/hostdir", "/y/ro-store", "/src"]), ["src", "src-2", "hostdir-2", "ro-store-2", "src-3"])
  eq(tags([]), [])
})

test("machineSnippet writes every field, defaults included, from validated values only", () => {
  eq(snippet({ template: "python", memory: "4096", cores: "2", sshPort: "2222", shares: "~/src:/mnt/src", sshKey: KEY + " me@here" }), SNIPPET.replace("/home/user/src", "/home/user/src"))
  eq(snippet({}), '{ template = "shell"; autostart = true; memory = 1024; cores = 1; sshPort = null; shares = [ ]; }')
  eq(snippet({ autostart: false, shares: "/a:/mnt/a /b:/mnt/a" }), '{ template = "shell"; autostart = false; memory = 1024; cores = 1; sshPort = null; shares = [ { source = "/a"; mountPoint = "/mnt/a"; tag = "a"; } { source = "/b"; mountPoint = "/mnt/a"; tag = "a-2"; } ]; }')
  eq(snippet({ name: "$(id)" }), null)
  eq(snippet({ shares: "/a:/nix" }), null)
  eq(Model.machineSnippet(form({}, "disposable"), rows, TEMPLATES, HOME), null)
  // No " \ or ${ can reach the line: every string in it comes from an allowlist.
  const line = snippet({ template: "python", memory: "4096", cores: "2", sshPort: "2222", shares: "~/src:/mnt/src", sshKey: KEY })
  ok(!/\\|\$\{/.test(line))
  eq((line.match(/"/g) || []).length % 2, 0)
})

test("parseMachineSnippet reads exactly what machineSnippet writes: parse(emit(f)) == f", () => {
  const f = form({ template: "python", memory: "4096", cores: "2", sshPort: "2222", shares: "/home/user/src:/mnt/src /srv:/mnt/srv", sshKey: KEY })
  const back = Model.parseMachineSnippet(Model.machineSnippet(f, rows, TEMPLATES, HOME))
  eq(back, { template: "python", autostart: true, memory: 4096, cores: 2, sshPort: 2222, sshKey: KEY, shares: "/home/user/src:/mnt/src /srv:/mnt/srv" })
  const again = Model.formFromRow(Object.assign({ kind: "permanent", name: "t1" }, back, { memory: String(back.memory), cores: String(back.cores), sshPort: String(back.sshPort) }))
  eq(Model.machineSnippet(again, rows, TEMPLATES, HOME), Model.machineSnippet(f, rows, TEMPLATES, HOME))
  eq(Model.parseMachineSnippet(snippet({})), { template: "shell", autostart: true, memory: 1024, cores: 1, sshPort: null, sshKey: "", shares: "" })
})

test("parseMachineSnippet refuses anything outside the grammar", () => {
  for (const bad of [
    "",
    "{ }",
    '{ template = "shell"; }',
    SNIPPET.replace("autostart = true;", ""),
    SNIPPET.replace("memory = 4096", "memory = 4096 * 2"),
    SNIPPET.replace("modules = [ {", "modules = [ ./mine.nix {"),
    SNIPPET.replace("/mnt/src", "/nix/store"),
    SNIPPET.replace("/mnt/src", "/mnt/../src"),
    SNIPPET.replace('tag = "src"', 'tag = "ro-store"'),
    SNIPPET.replace("AAAAC3NzaC1lZDI1NTE5AAAAIGtestkey", 'x" ]; boot.loader = "y'),
    SNIPPET + " # comment",
    SNIPPET.replace("cores = 2", "cores = 999")
  ]) eq(Model.parseMachineSnippet(bad), null, bad)
})

test("formFromRow fixes the name and carries the row's fields", () => {
  const row = Model.rowByName(rows, "permanent", "p1")
  const f = Model.formFromRow(row)
  eq([f.editing, f.kind, f.name, f.template, f.memory, f.cores, f.sshPort, f.sshKey, f.shares], [true, "permanent", "p1", "python", "4096", "2", "2222", KEY, "/home/user/src:/mnt/src"])
  const d = Model.formFromRow(Model.rowByName(rows, "disposable", "alice"))
  eq([d.editing, d.kind, d.name, d.template], [true, "disposable", "alice", "shell"])
})

test("visibleFields: kind and agent decide what the form shows", () => {
  const keys = (f, state) => Model.visibleFields(f, state).map(x => x.key)
  eq(keys(Model.emptyForm("disposable"), { agent: "claude", aiAssist: true }), ["describe", "kind", "name", "template"])
  eq(keys(Model.emptyForm("disposable"), { agent: "", aiAssist: true }), ["kind", "name", "template"])
  eq(keys(Model.emptyForm("permanent"), { agent: "claude", aiAssist: false }), ["kind", "name", "template", "autostart", "memory", "cores", "sshPort", "sshKey", "shares"])
  eq(keys(Model.formFromRow(Model.rowByName(rows, "disposable", "alice")), { agent: "claude", aiAssist: true }), ["template"])
  eq(keys(Model.formFromRow(Model.rowByName(rows, "permanent", "p1")), { agent: "claude", aiAssist: true }), ["template", "autostart", "memory", "cores", "sshPort", "sshKey", "shares"])
  for (const f of Model.FORM_FIELDS) ok(f.key in Model.emptyForm(), f.key)
})

test("firstErrorIndex and formSummary", () => {
  const fields = Model.visibleFields(Model.emptyForm("permanent"), {})
  eq(Model.firstErrorIndex(fields, { shares: "x", name: "y" }), fields.findIndex(f => f.key === "name"))
  eq(Model.firstErrorIndex(fields, { shares: "x" }), fields.findIndex(f => f.key === "shares"))
  eq(Model.firstErrorIndex(fields, {}), -1)
  eq(Model.formSummary(form()), "create t1 (permanent, shell)")
  eq(Model.formSummary(Model.formFromRow(Model.rowByName(rows, "disposable", "alice"))), "edit alice (disposable, shell)")
  eq(Model.optPath("p1"), "programs.nixarchy.services.microvm.machines.p1")
})

test("every ? sheet key label fits the key column (#9)", () => {
  for (const s of Model.SHORTCUTS) ok(s.keys.length <= 12, "too long for the key column: " + s.keys)
  const form = Model.SHORTCUTS.filter(s => s.group === "Form").map(s => s.keys + " = " + s.text)
  ok(form.includes("tab  ↓ = Next field"))
  ok(form.includes("shift+tab  ↑ = Previous field"))
})
