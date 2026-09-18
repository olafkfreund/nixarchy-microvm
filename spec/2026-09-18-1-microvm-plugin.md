---
status: approved
issue: 1
intent: intent/2026-09-18-1-microvm-plugin.md
---
# Spec: Keyboard-driven MicroVM plugin for Omarchy (bar widget and menu)

## Design

### 0. Decisions taken from the intent's open questions

The owner approved the intent with every proposal, then refined it in
review:

1. **Permanent VMs in v1.** Listed and controlled through `systemctl`
   (polkit prompt). Create, edit and delete go through the user's
   `apps.nix` with nixarchy.pkg's writers, and apply is nixarchy's own
   `nixarchy-apply` in a terminal (§6).
2. **Upstream changes** are two small PRs (§11): nixarchy (`nixarchy vm`
   JSON, detach, console, set-template) and nixarchy-pkg (`opt replace`,
   an apply fix). The plugin feature-detects each and works without them.
3. **Editing a disposable VM** means changing its template, through
   `nixarchy vm set-template`. Rename and per-VM memory/cores are follow-ups.
4. **AI assist** is one non-interactive `claude` call that returns strict
   JSON and can use no tools. It pre-fills the form; the form validates; the
   user confirms. Other agents are hidden with a hint until a verified
   no-tools mode exists for them.
5. **Key bind: `SUPER + ALT + V`** (§9).
6. **Pages ship in this PR** under `docs/`, cut to a few captures (§10).

### 1. Facts this design rests on

Checked on this host (nixarchy at the current checkout, Omarchy 4.0.4,
systemd 261, claude 2.1.x):

- **`nixarchy-vm`** (`pkgs/microvm.nix`): `list` prints
  `  %-16s template=%-10s running|stopped`; running means a `flock -n` on
  `<dir>/.lock` failed, and the lock is held for the whole of `run`,
  **build included**. `templates` prints `  name  label` and an indented
  note line. `run` is `nix build --out-link <dir>/current` then
  `exec ./current/bin/microvm-run` in the foreground: leaving the terminal
  ends qemu. Extra args to `list` are ignored, so `list --json` prints text
  today. Names are `[a-zA-Z0-9_-]+`. State is
  `${XDG_STATE_HOME:-~/.local/state}/nixarchy/microvm/<name>/`.
- **Permanent machines** (`modules/services/microvm.nix`): each
  `programs.nixarchy.services.microvm.machines.<name>` is a `microvm@<name>`
  system unit (`User = microvm`, `SyslogIdentifier = microvm@<name>`),
  wanted by `microvms.target` when `autostart`. Fields: `template` (enum
  from `data/microvm-templates.nix`: shell, python, podman, agent,
  persistent), `autostart` (true), `sshPort` (null), `memory` (1024),
  `cores` (1), `shares` (`{source, mountPoint, tag}`, tag defaults to the
  mount point's basename), `modules`. `modules/microvm/guest.nix` already
  uses tags `ro-store` and `hostdir` and mounts `/nix/.ro-store` and
  `/mnt/host`. sshd is on only with `sshPort`; the guest user `dev` has no
  password, so SSH needs `users.users.dev.openssh.authorizedKeys.keys`.
  The service row is `#@ microvm` in `~/.config/nixarchy/services.nix`.
  With the service on and no machine declared, the module is inert.
- **nixarchy.pkg's writers** (`bin/nixarchy-pkg`, resolved next to
  `PkgModel.qml`, installed at
  `~/.config/omarchy/plugins/nixarchy.pkg/bin/nixarchy-pkg`, not on `PATH`):
  - `opt set <path> <value>` writes one line
    `  <path> = <value>;  #@opt <path>` into
    `${XDG_CONFIG_HOME:-~/.config}/nixarchy/apps.nix`, refuses an existing
    path, parse-checks with `nix-instantiate --parse` and reverts on
    failure. It backs the file up **after** `nixarchy-opt-remove` would
    have run, so remove-then-set is not atomic (`:457`).
  - `nixarchy-opt-remove <path>` and `nixarchy-service-enable <id>` are on
    `PATH`; the latter is a no-op when the row is already on.
  - `pending` prints `{ok, neverApplied, count, changes:[{marker, file,
    line, change}]}` by diffing live marked lines against the flake's copy;
    an option line's marker is `opt:<path>`, a service row's is `:<id>`.
  - `apply` pipes `n\ny` into `nixarchy-apply` and always exits 0 with a
    JSON line. `nixarchy-apply:193` only asks the preview question when
    `nixarchy-preview` exists, so without it the `n` answers "Build and
    switch now?" and nothing is applied. Not usable from here.
