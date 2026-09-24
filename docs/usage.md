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
  `~/.local/state/nixarchy/microvm/<name>/`, needs no root and no rebuild,
  and runs only while you are attached to it;
- a **permanent** VM is declared in your configuration as
  `programs.nixarchy.services.microvm.machines.<name>`, boots with the host
  under systemd, and can forward an SSH port.

This plugin puts both on the Omarchy bar and behind a key. It lists them, and
lets you start, stop, create, edit and delete them without remembering the
vocabulary of either. Two things stay in a terminal by design: a VM's console,
and `nixarchy-apply`, which rebuilds your system.

## Requirements

- **`nixarchy-vm`** on your `PATH`: it comes with nixarchy.
- **`systemctl`** and **`journalctl`** for permanent VMs.
- **`omarchy-launch-tui`**, **`omarchy-launch-floating-terminal-with-presentation`**
  and **`wl-copy`**: Omarchy ships all three.
- **nixarchy.pkg**, for permanent VMs. This plugin writes their lines through
  that plugin's writers, so it must be installed at
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
- the state: *stopped*, *not built yet*, *pending apply*.

Buttons on the right of each row do the same as the keys. A key that does not
apply to a row is not there, and the line above the footer says why, for
example "enter: set an SSH port and key to get a console".

## The full-screen menu

The menu has the same list, form and log, drawn larger. It opens over whatever
you were working in and holds the keyboard until you close it:

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

## Everyday tasks

### A throwaway shell

1. Press `c`. The form opens on **Kind**: leave it at *disposable*.
2. Tab to **Name** and type one (letters, digits, `_` and `-`, starting with a
   letter).
3. Tab to **Template**. Press ↓ to move into the list, which shows each
   template's note, and Enter to pick one; `shell` is the default.
4. Press Enter. The VM is created, and its row says *stopped*.
5. Press `s` on the row. The VM starts in the background, and its first build
   (a minute or two, much less once cached) streams into the panel. Esc goes
   back to the list without stopping anything, and `o` shows the log again.
   The row gets a filled dot once the VM runs.
6. Press Enter on the running row. Its console opens in a terminal, at the
   guest's prompt. Ctrl-] leaves the console, and the VM keeps running.
7. `s` on a running VM stops it. `m` on a stopped one changes its template.
   `x` deletes it and its state directory, after asking; stop it first.

On a nixarchy from before
[nixarchy#762](https://github.com/olafkfreund/nixarchy/issues/762), there is
no background start: Enter and `s` open `nixarchy vm run` in a terminal, and
closing that terminal stops the VM.

### A permanent machine with SSH

1. Press `c`, then Space on **Kind** to flip it to *permanent*.
2. Fill in the name (lower-case letters, digits and `-`, starting with a
   letter), the template, and the rest:
   - **Start at boot**: on by default.
   - **Memory** in MiB and **Cores**.
   - **SSH port on the host**: empty means console only. With a port, the
     guest runs sshd on it.
   - **SSH public key**: press ↓ to pick one of your `~/.ssh/*.pub`. The
     guest's `dev` user has no password, so a port without a key reaches a
     daemon nobody can log into; the form warns.
   - **Shares**: `host:guest` pairs, space-separated, such as `~/src:/mnt/src`.
     The guest path must be absolute and cannot be `/`, `/nix` or `/mnt/host`,
     which the guest already uses. Neither side may contain a `.` or `..`
     segment — write the path you mean in full rather than reaching through a
     parent. `~/` needs a plain absolute `HOME`; if yours contains anything
     unusual, spell the host path out instead.
3. Press Enter. The **review** shows the exact line that will go into
   `~/.config/nixarchy/apps.nix`, the two commands that write it (the
   `microvm` service row, then the line), and a reminder that applying
   rebuilds the whole system. Enter writes it; Esc goes back to the form.
4. The row now says *pending apply*, and the footer offers `a`. That opens
   `nixarchy-apply` in a terminal, where you answer its questions and watch
   the rebuild. After it, the unit exists: `s` starts and stops it, `r`
   restarts it, `l` follows its journal, and Enter opens `ssh -p <port>
   dev@localhost` in a terminal.

To add NixOS modules beyond the SSH key, edit the line in `apps.nix` by hand.
The plugin then shows the VM as *apps.nix, edited by hand* and stops
rewriting it; it can still be started, stopped and watched.

### Edit

`m` on a permanent VM opens the same form with its values filled in; Enter goes
to the review again, which says `opt replace`, and rewrites the line in place.
`m` on a stopped disposable VM changes its template. On an older install
without nixarchy-pkg's `opt replace` or `nixarchy vm set-template`, the key is
hidden and the footer says so.

### Delete

`x` asks first, and **Cancel** is the default answer. For a disposable VM it
deletes the VM and everything in its state directory. For a permanent VM it
removes the line from `apps.nix`; the unit and `/var/lib/microvms/<name>` stay
until you apply, and this plugin never deletes that directory.

### Apply

`a` opens `nixarchy-apply` in a floating terminal. It copies `apps.nix`,
`services.nix` and `advanced.nix` into your flake and runs the rebuild, asking
for your password on the way. The plugin never runs it for you.

## AI assist

With `claude` as your default agent, the create form starts with a **Describe
it** field. Type a sentence, such as "a python box with 4 GB and my ~/src
shared", and press Enter. The plugin runs `claude` once, non-interactively,
with every tool switched off and a strict JSON schema for the answer, and
fills the form from what comes back: the kind, the name, the template, and for
a permanent VM the memory, cores, port and shares. Its short reasoning appears
under the field.

What it cannot do:
- run anything, read your files, or reach the network: the call has no tools;
- pick your SSH key: that field is yours;
- skip the form: every value is validated as if you had typed it, you can
  change any of them, and you still confirm with Enter (and the review, for a
  permanent VM).

Esc while it is thinking cancels the call; it gives up on its own after 90 s.
The **AI assist** setting turns the field off.

## Settings

The bar widget's settings are `refreshIntervalSec`, `showStopped`,
`hideWhenEmpty` and `aiAssist`. What each one does is in the
[README](https://github.com/olafkfreund/nixarchy-microvm/blob/main/README.md#settings). The menu reads the same settings.

## Troubleshooting

**"nixarchy-vm is not on PATH".** The plugin could not run `nixarchy vm`. It
comes with nixarchy; check `which nixarchy-vm` in a terminal.

**Nothing happens on a key.** A command is missing (see Requirements), or the
key does not apply to that row: the line above the footer says why.

**A row says "pending apply".** Its line is in `apps.nix` but the system has
not been rebuilt since. Press `a`, or run `nixarchy-apply` yourself.

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

**A VM started from Enter stopped when I closed the terminal.** That happens
on a nixarchy from before nixarchy#762, where the terminal running `nixarchy vm
run` holds the VM. Update nixarchy to get the background start, or leave the
terminal open.

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

**Some keys are missing that the docs mention.** Enter on a running disposable
VM, `s` with a log in the panel, `m` on a disposable VM, and `m` on a
permanent VM each need an upstream change that has shipped, and that this
plugin detects at runtime. An older install lacks them:
[`docs/upstream.md`](https://github.com/olafkfreund/nixarchy-microvm/blob/main/docs/upstream.md)
lists them and what happens without each.

**"Busy: run demo-python — press o to watch".** Only one change runs at a
time, across the popup and the menu. The message names the job holding the
lock. `o` shows its log, and the key works again once the job finishes.

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
