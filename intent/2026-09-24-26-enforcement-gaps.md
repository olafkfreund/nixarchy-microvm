---
status: draft
issue: 26
author: olafkfreund
---

# Intent: the rules AGENTS.md states are enforced more thinly than it says

Closes #26.

## Problem

`AGENTS.md` calls itself the single source and says each of its Rules "records a
real failure or a hard constraint". Several of those rules are checked by
nothing. Several that are checked are checked more narrowly than the wording
promises. And the two documents summarising what `nix flake check` covers
disagree with each other and with the derivation.

The combination is the problem, not any single gap. A rule written down but
unenforced is worse than one that is absent: the owner and every agent reading
`AGENTS.md` — Claude, Codex, Copilot — behave as though the machine is catching
it, so nobody checks by hand. This repository's whole artifact workflow rests on
`node tests/run.js` and `nix flake check` meaning what the docs say. Where they
do not, the safety net is imaginary exactly when it is trusted.

**Traps. Nothing is broken today; the next change lands unguarded.**

1. **A rejected async test counts as a pass and the run exits 0.**
   `tests/harness.js:25-32` calls `fn()` inside `try` and never awaits it, so a
   rejection never reaches the `catch`; `tests/run.js:15` then calls
   `process.exit()` before Node surfaces it. Against the real harness:

   ```
   $ node b.js   # test("async failure", async () => { throw new Error("boom") })
   1 passed, 0 failed
   EXIT=0
   ```

   No test in `tests/model/` is async today. This is also the repository's only
   test safety net.

2. **Nothing verifies the `files` list in `flake.nix` is complete.** `AGENTS.md`
   makes it a named rule — a new runtime file goes in the list or it is not in
   the package — but `checks.default` tests only the two `entryPoints`
   (`flake.nix:105-107`). Add a file, import it from `MicrovmView.qml`, forget
   the list, and `nix flake check`, `nix build` and CI all pass while the plugin
   breaks at load. The list is correct today (14 of 14); this is about the next
   file. It is the highest-risk unenforced rule here, because the failure is
   invisible until a user loads the shell.

3. **The 8 MB `docs/img` budget can silently stop existing.** `flake.nix:149-152`
   wraps it in `if [ -d ${self}/docs/img ]`, so renaming the directory makes the
   check evaporate rather than fail. `ci.yml:34-38` has the same shape —
   `du ... 2>/dev/null` with `${size:-0}`, and a missing directory evaluates
   `0 -le 8388608` and passes. It is 4.9 MB of 8 MB today.

**Live inaccuracies. The documentation is wrong about the present state.**

4. **The hex-colour check is narrower than the rule.** `flake.nix:143` greps
   `'"#[0-9a-fA-F]{3,8}"'` over `${plugin}/*.qml` only. It catches `#RRGGBBAA`
   and uppercase, but misses `'#ff0000'` in single quotes (valid QML), never
   scans `Model.js`, and cannot see `rgba()`, three-digit hex or named colours.
   `VmList.qml:151` and `:196` both use `"transparent"` today, invisible to it.

5. **The pacman/yay check scans two globs; the plugin ships the whole
   repository.** `flake.nix:138` covers `${plugin}/*.qml ${plugin}/*.js`. But
   `omarchy plugin add` clones this repository *as* the plugin folder, so
   `README.md`, `docs/`, `AGENTS.md`, `microvm-binds.lua` and `manifest.json`
   all ship and none are scanned. The rule says "not even in comments". The
   wrinkle: widening the scope flags `AGENTS.md` and `README.md` themselves,
   which state the rule using those two words.

6. **`omarchy plugin validate` appears in `AGENTS.md:60` and `README.md:238`,
   and in no CI step.** `ci.yml:29-30` substitutes a symlink-only check. The
   fresh-clone form `AGENTS.md` documents is never automated, so what CI proves
   is a strict subset of what the docs claim.

7. **Three documents disagree on what `nix flake check` enforces.**
   `AGENTS.md:57`: "tests + manifest, entry points, no symlinks, no pacman/yay,
   no hex colours". `README.md:236`: "tests + manifest, schema, singleton, …".
   The derivation (`flake.nix:86-154`) also checks the `microvm-binds.lua`
   default chord and the `docs/img` budget, which neither document mentions;
   `AGENTS.md` omits schema and singleton, `README.md` omits entry points.
   Whoever reasons from either line reasons from a wrong list.