- **Agents.** `omarchy-default-agent` prints the id from
  `~/.config/omarchy/defaults/agent` (here `claude`) or nothing. `claude -p`
  has `--output-format json`, `--json-schema`, `--restricted` (removes
  every code-running tool and WebFetch, ignores user settings; its help says
  add `--strict-mcp-config` to skip MCP servers too) and `--tools ""`.
  `codex exec --sandbox read-only` still executes commands. No other agent
  has both a schema flag and a no-tools mode.
- **Keys.** `hyprctl binds -j`, modmask 72 (SUPER+ALT): A B F G H K N P Q
  S, RETURN SPACE TAB SLASH comma Home, arrows. `V` is bound only as
  SUPER+V, SUPER+SHIFT+V, SUPER+CTRL+V. Omarchy's defaults
  (`default/hypr/bindings/`) use SUPER+ALT with F G H K S and non-letters.
- **Journal.** `wheel` reads system units' logs through systemd's default
  ACL.
- **Siblings.** nixarchy-distrobox's singleton, op lock, queued follow-ups,
  stream log, form, `Model.SHORTCUTS`, flake checks and CI are the pattern;
  its spec §3-§8 apply unless this spec says otherwise. Its
  `CreateForm.qml:328` sets a text field's `text` only on creation, so a
  programmatic fill must rebind (§7).

### 2. Repository layout

| File | Origin | Role |
|---|---|---|
| `manifest.json` | distrobox shape | Identity, entry points, settings (§3) |
| `qmldir` | distrobox | `singleton MicrovmState 1.0 MicrovmState.qml` |
| `Model.js` | distrobox skeleton | All logic, `.pragma library`, Node-tested (§8) |
| `schema.json` | new | The JSON Schema handed to the agent; loaded at runtime and by the tests. The one copy |
| `MicrovmState.qml` | `DistroboxState.qml` | Singleton: processes, timers, lock, log, agent call, feature flags |
| `MicrovmView.qml` | `DistroboxView.qml` | Modes, keys, header, footer, review screen |
| `VmList.qml` | `BoxList.qml` | Rows with a kind badge |
| `CreateForm.qml` | distrobox `CreateForm.qml` | Create and edit, both kinds, describe field |
| `LogView.qml`, `ShortcutSheet.qml` | distrobox, verbatim | Stream log, `?` sheet |
| `Menu.qml`, `Panel.qml` | distrobox, names changed | Namespace `nixarchy-microvm-menu`, IPC `nixarchy.microvm.bar` |
| `share/omarchy-menu.jsonc` | distrobox shape | Row `apps.microvm` (§9) |
| `flake.nix`, `flake.lock`, `.github/workflows/{ci,pages}.yml` | distrobox | Package, checks, Pages |
| `tests/` | distrobox harness | Node tests |
| `docs/` | distrobox #3 | `usage.md` and the site (§10) |
| `README.md`, `AGENTS.md`, `CLAUDE.md` (`@AGENTS.md`), `.github/copilot-instructions.md` | distrobox shape | Docs and agent rules |

### 3. Manifest

`id: nixarchy.microvm`, `schemaVersion: 1`, `kinds: ["menu","bar-widget"]`,
`entryPoints: { menu: Menu.qml, barWidget: Panel.qml }`, `keepLoaded: true`,
`barWidget.category: System`, `defaultSection: right`. Settings:

| Key | Type | Default | Meaning |
|---|---|---|---|
| `refreshIntervalSec` | integer 5-600, step 5 | 30 | Bar poll; an open view polls every 3 s |
| `showStopped` | boolean | true | Off hides stopped VMs |
| `hideWhenEmpty` | boolean | false | Hides the glyph while there are no VMs |
| `aiAssist` | boolean | true | Off hides the describe field and `i` even with a supported agent |

### 4. The row model: three axes, two readers

```
{ kind: "disposable"|"permanent", name, template,
  runtime:   "running"|"stopped"|"failed"|"none",
  ownership: "state"|"managed"|"managed-unsupported"|"flake",
  pending:   bool,
  sshPort, sshKey, memory, cores, autostart, shares }
```

