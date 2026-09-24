---
status: approved
issue: 26
intent: intent/2026-09-24-26-enforcement-gaps.md
---

# Spec: make the checks match the rules, and prove the checks

## Design

Every check below runs inside `checks.default` or `ci.yml`, over files already in
the store. None needs the network, a live desktop or a second Nix evaluation, so
all of it stays within the seconds `nix flake check` costs today.

**1. The harness refuses async tests rather than supporting them.**
`tests/harness.js:25-32` keeps its signature. `test()` captures the return value
of `fn()`; if that value is thenable, or `fn` is an `AsyncFunction`, it records a
failure named after the test — "async test function; Model.js is synchronous" —
instead of counting a pass. Nothing is awaited; `report()` is unchanged.
`Model.js` is a `.pragma library` with no I/O, so no test here has a legitimate
reason to be async. `tests/run.js:15` stops calling `process.exit()`: it sets
`process.exitCode = harness.report()` and returns, so Node flushes stdout and
still surfaces any rejection that escaped. A test file that throws at `require`
time exits non-zero, as now.

The harness cannot be checked by the tests it runs, so it gets
`tests/selftest.js`: a separate process that requires the harness, registers
three deliberately bad tests — one throwing synchronously, one `async` that
rejects, one `async` that resolves — and asserts `report()` returned 1 after
exactly three failures, exiting 0 only then. Those fixtures are failures by
construction, so they leave no violation behind. `checks.default` runs it before
`node tests/run.js`.

**2. The `files` list is checked by a rule, not a list.**
A runtime file is a file at the repository root whose name is `qmldir`, `LICENSE`,
or ends in `.qml`, `.js`, `.json` or `.lua`. Nothing in a subdirectory is
runtime: `pluginFor` flattens with `cp ${f} "$out/${baseNameOf f}"`
(`flake.nix:47`), so a file under `tests/`, `docs/`, `share/`, `intent/`,
`spec/`, `plan/` or `.github/` could not ship correctly even if listed. Root
`.md`, `.nix`, `.lock` and `.gitignore` are excluded by not matching.

The check compares two sets, both ways: the runtime files of `${self}` at
`-maxdepth 1`, and `ls ${plugin}`. A file in one and not the other fails, naming
it. `intent/foo.md` is in a subdirectory and does not fail; a new root `Foo.qml`
fails until it is in `files`; a stale entry for a deleted file fails too, which
the entry-point check (`flake.nix:105-107`) never caught. The rule needs
maintenance only when the plugin gains a new *kind* of runtime file.

**3. Colours: widen the pattern, scope it to what ships, and do not flag what is
already right.** Scope becomes `${plugin}/*.qml ${plugin}/*.js`, which adds
`Model.js`. Three patterns, each a violation:

- a hex literal in either quote style — `['"]#[0-9a-fA-F]{3,8}['"]`;
- a CSS colour function inside a string — `['"](rgba?|hsla?)\(`;
- a named colour assigned to a colour property — `colou?r\s*:\s*"[a-z]+"`,
  minus `"transparent"`.

`"transparent"` is not a violation: it is the absence of a colour, survives every
theme switch, no `Color.*` token expresses it, and `Menu.qml:89`,
`VmList.qml:151` and `:196` are correct as written. `Qt.rgba(...)` is not a
violation when its arguments derive from a token, the only form present —
`ShortcutSheet.qml:32` builds a 0.97 alpha of `root.background`. Only the
all-literal `Qt\.rgba\([0-9., ]*\)` is flagged. A check that condemns the correct
code in front of it gets commented out by the next person in a hurry; these
patterns flag nothing that exists today.

