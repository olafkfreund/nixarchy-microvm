const { test, eq, ok, Model, TEMPLATES, LIST_JSON, UNITS_JSON, APPS_NIX, PENDING_JSON } = require("../harness.js")

const PKG = "/home/user/.config/omarchy/plugins/nixarchy.pkg/bin/nixarchy-pkg"
const rows = Model.rowsFor(Model.disposableRows(Model.parseVmList(LIST_JSON))
  .concat(Model.permanentRows(Model.parseUnits(UNITS_JSON), Model.parseMachineLines(APPS_NIX), Model.parsePending(PENDING_JSON))))
const row = (kind, name) => Model.rowByName(rows, kind, name)
const ALL = { upstreamOk: true, pkgScript: PKG }
const NONE = { upstreamOk: true, pkgScript: "" }
const verbs = (r, s) => Model.actionsFor(r, s).map(a => a.verb)

test("upstreamVerdict requires current nixarchy and current nixarchy-pkg when installed", () => {
  const today = "  nixarchy vm run <name>          Build (if needed) and attach -- Ctrl-A X to\n  nixarchy vm stop <name>\n"
  const later = today + "  nixarchy vm run [--detach] <name>\n  nixarchy vm console <name>\n  nixarchy vm set-template <name> <t>\n"
  const usage = "usage: nixarchy-pkg opt replace <path> <nix-value>"
  const needsVm = "This plugin needs nixarchy with nixarchy vm run --detach, console and set-template (nixarchy#762); update nixarchy"
  const needsPkg = "This plugin needs nixarchy-pkg opt replace (nixarchy-pkg#19); update nixarchy.pkg"
  eq(Model.upstreamVerdict(later, usage, true), "")
  eq(Model.upstreamVerdict(today, usage, true), needsVm)
  eq(Model.upstreamVerdict("", usage, true), needsVm)
  eq(Model.upstreamVerdict(later, "old pkg", true), needsPkg)
  eq(Model.upstreamVerdict(later, "old pkg", false), "")
})

test("optReplaceSupported: today's refusal is no, a usage line is yes", () => {
  ok(!Model.optReplaceSupported('{"ok":false,"error":"opt takes describe, set or remove, not \'replace\'"}'))
  ok(Model.optReplaceSupported('{"ok":false,"error":"usage: nixarchy-pkg opt replace <path> <nix-value>"}'))
  ok(!Model.optReplaceSupported(""))
  eq(Model.pkgScriptPath("/home/user/.config/"), PKG)
  eq(Model.pkgScriptPath(""), "")
})

test("every argv is a string array, or null on bad input", () => {
  const good = [
    Model.listArgv(), Model.templatesArgv(), Model.helpArgv(), Model.unitsArgv(), Model.defaultAgentArgv(),
    Model.serviceEnableArgv(), Model.applyTerminalArgv(), Model.pendingArgv(PKG), Model.optProbeArgv(PKG),
    Model.consoleArgv("a"), Model.runDetachArgv("a"), Model.stopVmArgv("a"), Model.rmVmArgv("a"),
    Model.createVmArgv("t1", "shell", TEMPLATES), Model.setTemplateArgv("a", "python", TEMPLATES),
    Model.unitArgv("start", "p1"), Model.logsArgv("p1"), Model.sshArgv("2222"),
    Model.optSetArgv(PKG, "p9", "{ }"), Model.optReplaceArgv(PKG, "p1", "{ }"), Model.optRemoveArgv("p1"), Model.copyArgv("a")
  ]
  for (const argv of good) {
    ok(Array.isArray(argv), JSON.stringify(argv))
    ok(argv.every(a => typeof a === "string" && a !== ""), JSON.stringify(argv))
  }
  for (const bad of ["", "a b", "$(id)", "-rf", "x;y", "../x", undefined]) {
    for (const fn of [Model.consoleArgv, Model.runDetachArgv, Model.stopVmArgv, Model.rmVmArgv, Model.logsArgv, Model.optRemoveArgv, Model.copyArgv]) {
      eq(fn(bad), null, fn.name + " " + JSON.stringify(bad))
    }
    eq(Model.unitArgv("start", bad), null)
    eq(Model.createVmArgv(bad, "shell", TEMPLATES), null)
  }
  eq(Model.unitArgv("kill", "p1"), null)
  eq(Model.unitArgv("start", "p1"), ["systemctl", "start", "microvm@p1.service"])
  eq(Model.createVmArgv("t1", "nope", TEMPLATES), null)
  eq(Model.createVmArgv("t_1", "shell", TEMPLATES), ["nixarchy-vm", "create", "t_1", "--template", "shell"])
  eq(Model.setTemplateArgv("a", "$(id)", TEMPLATES), null)
  for (const bad of ["", "22", "abc", "2222 2222"]) eq(Model.sshArgv(bad), null)
  eq(Model.optSetArgv(PKG, "P1", "{ }"), null)
  eq(Model.optSetArgv("", "p1", "{ }"), null)
  eq(Model.optSetArgv(PKG, "p1", ""), null)
  eq(Model.pendingArgv(""), null)
})

