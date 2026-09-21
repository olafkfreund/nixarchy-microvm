---
status: approved
issue: 6
spec: spec/2026-09-21-6-services-row-missing.md
---

# Plan: a permanent VM can be created on an older services.nix

Approved decision (c): the plugin detects a `services.nix` without the
`#@ microvm` row and blocks a new permanent VM with a reason that says how
to fix it. nixarchy is asked to add a missing row itself, and the plugin
detects that through a `usage:` line from `nixarchy-service-enable --help`.
No file is ever written by the plugin.

The fixed texts:

- **reason:** `services.nix predates the microvm row: copy the line ending in #@ microvm from /etc/nixarchy/services-template.nix into ~/.config/nixarchy/services.nix`
- **heal marker:** `--help` output that matches `/usage:\s*nixarchy-service-enable/i` and `/missing/i`

## Steps

1. **Upstream issue** in olafkfreund/nixarchy: `nixarchy-service-enable <id>`
   adds a missing row from `/etc/nixarchy/services-template.nix` and then
   enables it; `--help` prints `usage: nixarchy-service-enable <id>` and a
   line saying a missing row is added from the template. It links #6.
   There's no commit. → Verify that the issue URL exists and goes into
   `docs/upstream.md` in step 6.
2. **Tests first** (`tests/model/rows.test.js` and `form.test.js`):
   - `servicesHasMicrovm`: false on razer's file shape (header, `{ ... }:`,
     no marker); true when the row is commented out; true when enabled.
   - `serviceEnableHeals`: false on today's reply ("nixarchy: no service
     '--help' in …"); true on `usage: nixarchy-service-enable <id>\n  A
     missing row is added from the template.`
   - `permanentBlocked`: the reason for a new permanent VM when
     `servicesRow: false`; `""` for an edit (`editing: true`), for a
     disposable VM, and when `servicesRow: true`.
   - `submitArgvs(...)` returns null for a new permanent VM when
     `servicesRow: false`.

   → Verify that they fail as expected.
3. **`Model.js`**: add `servicesHasMicrovm`, `serviceEnableHeals`,
   `serviceHelpArgv()` (`["nixarchy-service-enable", "--help"]`) and
   `permanentBlocked`. `submitArgvs` returns null when `permanentBlocked`
   gives a reason. → Verify that the tests pass.
4. **`MicrovmState.qml`**: a watched `FileView` `servicesFile` on
   `configHome + "/nixarchy/services.nix"` (`onLoaded`, `onLoadFailed` and
   `onFileChanged`, as `appsFile` does) sets `servicesRow`. A `Process`
   `serviceHelpProbe`, started in `probe()`, sets `serviceHeals`.
   `featureState.servicesRow` is `servicesRow || serviceHeals`. → Verify
   with `qs log` on razer showing no errors.
5. **`CreateForm.qml`**: `submit()` refuses while
   `Model.permanentBlocked(form, features)` gives a reason, and moves focus
   to Kind. Under the Kind line, a `Text` in `Color.urgent` shows the reason
   while it's non-empty. `MicrovmView`'s review shows the same reason in
   place of "Runs:" if `reviewArgvs` is empty for that reason.
   → Verify live in step 7.
6. **Docs**: in `docs/usage.md`, the troubleshooting entry says the form
   warns first, and gains the upstream link; `docs/upstream.md` gets a row
   for the new nixarchy issue. → Verify by reading them.
7. **Live on razer** (its `services.nix` has no row; snapshot it first):
   - `c`, then Space: the warning shows, and Enter stays on the form;
   - paste the template line into `services.nix`: the warning clears
     without reopening, and Enter reaches the review; Esc, no write;
   - restore the snapshot and `cmp` it.

   → Verify with two stills and a clean `cmp`.
8. **Check and ship**: `node tests/run.js`, `nix flake check`, the
   fresh-clone validate, a PR with "Closes #6". → Verify that CI is green.

## Tests

`node tests/run.js` · `nix flake check` · the step 7 stills and `cmp`.

## Rollback

Revert the PR. The watcher, the probe and the block go away, and the late
failure returns. The upstream issue stands on its own.