- **Runtime** is what the system reports. Disposable: `nixarchy-vm list`
  (`--json` when the output starts with `[`, else the text format; running
  = lock held, which includes a build in progress). Permanent:
  `systemctl list-units 'microvm@*' --all --plain --no-legend --output=json`
  (`active` → running, `failed` → failed, else stopped); a managed machine
  with no unit yet is `none`.
- **Ownership** is who may edit. Disposable rows are `state`. Permanent
  rows come from `apps.nix` read through a watched `FileView`: a line is
  **managed** when it is an uncommented assignment whose left-hand path
  equals its `#@opt programs.nixarchy.services.microvm.machines.<name>`
  marker and whose value parses under the §6 grammar; it is
  **managed-unsupported** when the marker matches but the value does not
  (a hand-added `modules`, say): shown, read-only here, hint "edit it in
  apps.nix". A unit with no such line is **flake**: controllable, not
  editable. Union by name.
- **Pending** comes from nixarchy-pkg's own answer, never inferred:
  `<pkg> pending` once per poll while the view is open; a row is pending
  when `changes` has marker `opt:<its path>`, and the header shows "service
  queued" when `:microvm` is in there. Without the nixarchy.pkg script there
  is no pending badge.
- `mergeRows` orders running, failed, pending, then by name. `counts` gives
  `{running, total, failing, pending}`. Filtering matches name, template and
  kind. Templates (`nixarchy-vm templates`, JSON or text) and the agent id
  are read once per open. Every path honours `XDG_STATE_HOME` and
  `XDG_CONFIG_HOME`; `dir` from JSON is display-only.
- Known limit: a flake machine that is neither autostart nor running is not
  loaded by systemd and is not listed. `/var/lib/microvms` is not read.

### 5. Keys per action per kind

`PanelKeyCatcher` built-ins and `textKey` as in distrobox.
`Model.actionsFor(row, state)` is the one source for keys, row buttons and
the `?` sheet, so a key that does not apply to the cursor row is absent, not
greyed. `state` carries the feature flags `vmJson`, `vmDetach`, `vmConsole`,
`vmSetTemplate`, `pkgScript`, `optReplace`, `agent`.

| Key | Disposable | Permanent |
|---|---|---|
| Enter, `e` | With `vmConsole`: `omarchy-launch-tui --app-id=org.omarchy.microvm-console nixarchy-vm console <name>` on a running VM. Without it, and only on a stopped VM: **"start in terminal"** (§5.1). Hidden on a running VM without `vmConsole` | `omarchy-launch-tui … ssh -p <sshPort> dev@localhost`, only when the managed row has both `sshPort` and `sshKey`; otherwise hidden with hint "set an SSH port and key to get a console" |
| `s` | Stopped: with `vmDetach`, stream `nixarchy-vm run --detach <name>` (build log in the panel); without it, "start in terminal". Running: action `nixarchy-vm stop <name>` | `systemctl start` / `stop microvm@<name>`. systemd asks polkit; a refused prompt shows systemctl's message |
| `r` | hidden (follow-up with `vmDetach`) | `systemctl restart microvm@<name>` |
| `l` | hidden | `omarchy-launch-tui --app-id=org.omarchy.microvm-logs journalctl -u microvm@<name> -n 200 -f`, always |
| `m` | With `vmSetTemplate`, on a stopped VM: form with the template field only | Managed rows, with `optReplace`: the full form prefilled. Otherwise hidden with the reason |
| `x` | Confirm (Cancel default): "Delete <name> and everything in <state dir>? Stop it first if it is running." → `nixarchy-vm rm <name>` | Managed rows: "Remove <name> from apps.nix? The unit and /var/lib/microvms/<name> stay until you apply; this plugin never deletes VM state." → `nixarchy-opt-remove <path>`. Others hidden |
| `y` | `wl-copy --trim-newline <name>` | same |
| `c` | Create form, kind field first | same |
| `i` | Create form on the describe field (§7); only with `agent` and `aiAssist` | same |
| `a` | `omarchy-launch-floating-terminal-with-presentation nixarchy-apply`, shown while `counts.pending > 0` or the header says the service is queued. Not tracked, not locked: the terminal shows the real prompts | same |
| `o`, `u`, `/`, `?`, Esc, Tab | as distrobox | same |

`m` rather than `e` because `e` is Enter's twin in every sibling and a
capital would read as "every VM". Management actions accept any name the
CLI or systemd reports; the stricter rule in §6 is for creation only.

