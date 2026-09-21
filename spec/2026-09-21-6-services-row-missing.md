---
status: approved
issue: 6
intent: intent/2026-09-21-6-services-row-missing.md
---

# Spec: a permanent VM can be created on an older services.nix

Decision (c): the plugin warns now, and nixarchy fixes it upstream, which
the plugin detects.

## Design

### Plugin

- **`Model.servicesHasMicrovm(text)`**: `/#@ microvm(\s|$)/m`, the marker
  `nixarchy-service-enable` itself greps for.
- **`MicrovmState`**: a watched `FileView` on
  `$XDG_CONFIG_HOME/nixarchy/services.nix`, like `appsFile`, that sets
  `servicesRow: true | false`. A missing or unreadable file counts as false.
  Because it is watched, the warning clears the moment the user pastes the
  line.
- **`Model.serviceEnableHeals(reply)`**: true when `nixarchy-service-enable
  --help` prints `usage:` and mentions a missing row. It is probed once in
  `probe()`, like `optProbe`. Today's reply ("no service '--help'…") matches
  neither, and the probe writes nothing: the id is only ever grepped.
- **`featureState.servicesRow`** is `servicesRow || serviceEnableHeals`.
- **The rule, in `Model.js`:** `permanentBlocked(form, state)` returns this
  reason for a new permanent VM when `!state.servicesRow`, and `""`
  otherwise:

  > services.nix predates the microvm row: copy the line ending in `#@ microvm`
  > from /etc/nixarchy/services-template.nix into
  > ~/.config/nixarchy/services.nix

  An edit is exempt, because its line already exists and `opt replace` needs
  no service row.
- **Surface:** `CreateForm` shows the reason under the Kind line in
  `Color.urgent` while the kind is permanent. `submitArgvs` returns `null`
  while it is blocked, so Enter can't reach the review, and the review
  shows the same reason if it was already open. This matches how invalid
  fields behave.

### Upstream

An issue in olafkfreund/nixarchy asks for two changes:

- `nixarchy-service-enable <id>` adds a missing row from
  `/etc/nixarchy/services-template.nix`, then enables it;
- `--help` prints `usage: nixarchy-service-enable <id>` and a line saying
  a missing row is added from the template.

The second one is what the plugin detects.

### Docs

`docs/usage.md`: the troubleshooting entry from #3 now says the form warns
first, and links the upstream issue.

## Alternatives rejected

- **The plugin appends the row itself.** AGENTS.md forbids file writes
  outside nixarchy.pkg's writers.
- **Hiding the permanent kind.** Hiding it wouldn't tell the user what's
  wrong or how to fix it.

## Risks

- A `services.nix` that enables microvm in some other way, without the
  marker, would be flagged wrongly. But `nixarchy-service-enable` would fail
  on that file too, so the warning is still true.
- One more watched file. It stays cheap, because nothing polls.

## Verification

- Node tests: `servicesHasMicrovm` on the razer-style file (no row), on a
  file with the row commented out, and on one enabled.
  `serviceEnableHeals` on today's reply (false) and on the proposed usage
  (true). `permanentBlocked` for a new permanent VM, an edit, and a
  disposable VM. `submitArgvs` returns null when blocked.
- Live on razer, whose `services.nix` has no row: flip the kind to
  permanent and the warning shows, with Enter doing nothing. Paste the line
  and the warning clears live. Then restore the file from a snapshot and
  diff it.
