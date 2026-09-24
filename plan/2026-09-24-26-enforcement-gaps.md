---
status: draft
issue: 26
spec: spec/2026-09-24-26-enforcement-gaps.md
---

# Plan: make the checks match the rules, and prove the checks

Every rule `AGENTS.md` names is either enforced by something that runs on each PR or
marked `(by hand)`. `flake.nix` becomes the single statement of what is enforced;
`AGENTS.md:57`, `README.md:236` and `.github/workflows/ci.yml:18` stop enumerating and
point at it, and one check keeps the pointers honest in both directions.

The approved decisions, carried over so this file stands alone:

- **Async tests are refused, not supported.** `test()` fails a thenable return or an
  `AsyncFunction`, and attaches `value.catch(() => {})` **before** recording the failure.
  Measured on Node v26.8.1: without the `catch`, Node kills the process on the unhandled
  rejection and `process.exitCode` does not survive. It is load bearing, not tidiness.
- **`run.js` sets `process.exitCode`** rather than calling `process.exit()`, so stdout flushes.
- **`harness.js` exports its `failures` array**, so `tests/selftest.js` can assert exactly
  three; `report()` alone cannot tell three failures from one.
- **The files-list check uses a root deny-list**, not an extension allow-list, so it fails
  closed: an unrecognised new root file breaks the build until someone classifies it.
- **The pacman check scans the whole clone**, with a per-line allow-list at
  `tests/pacman-allowed.txt` holding the ten real rule-text lines, and `grep -I` for the
  binaries under `docs/img/`.
- **`omarchy plugin validate` is not faked** — no GitHub runner has the omarchy tooling.
  CI keeps the symlink check and gains the files-list check through `nix flake check`; the
  fresh-clone form stays a labelled manual step. No pre-push hook.
- **No SHA pins for CI actions**, but `ci.yml` gains the `permissions: contents: read`
  block it lacks today, plus a comment recording the tag decision.
- **#22 owns the sanitisation-layer tests.** This issue owns the enforcement mechanism and
  the proof that the mechanism catches its own fixtures.

Every check added here runs on a GitHub runner with no network and no live desktop: each
is `node`, `grep`, `comm` or `du` over files already in the store. Restated per step.

## Steps

**Sequencing.** Step 1 lands first, alone. Until the harness fails properly, no later
step's fixture proves anything — a fixture that should turn the run red could pass
silently, and the whole point of this issue is that a failing check must fail the run.

1. **`tests/harness.js`, `tests/run.js`, `tests/selftest.js`, `flake.nix`: make a failing
   test fail the run.**
   `harness.js:25-32`: capture `const value = fn()`; if `value` is thenable, call
   `value.catch(() => {})` and *then* `failures.push({ name, error: new Error("async test
   function; Model.js is synchronous") })`; also fail when `fn.constructor.name ===
   "AsyncFunction"`, before calling it. Add `failures: failures` to the exports at
   `harness.js:86-94`. `run.js:15` becomes `process.exitCode = harness.report()`.
   New `tests/selftest.js` requires the harness, registers three deliberately bad tests
   (one throwing synchronously, one `async` that rejects, one `async` that resolves),
   then asserts `harness.failures.length === 3` and `harness.report() === 1`, and sets
   `process.exitCode = 0` only if both hold. `flake.nix:93` gains `node tests/selftest.js`
   on the line above `node tests/run.js`.
   → verify by `node tests/selftest.js; echo $?` printing `0` with no
   `UnhandledPromiseRejection` on stderr, and `node tests/run.js` still `70 passed, 0 failed`.
   Runner-safe: two `node` processes over the sources already copied into the check.

2. **`flake.nix`: the files-list check.** New block after the entry-point check
   (`flake.nix:105-107`):
   ```sh
   # check: files-list
   printf '%s\n' .gitignore AGENTS.md CLAUDE.md README.md flake.lock flake.nix \
     | sort > deny
   (cd ${self} && find . -maxdepth 1 -type f -printf '%f\n') | sort > root
   comm -23 root deny > required
   ls -1 ${plugin} | sort > packaged
   comm -23 required packaged | sed 's/$/: at the repository root, missing from the package/' >&2
   comm -13 required packaged | sed 's/$/: packaged, but not a root file outside the deny-list/' >&2
   [ -z "$(comm -3 required packaged)" ] || exit 1
   ```
   `-type f` excludes directories as a class: `pluginFor` flattens with
   `cp ${f} "$out/${baseNameOf f}"` (`flake.nix:47`), so nothing under `tests/`, `docs/`,
   `share/`, `intent/`, `spec/`, `plan/` or `.github/` could ship correctly even if listed.
   On this branch `required` is exactly the fourteen paths in `files` (`flake.nix:15-30`).
   → verify by the block being silent on a clean tree, and by the fixtures under Tests.
   Runner-safe: two directory listings and `comm`.