**4. pacman/yay: scan the whole clone, exclude the documents whose subject is the
rule.** `omarchy plugin add` clones the repository as the plugin folder, so the
scope is every tracked file, which adds `docs/`, `microvm-binds.lua`,
`manifest.json`, `share/omarchy-menu.jsonc` and `README.md`. Excluded by path:
`AGENTS.md`, `README.md`, `flake.nix`, and `intent/`, `spec/`, `plan/` — the
documents that state the rule, quote it, or implement it, this file included.
The exclusion is by path rather than by rewording the rule because a rule that
cannot name the forbidden token is not usable: every agent working here greps
`AGENTS.md` for the literal words. The residual risk is stated under Risks.

**5. A check asserts its own preconditions.** General rule, applied wherever a
check names a path: assert the subject exists, then assert the property. The
`docs/img` budget becomes `test -d ${self}/docs/img || fail`, then the `du`
comparison — the `if [ -d ... ]` at `flake.nix:149-152` goes. `ci.yml:34-38`
drops `2>/dev/null` and `${size:-0}` for the same shape. The files-list check
inherits it for free by comparing two sets: an empty package fails.

**6. `omarchy plugin validate` cannot run in CI, and the docs say so.** It needs
the omarchy tooling, which no GitHub runner has and which `nix flake check` must
not fetch. CI keeps the symlink check (`ci.yml:29-30`) — the one part of
validation a runner can prove — plus the files-list check from point 2. The
fresh-clone form stays a manual step, labelled as manual where it appears. No
pre-push hook: a hook only some clones have is the imaginary safety net again.

**7. `flake.nix` is the source of truth for what is enforced**, being the only
one of the three that executes. `AGENTS.md:57` and `README.md:236` stop
enumerating — the enumeration is deleted, not synchronised, so nothing is left to
drift. Each check block in `flake.nix` gains a `# check: <name>` first line, and
`AGENTS.md`'s Rules section marks each rule `(checked: <name>)` or `(by hand)`.
One check closes the loop in both directions: every `# check:` name must appear
in `AGENTS.md`, and every `(checked: …)` must name a real block. Adding a check
without documenting it, or claiming one that does not exist, fails.

**8. The JSON-Schema predicate stays as it is.** Real validation needs a
validator in the check's closure, and `tests/model/agent.test.js` already reads
the same file and exercises the fields the reply uses. `flake.nix:112`'s comment
is corrected to say what it asserts — strict, no `$schema` key — rather than
"the schema is valid".

**9. CI actions keep their tags.** `contents: read`, no `pull_request_target`, no
secrets in `ci.yml`, and `pages.yml` cannot deploy from a fork, so a repointed
tag reaches the runner and nothing else. SHA pins would cost a bump on every
renovation for that. `ci.yml` gains the missing explicit
`permissions: contents: read` — it has none today and inherits the repository
default — and a comment recording the tag decision.

**10. Minor.** `manifest.json:20` gains the `e` alias. `docs/usage.md` gets no
keyboard table: the AGENTS.md rule is narrowed to name the README as the key
reference, matching `docs/usage.md:11`, which already points there.

**Not in scope: the sanitisation tests.** `sanitize` (`Model.js:87`), `isPath`
(`:663`), `isReservedGuest` (`:690`), `isSshKey` (`:743`), `hasControlChars`
(`:747`) and `nixString` (`:847`) get their malformed-input tests in #22, which
is changing those functions now. Tests written here would encode current
behaviour — including the bugs #22 is fixing — as expectations, and conflict on
merge. #26 owns the mechanism, not the coverage: "this layer has tests" is not a
rule in `AGENTS.md`, and inventing one inside an enforcement task is how the next
imaginary safety net gets built. The names are recorded here for #22's plan.

## Alternatives rejected

**Make the harness async-capable.** `test()` returns a promise, run.js awaits a
queue, `report()` runs after settle — an await chain through three files to
support something no test here needs. `Model.js` is a pure library; an async test
in it signals a mistake. Detecting is four lines and a clearer error.

**Derive the files list from what the entry points import.** Following imports
and component references transitively from `Menu.qml` and `Panel.qml` would be
exact, but it needs a QML parser in the check and still cannot see `LICENSE`,
`manifest.json`, `qmldir` or `microvm-binds.lua`, which nothing imports. The
root-plus-extension rule needs no parser and covers every file `files` lists.

