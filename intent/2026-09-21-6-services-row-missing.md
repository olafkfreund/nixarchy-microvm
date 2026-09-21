---
status: draft
issue: 6
author: olafkfreund
---

# Intent: a permanent VM can be created on an older services.nix

Closes #6.

## Problem

`~/.config/nixarchy/services.nix` is written once and never regenerated. A
user whose file predates nixarchy's `#@ microvm` row (razer: created
2026-09-01) can fill in the whole permanent form and review, and only then
does the write fail with `no service 'microvm' in …/services.nix` from
`nixarchy-service-enable`. Nothing is written, but there is no warning
before that point and no fix offered. `docs/usage.md` now documents a manual
workaround (#3).

## Proposed outcome

The user learns before filling in the form that permanent VMs need the row,
and has a one-step way to get it. Or the write simply succeeds.

## Affected users and systems

Any nixarchy install whose `services.nix` is older than the microvm row.
Possibly nixarchy's `nixarchy-service-enable`, which lives in another repo.

## Constraints

- Every permanent-VM write goes through nixarchy.pkg's writers. The plugin
  never edits `services.nix` directly (AGENTS.md).
- Feature detection, not assumption.

## Open questions

1. **Where the fix lives.**
   - **(a) In the plugin:** detect the missing row (read `services.nix` for
     `#@ microvm`) and show it up front, as a warning on Kind, with the
     exact line to copy.
   - **(b) Upstream:** `nixarchy-service-enable` appends a missing row from
     `/etc/nixarchy/services-template.nix`, so it just works.
   - **(c) Both:** (a) now, and (b) filed as a nixarchy issue that the
     plugin detects, the way #762 was.

   My lean is (c).
