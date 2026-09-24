---
status: approved
issue: 35
spec: spec/2026-09-24-35-model-hardening.md
---

# Plan: one linear brace scan, a complete sanitize, one name rule

Three pure functions in `Model.js` are brought up to the contract they state.
Everything below is decided; nothing here is left to the implementer's taste.

**#35 — `parseAgentReply` scans once.** The cost is the nested loop at
`Model.js:1503-1510`, one `JSON.parse` over an O(n) substring per `(start, end)`
pair, on the UI thread from a `.pragma library`. A new pure `braceSpans(text)`
does one string-aware left-to-right pass: a stack of open-brace positions and
two bits of state (inside a string, after a backslash), `}` at depth ≥ 1 pops
and records `[start, end]` with `end` past the closing brace, unmatched `{` are
dropped at the end. `parseAgentReply` sorts the spans **start ascending, then
end descending** — the order the double loop tried them in, so the same span
wins, leftmost and outermost — and tries at most `MAX_CANDIDATES = 64` of them
with `parseObject`. **No size cap is added and no reply is ever refused for its
size:** with the pass linear there is nothing left for a cap to protect, and a
cap would add a number, a refusal path and a message for no case the bound
misses. `agentFailure` (`Model.js:1524`) is unchanged: it calls
`parseAgentReply` on its exit-0 branch, so a reply that yields nothing still
gives `"the agent gave no usable answer"`, and a real failure still gives the
agent's own `is_error` result or `errorText(stderr)`.

**#37 — `sanitize` filters what reorders text.** Four ranges join the `continue`
at `Model.js:102`, all BMP so `charCodeAt` suffices: **U+202A–U+202E** (bidi
embeddings and overrides), **U+2066–U+2069** (isolates), **U+2028** and
**U+2029**. Stripped, not marked, exactly as the loop already drops C0, C1 and
DEL: a marker for four ranges and not the other thirty would be a rule nobody
can hold, and on the form path (`applyAgentReply`, `Model.js:1556`) it would
turn a droppable code point into a validation error over a character the user
never typed. **U+200E and U+200F are deliberately kept** — marks, not overrides,
they cannot reorder a run, and they appear in real text.

**#38 — one name rule for the `apps.nix` path.** A new `isNixAttrName(value)`,
`/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/`, sits beside `isReportedName`
(`Model.js:154-160`) as the floor for every writer that touches `apps.nix`.
`optReplaceArgv` (`Model.js:1269`) and `optRemoveArgv` (`Model.js:1273`) swap
`isReportedName` for it. `optSetArgv` (`Model.js:1265`) keeps
`isVmName(name, "permanent")`: that is the creation rule, strictly inside
`isNixAttrName`, and a redundant conjunct is a line every later reader must
prove redundant — a test pins the containment instead. `isReportedName` itself
is **not** tightened: it answers what `nixarchy-vm` and systemd may hand back,
where a leading digit is legal, and tightening it would stop a disposable VM
named `9x` being listed at all. `parsePending` (`Model.js:330`) keeps
`isReportedName`: it sets a display flag and writes nothing.

`a_b` must be **accepted** and `9x` **rejected**. The issue text had this
backwards; a predicate built from it would orphan valid machines.

**The orphan case.** `parseMachineLines` (`Model.js:293`) matches a marker name
with `[A-Za-z0-9_-]+`, so `9x` is listed today and `optRemoveArgv("9x")` returns
an argv today. Tightening alone would leave the row listable and silently
unremovable. So a row whose name fails `isNixAttrName` gets
`ownership: "managed-unsupported"` — the state the parser already has for a line
this plugin will not rewrite. Nothing new is drawn: `subtitleText`
(`Model.js:467`) already says *apps.nix, edited by hand*, `actionsFor` already
drops `edit` and `remove` for that ownership, and `hiddenReason`
(`Model.js:1409`) already answers why.

## Steps

One commit per step. Pure functions land with their tests in the same commit,
as this repo does; the tree passes `node tests/run.js` at every commit.

