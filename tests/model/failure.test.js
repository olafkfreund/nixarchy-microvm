const { test, eq, ok, Model } = require("../harness.js")

const PKG = "/home/user/.config/omarchy/plugins/nixarchy.pkg/bin/nixarchy-pkg"

test("commandName names the command a user would recognise (#23)", () => {
  eq(Model.commandName(["systemctl", "start", "microvm@p1.service"]), "systemctl")
  eq(Model.commandName(["/run/current-system/sw/bin/systemctl"]), "systemctl")
  // nixarchy.pkg's adapter is not on PATH and is run by its full store path.
  eq(Model.commandName([PKG, "opt", "set"]), "nixarchy-pkg")
  eq(Model.commandName(null), "")
  eq(Model.commandName([]), "")
})

test("processFailure says why, preferring the writer's own words (#23)", () => {
  // A command that never ran has no output to read, so reason carries it.
  eq(Model.processFailure({ verb: "creating", key: "p1", command: "nixarchy-service-enable", reason: "did not start" }),
    "creating p1: nixarchy-service-enable did not start")

  // A writer refusal at exit 0 is what the user did, so it wins.
  eq(Model.processFailure({ verb: "creating", key: "p1", code: 0, stdout: JSON.stringify({ ok: false, error: "p1 is already in apps.nix -- remove it first" }) }),
    "p1 is already in apps.nix -- remove it first")

  // Otherwise the last real error line from the output.
  eq(Model.processFailure({ verb: "creating", key: "p1", code: 1, stderr: "+ set -x\nerror: no such template\n" }),
    "no such template")

  // Nothing to read: name the verb, the subject and the code.
  eq(Model.processFailure({ verb: "creating", key: "p1", code: 3 }), "creating p1 failed (exit 3)")
  eq(Model.processFailure({ verb: "stopping", code: 1 }), "stopping failed (exit 1)")
  eq(Model.processFailure({}), "the command failed (exit ?)")
})

test("workingText offers the escape only when it is offered (#23)", () => {
  eq(Model.workingText({}), "working…")
  eq(Model.workingText({ verb: "creating" }), "working… creating")
  eq(Model.workingText({ verb: "creating", key: "p1" }), "working… creating p1")
  eq(Model.workingText({ verb: "creating", key: "p1", escapable: true }), "working… creating p1 — X gives up")
  ok(Model.workingText({ verb: "creating", key: "p1", escapable: false }).indexOf("X gives up") === -1)
})

test("staleList names the degraded reads, in a fixed order (#23)", () => {
  eq(Model.staleList({}), [])
  eq(Model.staleList(null), [])
  eq(Model.staleList({ units: true }), ["units"])
  eq(Model.staleList({ help: true, units: true, pending: true }), ["units", "pending", "help"])
  eq(Model.staleList({ pending: true, help: true }), ["pending", "help"])
})
