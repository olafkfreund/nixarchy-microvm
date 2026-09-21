---
status: approved
issue: 8
intent: intent/2026-09-21-8-agent-error-text.md
---

# Spec: the agent's failure message is the one shown

## Design

- **`Model.agentFailure(stdout, stderr, code)`**: returns `""` when the call
  succeeded with a usable reply, and otherwise a sanitised line of at most
  160 characters (`Model.sanitize`):
  1. stdout parses as the `claude -p` JSON envelope, `is_error === true`,
     and `result` is a string: return `result`;
  2. otherwise `Model.errorText(stderr)`, minus claude's stdin warning line
     ("no stdin data received");
  3. otherwise "the agent failed (exit N)", or, on exit 0, "the agent gave
     no usable answer".
- **`MicrovmState.agentProcess.onExited`:** `reply` is
  `parseAgentReply(out)` only when `code === 0` and the envelope's
  `is_error` isn't true. Otherwise `agentError = Model.agentFailure(…)`.
  An `is_error` reply with exit 0 counts as a failure too.
- **stdin:** before changing anything, I check on razer whether a Quickshell
  `Process` leaves claude's stdin open (the 3 s warning in stderr). If it
  does, set `stdinEnabled: false` or equivalent and confirm the warning is
  gone. If it's already closed, change nothing and say so in the plan.

The text is data. It's shown and never executed.

**Shipping with #7:** implemented on `fix/7-agent-error-shown`, in the same
PR.

## Alternatives rejected

- **Reusing `errorText` on stdout.** It picks the first line of a single
  JSON line, which is the whole envelope.

## Risks

A future claude version changing the envelope. Step 2 still falls back to
stderr, then to the exit code, so the worst case is a generic message.

## Verification

- Node tests in `tests/model/agent.test.js`, all using real envelopes from
  razer: the expired-login envelope gives its `result`; stderr with only
  the stdin warning gives "the agent failed (exit 1)"; exit 0 with a valid
  proposal gives `""`; exit 0 with `is_error` gives its `result`; a
  300-character result is capped.
- Live on razer: the stdin check described in Design. The failure text
  itself is covered by the Node test on the real envelope captured there.

## Open question

None. The owner approved this spec on 2026-09-21 without asking for the live
logout run, so the check is the Node test on the envelope captured on razer.
