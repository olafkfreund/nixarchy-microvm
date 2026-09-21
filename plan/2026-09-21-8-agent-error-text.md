---
status: approved
issue: 8
spec: spec/2026-09-21-8-agent-error-text.md
---

# Plan: the agent's failure message is the one shown

Carried out on `fix/7-agent-error-shown` (step 2 of that plan), in the same
PR.

Approved decisions: `Model.agentFailure(stdout, stderr, code)` returns `""`
for success with a usable reply. Otherwise it returns, sanitised to 160
characters: the envelope's `result` when `is_error`; else `errorText` of
stderr without claude's "no stdin data received" line; else "the agent
failed (exit N)", or "the agent gave no usable answer" on exit 0. In
`onExited`, the reply is parsed only when `code === 0` and not `is_error`.
The stdin handling changes only if razer shows the 3 s wait inside
Quickshell. The live logout run isn't done; the Node test on the captured
envelope is the check.

## Steps

1. `tests/model/agent.test.js`, using the real envelopes captured on razer
   2026-09-21:
   - the expired-login envelope with exit 1 gives "Failed to authenticate:
     OAuth session expired and could not be refreshed";
   - an empty stdout plus the stdin warning on stderr, exit 1, gives "the
     agent failed (exit 1)";
   - exit 0 with a valid `structured_output` gives `""`;
   - exit 0 with `is_error: true` gives its `result`;
   - a 300-character `result` is capped at 160.

   → Verify that the tests fail.
2. `Model.js`: add `agentFailure` next to `parseAgentReply`. → Verify that
   the tests pass.
3. `MicrovmState.qml:537–548` `onExited`: compute
   `failure = Model.agentFailure(out, err, code)`; if non-empty, set
   `agentError = failure` and return; otherwise
   `agentForm = parseAgentReply(out)`. → Verify with `qs log` clean on
   razer.
4. stdin check on razer: time a successful assist call from Enter until the
   form fills, and read the Process's stderr (temporarily logged). If the
   "no stdin data" warning appears, set `stdinEnabled: false` or pass
   `< /dev/null` equivalently, and re-time. Otherwise leave it, and record
   "not needed" in this plan in the same commit. → Verify with before and
   after timings in the commit message.

## Tests

`node tests/run.js` · step 4's timings.

## Rollback

It's reverted together with #7's PR.