3. **`flake.nix`: widen the colour check.** Replace `flake.nix:143-145` with four greps
   over `${plugin}/*.qml ${plugin}/*.js` — adding `Model.js` to the scope:
   ```sh
   # check: colours
   grep -nE "['\"]#[0-9a-fA-F]{3,8}['\"]" ...        # hex in either quote style
   grep -nE "['\"](rgba?|hsla?)\(" ...               # a CSS colour function in a string
   grep -nE 'colou?r[[:space:]]*:[[:space:]]*"[a-z]+"' ... | grep -vF '"transparent"'
   grep -nE 'Qt\.rgba\([0-9., ]*\)' ...              # all-literal only
   ```
   Any hit prints the line and `hardcoded colour above; use a Color.* token`, then exits 1.
   `"transparent"` is excluded deliberately — no `Color.*` token expresses it and
   `Menu.qml:89`, `VmList.qml:151` and `:196` are correct as written; `Qt.rgba` from a
   token (`ShortcutSheet.qml:32`) is not all-literal and is not flagged. `[[:space:]]`,
   not `\s`, so the patterns do not lean on GNU ERE extensions.
   → verify by the four fixtures under Tests, and by the tree passing untouched.
   Runner-safe: `grep` over the built package.

4. **`flake.nix`, `ci.yml`: a check asserts its own subject exists.** `flake.nix:149-152`
   loses the `if [ -d ... ]` wrapper: `test -d ${self}/docs/img || { echo "docs/img is
   missing" >&2; exit 1; }`, then the `du` comparison unconditionally. `ci.yml:34-38`
   drops `2>/dev/null` and both `${size:-0}` defaults for the same shape.
   → verify by renaming `docs/img` away and seeing both fail.
   Runner-safe: `test` and `du`.

5. **`tests/pacman-allowed.txt`, `flake.nix`: scan the whole clone, exempt lines.**
   The allow-list and the widening land in the **same commit** — widening first would
   flag the repository's own rule text and the check would land red, which the spec
   forbids. Format: one trimmed source line per line, `#`-prefixed lines and blanks
   ignored, matched with `grep -qxF`. Its ten entries are the trimmed text of
   `AGENTS.md:57` and `:168`, `README.md:236`, `flake.nix:138`, `ci.yml:18`,
   `intent/2026-09-18-1-microvm-plugin.md:92`, `spec/2026-09-18-1-microvm-plugin.md:459`
   and `plan/2026-09-18-1-microvm-plugin.md:172`, `:354`, `:550` — confirmed today with
   `git ls-files -z | xargs -0 grep -Inw -E 'pacman|yay'`. `flake.nix:137-140` becomes:
   ```sh
   # check: pacman
   bad=
   grep -IrnwE 'pacman|yay' ${self} | sed "s|^${self}/||" > hits || true
   grep -v '^[[:space:]]*#' tests/pacman-allowed.txt | grep -v '^[[:space:]]*$' > allowed
   while IFS= read -r hit; do
     text=$(printf '%s' "$hit" | cut -d: -f3- | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
     grep -qxF "$text" allowed || { echo "$hit" >&2; bad=1; }
   done < hits
   [ -z "$bad" ] || { echo "Arch package manager reference above" >&2; exit 1; }
   ```
   `grep -I` skips `docs/img/*.png` and `*.mp4`, which carry the byte sequences as
   substrings. `cut -d: -f3-` is safe: no tracked path contains a colon.
   → verify by the two fixtures under Tests, and by the tree passing with the ten present.
   Runner-safe: one `grep` over the store copy of the tree.

6. **`flake.nix`, `AGENTS.md`, `README.md`, `ci.yml`: one source of truth, checked.**
   Give every check block a `# check: <name>` first line — `tests`, `manifest`,
   `entry-points`, `files-list`, `schema`, `binds`, `singleton`, `symlinks`, `pacman`,
   `colours`, `img-budget`, `docs-sync`. Delete the enumeration at `AGENTS.md:57` and
   `README.md:236`, leaving `nix flake check  # everything flake.nix enforces; each block
   names itself`, and replace the `ci.yml:17-19` comment with the same pointer. Mark each
   entry in `AGENTS.md`'s Rules section `(checked: <name>)` or `(by hand)`. New block:
   ```sh
   # check: docs-sync
   grep -oE '^[[:space:]]*# check: [a-z-]+' ${self}/flake.nix | awk '{print $NF}' | sort -u > names
   grep -oE '\(checked: [a-z-]+\)' ${self}/AGENTS.md | tr -d '()' | awk '{print $2}' | sort -u > claimed
   comm -23 names claimed | sed 's/^/check /;s/$/ is not documented in AGENTS.md/' >&2
   comm -13 names claimed | sed 's/^/(checked: /;s/$/) names no block in flake.nix/' >&2
   [ -z "$(comm -3 names claimed)" ] || exit 1
   ```
   The extractor does not match itself: its own pattern text is `# check: [a-z-]+`, and
   `[` is not in `[a-z-]`. This commit rewrites `AGENTS.md:57`, `README.md:236` and
   `ci.yml:18` — three of the ten allow-listed pacman lines — so it updates
   `tests/pacman-allowed.txt` in the same commit.
   → verify by the two docs-sync fixtures under Tests. Runner-safe: `grep`, `awk`, `comm`.

