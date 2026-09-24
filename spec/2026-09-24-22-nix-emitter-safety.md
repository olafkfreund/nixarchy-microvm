---
status: approved
issue: 22
intent: intent/2026-09-24-22-nix-emitter-safety.md
---

# Spec: validate what reaches the emitter, and read back what it wrote

## Design

The emitter stays dumb: every value is checked before it gets there, one
assertion in `machineSnippet` enforces that rather than assuming it, and the
parser reads a little more than the emitter writes, so an older line is still
ours.

**`nixString` (`Model.js:847`) keeps its one line and gains a guard beside
it.** New `nixSafe(value)` — `!/["\\]/.test(v) && v.indexOf("${") === -1 &&
!hasControlChars(v)` — is exactly the set the comment at `Model.js:840-845`
claims. `machineSnippet` (`Model.js:852`) collects the strings it is about to
write (the template, each share's source, mount point and tag, the normalised
SSH key) and returns null if any fails. For a form that passed `validateForm`
it never fires; it exists so the emitter's safety is a check, not a comment.

**`hostHome`.** It is the shell's own `HOME`: `MicrovmState.qml:25`
(`Quickshell.env("HOME") || ""`) → `MicrovmView.qml:348` → `CreateForm.qml:25`
→ `validateForm` / `machineSnippet`. New `isHostHome(value)`: non-empty, starts
with `/`, `isPath`'s character set, no `.` or `..` segment. `expandHome`
(`Model.js:667`) returns null when the path begins `~/` and `isHostHome` is
false; a path needing no expansion is returned unchanged whatever `HOME` says.
`parseShares` (`Model.js:703`) turns the null into `{ error: "HOME is not a
plain absolute path, so ~/ cannot be expanded; write the path in full" }`, so
`validateForm` (`Model.js:822`) shows `errors.shares` and `machineSnippet`
returns null through the gate it already has at `Model.js:854`. A user with
`HOME=/home/${builtins.currentTime}` sees that message on the shares field,
and only if a share of theirs uses `~/`. That also closes the empty-`hostHome`
literal `~`. HOME reaches `consoleArgv` (`Model.js:1105`) too, as one argv
element, which needs no quoting and is left alone.

**Tags.** `shareTags` (`Model.js:724`) sanitises what it derives rather than
`isPath` forbidding it: `base.replace(/[^A-Za-z0-9_.-]/g, "-").slice(0, 58) ||
"share"`, then the existing collision loop untouched. The class is the parser's
own `[A-Za-z0-9_.-]` (`Model.js:895`), and 58 leaves room for any suffix the
loop can reach — `-99999` still lands on 64. The loop keys on the sanitised
tag, so two mount points that sanitise alike (`/mnt/c++`, `/mnt/c--`) collide
and the second becomes `c---2`, exactly as two same-named shares already do.
`used` still starts from `BUILTIN_TAGS`.

**The host side of a share.** New `isHostPath(value)` — `isPath` plus "no `.`
or `..` segment", the rule `normalizeGuestPath` (`Model.js:676`) already
applies to the guest — replaces `isPath(parts[0])` at `Model.js:709`. The host
path is not resolved for the user: textual resolution changes meaning across a
symlink, so it is refused and the user writes what they mean.

**The maps.** `Object.create(null)` for `seen` (`Model.js:285`) and `byName`
(`Model.js:366`). Every other object-as-map, audited: `byGroup`
(`Model.js:69`) keys from the `SHORTCUTS` literal; `full` (`Model.js:486`) is
written, never tested; `wanted` (`Model.js:521`) keys are `rowKey`
(`Model.js:328`), `kind + ":" + name`, and no `Object.prototype` member holds a
`:`; `result` (`Model.js:602`) keys come from the manifest defaults; `seen`
(`Model.js:1203`) keys are internal verbs; `f` (`Model.js:1389`) copies the
form's own keys. One more: `AGENT_FIELDS[key]` (`Model.js:1379`) over
agent-supplied keys returns a truthy non-string for `constructor`, which
matches no type branch and is dropped — already the documented behaviour for an
unknown key, but it gets a `hasOwnProperty` guard so that comment stays true.

