# Upstream dependencies

Two changes in other repositories make this plugin better. Both have shipped
(2026-09-19). Neither is required: every key they unlock stays hidden until the
feature is detected at runtime (`Model.detectFeatures`, `MicrovmState.qml`),
so an older install still works, with fewer keys.

| Repository | Issue | Unlocks here | On an older install |
| --- | --- | --- | --- |
| [olafkfreund/nixarchy](https://github.com/olafkfreund/nixarchy) | [#762 nixarchy vm: list/templates --json, run --detach, console, set-template](https://github.com/olafkfreund/nixarchy/issues/762), shipped 2026-09-19 | JSON listing; `s` streams the build into the panel; Enter attaches to a running disposable VM; `m` changes a disposable VM's template | the text output is parsed; Enter and `s` on a stopped VM open `nixarchy vm run` in a terminal ("start in terminal"); Enter is hidden on a running VM; `m` is hidden for disposable VMs |
| [olafkfreund/nixarchy-pkg](https://github.com/olafkfreund/nixarchy-pkg) | [#19 opt replace, and apply's stdin](https://github.com/olafkfreund/nixarchy-pkg/issues/19), shipped 2026-09-19 | `m` on a permanent VM (an atomic rewrite of its apps.nix line) | `m` is hidden for permanent VMs; delete and re-create instead |

Detection:

- `list --json` and `templates --json`: the output's first byte is `[`.
- `run --detach`, `console`, `set-template`: listed by `nixarchy-vm help`.
- `opt replace`: `nixarchy-pkg opt replace` with no arguments prints a usage
  error rather than "unknown action".
