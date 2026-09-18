const fs = require("fs")
const path = require("path")
const vm = require("vm")
const assert = require("assert")

function load(file) {
  const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8")
    .replace(/^\s*\.pragma\s+library\s*$/m, "")

  const before = new Set(Object.getOwnPropertyNames(globalThis))
  vm.runInThisContext(source, { filename: file })

  const namespace = {}
  for (const name of Object.getOwnPropertyNames(globalThis)) {
    if (!before.has(name)) namespace[name] = globalThis[name]
  }
  return namespace
}

const Model = load("Model.js")

let passed = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    passed += 1
  } catch (error) {
    failures.push({ name: name, error: error })
  }
}

function report() {
  for (const failure of failures) {
    console.error("FAIL  " + failure.name)
    console.error("      " + String(failure.error.message).split("\n").join("\n      "))
  }
  console.log(`${passed} passed, ${failures.length} failed`)
  return failures.length === 0 ? 0 : 1
}

// `nixarchy vm list` today (pkgs/microvm.nix): aligned text, one VM per line.
const LIST_TEXT = "VMs:\n  alice            template=shell      stopped\n  bob              template=python     running\n"
// The same two VMs once nixarchy#762 lands.
const LIST_JSON = JSON.stringify([
  { name: "alice", template: "shell", running: false, dir: "/home/user/.local/state/nixarchy/microvm/alice" },
  { name: "bob", template: "python", running: true, dir: "/home/user/.local/state/nixarchy/microvm/bob" }
])

const TEMPLATES_TEXT = "Templates:\n" +
  "  shell      Shell\n" +
  "               A bare NixOS shell with nothing added -- the fastest way to a throwaway prompt.\n" +
  "  python     Python\n" +
  "               python3 and uv, 3 GiB of RAM.\n"
const TEMPLATES_JSON = JSON.stringify([
  { name: "shell", label: "Shell", note: "A bare NixOS shell with nothing added -- the fastest way to a throwaway prompt." },
  { name: "python", label: "Python", note: "python3 and uv, 3 GiB of RAM." }
])
const TEMPLATES = Model.parseTemplates(TEMPLATES_JSON)

// `systemctl list-units 'microvm@*' --all --plain --no-legend --output=json`.
function unit(name, active, sub) {
  return { unit: "microvm@" + name + ".service", load: "loaded", active: active, sub: sub, description: "MicroVM '" + name + "'" }
}
const UNITS_JSON = JSON.stringify([unit("p1", "active", "running"), unit("p2", "failed", "failed"), unit("p3", "inactive", "dead")])

// A line nixarchy.pkg's `opt set` wrote, and the ones this plugin must not touch.
const PATH = "programs.nixarchy.services.microvm.machines."
const SNIPPET = '{ template = "python"; autostart = true; memory = 4096; cores = 2; sshPort = 2222; shares = [ { source = "/home/user/src"; mountPoint = "/mnt/src"; tag = "src"; } ]; modules = [ { users.users.dev.openssh.authorizedKeys.keys = [ "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGtestkey" ]; } ]; }'
const APPS_NIX = "{ pkgs, ... }:\n{\n  programs.nixarchy.apps = {\n  };\n\n" +
  "  " + PATH + "p1 = " + SNIPPET + ";  #@opt " + PATH + "p1\n" +
  "  " + PATH + "p4 = { template = \"shell\"; modules = [ ./mine.nix ]; };  #@opt " + PATH + "p4\n" +
  "  # " + PATH + "p5 = { template = \"shell\"; };  #@opt " + PATH + "p5\n" +
  "  " + PATH + "p6 = { template = \"shell\"; };  #@opt " + PATH + "p7\n" +
  "}\n"

const PENDING_JSON = JSON.stringify({
  ok: true, neverApplied: false, base: "/etc/nixos/hosts/p620", count: 2,
  changes: [
    { marker: "opt:" + PATH + "p1", file: "apps", line: "…", change: "added" },
    { marker: ":microvm", file: "services", line: "…", change: "on" }
  ]
})

module.exports = {
  test: test,
  eq: assert.deepStrictEqual,
  ok: assert.ok,
  report: report,
  Model: Model,
  LIST_TEXT, LIST_JSON, TEMPLATES_TEXT, TEMPLATES_JSON, TEMPLATES,
  unit, UNITS_JSON, PATH, SNIPPET, APPS_NIX, PENDING_JSON
}
