---
status: approved
issue: 36
author: olafkfreund
---

# Intent: AGENTS.md names a schema boundary that nothing implements

Closes #36.

## Problem

`AGENTS.md:207-210` states, as one of the Rules that "records a real failure or
a hard constraint":

> **The agent's reply is data for the form and nothing else.** It is parsed with
> the schema, converted per field with the field's own type, validated as if typed,
> shown to the user, and confirmed by them. Nothing in it is executed, and the call
> itself runs `claude` with `--restricted --strict-mcp-config --tools ""`.

"Parsed with the schema" does not happen. `schema.json` goes *out*:
`Model.agentArgv` passes its text as `--json-schema` (`Model.js:1453`), where it
steers the model. Coming back, `Model.parseAgentReply` (`Model.js:1500`) runs
`JSON.parse` and a brace scan for prose-wrapped JSON, and `Model.applyAgentReply`
(`Model.js:1541`) converts key by key against `AGENT_FIELDS` (`Model.js:1532`).
Neither reads `schema.json`. `MicrovmState.qml:84` reads the file only to decide
whether the `i` key is offered at all (`Model.js:1388-1390`), never to check an
answer. The gap is observable: `schema.json:17` caps `shares` at 16 items, and a
reply with 17 shares is converted and lands in the form.

**Nothing is at risk today, and the intent should not pretend otherwise.** The
per-field conversion is the real boundary and it holds:

a value of the wrong type is pushed onto `rejected` and dropped, never coerced
(`Model.js:1550-1577`); a key not in `AGENT_FIELDS` is skipped by the
`hasOwnProperty` guard (`Model.js:1548`), so `sshKey` and `editing` are not
agent-settable; `kind` must be one of `KINDS`, and strings pass through
`sanitize` at the field's own length; and every value still goes through
`validateForm` as if the user had typed it before `machineSnippet` will emit it,
where #22's `nixSafe` assertion (`Model.js:1016`) refuses the line rather than
write it.

An independent security review confirmed a hostile reply cannot reach an argv or
the Nix line, and Codex confirmed there is no prototype-pollution path. The
per-field conversion is in fact *stricter* than the schema in most places.

The harm is that `AGENTS.md` describes a boundary that does not exist, and it
calls itself the single source that every agent here reasons from. Someone
trimming the per-field conversion, believing a schema validator catches the rest,
would remove the only real gate while the documentation still reads as though two
exist. Not hypothetical: #26 was a set of rules enforced more thinly than the
prose implied, and #22 included a `nixString` comment asserting a safety property
that had quietly stopped being true. This is that shape a third time.

Ranked below the main point, part of the same gap: `flake.nix:138-143`'s
`# check: schema` asserts only `additionalProperties == false` and the absence of
a `$schema` key — its own comment says so — so a malformed `properties`,
`required` or `enum` would ship to the agent unnoticed. Recorded during #26,
still open.

## Proposed outcome

The boundary `AGENTS.md` documents and the boundary the code enforces are the
same thing, and something fails if they drift apart again. Whether the code grows
to meet the document or the document is corrected to describe the code is the
spec's decision, and the most important one in this task; this intent is
satisfied either way. What must not survive is the present state, where the two
disagree and nothing notices.

## Affected users and systems

`AGENTS.md` (the rule text), `Model.js` (`agentArgv`, `parseAgentReply`,
`applyAgentReply`, `AGENT_FIELDS`), `schema.json`, `tests/model/agent.test.js`,
and `flake.nix`'s `# check: schema`.

No change to what the plugin does for a user: AI assist behaves the same either
way. The readers affected are the owner and every AI agent that treats
`AGENTS.md` as the single source.

## Constraints

- The agent's reply stays data for the form and nothing else. Whatever is chosen,
  nothing in a reply is ever executed.
- The call keeps `--restricted --strict-mcp-config --tools ""`, and only `claude`
  is ever invoked.
- `schema.json` has one copy, read at runtime and by the tests
  (`tests/model/agent.test.js:5`). That must stay true; a second hand-maintained
  copy of the field set is exactly the drift this issue is about.
- Whatever is chosen has to be checkable: an unenforced claim is the subject of
  this issue, so resolving it with another unenforced claim resolves nothing.
- Any new check runs inside `nix flake check`, on a GitHub runner with no
  network, and logic goes in `Model.js` with a Node test per the existing rule.

## Open questions

1. **Which resolution does the owner want?** Either (a) validate the parsed reply
   against `schema.json` before the per-field conversion, so the documented
   boundary becomes real, at the cost of a small JSON-Schema subset validator in
   `Model.js` and its tests; or (b) correct `AGENTS.md` to say that `schema.json`
   steers the model and the per-field conversion is the boundary, and make the
   flake check assert that the schema's properties and `AGENT_FIELDS` agree, so
   they cannot drift. Honestly noted, not as a recommendation: the per-field
   conversion is already stricter than the schema, so (a) adds a second gate that
   must be kept in step with the first.
2. **If (b), how much should the check hold?** Field-set agreement with
   `AGENT_FIELDS` is the minimum; whether it also asserts the per-field ranges
   are consistent with `validateForm`'s is a separate call.
3. **Does `# check: schema` gain real JSON-Schema validation either way?** It
   runs with no network, so a validator would have to be written or vendored —
   the same cost under both resolutions.
