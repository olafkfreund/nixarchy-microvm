# AGENTS.md

Instructions for any AI agent working in this repository: Claude Code, Codex, Copilot,
Gemini or others. `CLAUDE.md` and `.github/copilot-instructions.md` point here. This
file is the single source. When anything disagrees with it, this file wins.

## What this repository is

`nixarchy.microvm` is an [Omarchy](https://omarchy.org/) shell plugin written in
Quickshell QML. It manages the two kinds of NixOS MicroVM that
[nixarchy](https://olafkfreund.github.io/nixarchy/) has, in one list, through two
surfaces:

- **a bar widget**, whose popup sits under the glyph (`Panel.qml`);
- **a full-screen keyboard menu** (`Menu.qml`).

The two kinds:

- **disposable** VMs from `nixarchy vm` (state under
  `$XDG_STATE_HOME/nixarchy/microvm/<name>/`, no root, no rebuild);
- **permanent** machines declared as
  `programs.nixarchy.services.microvm.machines.<name>`, each a `microvm@<name>`
  system unit.

It lists both, and can start, stop, restart, open the console or logs, create, edit
and delete them. A permanent VM is written as one line into
`~/.config/nixarchy/apps.nix` through nixarchy.pkg's writers; applying is the user's
own `nixarchy-apply` in a terminal. Optional AI assist asks the default agent for a
form, never for an action.

`flake.nix` packages the plugin for NixOS and nixarchy. The user guide is
[`docs/usage.md`](docs/usage.md). The design is in `intent/`, `spec/` and `plan/`.

## Layout

| Path | Owns |
| --- | --- |
| `Model.js` | All logic: parsing CLI, systemd and apps.nix output, rows, validation, the snippet grammar, the agent prompt and reply, and every command's argv. Pure `.pragma library` with no QML, tested under Node. |
| `schema.json` | The JSON Schema handed to the agent. One copy, read at runtime and by the tests. |
| `qmldir` | Declares `MicrovmState` a singleton, so the bar and the menu share one instance. |
| `MicrovmState.qml` | Data, polling, feature detection, the operation lock, the stream log, the agent call, and every `Process`. |
| `MicrovmView.qml` | Interaction: modes (list / form / review / log), cursor, filter, confirmations, keys. Shared by both surfaces. |
| `VmList.qml`, `CreateForm.qml`, `LogView.qml`, `ShortcutSheet.qml` | Drawing pieces used by the view. |
| `Panel.qml` | The bar widget host: glyph, `KeyboardPanel` popup, and IPC target `nixarchy.microvm.bar`. |
| `Menu.qml` | The full-screen menu host (manifest kind `menu`). It sizes its card from the focused screen and hosts the view unscaled. |
| `manifest.json` | Plugin id `nixarchy.microvm`, kinds `menu` + `bar-widget`, `keepLoaded: true`, settings schema. |
| `flake.nix` | The package (an explicit `files` list, copied as real files) and `checks.<system>.default`. |
| `share/omarchy-menu.jsonc` | The Omarchy menu row users paste in. |
| `tests/` | Node tests for `Model.js` (`tests/run.js`). |
| `docs/` | The user guide and the GitHub Pages site. `docs/upstream.md` tracks the two upstream issues. |
| `intent/`, `spec/`, `plan/` | Design artifacts for each task. See Workflow. |

## Commands

```bash
node tests/run.js                              # Model tests
nix flake check                                # everything flake.nix enforces; each block names itself
nix flake check --all-systems --no-build       # aarch64 evaluates
nix build                                      # the plugin folder, exactly as nixarchy links it
omarchy plugin validate "$(readlink -f result)"
```

To see the repo the way `omarchy plugin add` would, validate a fresh clone rather than
the working tree. The `result` link that `nix build` leaves behind is a symlink, so
validating `.` fails once you have built:

```bash
d=$(mktemp -d) && git clone -q . "$d/p" && rm -rf "$d/p/.git" && omarchy plugin validate "$d/p"
```

## Verifying live (on a nixarchy desktop)

1. **Install a copy with the shell stopped** (a symlinked checkout does not
   reload on `rescanPlugins`). Changing a plugin folder, or saving
   `shell.json`, while the shell runs makes it reload live, and that reload
   blanks the bar (nixarchy#847). Stop, swap, start:
   ```bash
   while quickshell kill -p "$OMARCHY_PATH/shell" --any-display >/dev/null 2>&1; do :; done
   rm -rf ~/.config/omarchy/plugins/nixarchy.microvm
   cp -rL result ~/.config/omarchy/plugins/nixarchy.microvm
   chmod -R u+w ~/.config/omarchy/plugins/nixarchy.microvm
   omarchy-restart-shell    # nothing left to kill, so it only starts the shell
   ```
   The first time, run `omarchy plugin enable nixarchy.microvm` before
   `omarchy-restart-shell`: it writes `shell.json`. Putting the owner's
   plugin back (the Home Manager link) goes in the same order.
2. **Wait for the shell** until `omarchy-shell shell ping` answers.
3. **Check the log and the bar.** Get the instance from `qs list --all`, then
   run `qs log -i <instance>`. The bar is healthy when
   `qs log -i <instance> | grep -c pluginBarApiFor` is 0 and
   `qs ipc -p "$OMARCHY_PATH/shell" show | grep -cx 'target omarchy.bar'`
   is 1. A blank bar (only a chevron) means restart the shell before anything
   else: the ai-mirror control dialog is drawn in the bar, so every control
   request lapses unseen while it is blank.
4. **Open each surface:**
   - the menu: `omarchy-shell shell toggle nixarchy.microvm '{}'`, or
     `'{"create":true}'` to open straight into the form;
   - the popup: `omarchy shell nixarchy.microvm.bar open`.
5. **Confirm what is up** with `hyprctl layers -j`. The menu's namespace is
   `nixarchy-microvm-menu`.
6. **Test VMs:** disposable ones named `t1`, `t2` and so on, removed with
   `nixarchy vm rm` when done. A permanent test machine is one `p1` line in
   `apps.nix`, removed with `nixarchy-opt-remove
   programs.nixarchy.services.microvm.machines.p1`. Never run `nixarchy-apply` as
   part of a test unless the owner asked for a rebuild.

## Retaking the captures

Real captures only, and never of anything but the plugin, `demo-*` VMs, the
host's own permanent machine and the wallpaper:

1. **Stage.** Run `docs/capture.sh --setup`. It refuses if any `demo-*` VM
   already exists, creates `demo-shell` and `demo-python`, and saves
   `apps.nix`, `services.nix`, `shell.json` and `omarchy-menu.jsonc` under
   `$XDG_RUNTIME_DIR`. It writes nothing to `apps.nix`: the permanent row in
   the captures is whatever machine the host declares. Snapshot the two
   nixarchy files and note do-not-disturb (`omarchy-shell notifications
   isDnd`) and the workspace on each monitor; turn do-not-disturb on
   (`setDnd true`).
2. **Clear the screen.** Put the monitor the popup lands on (the bar that
   holds the widget) and the focused monitor (where the menu opens) on empty
   workspaces with `hyprctl dispatch 'hl.dsp.focus({ workspace = "23" })'`;
   a plain `hyprctl dispatch workspace N` is ignored by the workspace groups.
   Park the pointer with `hl.dsp.cursor.move`, then *reopen* the surface, or
   a hover tooltip stays in the shot.
3. **Drive the surfaces.**
   - Open them with IPC, and send keys with `wtype`, **only while a plugin
     layer is up**: `wtype` types into whatever has focus. A stray Enter on
     the list row under the cursor starts that VM in a terminal, which then
     takes the keys; it happened once here. Right before sending, check
     that your ai-mirror grant is held and `hyprctl layers -j` shows
     `omarchy-keyboard-panel` or `nixarchy-microvm-menu`.
   - Send the whole take as **one** `wtype` process under `timeout`, with
     `-s` delays, rather than one call per key. Send `-` as `-k minus`: a
     lone `-` makes `wtype` read standard input and hang. ai-mirror before
     its #26 fix refuses to type into a layer-shell panel ("typing must name
     the window"), so it can grant control but not type here.
   - `hyprctl layers -j` says which monitor the menu chose.
   - The owner must not be using the desktop. If a workspace changes under
     you, stop.
   - Take stills with `docs/capture.sh --shot NAME X,Y WxH`, cropped to the
     card. The card is derived from the screen and the desktop text size, so
     it has no fixed width: 456 px and 1028 px were the popup and the menu
     measured on DP-1 at text size 12, not constants. Take a full-output shot
     first, read the card rectangle off it, then crop; `--shot` keeps its fixed
     geometry.
   - Record with `wl-screenrec -g …`. It refuses a region that crosses an
     output edge by even one pixel.
   - The SSH key list shows the owner's public keys: clear the field before
     a still, or crop it out.
4. **Encode.** WebM (VP9, `-crf 40`) and MP4 (H.264, `-crf 28`). Look at
   every still, and at a frame sheet of every video
   (`ffmpeg -vf fps=1,scale=…,tile=…`), before committing.
5. **Tear down.** Run `docs/capture.sh --teardown` (it stops and removes only
   the recorded `demo-*` VMs, `demo-new` from the recording included, and
   restores any of the four files that changed; an untouched `shell.json` is
   left alone, since writing it blanks the bar), restore do-not-disturb and
   the workspaces, check the bar (Verifying live, step 3), and
   diff `apps.nix` and `services.nix` against the snapshot. `docs/img/` must
   stay under 8 MB, and CI enforces it: it ships inside every `omarchy plugin
   add` clone.

## Rules

Each rule records a real failure or a hard constraint. A rule carrying
`(checked: <name>)` is enforced by the `# check: <name>` block of that name in
`flake.nix`, which is the source of truth for what `nix flake check` does; the
`docs-sync` check fails if the two lists ever disagree. `(by hand)` means what
it says.

The checks with no rule of their own here: `(checked: tests)` runs
`tests/selftest.js` and `tests/run.js`; `(checked: manifest)`,
`(checked: entry-points)` and `(checked: schema)` assert the manifest loads,
its entry points exist, and `schema.json` is strict with no `$schema` key;
`(checked: binds)` keeps the default chord verbatim in `microvm-binds.lua`;
`(checked: img-budget)` holds `docs/img` under 8 MB; and `(checked: docs-sync)`
is the check that keeps this paragraph honest.


- **No symlinks anywhere in the repository.** *(checked: symlinks)* `omarchy plugin add` clones this repo
  *as* the plugin folder, and `omarchy-plugin-validate` refuses any symlink inside
  it. That is why `CLAUDE.md` imports `AGENTS.md` instead of linking to it.
- **A surface derives its card from the screen and its body from the height its
  host gave it.** *(by hand)* No render transform: text is laid out at the size it
  is drawn. `Style.space()` is a rem unit and tracks the desktop text size only,
  so a fixed `Style.space()` dimension is the same physical size on every monitor.
- **No hardcoded colours.** *(checked: colours)* Use `Color.*`, `Style.*` and
  `Border.*` tokens, so themes switch cleanly. Hex in either quote style, a CSS
  colour function in a string, a bare colour name and an all-literal `Qt.rgba`
  all fail, in `*.qml` and `Model.js`. `"transparent"` and a `Qt.rgba` derived
  from a token are allowed.
- **No `pacman` or `yay`**, not even in comments. *(checked: pacman)* nixarchy
  fails the rebuild on them. The whole clone is scanned except `intent/`,
  `spec/`, `plan/`, `flake.nix` and the allow-list itself; every other
  legitimate occurrence is one reviewable line in `tests/pacman-allowed.txt`.
- **A new runtime file goes in the `files` list in `flake.nix`**, or it is not in
  the package. *(checked: files-list)* The repository root minus a deny-list must
  equal the package, both ways, so an unrecognised new root file fails until
  someone classifies it.
- **Run external commands by name from `PATH`.** The one exception is
  nixarchy.pkg's adapter, which is not on `PATH` and is resolved at
  `$XDG_CONFIG_HOME/omarchy/plugins/nixarchy.pkg/bin/nixarchy-pkg`, and every
  feature that needs it is hidden when it is missing. A missing command fails
  silently inside a QML `Process`, so document it as a requirement.
- **Argv arrays only, never `sh -c`.** Every command is built in `Model.js` as an
  array and returns `null` on invalid input.
- **The agent's reply is data for the form and nothing else.** `schema.json`
  goes *out* with the call, as `--json-schema`, to shape the model's answer; it
  is not a gate on the way back. The gate is the per-field conversion in
  `Model.applyAgentReply`, which is stricter than the schema: a value of the
  wrong type is dropped rather than coerced, a key absent from `AGENT_FIELDS`
  is dropped — so `sshKey`, `describe` and `editing` are not agent-settable at
  all — `kind` must be in `KINDS`, and strings pass `sanitize` at the field's
  own length. Every value that survives goes through `validateForm` as if the
  user had typed it, is shown, and is confirmed by them; `machineSnippet`
  refuses the line outright if `nixSafe` ever fails on it. The schema and
  `AGENT_FIELDS` may not name different fields *(checked: schema-fields)*.
  Nothing in a reply is executed, and the call itself runs `claude` with
  `--restricted --strict-mcp-config --tools ""`.
- **Every permanent-VM write goes through nixarchy.pkg's writers.** `opt set`,
  `opt replace`, `nixarchy-opt-remove` and `nixarchy-service-enable`, never a file
  write, never `/var/lib/microvms`, never a unit file, never the flake. Applying is
  `nixarchy-apply` in a terminal the user watches.
- **The snippet grammar is the only Nix this repository emits**, and
  `Model.parseMachineSnippet` must keep reading everything `Model.machineSnippet`
  writes (`parse(emit(f)) == f` is a test). A line a user changed by hand outside the
  grammar is shown read-only, never rewritten.
- **Every `nixarchy vm` feature is detected, not assumed.** `list --json` by the
  output's first byte, `run --detach`, `console` and `set-template` by
  `nixarchy-vm help`. A key that needs a missing feature is absent, not broken.
- **Disposable state is never touched except through `nixarchy-vm`.** No file
  under the state directory is written by this plugin.
- **One mutation at a time, via the singleton.** Start, stop, restart, create, edit
  and delete are refused while another mutation runs, from either surface. Listing,
  console, logs, copy, apply and the agent call never lock.
- **One `singleton MicrovmState` line in `qmldir`.** *(checked: singleton)*
  Without it the bar and the menu each get their own state, and "one mutation at
  a time" silently stops holding.
- **Lists read through a QObject `var` property are Qt sequence wrappers, not JS
  arrays.** Check `length`, not `Array.isArray` (see `Model.settingsFor`).
- **The surfaces are keep-loaded.** `open()` resets the view and then focuses
  whatever belongs to the *final* mode, via `Qt.callLater`. It never touches the
  stream or the log.
- **Nothing polls while every surface is closed.** The bar's slow poll for the
  glyph is the only exception.
- **Logic goes in `Model.js`, with a Node test.** Keep QML to drawing and wiring.
- **A user-visible change updates `docs/usage.md` and the README in the same PR.**
  *(by hand)* The README holds the key tables; `docs/usage.md` points at them
  (`docs/usage.md:11`) rather than repeating them, so a key change is a README
  change plus whatever prose in `docs/usage.md` describes the behaviour.

## Workflow

Any task that is tracked as an issue, or that touches more than one file, goes
through three artifacts named with the slug `YYYY-MM-DD-<issue>-<slug>`. Typos,
lock bumps and one-line config changes are exempt.

1. `intent/<slug>.md` (why), committed as `status: draft`. Stop for the owner's
   review.
2. After approval, `spec/<slug>.md` (what). Stop.
3. After approval, `plan/<slug>.md` (how, self-contained). Stop.
4. Implement only once the plan is `status: approved`.

- Never approve an artifact yourself.
- Record each approval as its own commit, for example
  `docs(plan): approve <slug> (#N)`.
- Make one commit per plan step, and cite the step.
- If the work deviates from the plan, update `plan/` in the same commit as the
  code.
- The PR links all three artifacts and closes the issue. Review compares the diff
  to `plan/`.

Branches are named `feat|fix|docs/<issue>-<slug>`. Commit subjects use Conventional
Commits (`feat:`, `fix:`, `docs:`, `build:`, `ci:`, `refactor:`), each with the
issue number.

## Known follow-ups

- codex as an assist agent, once a no-tools mode is verified by behaviour.
- Disposable rename, per-VM memory and cores, and `r` for disposable VMs.
- The upstream issues in `docs/upstream.md`: every key they unlock is already
  wired and hidden until the feature is detected.
- Wire p620 to this flake.