`isVmName` (`Model.js:637`) is **not** tightened. `parseMachineLines` must read
a name it did not write — another tool's line, a hand edit, `toString`
included — so the map has to be safe for any name regardless; once it is, a
reserved-word list adds upkeep and fixes nothing, and it could refuse a name a
user has already declared and applied.

**Lines an earlier version wrote.** Left in place, made readable, never
rewritten. The parse-side tag check (`Model.js:895`) widens to
`/^[A-Za-z0-9_.+-]{1,4096}$/` — the set a basename can hold under `isPath`,
bounded by the mount point rather than by the emitter — so `tag = "c++"` or a
100-character tag reads as `managed` again. Nothing is lost by reading it:
`parseMachineSnippet` returns no tags, `shareTags` re-derives them, so the next
save the user asks for writes the sanitised tag — a user-initiated write, not a
migration, and no read touches the file. The `..` host path is the same shape:
the parser keeps plain `isPath` at `Model.js:890`, so such a line still means
what it meant and only a save of it is refused, with the field error visible.
The emitter's output stays a strict subset of what the parser accepts, which is
all `parse(emit(f)) == f` needs; the reverse was never claimed.

**The comment at `Model.js:840-845`** drops "every string in it is drawn from a
set with no `" \` or `${`, so it needs no escaping" and says instead: nothing
is escaped because every string is checked against `nixSafe` immediately before
it is written and the line is refused otherwise; the field allowlists
(`isTemplateName`, `isHostPath`, `normalizeGuestPath`, `isHostHome`, the tag
sanitiser, `SSH_KEY`) are why that check never fires for a form a user could
submit. It also states that `parseMachineSnippet` deliberately accepts a
superset — a wider tag, a `..` host path — so an older line stays editable.

## Alternatives rejected

**Make `nixString` escape, and teach the grammar to read escapes.** The obvious
defence in depth, and it does not work here. `SNIPPET_RE` (`Model.js:885`) and
`SHARE_RE` (`Model.js:893`) match `"[^"]*"`, so they would need
`(?:[^"\\]|\\.)*` plus an unescaping step — and the post-check at
`Model.js:890` is `isPath(s[1])`, which rejects a backslash, so an unescaped
source would still fail and the parse would still return null. Making escaping
round-trip means loosening `isPath` too: widening the Nix this repository emits
in order to be safe about emitting it. The one string that needed escaping was
`hostHome`, which has no business holding a quote.

**Tighten `isPath` instead of sanitising the tag** — drop `+`, bound the
segment. It rejects a path a user may have declared and applied: a `/mnt/c++`
mount point that builds today would start failing `validateForm` *and* the
parse-side check, turning a working line read-only. The mount point is the
user's choice; the tag is an identifier the plugin invents, so the plugin
shapes it.

**Migrate bad lines on read, or offer a one-time rewrite.** Both write
`apps.nix` for a reason the user did not ask for, and a confirmation for a
cosmetic tag is noise. Widening the parser gets the line back with no write.

**Reject `constructor` and friends in `isVmName`.** As above: it does not
remove the need to fix the map, and it can orphan a declared VM.

## Risks

- **Widening the parse-side tag class** accepts a tag the emitter cannot
  produce. Its only effect: a hand-edited line with an odd tag becomes
  editable, meaning unchanged, and a save rewrites the tag. The tag is not
  user-visible, so `docs/usage.md` is unaffected.
- **`isHostPath` rejecting `..`** turns an existing `~/../x:/mnt/x` row into
  one that opens in the form and then refuses to save, showing
  `errors.shares`. The line keeps working and is never rewritten. This is the
  one change a user could read as a regression.
- **`isHostHome` on a pathological HOME** blocks every `~/` share on that
  machine. Deliberate: the alternative is a line that does not parse back.
  Absolute shares still work, so the surface stays usable.
