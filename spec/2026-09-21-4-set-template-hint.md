---
status: draft
issue: 4
intent: intent/2026-09-21-4-set-template-hint.md
---

# Spec: the m hint is true

## Design

`Model.hiddenReason` (`Model.js:1204–1212`), disposable branch:

```js
if (verb === "edit" && row.runtime === "running") return "stop it first to change the template"
if (verb === "edit" && !s.vmSetTemplate) return "changing the template needs nixarchy vm set-template (nixarchy#762)"
```

This is the same guard the console line above it already has
(`&& !s.vmConsole`). `MicrovmView.hintText` is unchanged: with set-template
present, a stopped disposable row now falls through to `""`, so the hint line
is empty.

## Alternatives rejected

- **Filtering in `hintText`.** The rule belongs in `Model.js`, and so does its
  test (AGENTS.md).

## Risks

None beyond the three rows below. The permanent branch isn't touched.

## Verification

- New test in `tests/model/rows.test.js`, for a stopped disposable row:
  `hiddenReason(row, {vmSetTemplate: true}, "edit") === ""`; with `false`,
  the #762 text; running, "stop it first…".
- `node tests/run.js` and `nix flake check`.
- Live on razer: the popup with a stopped disposable VM under the cursor
  shows no `m:` hint.
