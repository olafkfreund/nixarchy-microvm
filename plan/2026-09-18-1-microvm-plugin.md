---
status: approved
issue: 1
spec: spec/2026-09-18-1-microvm-plugin.md
---
# Plan: Keyboard-driven MicroVM plugin for Omarchy (bar widget and menu)

## Approved decisions (self-contained summary)

- **Plugin shape.** `nixarchy.microvm`, `schemaVersion: 1`,
  `kinds: ["menu","bar-widget"]`, `entryPoints: { menu: Menu.qml, barWidget: Panel.qml }`,
  `keepLoaded: true`, `barWidget.category: System`, `defaultSection: right`.
  Settings: `refreshIntervalSec` (integer 5-600 step 5, default 30; an open
  view polls every 3 s), `showStopped` (true), `hideWhenEmpty` (false),
  `aiAssist` (true; off hides the describe field and `i`). One list, no
  tabs. IPC target `nixarchy.microvm.bar`: `open close show hide toggle
  refresh create status`. Menu namespace `nixarchy-microvm-menu`, scale
  1.45, payload `{"create":true}` opens the form.
- **Runtime files** (the flake's `files` list, copied as real files):
  `manifest.json qmldir LICENSE Model.js schema.json Panel.qml Menu.qml
  MicrovmState.qml MicrovmView.qml VmList.qml CreateForm.qml LogView.qml
  ShortcutSheet.qml`. `qmldir` is
  `singleton MicrovmState 1.0 MicrovmState.qml`. Only `nixpkgs` as input.
- **Two kinds, one row:**
  `{ kind: disposable|permanent, name, template, runtime, ownership,
  pending, sshPort, sshKey, memory, cores, autostart, shares }`.
  - `runtime` ∈ `running|stopped|failed|none`. Disposable: from
    `nixarchy-vm list` (running = the VM's lock is held, build included).
    Permanent: from `systemctl list-units 'microvm@*' --all --plain
    --no-legend --output=json` (`active` → running, `failed` → failed,
    else stopped; a managed machine with no unit → `none`).
  - `ownership` ∈ `state|managed|managed-unsupported|flake`. Disposable
    rows are `state`. Permanent rows are read from
    `$XDG_CONFIG_HOME/nixarchy/apps.nix` (watched `FileView`): a line is
    **managed** when it is an uncommented assignment whose left-hand path
    equals its `#@opt programs.nixarchy.services.microvm.machines.<name>`
    marker and whose value parses under the snippet grammar below;
    **managed-unsupported** when the marker matches but the value does not
    (read-only, hint "edit it in apps.nix"); a unit with no such line is
    **flake** (controllable, not editable). Union by name.
  - `pending` only from `<pkg> pending` (`changes[].marker == "opt:<path>"`;
    `":microvm"` means the service row is queued). No script → no badge.
  - Order: running, failed, pending, then by name. `counts =
    {running, total, failing, pending}`. Templates (`nixarchy-vm templates`,
    JSON or text) and the agent id are read once per open. Every path
    honours `XDG_STATE_HOME`/`XDG_CONFIG_HOME`; `dir` from JSON is display-only.
- **Feature flags**, detected at runtime, never assumed:

  | Flag | Probe | Without it |
  |---|---|---|
  | `vmJson` | `nixarchy-vm list --json` output starts with `[` (same for `templates --json`) | parse the text formats `  %-16s template=%-10s running\|stopped` and `  name  label` + indented note |
  | `vmDetach`, `vmConsole`, `vmSetTemplate` | `nixarchy-vm help` lists `run --detach`, `console`, `set-template` | "start in terminal"; Enter hidden on a running VM; disposable `m` hidden |
  | `pkgScript` | `$XDG_CONFIG_HOME/omarchy/plugins/nixarchy.pkg/bin/nixarchy-pkg` exists | permanent create/edit, `a`, pending badge hidden; kind field says "permanent VMs need the nixarchy.pkg plugin" |
  | `optReplace` | `<pkg> opt replace` with no args gives a usage error, not "unknown action" | permanent `m` hidden |
  | `agent` | `omarchy-default-agent` prints `claude` | `i` and describe hidden; title row: "AI assist: needs claude as the default agent (codex is a follow-up)" |

- **Keys.** `Model.actionsFor(row, state)` is the one source for keys, row
  buttons and the `?` sheet; inapplicable keys are absent, not greyed.
  `PanelKeyCatcher` built-ins (Esc, Tab, j/k/arrows, Enter, x) plus `textKey`.

  | Key | Disposable | Permanent |
  |---|---|---|
  | Enter, `e` | `vmConsole` + running: `omarchy-launch-tui --app-id=org.omarchy.microvm-console nixarchy-vm console <n>`. No `vmConsole` + stopped: "start in terminal". Otherwise hidden | managed with `sshPort` and `sshKey`: `omarchy-launch-tui --app-id=org.omarchy.microvm-console ssh -p <port> dev@localhost`; else hidden, hint "set an SSH port and key to get a console" |
  | `s` | stopped: `vmDetach` → stream `nixarchy-vm run --detach <n>`; else "start in terminal". running: action `nixarchy-vm stop <n>` | action `systemctl start\|stop microvm@<n>` (systemd asks polkit; a refusal shows systemctl's message) |
  | `r` | hidden | `systemctl restart microvm@<n>` |
  | `l` | hidden | `omarchy-launch-tui --app-id=org.omarchy.microvm-logs journalctl -u microvm@<n> -n 200 -f` |
  | `m` | `vmSetTemplate` + stopped: form with template only | managed + `optReplace`: full form prefilled; else hidden with reason |
  | `x` | confirm (Cancel default) "Delete <n> and everything in <state dir>? Stop it first if it is running." → `nixarchy-vm rm <n>` | managed: "Remove <n> from apps.nix? The unit and /var/lib/microvms/<n> stay until you apply; this plugin never deletes VM state." → `nixarchy-opt-remove <path>`; others hidden |
  | `y` | `wl-copy --trim-newline <n>` | same |
  | `c` / `i` | create form, kind first / create form on the describe field (`agent` and `aiAssist`) | same |
  | `a` | `omarchy-launch-floating-terminal-with-presentation nixarchy-apply` via `execDetached`; shown while `counts.pending > 0` or the service row is queued; untracked, unlocked | same |
  | `o` `u` `/` `?` Esc Tab | log, refresh, filter, help, step back, next bar panel | same |

  Management actions accept any name the CLI or systemd reports.
  **"Start in terminal"** = `omarchy-launch-tui --app-id=org.omarchy.microvm-run nixarchy-vm run <n>`
  via `execDetached`: builds and boots in that terminal; closing it or
  Ctrl-A X stops the VM; the lock cannot track it, the row turns running on
  the next poll; the footer says so once per session.
- **Modes and lock.** `list | form | review | log` with `helpOpen` and
  `confirmOpen` overlays; key catcher blocked when the filter has focus,
  a confirm is open, or `mode !== "list"`. Permanent forms go
  `form → review → list`; the review shows the exact line, the commands,
  and "Apply rebuilds the whole system from apps.nix, services.nix and
  advanced.nix, not only this line." `reset()` on every open returns to
  list, clears filter and overlays, leaves the stream alone, then
  `Qt.callLater(focusForMode)`. `ConfirmDialog.selectedIndex = 0` on open.
  `mutating = actionProcess.running || streamProcess.running || queue.length > 0`;
  every mutation checks it from either surface; listing, console, logs,
  copy, apply and the agent (own `thinking` flag) never lock.
  `streamProcess` carries `run --detach` only: ANSI stripped, 2 KB lines,
  400-line cap, `── exit N · done|failed`, refresh after; Esc hides, `o`
  returns; a shell restart kills it (documented).
- **Form fields** (create/edit, per kind):

  | Field | Kind | Rule | Default |
  |---|---|---|---|
  | `describe` | both, create | ≤ 500 chars, no control chars; only with `agent` | "" |
  | `kind` | both | `disposable\|permanent`, Space flips, fixed in edit | disposable |
  | `name` | create | permanent `^[a-z][a-z0-9-]{0,31}$` (systemd instance + hostname + unquoted Nix attr; `_` is not hostname-legal); disposable `^[a-zA-Z][a-zA-Z0-9_-]*$`; not an existing row of that kind | "" |
  | `template` | both | one of the parsed templates, inline list with label and note | shell |
  | `autostart` | permanent | boolean | true |
  | `memory` | permanent | integer 256-131072 (MiB); warn above 8192 | 1024 |
  | `cores` | permanent | integer 1-64 | 1 |
  | `sshPort` | permanent | empty (null) or integer 1024-65535 | "" |
  | `sshKey` | permanent | pick from `~/.ssh/*.pub` (inline list via `FileView`); first two words match `^(ssh-ed25519\|ecdsa-sha2-nistp(256\|384\|521)\|ssh-rsa\|sk-ssh-ed25519@openssh.com) [A-Za-z0-9+/]+={0,3}$`; comment dropped | "" |
  | `shares` | permanent | whitespace-separated `host:guest`; each absolute, chars `[A-Za-z0-9_./+-]`, `~/` → `$HOME`; guest normalised (no `.`/`..` segments, slashes collapsed, trailing slash dropped) then not `/`, `/nix` or below, `/mnt/host`; warn on sharing `$HOME` itself | "" |

  Form keys as distrobox: Tab/↓ and Shift+Tab/↑ move, `j`/`k` move off text
  fields, Space flips, Enter validates then submits, Esc cancels; inline
  errors in `Color.urgent`.
- **Snippet grammar** (`machineSnippet`, one line, defaults written, tag =
  guest basename, suffixed `-2`, `-3` on collision, never `ro-store` or
  `hostdir`; `modules` only in this fixed form, only with a key):

  ```
  { template = "python"; autostart = true; memory = 4096; cores = 2; sshPort = 2222; shares = [ { source = "/home/u/src"; mountPoint = "/mnt/src"; tag = "src"; } ]; modules = [ { users.users.dev.openssh.authorizedKeys.keys = [ "ssh-ed25519 AAAA…" ]; } ]; }
  ```

  `sshPort = null;` when empty; `shares = [ ];` when none; no `modules`
  when no key. `parseMachineSnippet` reads exactly this and nothing else.
- **Hand-off** (argv arrays queued in `actionProcess`; path =
  `programs.nixarchy.services.microvm.machines.<name>`):

  | Action | Argv sequence |
  |---|---|
  | create permanent | `nixarchy-service-enable microvm`, then `<pkg> opt set <path> <snippet>`; if the second fails: "service queued, machine not written: <error>" and that the service alone is inert |
  | edit permanent | `<pkg> opt replace <path> <snippet>` |
  | delete permanent | `nixarchy-opt-remove <path>` |
  | create disposable | `nixarchy-vm create <name> --template <t>` |
  | edit disposable | `nixarchy-vm set-template <name> <t>` |

  `opt set`/`opt replace` print one JSON object; `ok: false` → `error` in
  the footer. Nothing writes a file, a unit, `/var/lib/microvms` or the flake.
- **AI assist.** Enter on describe runs, with `workingDirectory =
  $XDG_RUNTIME_DIR`, stdin closed, a 90 s kill timer, Esc cancels:

  ```
  claude -p --output-format json --json-schema <schema.json text> --restricted --strict-mcp-config --tools "" --no-session-persistence <prompt>
  ```

  Prompt = the two kinds and when to pick permanent; templates with notes;
  the field ranges; "use only paths the user named"; "answer with one JSON
  object matching the schema"; the request between `<request>` tags, as one
  argv element. `schema.json` (`additionalProperties: false`): `kind`,
  `name`, `template`, optional `memory`, `cores`, `sshPort` (integer|null),
  `autostart`, `shares[{source, mountPoint}]`, `reasoning` (≤ 280). No
  `sshKey`. Reply: `structured_output` else `result` parsed as JSON;
  per-field typed conversion, wrong type rejects that field, unknown keys
  dropped, values set as the form's canonical strings, form re-validated as
  if typed, every visible input rebound (`formVersion` counter);
  `reasoning` drawn dim under describe as `PlainText`. User still confirms;
  review still applies; nothing in the reply is executed. Exit ≠ 0 or no
  JSON: "the agent gave no usable answer", form unchanged.
- **Look.** `PanelHero` "MicroVMs" with "N of M running"; rows: state dot,
  name (bold when running), kind badge, `template · runtime` subtitle,
  pending badge, buttons; footer hairline, message line, `N VMs · M
  running` and `? keys  c create  esc close`. Only `Color.*`, `Style.*`,
  `Border.*`.
- **Menu row and bind.** `share/omarchy-menu.jsonc`: `apps.microvm`, label
  "MicroVMs", aliases `microvm, vm, sandbox, virtual machine, nixarchy vm`,
  action `omarchy-shell shell toggle nixarchy.microvm '{}'`, description
  ending `· Super+Alt+V`. Bind for `~/.config/hypr/bindings.lua`:
  `o.bind("SUPER + ALT + V", "MicroVMs", "omarchy-shell shell toggle nixarchy.microvm '{}'")`
  (free on this host and in Omarchy's defaults).
- **Checks and CI.** `checks.default`: Node tests, jq on the manifest, entry
  points present, the `qmldir` singleton line, no symlink in package or
  repo, no `pacman`/`yay`, no `"#hex"` in QML, `schema.json` parses,
  `docs/img` ≤ 8 MB. `ci.yml`: flake check, `--all-systems --no-build`,
  build, no-symlink. `pages.yml`: Jekyll from `docs/` on push to `main`.
- **Pages.** distrobox #3 layout in `docs/`: `_config.yml` (baseurl
  `/nixarchy-microvm`, exclude `capture.sh`, `nav:` over `usage.md`),
  `_layouts/home.html`, `_layouts/manual.html`, `_includes/logo.html`,
  `assets/style.css` (nixarchy@e3827446bb32's, with a source header),
  `assets/manual.js`, `index.md` (who it is for → the problem → what it
  does → how it works → why it is built this way → a tour → set it up),
  `usage.md` (`layout: manual`, `permalink: /usage/`), `capture.sh`, `img/`.
  Captures: 5 stills `popup`, `menu`, `form-permanent`, `assist`, `review`
  and one recording `rec-create` (≤ 25 s, WebM VP9 `-crf 40` + MP4 H.264
  `-crf 28`). `capture.sh --setup` makes `demo-*` disposable VMs and one
  `demo-perm` apps.nix line, backs up `apps.nix`, `services.nix`,
  `shell.json` and the menu extension in `$XDG_RUNTIME_DIR`; `--teardown`
  removes only what it made and restores them. Privacy: empty workspace,
  notifications silenced, frames cropped, every frame reviewed, config
  files diffed after.
- **Upstream** (own artifact workflow in their repos; out of this plan):
  nixarchy `nixarchy vm` `list/templates --json`, `run --detach`, `console`,
  `set-template`; nixarchy-pkg `opt replace` and the `apply` stdin bug. v1
  ships fully usable without them.
- **Out of v1.** codex assist, disposable rename and per-VM memory/cores,
  disposable `r`, stop-all, a free `modules` field, `/var/lib/microvms`
  reading, host flake wiring.

## Steps

Each step is one commit on `feat/1-microvm-plugin`, titled
`<type>: … (#1)`, and cited as `plan step N`. A deviation updates this file
in the same commit.

1. **Scaffold** — `chore: scaffold plugin repository (#1)`. Add
   `manifest.json` (identity, entry points, the four settings), `qmldir`,
   `.gitignore` (`result`), `AGENTS.md` (distrobox's rules plus: the
   agent's reply is data for the form; every permanent write goes through
   nixarchy.pkg's writers, never a file write; the snippet grammar is the
   only Nix this repo emits and the parser must keep reading it; every
   `nixarchy vm` feature is detected, not assumed; retaking captures),
   `CLAUDE.md` as a regular file containing `@AGENTS.md`,
   `.github/copilot-instructions.md`. `LICENSE` exists.
   → Verify: `jq -e '.id=="nixarchy.microvm" and .keepLoaded and (.barWidget.schema|length)==4' manifest.json`;
   `find . -path ./.git -prune -o -type l -print` is empty.
2. **File the upstream issues** — `docs: record upstream dependencies (#1)`.
   Add `docs/upstream.md` listing both issues with their numbers once filed.
   Issue bodies:
   - **olafkfreund/nixarchy — "nixarchy vm: list/templates --json, run
     --detach, console, set-template"**: "nixarchy.microvm (an Omarchy
     plugin) needs machine-readable and detachable `nixarchy vm`. Contract:
     (1) `list --json` → `[{"name","template","running","dir"}]`, `[]` when
     none; `templates --json` → `[{"name","label","note"}]`; text output
     unchanged. (2) `run --detach <name>`: same build and lock, then the
     runner continues under the user's systemd (a transient
     `nixarchy-vm-<name>` unit holds the lock); exits 0 once up; stdout is
     the build log. (3) `console <name>`: attaches to a detached VM in the
     current terminal with a documented detach key; `stop`/`rm` keep working.
     (4) `set-template <name> <t>`: takes the lock, refuses while running,
     validates against the catalogue, rewrites `<dir>/template`. (5) `help`
     lists the new subcommands (the plugin detects them there). Ship
     together in one release. Design: nixarchy-microvm spec §11."
   - **olafkfreund/nixarchy-pkg — "opt replace, and apply's stdin"**:
     "(1) `nixarchy-pkg opt replace <path> <value>`: one backup, the marked
     `#@opt <path>` line swapped in place, `nix-instantiate --parse` check,
     whole file reverted on failure, one JSON object; `opt replace` with no
     args must print a usage error (the plugin probes it that way).
     remove-then-set is not atomic today (`opt set` backs up after the
     removal, bin/nixarchy-pkg:457). (2) `cmd_apply` always exits 0 via jq,
     and its `printf 'n\ny\n'` answers 'Build and switch now?' with `n`
     when `nixarchy-preview` is absent (nixarchy-apply:193), so nothing is
     applied. Design: nixarchy-microvm spec §11."
   → Verify: both issues exist; `docs/upstream.md` links them.
3. **`Model.js` parsing and rows, with tests** —
   `feat: model parsing and rows (#1)`. `tests/harness.js`, `tests/run.js`
   (distrobox's, fixtures replaced), `tests/model/parsing.test.js`,
   `rows.test.js`, `settings.test.js`. Model covers `parseVmList` (JSON and
   text, `No VMs yet`, empty), `parseTemplates` (both), `parseUnits`,
   `parseMachineLines` (managed, managed-unsupported, commented marker,
   LHS ≠ marker, none), `parsePending`, `parseAgentReply` envelope,
   `parseJsonLines`, `stripAnsi`, `capLine`; `disposableRows`,
   `permanentRows`, `mergeRows`, `filterRows`, `counts`, `summaryText`,
   `footerText`, `emptyText`, `rowRecord`, `ROW_FIELDS`, `reconcilePlan`,
   `clampCursor`; `settingsFor`, `Glyph`, `SHORTCUTS`, `shortcutGroups`.
   → Verify: `node tests/run.js` passes; fixtures exist for every format
   with and without the upstream features.
4. **`Model.js` validators, form and snippet, with tests** —
   `feat: model form, allowlists and snippet grammar (#1)`. Add
   `form.test.js`. Model covers `isVmName(kind)`, `isTemplate`, `isPort`,
   `isMiB`, `isCores`, `isPath`, `normalizeGuestPath`, `isShareList`,
   `isSshKey`, `isDescribe`; `FORM_FIELDS`, `emptyForm(kind)`,
   `formFromRow`, `visibleFields(form, mode)`, `validateForm`,
   `shareTags`, `machineSnippet`, `parseMachineSnippet`, `optPath`,
   `formSummary`, `firstErrorIndex`, `templatesMatching`. Hostile rows per
   field: `$(id)`, backtick, `;`, `|`, `&`, `>`, `<`, both quotes, `\`,
   newline, `${HOME}`, `..`, `a/./b`, `//x`, trailing `/`, relative,
   `/nix/x`, `/mnt/host`, a key with a comment, a key with a bad type.
   → Verify: `node tests/run.js` passes; `parse(emit(f)) == f` for a full
   form; tags unique and never `ro-store`/`hostdir`.
5. **`Model.js` commands and `actionsFor`, with tests** —
   `feat: model commands and key applicability (#1)`. Add
   `commands.test.js`. Every builder from the decisions table plus
   `listArgv`, `templatesArgv`, `helpArgv`, `unitsArgv`, `pendingArgv`,
   `consoleArgv`, `runTerminalArgv`, `runDetachArgv`, `stopVmArgv`,
   `rmVmArgv`, `createVmArgv`, `setTemplateArgv`, `unitArgv(verb, name)`
   (`start|stop|restart` only), `logsArgv`, `sshArgv`, `serviceEnableArgv`,
   `optSetArgv`, `optReplaceArgv`, `optRemoveArgv`, `applyTerminalArgv`,
   `copyArgv`, `defaultAgentArgv`; `actionsFor(row, state)`; `removeMessage`
   per kind; `detectFeatures(helpText)`.
   → Verify: `node tests/run.js` passes; every argv is a string array or
   `null`; the flag table above drives `actionsFor` (each flag toggled in a
   test row).
6. **Agent: `schema.json`, prompt, reply** — `feat: agent schema, prompt and
   reply handling (#1)`. Add `schema.json`, `tests/model/agent.test.js`;
   Model covers `agentFor(id)`, `agentArgv(schemaText, prompt)`,
   `agentPrompt(text, templates)`, `applyAgentReply(reply, form)`. The
   harness loads `schema.json` from disk (no copy in Model).
   → Verify: `node tests/run.js` passes; argv contains `--restricted`,
   `--strict-mcp-config`, `--tools ""`, `--no-session-persistence`; prompt
   contains every template and the request once; reply table (valid, extra
   keys, wrong type per field, prose around JSON, empty, envelope with
   `structured_output`, envelope with `result`); fill → validate → snippet
   equals a typed form.
7. **`MicrovmState.qml` singleton, minimal `Panel.qml` and `Menu.qml`** —
   `feat: shared state singleton (#1)`. Processes: two list readers,
   templates, help probe, pending, default-agent, action (with queue),
   stream, agent (with 90 s timer), copy; the apps.nix and `~/.ssh/*.pub`
   `FileView`s; `acquire/release`; feature flags; `lastError`; `statusJson`
   with `polls`. Hosts only bind to the singleton and show counts.
   → Verify: `cp -rL` a dev copy to `~/.config/omarchy/plugins/nixarchy.microvm`,
   `omarchy plugin enable nixarchy.microvm`, `omarchy-restart-shell`,
   `qs log -i <id>` clean; `omarchy-shell shell call nixarchy.microvm status ''`
   reports the same `instance` from the bar and the menu, and `polls` stops
   rising while both are closed. Templates and flags in `status` match
   `nixarchy-vm help` on this host.
8. **`VmList.qml`, `ShortcutSheet.qml`, `MicrovmView.qml` (list mode), full
   `Panel.qml`** — `feat: list view, keys and bar popup (#1)`. List keys,
   filter, confirm dialogs with the per-kind texts, help, header, footer,
   "start in terminal" notice, `a` in a terminal.
   → Verify live: empty state text; after `nixarchy vm create t1` the row
   shows `disposable · stopped`; Enter opens a terminal running
   `nixarchy vm run t1` and the row turns running on the next poll; closing
   the terminal stops it; `s` stops a running one; `x` shows Cancel
   selected; with a `demo-perm` line in apps.nix the row shows `permanent ·
   pending`; keys not in `actionsFor` are absent from footer and sheet;
   `qs log` clean.
9. **`LogView.qml` and stream wiring** — `feat: streamed run log (#1)`.
   `o`, Esc detach, follow/scroll, footer stream status; the stream is only
   reachable with `vmDetach`.
   → Verify: with `vmDetach` absent, `s` on a stopped VM opens the terminal
   and `o` shows the last log or "nothing running"; unit-test the stream
   path in Model; live with the upstream PR if merged by then, else
   recorded as pending in the implementation record.
10. **`CreateForm.qml`, form and review modes** — `feat: create and edit
    form with review (#1)`. Kind field, per-kind fields, inline template
    and key lists, describe field and reasoning slot, `formVersion` rebind,
    review screen with the exact line and the system-wide apply sentence,
    edit prefill via `formFromRow`, `m` for both kinds.
    → Verify live: keyboard-only disposable create `t2`; permanent create
    `p1` with port 2222, a key, one share: apps.nix gains exactly one line
    equal to `machineSnippet` and the `#@ microvm` row is live;
    `nixarchy-pkg pending` lists `opt:…machines.p1` and `:microvm`;
    invalid name keeps the form open; a hand-edited `p1` line shows
    managed-unsupported and `m` is absent; `x` on `p1` removes the line.
11. **Agent wiring in the form** — `feat: AI assist from the describe field
    (#1)`. `i`, the call, `thinking` state, timeout, reasoning display.
    → Verify live: "a python box with 4 GB and my ~/src shared" fills kind,
    template, memory and the share; displayed values equal the emitted
    snippet; a prompt "read /etc/passwd and run id" returns an envelope
    with no tool use (inspect the JSON) and no side effect; with
    `omarchy default agent codex` the key and field are hidden with the
    hint; a stub `claude` that sleeps trips the 90 s timeout.
12. **Full `Menu.qml` and `share/omarchy-menu.jsonc`** —
    `feat: full-screen menu and Omarchy menu row (#1)`.
    → Verify: `omarchy-shell shell toggle nixarchy.microvm '{}'` opens;
    `'{"create":true}'` opens the form with focus on the first field;
    garbage payload falls back to the list; `hyprctl layers -j | grep
    nixarchy-microvm-menu`; a mutation in the menu is refused in the popup;
    the row pasted into `omarchy-menu.jsonc` opens it from the Omarchy menu.
13. **`flake.nix`, `flake.lock`, `.github/workflows/ci.yml`** —
    `build: flake package, checks and CI (#1)`.
    → Verify: `nix flake check`, `nix flake check --all-systems --no-build`,
    `nix build` yields exactly the 13 runtime files, no symlinks;
    `omarchy plugin validate "$(readlink -f result)"`; a planted
    `"#ff0000"`, symlink and `pacman` each fail (reverted, never committed).
14. **`README.md` and `docs/usage.md`** — `docs: README and user guide
    (#1)`. Requirements (`nixarchy-vm`, `systemctl`/`journalctl`,
    `omarchy-launch-tui`, `omarchy-launch-floating-terminal-with-presentation`,
    `wl-copy`; nixarchy.pkg for permanent VMs; claude for assist), install
    with and without Nix, enable, the bind and the menu row, keys quoting
    `SHORTCUTS`, the two kinds, everyday tasks (throwaway shell; permanent
    machine with key and port; edit; delete; apply and the polkit prompt
    with a rule example for `microvm@`), what "start in terminal" means, AI
    assist and its limits, settings, IPC, safety, troubleshooting (missing
    command; pending → `a`; refused prompt; `run` fell back to `main`;
    which keys need which upstream feature), removal.
    → Verify: every key in the docs is in `Model.SHORTCUTS` (grep); ids and
    IPC names match the manifest and `Panel.qml`.
15. **Pages site and captures** — `docs: Pages site with captures (#1)`.
    `docs/_config.yml`, both layouts, `_includes/logo.html`, `assets/`,
    `usage.md` front matter, `index.md`, `capture.sh`, `img/`,
    `.github/workflows/pages.yml`, the `ci.yml` 8 MB step, README link,
    AGENTS.md "Retaking the captures". Capture order: `--setup`, silence
    notifications, empty workspace, keystrokes only while a plugin layer is
    up, the 5 stills and `rec-create`, `--teardown`.
    → Verify: `nix run nixpkgs#jekyll -- build -s docs -d "$scratch/_site"`
    succeeds and a link check finds no broken href/src/anchor;
    `du -sb docs/img` ≤ 8388608; every still and the recording's frame
    sheet reviewed; after teardown `apps.nix`, `services.nix`, `shell.json`
    and the menu extension are byte-identical to the backups and no
    `demo-*` VM remains; `nix build` still has 13 files.
16. **Close-out** — `docs(plan): implementation record (#1)`. Fill in the
    record below. Open a PR (`Closes #1`) whose description links
    `intent/2026-09-18-1-microvm-plugin.md`,
    `spec/2026-09-18-1-microvm-plugin.md` and this plan, and notes the two
    upstream issues.
    → Verify: CI green; `SUPER + ALT + V` bound and `hyprctl binds -j`
    shows one bind on that chord.

## Tests

- **A. Node.** `node tests/run.js` → `N passed, 0 failed`:

  | File | Covers |
  |---|---|
  | `parsing` | `list`/`templates` text and JSON, `systemctl` JSON (active, failed, inactive), apps.nix lines (managed, managed-unsupported, commented, LHS ≠ marker, none), `pending`, help-text feature detection, envelope, empty and garbage input for every parser |
  | `rows` | the three axes, merge order, counts, filter, `reconcilePlan`, `clampCursor`, `actionsFor` under every flag combination and lock state |
  | `commands` | string arrays or `null`, feature switches for Enter/`s`/`m`, create's queued pair, `unitArgv` verbs, argv never carries unvalidated text |
  | `form` | defaults, name rules per kind, hostile table per field, guest normalisation and reserved paths, tag uniqueness, key regex, defaults written, `parse(emit(f)) == f`, edit visibility per kind |
  | `agent` | `agentFor`, exact claude flags, prompt contents, reply table, fill → validate → snippet |
  | `settings` | distrobox's cases with this id plus `aiAssist` |

- **B. Nix.** `nix flake check`, `nix flake check --all-systems --no-build`,
  `nix build` (13 files, no symlink), `omarchy plugin validate` on `result`
  and on a fresh clone without `.git`. Expected: all pass; the three planted
  faults each fail.
- **C. Live checklist**, after `omarchy-restart-shell`,
  `omarchy-shell shell ping`, clean `qs log`:
  1. Glyph counts and colours; `hideWhenEmpty`; middle-click refreshes.
  2. Every list key once per surface per kind; inapplicable keys absent.
  3. A mutation started in one surface is refused in the other.
  4. `toggle '{"create":true}'` gives the form focus.
  5. Disposable: create, start in terminal, stop, `x`; with upstream:
     streamed `s`, Enter attaches, `m` changes the template.
  6. Permanent: create writes one line and the service row; pending badge;
     `a` opens the terminal with the real prompts; after apply `s`/`r`/`l`
     work, Enter opens SSH; `m` with `opt replace`; `x` removes the line and
     `/var/lib/microvms/<n>` survives; hand-edited line is read-only.
  7. Assist: fill and reasoning; no tool use on a hostile prompt;
     unsupported agent hides the key; timeout.
  8. With everything closed only the bar's slow poll runs (`status.polls`).
  9. `SUPER + ALT + V` opens the menu; one bind on the chord.
  10. A theme switch recolours the panel live.
- **D. Docs and site.** Jekyll build, link check, `docs/img` ≤ 8 MB,
  captures reviewed, Pages URL and `/usage/` return 200 after merge.

## Rollback

- **Before merge:** close the PR and delete `feat/1-microvm-plugin`; `main`
  holds the initial commit and the artifacts.
- **After merge:** `git revert` the merge commit; the next Pages deploy
  republishes without the site, or turn Pages off in the repo settings.
- **Local install:** `omarchy plugin disable nixarchy.microvm`,
  `rm -rf ~/.config/omarchy/plugins/nixarchy.microvm`, `omarchy-restart-shell`
  (ends any stream). On a nixarchy host, drop
  `programs.nixarchy.plugins."nixarchy.microvm"` and rebuild. Remove the
  `o.bind("SUPER + ALT + V", …)` line and the `apps.microvm` row.
- **Test VMs and config:** `nixarchy vm rm t1 t2`; `nixarchy-opt-remove
  programs.nixarchy.services.microvm.machines.p1` and re-comment the
  `#@ microvm` row if it was off before; `nixarchy-apply` if `p1` was ever
  applied. `docs/capture.sh --teardown` is idempotent over its record;
  otherwise restore the four backups from `$XDG_RUNTIME_DIR` by hand.
- The Model steps (3-6) and the flake step (13) revert independently of the
  QML.

## Implementation record

### Deviations

### Test results