test("terminal commands go through omarchy-launch-tui with a fixed app id", () => {
  eq(Model.consoleArgv("a"), ["omarchy-launch-tui", "--app-id=org.omarchy.microvm-console", "nixarchy-vm", "console", "a"])
  eq(Model.logsArgv("p1"), ["omarchy-launch-tui", "--app-id=org.omarchy.microvm-logs", "journalctl", "-u", "microvm@p1", "-n", "200", "-f"])
  eq(Model.sshArgv("2222"), ["omarchy-launch-tui", "--app-id=org.omarchy.microvm-console", "ssh", "-p", "2222", "dev@localhost"])
  eq(Model.applyTerminalArgv(), ["omarchy-launch-floating-terminal-with-presentation", "nixarchy-apply"])
  eq(Model.runDetachArgv("a"), ["nixarchy-vm", "run", "--detach", "a"])
  eq(Model.optRemoveArgv("p1"), ["nixarchy-opt-remove", "programs.nixarchy.services.microvm.machines.p1"])
  eq(Model.optSetArgv(PKG, "p9", "{ x }"), [PKG, "opt", "set", "programs.nixarchy.services.microvm.machines.p9", "{ x }"])
})

test("sshArgv names the picked key's private half, and only a matching, safe .pub", () => {
  const K = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExampleKeyExampleKeyExampleKeyExampleK"
  const keys = [{ file: "id_ed25519.pub", key: "ssh-ed25519 AAAAOTHER" }, { file: "bbs_agent_ed25519.pub", key: K }]
  const head = ["omarchy-launch-tui", "--app-id=org.omarchy.microvm-console", "ssh", "-p", "2222"]
  eq(Model.sshArgv("2222", K + " me@host", keys, "/home/u/"),
    head.concat(["-i", "/home/u/.ssh/bbs_agent_ed25519", "-o", "IdentitiesOnly=yes", "dev@localhost"]))
  // No match, no scan, no home, or a file name that is not a plain .pub: ssh's defaults.
  eq(Model.sshArgv("2222", "ssh-ed25519 AAAANOPE", keys, "/home/u"), head.concat(["dev@localhost"]))
  eq(Model.sshArgv("2222", K, [], "/home/u"), head.concat(["dev@localhost"]))
  eq(Model.sshArgv("2222", K, keys, ""), head.concat(["dev@localhost"]))
  eq(Model.sshArgv("2222", K, [{ file: "../x.pub", key: K }], "/home/u"), head.concat(["dev@localhost"]))
})

test("submitArgvs: create is one command, a new permanent VM is the service row then its line", () => {
  const HOME = "/home/user"
  const d = Object.assign(Model.emptyForm("disposable"), { name: "t1", template: "python" })
  eq(Model.submitArgvs(d, rows, TEMPLATES, HOME, NONE), [["nixarchy-vm", "create", "t1", "--template", "python"]])
  const p = Object.assign(Model.emptyForm("permanent"), { name: "p9" })
  const argvs = Model.submitArgvs(p, rows, TEMPLATES, HOME, ALL)
  eq(argvs[0], ["nixarchy-service-enable", "microvm"])
  eq(argvs[1].slice(0, 4), [PKG, "opt", "set", "programs.nixarchy.services.microvm.machines.p9"])
  eq(argvs[1][4], Model.machineSnippet(p, rows, TEMPLATES, HOME))
  eq(Model.submitArgvs(p, rows, TEMPLATES, HOME, { upstreamOk: true }), null)    // no nixarchy.pkg
  eq(Model.submitArgvs(Object.assign({}, p, { name: "$(id)" }), rows, TEMPLATES, HOME, ALL), null)
  eq(Model.submitArgvs(d, rows, TEMPLATES, HOME, {}), null)                       // upstream still being checked
})