#### 5.1 "Start in terminal" (legacy fallback)

`omarchy-launch-tui --app-id=org.omarchy.microvm-run nixarchy-vm run <name>`
via `execDetached`. It builds and boots the VM in that terminal; closing it
or Ctrl-A X stops the VM. It is a mutation the plugin's lock cannot track:
the row turns running on the next poll because the lock file is held. The
footer says so the first time per session.

#### 5.2 Modes, lock, stream

Distrobox §5.1 plus `list --m--> form(edit)` and, for permanent,
`form --Enter--> review --Enter--> list`. The review screen shows the exact
line to be written, the commands, and: "Apply rebuilds the whole system
from apps.nix, services.nix and advanced.nix, not only this line."
`mutating = actionProcess.running || streamProcess.running || queue.length > 0`.
Listing, console, logs, copy, apply and the agent call never lock; the agent
has its own `thinking` flag. `streamProcess` carries `run --detach` only.
A shell restart kills a running stream (documented).

### 6. Forms, allowlists, snippet, hand-off

`Model.FORM_FIELDS` filtered by kind and by create/edit:

| Field | Kind | Accepted | Default |
|---|---|---|---|
| `describe` | both, create | ≤ 500 chars, no control chars; only with `agent` | "" |
| `kind` | both | `disposable` \| `permanent`; Space flips; fixed in edit | disposable |
| `name` | both, create | permanent: `^[a-z][a-z0-9-]{0,31}$`: it is a systemd instance, a hostname and an unquoted Nix attribute at once, and `_` is invalid in a hostname. Disposable: the CLI's set, starting with a letter. Not an existing row of that kind | "" |
| `template` | both | one of the parsed templates, inline list with label and note | shell |
| `autostart` | permanent | boolean | true |
| `memory` | permanent | integer 256-131072 MiB | 1024 |
| `cores` | permanent | integer 1-64 | 1 |
| `sshPort` | permanent | empty (null) or 1024-65535 | "" |
| `sshKey` | permanent | pick from `~/.ssh/*.pub` (listed inline, read via `FileView`); the first two words must match `^(ssh-ed25519\|ecdsa-sha2-nistp(256\|384\|521)\|ssh-rsa\|sk-ssh-ed25519@openssh.com) [A-Za-z0-9+/]+={0,3}$`; the comment is dropped | "" |
| `shares` | permanent | whitespace-separated `host:guest`; each an absolute path of `[A-Za-z0-9_./+-]`, `~/` → `$HOME`; guest normalised first (no `.`/`..` segments, slashes collapsed, trailing slash dropped), then must not be `/`, `/nix` or below, or `/mnt/host` | "" |

Warnings: memory above 8192, a share of `$HOME` itself. Every builder
returns `null` when `validateForm` fails.

**Snippet.** `machineSnippet(form)` emits one line from validated values
only, defaults written out, every share with an explicit `tag` (guest
basename, suffixed `-2`, `-3` on collision, never `ro-store` or `hostdir`),
and the key in the one fixed `modules` form:

```
{ template = "python"; autostart = true; memory = 4096; cores = 2; sshPort = 2222; shares = [ { source = "/home/u/src"; mountPoint = "/mnt/src"; tag = "src"; } ]; modules = [ { users.users.dev.openssh.authorizedKeys.keys = [ "ssh-ed25519 AAAA…" ]; } ]; }
```

`parseMachineSnippet` reads exactly this grammar and nothing else;
`parse(emit(f)) == f` is a test. A managed line the user changed by hand
outside the grammar becomes managed-unsupported (§4).

**Hand-off** (argv arrays, queued in `actionProcess`):

- create permanent: `nixarchy-service-enable microvm`, then
  `<pkg> opt set <path> <snippet>`. If the second fails, the footer says
  "service queued, machine not written: <error>" and that the service alone
  is harmless (no machines declared = nothing runs);
- edit permanent: `<pkg> opt replace <path> <snippet>` (§11);
- delete permanent: `nixarchy-opt-remove <path>`;
- create disposable: `nixarchy-vm create <name> --template <t>`;
- edit disposable: `nixarchy-vm set-template <name> <t>` (§11).

