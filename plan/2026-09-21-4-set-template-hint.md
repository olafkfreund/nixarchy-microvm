---
status: approved
issue: 4
spec: spec/2026-09-21-4-set-template-hint.md
---

# Plan: the m hint is true

Approved decision: in `Model.hiddenReason` (disposable branch), the
set-template hint returns only when `!s.vmSetTemplate`, the same guard as
the console line. `hintText` in the view is unchanged.

## Steps

1. `tests/model/rows.test.js`: add a test for a stopped disposable row.
   `hiddenReason(row, {vmSetTemplate: true}, "edit")` is `""`; with
   `false` it's the #762 text; for a running row it's "stop it first to
   change the template". → Verify with `node tests/run.js`, where exactly
   this test fails.
2. `Model.js:1210`: add `&& !s.vmSetTemplate`. → Verify with
   `node tests/run.js`, all passing.
3. Check and ship: run `nix flake check`, the fresh-clone validate, and a
   live check on razer (a copy of the build installed per AGENTS.md
   "Verifying live": the popup with the cursor on a stopped disposable VM
   shows no `m:` hint). Then push and open a PR linking intent, spec and
   plan, with "Closes #4". → Verify with a still of the popup and CI green.

## Tests

`node tests/run.js` · `nix flake check` · the live still in step 3.

## Rollback

Revert the PR. The hint comes back, and nothing else depends on it.
