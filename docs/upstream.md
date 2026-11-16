# Upstream dependencies

The first two shipped on 2026-09-19 and are required (`Model.upstreamVerdict`, `MicrovmState.qml`). Until the startup probes finish, every action is absent (`"checking nixarchy…"`). On an older host, the plugin shows one message naming what to update and hides every action except copying a row's name. #843 is open and detected at runtime.

| Repository | Issue | Role here | On an older install |
| --- | --- | --- | --- |
| [olafkfreund/nixarchy](https://github.com/olafkfreund/nixarchy) | [#762 nixarchy vm: list/templates --json, run --detach, console, set-template](https://github.com/olafkfreund/nixarchy/issues/762), shipped 2026-09-19 | **Required.** JSON listing; `s` and create-and-start stream the build into the panel; Enter attaches to a running disposable VM; `m` changes a disposable VM's template | Disposable rows are not read, actions are refused, and the plugin says: `This plugin needs nixarchy with nixarchy vm run --detach, console and set-template (nixarchy#762); update nixarchy` |
| [olafkfreund/nixarchy-pkg](https://github.com/olafkfreund/nixarchy-pkg) | [#19 opt replace, and apply's stdin](https://github.com/olafkfreund/nixarchy-pkg/issues/19), shipped 2026-09-19 | **Required when nixarchy.pkg is installed.** `m` on a permanent VM (an atomic rewrite of its apps.nix line) | Actions are refused and the plugin says: `This plugin needs nixarchy-pkg opt replace (nixarchy-pkg#19); update nixarchy.pkg` (without nixarchy.pkg installed, disposable VMs still work) |
| [olafkfreund/nixarchy](https://github.com/olafkfreund/nixarchy) | [#843 nixarchy-service-enable: add a missing row from the template](https://github.com/olafkfreund/nixarchy/issues/843), open | **Optional.** A permanent VM can be created on a `services.nix` older than the `#@ microvm` row | The form warns under Kind with the line to copy, and Enter stays on the form |

Probes:

- `list --json` and `templates --json`: must return a JSON array (first byte `[`); non-JSON output on exit 0 also triggers the nixarchy#762 message.
- `run --detach`, `console`, `set-template`: listed by `nixarchy-vm help`.
- `opt replace`: when nixarchy.pkg is present, `nixarchy-pkg opt replace` with no arguments prints a usage line rather than an unknown-action error.
- `nixarchy-service-enable --help` (#843): the reply has `usage: nixarchy-service-enable` and mentions a missing row.
