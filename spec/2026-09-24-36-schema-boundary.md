---
status: approved
issue: 36
intent: intent/2026-09-24-36-schema-boundary.md
---

# Spec: the per-field conversion is the boundary, and AGENTS.md says so

## Design

Resolution **(b)**: correct `AGENTS.md:207-210` to describe the gate the code
actually has, and add a check that the schema's field set and `AGENT_FIELDS`
cannot drift apart. `schema.json` keeps its one job — it goes out with the call
and shapes the model's answer — and `Model.applyAgentReply` stays the boundary.

The argument is in the code. `applyAgentReply` (`Model.js:1541`) is not a looser
gate than `schema.json`, it is a strictly stronger one, and in ways the schema
cannot express:

- every key is looked up in `AGENT_FIELDS` through `hasOwnProperty`
  (`Model.js:1548`), so `sshKey`, `describe` and `editing` are not agent-settable
  at all. `additionalProperties: false` says only "not in the schema", which is
  weaker: it would let a future field be schema-declared and form-settable in one
  edit. A wrong type is pushed onto `rejected` and dropped, never coerced
  (`Model.js:1550-1577`); JSON Schema's job is to *report* that, not drop it;
- `kind` is checked against `KINDS` (`Model.js:153`), a live constant rather than
  a copy of the enum, and strings pass `sanitize` at the field's own length,
  stripping control characters `maxLength` says nothing about;
