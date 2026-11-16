---
status: draft
issue: 53
author: olafkfreund
---

# Intent: an overview of what the running VMs cost

Closes #53. It comes after #49 (PR #52) and #50 (PR #51). It builds on both:
the list and the menu card they change.

## Problem

The list shows which VMs exist and whether they run. It does not show what
they cost:

- **Each running VM.** The memory it uses, how busy its CPU is, and how long
  it has been up are all invisible. A VM using 7.5 GB, or pinning a core,
  looks the same as an idle one.
- **All of them together.** Nothing says how much of the host the VMs take
  together. The user cannot tell whether starting one more will crowd the
  machine.
- **Permanent VMs.** They show the memory and cores their line *configures*
  in the form, but never on the list. Nothing compares that with what the VM
  actually uses.

makors/agency shows the kind of thing the owner likes. Its dashboard gives
each running desktop a card with live vitals, beside the machine's own CPU
and memory.

The data is already there. Every running VM is a systemd unit:
- `nixarchy-vm-<name>` for a disposable VM, a user unit;
- `microvm@<name>` for a permanent one, a system unit.

`systemctl show` reports `MemoryCurrent`, `CPUUsageNSec` and
`ActiveEnterTimestamp` for each, without root. On this host, `live1` reports
7.5 GB in use and a start time. The host's own totals come from
`/proc/meminfo`.

## Proposed outcome

- **An overview view, opt-in.**
  - A setting chooses the default view; the list stays the default, as the
    owner decided on 2026-11-16.
  - A key switches between the list and the overview while open. It is
    shown on the shortcut sheet.
- **Cards for running VMs.** In the overview, each running VM has a card
  showing:
  - its name, kind and template;
  - how long it has been up;
  - the memory it uses now, against what it is configured for when that is
    known;
  - its recent CPU use, as a small trend, not a single number.
- **A header for the whole set:**
  - the host's memory in use, and how much of it the VMs take;
  - the number of VMs running, pending and failed.
- **The same keys work on a card as on a list row.** The overview is
  another way to look at the same rows, not a second interface to learn.
- **Polling stays as it is.** Resource data is read only while a surface is
  open, on the existing poll. Nothing new polls while everything is closed.
- **Words match.** The README key tables, `docs/usage.md` and the setting's
  description in `manifest.json`.

## Affected users and systems

- Anyone who turns the overview on. Nobody else sees a change, apart from a
  new key on the shortcut sheet.
- **Files:**
  - `Model.js` (parsing and maths, with Node tests);
  - `MicrovmState.qml` (one more read on the existing poll);
  - `MicrovmView.qml` and a new drawing piece;
  - `manifest.json` (the setting);
  - `flake.nix` (the new file in the `files` list);
  - the docs.

## Constraints

- **The AGENTS.md rules hold:**
  - argv only;
  - logic in `Model.js` with a Node test;
  - every colour from `Commons.Color`, `Style` or `Border` tokens;
  - the sizing rule: the card is derived from the screen and the text size,
    with no render transform;
  - a new runtime file goes in `flake.nix`'s `files` list;
  - disposable state is touched only through `nixarchy-vm`. Reading a
    unit's status with `systemctl show` is a read, not a touch, the way the
    plugin already reads units for the list.
- **No new tool and no new dependency.**
- **Nothing polls while every surface is closed.** The bar's slow glyph poll
  stays the only exception, plus #49's bounded stop-and-delete wait.
- **No desktop screenshots of VMs.** Thumbnails need an upstream command
  (roadmap U1b) and are out of scope.
- **It must not slow the list.** Reading resources must not delay the rows.
- **Do not start before #51 and #52 merge.**

## Open questions

1. **Where the key lives.** `v` is free. Is `v` the right key for "switch
   view", or should it be a setting only?
2. **CPU as a trend.** A trend needs a few samples. Should a card show "—"
   until it has two, or show nothing for the first poll?
3. **Permanent VMs need the system bus** (`systemctl show microvm@…`) to
   read their memory and CPU. That works without root on this host, but may
   not on a locked-down one. Should a permanent card that can't be read show
   its configured values only, rather than an error?
