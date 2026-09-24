---
status: draft
issue: 35
author: olafkfreund
---

# Intent: three Model.js functions promise more than they do

Closes #35, #37 and #38.

## Problem

Three pure functions in `Model.js` state a contract they do not keep. A
comment says a scan is cheap when it is not; a function called `sanitize`
sanitises half of what its name claims; three writers to one file imply one
rule about names and then apply two. Only the first costs a user anything
today, and the three are not equally serious. They are one task because they
are the same kind of defect in the same file, and because the fix for each is
a Node test that pins the contract to the behaviour.

**1. `parseAgentReply` freezes the UI for twenty-five seconds (#35).** When
the reply is not itself JSON, `parseAgentReply` (`Model.js:1500`) falls back
to a nested pair of loops looking for the outermost `{…}` that parses. The
inner loop calls `parseObject` (`Model.js:1488`), which is `JSON.parse` over
an O(n) substring, so the scan is worse than the quadratic the comment above
it claims — and the input is neither tiny nor trusted. Measured on merged
`main`, Node v26.8.1, with `"x" + "{".repeat(n) + "}".repeat(n)`:

| reply size | time |
| --- | --- |
| 1 000 bytes | 1 489 ms |
| 2 000 bytes | 6 169 ms |
| 4 000 bytes | **25 130 ms** |

`Model.js` is a `.pragma library` called straight from QML, so this runs on
the UI thread: a 4 KB reply freezes the popup and the menu for twenty-five
seconds, with no way for the user to cancel. There is no length cap before
the scan. `agentFailure` (`Model.js:1524`) reaches the same path on its
success branch. It takes no attacker — a model that wraps its JSON in enough
prose, or emits unbalanced braces, is enough. `tests/model/agent.test.js`
feeds it only short strings, which is why it has never shown up.

**2. `sanitize` lets shown text lie (#37).** `sanitize` (`Model.js:98`)
strips C0, C1 and DEL and nothing else. Unicode's bidirectional overrides and
line separators pass through, so `errorText("error: rm ‮gnp.txt")` renders as
`rm ‮gnp.txt` — the text is `gnp.txt`, the screen reads `txt.png`. U+2028
survives too. Reachable from anything external the UI echoes: `nixarchy vm`
and `systemctl` output through `errorText` (`Model.js:667`), template labels
and notes, `reasoning` from the agent's reply, a stray line in `apps.nix`.

This is display integrity only. Nothing here reaches a command or the Nix
line: those are guarded by allowlists that exclude these code points
(`isVmName`, `isPath`, `isTemplateName`), and #22 closed the one gap where an
unvalidated value reached the emitter. The worst case is a user misreading an
error or a template note. On a single-user desktop plugin that is polish.
What makes it worth fixing is that `sanitize` exists to make external text
safe to show, and it currently does half that job while looking like it does
all of it.

**3. Three `apps.nix` writers, two name predicates (#38).** `optSetArgv`
(`Model.js:1265`) gates on `isVmName(name, "permanent")`,
`/^[a-z][a-z0-9-]{0,31}$/`. `optReplaceArgv` (`Model.js:1269`) and
`optRemoveArgv` (`Model.js:1273`) gate on `isReportedName`
(`Model.js:159`), `/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/`, which accepts a
leading digit and an underscore — neither of which is a valid unquoted Nix
attribute. So `optRemoveArgv("9x")` returns an argv naming
`programs.nixarchy.services.microvm.machines.9x` while `optSetArgv` refuses
the same name.

Not reachable today. Replace and remove act on names the plugin read back out
of `apps.nix`, so for one to be malformed the file would already have to
contain a line that is not valid Nix. `isReportedName` is the right *class*
of predicate for those two: they legitimately accept names this plugin did
not create, which is why they are laxer than `isVmName`, itself a rule about
what this plugin will *make*. The defect is that three writers to one file
disagree, and the next person adding a fourth has two predicates to choose
between with nothing saying which.

## Proposed outcome

A reply of any size the agent can return leaves both surfaces responsive; a
reply that cannot be read as a proposal is reported as such, promptly. Text
the UI echoes from an external source reads as what it is, whichever code
points it contains. Anything named on the `apps.nix` path is accepted or
refused by the same rule, and that rule is written down where the next writer
will see it. Each of the three has a Node test that fails today, including
the size that currently takes 25 s.

## Affected users and systems

- `Model.js` only: `parseAgentReply`, `parseObject`, `agentFailure`,
  `sanitize`, and the three `opt*Argv` builders with the predicates they use.
  No QML change is expected.
- Anyone who has ever had the agent return prose around its JSON: they have
  already sat through this freeze without knowing what it was.
- Everything `errorText` and the template list show, which is every user.
- `tests/run.js`; `docs/usage.md` only if the agent's failure message changes
  what the user is told.

## Constraints

- Logic goes in `Model.js` with a Node test; QML stays drawing and wiring.
- `sanitize` and the argv builders sit on the path that guards the only Nix
  this repository emits. A change may tighten but must not loosen anything
  #22 tightened.
- The agent's reply stays data for the form and nothing else: parsed,
  converted per field, validated as if typed, shown, and confirmed.
- A name already declared in a user's `apps.nix` must keep working or be
  shown to the user; no write is silently refused without saying so.

## Open questions

1. **Refuse or truncate an oversized reply.** A cap can reject the reply
   outright or scan a prefix of it. Truncating may find a proposal in a reply
   that would otherwise be lost; refusing is honest about what happened.
   Either way, what does the user see, and can they tell it apart from the
   agent simply failing?
2. **Whether tightening the shared name predicate could orphan a machine.**
   If the rule the three writers share rejects something `isReportedName`
   accepts today, a machine already declared in someone's `apps.nix` under
   such a name becomes one the plugin can list but not remove. Is that
   acceptable, or does the row need a way out?