- **The `nixSafe` assertion** could return null with no field error if a
  predicate and the guard ever disagree — a form that will not submit and says
  nothing. Mitigated by testing `nixSafe` directly and by the round-trip
  property test, which must show the guard unreachable.
- **`Object.create(null)`** removes `hasOwnProperty` from those two objects.
  Neither site uses it; both only index and assign.
- No change to `isVmName`, so no existing permanent VM is orphaned.

## Verification

New and extended Node tests in the style of `tests/model/form.test.js` (its
`errors()` / `snippet()` helpers over `HOME = "/home/user"`):

- **hostHome**, `form.test.js`: for each of `/home/${builtins.currentTime}`,
  `/home/a"b`, `/home/a\b`, `""`, `/home/a b`, `~/x`, `/home/../root`, assert
  `Model.validateForm(form({shares:"~/src:/mnt/src"}), rows, TEMPLATES,
  bad).errors.shares` is set and `Model.machineSnippet(…)` is null; and that
  `form({shares:"/srv:/mnt/srv"})` gives `{}` and a snippet under the same bad
  home. `Model.expandHome("~/src", bad)` is null, `Model.expandHome("/srv",
  bad)` is `/srv`.
- **Tags**, `form.test.js`: `snippet({shares:"~/c++:/mnt/c++"})` contains
  `tag = "c--"` and `source = "/home/user/c++"`, and `parseMachineSnippet` of
  it returns `shares: "/home/user/c++:/mnt/c++"`; a 65-character basename
  yields a 58-character tag; `"/a:/mnt/c++ /b:/mnt/c--"` yields `c--` and
  `c---2`; `"/a:/mnt/ro-store"` does not yield `ro-store`.
- **Host `..`**, `form.test.js`: `errors({shares:"~/../etc:/mnt/etc"}).shares`
  and `errors({shares:"/srv/../etc:/mnt/etc"}).shares` are set;
  `errors({shares:"/srv/a.b:/mnt/a"})` is `{}`.
- **The guard**, `form.test.js`: `Model.nixSafe` false for `a"b`, `a\b`,
  `a${b}`, `a\u0001b`; true for `/home/user/c++`.
- **Legacy lines**, `parsing.test.js`: `apps.nix` fixtures carrying
  `tag = "c++"`, a 100-character tag, and `source = "/home/user/../etc"` each
  parse to `ownership: "managed"` with usable `fields`; `tag = "ro-store"` and
  `tag = "a\"b"` stay `managed-unsupported`.
- **Prototype names**, `parsing.test.js`: a fixture declaring `constructor`,
  `toString`, `valueOf`, `hasOwnProperty` and `__proto__` yields one row per
  name, in order, from `parseMachineLines`;
  `Model.permanentRows(Model.parseUnits(units), [], null)` with those names as
  units returns one row each, and `Object.prototype.runtime === undefined &&
  Object.prototype.pending === undefined` afterwards.
- **Round trip as a property**, `form.test.js`: over the cross product of both
  templates, `autostart`, memory/cores/port at their bounds, key and no key,
  and a shares table (empty, one, three, `~/`-prefixed, `c++`, a 65-character
  basename, two colliding), assert
  `Model.parseMachineSnippet(Model.machineSnippet(f, …))` is non-null and
  equals `f`'s normalised fields. This is the existing assertion at
  `form.test.js:105` turned into a loop, and it is what proves the guard
  unreachable.

Then `node tests/run.js` and `nix flake check`. Every case above fails today.

Live, on a nixarchy desktop, following AGENTS.md "Verifying live" (stop, swap,
start): open the menu, create a permanent `p1` with `shares: ~/c++:/mnt/c++`,
check the review shows the sanitised tag, save, and confirm the row comes back
editable — `e` offered, no "this line was edited by hand". Then
`nixarchy-opt-remove programs.nixarchy.services.microvm.machines.p1`. No
`nixarchy-apply`: the defect lives in the line as written, and `nixarchy-pkg`'s
own parse check on `opt set` already says the line is valid Nix. The
pathological `HOME` cases stay in Node — `HOME` is the running shell's, and
restarting it broken proves nothing the unit tests do not.
