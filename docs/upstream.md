# Upstream dependencies

Three changes in other repositories make this plugin better. The first two
shipped on 2026-09-19; #843 is open. None is required: every key they unlock stays hidden until the
feature is detected at runtime (`Model.detectFeatures`, `MicrovmState.qml`),
so an older install still works, with fewer keys.

| Repository | Issue | Unlocks here | On an older install |
| --- | --- | --- | --- |
| [olafkfreund/nixarchy](https://github.com/olafkfreund/nixarchy) | [#762 nixarchy vm: list/templates --json, run --detach, console, set-template](https://github.com/olafkfreund/nixarchy/issues/762), shipped 2026-09-19 | JSON listing; `s` streams the build into the panel; Enter attaches to a running disposable VM; `m` changes a disposable VM's template | the text output is parsed; Enter and `s` on a stopped VM open `nixarchy vm run` in a terminal ("start in terminal"); Enter is hidden on a running VM; `m` is hidden for disposable VMs |
| [olafkfreund/nixarchy-pkg](https://github.com/olafkfreund/nixarchy-pkg) | [#19 opt replace, and apply's stdin](https://github.com/olafkfreund/nixarchy-pkg/issues/19), shipped 2026-09-19 | `m` on a permanent VM (an atomic rewrite of its apps.nix line) | `m` is hidden for permanent VMs; delete and re-create instead |
| [olafkfreund/nixarchy](https://github.com/olafkfreund/nixarchy) | [#843 nixarchy-service-enable: add a missing row from the template](https://github.com/olafkfreund/nixarchy/issues/843), open | a permanent VM can be created on a `services.nix` older than the `#@ microvm` row | the form warns under Kind with the line to copy, and Enter stays on the form |

Detection:

- `list --json` and `templates --json`: the output's first byte is `[`.
- `run --detach`, `console`, `set-template`: listed by `nixarchy-vm help`.
- `opt replace`: `nixarchy-pkg opt replace` with no arguments prints a usage
  error rather than "unknown action".
- `nixarchy-service-enable --help` (#843): the reply has `usage: nixarchy-service-enable` and mentions a missing row.
