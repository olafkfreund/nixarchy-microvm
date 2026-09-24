---
status: draft
issue: 36
spec: spec/2026-09-24-36-schema-boundary.md
---

# Plan: correct the rule to name the real gate, and check the two field sets agree

The spec chose resolution **(b)**. `schema.json` keeps one job: it goes out with
the call as `--json-schema` (`Model.js:1453`) and shapes the model's answer; it is
not a gate on the way back. The gate is `Model.applyAgentReply` (`Model.js:1541`),
stricter than the schema in ways the schema cannot express — the `hasOwnProperty`
lookup into `AGENT_FIELDS` (`Model.js:1548`) drops any key the form does not own,
a wrong type is dropped rather than reported, `kind` is checked against the live
`KINDS` (`Model.js:153`), and whatever survives goes through `validateForm` and
then `machineSnippet`'s `nixSafe` (`Model.js:1016`). No code path changes. Four
things move:

1. `AGENTS.md:207-210` is replaced with wording that names that gate, verbatim as
   the spec wrote it (Step 2).
2. A new `tests/schema-fields.js` and a new `# check: schema-fields` block keep
   `Object.keys(SCHEMA.properties)` and `Object.keys(Model.AGENT_FIELDS)` from
   drifting apart, plus `kind.enum` against `KINDS`, `required ⊆ properties`, and
   `sshKey` in neither (Steps 1, 2).
3. `# check: schema` (`flake.nix:138-143`) keeps its name and gains structural
   `jq` assertions. No JSON-Schema validator is written or vendored: the file has
   one consumer and one shape (Step 3).
4. `tests/model/agent.test.js:15`'s hand-maintained field literal becomes a
   comparison against `Model.AGENT_FIELDS`, taking hand-maintained copies of the
   field set from one to zero (Step 4).

Resolution (a) — validating the reply against `schema.json` — was rejected: a
validator for the keywords in use is silently permissive on any keyword added
later, and the schema is the weaker of the two gates, so it would be a second lock
with the weaker key. `maxItems: 16` stays enforced nowhere; a cap belongs in
`validateForm`, out of scope.

## Steps

One commit per step, each citing this plan.

**1 — `tests/schema-fields.js`: the new check script.** *(plan step 1)*

Exact shape, following `tests/selftest.js`: no harness bookkeeping, a plain script
that prints and sets `process.exitCode`.

- `const { Model } = require("./harness.js")` — the loader at
  `tests/harness.js:6-18` strips `.pragma library` and runs `Model.js` through
  `vm.runInThisContext`, so every top-level binding lands on the namespace.
  `Model.AGENT_FIELDS` and `Model.KINDS` are reachable that way today, verified.
- `JSON.parse(fs.readFileSync(path.join(__dirname, "..", "schema.json"), "utf8"))`
  — the same single file `tests/model/agent.test.js:5` and `MicrovmState.qml:30`
  read. Both sides are parsed by their own parser; no JavaScript is grepped out of
  `Model.js` and no list is generated at build time.
- It compares four things, collecting every failure rather than throwing on the
  first, so one run names everything wrong:
  1. the two field sets. `schema` minus `fields` prints one line each,
     `schema-fields: <name> is in schema.json but not in AGENT_FIELDS`; `fields`
     minus `schema` prints `schema-fields: <name> is in AGENT_FIELDS but not in
     schema.json`;
  2. `SCHEMA.properties.kind.enum` against `Model.KINDS`, printing
     `schema-fields: kind.enum is [...] but KINDS is [...]`;
  3. every name in `SCHEMA.required` present in `SCHEMA.properties`, printing
     `schema-fields: required names <name>, which is not a property`;
  4. `sshKey` absent from both, printing
     `schema-fields: sshKey must not be agent-settable`.
- On success it prints `schema-fields: schema.json and AGENT_FIELDS name the same
  9 fields` and leaves `process.exitCode` at 0. On any failure every line goes to
  `console.error` and it sets `process.exitCode = 1` — **not** `process.exit()`,
  for the reason `tests/run.js:17-19` gives: `process.exit()` cuts off anything
  Node still has to report.

Verify by `node tests/schema-fields.js` on the unmodified tree → exit 0. Offline;
Node and two files already in the repository.

**2 — `flake.nix` + `AGENTS.md`: wire the check and claim it.** *(plan step 2)*

Both files in one commit, because `# check: docs-sync` (`flake.nix:232-249`) fails
if a `# check: <name>` block has no matching `(checked: <name>)` and vice versa.

`flake.nix`: a new block in `checks.<system>.default`, after `# check: schema`:

```
# check: schema-fields
# schema.json steers the model; applyAgentReply is the gate. The two
# may not name different fields (#36).
node tests/schema-fields.js
```

**The script is carried into the derivation already.** `flake.nix:91` is
`cp -r ${./tests} tests` — the whole directory as one store path, not a file list
— so anything under `tests/` is in the sandbox without a further edit. Confirmed
by reading the derivation. This is exactly how #25's `keys.test.js` failed in CI,
so it is stated rather than assumed; `Model.js` and `schema.json` are likewise
copied at `flake.nix:92-93`. The block is its own named block, not a line inside
`# check: tests`, because only a named block can be claimed by
`(checked: schema-fields)`. The file lives under `tests/`, not the root, so
`# check: files-list` is unaffected.

`AGENTS.md:207-210` is replaced, verbatim:

```markdown
- **The agent's reply is data for the form and nothing else.** `schema.json`
  goes *out* with the call, as `--json-schema`, to shape the model's answer; it
  is not a gate on the way back. The gate is the per-field conversion in
  `Model.applyAgentReply`, which is stricter than the schema: a value of the
  wrong type is dropped rather than coerced, a key absent from `AGENT_FIELDS`
  is dropped — so `sshKey`, `describe` and `editing` are not agent-settable at
  all — `kind` must be in `KINDS`, and strings pass `sanitize` at the field's
  own length. Every value that survives goes through `validateForm` as if the
  user had typed it, is shown, and is confirmed by them; `machineSnippet`
  refuses the line outright if `nixSafe` ever fails on it. The schema and
  `AGENT_FIELDS` may not name different fields *(checked: schema-fields)*.
  Nothing in a reply is executed, and the call itself runs `claude` with
  `--restricted --strict-mcp-config --tools ""`.
```

Verify by `nix flake check` → passes, `docs-sync` included. Offline: both grep
over files already in the store.

**3 — `flake.nix:138-143`: `# check: schema` gains structure.** *(plan step 3)*

The block keeps its name and its `(checked: schema)` claim. Its comment's own
admission — "a malformed properties or required would pass" — is removed with the
gap. The single `jq -e` gains, alongside the two assertions it has:

- `(.properties | type) == "object"`
- `(.required | type) == "array" and (.required | length) > 0`
- `([.properties[] | has("type")] | all)`
- `(.required - (.properties | keys)) == []`

Verify by `nix flake check` → passes. Offline: `jq` over `${plugin}/schema.json`.

**4 — `tests/model/agent.test.js:15`: the literal becomes a comparison.**
*(plan step 4)*

```js
eq(Object.keys(SCHEMA.properties).sort(), Object.keys(Model.AGENT_FIELDS).sort())
```

replaces the sorted nine-name array. The three lines around it stay:
`eq(SCHEMA.additionalProperties, false)`, `ok(!("sshKey" in SCHEMA.properties))`
and `ok(!("SCHEMA" in Model))` (`agent.test.js:14,16,18`) — the last is what keeps
`Model.js` from growing an inline copy of the schema. The test's name is updated
to say it agrees with `AGENT_FIELDS` rather than naming the fields.

Verify by `node tests/run.js` → still **93 passed, 0 failed**: an assertion is
rewritten, none added. Offline.

## Tests

Every step above runs on a GitHub runner with no network: Node, `jq` and files
already in the repository, no fetch, no dependency install. Stated per step.

**The new check must be seen to fail** (#26's standard for every check here).
Each fixture is applied, the check run, the output read, the fixture reverted:

1. `"cpuPin": { "type": "string" }` added to `schema.json`'s `properties` →
   `schema-fields: cpuPin is in schema.json but not in AGENT_FIELDS`, exit 1.
2. `"reasoning"` deleted from `schema.json`'s `properties` →
   `schema-fields: reasoning is in AGENT_FIELDS but not in schema.json`, exit 1.
   (`# check: schema`'s new `required ⊆ properties` assertion fires on this one
   too, since `reasoning` is in `required` — both failures are correct.)
3. `hostname: "string"` added to `AGENT_FIELDS` (`Model.js:1532`) →
   `schema-fields: hostname is in AGENT_FIELDS but not in schema.json`, exit 1.
4. `kind.enum` changed to `["disposable"]` → `schema-fields: kind.enum is
   ["disposable"] but KINDS is ["disposable","permanent"]`, exit 1.
5. `"sshKey": { "type": "string" }` added to `schema.json` → two lines, the
   set-difference one and `schema-fields: sshKey must not be agent-settable`,
   exit 1.

Fixtures 1, 2 and 5 also break `agent.test.js:15` after Step 4, which is the
point: the same drift is caught twice, by a check and by a test, neither of them
holding a copy of the answer.

**`# check: schema`, extended:** `"required": ["nope"]` → fails; the `type`
dropped from `properties.cores` → fails; the file unchanged → passes.

**`# check: docs-sync`:** with `# check: schema-fields` in `flake.nix` and no
`(checked: schema-fields)` in `AGENTS.md`, it prints `check schema-fields is not
documented in AGENTS.md` and exits 1 — its existing `comm -23 names claimed`
branch (`flake.nix:248`) covers this with no change; the reverse, a
`(checked: schema-fields)` claiming no block, is the `comm -13` branch. Both
directions are already its job. With both present, it passes.

**Whole suite:** `node tests/run.js` → 93 passed, 0 failed (93 on main today;
Step 4 adds no test). `nix flake check` → passes; `nix flake check --all-systems
--no-build` evaluates on aarch64.

`docs/usage.md` and `README.md` need no change: nothing user-visible moves.

## Rollback

- **Step 1** is a pure addition: `git rm tests/schema-fields.js`. Nothing else
  references it until Step 2.
- **Step 2** is the only step that can fail a build that passed before, and it
  must be reverted as a unit — dropping the `flake.nix` block while leaving
  `(checked: schema-fields)` in `AGENTS.md` fails `docs-sync` from the other
  direction. `git revert` of the single commit restores both.
- **Step 3** changes an existing check's strictness; reverting the block restores
  the two original assertions. A schema that fails it was already malformed, so a
  revert is a decision to ship that, not a fix.
- **Step 4** is a test-only edit; reverting restores the literal and the suite
  still reports 93.

Steps 2 and 3 change build-time behaviour; 1 and 4 are additions to `tests/`. No
runtime file changes anywhere, so nothing needs reinstalling on a desktop and
`AGENTS.md`'s live-verification procedure does not apply.
