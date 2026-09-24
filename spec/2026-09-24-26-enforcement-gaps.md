---
status: approved
issue: 26
intent: intent/2026-09-24-26-enforcement-gaps.md
---

# Spec: make the checks match the rules, and prove the checks

## Design

Every check below runs inside `checks.default` or `ci.yml`, over files already in
the store. Re-confirmed per check, including the ones added in this revision:
none of them opens a socket, and none needs a nixarchy desktop or the omarchy
tooling. The files-list check (point 2) compares two directory listings; the
pacman check (point 4) is one `grep -I` plus a `comm` against a text file in the
repository; the self-test (point 1) is one more `node` process over the same
sources the tests already use. All of it stays within the seconds
`nix flake check` costs today.

**1. The harness refuses async tests, and disarms the promise it refuses.**
`tests/harness.js:25-32` keeps its signature. `test()` captures the return value
of `fn()`; if that value is thenable, it attaches `value.catch(() => {})` **and
then** records a failure named after the test — "async test function; Model.js is
synchronous". The `catch` is not decoration. Without it the rejected promise has
no handler, and Node terminates the process on the unhandled rejection
regardless of `process.exitCode`. Measured on the Node this flake pins
(v26.8.1), on the self-test shape below — three bad tests, `report()` returning 1, success meaning exit 0:

```
$ node st.js     # harness WITHOUT the catch
0 passed, 3 failed
failures: 3 report: 1
Error: boom
    at st.js:11:43
Node.js v26.8.1
EXIT(no handler)=1

$ node st2.js    # identical, plus value.catch(() => {})
0 passed, 3 failed
failures: 3 report: 1
EXIT(with handler)=0
```

The bookkeeping is already correct without the `catch` — three failures, exit
code 1 — and the process still dies with a stack trace and the wrong status. So
the reviewer's reading is right and the design is amended: the `catch` is
mandatory, not incidental, and the plan must not drop it as noise.

`tests/run.js:15` stops calling `process.exit()`: it sets
`process.exitCode = harness.report()` and returns, so Node flushes stdout. A test
file that throws at `require` time exits non-zero, as now.

The harness cannot be checked by the tests it runs, so it gets
`tests/selftest.js`: a separate process requiring the harness and registering
three deliberately bad tests — one throwing synchronously, one `async` that
rejects, one `async` that resolves. To let it count them, `harness.js` exports
the `failures` array it already keeps (`tests/harness.js:23`); the self-test
asserts `failures.length === 3` **and** `report() === 1`, and exits 0 only then.
Exporting the array is the whole API change: `report()` alone cannot distinguish
three failures from one. `checks.default` runs the self-test before
`node tests/run.js`. The fixtures are failures by construction and live in their
own file, so they leave no violation in `tests/model/`.

**2. The `files` list is checked by a deny-list, so it fails closed.**
The rule in `AGENTS.md` is that *every* new runtime file is listed. A check that
recognises today's extensions cannot enforce that: a future root `.sh`, `.css`,
`.svg` or extensionless helper would be silently ignored. The earlier draft
accepted that hole; it sits exactly where the next unlisted file lands.
Inverted:

> Every non-directory entry at the repository root is a runtime file and must
> appear in `files`, unless it is on the deny-list.

The deny-list is the six root files that are documentation, CI or build
metadata: `.gitignore`, `AGENTS.md`, `CLAUDE.md`, `README.md`, `flake.lock`,
`flake.nix`. Directories are excluded as a class — `pluginFor` flattens with
`cp ${f} "$out/${baseNameOf f}"` (`flake.nix:47`), so nothing under `tests/`,
`docs/`, `share/`, `intent/`, `spec/`, `plan/` or `.github/` could ship
correctly even if listed.

Checked against the tree on this branch: the root blobs minus the deny-list are
exactly the fourteen paths already in `files` (`flake.nix:15-30`) — `diff`
reports them identical, so the rule produces zero false positives today.

The check compares that set against `ls ${plugin}`, both ways. A new root file
of any kind fails until someone either lists it or adds it to the deny-list —
the classification is forced, which is the point. A stale entry for a deleted
file fails too, which the entry-point check (`flake.nix:105-107`) never caught.
The maintenance cost is deliberate: a new root `.editorconfig` breaks the build
once, and the fix is one word.

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

