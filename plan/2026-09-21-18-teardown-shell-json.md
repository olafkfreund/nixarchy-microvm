---
status: approved
issue: 18
spec: spec/2026-09-21-18-teardown-shell-json.md
---

# Plan: capture teardown and live testing leave the bar alone

## Approved decisions (from the spec)

- `docs/capture.sh --teardown` restores a saved file only when `same()`
  says it differs: symlinks compared by kind and target, regular files by
  `cmp -s`, and a missing live file always restored. A changed file is
  restored with `rm -f` + `cp -a`, as today.
- AGENTS.md "Verifying live":
  - step 1 becomes stop, swap, start: `quickshell kill -p
    "$OMARCHY_PATH/shell" --any-display` until none is left, swap the
    folder, then `omarchy-restart-shell`;
  - `omarchy plugin enable` goes inside the stopped window, and restoring
    the Home Manager link uses the same order;
  - step 2 folds into it;
  - step 3 adds the bar check: `pluginBarApiFor` count 0 and
    `omarchy-shell bar` answering, and a blank bar means restart first.
- AGENTS.md "Retaking the captures":
  - step 3 notes that ai-mirror before #26 can't type into layer-shell
    panels; use one guarded `wtype` process with a `timeout`, and `-k
    minus` for `-`;
  - step 5 says teardown leaves unchanged files alone, and to check the bar
    afterwards.
- Verification of `capture.sh` is a throwaway script whose output is
  quoted in the PR; it isn't added to the repo's tests.

## Steps

1. **Throwaway check first**, in scratch: a stub `nixarchy-vm`
   (`list` prints nothing, `create`/`stop`/`rm` exit 0) on `PATH`, and a
   scratch `XDG_CONFIG_HOME`/`XDG_RUNTIME_DIR` holding `apps.nix`,
   `services.nix`, `shell.json` and a symlinked `omarchy-menu.jsonc`. Run
   against today's `capture.sh`:
   - (a) setup then teardown: `shell.json` inode and mtime unchanged;
   - (b) `shell.json` modified in between: bytes restored;
   - (c) the symlink retargeted in between: target restored.

   → Verify that (a) fails on today's script (the inode changes), while (b)
   and (c) pass.
2. **`docs/capture.sh`:** `same()` and the guarded restore in `teardown()`,
   and the header comment says why (nixarchy#847). → Verify that step 1's
   script passes all of (a)–(c).
3. **`AGENTS.md`:** the "Verifying live" and "Retaking the captures" edits
   above, in the file's register. → Verify by reading both sections, and
   that no command in them uses a path this repo doesn't ship.
4. **On razer** (owner's go and one allow click): run the new "Verifying
   live" step 1 with the current `main` build as the copy, then restore the
   Home Manager link the same way. → Verify each time: `pluginBarApiFor`
   count 0, a full bar in a still, and `omarchy-shell bar` answering.
5. **Check and ship:** `nix flake check`, the fresh-clone validate, and a
   PR linking intent, spec and plan, quoting step 1's output, with
   "Closes #18". → Verify that CI is green.

*Corrected during step 1:* check (a) compares `shell.json`'s **ctime**,
not its inode and mtime as first written. The filesystem reused the freed
inode at once, and `cp -a` preserves mtime, so both passed on today's
rewriting script. ctime can't be set, and it moved: red as intended.

## Tests

Step 1's script (red on today's script, green after step 2) · `nix flake
check` · validate · step 4 on razer.

## Rollback

Revert the PR. Teardown goes back to rewriting every saved file, and the
docs return to the old steps.