`<pkg>` is `$XDG_CONFIG_HOME/omarchy/plugins/nixarchy.pkg/bin/nixarchy-pkg`,
checked once per open; `optReplace` is detected by `<pkg> opt replace`
with no args returning a usage error rather than "unknown action". Without
the script, permanent create/edit, `a` and the pending badge are hidden and
the kind field says "permanent VMs need the nixarchy.pkg plugin". Nothing
here writes a file, a unit, `/var/lib/microvms` or the flake.

### 7. AI assist

- **Detection.** `omarchy-default-agent` on open. `agent` is set only for
  `claude`; anything else hides `i` and the describe field and puts "AI
  assist: needs claude as the default agent (codex is a follow-up)" in the
  form's title row.
- **Call.** Enter on the describe field runs
  `claude -p --output-format json --json-schema <schema text> --restricted
  --strict-mcp-config --tools "" --no-session-persistence <prompt>` with
  `workingDirectory = $XDG_RUNTIME_DIR`, stdin closed, a 90 s kill timer,
  Esc cancels. The form is inert while `thinking`.
- **Prompt** (`agentPrompt(text, templates)`): the two kinds and when to
  pick permanent; the template list with notes; the field ranges of §6;
  "use only paths the user named"; "answer with one JSON object matching
  the schema"; the user's sentence between `<request>` tags, as data in one
  argv element.
- **Schema** (`schema.json`, `additionalProperties: false`): `kind`, `name`,
  `template`, optional `memory`, `cores`, `sshPort` (integer or null),
  `autostart`, `shares[{source, mountPoint}]`, and `reasoning` (≤ 280
  chars). No `sshKey`: the agent never sees or picks a key.
- **Reply.** `parseAgentReply` takes `structured_output` from the envelope,
  else `result` parsed as JSON. `applyAgentReply(reply, form)` converts
  per field with the field's declared type: a wrong type (string for
  `memory`, number for `name`) rejects that field, unknown keys are dropped,
  accepted values are set as the form's canonical strings, then the form is
  re-validated as if typed. The form rebinds every visible input from the
  form object after a fill (a `formVersion` counter the text fields watch),
  so what is displayed is what is validated and what is emitted; a test
  drives a reply through fill → validate → snippet. `reasoning` is drawn dim
  under the describe field as `PlainText`. The user still Tabs through and
  confirms; review still applies. Nothing in the reply is executed. Exit ≠ 0
  or no JSON: "the agent gave no usable answer", form unchanged.

### 8. Model.js contracts

`.pragma library`, no QML. Rather than an inventory:

- Every command builder takes explicit inputs and returns a string array or
  `null`; none reads settings or the environment.
- Every parser accepts empty, garbage and the current live format, and
  returns `[]` rather than throwing.
- Every form field has a validator, a hostile-input test row, and a place in
  the snippet grammar or an explicit "not emitted".
- `actionsFor` is the only place a key's applicability is decided.
- `SHORTCUTS` renders the `?` sheet and is quoted by the README.
- `schema.json` is read by the QML side and the tests; there is no copy in
  `Model.js`.

### 9. Omarchy menu row and key bind

- `share/omarchy-menu.jsonc`: `apps.microvm`, label "MicroVMs", aliases
  `microvm, vm, sandbox, virtual machine, nixarchy vm`, action
  `omarchy-shell shell toggle nixarchy.microvm '{}'`, description ending
  `· Super+Alt+V`.
- For `~/.config/hypr/bindings.lua`:
  `o.bind("SUPER + ALT + V", "MicroVMs", "omarchy-shell shell toggle nixarchy.microvm '{}'")`.
  Evidence in §1; the docs say how to check with `hyprctl binds`.
- IPC on `nixarchy.microvm.bar`: `open close show hide toggle refresh create
  status`.

### 10. Packaging, checks, CI, docs, Pages

- **Package:** `runCommand`, real copies of `manifest.json qmldir LICENSE
  Model.js schema.json Panel.qml Menu.qml MicrovmState.qml MicrovmView.qml
  VmList.qml CreateForm.qml LogView.qml ShortcutSheet.qml`. Only `nixpkgs`.
- **`checks.default`**: distrobox's list plus `schema.json` parses and
  `docs/img` ≤ 8 MB. **CI:** `ci.yml` and `pages.yml` as distrobox.
