---
status: approved
issue: 7
spec: spec/2026-09-21-7-agent-error-shown.md
---

# Plan: a failed agent call says why (with #8)

Approved decisions: `CreateForm` never assigns `agentError`, so the binding
from `MicrovmView.qml:350` survives. `MicrovmView.openForm` and `openEdit`
clear `MicrovmState.agentError` instead. "cancelled" stays visible after
Esc. #8 ships in this same PR, and its own plan's steps run here after
step 2.

## Steps

1. `CreateForm.qml:80`, `:87`: remove `root.agentError = ""`.
   `MicrovmView.qml` `openForm` and `openEdit`: add
   `MicrovmState.agentError = ""` before `createForm.start…`.
   → Verify that `grep -n 'agentError =' CreateForm.qml` is empty.
2. Merge `fix/8-agent-error-text` (its approved artifacts) into this branch
   (`git merge --no-ff`), then carry out
   `plan/2026-09-21-8-agent-error-text.md` steps 1–4 here. → Verify with
   that plan's checks.
3. Live on razer (a copy installed per AGENTS.md): `i`, a sentence, Enter,
   Esc while it's thinking, and "cancelled" shows in the urgent colour.
   Close and `i` again, and it's cleared. A real call still fills the form.
   → Verify with a still of "cancelled".
4. Check and ship: `node tests/run.js`, `nix flake check`, the fresh-clone
   validate. The `docs/usage.md` "AI assist stops … shows nothing" entry
   becomes "AI assist shows an error", keeping the `claude -p hi` advice.
   Open one PR linking both issues' artifacts, with "Closes #7, closes #8".
   → Verify that CI is green.

*Live result (razer, 2026-09-21):* pass. Esc while thinking showed "cancelled" in the urgent colour, where before nothing appeared; the next open cleared it, and a real call filled the form. The check ran on one test
build that merged every fix branch, installed as a copy per AGENTS.md, so
one control grant covered #4–#9. Razer was restored afterwards: its plugin
link, no demo VMs, do-not-disturb off, and `apps.nix`/`services.nix`
byte-identical.

## Tests

The grep in step 1 · `node tests/run.js` · the still in step 3.

## Rollback

Revert the PR, which reverts #8 with it. Errors go back to being silent.
