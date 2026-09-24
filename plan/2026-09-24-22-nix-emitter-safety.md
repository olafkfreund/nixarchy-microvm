---
status: draft
issue: 22
spec: spec/2026-09-24-22-nix-emitter-safety.md
---

# Plan: validate what reaches the emitter, and read back what it wrote

Everything in this plan is `Model.js` and `tests/model/`, plus one docs line.
No QML changes. The approved decisions, in full:

- **Validate, never escape.** `nixString` (`Model.js:847`) keeps its one line.
  Every value is checked before it gets there, and a new `nixSafe` assertion
  inside `machineSnippet` (`Model.js:852`) enforces the claim the comment at
  `Model.js:840-845` currently only makes. Escaping was rejected on **cost, not
  impossibility**: it could be done — a separate Nix-string grammar, decoded
  before path validation, would leave `isPath` untouched — but `SNIPPET_RE`
  (`Model.js:874`), `SHARE_RE` (`Model.js:880`) and the `isPath` post-check at
  `Model.js:894` would all have to grow an escape-aware form, which is two
  grammars and a decode step to defend one value that a one-line predicate
  defends instead, in a repository whose rule is that the snippet grammar is
  the only Nix it emits.
- **`hostHome` is validated.** New `isHostHome` — non-empty, leading `/`,
  `isPath`'s character set, no `.` or `..` segment. `expandHome`
  (`Model.js:667`) returns null when the path begins `~/` and `isHostHome`
  is false; a path needing no expansion is returned unchanged whatever HOME
  says. `parseShares` (`Model.js:703`) turns that null into `errors.shares`,
  and `machineSnippet` returns null through the `validateForm` gate it already
  has at `Model.js:854`. This also closes the empty-HOME literal `~`.
  HOME reaches two other builders, and neither needs anything: `sshArgv`
  (`Model.js:1098`) splices it into an `-i` path at `:1106`, and `sshKeysArgv`
  (`Model.js:1435`) splices it into a `find` path at `:1437` — in both it is
  one argv element, which needs no Nix quoting. `consoleArgv`
  (`Model.js:1051`) is **not** one of them: it takes a name, not a home.