**4. pacman/yay: scan the whole clone, exempt lines rather than files.**
`omarchy plugin add` clones the repository as the plugin folder, so the scope is
every tracked file, which adds `docs/`, `microvm-binds.lua`, `manifest.json`,
`share/omarchy-menu.jsonc` and `README.md`. The earlier draft then excluded
`AGENTS.md`, `README.md`, `flake.nix` and the three artifact directories by
path. Withdrawn: the rule says "not even in comments", so excluding whole documents
claims a scope the check does not have — a genuine `pacman -S` in `README.md`
would pass — and it scanned `README.md` and excluded it in the same paragraph.

Instead: the three artifact directories are excluded as a class, and every other
tracked file is scanned with a per-line allow-list.

*(Correction, recorded after implementation: two more exclusions were needed and
are in the shipped check — `flake.nix` and `tests/pacman-allowed.txt`. Each
necessarily contains the pattern it exists to search for, so listing their lines
would mean editing the allow-list every time the check itself is touched. It is
the same "excluded as a class, for a reason that does not decay" argument this
section already makes for the artifact directories, applied to two files that
self-match. `AGENTS.md:193-195` and the shipped `# check: pacman` both say so;
this paragraph did not, which is the exact failure mode this whole issue is
about, so it is corrected here rather than left.)*

`intent/`, `spec/` and `plan/` are excluded because they are design history that
quotes the rule in order to reason about it, and because the set grows without
bound — this very task's three artifacts contain 29 of the repository's 39
occurrences. An earlier version of this section put the count at ten and listed
only the 2026-09-18 artifacts; it had not counted its own files, so the check as
specified would have failed on the branch that introduces it. A per-line
allow-list over artifacts would need a new entry every time anyone writes about
the rule, which is a maintenance tax that ends with the check being disabled.

Everything else is scanned, including `AGENTS.md`, `README.md`, `docs/`,
`flake.nix`, `.github/`, `manifest.json`, `microvm-binds.lua`,
`share/omarchy-menu.jsonc` and all runtime content. Their legitimate occurrences
are exempted line by line in `tests/pacman-allowed.txt`, by trimmed exact
content. Measured with `grep -Inw` over `git ls-files` minus the three artifact
directories, that is five lines today:

| Path | Lines |
| --- | --- |
| `AGENTS.md` | 57, 168 |
| `README.md` | 236 |
| `flake.nix` | 138 |
| `.github/workflows/ci.yml` | 18 |

Five is stable: it changes only when the rule's own wording moves, which is a
reviewable event. A genuine `pacman -S` in `README.md` or in any shipped file
still fails, which is what the earlier whole-file exclusion of `README.md` got
wrong.

The check greps that scope, trims each hit, and subtracts the allow-list;
anything left fails and is printed with its path and line. `grep -I` skips
binaries: `docs/img/*.png` and `*.mp4` contain the byte sequences as substrings
and matched the old case-insensitive grep, though none matches with `-w`.

The allow-list exempts its own contents tautologically, which is fine and is the
design: the file *is* the review surface for this rule, and adding a line to it
is a diff a reviewer sees.

**5. A check asserts its own preconditions.** General rule, applied wherever a
check names a path: assert the subject exists, then assert the property. The
`docs/img` budget becomes `test -d ${self}/docs/img || fail`, then the `du`
comparison — the `if [ -d ... ]` at `flake.nix:149-152` goes. `ci.yml:34-38`
drops `2>/dev/null` and `${size:-0}` for the same shape. The files-list check
inherits it for free by comparing two sets: an empty package fails.

**6. `omarchy plugin validate` cannot run in CI, and the docs say so.** It needs
the omarchy tooling, which no GitHub runner has and which `nix flake check` must
not fetch. Unchanged, and re-confirmed: it is not faked, not stubbed, and not
approximated. CI keeps the symlink check (`ci.yml:29-30`) — the one part of
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

**Split with #22, settled.** #22 owns direct tests for the sanitisation layer —
`sanitize` (`Model.js:87`), `isPath` (`:663`), `isReservedGuest` (`:690`),
`isSshKey` (`:743`), `hasControlChars` (`:747`), `nixString` (`:847`), tag
sanitisation and the `parse(emit(f)) == f` round trip — because it is changing
those functions now and tests written here would encode the bugs it is fixing.
#26 owns the enforcement mechanism and the proof that the mechanism catches its
own fixtures. This is the owner's ruling, not a proposal.

## Alternatives rejected

