---
status: approved
issue: 8
author: olafkfreund
---

# Intent: the agent's failure message is the one shown

Closes #8.

## Problem

With an expired login, `claude -p --output-format json …` exits 1 and
reports the cause on stdout: `{"is_error": true, "result": "Failed to
authenticate: OAuth session expired and could not be refreshed", …}`. stderr
only has "Warning: no stdin data received in 3s…". The `onExited` handler
builds the message from stderr (`Model.errorText(agentReplyErr.text)`), so
even once #7 shows it, it would show the stdin warning. The call also waits
the 3 s the warning describes, because stdin is left open.

## Proposed outcome

A failed call shows claude's own `result` text when the JSON says
`is_error`, and falls back to stderr, then to "the agent failed (exit N)".
The call doesn't wait for stdin.

## Affected users and systems

`Model.js` (a parser for the failure reply, with a Node test) and
`MicrovmState.qml` (`agentProcess`: its stdin and the exit handler).

## Constraints

The reply is data. The text is sanitised and length-capped like every other
error (`Model.sanitize`). Nothing in it is executed. The argv stays
`--restricted --strict-mcp-config --tools ""`.

## Open questions

None.
