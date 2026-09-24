---
status: approved
issue: 35
intent: intent/2026-09-24-35-model-hardening.md
---

# Spec: one linear brace scan, a complete sanitize, one name rule

## Design

### 1. `parseAgentReply` scans once, left to right (#35)

The cost is not the reply's size, it is the shape of the double loop at
`Model.js:1503-1510`: one `JSON.parse` over an O(n) substring for every
`(start, end)` pair. A cap does not change that shape, so **no cap is added and
no reply is refused for its size**. The intent's first open question resolves to
neither refuse nor truncate: with the scan linear, a 4 KB reply is read whole,
in under a millisecond, and its size stops being something the user can notice.

Two functions replace the loops.

```js
// Every balanced {…} in the text, as [start, end] with end past the closing
// brace, in the order they close. String-aware: a brace inside a JSON string
// is text, not depth, or `{"a":"}"}` comes back truncated.
function braceSpans(text)        // -> array of [start, end]

var MAX_CANDIDATES = 64          // JSON.parse calls the fallback will make
```

`braceSpans` is one pass over the characters with a stack of open-brace
positions and two bits of state (inside a string, after a backslash). A `}` at
depth ≥ 1 pops and records a span; unmatched `{` are dropped at the end, so an
unbalanced prefix or suffix costs nothing — which is exactly the
`"{".repeat(n)` input from #35.

`parseAgentReply(raw)` keeps its signature and its return type (the proposal
object, or `null`). Its fallback branch collects `braceSpans(text)`, sorts by
`start` ascending then `end` descending, and tries at most `MAX_CANDIDATES` of
them with `parseObject`, returning the first object with `"kind"` or `"name"` in
it. That sort is the order the double loop tried them in, so on any input where
today's code finds a proposal within the budget it is the same span that wins:
leftmost, outermost.

Worst case: one O(n) pass, an O(s log s) sort of at most n/2 positions, and 64
parses of at most n bytes. For the 4 KB input in #35 that is ~256 KB of
`JSON.parse` where today it is gigabytes, and the answer is the same `null`.

The comment at `Model.js:1501` must stop calling the scan free. It says instead:
this runs on the UI thread from a `.pragma library`, the reply is untrusted
data, the pass is linear and string-aware, spans are tried outermost-first, and
`MAX_CANDIDATES` is the ceiling on the parsing — naming the ceiling, in the
repo's `ponytail:` idiom.

`agentFailure` (`Model.js:1524`) is unchanged and stays coherent by
construction: it calls `parseAgentReply` on its exit-0 branch, so a reply that
yields nothing still gives `"the agent gave no usable answer"`, while a real
failure still gives the agent's own `is_error` result or `errorText(stderr)`.
Those are already two distinguishable messages in `CreateForm.qml:473`. Budget
exhaustion gets no third message: from the user's side it *is* "no usable
answer", and a second return channel would change the signature and every
caller for one sentence.

### 2. `sanitize` filters the code points that reorder text (#37)