1. **`Model.js`: add `braceSpans` and rewrite the `parseAgentReply` fallback
   (#35).** Add above `parseObject` (`Model.js:1488`):

   ```js
   // Every balanced {…} in the text, as [start, end] with end past the closing
   // brace. String-aware: a brace inside a JSON string is text, not depth, or
   // `{"a":"}"}` comes back truncated. Unmatched `{` are dropped.
   function braceSpans(text) {
     var s = String(text), stack = [], out = [], inString = false, escaped = false
     for (var i = 0; i < s.length; i++) {
       var c = s.charAt(i)
       if (escaped) { escaped = false; continue }
       if (c === "\\") { if (inString) escaped = true; continue }
       if (c === "\"") { inString = !inString; continue }
       if (inString) continue
       if (c === "{") stack.push(i)
       else if (c === "}" && stack.length) out.push([stack.pop(), i + 1])
     }
     return out
   }

   var MAX_CANDIDATES = 64
   ```

   Replace the two loops at `Model.js:1503-1510` with:

   ```js
       var spans = braceSpans(text)
       spans.sort(function(a, b) { return a[0] - b[0] || b[1] - a[1] })
       var tried = spans.length < MAX_CANDIDATES ? spans.length : MAX_CANDIDATES
       for (var i = 0; i < tried; i++) {
         var candidate = parseObject(text.substring(spans[i][0], spans[i][1]))
         if (candidate && ("kind" in candidate || "name" in candidate)) return candidate
       }
       return null
   ```

   Replace the comment at `Model.js:1501-1502` ("Tiny input, so the quadratic
   scan costs nothing") with one that names the ceiling in the repo's
   `ponytail:` idiom: this runs on the UI thread from a `.pragma library`, the
   reply is untrusted data, the pass is linear and string-aware, spans are tried
   outermost-first, and `MAX_CANDIDATES` is the ceiling on the parsing.
   Add the first four tests below in `tests/model/agent.test.js`.
   → verify by `node tests/run.js` (97 passed, 0 failed).

2. **`Model.js`: `sanitize` drops the code points that reorder text (#37).**
   Extend the condition at `Model.js:102` to:

   ```js
       if (code < 0x20 || code === 0x7F || (code >= 0x80 && code <= 0x9F) ||
           (code >= 0x202A && code <= 0x202E) || (code >= 0x2066 && code <= 0x2069) ||
           code === 0x2028 || code === 0x2029) continue
   ```

   One added comment line says U+200E and U+200F are kept on purpose. Add the
   `sanitize` test below in `tests/model/parsing.test.js`.
   → verify by `node tests/run.js` (98 passed, 0 failed).

3. **`Model.js`: `isNixAttrName`, used by both `apps.nix` writers (#38).** Add
   after `isReportedName` (`Model.js:160`):

   ```js
   // A name that may stand as an unquoted Nix attribute: the floor for every
   // writer that touches apps.nix. Laxer than isVmName, the rule for what this
   // plugin will *create*; stricter than isReportedName, what the CLI and
   // systemd may hand back. `'` is legal in Nix and left out on purpose.
   function isNixAttrName(value) {
     return /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(String(value === undefined || value === null ? "" : value))
   }
   ```

   Swap `isReportedName` for `isNixAttrName` in `optReplaceArgv`
   (`Model.js:1269`) and `optRemoveArgv` (`Model.js:1273`). Touch nothing else:
   `optSetArgv`, `copyArgv` and `parsePending` keep the predicates they have.
   Add the name-rule test below in `tests/model/commands.test.js`.
   → verify by `node tests/run.js` (99 passed, 0 failed).

4. **`Model.js`: a name we cannot write is listed, not editable (#38).** In
   `parseMachineLines` (`Model.js:307`) change

   ```js
       ownership: fields ? "managed" : "managed-unsupported",
   ```
   to
   ```js
       ownership: fields && isNixAttrName(name) ? "managed" : "managed-unsupported",
   ```

   `fields` stays as parsed, so the row still shows its template. Extend the
   comment above the function (`Model.js:287-289`) with one sentence: a marker
   name that is not a valid unquoted Nix attribute is shown the same way.
   Add the orphan test below in `tests/model/rows.test.js`.
   → verify by `node tests/run.js` (100 passed, 0 failed).

**No docs step.** Nothing user-visible changes: no key, message or subtitle
moves. `sanitize` removes code points that were never meant to be drawn, and the
orphan row lands in the state `docs/usage.md:313` and `README.md:44` already
describe, reachable only from an `apps.nix` line that is not valid Nix.

## Tests

Seven cases, named exactly:

- `"the brace scan is linear: the inputs from #35 in well under a second"`
  (`agent.test.js`) — `"x" + "{".repeat(n) + "}".repeat(n)` for n = 500, 1000,
  2000 (1 000 / 2 000 / 4 000 bytes; 1 489 / 6 169 / 25 130 ms today). Each
  returns `null`; each timed with `process.hrtime.bigint()` and asserted under
  **100 ms**.
- `"braceSpans is string-aware and drops unmatched braces"` (`agent.test.js`) —
  `{"a":"}"}` and `{"a":"\\""}` give one span each and parse under
  `parseAgentReply` when given a `name`; `"{{{"` gives none;
  `'{"kind":"x"} {"name":"y"}'` gives two spans and parses to `{kind:"x"}`;
  an unbalanced prefix `'{{{' + JSON.stringify(reply)` and suffix
  `JSON.stringify(reply) + '}}}'` both still yield `reply`.
- `"a prose-wrapped reply still parses, and the outermost span still wins"`
  (`agent.test.js`) — the existing `"Sure! Here you go:\n" + JSON.stringify(reply)
  + "\nHope that helps."` case returns the same object it does today; a 4 KB
  reply with the real proposal wrapped in prose returns it too;
  `{"kind":"permanent","x":{"kind":"disposable"}}` returns the outer object.
- `"agentFailure still tells a refused reply apart from a failed agent"`
  (`agent.test.js`) — exit 0 with unparseable output gives `"the agent gave no
  usable answer"`; the recorded expired-login envelope still gives its own text.
- `"sanitize drops the code points that reorder text"` (`parsing.test.js`) — one
  assertion per code point: U+202A, U+202B, U+202C, U+202D, U+202E, U+2066,
  U+2067, U+2068, U+2069, U+2028, U+2029 each vanish from
  `sanitize("a" + c + "b", 64) === "ab"`; `errorText("error: rm ‮gnp.txt")`
  reads as typed; `sanitize("a‎b", 64) === "a‎b"` and the same for
  U+200F.
- `"one name rule on the apps.nix path"` (`commands.test.js`) —
  `isNixAttrName` accepts `a_b`, `_x`, `a-b` and `"a".repeat(64)`, rejects `9x`,
  `-x`, `a'b`, `""` and `"a".repeat(65)`; `optReplaceArgv(PKG, "9x", SNIPPET)`
  and `optRemoveArgv("9x")` are `null` while `a_b` gives an argv;
  every name in a list `isVmName(n, "permanent")` accepts also passes
  `isNixAttrName` (containment).
- `"a machine name we cannot write is listed, not editable"` (`rows.test.js`) —
  an `apps.nix` line for `9x` whose value is full grammar parses to a row with
  `ownership: "managed-unsupported"`, and `Model.actionsFor(row, ALL)` offers
  neither `edit` nor `remove`.

Existing `parseAgentReply` assertions (`agent.test.js:50-59`) and the
hostile-reply test (`agent.test.js:76-84`) stay unchanged; they are the pin that
the rescan did not change which candidate wins.

`node tests/run.js` is **93 passing on main today** (measured, not assumed) and
**100** after these seven — seven new `test(...)` calls, none removed, and the
harness counts one pass per call.

Then `nix flake check`.

**No live desktop is needed for any part of this task.** Every change is in
`Model.js`, every case is Node, and no QML file is touched — so `node
tests/run.js` plus `nix flake check` is the whole verification.

## Rollback

Each step is one commit touching `Model.js` and one test file; `git revert` of
any one of them restores the previous behaviour with no other change. No state
is left behind: nothing here writes a file, spawns a process, or changes
anything on disk outside the repository. Reverting step 3 without step 4 is
safe (the orphan row simply stops being forced to `managed-unsupported` again);
reverting step 4 alone leaves `9x` listable and its `remove` refused by
`isNixAttrName` — so revert 4 and 3 together, in that order.
