---
status: draft
issue: 7
intent: intent/2026-09-21-7-agent-error-shown.md
---

# Spec: a failed agent call says why

## Design

- **`CreateForm.qml:80`, `:87`:** drop `root.agentError = ""` from `start()`
  and `startEdit()`, so the binding from `MicrovmView.qml:350` survives.
  `agentError` stays a plain input property, never assigned inside the form.
- **`MicrovmView.openForm` and `openEdit`:** clear the shared state instead,
  with `MicrovmState.agentError = ""`, next to `createForm.start(…)`.
  `askAgent` already clears it when a call starts (`MicrovmState.qml:332`).
- **The cancelled path:** `cancelAgent()` sets "cancelled" and `onExited`
  returns early, leaving it set. It shows as the reason, which is the
  intended behaviour.

**Shipping with #8:** implemented on this branch. #8's artifacts and code
land here too, as one PR that closes both.

## Alternatives rejected

- **`Binding` elements, or re-binding with `Qt.binding` in `start()`.** They
  keep the anti-pattern (the form writing its own input) alive.

## Risks

Only for code that relied on the form clearing the error locally. There is
none: grep shows the view is the only writer outside the state.

## Verification

- QML, so no Node test. The grep `agentError =` in `CreateForm.qml` must
  come back empty.
- Live on razer: `i`, a sentence, Enter, then Esc while it's thinking. The
  field shows "cancelled" in the urgent colour. Close and reopen the form,
  and it's cleared. Then an expired login (verified with #8) shows its
  message.
