---
layout: manual
title: The manual
permalink: /usage/
---

# Using nixarchy.microvm

A walkthrough, from installing the plugin to fixing the usual problems. The
reference tables (every key, every setting, IPC) are in the
[README](https://github.com/olafkfreund/nixarchy-microvm/blob/main/README.md).

## What it is

nixarchy can run NixOS inside small virtual machines, sharing the host's own
`/nix/store` so there is nothing to download or install. There are two kinds:

- a **disposable** VM is made with `nixarchy vm create`, lives under
  `~/.local/state/nixarchy/microvm/<name>/`, and needs no root and no rebuild;
- a **permanent** VM is declared in your configuration as
  `programs.nixarchy.services.microvm.machines.<name>`, boots with the host
  under systemd, and can forward an SSH port.

This plugin puts both on the Omarchy bar and behind a key. It lists them, and
lets you start, stop, create, edit and delete them without remembering the
vocabulary of either. Two things stay in a terminal by design: a VM's console,
and `nixarchy-apply`, which rebuilds your system.

## Requirements

- **`nixarchy-vm`** on your `PATH`, with `list --json`, `run --detach`,
  `console` and `set-template` (nixarchy#762, shipped 2026-09-19): it comes
  with nixarchy.
- **`systemctl`** and **`journalctl`** for permanent VMs.
- **`omarchy-launch-tui`**, **`omarchy-launch-floating-terminal-with-presentation`**
  and **`wl-copy`**: Omarchy ships all three.
- **nixarchy.pkg**, with `opt replace` (nixarchy-pkg#19, shipped 2026-09-19),
  for permanent VMs. This plugin writes their lines through that plugin's
  writers, so it must be installed at
  `~/.config/omarchy/plugins/nixarchy.pkg`. Without it, the permanent half of
  the create form says so and the keys that need it stay hidden.
- **`claude`** as your default agent, for AI assist
  (`omarchy default agent claude`). Any other agent hides the feature with a
  note; codex is a follow-up.

A command that is missing fails silently inside the shell, so check these first
when nothing happens.

## Install on NixOS (nixarchy)

Add the flake as an input and hand its package to nixarchy:

```nix
inputs.nixarchy-microvm = {
  url = "github:olafkfreund/nixarchy-microvm";
  inputs.nixpkgs.follows = "nixpkgs";
};

programs.nixarchy.plugins."nixarchy.microvm".src =
  inputs.nixarchy-microvm.packages.${pkgs.stdenv.hostPlatform.system}.default;
```

Rebuild, then enable it once: `omarchy plugin enable nixarchy.microvm`. The
glyph lands on the right side of the bar.

nixarchy will not replace a real directory at
`~/.config/omarchy/plugins/nixarchy.microvm`. If you installed it by hand
before, remove that directory first.

## Install without Nix

```bash
omarchy plugin add https://github.com/olafkfreund/nixarchy-microvm
omarchy plugin enable nixarchy.microvm
```

## The bar popup

Click the glyph, or run `omarchy shell nixarchy.microvm.bar open`.

The glyph is:
- accent-coloured while a VM runs;
- dim when none do;
- red when a permanent VM's unit has failed.

Middle-click refreshes.

The popup lists your VMs, running ones first. Each row shows:
- a state dot: filled when running, hollow when stopped, red when failed;
- the name and a badge saying *disposable* or *permanent*;
- the template, and where the VM comes from when that matters (*declared in
  your flake*, or *apps.nix, edited by hand*);
- the state: *stopped*, *not built yet*, *pending apply*, *removed, pending
  apply*.

Buttons on the right of each row do the same as the keys. A key that does not
apply to a row is not there, and the line above the footer says why, for
example "enter: set an SSH port and key to get a console".

### Size and text

Both surfaces size themselves from the screen they open on and from your
desktop text size, so a wider monitor gets a wider card and a longer list, and
`omarchy-display-text-size` moves everything together. The menu is not
magnified: its text is laid out at the size it is drawn, so it stays as sharp
as the rest of the desktop. If you want it bigger, raise the desktop text size
rather than looking for a setting here.

## The menu

The menu has the same list, form and log, on a bigger card. It opens centred
near the top of the focused screen, without dimming it, over whatever you were
working in. It holds the keyboard until you close it with Esc, or with a click
outside the card on the same screen:

```bash
omarchy-shell shell toggle nixarchy.microvm '{}'
omarchy-shell shell toggle nixarchy.microvm '{"create":true}'   # straight into the form
```

### Add it to the Omarchy menu

Paste the row in [`share/omarchy-menu.jsonc`](https://github.com/olafkfreund/nixarchy-microvm/blob/main/share/omarchy-menu.jsonc) into
`~/.config/omarchy/extensions/omarchy-menu.jsonc`. After that, searching for
vm, sandbox or microvm in the Omarchy menu (Super+Alt+Space) finds it.

### Give it a key

The plugin ships its key in `microvm-binds.lua`: `SUPER + ALT + V`, free in
Omarchy's defaults. It has to sit in `~/.config/hypr/`:

- with Nix, the flake's Home Manager module writes it
  (`imports = [ inputs.nixarchy-microvm.homeManagerModules.default ];`, and
  `programs.nixarchy-microvm.keybinding` to pick another chord, or `null`);
- without Nix, copy it from the plugin folder:
  `cp ~/.config/omarchy/plugins/nixarchy.microvm/microvm-binds.lua ~/.config/hypr/`.

Then add one line to `~/.config/hypr/bindings.lua`:

```lua
pcall(require, "hypr.microvm-binds")
```

Super+K, Omarchy's key bindings menu, then lists it as "MicroVMs". To see what
your own configuration has on that chord: `hyprctl binds -j | jq '.[] | select(.key=="V")'`.

### Bar and menu are one thing

Both surfaces show the same state. A build started in the menu shows up in the
popup's log, and while anything changes, a start or delete from the other
surface is refused. Closing a surface never stops a job.

The list refreshes every few seconds and sorts running machines first, so rows
move on their own. The cursor is tied to the machine you selected rather than
to a position in the list: start the VM you are on and the highlight travels
with it as it jumps to the top, so pressing `s` again stops that same machine
and not whatever slid into its place. If the selected machine leaves the list —
you deleted it, or the filter no longer matches it — the cursor stays at that
position and takes whichever row moves up.

## The overview

Press `v` in the list (with the filter not focused) to switch between the list
and the overview, or turn on **Open on the overview** (`overviewByDefault`, off
by default) so the panel opens there. Both views show the same VMs, and the
same cursor, mouse, action buttons and keys work in both.

Each card shows:
- the state dot, the name, and the *disposable* or *permanent* badge;
- the template, and where the VM comes from when that matters;
- the status when the VM is not running cleanly (*stopped*, *not built yet*,
  *pending apply*, *removed, pending apply*, or the verb in progress);
- for a running VM: `up <uptime> · <memory>` in binary units (`MiB` / `GiB`),
  its configured size, and a CPU sparkline with `cpu <n>%`, where `100%` is one
  core;
- `configured <memory> · <cores> cores` when the VM's size is known. A
  non-running VM with an unapplied change adds `(pending)`; a running VM with a
  pending edit hides the configured line until you apply, because the new size
  is not what is running.

The header shows `host <used> used · VMs <share> · <n> running`, with `· <n>
pending` and `· <n> failed` when there are any.

What the markers mean:
- `—`: a reading is not available yet (for example, a command failed or was
  refused, or no running VM could be read). The CPU percentage is a
  difference between two readings, so it appears from the second poll; the
  sparkline needs two percentages, so it appears from the third. Nothing is ever
  shown as `0` when it is unknown, and a failed read clears its old numbers
  rather than leaving them frozen.
- `(partial)` after the VMs' memory total: some running VMs answered and at
  least one did not, so the sum covers only the readable ones.

Readings (`systemctl show` for running units and `/proc/meminfo` for the host)
are taken only while a surface is open on the overview. Closing the panel,
switching back to the list with `v`, or opening the form or the log stops them
and clears the readings.

## Everyday tasks

### A throwaway shell

1. Press `c` (or run the `create` IPC / menu payload). The form opens at
   **Name**, with **Kind** set to *disposable*: type a name (letters, digits,
   `_` and `-`, starting with a letter).
2. Tab to **Template**. Press ↓ to move into the list, which shows each
   template's note, and Enter to pick one; `shell` is the default.
3. **Start it now** is on by default (Space flips it off if you only want to
   create the VM stopped).
4. Press Enter. The VM is created and starts in the background under one lock,
   and the panel switches to the **log**, showing the create output followed by
   its first build (a minute or two, much less once cached). Esc goes back to
   the list without stopping anything, and `o` shows the log again. The row
   gets a filled dot once the VM runs.
5. Press Enter on the running row. Its console opens in a terminal, at the
   guest's prompt. Ctrl-] leaves the console, and the VM keeps running.
6. `s` stops a running VM or starts a stopped one. `m` on a stopped one changes
   its template. `x` deletes it and its state directory, after asking (if it is
   running, `x` stops it first and then deletes it).

### A permanent machine with SSH

1. Press `c`, Shift+Tab to **Kind**, and press Space to flip it to *permanent*.
2. Fill in the name (lower-case letters, digits and `-`, starting with a
   letter), the template, and the rest:
   - **Start at boot**: on by default.
   - **Memory** in MiB and **Cores**.
   - **SSH and shares**: off by default, so the form stays short. Press Space
     to open the three fields below (it also opens on its own whenever you edit
     a VM that uses them, the agent fills one, or Enter flags an error in one):
     - **SSH port on the host**: empty means console only. With a port, the
       guest runs sshd on it. Each permanent VM in `apps.nix` needs its own host
       port; reusing one says "Port N is already used by <name>". A machine
       declared elsewhere in your flake is not checked.
     - **SSH public key**: press ↓ to pick one of your `~/.ssh/*.pub`. The
       guest's `dev` user has no password, so a port without a key reaches a
       daemon nobody can log into; the form warns.
     - **Shares**: `host:guest` pairs, space-separated, such as `~/src:/mnt/src`.
       The guest path must be absolute and cannot be `/`, `/nix` or `/mnt/host`,
       which the guest already uses, and two shares on the same VM cannot use the
       same guest path ("Two shares mount at <path>"). Neither side may contain
       a `.` or `..` segment — write the path you mean in full rather than
       reaching through a parent. `~/` needs a plain absolute `HOME`; if yours
       contains anything unusual, spell the host path out instead.
3. Press Enter. The **review** shows the exact line that will go into
   `~/.config/nixarchy/apps.nix`, the two commands that write it (the
   `microvm` service row, then the line), and a reminder that applying
   rebuilds the whole system. Enter writes it; Esc goes back to the form.
4. Once it is written, the surface that submitted it asks: `Apply now?
   nixarchy-apply rebuilds the whole system from apps.nix, in a terminal.`
   (Cancel is the default; **Apply** or `y` runs the same `nixarchy-apply` as
   `a`). Until you apply, the row says *pending apply* and the footer offers
   `a`. After the rebuild, the unit exists: `s` starts and stops it, `r`
   restarts it, `l` follows its journal, and Enter opens `ssh -p <port>
   dev@localhost` in a terminal.

To add NixOS modules beyond the SSH key, edit the line in `apps.nix` by hand.
The plugin then shows the VM as *apps.nix, edited by hand* and stops
rewriting it; it can still be started, stopped and watched.

### Edit

`m` on a permanent VM opens the same form with its values filled in (and **SSH
and shares** already open if the VM has a port, a key or shares); Enter goes to
the review again, which says `opt replace`, rewrites the line in place, and
asks `Apply now?`. While that change waits for apply, the VM's SSH console is
hidden with "apply the queued change first". `m` on a stopped disposable VM
changes its template.

### Delete

`x` asks first, and **Cancel** is the default answer. Answer from the keyboard
with `y` or `enter` for yes, `n` or `esc` for no — the question takes the
keyboard wherever you were, including out of the filter box. For a stopped
disposable VM it deletes the VM and everything in its state directory. For a
running disposable VM it asks `Stop and delete <name>, and everything in
<dir>?` once, stops the VM, waits for a fresh list to confirm it stopped
(re-sending the stop once at 30 s, and giving up at 90 s with `<name> did not
stop within 90 s; nothing was deleted`), and then deletes it, holding the lock
throughout (even if you close the panel while it waits). For a permanent VM it
removes the line from `apps.nix`; the row stays as "removed, pending apply", and
the unit and `/var/lib/microvms/<name>` stay until you apply (a delete never
asks to apply now). This plugin never deletes that directory.

### Apply

`a` (or answering **Apply** after a permanent create or edit) opens
`nixarchy-apply` in a floating terminal. It copies `apps.nix`, `services.nix`
and `advanced.nix` into your flake and runs the rebuild, asking for your
password on the way. The plugin never runs it for you.

## AI assist

With `claude` as your default agent, pressing `i` opens the create form right on
the **Describe it** field. Type a sentence, such as "a python box with 4 GB and my ~/src
shared", and press Enter. The plugin runs `claude` once, non-interactively,
with every tool switched off and a strict JSON schema for the answer, and
fills the form from what comes back: the kind, the name, the template, and for
a permanent VM the memory, cores, port and shares (turning **SSH and shares**
on when it sets a port or shares). Its short reasoning appears
under the field.

What it cannot do:
- run anything, read your files, or reach the network: the call has no tools;
- pick your SSH key: that field is yours;
- skip the form: every value is validated as if you had typed it, you can
  change any of them, and you still confirm with Enter (and the review, for a
  permanent VM).

Esc while it is thinking cancels the call; it gives up on its own after 90 s.
Only one surface can ask at a time: while a call runs in the menu, starting one
in the popup (or the other way round) says "the other surface is asking the
agent", and closing the other surface leaves the running call alone. The **AI
assist** setting turns the field off.

## Settings

The bar widget's settings are `refreshIntervalSec`, `showStopped`,
`hideWhenEmpty`, `aiAssist` and `overviewByDefault`. What each one does is in
the [README](https://github.com/olafkfreund/nixarchy-microvm/blob/main/README.md#settings). The menu reads the same settings.

## Troubleshooting

**"nixarchy-vm is not on PATH".** The plugin could not run `nixarchy vm`. It
comes with nixarchy; check `which nixarchy-vm` in a terminal.

**"VM list failed: …".** `nixarchy vm list` ran and exited with an error. The
last known rows stay on screen, and the header shows this message until a poll
succeeds again.

**Nothing happens on a key.** A command is missing (see Requirements), or the
key does not apply to that row: the line above the footer says why.

**A row says "pending apply" or "removed, pending apply".** Its line in
`apps.nix` was added, changed or removed, and the system has not been rebuilt
since. While a change waits, a permanent VM's console is hidden with "apply the
queued change first". Press `a`, or run `nixarchy-apply` yourself.

**"Failed to start microvm@…: Interactive authentication required" or
"Access denied".** systemd asked polkit and the prompt was refused, or no
polkit agent was running. To start and stop these units without a prompt,
add a rule such as:

```nix
security.polkit.extraConfig = ''
  polkit.addRule(function(action, subject) {
    if (action.id == "org.freedesktop.systemd1.manage-units" &&
        action.lookup("unit").indexOf("microvm@") == 0 &&
        subject.isInGroup("wheel")) {
      return polkit.Result.YES;
    }
  });
'';
```

**"checking nixarchy…", or "This plugin needs nixarchy…" / "This plugin needs
nixarchy-pkg…".** On startup the plugin checks `nixarchy-vm help` and, when
nixarchy.pkg is installed, `nixarchy-pkg opt replace`. Until both finish, every
action is absent and the hint line says `"checking nixarchy…"`. If either is
older than the 2026-09-19 releases
([`docs/upstream.md`](https://github.com/olafkfreund/nixarchy-microvm/blob/main/docs/upstream.md)),
the header and hint show one message (`This plugin needs nixarchy with nixarchy
vm run --detach, console and set-template (nixarchy#762); update nixarchy` or
`This plugin needs nixarchy-pkg opt replace (nixarchy-pkg#19); update
nixarchy.pkg`) and actions stay disabled until you update.

**"services.nix predates the microvm row" under Kind.** Your
`~/.config/nixarchy/services.nix` was created before nixarchy had the
`microvm` row, and nothing rewrites that file once it exists, so a permanent
VM can't be written yet. Copy the line ending in `#@ microvm` from
`/etc/nixarchy/services-template.nix` into your `services.nix`. The warning
clears as soon as you save. Once nixarchy adds a missing row itself
([nixarchy#843](https://github.com/olafkfreund/nixarchy/issues/843)), the
plugin detects that and stops warning.

**AI assist shows an error under the field.** The line is claude's own
message when it gave one, for example "Failed to authenticate: OAuth session
expired". An expired login is the usual cause: run `claude` in a terminal and
log in again. `claude -p hi` checks that it answers.

**The first run says it fell back to `main`.** `nixarchy vm` builds the VM
from the nixarchy commit your system was built from. If that commit is not on
GitHub (a dirty checkout, or one never pushed), it builds from `main` instead
and says so. The VM still works; its template may differ slightly.

**A permanent VM shows "apps.nix, edited by hand" and has no `m` or `x`.**
The line under its `#@opt` marker is not one this plugin wrote, so it will not
touch it. Edit or remove it in `apps.nix`.

**"declared in your flake".** The unit exists but there is no line for it in
`apps.nix`, so it was declared somewhere else. Start, stop and logs work; edit
it where it is declared.

**A field says it cannot contain a character.** Every field is checked before
anything is written. Paths use letters, digits and `_ . / + -`; a permanent
name is lower-case letters, digits and `-`; shares are `host:guest` pairs.

**"Busy: run demo-python — press o to watch".** Only one change runs at a
time, across the popup and the menu, and multi-step jobs (create-and-start,
stop-and-delete) hold the lock from start to finish. The message names the job
holding the lock. `o` shows its log, and the key works again once the job
finishes.

**"<name> did not stop within 90 s; nothing was deleted".** Deleting a running
disposable VM stops it first and waits up to 90 s for a fresh list to show it
stopped (re-sending the stop at 30 s). If it is still running after 90 s (or if
you press `X` after a minute, which says `gave up waiting for <name>; nothing
was deleted`), the delete is skipped so the state directory of a running VM is
never removed.

**A change that will not finish.** While something runs, the footer reads
`working…` and names it. If it is still going after a minute, the footer adds
`— X gives up` and a button appears beside it. `X` asks the command to stop and
kills it three seconds later if it ignores that. The lock is released only once
the command is actually gone, never on a timer — so a write to `apps.nix` can
never be abandoned while it is still writing. A build you are watching in the
log is never offered `X`: it is slow, not stuck.

**A running build stopped.** Restarting or reloading the shell ends a stream
it was running. Start it again.

## Removal

```bash
omarchy plugin disable nixarchy.microvm
```

Then remove the `programs.nixarchy.plugins."nixarchy.microvm"` line and
rebuild. Without Nix, delete `~/.config/omarchy/plugins/nixarchy.microvm`
instead. Your VMs, and the lines in `apps.nix`, are not touched.