test("submitArgvs: edits need the upstream verdict and pkg for permanent VMs", () => {
  const HOME = "/home/user"
  const pe = Object.assign(Model.formFromRow(row("permanent", "p1")), { memory: "2048" })
  eq(Model.submitArgvs(pe, rows, TEMPLATES, HOME, NONE), null)
  const replace = Model.submitArgvs(pe, rows, TEMPLATES, HOME, ALL)
  eq(replace.length, 1)
  eq(replace[0].slice(0, 4), [PKG, "opt", "replace", "programs.nixarchy.services.microvm.machines.p1"])
  ok(replace[0][4].indexOf("memory = 2048;") !== -1)
  const de = Object.assign(Model.formFromRow(row("disposable", "alice")), { template: "python" })
  eq(Model.submitArgvs(de, rows, TEMPLATES, HOME, NONE), [["nixarchy-vm", "set-template", "alice", "python"]])
  eq(Model.submitArgvs(de, rows, TEMPLATES, HOME, ALL), [["nixarchy-vm", "set-template", "alice", "python"]])
})

test("actionsFor, disposable: running has console; stopped has start and edit", () => {
  const stopped = row("disposable", "alice"), running = row("disposable", "bob")
  eq(verbs(stopped, NONE), ["start", "edit", "remove", "copy"])
  eq(Model.verbForKey(stopped, NONE, "enter"), null)
  eq(Model.verbForKey(stopped, NONE, "s"), "start")
  eq(verbs(running, NONE), ["console", "stop", "remove", "copy"])
  eq(Model.verbForKey(running, NONE, "enter"), "console")
  eq(verbs(stopped, ALL), ["start", "edit", "remove", "copy"])
  eq(Model.verbForKey(stopped, ALL, "enter"), null)
  eq(verbs(running, ALL), ["console", "stop", "remove", "copy"])
  eq(verbs(stopped, {}), ["copy"])
  eq(verbs(running, { upstreamOk: false, upstreamError: "update nixarchy" }), ["copy"])
  eq(Model.verbForKey(stopped, {}, "s"), null)
})

test("actionsFor, permanent: ownership and the unit decide", () => {
  const p1 = row("permanent", "p1"), p2 = row("permanent", "p2"), p3 = row("permanent", "p3"), p4 = row("permanent", "p4")
  const appliedP1 = Object.assign({}, p1, { pending: false })
  eq(verbs(appliedP1, ALL), ["console", "restart", "stop", "logs", "edit", "remove", "copy"])   // managed, running, port and key
  eq(verbs(appliedP1, NONE), ["console", "restart", "stop", "logs", "remove", "copy"])           // no nixarchy.pkg: no edit
  eq(verbs(appliedP1, { upstreamOk: true }), ["console", "restart", "stop", "logs", "remove", "copy"])
  eq(verbs(p2, ALL), ["start", "logs", "copy"])                                           // flake, failed
  eq(verbs(p3, ALL), ["start", "logs", "copy"])                                           // flake, stopped
  eq(verbs(p4, ALL), ["copy"])                                                            // managed-unsupported, not built
  const noKey = Object.assign({}, p1, { sshKey: "" })
  eq(Model.verbForKey(noKey, ALL, "enter"), null)
  eq(Model.hiddenReason(noKey, ALL, "console"), "set an SSH port and key to get a console")
  eq(Model.hiddenReason(p2, ALL, "edit"), "declared in your flake; edit it there")
  eq(Model.hiddenReason(p4, ALL, "remove"), "this line was edited by hand; edit it in apps.nix")
  eq(Model.hiddenReason(p1, NONE, "edit"), "permanent VMs need the nixarchy.pkg plugin")
  eq(Model.hiddenReason(row("disposable", "bob"), NONE, "console"), "")
  eq(Model.hiddenReason(p1, { upstreamOk: false, upstreamError: "update nixarchy" }, "edit"), "update nixarchy")
  eq(Model.hiddenReason(p1, {}, "edit"), "checking nixarchy…")
  eq(Model.actionsFor(null, ALL), [])
})

test("the lock disables mutations and nothing else", () => {
  const locked = Model.actionsFor(Object.assign({}, row("permanent", "p1"), { pending: false }), Object.assign({ mutating: true }, ALL))
  eq(locked.filter(a => a.enabled).map(a => a.verb), ["console", "logs", "copy"])
  const d = Model.actionsFor(row("disposable", "alice"), Object.assign({ mutating: true }, NONE))
  eq(d.filter(a => a.enabled).map(a => a.verb), ["copy"])
  eq(Model.actionFor(row("disposable", "alice"), NONE, "remove").danger, true)
})

