---
status: approved
issue: 7
author: olafkfreund
---

# Intent: a failed agent call says why

Closes #7.

## Problem

When AI assist fails (expired login, timeout, no usable answer), "asking
claude…" disappears and nothing replaces it. On razer, an expired OAuth
session looked exactly like silence. `MicrovmView.qml:350` binds
`agentError: MicrovmState.agentError` into the form, but
`CreateForm.start()` and `startEdit()` (`CreateForm.qml:80`, `:87`) assign
`root.agentError = ""`. That assignment breaks the binding, so after the
first form open no error reaches the screen.

## Proposed outcome

Every failure of the agent call shows a one-line reason under the describe
field, in the urgent colour: cancelled, timed out, no usable answer, or the
agent's own message (#8). Opening the form clears the previous error without
breaking later ones.

## Affected users and systems

`CreateForm.qml` and `MicrovmView.qml`. Everyone using AI assist.

## Constraints

QML stays drawing and wiring. No new state outside `MicrovmState`.

## Open questions

None. Pairs with #8: this makes the error visible, and #8 makes its text
right. They can land as one PR if you approve both.