`sanitize` (`Model.js:98-108`) already walks the string code unit by code unit.
Four ranges join the `continue` condition, all BMP, so `charCodeAt` suffices:
**U+202A-U+202E**, the bidi embeddings and overrides (U+202E reverses everything
after it — the `gnp.txt` / `txt.png` case in #37); **U+2066-U+2069**, the
isolates, which do the same job with a scope; and **U+2028, U+2029**, LINE and
PARAGRAPH SEPARATOR, a line break the C0 filter misses in text the UI draws on
one line.

**Stripped, not marked.** The loop already drops C0, C1 and DEL silently; a
visible marker for four ranges and not for the other thirty-odd is a rule nobody
can hold. It would also do harm on the form path: `applyAgentReply` puts the
agent's `name` and `template` through `sanitize` before `validateForm`
(`Model.js:1556`), and a marker there turns a droppable code point into a name
that fails validation over a character the user never typed.

Nothing legitimate loses anything. Every call site (`Model.js:219, 245, 253,
258, 678, 1526, 1554, 1556, 1574, 1601, 1673`) carries `nixarchy-vm`,
`systemctl` or `nixarchy-pkg` output, a template label or note, an `ssh-*.pub`
comment, or English prose from the agent; none has a reason to hold a bidi
control, and a path that did would already be refused by `isPath`. U+200E and
U+200F (LRM/RLM) are kept deliberately: they are marks, not overrides, cannot
reorder a run, and are the one part of this family that appears in real text.

### 3. One name rule for the `apps.nix` path (#38)

```js
// A name that may stand as an unquoted Nix attribute: the floor for every
// writer that touches apps.nix. Laxer than isVmName, which is the rule for
// what this plugin will *create*; stricter than isReportedName, which is what
// the CLI and systemd may hand back.
function isNixAttrName(value) {
  return /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(String(value === undefined || value === null ? "" : value))
}
```

It sits beside `isReportedName` (`Model.js:154-160`), and its comment names it
as the one a fourth writer uses. It rejects the leading digit and leading `-`
that `isReportedName` accepts, and accepts `_` anywhere, first included, because
Nix does (`_module`). `'` is legal in a Nix identifier and left out:
`parseMachineLines` (`Model.js:299`) can never surface a name holding one, and a
quote in an emitted attribute path is a footgun for no gain.

`optReplaceArgv` (`Model.js:1269`) and `optRemoveArgv` (`Model.js:1273`) swap
`isReportedName` for `isNixAttrName`. `optSetArgv` (`Model.js:1265`) keeps
`isVmName(name, "permanent")`: that is the creation rule, it is strictly inside
`isNixAttrName`, and a redundant conjunct is a line every later reader must
prove redundant. A test pins the containment instead, which is where that claim
belongs.

**The orphan case** — the intent's second open question. `parseMachineLines`
matches a marker name with `[A-Za-z0-9_-]+`, so `9x` is listed today and
`optRemoveArgv("9x")` returns an argv today. Tightening alone would leave that
row listable and silently unremovable, which the intent's constraints forbid. So
`parseMachineLines` gives a row whose name fails `isNixAttrName`
`ownership: "managed-unsupported"` — the state it already has for a line this
plugin will not rewrite. The row stays visible with the subtitle `apps.nix,
edited by hand` (`Model.js:467`), `edit` and `remove` are absent rather than
broken, and `hiddenReason` (`Model.js:1412`) already answers why. Nothing new is
drawn. `parsePending` (`Model.js:330`) keeps `isReportedName`: it sets a display
flag, writes nothing, and a pending change for a name we will not write is still
worth showing.

## Alternatives rejected

- **A length cap before the scan (#35).** The cheapest diff and not enough
  alone: the cost is the nested loop, so any cap still admits a pathological
  input just under it. A 2 KB cap leaves the 6 s case; a 1 KB cap leaves 1.5 s on
  the UI thread and starts refusing replies a talkative model legitimately
  returns. With the pass linear there is nothing left for a cap to protect.
- **A cap plus a bound on candidate spans (#35).** The bound is the half that
  works, and it is `MAX_CANDIDATES`. The cap adds a second number, a refusal
  path and a message to explain it, for no case the bound misses.
- **Replacing the filtered code points with U+FFFD (#37).** Tells the user
  something was removed, at the price of an inconsistent rule and a validation
  error naming a character they never typed.
- **Tightening `isReportedName` itself (#38).** One rule in one place, and the
  wrong place: it answers "what may come back from `nixarchy-vm` or systemd",
  where a leading digit is legal (`nixarchy-vm` accepts `[A-Za-z0-9_-]+`).
  Tightening it would stop a disposable VM named `9x` being listed, started or
  deleted at all — breaking a working VM to tidy a predicate two writers share.
  A third predicate is the cost, and three one-line comments saying which
  question each answers is the cheapest thing that stops the next writer
  guessing.

## Risks

- **A reply that parses today stops parsing.** The rescan changes which
  candidate wins if the sort order is wrong, and string-awareness is load
  bearing: without it `{"a":"}"}` comes back truncated. Pinned by keeping every
  existing `parseAgentReply` assertion (`tests/model/agent.test.js:50-59`)
  unchanged and adding the brace-in-string, escaped-quote and nested-`kind`
  cases below.
- **`sanitize` guards the only Nix this repo emits**, so it must not loosen what
  #22 tightened. It does not: the allowlists after it (`isVmName`, `isPath`,
  `isTemplateName`) are untouched, so nothing new reaches `machineSnippet`. One
  behaviour shifts — `applyAgentReply` turns `a‮b` into `ab`, which then
  validates, where today it is rejected. That is what the C0 filter has always
  done with `a\x01b`, and the value still passes the emitter's own allowlist.
  Pinned by the hostile-reply test (`tests/model/agent.test.js:76-84`).
- **An orphaned machine.** A name outside `isNixAttrName` already in someone's
  `apps.nix` loses `remove`. Such a line is not valid Nix, so it never built;
  the row is still listed, the subtitle and `hiddenReason` say why, and the fix
  is in `apps.nix`, which is where the line came from.

## Verification

Node cases, in `tests/model/agent.test.js` and `tests/model/parsing.test.js`:

- `"the brace scan is linear: the inputs from #35 in well under a second"` —
  `"x" + "{".repeat(n) + "}".repeat(n)` for n = 500, 1000, 2000 (1 000, 2 000 and
  4 000 bytes; today 1 489 / 6 169 / 25 130 ms). Each returns `null`, each
  asserted under **100 ms** by `process.hrtime.bigint()`.
- `"braceSpans is string-aware and drops unmatched braces"` — `{"a":"}"}` and
  `{"a":"\\""}` give one span each and parse; `"{{{"` gives none;
  `'{"kind":"x"} {"name":"y"}'` gives two.
- `"a prose-wrapped reply still parses, and the outermost span still wins"` — the
  existing `"Sure! Here you go:\n" + JSON.stringify(reply) + "\nHope that
  helps."` case, a 4 KB reply with the real proposal wrapped in prose, and
  `{"kind":"permanent","x":{"kind":"disposable"}}` returning the outer object.
- `"agentFailure still tells a refused reply apart from a failed agent"` — exit 0
  with unparseable output gives `"the agent gave no usable answer"`; the recorded
  expired-login envelope still gives its own text.
- `"sanitize drops the code points that reorder text"` — one assertion per code
  point: U+202A, U+202B, U+202C, U+202D, U+202E, U+2066, U+2067, U+2068, U+2069,
  U+2028 and U+2029 each vanish from `sanitize("a" + c + "b", 64) === "ab"`; plus
  `errorText("error: rm ‮gnp.txt")` reading as typed, and U+200E and U+200F
  surviving.
- `"one name rule on the apps.nix path"` — `isNixAttrName` accepts `a_b`, `_x`,
  `a-b` and 64 characters, rejects `9x`, `-x`, `a'b`, `""` and 65 characters;
  `optReplaceArgv` and `optRemoveArgv` give `null` for `9x` and an argv for
  `a_b`; every name `isVmName(n, "permanent")` accepts passes `isNixAttrName`.
- `"a machine name we cannot write is listed, not editable"` — an `apps.nix` line
  for `9x` parses to a row with `ownership: "managed-unsupported"`, and
  `rowActions` offers neither `edit` nor `remove`.

Then `node tests/run.js` (93 passing today, 100 after these seven) and
`nix flake check`.