**An explicit allow-list of non-runtime root files.** Inverts the maintenance:
every new root file must be classified or the check fails.

**Reword the pacman rule so the check can scan everything.** The rule would have
to describe the forbidden tokens without writing them, and the rule text is what
agents grep for.

**Add `omarchy plugin validate` to CI behind a fetch of the omarchy tooling.**
Network in a flake check, for a tool that also expects a nixarchy desktop.

**Sync the three enumerations with a check.** Keeping three copies correct is
more machinery than having one.

## Risks

- **A widened check flags existing correct code and blocks every PR.** The two
  known cases are handled in the design rather than after the fact:
  `"transparent"` (three sites) and `Qt.rgba` from a token are excluded by the
  patterns, and `AGENTS.md`/`README.md` rule text is excluded by path. Any
  further case found while implementing is fixed in the same change as the check
  that finds it — a check must not land red.
- **The pacman path exclusion could hide a real instruction** in `README.md` or
  an artifact — a genuine `pacman -S` in prose would pass. Accepted: those five
  paths are prose, reviewed by hand, and the rule's actual target is the runtime
  and the docs that ship as instructions.
- **The stricter harness may reveal existing failures.** No test in
  `tests/model/` is async today, so the expected delta is zero, but
  `process.exitCode` replacing `process.exit()` changes when the process ends and
  could surface a swallowed rejection. If it does, that is a real failure, fixed
  here.
- **The files-list rule misclassifies a future file kind** — a root `.sh` that
  should ship is ignored. It fails open, and the `# check:` name in `AGENTS.md`
  says what the rule covers.
- **`${self}` in a flake check is the git tree**, so an untracked root `.qml`
  is invisible to the files-list check locally. CI runs against a clean
  checkout, where it is not.

## Verification

Every check is proved by a fixture that must make it fail. Except the harness
self-test, each fixture is a transient edit to the working tree: apply it, run
`nix flake check`, observe the named failure, revert with `git checkout --`. The
plan records the observed message per fixture; nothing stays in the repository.

| Check | Fixture that must fail | Expected |
| --- | --- | --- |
| harness rejects async | `tests/selftest.js`, permanent | exit 0 only when the three bad tests were all counted as failures and `report()` returned 1 |
| run.js exit code | a temporary throwing test in `tests/model/` | `node tests/run.js`; `$?` is 1 and the FAIL line is printed |
| files list | add `Zz.qml` at the root, leave `files` alone | "Zz.qml missing from the package" |
| files list, other way | delete a file from the root, leave `files` alone | the build fails on the missing source, which is the same signal |
| files list, no false positive | add `intent/zz.md` | check passes |
| colours, hex | `color: '#ff0000'` in `VmList.qml` (single quotes, the form the old pattern missed) | hardcoded colour, with the line |
| colours, function | `color: "rgba(0,0,0,0.5)"` | hardcoded colour |
| colours, named | `color: "red"` | hardcoded colour |
| colours, Model.js | a hex string in `Model.js` | hardcoded colour — proves the widened scope |
| colours, no false positive | the tree as it stands | passes with `"transparent"` ×3 and `ShortcutSheet.qml:32` present |
| pacman | the word in `docs/usage.md`, then in `manifest.json` | flagged in both — proves the widened scope |
| pacman, no false positive | the tree as it stands | passes with the rule text in `AGENTS.md`, `README.md` and the artifacts |
| img budget | `git mv docs/img docs/img2` | "docs/img is missing", in both `nix flake check` and the `ci.yml` step run locally |
| docs in sync | add a `# check: zz` block to `flake.nix` and nothing to `AGENTS.md` | "check zz is not documented"; and the reverse, a `(checked: zz)` marker with no block |

The `ci.yml` steps are verified by running their bodies locally against the same
fixtures, since the workflow itself only runs on a push.