test("a queued permanent change hides the console until pending state is current", () => {
  const applied = Object.assign({}, row("permanent", "p1"), { pending: false })
  const pending = Object.assign({}, applied, { pending: true })
  eq(Model.verbForKey(pending, ALL, "enter"), null)
  eq(Model.hiddenReason(pending, ALL, "console"), "apply the queued change first")
  eq(Model.verbForKey(applied, Object.assign({}, ALL, { pendingSync: true }), "enter"), null)
  eq(Model.hiddenReason(applied, { upstreamOk: true, pendingSync: true }, "console"), "apply the queued change first")
  eq(Model.verbForKey(applied, ALL, "enter"), "console")
  eq(Model.hiddenReason(applied, ALL, "console"), "")
})

test("pendingName reads the name after the row kind", () => {
  eq(Model.pendingName("permanent:p1"), "p1")
  eq(Model.pendingName("disposable:1box"), "1box")
  eq(Model.pendingName("p1"), "")
  eq(Model.pendingName(""), "")
})

test("listActions and removeMessage", () => {
  eq(Model.listActions({ upstreamOk: true, agent: "claude", pkgScript: PKG }, { pending: 1 }), { create: true, assist: true, apply: true })
  eq(Model.listActions({ upstreamOk: true, agent: "claude", aiAssist: false, pkgScript: PKG }, { pending: 0 }), { create: true, assist: false, apply: false })
  eq(Model.listActions({ upstreamOk: true, agent: "", pkgScript: PKG, serviceQueued: true }, {}), { create: true, assist: false, apply: true })
  eq(Model.listActions({ upstreamOk: true, agent: "claude" }, { pending: 3 }).apply, false)
  eq(Model.listActions({ agent: "claude", pkgScript: PKG, serviceQueued: true }, { pending: 1 }), { create: false, assist: false, apply: false })
  eq(Model.removeMessage(row("disposable", "alice"), "/home/user/.local/state/nixarchy/microvm/"),
    "Delete alice and everything in /home/user/.local/state/nixarchy/microvm/alice? Stop it first if it is running.")
  ok(Model.removeMessage(row("permanent", "p1"), "").indexOf("/var/lib/microvms/p1 stay until you apply") !== -1)
})

test("buttonsFor shows one button per verb", () => {
  const stopped = row("disposable", "alice")
  eq(Model.buttonsFor(stopped, NONE).map(a => a.verb), ["start", "edit", "remove", "copy"])
  eq(Model.buttonsFor(Object.assign({}, row("permanent", "p1"), { pending: false }), ALL).map(a => a.verb), ["console", "restart", "stop", "logs", "edit", "remove", "copy"])
})

// razer's services.nix (2026-09-01): a header, the module, no microvm row.
const SERVICES_OLD = "# Services and system settings, as NixOS configuration.\n{ ... }:\n{\n    # services.flatpak.enable = true;  #@ flatpak  # For software nixpkgs does not carry.\n}\n"
const ROW = "    # programs.nixarchy.services.microvm.enable = true;  #@ microvm  # Permanent NixOS sandboxes"

test("servicesHasMicrovm reads the marker nixarchy-service-enable greps for (#6)", () => {
  eq(Model.servicesHasMicrovm(SERVICES_OLD), false)
  eq(Model.servicesHasMicrovm(SERVICES_OLD.replace("{\n", "{\n" + ROW + "\n")), true)
  eq(Model.servicesHasMicrovm(ROW.replace("# programs", "programs")), true)
  eq(Model.servicesHasMicrovm("#@ microvmx"), false)
  eq(Model.servicesHasMicrovm(""), false)
})

test("serviceEnableHeals: today's reply no, the usage nixarchy#843 asks for yes (#6)", () => {
  eq(Model.serviceEnableHeals("nixarchy: no service '--help' in /home/u/.config/nixarchy/services.nix\n  The full list is /etc/nixarchy/services-template.nix.\n"), false)
  eq(Model.serviceEnableHeals("usage: nixarchy-service-enable <service-id>\n  A row missing from services.nix is added from /etc/nixarchy/services-template.nix.\n"), true)
  eq(Model.serviceEnableHeals("usage: nixarchy-service-enable <service-id>\n"), false)
  eq(Model.serviceHelpArgv(), ["nixarchy-service-enable", "--help"])
})

