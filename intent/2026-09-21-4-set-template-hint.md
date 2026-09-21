---
status: approved
issue: 4
author: olafkfreund
---

# Intent: the m hint is true

Closes #4.

## Problem

On every stopped disposable row, the hint under the list reads "m: changing
the template needs nixarchy vm set-template (nixarchy#762)". That is false on
any nixarchy since 2026-09-19: `m` is shown, and it works. On razer it changed
demo-python from python to shell. `Model.hiddenReason` (`Model.js:1210`)
returns this text for `edit` without checking whether set-template was
detected, and `MicrovmView.hintText` asks for `edit` on every row.

## Proposed outcome

The hint names a missing feature only when that feature is missing. With
set-template present, a stopped disposable row has no `m` hint, and a
running one keeps "stop it first to change the template".

## Affected users and systems

`Model.js` and `tests/`. Everyone on a current nixarchy sees the false hint
today. It also blocks retaking the create recording for the site (#3).

## Constraints

Logic stays in `Model.js` with a Node test (AGENTS.md). An older nixarchy
without set-template still gets the hint.

## Open questions

None.
