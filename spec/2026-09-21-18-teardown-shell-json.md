---
status: draft
issue: 18
intent: intent/2026-09-21-18-teardown-shell-json.md
---

# Spec: capture teardown and live testing leave the bar alone

Approved in the intent: stop the shell, swap the plugin folder, start the
shell, with the same plugin id and no live reload.

## Design

### `docs/capture.sh --teardown` (`:84–89`)

Restore a saved file only when it differs from what's there:

```bash
same() {  # $1 saved copy, $2 live path: identical kind, target and bytes
  if [ -L "$1" ] || [ -L "$2" ]; then
    [ -L "$1" ] && [ -L "$2" ] && [ "$(readlink "$1")" = "$(readlink "$2")" ]
  else
    [ -e "$2" ] && cmp -s "$1" "$2"
  fi
}
...
same "$run_dir/saved.$i" "$f" && continue
rm -f -- "$f"
cp -a "$run_dir/saved.$i" "$f"
```

A changed file is still restored byte for byte, symlink or not (`cp -a`), as
today. An unchanged `shell.json` is never written, so nixarchy#847 can't be
triggered by it. The header comment says why.

### AGENTS.md "Verifying live" step 1

Replace the copy-then-restart with stop, swap, start:

```bash
quickshell kill -p "$OMARCHY_PATH/shell" --any-display   # repeat until it fails: none left
rm -rf ~/.config/omarchy/plugins/nixarchy.microvm
cp -rL result ~/.config/omarchy/plugins/nixarchy.microvm
chmod -R u+w ~/.config/omarchy/plugins/nixarchy.microvm
omarchy-restart-shell                                     # finds nothing to kill, launches
```

Any `omarchy plugin enable nixarchy.microvm` goes in the same stopped
window, because it writes `shell.json`. Restoring the Home Manager link
after testing follows the same stop, swap, start order.

Step 2 (restart and ping) folds into that `omarchy-restart-shell`. Step 3
(check the log) gains an explicit bar check:
`qs log -i <instance> | grep -c pluginBarApiFor` must be 0, and
`omarchy-shell bar` answers. A blank bar means "restart the shell before
anything else", because the ai-mirror dialog lives in the bar.

### AGENTS.md "Retaking the captures"

- Step 3 (drive the surfaces): ai-mirror before its #26 fix can't type into
  layer-shell panels, where it refuses with "typing must name the window".
  Use one guarded `wtype` process instead (control held and a plugin layer
  up, checked once, with a `timeout`), and send `-` as `-k minus`, because
  a lone `-` makes `wtype` read stdin and hang.
- Step 5 (tear down): teardown now leaves unchanged files alone. The note
  says to check the bar afterwards anyway.

## Alternatives rejected

- **A separate plugin id for test copies.** It needs a manifest edit per
  test, and the Omarchy menu row and the IPC targets carry the real id, so
  those paths would go untested.
- **Always restart the shell after teardown.** It hides the problem, and
  restarting a shell mid-session is itself disruptive.

## Risks

- `quickshell kill -p` stops *every* shell on that config, including the
  owner's bar, for a few seconds. That's the same as
  `omarchy-restart-shell` does today, but it's now explicit. The procedure
  already requires the owner not to be using the desktop.
- `cmp` on a large file is fine: these are four small config files.

## Verification

- **`capture.sh`:** in a scratch `XDG_CONFIG_HOME` with a fake `shell.json`
  and a stub `nixarchy-vm` on `PATH` (list prints nothing):
  1. `--setup`, then `--teardown` leaves `shell.json`'s mtime and inode
     unchanged;
  2. with a modified `shell.json` in between, teardown restores the saved
     bytes (`cmp`);
  3. with a symlinked file retargeted in between, the link comes back.

  All in a throwaway script whose output is quoted in the PR, not added to
  the repo's tests, since `capture.sh` is doc tooling.
- **`nix flake check`** (no symlinks, no hex colours) and the fresh-clone
  validate.
- **On razer, with the owner's go:** the new step 1 run once, followed by
  0 `pluginBarApiFor` lines and a full bar.