- **Tags are sanitised, `isPath` is not tightened.** `shareTags`
  (`Model.js:720`) derives its basename at `:724`; that line becomes
  `base.replace(/[^A-Za-z0-9_.-]/g, "-").slice(0, 58) || "share"`, then runs
  the existing collision loop (`:726`) unchanged, keyed on the sanitised tag
  and still seeded from `BUILTIN_TAGS` (`:721`). 58 leaves room for any suffix
  the loop reaches (`-99999` lands on 64, the parser's bound). Tightening
  `isPath` was rejected: a `/mnt/c++` mount point that builds today would start
  failing `validateForm`, turning a working line read-only. The mount point is
  the user's; the tag is an identifier the plugin invents, so the plugin
  shapes it.
- **The host side of a share rejects `.` and `..`.** New `isHostPath` replaces
  `isPath(parts[0])` at `Model.js:709`. Not resolved for the user: textual
  resolution changes meaning across a symlink.
- **The maps.** `Object.create(null)` for `seen` (`Model.js:285`) and `byName`
  (`Model.js:366`), and a `hasOwnProperty` guard on the `AGENT_FIELDS`
  (`Model.js:1379`) lookup at `Model.js:1395`. `isVmName` (`Model.js:637`) is
  **not** tightened: `parseMachineLines` must read a name it did not write, so
  the map has to be safe for any name regardless, and a reserved-word list
  could orphan a VM a user has already declared and applied.
- **Migration: none.** The parse-side tag check (`Model.js:895`) widens to
  `/^[A-Za-z0-9_.+-]{1,4096}$/`, so a line an earlier version wrote with
  `tag = "c++"` becomes readable again. `parseMachineSnippet` returns no tags
  and `shareTags` re-derives them, so the next save the user asks for writes
  the sanitised form. No read touches the file and no line is rewritten behind
  the user's back.
- **What the widened check is, and is not.** It validates *syntactic safety*:
  the tag sits inside a quoted Nix string, is discarded on read and re-derived
  on write, so nothing in it can reach the emitted line. It does **not**
  validate *emitter provenance* — a hand-edited tag outside the emitter's
  output language will still read as `managed`. That is intended: the
  alternative is telling the user their own line was edited by hand when the
  plugin wrote it, which is the bug being fixed.
- **The round-trip invariant, stated precisely.** The parser discards tags and
  reconstructs share paths, so the assertion is
  `parseMachineSnippet(machineSnippet(f, rows, TEMPLATES, HOME))` equals **`f`'s
  normalised fields** — never an arbitrary form object. A form carrying tags or
  an unnormalised share spelling will not compare equal and is not meant to.
  Wherever the short form `parse(emit(f)) == f` appears in the repository or in
  older notes, it means exactly this. The emitter's output stays a strict
  subset of what the parser accepts; the reverse was never claimed.
- **The comment at `Model.js:840-845` is corrected**, not left to age.

**Three judgement calls this plan makes.** The spec does not fix these; they
are the plan's own and are open to the reviewer:

1. **`isHostHome`'s character class is written out explicitly** as
   `/^\/[A-Za-z0-9_.\/+-]*$/`, plus length ≤ 4096, plus no `.` or `..`
   segment. `isPath` (`Model.js:663`) cannot be reused literally, because it is
   anchored on a leading `/` **or** `~/` and would accept `~/x` as a HOME. The
   cost is one duplicated character class that must be kept in step with
   `isPath`'s; the alternative — factoring the class into a shared constant —
   touches `isPath`, which this plan otherwise leaves alone.
2. **The `parseShares` error message is extended**, not replaced: the existing
   host-path message at `Model.js:709` gains ", with no . or .. segments",
   matching the guest-path message already at `:711`. A second distinct message
   for the `..` case would be more precise and one more string to keep true.
3. **The test-count mapping** below is the plan's arithmetic, not a number the
   spec sets. If the reviewer wants the round-trip loop as a new block rather
   than a rewrite of the existing one, the expected total moves by one.

## Steps

Order: predicates alone first, then the parser widening, then the emitter.
Each commit must leave the parser accepting a superset of what the emitter at
that commit writes — widening the parser first can never break that, and the
`nixSafe` assertion must land *after* the predicates that make it unreachable,
or a pathological HOME yields a null snippet with no field error.

1. **`Model.js`: add the three predicates, wired to nothing.**
   `nixSafe(value)` → `!/["\\]/.test(value) && value.indexOf("${") === -1 &&
   !hasControlChars(value)` (`hasControlChars` exists at `Model.js:747`), beside
   `nixString` (`Model.js:847`).
   `isHostHome(value)` → `/^\/[A-Za-z0-9_.\/+-]*$/` plus length ≤ 4096 plus no
   `.` or `..` segment, beside `isPath` (`Model.js:663`).
   `isHostPath(value)` → `isPath(value)` plus no `.` or `..` segment.
   → verify by `node tests/run.js`: the new predicate tests pass, the 70
   existing ones are untouched.
2. **`Model.js`: widen the parse-side tag class** at `Model.js:895` from
   `/^[A-Za-z0-9_.-]{1,64}$/` to `/^[A-Za-z0-9_.+-]{1,4096}$/`. The
   `BUILTIN_TAGS` rejection on the same line stays.
   → verify by the legacy-line fixtures in `parsing.test.js` reaching
   `ownership: "managed"`, and `node tests/run.js`.
3. **`Model.js`: validate `hostHome` and the host side of a share.**
   `expandHome` (`:667`) returns `null` when `text.indexOf("~/") === 0
   && !isHostHome(host)`; unchanged otherwise. `parseShares` (`:703`) returns
   `{ error: "HOME is not a plain absolute path, so ~/ cannot be expanded;
   write the path in full" }` on that null, and uses `isHostPath` at
   `Model.js:709` with that message extended to "…, with no . or .. segments"
   (judgement call 2).
   → verify by the hostHome and host-`..` tests in `form.test.js`.
4. **`Model.js`: sanitise the tag** at `Model.js:724` inside `shareTags`
   (`:720`), collision loop (`:726`) unchanged.
   → verify by the tag tests in `form.test.js`.
5. **`Model.js`: assert in the emitter.** `machineSnippet` (`:852`) collects
   the strings it is about to write — the trimmed template (`:858`), each
   share's `source`, `mountPoint` and tag (`:866`), and the normalised SSH key
   (`:869-870`) — and returns null if any fails `nixSafe`.
   → verify by the round-trip property test in `form.test.js`, which must show
   the guard unreachable for every form a user can submit.
6. **`Model.js`: the maps.** `Object.create(null)` at `Model.js:285` and
   `Model.js:366`; guard the `AGENT_FIELDS` lookup at `Model.js:1395` with
   `Object.prototype.hasOwnProperty.call(AGENT_FIELDS, key)`.
   → verify by the prototype-name tests in `parsing.test.js`, which assert
   `Object.prototype.runtime === undefined` afterwards.
7. **`Model.js`: correct the comment at `Model.js:840-845`.** Drop "every
   string in it is drawn from a set with no `" \` or `${`, so it needs no
   escaping". Say instead: nothing is escaped because every string is checked
   against `nixSafe` immediately before it is written and the line is refused
   otherwise; the field allowlists (`isTemplateName`, `isHostPath`,
   `normalizeGuestPath`, `isHostHome`, the tag sanitiser, `SSH_KEY`) are why
   that check never fires for a form a user could submit. Add that
   `parseMachineSnippet` deliberately accepts a superset — a wider tag, a `..`
   host path — so an older line stays editable, and that this is syntactic
   safety, not a claim that the line came from this emitter.
   → verify by reading it against steps 1–5; `nix flake check`.
8. **`docs/usage.md:175-177`: say what the shares field now refuses.** The
   host path may not contain `.` or `..` segments, and `~/` needs a plain
   absolute HOME. One sentence; `README.md:216` already says tags are unique
   and needs no change.
   → verify by `nix flake check` (it reads `docs/img/` size and the manifest,
   not prose) and by eye.

## Tests

`tests/model/form.test.js`, in the style of its `errors()` / `snippet()`
helpers over `HOME = "/home/user"`:

- **`nixSafe is the set nixString may be handed`** *(new block)* — false for
  `a"b`, `a\b`, `a${b}`, `a\u0001b`; true for `/home/user/c++`.
- **`a pathological HOME blocks ~/ shares, not absolute ones`** *(new block)* —
  for each of `/home/${builtins.currentTime}`, `/home/a"b`, `/home/a\b`, `""`,
  `/home/a b`, `~/x`, `/home/../root`: `validateForm(form({shares:
  "~/src:/mnt/src"}), rows, TEMPLATES, bad).errors.shares` is set and
  `machineSnippet(…)` is null; `form({shares: "/srv:/mnt/srv"})` gives `{}`
  and a snippet under the same bad HOME. `expandHome("~/src", bad)` is null,
  `expandHome("/srv", bad)` is `/srv`.
- **`share tags are sanitised into the parser's own class`** *(new block)* —
  `snippet({shares: "~/c++:/mnt/c++"})` contains `tag = "c--"` and
  `source = "/home/user/c++"`, and `parseMachineSnippet` of it returns
  `shares: "/home/user/c++:/mnt/c++"`; a 65-character basename yields a
  58-character tag; `"/a:/mnt/c++ /b:/mnt/c--"` yields `c--` then `c---2`,
  both ≤ 64; `"/a:/mnt/ro-store"` does not yield `ro-store`.
- **`the host side of a share rejects . and .. segments`** *(new block)* —
  `errors({shares: "~/../etc:/mnt/etc"}).shares` and
  `errors({shares: "/srv/../etc:/mnt/etc"}).shares` are set;
  `errors({shares: "/srv/a.b:/mnt/a"})` is `{}`.
- **The round trip, as a property** *(rewrites the existing block at
  `form.test.js:104`)* — that block's single assertion becomes a loop over the
  cross product of: both templates; `autostart` true and false; memory and
  cores at `MEMORY_MIN`, `MEMORY_MAX`, `1` and `CORES_MAX`; `sshPort` empty,
  `1024`, `65535`; key and no key; and a shares table of empty, one, three,
  `~/`-prefixed, `c++`, a 65-character basename, and two that collide. For
  each, assert `parseMachineSnippet(machineSnippet(f, rows, TEMPLATES, HOME))`
  is non-null and **equals `f`'s normalised fields** — the template and
  `autostart` as given, `memory`/`cores`/`sshPort` as numbers (`sshPort` null
  when empty), `sshKey` as `normalizeSshKey` leaves it, and `shares` as the
  `source:mountPoint` pairs `parseShares` produced, `~` expanded and the guest
  path canonical, joined by spaces. Not the form object as written: tags are
  discarded on read and a share the user spelled loosely comes back
  normalised. Non-null is what proves the step-5 guard unreachable.

`tests/model/parsing.test.js`:

- **`a line an earlier version wrote reads back as managed`** *(new block)* —
  `apps.nix` fixtures carrying `tag = "c++"`, a 100-character tag, and
  `source = "/home/user/../etc"` each parse to `ownership: "managed"` with
  usable `fields`; `tag = "ro-store"` and `tag = "a\"b"` stay
  `managed-unsupported`. Then feed the `c++` line's `fields` back through
  `formFromRow` (`Model.js:779`) and `machineSnippet` and assert the emitted
  tag is `c--`.
- **`names from Object.prototype are rows, not prototype members`** *(new
  block)* — a fixture declaring `constructor`, `toString`, `valueOf`,
  `hasOwnProperty` and `__proto__` yields one row per name, in that order, from
  `parseMachineLines` (`Model.js:282`); `permanentRows(parseUnits(units), [],
  null)` (`Model.js:365`) with those names as units returns one row each;
  afterwards `Object.prototype.runtime === undefined &&
  Object.prototype.pending === undefined`.

`tests/model/agent.test.js`:

- extend the existing unknown-key case *(no new block)* with a reply carrying
  `__proto__` and `constructor`: both land in `rejected`-or-dropped exactly as
  any unknown key does, and the returned form gains no property from either.

**Count** (judgement call 3): six new `test(...)` blocks — four in
`form.test.js`, two in `parsing.test.js`. The round-trip case rewrites the
existing block at `form.test.js:104` and the agent case extends an existing
block, so neither adds to the total. `node tests/run.js` → **76 passed,
0 failed** (70 today). Then `nix flake check`.

Live, on a nixarchy desktop, following AGENTS.md "Verifying live" (stop, swap,
start). **No `nixarchy-apply`** — the defect lives in the line as written, and
`nixarchy-pkg`'s own parse check on `opt set` already says the line is valid
Nix:

1. Open the menu, create a permanent `p1` with `shares: ~/c++:/mnt/c++`.
2. The review shows `tag = "c--"` and `source = "/home/user/c++"`.
3. Save, then `grep 'machines\.p1' ~/.config/nixarchy/apps.nix` — one line,
   the tag sanitised, the source expanded.
4. Reopen the list: the `p1` row offers `e`, and `hiddenReason` does not say
   "this line was edited by hand".
5. `nixarchy-opt-remove programs.nixarchy.services.microvm.machines.p1`, and
   confirm the line is gone from `apps.nix`.

The pathological HOME cases stay in Node: HOME is the running shell's, and
restarting it broken proves nothing the unit tests do not.

## Rollback

`git revert` the commits in reverse order, or drop the branch: every change is
in `Model.js`, `tests/model/` and one `docs/usage.md` sentence, with no
schema, manifest or QML change. Revert the whole set or none — reverting the
parser widening (step 2) alone would make a `c++` line unreadable again.

The one thing that does not roll back cleanly: **a line already written to the
user's `apps.nix` while this branch was installed.** Sanitising only ever
produces a tag the old parser already accepted, so such a line still reads as
`managed` after a revert — the risk is the other direction. A user who, before
this branch, saved a share with a `..` host path has a line this branch refuses
to re-save: it opens in the form, shows `errors.shares`, and Enter does
nothing. The line itself is untouched, still in `apps.nix`, still built by
`nixarchy-apply`, and the plugin shows it read-only rather than rewriting it.
That user either edits it by hand in `apps.nix` or writes the path in full.
Nothing this branch does needs undoing on disk.