- whatever survives goes through `validateForm` (`Model.js:916`) as if typed —
  `isVmName`, `isTemplate`, `isMiB`, `isCores`, `isPort`, `parseShares` — is
  shown and confirmed, and then `machineSnippet` re-checks every written string
  with `nixSafe` (`Model.js:1016`), returning `null` rather than emit a line
  (#22).

The only thing the schema holds that none of these do is `shares.maxItems: 16`,
the issue's example. A 17-share reply reaches the form as a 17-entry `shares`
string; `parseShares` judges every entry and the user confirms it. That is a
cosmetic limit on a field the user edits, not a safety property, and
`validateForm` is where a cap on it would belong.

So (a) adds a fourth gate duplicating the weakest of the three, kept in step by
hand. This repository has been bitten exactly there — #26 was rules enforced
more thinly than their prose, #22 a comment asserting a property that had
stopped being true — and the lesson is fewer claims, each checked.

**Replacement wording for `AGENTS.md:207-210`, verbatim:**

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

**The check: `# check: schema-fields`.** A new block in `flake.nix`'s
`checks.<system>.default`, running `node tests/schema-fields.js` inside the
existing sandbox — Node and `schema.json` are already copied in there
(`flake.nix:91-93`). It asserts, in both directions:

`Object.keys(SCHEMA.properties)` equals `Object.keys(Model.AGENT_FIELDS)` as sets
— the drift this issue is about — `SCHEMA.properties.kind.enum` equals
`Model.KINDS`, every name in `SCHEMA.required` is in `SCHEMA.properties`, and
`sshKey` is in neither.

Both sides are *read*, not restated. `Model.js` is `.pragma library`, so
`tests/harness.js:6-18` already loads it with `vm.runInThisContext` and every
top-level binding lands on the namespace it exports; `Model.AGENT_FIELDS` and
`Model.KINDS` are reachable that way today, verified. The script is
`const { Model } = require("./harness.js")`, `JSON.parse` of `schema.json`, and
four `assert.deepStrictEqual`s. No network, no dependency, no JavaScript parsed
out of Nix. It lives under `tests/`, not the root, so `# check: files-list` is
unaffected, and it is a block of its own rather than a line inside
`# check: tests` because `docs-sync` (`flake.nix:232-249`) matches the
`# check: <name>` comment, and only a named block can be claimed by
`(checked: schema-fields)`.

**`# check: schema`** (`flake.nix:138-143`) keeps its name and gains structural
assertions in the same `jq -e` expression: `properties` is an object, `required`
a non-empty array, every property has a `type`, every `required` name is in
`properties`. That is what its own comment admits is missing, and it needs no
JSON-Schema validator: the file has one consumer and one shape, so asserting
*that* shape is cheaper and stronger than validating it as arbitrary JSON
Schema. Answering the intent's third open question — no validator is written or
vendored, under either resolution.

**One copy of `schema.json`.** It stays one file, read at runtime
(`MicrovmState.qml:30`, `:84`) and by the tests (`tests/model/agent.test.js:5`).
Nothing here writes a second: the new check reads that same file, and the
literal field list at `tests/model/agent.test.js:15` — today a hand-maintained
copy of the field set — becomes a comparison against `Model.AGENT_FIELDS`, so
hand-maintained copies go from one to zero. `ok(!("SCHEMA" in Model))`
(`agent.test.js:18`) keeps `Model.js` from growing an inline copy.

## Alternatives rejected

**(a) Validate the parsed reply against `schema.json` before the per-field
conversion.** At its strongest this is the better answer. It makes the sentence
in `AGENTS.md` true rather than rewritten, which is worth something when the file
is the single source every agent here reasons from: "we made the document right"
reads better in a year than "we made the document match". It puts the boundary
where the data enters, so a reply is rejected whole instead of field by field,
with the schema's own vocabulary (`shares` has 17 items, maximum 16) rather than
a bare `rejected` list. It closes the one real gap, `maxItems`. And it is the
gate that keeps holding if someone later loosens `applyAgentReply` — precisely
the failure mode the intent fears. The cost is small: the subset in use is
`type`, `enum`, `maxLength`, `minimum`, `maximum`, `maxItems`,
`additionalProperties`, `required` and one level of `items` — perhaps eighty
lines in `Model.js` with a Node test, no dependency, offline.

It is still the wrong call. The subset is the problem, not its size: a validator
handling the nine keywords `schema.json` uses today is silently wrong the first
time someone adds a tenth, and wrong permissively — an unrecognised keyword is
not enforced and nothing says so. Guarding that means a check asserting the
schema only ever uses supported keywords: the same synchronisation burden, one
level up. The better error message never reaches the user either, because
`validateForm` is what the form's error strings are wired to. And the "keeps
holding if someone loosens `applyAgentReply`" argument reverses on inspection:
the schema is the *weaker* gate, so a reply that passed it and then met a
loosened conversion would be accepted on strictly less scrutiny than today — a
second lock on the same door, with the weaker key. #26's lesson is that a claim
worth making is worth checking; (a) makes the claim true by adding a mechanism
whose own correctness is unchecked, which is the same shape one step removed.

## Risks

- **The reworded rule reads as a retreat.** The main risk of (b): a reader
  skimming the diff sees "parsed with the schema" deleted and concludes a check
  was removed. None was — no code path changes, and the gate the new wording
  names has been the only gate all along. The wording defends itself by being
  longer and more specific than what it replaces: it names `applyAgentReply`,
  `AGENT_FIELDS`, `KINDS`, `sanitize`, `validateForm` and `nixSafe`, says the
  conversion is stricter than the schema and how, and carries
  `(checked: schema-fields)`. Intent and spec are linked from the commit.
- **`maxItems: 16` is enforced nowhere.** True before this change as well. Named
  in the design rather than quietly dropped; a cap belongs in `validateForm`,
  where a user typing 17 shares hits it too. Out of scope.
- **A check that compares `schema.json` to `AGENT_FIELDS` could be fragile.**
  The two fragile shapes are parsing JavaScript from Nix (a grep over `Model.js`
  for the `AGENT_FIELDS` literal, which breaks on reformatting) and generating a
  list at build time (a second copy by another name). Neither is used: the check
  is Node reading both files with their own parsers, through the loader
  `tests/harness.js` has used for every test in this repository. If `Model.js`
  stops being loadable that way, 93 tests fail before this check does.
- **A field added to one side is now a build failure.** Intended; the cost is one
  extra edit per new agent field, and the bad fixtures below prove the failure
  is real rather than theoretical.

## Verification

- `node tests/schema-fields.js` passes on the tree as it stands.
- **Deliberately-bad fixtures, each of which must fail the new check** (#26's
  standard: a check is not trusted until it has been seen to fail):
  1. `"cpuPin": { "type": "string" }` added to `schema.json:properties` → fails,
     naming `cpuPin` as schema-only;
  2. `"reasoning"` deleted from `schema.json:properties` → fails, naming
     `reasoning` as `AGENT_FIELDS`-only;
  3. `hostname: "string"` added to `AGENT_FIELDS` (`Model.js:1532`) → fails,
     naming `hostname` as `AGENT_FIELDS`-only;
  4. `kind.enum` changed to `["disposable"]` → the `KINDS` comparison fails;
  5. `"sshKey": { "type": "string" }` added to `schema.json` → fails on both the
     set comparison and the `sshKey` assertion.
- **Extended `# check: schema`:** `"required": ["nope"]` → fails; the `type`
  dropped from `properties.cores` → fails; the file unchanged → passes.
- **`# check: docs-sync`:** the new block without `(checked: schema-fields)` in
  `AGENTS.md` → fails with `check schema-fields is not documented in AGENTS.md`;
  with both → passes.
- `node tests/run.js` → **93 passed, 0 failed** today; the rewritten
  `agent.test.js:15` assertion swaps a literal for a comparison and adds no test,
  so afterwards it is still **93 passed, 0 failed**.
- `nix flake check` passes; `nix flake check --all-systems --no-build` evaluates.
- `docs/usage.md` and `README.md` need no change: nothing user-visible moves.
