---
status: approved
issue: 22
author: olafkfreund
---

# Intent: values reach the Nix emitter without passing the allowlist

Closes #22.

## Problem

`machineSnippet` (`Model.js:852`) is safe only because of an assumption
written down at `Model.js:840-845`: "every string in it is drawn from a set
with no `" \` or `${`, so it needs no escaping". `nixString`
(`Model.js:847`) does no escaping at all, so that assumption is the whole
guarantee. Three separate paths break it, each in a different way. None is a
remote attack — all of this is the user's own machine and the user's own
environment — but each is a correctness or invariant failure, and the third
mutates shared state.

**1. `hostHome` reaches the emitter unvalidated.** `parseShares`
(`Model.js:703`) validates the raw token `~/src` with `isPath`
(`Model.js:709`), and then line 713 splices `hostHome` in through
`expandHome` (`Model.js:667`) — after validation. `hostHome` is the one
string reaching `nixString` that never passes `isPath`. Reproduced under
Node:

```
HOME=/home/${builtins.currentTime}  →  source = "/home/${builtins.currentTime}/src"   (interpolates at Nix eval time)
HOME=/home/a"; boom = "             →  emits a broken string; parseMachineSnippet → null
HOME=/home/a\b                      →  parseMachineSnippet → null
```

HOME is normally benign, so this is a broken invariant rather than an
exploit. But the comment at `Model.js:840` is not true as written, and
everything downstream rests on it.

**2. `shareTags` can emit a tag the parser cannot read.** `isPath`
(`Model.js:663`) allows `+` and sets no per-segment length bound, so a mount
point's basename can contain `+` or run past 64 characters. `shareTags`
derives the tag from that basename (`Model.js:724`), while the parser's tag
check (`Model.js:895`) is `/^[A-Za-z0-9_.-]{1,64}$/`. Reproduced: the form `shares: "~/c++:/mnt/c++"` passes
`validateForm`, `machineSnippet` emits `tag = "c++"`, and
`parseMachineSnippet` returns null. A 65-character basename does the same.

End to end, the line the plugin just wrote comes back from
`parseMachineLines` (`Model.js:282`) as `ownership: "managed-unsupported"`,
`actionsFor` drops to `["copy"]`, and `hiddenReason` tells the user "this
line was edited by hand; edit it in apps.nix" — about a line the plugin
wrote itself minutes earlier. This is the `parse(emit(f)) == f` invariant
that AGENTS.md names as a rule and that a test asserts.

**3. Plain `{}` used as a lookup map.** `Model.js:285` (`seen`) and
`Model.js:366` (`byName`). `isVmName("constructor", "permanent")`
(`Model.js:637`) returns true, so a user can simply type that name.
Reproduced in-realm:

```
rows returned: ["p1"]            ← the constructor row vanishes from the list
Object.runtime AFTER: running    ← global Object was mutated
```

In `parseMachineLines`, `seen["constructor"]` is truthy on a fresh `{}`
before anything is assigned, so the line is skipped: the write to `apps.nix`
succeeds and the row never appears. That leaves a declared permanent MicroVM
the UI denies exists — not editable, not deletable, short of a hand edit. In
`permanentRows`, the machines loop assigns `byName[row.name] = row`
(`Model.js:383`), which creates an own property and shadows the inherited
member — so the defect is confined to the case of a unit with no machine
line, which is precisely the case the reproduction above exercises
(`machines` empty, `units` carrying `constructor`). There,
`byName["constructor"]` resolves to the `Object` constructor and
`byName[name].runtime = …` assigns onto `Object` itself; `Model.js` is a
`.pragma library` singleton, so that pollution persists in the shared QML JS
engine. `toString` and `valueOf` hit the same code:
unreachable through `isVmName` (it rejects capitals), reachable from
`parseMachineLines` if such a line already sits in `apps.nix`.

Two further items in the same area, clearly below the three above:

- `isPath` permits `..` on the **host** side of a share, while the guest side
  is normalised by `normalizeGuestPath` (`Model.js:676`). So
  `~/../../etc:/mnt/etc` validates and round-trips cleanly. `shares` is an
  agent-settable field, which means a proposed share can read less alarmingly
  than the path it resolves to.
- An empty `hostHome` passes a `~/…` source through unexpanded
  (`Model.js:669`), emitting a literal `~` that is not a valid Nix path
  string and never parses back.

## Proposed outcome

The comment at `Model.js:840` is true again: whatever reaches `nixString` has
been checked, or `nixString` does not have to trust that it has. A line this
plugin wrote is always read back as `managed` and stays editable. A name a
user may legally type cannot make a row disappear or write onto a shared
global. The host side of a share means what it says. Each of the five items
above has a Node test that fails today.

## Affected users and systems

- `Model.js` only: the emitter and its validators (`isPath`, `parseShares`,
  `expandHome`, `shareTags`, `nixString`, `machineSnippet`) and the two
  lookup maps (`parseMachineLines`, `permanentRows`). No QML change is
  expected.
- Anyone whose share basename holds a `+` or is longer than 64 characters:
  their `apps.nix` line already reads as hand-edited today. Anyone running
  the shell with an unusual `HOME`, which is rare.
- `tests/run.js`, and `docs/usage.md` if any of this changes what the form
  accepts.

## Constraints

- The snippet grammar is the only Nix this repository emits, and
  `parseMachineSnippet` must keep reading everything `machineSnippet` writes.
- A line a user changed by hand stays read-only and is never rewritten.
- Every permanent-VM write goes through nixarchy.pkg's writers; applying stays
  the user's own `nixarchy-apply`.
- Logic goes in `Model.js`, with a Node test.
- **No fix may silently rewrite a line already in a user's `apps.nix`.**
  An existing line either keeps its meaning or is shown to the user.

## Open questions

1. **Lines an earlier version already wrote that no longer parse.** A user
   with a `c++` share has an unreadable line in `apps.nix` today. Migrate
   them on read, offer the user a one-time rewrite they confirm, or leave
   them alone and accept that those rows stay read-only?
2. **Tightening `isPath`.** Dropping `+`, bounding segment length, or
   rejecting `..` would reject paths some user may already have declared and
   applied. Is that acceptable, and if so which of the three? The alternative
   is to leave `isPath` alone and reconcile emitter and parser another way.
3. **`hostHome` scope.** Is `HOME` the only unvalidated string reaching the
   emitter, or should the audit cover every value the form and the agent can
   set before we call this closed?