- **README:** what it does, the key table, install (NixOS, without Nix, menu
  row, bind), settings, IPC, safety (argv only, allowlists, the agent has no
  tools and its reply is data, declarative stays declarative, apply is the
  user's terminal), development.
- **`docs/usage.md`:** what it is; requirements (`nixarchy-vm`,
  `systemctl`/`journalctl`, `omarchy-launch-tui`,
  `omarchy-launch-floating-terminal-with-presentation`, `wl-copy`;
  nixarchy.pkg for permanent VMs; claude for assist); install; the popup;
  the menu; everyday tasks (a throwaway shell, a permanent machine with SSH
  key and port, edit, delete, apply and the polkit prompt with a rule
  example for `microvm@`); AI assist, what it can and cannot do; what
  "start in terminal" means; settings; troubleshooting; removal.
- **`AGENTS.md`:** distrobox's rules plus: the agent's reply is data for the
  form; every permanent write goes through nixarchy.pkg's writers, never a
  file write; the snippet grammar is the only Nix this repo emits and the
  parser must keep reading it; every `nixarchy vm` feature is detected, not
  assumed; retaking captures.
- **Pages** (`docs/`), distrobox #3 layout: `_config.yml` (baseurl
  `/nixarchy-microvm`, `nav:` over `usage.md`), the two layouts, logo
  include, `style.css` (nixarchy's copy with a source header), `manual.js`,
  `index.md` (who it is for → the problem → what it does → how it works →
  why it is built this way → a tour → set it up), `capture.sh`, `img/`.
  Captures: `popup.png`, `menu.png`, `form-permanent.png`, `assist.png`,
  `review.png`, and one recording `rec-create` (≤ 25 s, WebM + MP4).
  `capture.sh --setup` makes `demo-*` disposable VMs and one `demo-perm`
  line, backs up `apps.nix`, `services.nix`, `shell.json` and the menu
  extension; `--teardown` removes only what it made and restores them.
  Privacy rules as distrobox #3 §5.

### 11. Upstream dependencies

Both filed as issues in their repos before the plan; they ship as one
release each. Detection is per feature where a probe is cheap.

**nixarchy: "nixarchy vm: --json, run --detach, console, set-template"**

- `list --json` → `[{"name","template","running","dir"}]`; `templates
  --json` → `[{"name","label","note"}]`; text output unchanged.
  Detected by the output's first byte. Without: text parse.
- `run --detach <name>`: same build and lock, then the runner continues
  under the user's systemd (a transient `nixarchy-vm-<name>` unit holds
  the lock); exits 0 once up, stdout is the build log. Without: "start in
  terminal", no build log, `r` hidden.
- `console <name>`: attaches in the current terminal, documented detach
  key. Without: Enter hidden on a running VM.
- `set-template <name> <t>`: takes the lock, refuses while running, validates
  the template, rewrites `<dir>/template`. Without: `m` hidden for
  disposable.
  Detection for the last three: `nixarchy-vm help` lists the subcommand.

**nixarchy-pkg: "opt replace, and apply's stdin"**

- `opt replace <path> <value>`: one backup, the marked line swapped in
  place, parse-check, whole file reverted on failure, one JSON object.
  Without: permanent `m` hidden.
- The `apply` bug (always exit 0; `n\ny` declines the switch when
  `nixarchy-preview` is absent) is reported there. This plugin does not use
  `apply` either way.

## Alternatives rejected

- **Disposable VMs only.** Declined by the owner.
- **`nix eval` over the flake to list permanent machines.** Seconds per
  poll; apps.nix plus systemd covers what the plugin can edit.
- **Reading `/var/lib/microvms`.** Owned by `microvm`; listing should not
  need root.
- **Writing apps.nix ourselves.** The `#@opt` line is byte-exact and
  `nixarchy-opt-remove` depends on it; nixarchy.pkg already parse-checks
  and reverts. `opt replace` upstream keeps one writer.
- **Remove-then-set for edit.** Not atomic (`nixarchy-pkg:457`).
- **Streamed `nixarchy-pkg apply`.** Exit code hidden, switch declined
  without `nixarchy-preview`, and the user would not see that apply covers
  every selection file.
- **Inferring "pending" from unit presence.** nixarchy-pkg's `pending`
  already answers it against the flake's copy.
- **`nixarchy-pkg toggle service microvm`.** A toggle flips; a second create
  would turn the service off.
- **Writing `<dir>/template` from QML.** A file write outside the CLI's
  lock; `set-template` upstream instead. rm + create was rejected earlier
  because it destroys `persistent` and `agent` state.