8. **`manifest.json:20` omits `e` from the bar-widget key list**, although
   `MicrovmView.qml:230` aliases it to `enter` and `README.md:69` documents
   `enter` `e` together. And `docs/usage.md` has no keyboard table at all — it
   points at the README (`docs/usage.md:11`). That leaves the "update
   `docs/usage.md` and the README in the same PR" rule unenforceable for key
   changes, since only one of the two files can drift.

**Weaker than it reads.**

9. **`flake.nix:112` "the schema is valid" is two jq predicates, not JSON-Schema
   validation.** `jq -e '.additionalProperties == false and (has("$schema")|not)'`
   passes on any object carrying those two keys, so a malformed `properties`,
   `required` or `enum` ships to the agent unnoticed. The one-copy half of the
   rule does hold: `tests/model/agent.test.js` reads the same `schema.json`.

10. **The sanitisation layer is tested only through well-formed round-trips.**
    28 of `Model.js`'s 119 top-level functions are never named in any test. Most
    predicates are covered transitively through `validateForm`, so the real gap
    is the layer guarding the only Nix this repository emits: `sanitize`
    (`Model.js:87`), `isPath` (`:663`), `isReservedGuest` (`:690`), `isSshKey`
    (`:743`), `hasControlChars` (`:747`) and `nixString` (`:847`) are each named
    zero times in `tests/`. Issue #22 is a set of bugs in exactly that layer.

11. **CI pins third-party code to a mutable tag.** `ci.yml:13` uses
    `cachix/install-nix-action@v31`; `ci.yml:12` uses `actions/checkout@v5`,
    first-party but also tag-pinned. A tag repoint runs arbitrary code on every
    PR. The blast radius is the runner: no `pull_request_target`, no secrets,
    `contents: read`, and `pages.yml` cannot deploy from a fork.

## Proposed outcome

`AGENTS.md`, `README.md` and the checks agree, and every documented rule is
either enforced by something running on each PR or marked as a convention the
reader upholds by hand. In particular: a failing test fails the run whatever
shape the function has; the rules `AGENTS.md` names — the `files` list, no
hardcoded colours, no pacman/yay — are checked over the scope the rule claims; a
check cannot disappear by having its subject renamed; one authoritative
statement of what `nix flake check` covers, with the other documents pointing at
it; the sanitisation layer has direct tests on malformed input; and the key
lists in `manifest.json`, `README.md` and `docs/usage.md` cannot disagree
without something saying so. How is for the spec.

## Affected users and systems

`flake.nix` (`checks.default`), `tests/harness.js`, `tests/run.js`,
`tests/model/`, `.github/workflows/ci.yml`, `AGENTS.md`, `README.md`,
`docs/usage.md`, `manifest.json`. No plugin runtime code, beyond any
`manifest.json` metadata correction.

Everyone who reads `AGENTS.md` as the single source: the owner, and every AI
agent working here. Anyone installing through `omarchy plugin add`, which clones
the whole repository as the plugin folder.

## Constraints

- **No symlinks anywhere in the repository.** `omarchy plugin add` clones it as
  the plugin folder and `omarchy-plugin-validate` refuses any symlink inside.
- Checks run on every PR and must stay fast enough that nobody skips them.
- `nix flake check` must not come to need the network or a live nixarchy
  desktop. Anything needing either belongs outside the flake check.
- Any check that would newly flag `AGENTS.md`'s or `README.md`'s own rule text
  needs an exclusion. The rule text stays as written; the check accommodates it.
- `docs/img` ships inside every clone and must stay under 8 MB. It is 4.9 MB.

## Open questions

1. **Pin CI actions to commit SHAs?** Personal repository, no secrets in the
   workflow, `contents: read`, so the exposure is the runner rather than the
   repository, against a renovation burden on every bump. Pin both, pin only the
   third-party one, or accept the tags and say so in the workflow?
2. **When `AGENTS.md` and `flake.nix` disagree, which one is wrong?** Each gap
   has two fixes: widen the check to the documented rule, or narrow the rule to
   the check. Item 5 (pacman/yay across the whole clone) is the one where
   narrowing is arguably right.
3. **Where do the sanitisation-layer tests belong?** Issue #22 is fixing bugs in
   that layer and will want tests with it. Writing them here risks conflicting
   with that work; leaving them there closes this issue with its highest-value
   finding unaddressed.
4. **Should `docs/usage.md` gain a keyboard table**, making "update both in the
   same PR" meaningful, or should that rule name the README alone?
