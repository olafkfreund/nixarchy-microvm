---
status: approved
issue: 49
author: olafkfreund
---

# Intent: simpler create and delete; require current nixarchy and nixarchy-pkg

Closes #49. Builds on #46 (PR #47), which must merge first: both touch the
same functions.

## Problem

Making a throwaway VM, or getting rid of one, takes more steps than the job
needs. The 1.0.0 reviews (Codex, agy, Fable) agreed on where. The line
numbers below are on `fix/46-review-findings`.

- **Create stops short.** Enter on a disposable form creates the VM
  *stopped*: `return create ? [create] : null` (`Model.js:1391`). The user
  then finds the row and presses `s`. A throwaway shell takes about six
  steps.
- **Delete asks the user to do a step first.** `x` on a running disposable
  VM says "Stop it first if it is running" (`Model.js:1518`), and the delete
  queues only `rm`.
- **`c` and `i` open the same form.**
  - Both call `openForm("disposable")` (`MicrovmView.qml:333-339`). `i` only
    adds the assist and ownership checks.
  - With assist available, the form opens on Describe (`Model.js:1143`), so
    `c` lands on the agent's field.
- **The permanent form is long.**
  - Memory, cores, SSH port, SSH key and shares are all fields of equal
    weight (`Model.js:1148-1168`).
  - A one-off VM needs none of the last three, and the user scrolls past
    them.
- **Applying is easy to miss.**
  - After a permanent write, applying is a footer line ("queued for the next
    rebuild · a applies now", `MicrovmView.qml:779`) and an icon in the
    header (`:451-458`).
  - Nothing asks at the moment the user is most likely to want it.
- **Two generations of upstream are supported side by side.**
  - **What is detected at runtime:**
    - nixarchy#762 (`list --json`, `templates --json`, `run --detach`,
      `console`, `set-template`);
    - nixarchy-pkg#19 (`opt replace`).

    Both shipped on 2026-09-19.
  - **What it costs:**
    - text parsers (`Model.js:210-280`);
    - a terminal start that escapes the mutation lock (B8, narrowed in #46);
    - two probes and their races (B11);
    - feature flags;
    - hidden-key reasons that name upstream issues (`Model.js:1488-1504`);
    - an AGENTS.md rule.
  - The owner decided on 2026-11-16 to drop that support.

## Proposed outcome

- **Create starts the VM.**
  - On a disposable VM, Enter creates it and starts it, with the build shown
    in the panel.
  - A second choice still creates it stopped.
  - If the create succeeds and the start fails, the user sees the VM listed
    as stopped and the start's own error, and nothing is retried.
- **Delete handles a running VM.**
  - `x` on a running disposable VM asks once, and says the VM and its state
    will be destroyed. Then it stops the VM and deletes it.
  - If the stop fails, nothing is deleted and the user sees why.
- **One key per job.**
  - `c`, and the IPC or menu `{"create": true}`, open the form at the name,
    with disposable defaults.
  - `i` opens it at the description, for the agent.
- **The permanent form is short by default.**
  - The SSH and shares fields start tucked away.
  - They open by themselves whenever they hold a value or an error: in an
    edit, after an agent reply, or after a refused Enter. Nothing the user
    must see or fix is ever hidden.
- **Apply is offered at the right moment.**
  - After a permanent create or edit succeeds, the plugin asks whether to
    apply now.
  - Yes runs the same `nixarchy-apply` in a terminal that `a` runs today.
  - No leaves things as they are.
  - A failed write never asks.
- **One supported upstream, one clear verdict.**
  - The plugin requires nixarchy with #762. It requires nixarchy-pkg with #19
    only when the nixarchy.pkg plugin is installed. Without that plugin,
    permanent VMs stay hidden as today, and disposable VMs still work.
  - On anything older, the user gets one plain message naming what to
    update, instead of keys disappearing one by one.
  - The compatibility code for the older versions is gone.
  - Detection of #843 (`nixarchy-service-enable`) stays: it is still open.
- **Words match behaviour:**
  - `docs/upstream.md`;
  - the AGENTS.md rules;
  - the README key tables and `docs/usage.md`;
  - the agent prompt, which still says disposable VMs run "only while
    attached" (`Model.js:1564`).

## Affected users and systems

- Everyone using the plugin.
- Hosts on nixarchy older than #762, or with nixarchy.pkg installed but
  older than #19, are told to update. They lose the plugin's VM actions until
  they do.
- **Files:**
  - `Model.js`, `MicrovmState.qml`, `MicrovmView.qml`, `CreateForm.qml`;
  - `tests/`;
  - `AGENTS.md`, `README.md`, `docs/usage.md`, `docs/upstream.md`.

## Constraints

- **The AGENTS.md rules still hold**, except "every `nixarchy vm` feature is
  detected", which this task replaces with a stated minimum. The rules that
  stay:
  - argv only;
  - logic in `Model.js` with a Node test;
  - no hardcoded colours, and every token read as `Commons.Color` (#45);
  - permanent writes only through nixarchy.pkg's writers;
  - one mutation at a time, covering every step of a create-and-start or a
    stop-and-delete;
  - a failed step stops the rest, as the queue does today.
- **Confirmation stays:**
  - the permanent review of the exact `apps.nix` line;
  - the delete question, which says what is destroyed.
- **Apply stays the user's own `nixarchy-apply`, in a terminal they watch.**
- **The snippet grammar does not change.**
- **The agent's reply stays data for the form.**
- **Must not start before #47 merges.**

## Open questions

Answered by the owner on 2026-11-16, with the approval: each recommendation below is the decision.

1. **Should "Apply now?" also follow a permanent delete?** That is also a
   queued `apps.nix` change, and `a` already applies it.
   - Recommendation: create and edit only. A delete is a deliberate
     clean-up the user may batch.
2. **SSH key pre-fill and S7** (one SSH switch, next free port) are left out.
   - Both reviewers advise deferring them together. A pre-filled key without
     a port adds an unused `authorizedKeys` module to the line
     (`Model.js:1071`).
   - Recommendation: a later issue.
