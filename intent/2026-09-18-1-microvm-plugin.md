---
status: draft
issue: 1
author: olafkfreund
---

# Intent: Keyboard-driven MicroVM plugin for Omarchy (bar widget and menu)

## Problem

nixarchy already has two kinds of NixOS MicroVM, and both are terminal-only:

- **Disposable VMs** from `nixarchy vm` (`pkgs/microvm.nix` in nixarchy):
  `templates`, `list`, `create`, `run`, `stop`, `rm`, with state under
  `~/.local/state/nixarchy/microvm/<name>/`. No root, no rebuild.
- **Permanent VMs** declared as
  `programs.nixarchy.services.microvm.machines.<name>`
  (`modules/services/microvm.nix`). Each one becomes a
  `microvm@<name>.service` with state under `/var/lib/microvms/<name>`.

That leaves these gaps next to our other Omarchy plugins (nixarchy-distrobox,
nixarchy-podman, nixarchy-pkg):

- **Nothing on the desktop shows VM state.** You need a terminal to see
  whether a VM is running. `nixarchy vm list` prints aligned text meant for
  people, not machine-readable output, and it does not include the permanent
  machines at all.
- **`run` holds a terminal.** It builds the closure (minutes the first time),
  then attaches the guest console in the foreground. Nothing shows progress
  anywhere else.
- **Creating and editing need you to know the vocabulary.** For a disposable
  VM that means picking a template. For a permanent one it means writing a Nix
  attrset (template, memory, cores, sshPort, shares, modules) in your own
  flake and rebuilding. A mistake only shows up at rebuild.
- **Two kinds of VM, two mental models.** Nothing puts both in one list or
  explains which kind to pick.
- **Not keyboard-first, not themed.** No existing tool follows the Omarchy
  theme or the keyboard model the sibling plugins share.

## Proposed outcome

- A plugin with id `nixarchy.microvm` that has the same two surfaces as
  nixarchy.distrobox:
  - a bar glyph showing running/total VMs, with a keyboard popup;
  - a full-screen keyboard menu, opened by
    `omarchy-shell shell toggle nixarchy.microvm '{}'`, an Omarchy menu row,
    and a suggested key bind.
- One list that holds both kinds of VM, each row labelled disposable or
  permanent, running ones first. From the keyboard you can start, stop,
  open the console, create, edit, delete and copy a name. Actions that do not
  apply to a row's kind are hidden, not greyed out.
- A keyboard create/edit form with inline validation before anything runs:
  - disposable: name and template;
  - permanent: the fields `services.microvm.machines.<name>` takes. It
    produces a Nix snippet you can review, then hands off to the existing
    nixarchy apply flow (the way nixarchy-pkg does). It never edits system
    files on its own.
- **Optional AI assist.** You describe the VM in a sentence ("a python box
  with 4 GB and my ~/src shared"). The Omarchy default agent
  (`omarchy-default-agent`) proposes a form. The form validates it and you
  confirm it. The agent never runs anything itself. Without an agent the
  plugin works exactly the same, minus that one key.
- Long jobs (first build, run, rebuild) stream into a log inside the panel.
  Esc hides the log while the job keeps running. `o` brings it back.
- It looks like the sibling plugins and follows theme switches: `Color.*` and
  `Style.*` only.
- It is packaged as a flake with the same checks as nixarchy-distrobox, plus
  `docs/usage.md`, a README and `AGENTS.md`.
- A public GitHub Pages site with a showcase and onboarding guide, styled
  after the nixarchy site.

## Affected users and systems

- This new public repository, `github.com/olafkfreund/nixarchy-microvm`, and
  its GitHub Pages site.
- nixarchy hosts that add it through `programs.nixarchy.plugins`. p620 has
  the microvm service commented out today. Host wiring is a separate change,
  made after this one merges.
- Runtime requirements, all on `PATH`:
  - `nixarchy-vm`;
  - `systemctl`/`journalctl` for permanent machines;
  - `omarchy-launch-tui` and `wl-copy`, which Omarchy provides;
  - `omarchy-default-agent` plus the agent itself, for the optional AI key.
- Possibly `nixarchy` itself, if `nixarchy vm` needs a machine-readable
  `list` or a detached `run` (see open question 2).

## Constraints

- Follow the nixarchy-distrobox rules:
  - no symlinks anywhere in the repository;
  - `Color.*` and `Style.*` only, never a hex colour;
  - no pacman or yay, not even in comments;
  - every runtime file listed in the flake;
  - external tools called by name from `PATH`;
  - logic in `Model.js` with Node tests;
  - no polling while the surfaces are closed;
  - reset state when the keepLoaded plugin opens;
  - docs updated in the same PR.
- **Never hand user input or agent output to a shell.** Commands are argv
  arrays. Names, templates and Nix values are checked against allowlists.
  Agent output is data that fills the form, never a command.
- **Declarative stays declarative.** A permanent VM is changed through the
  user's flake and a rebuild, never by writing to `/var/lib/microvms` or to
  unit files directly.
- One mutating operation at a time, shared by the bar and the menu.
- Package with `runCommand` and real file copies, using only the nixpkgs
  input. It must pass `omarchy-plugin-validate`.

## Open questions

1. **Permanent VMs in v1.** Proposal: the list shows them and supports
   start/stop/restart/logs through `systemctl` (with a polkit prompt).
   Create and edit produce a snippet plus the nixarchy apply hand-off, and
   delete removes the entry the same way. Or should v1 cover disposable VMs
   only, with permanent ones as a follow-up?
2. **Upstream changes to `nixarchy vm`.** A dependable plugin wants
   `nixarchy vm list --json` and `nixarchy vm run --detach` (build, then run
   without holding a console, with a separate `console` command). Proposal:
   add them to nixarchy in a small separate PR, and until then parse the
   text output and open `run` in a terminal. Agreed, or should the plugin
   carry no nixarchy changes at all?
3. **Editing a disposable VM.** Today it only has a template. Editing means
   changing the template (rebuilt on the next run) or renaming. Per-VM
   memory/cores would need `nixarchy vm` changes. In scope for v1?
4. **AI assist behaviour.** Proposal: call the default agent without a UI,
   ask for a strict JSON object, pre-fill the form from it, and show the
   agent's short reasoning next to it. Or open the agent interactively in a
   terminal with the context loaded?
5. **Key bind.** `SUPER + ALT + V` (for VM) if it is free, or another one?
6. **Pages in the same PR** as the plugin, or a follow-up issue as with
   nixarchy-distrobox (#3)?