test("permanentBlocked: a new permanent VM waits for the services row (#6)", () => {
  const HOME = "/home/user"
  const p = Object.assign(Model.emptyForm("permanent"), { name: "p9" })
  const d = Object.assign(Model.emptyForm("disposable"), { name: "t1", template: "python" })
  const pe = Object.assign(Model.formFromRow(row("permanent", "p1")), { memory: "2048" })
  const missing = Object.assign({}, NONE, { servicesRow: false })
  ok(/services\.nix predates the microvm row/.test(Model.permanentBlocked(p, missing)))
  ok(/#@ microvm/.test(Model.permanentBlocked(p, missing)))
  eq(Model.permanentBlocked(p, Object.assign({}, NONE, { servicesRow: true })), "")
  eq(Model.permanentBlocked(p, NONE), "")              // not known yet: as before
  eq(Model.permanentBlocked(d, missing), "")
  eq(Model.permanentBlocked(pe, Object.assign({}, ALL, { servicesRow: false })), "")   // an edit needs no row
  eq(Model.submitArgvs(p, rows, TEMPLATES, HOME, missing), null)
  ok(Model.submitArgvs(pe, rows, TEMPLATES, HOME, Object.assign({}, ALL, { servicesRow: false })))
})

test("reviewCommandLines shows the whole command (#25)", () => {
  const SNIP = '{ template = "shell"; autostart = false; memory = 1024; cores = 1; sshPort = null; shares = [ ]; }'
  const OPT = "programs.nixarchy.services.microvm.machines.p1"
  const argvs = [
    ["nixarchy-service-enable", "microvm"],
    ["/nix/store/abc/nixarchy.pkg/bin/nixarchy-pkg", "opt", "set", OPT, SNIP]
  ]
  const lines = Model.reviewCommandLines(argvs, SNIP)
  eq(lines.length, 2)

  // Nothing is truncated: every input token survives whole, or is deliberately
  // replaced. This is the assertion the old slice(0, 4) would have failed.
  for (const token of argvs[0]) ok(lines[0].indexOf(token) !== -1, token)
  ok(lines[1].indexOf(OPT) !== -1, "the attribute path is shown in full")

  // The adapter is named for what it is, not by its store path.
  ok(lines[1].indexOf("nixarchy-pkg opt set") === 0)
  ok(lines[1].indexOf("/nix/store") === -1)

  // The snippet is referenced, not repeated: the review prints it above.
  ok(lines[1].indexOf("‹the line above›") !== -1)
  ok(lines[1].indexOf("template =") === -1)

  eq(Model.reviewCommandLines([], SNIP), [])
  eq(Model.reviewCommandLines(null, ""), [])
})

test("one name rule for every apps.nix writer (#38)", () => {
  const PKG = "/home/user/.config/omarchy/plugins/nixarchy.pkg/bin/nixarchy-pkg"
  const SNIP = '{ template = "shell"; }'

  // A leading digit is the real defect: `{ 9x = 1; }` is a Nix syntax error,
  // so a writer must never emit it.
  ok(!Model.isNixAttrName("9x"))
  eq(Model.optRemoveArgv("9x"), null)
  eq(Model.optReplaceArgv(PKG, "9x", SNIP), null)

  // a_b is NOT a defect — it is valid unquoted Nix, and a machine called that
  // in someone's apps.nix must stay removable. The issue originally said
  // otherwise; a predicate built from it would have orphaned exactly the rows
  // it was meant to protect.
  ok(Model.isNixAttrName("a_b"))
  ok(Model.isNixAttrName("_module"))
  ok(Model.optRemoveArgv("a_b"))
  ok(Model.optReplaceArgv(PKG, "a_b", SNIP))

  // isVmName, the creation rule, stays strictly inside it.
  ok(Model.isNixAttrName("p1") && Model.isVmName("p1", "permanent"))
  ok(Model.isNixAttrName("P1") && !Model.isVmName("P1", "permanent"))
  eq(Model.optSetArgv(PKG, "P1", SNIP), null)

  // Neither writer accepts what is not a name at all.
  for (const bad of ["", "a.b", "a b", "a/b", "-x", "a'b"]) {
    ok(!Model.isNixAttrName(bad), bad)
    eq(Model.optRemoveArgv(bad), null)
  }
})