- **codex with `--sandbox read-only`.** Still runs commands. Follow-up once
  a no-tools mode is verified by behaviour.
- **An interactive agent in a terminal.** The result would not reach the
  form and the agent would have a shell.
- **`pkexec systemctl`.** systemd already asks polkit.
- **A free `modules` field, a schema copy in Model.js, stop-all,
  thirteen captures.** Cut.

## Risks

- **`--restricted` is recent.** An older claude exits with a usage error,
  shown in the footer with "update claude". The agent never runs without the
  no-tools flags, and §Verification proves tool-freeness by behaviour.
- **The agent proposes a wrong path or name.** Format is validated;
  existence is the user's to confirm on review.
- **`nixarchy vm list` text changes upstream before the JSON PR lands.**
  Fixtures for the current format; the JSON path is the fix.
- **polkit prompt refused or no agent running.** systemctl's message in the
  footer; a rule example in the docs.
- **nixarchy.pkg missing or old.** Permanent create/edit, `a` and pending
  are hidden with reasons; `opt replace` is probed.
- **"Start in terminal" is an untracked mutation.** Said in the footer and
  the docs; gone once `run --detach` exists.
- **A managed line edited by hand.** Becomes managed-unsupported: visible,
  read-only, never overwritten.
- **Captures leaking personal content.** distrobox #3 §5 rules.
- **Hosts.** Nothing changes on p620 until its flake adds the input.

## Verification

- **Node** (`node tests/run.js`):
  - parsing: `list` text and JSON, `templates` both ways, `systemctl
    --output=json` (active, failed, inactive), apps.nix lines (managed,
    managed-unsupported, commented-out with a marker, LHS not matching the
    marker, none), `pending` output, snippet round trip, agent envelope;
  - rows: the three axes, merge order, counts, filter;
  - commands: string arrays or `null`, the feature-flag switches for Enter,
    `s`, `m`; create's queued pair; `set-template` and `opt replace` argv;
  - form: hostile rows per field (`$(id)`, quotes, backslashes, `${`,
    newlines, `..`, `a/./b`, `//x`, trailing `/`, relative paths, `/nix/x`,
    `/mnt/host`), share tag uniqueness and no built-in tag, the key regex
    with and without a comment, name rules per kind, defaults written,
    `parse(emit(f)) == f`;
  - agent: argv contains `--restricted`, `--strict-mcp-config` and
    `--tools ""`; prompt contains every template and the request once;
    reply table (valid, extra keys, wrong types per field, prose around
    JSON, empty); fill → validate → snippet equals a typed form;
  - settings.
- **Nix:** `nix flake check`, `--all-systems --no-build`, `nix build`,
  `omarchy plugin validate "$(readlink -f result)"`; a planted hex colour,
  symlink and `pacman` each fail.
- **Live**, after `omarchy-restart-shell` and a clean `qs log`:
  - glyph counts and colours; `hideWhenEmpty`;
  - every key once per surface per kind; inapplicable keys absent from
    footer, sheet and buttons; each feature flag toggled by hiding the
    upstream subcommand and confirming the key disappears;
  - a mutation in one surface refused in the other;
  - disposable: create, "start in terminal" turns the row running on the
    next poll and closing the terminal stops it, `s` stops, `x` deletes;
    with the nixarchy PR: `s` streams the build, Enter attaches, `m`
    changes the template and the next run uses it;
  - permanent: create writes exactly one line and the service row,
    `nixarchy-pkg pending` lists both and the row shows pending, `a` opens
    the terminal with the real prompts, after apply the unit appears and
    `s`/`r`/`l` work, Enter opens SSH with the chosen key, `m` (with `opt
    replace`) rewrites the line atomically, `x` removes it and
    `/var/lib/microvms/<name>` survives; a hand-edited line shows as
    managed-unsupported and is untouched;
  - assist: a sentence fills the form with reasoning shown, displayed values
    equal the emitted snippet; a prompt asking claude to read a file or run
    a command yields an envelope with **no tool use** and the form unchanged
    or filled, never a side effect; an unsupported agent hides the key; the
    timeout fires with the agent stubbed;
  - only the bar's slow poll runs while everything is closed (`status`);
  - `SUPER + ALT + V` opens the menu; `hyprctl binds -j` shows one bind on
    that chord.
- **Docs and site:** local Jekyll build, links resolve, `docs/img` ≤ 8 MB,
  every capture reviewed, Pages URL returns 200 after merge.