**Make the harness async-capable.** `test()` returns a promise, run.js awaits a
queue, `report()` runs after settle — an await chain through three files to
support something no test here needs. `Model.js` is a pure library; an async test
in it signals a mistake. Detecting is four lines and a clearer error.

**Let the self-test avoid the rejection instead of the harness handling it.**
A fixture that rejects on a later tick, or a pre-rejected promise built by hand,
keeps the harness one line shorter and leaves the hazard live for every real
test file. The `catch` belongs where the promise is dropped.

**Classify root files by extension.** Recognising `.qml`/`.js`/`.json`/`.lua`
distinguishes today's runtime files from `.md`, and silently ignores every kind
the plugin has not used yet. It fails open on exactly the case the rule exists
for. Withdrawn in favour of the deny-list.

**Derive the files list from what the entry points import.** Following imports
transitively from `Menu.qml` and `Panel.qml` would be exact, but it needs a QML
parser in the check and still cannot see `LICENSE`, `manifest.json`, `qmldir` or
`microvm-binds.lua`, which nothing imports.

**Exclude whole documents from the pacman scan.** Withdrawn under point 4: it
claims a scope it does not have.

**Narrow the pacman rule to shipped runtime content and reword `AGENTS.md`.**
Defensible, and rejected on evidence: `README.md:236` names the word today and
nixarchy's validation has never failed on it, so the real constraint may well be
narrower than "every file". But the wording is what every agent greps for, and
the line-level allow-list keeps the wording honest for the same cost.

**Sync the three enumerations with a check.** Keeping three copies correct is
more machinery than having one.

## Risks

- **A widened check flags existing correct code and blocks every PR.** The known
  cases are handled in the design rather than after the fact: `"transparent"`
  (three sites) and `Qt.rgba` from a token are excluded by the patterns, and the
  ten rule-text lines are enumerated in the pacman allow-list. Any further case
  found while implementing is fixed in the same change as the check that finds
  it — a check must not land red.
- **The pacman allow-list can be widened to hide a real instruction.** Accepted:
  adding a line to it is a visible diff, which is strictly better than the
  invisible whole-file exclusion it replaces.
- **The files deny-list costs a broken build on every new root file.** That is
  the mechanism, not a defect. The `# check:` name in `AGENTS.md` says so.
- **The stricter harness may reveal existing failures.** No test in
  `tests/model/` is async today, so the expected delta is zero.
- **`${self}` in a flake check is the git tree**, so an untracked root `.qml` is
  invisible to the files-list check locally. CI runs against a clean checkout,
  where it is not.

## Verification

Every check is proved by a fixture that must make it fail, and by the tree as it
stands passing.

| Check | Fixture that must fail | Expected |
| --- | --- | --- |
| harness rejects async | `tests/selftest.js` | exit 0 only when `failures.length === 3` and `report()` returned 1; no unhandled-rejection trace on stderr |
| run.js exit code | a throwing test in `tests/model/` | `$?` is 1 and the FAIL line is printed |
| files list, unlisted file | a new root file of a kind the old rule ignored, e.g. `zz.sh` | "zz.sh missing from the package" |
| files list, stale entry | remove one path from `files` while its source file stays at the root | the checker names it as required but not packaged |
| files list, no false positive | the tree as it stands | passes; root blobs minus the deny-list equals `files` exactly |
| colours, hex | `color: '#ff0000'` in `VmList.qml`, single quotes | hardcoded colour, with the line |
| colours, function | `color: "rgba(0,0,0,0.5)"` | hardcoded colour |
| colours, named | `color: "red"` | hardcoded colour |
| colours, Model.js | a hex string in `Model.js` | hardcoded colour — proves the widened scope |
| colours, no false positive | the tree as it stands | passes with `"transparent"` ×3 and `ShortcutSheet.qml:32` present |
| pacman, runtime | the word in `manifest.json` | flagged — proves the widened scope |
| pacman, prose | a fresh `pacman -S foo` line in `README.md` | flagged — proves whole-file exclusion is gone |
| pacman, no false positive | the tree as it stands | passes with the ten allow-listed lines present |
| img budget | `docs/img` renamed away | "docs/img is missing", in the flake check and the `ci.yml` step |
| docs in sync | a `# check: zz` block with nothing in `AGENTS.md`, and the reverse | "check zz is not documented" / "(checked: zz) names no block" |

The `ci.yml` steps are verified by running their bodies locally against the same
fixtures, since the workflow itself only runs on a push.
