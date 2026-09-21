---
status: draft
issue: 9
intent: intent/2026-09-21-9-sheet-label-overprint.md
---

# Spec: the ? sheet's labels don't overlap

## Design

- **`Model.SHORTCUTS` (`Model.js:56`):** split the combined entry into two:
  `{ keys: "tab  ↓", text: "Next field" }` and
  `{ keys: "shift+tab  ↑", text: "Previous field" }`.
- **`ShortcutSheet.qml`:** the key text gets `elide: Text.ElideRight`, so a
  future long label is cut short rather than drawn over its description.
- **A guard test:** every `keys` label is at most 12 characters, which fits
  `Style.space(90)` at the caption size in the popup. The longest today are
  "shift+tab  ↑" (12) and "enter  e" (8).

The README's key table (`:96`) is a Markdown table that wraps on its own,
so it doesn't change.

## Alternatives rejected

- **Widening the key column.** That takes width from every description in
  the 456 px popup for the sake of one row.
- **Measuring text in QML.** It's more code than the label deserves.

## Risks

None. The docs don't quote this entry.

## Verification

- The Node test above.
- Live on razer: the `?` sheet in the popup and in the menu, with the Form
  group readable, checked in a still.