7. **`ci.yml`: the missing permissions block.** Add after `on:`:
   ```yaml
   # Tag-pinned on purpose: no secrets here, no pull_request_target, and
   # contents: read, so a repointed tag reaches the runner and nothing else.
   # SHA pins would cost a bump on every renovation for that (spec point 9).
   permissions:
     contents: read
   ```
   → verify by `nix run nixpkgs#yamllint -- .github/workflows/ci.yml` and a green CI run.

8. **`manifest.json`, `AGENTS.md`: the minor two.** `manifest.json:20` gains the `e` alias
   next to `enter`, matching `MicrovmView.qml:230` and `README.md:69`. `AGENTS.md`'s last
   rule is narrowed to name the README as the key reference, matching `docs/usage.md:11`,
   which already points there. `flake.nix:109-112`'s comment is corrected to say what the
   predicate asserts — strict, no `$schema` key — rather than "the schema is valid".
   → verify by `nix flake check` still passing the manifest predicate.

## Tests

Each fixture is applied to the working tree, the check is run, the failure is read, and
the fixture is reverted with `git checkout -- <file>` (or `rm` for a new file) before the
commit. Nothing below is committed — the proof is a transcript in the PR body, not a file
in the repository.

| Check | Fixture | Expected |
| --- | --- | --- |
| harness | `tests/selftest.js`, three bad tests | exit 0, `failures.length === 3`, `report()` 1, no unhandled-rejection trace |
| run.js exit | add `test("x", () => { throw new Error("boom") })` to `tests/model/rows.test.js` | `node tests/run.js` prints the FAIL line and `$?` is 1 |
| files-list, unlisted | `touch zz.sh && git add zz.sh` | `zz.sh: at the repository root, missing from the package` |
| files-list, stale | delete `./LogView.qml` from `files` (`flake.nix:27`), leave the file | `LogView.qml: at the repository root, missing from the package` |
| colours, hex | `color: '#ff0000'` in `VmList.qml`, single quotes | the line, then `hardcoded colour` |
| colours, function | `color: "rgba(0,0,0,0.5)"` in `VmList.qml` | the line, then `hardcoded colour` |
| colours, named | `color: "red"` in `VmList.qml` | the line, then `hardcoded colour` |
| colours, Model.js | `var c = "#abcdef"` in `Model.js` | flagged — proves the widened scope |
| pacman, runtime | `pacman` in `manifest.json`'s description | `manifest.json:21:…` — proves the widened scope |
| pacman, prose | a fresh `pacman -S foo` line in `README.md` | flagged — proves whole-file exclusion is gone |
| img budget | `git mv docs/img docs/img-x` | `docs/img is missing`, from both `flake.nix` and the `ci.yml` step body |
| docs-sync | add `# check: zz` to a block, nothing in `AGENTS.md` | `check zz is not documented in AGENTS.md` |
| docs-sync, reverse | add `(checked: zz)` to a rule, no such block | `(checked: zz) names no block in flake.nix` |
| no false positive | the tree as it stands, every step applied | `nix flake check` green |

`node tests/run.js` stays at **70 passed, 0 failed**: this issue adds no `tests/model/`
file — #22 owns the sanitisation-layer tests. `tests/selftest.js` is run as its own
process and is not counted in that number.

`nix flake check` after this change proves four things it did not before: a failing test
fails the run whatever shape the function has; the `files` list matches the repository
root exactly, both directions; no hardcoded colour of any of the four forms is in the
shipped `.qml` **or** `Model.js`; and neither word appears anywhere in the clone outside
ten reviewed lines. It also cannot silently evaporate — every path a check names must exist.

The `ci.yml` step bodies are run locally against the same fixtures — the workflow itself
only runs on a push.

## Rollback

Steps 2–8 are pure additions and edits to non-runtime files: `git revert` the commit and
the previous behaviour returns exactly. No plugin runtime code changes except
`manifest.json:20`'s description string, which is prose the shell shows.

Step 1 alters existing behaviour. Reverting it restores a harness that swallows async
failures and a `run.js` that calls `process.exit()`; `tests/selftest.js` then fails, so
revert step 1 and the `flake.nix:93` self-test line together, or not at all.

A PR that was green under the new checks stays green after a revert: every check is
strictly stricter than what it replaces, so anything passing the new one passes the old.
The reverse does not hold — a branch cut before this lands may fail the files-list, colour
or pacman check on merge. That is the mechanism working, and the fix is one line in
`files`, one `Color.*` token, or one line in `tests/pacman-allowed.txt`.
