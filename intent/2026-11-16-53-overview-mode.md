---
status: approved
issue: 53
author: olafkfreund
---

# Intent: an overview of what the VMs cost

Closes #53.

- **Builds on #49 (PR #52) and #50 (PR #51).** It uses the list, the form and
  the menu card they change.
- **Revised after Codex and agy reviewed the first draft.** The owner's
  answers to the open questions are recorded under Decisions.
- **Line numbers** are on `origin/feat/49-simplify-create-delete`.

## Problem

The list shows which VMs exist and whether they run. It does not show what
they cost.

- **Each running VM.** The memory it uses, how busy its CPU is, and how long
  it has been up are all invisible.
  - `VmList.qml:178-234` draws only the name, kind, template and ownership,
    and the status.
  - A VM holding 7 GiB, or using a whole core, looks the same as an idle one.
- **All VMs together.** Nothing says how much of the host's memory the VMs
  take between them. The summary is counts only (`Model.js:672`, `:677`).
  The user can't tell whether one more VM will crowd the machine.
- **Configured size.** A permanent VM's configured memory and cores are read
  from its `apps.nix` line (`Model.js:393-394`), but only the edit form ever
  shows them. A permanent VM declared elsewhere in the flake has no
  configured values the plugin can read.

makors/agency shows what the owner likes: each running desktop gets a card
with live vitals, next to the machine's own memory.

The readings are there to be had. A VM started by the plugin runs as a
systemd unit:
- a user unit for a disposable VM;
- a system unit for a permanent one.

systemd keeps memory, CPU time and start time for each unit. On this host,
the disposable VM `live1` reads 7.0 GiB in use without root. Not every
running VM has such a unit, though: a VM started from a terminal without
`--detach` runs in the foreground, with no unit of its own. Its readings may
not exist.

## Proposed outcome

- **An overview view, opt-in.**
  - A setting chooses the default view, and the list stays the default.
  - A key switches between the list and the overview while a surface is open.
  - The setting reaches both surfaces, the bar popup and the menu.
- **The overview shows the same VMs as the list, as cards.**
  - **Every row the list would show** gets a card, whatever its state:
    running, stopped, failed or pending. The filter, the cursor and every
    key work the same, with the same confirmations and the same one-change
    lock.
  - **A running VM's card adds its vitals:**
    - uptime;
    - memory in use, beside its *configured* memory when that is known;
    - recent CPU use as a small trend.
  - **A card for a VM that isn't running** shows what the list shows: state,
    template and configured size.
  - **With no VMs at all,** the overview says so, as the list does.
- **A header for the whole set:**
  - the host's memory in use;
  - the share of it taken by the VMs that could be read;
  - the counts of running, pending and failed VMs.
- **Readings are honest:**
  - **Unknown means unknown.** A reading that can't be taken shows as
    unknown ("—"), never as zero. A total that misses some VMs says it is
    partial.
  - **Configured is labelled as configured.** It is never shown as a
    measurement. A pending edit's new size is not presented as the running
    VM's size.
  - **CPU is defined.** It is the host CPU time the VM uses, where 100% is
    one full core.
  - **Units match the config.** Memory is in binary units (MiB/GiB),
    matching the MiB the configuration uses.
- **Nothing extra runs while it isn't needed.**
  - Readings are taken only while a surface is open *and* showing the
    overview. A user who keeps the list sees no change and pays nothing.
  - Nothing new polls while every surface is closed.
- **The size works on both surfaces.** The overview fits the bar popup's
  width and the menu's.
- **Words match:**
  - the README key tables and `docs/usage.md`;
  - the setting in `manifest.json`;
  - the widget description there that lists every key;
  - the shortcut sheet.

## Decisions

The owner made these on 2026-11-16, with the approval:

1. **`v` switches views**, as well as the setting.
   - `v` is free in `MicrovmView.qml` and `Model.SHORTCUTS`, on `main` and on
     both PR branches.
   - `tests/model/keys.test.js` requires every bound key to have a shortcut
     sheet entry, so `v` gets one.
2. **The CPU trend shows "—" until it has two samples**, in a slot of fixed
   height, so the card does not change size when the first trend arrives.
3. **A VM whose readings can't be taken shows its configured values,**
   marked as configured, and "—" for what is unknown.
   - This covers a permanent VM on a host where the system bus refuses, a
     foreground disposable VM, and a flake-declared VM with no readable line.
   - It is never reported as an error on the poll.

## Affected users and systems

- **Who sees a change:** anyone who turns on the overview or presses `v`.
  Everyone else sees only one new key, on the shortcut sheet.
- **Code:**
  - `Model.js` for the parsing and maths, with Node tests;
  - `MicrovmState.qml` for the readings;
  - the view and its drawing for the cards;
  - `Panel.qml` and `Menu.qml` for the setting.
- **Package and docs:**
  - `manifest.json`;
  - `flake.nix`'s `files` list, for any new file;
  - the docs.

## Constraints

- **AGENTS.md rules that hold:**
  - argv only;
  - logic in `Model.js` with a Node test;
  - every colour from `Commons.Color`, `Style` or `Border` tokens;
  - every new runtime file goes in `flake.nix`'s `files` list.
- **The sizing rule, in full:** the card derives from the screen and the text
  size; there is no render transform; the body takes the height its host
  gives it.
- **Disposable state** is touched only through `nixarchy-vm`. Reading a unit's
  status is a read, as the list already reads units.
- **No new tool and no new dependency.**
- **Polling:** nothing polls while every surface is closed. The exceptions
  stay as they are: the bar's slow glyph poll, and #49's bounded
  stop-and-delete wait.
- **The list is never slowed:** a slow or failed reading never delays or
  blanks the rows.
- **Out of scope:**
  - VM screenshots, which need an upstream command (roadmap U1b);
  - host CPU in the header, since per-VM CPU is the point and host CPU would
    need its own sampling.
- **Timing:** do not start code before #51 and #52 merge.

## Open questions

None. The three were answered above.
