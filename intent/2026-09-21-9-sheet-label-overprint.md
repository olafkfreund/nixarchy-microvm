---
status: draft
issue: 9
author: olafkfreund
---

# Intent: the ? sheet's labels don't overlap

Closes #9.

## Problem

In the `?` shortcut sheet, the Form group's key label `tab  ↓ / shift+tab  ↑`
(`Model.js:56`) is wider than the key column and draws over its
description, "Next / previous field". Seen in the bar popup (the 456 px
card) on razer.

## Proposed outcome

Every row of the sheet is readable at the popup's width and the menu's:
labels don't overlap descriptions.

## Affected users and systems

`ShortcutSheet.qml`, or the label text in `Model.SHORTCUTS`. The docs quote
that list, so a text change reaches them too.

## Constraints

No hardcoded colours or sizes outside `Style.*`.

## Open questions

None.
