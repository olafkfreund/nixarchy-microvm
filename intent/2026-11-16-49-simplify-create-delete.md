---
status: draft
issue: 49
author: olafkfreund
---

# Intent: simpler create and delete; require current nixarchy and nixarchy-pkg

Closes #49. Builds on #46 (PR #47), which must merge first: both touch the
same functions.

## Problem

Making a throwaway VM, or getting rid of one, takes more steps than the job
needs. The 1.0.0 reviews (Codex, agy, Fable) agreed on where:

- **Create stops short.** `c` → the form → Enter creates a disposable VM
  *stopped*. `submitArgvs` returns only `create`. The user then finds the new
  row and presses `s`. For a throwaway shell, that is about six steps for one
  intention.
- **Delete asks for a step the plugin could do.** `x` on a running disposable
  VM says "Stop it first if it is running" (`removeMessage`). The action queue
  can already run `stop` then `rm`.
- **`i` duplicates `c`.** Both call `openForm("disposable")`
  (`MicrovmView.qml`), and Describe is already the first field. One key does
  two jobs under two names.
- **The form shows everything at once.**
  - It opens on Describe, then Kind, then Name.
  - A permanent VM adds memory, cores, an SSH port, an SSH key and shares,
    all on screen together.
  - The SSH key is never pre-filled, even when `~/.ssh` holds exactly one.
- **Applying is a footer hint.** After a permanent write, the footer says
  "a applies now". The moment the user most likely wants to apply is the
  moment it is easiest to miss.
- **Two generations of upstream are supported side by side.** Every
  `nixarchy vm` and nixarchy-pkg feature is detected at runtime:
  - **nixarchy#762:** `list --json`, `templates --json`, `run --detach`,
    `console`, `set-template`;
  - **nixarchy-pkg#19:** `opt replace`.

  Both shipped on 2026-09-19. Supporting the older versions costs:
  - text parsers for `list` and `templates` (`parseVmList`,
    `parseTemplates`);
  - a terminal-start path that escapes the mutation lock (B8, narrowed in
    #46);
  - two probes (`helpProcess`, `optProbe`) and the races around them
    (B11);
  - `detectFeatures`, `optReplaceSupported` and the feature flags;
  - the hidden-key reasons that name the upstream issues;
  - and the AGENTS.md rule "every `nixarchy vm` feature is detected".

  The owner decided on 2026-11-16 to drop that support.

## Proposed outcome

- **Create starts the VM.**
  - On a disposable VM, Enter creates it and starts it, with the build
    streamed into the panel (`run --detach`).
  - A second choice still creates it stopped.
- **Delete stops first.** `x` on a running disposable VM asks once, then
  stops it and deletes it.
- **One key per job.**
  - `c` opens the form on Name, with disposable defaults.
  - `i` opens it on Describe, for the agent.
- **A short form.**
  - A permanent VM's SSH port, key and shares sit under an "Advanced"
    switch, closed by default.
  - The key is pre-filled when `~/.ssh` holds exactly one.
- **Apply at the right moment.**
  - After a permanent write, the plugin asks "Apply now?".
  - Yes opens `nixarchy-apply` in a terminal, exactly as `a` does today.
  - No leaves the footer hint.
- **One supported upstream.**
  - The plugin requires nixarchy with #762 and nixarchy-pkg with #19.
  - On anything older, it says so once, plainly, instead of hiding keys one
    by one.
  - The text parsers, the terminal start, `helpProcess`, `optProbe` and the
    feature flags are gone.
  - Detection of #843 (`nixarchy-service-enable`) stays, because it is still
    open.
- **Documentation matches.** `docs/upstream.md`, the AGENTS.md rules, the
  README key tables and `docs/usage.md` describe the new behaviour.

## Affected users and systems

- Everyone using the plugin.
- Hosts on nixarchy older than #762, or nixarchy-pkg older than #19, lose
  the plugin's VM actions and are told to update.
- **Files:**
  - `Model.js`, `MicrovmState.qml`, `MicrovmView.qml`, `CreateForm.qml`;
  - `tests/`;
  - `AGENTS.md`, `README.md`, `docs/usage.md`, `docs/upstream.md`.

## Constraints

- **The AGENTS.md rules still hold**, except "every `nixarchy vm` feature is
  detected", which this task replaces with a stated minimum version. The rules
  that stay:
  - argv only;
  - logic in `Model.js` with a Node test;
  - no hardcoded colours, and every token read as `Commons.Color` (#45);
  - permanent writes only through nixarchy.pkg's writers;
  - one mutation at a time.
- **Create-and-start is one queued mutation**, not two: the lock holds for
  both.
- **Apply stays the user's own `nixarchy-apply`, in a terminal they watch.**
  "Apply now?" only opens it.
- **No change to the snippet grammar.**
- **The agent's reply stays data for the form.** `i` still never runs
  anything.
- **Must not start before #47 merges.**

## Open questions

1. **How "too old" is detected.** Two options:
   - keep one cheap check (`nixarchy-vm help` names `--detach`) and show a
     single message;
   - drop detection entirely, and let the first failing command's error
     speak.

   The first is kinder; the second is less code.
2. **Create and start.** Should Enter create *and* start by default, with
   "create stopped" as the second choice? Or the other way round?
3. **Should agy's S7 come with this?** S7 makes SSH one switch, with the
   next free port from 2222 and the only key pre-filled. Or should it wait
   for a later issue?
