---
status: approved
issue: 3
spec: spec/2026-09-21-3-showcase-captures.md
---

# Plan: Showcase the plugin with captures from a full verified run

## Approved decisions (from the spec)

- Captures come from the verified razer run of 2026-09-21, kept in
  `~/.cache/nixarchy-microvm-captures-3/`. Every still and a frame sheet of
  every video were checked. None shows an SSH key, a key filename, or any
  window but the plugin.
- `docs/img/` ends up holding: `rec-start`, `rec-permanent` and `rec-assist`
  (each `.webm` and `.mp4`, all new); `popup.png`, `menu.png`,
  `form-permanent.png`, `review.png` and `assist.png` (replaced); and
  `busy.png`, `delete-confirm.png` and `console.png` (new).
  `rec-create.webm` and `rec-create.mp4` are deleted. The old clip shows
  pre-#762 behaviour, and the new one shows bug A. `popup-empty.png` and the
  new `create.*` are not published. Budget: about 4.6 MB, limit 8 MB.
- Only the hero video autoplays (`controls autoplay muted loop playsinline
  preload="metadata"`, WebM source first). The others use `controls muted
  loop playsinline preload="none" poster="…"`.
- The README gets one still (`docs/img/menu.png`) linked to the Pages site,
  because GitHub doesn't play `<video>` from repo files.
- nixarchy#762 and nixarchy-pkg#19 are closed (2026-09-19). The docs
  describe `s` streaming the build, Enter opening the console, and `m`
  editing as the normal behaviour. The terminal fallback is described as the
  older-install path.
- Bugs A–F become six issues. None is fixed in this task.
- nixarchy's site gets copies (its convention, from #353), through its own
  issue and artifacts: `rec-start` becomes `img/features/microvm.gif` and
  `menu.png` becomes `img/plugins/microvm-panel.jpg`, plus alt text. Nothing
  else changes there.
  *Corrected during step 8:* the formats follow nixarchy's
  `docs/AGENTS.md`, not the 488 px / 12 fps / card-JPEG first written here.
  Each is a whole desktop at 16:10, with the panel cut at its border and
  composed onto `docs/screenshots/00-desktop.jpg` where it opens (the popup
  top-right under the bar, the menu centred). The GIF is made per
  `tests/demo/encode-gif.sh`: 900 px, 4 fps, 96 colours, under 1 MB. That
  repo's own artifacts pin the details.

## Steps

One commit per step, on `docs/3-showcase-captures`, each subject citing the
step and `(#3)`.

1. **File bugs A–F** as six issues in `olafkfreund/nixarchy-microvm`, each
   with the evidence from the intent's list (file:line, how it was
   reproduced on razer), labelled `bug`. There is no commit. The numbers go
   into the PR description. → Verify with `gh issue list` showing six new
   open issues.
2. **`docs/img/`**: copy the eleven published files from the cache under
   their final names (`start.*` → `rec-start.*`, `permanent.*` →
   `rec-permanent.*`, the `assist` videos → `rec-assist.*`), then
   `git rm docs/img/rec-create.*`. → Verify with `du -sb docs/img` under
   8388608, `find docs -type l` empty, and `git status` showing exactly those
   changes.
3. **`docs/index.md`**:
   - hero `:10–16` → `rec-start`, new caption;
   - `:62` `popup.png` alt text and caption fixed (three disposable VMs, one
     running);
   - after it, two sentences plus a `shot-pair` of `busy.png` and
     `delete-confirm.png` (one change at a time, from either surface; delete
     asks, Cancel is the default);
   - one sentence plus `console.png` (Enter attaches; Ctrl-] leaves it
     running);
   - `rec-permanent` under the form/review pair;
   - `:87` the assist still → `rec-assist`, with `poster="img/assist.png"`
     and a caption quoting the real sentence;
   - `:97` `menu.png` caption mentions the permanent row and `a apply`;
   - (added during implementation) the "It detects what your nixarchy can
     do" bullet and "A tour" step 2 described the pre-#762 terminal
     behaviour as current. They now follow the decision: the detached path
     is normal, and the terminal is the older-install path.

   → Verify with `grep -o 'img/[^"]*' docs/index.md | sort -u | while read
   f; do test -f docs/$f || echo MISSING $f; done` printing nothing, and no
   `rec-create` left anywhere in `docs/` or the README.
4. **`README.md`**: after the intro, `menu.png` linked to the Pages site. At
   `:83–85`, the "Today…" paragraph is rewritten per the decisions. → Verify
   by reading the rendered branch on GitHub after the push (step 7).
5. **`docs/usage.md`**:
   - §A throwaway shell, steps 5–6 (`:149–155`): `s` starts the VM with the
     build in the panel (`o` shows it again), Enter opens the console, Ctrl-]
     leaves the VM running, and `m` on a stopped VM changes its template;
     plus one sentence on older nixarchy;
   - §Edit (`:186–193`): drop "until then the key is hidden", and keep one
     clause for older installs;
   - §Troubleshooting `:261–263`: "on a nixarchy from before #762";
   - new troubleshooting entry for bug C, *"no service 'microvm' in
     services.nix"*: copy the `#@ microvm` line from
     `/etc/nixarchy/services-template.nix` into
     `~/.config/nixarchy/services.nix` and try again (link bug C's issue);
   - new entry for bugs D and E, *AI assist stops with no message*: run
     `claude -p hi` in a terminal, where an expired login is the usual cause
     (link their issues).

   - (added during implementation) the "Some keys are missing" entry now says
     the upstream changes have shipped, and the Busy entry quotes the message
     the run actually showed ("Busy: run demo-python — press o to watch").

   → Verify that each changed sentence matches a row of the intent's test
   table.
6. **`docs/upstream.md`**: mark both rows shipped with their close dates.
   Rename "Without it" to "On an older install". Keep the detection section.
   → Verify with `grep -c 2026-09-19 docs/upstream.md` returning 2.
7. **Check, push, PR**: run `node tests/run.js`, `nix flake check`,
   `nix flake check --all-systems --no-build`, and the fresh-clone
   `omarchy plugin validate` from AGENTS.md. Then push the branch and open a
   PR that links `intent/`, `spec/` and `plan/`, lists the new bug issues,
   records `du -sb docs/img`, and says "Closes #3". → Verify that CI is green
   on the PR.
8. **nixarchy handover** (no files change in this repo): open an issue in
   `olafkfreund/nixarchy` naming the two files, their sources, the house
   style they must follow (above), and the frame-sheet requirement. Then, per that repo's AGENTS.md, write its intent
   as a draft on a fresh branch from its `main` (not on
   `docs/836-nested-claude-md`) and stop for review. → Verify that the issue
   URL and the draft intent commit exist.

### Correction after merge

The hero `rec-start` as merged in #10 opened on about 1.75 s of the list
with bug A's false hint (#4), against the decision above. Its frame sheet had
sampled too sparsely to catch it. The clip is re-cut to start where the log
opens (1.9 s into the 1× take), both formats, and its first two seconds were
sheeted at 4 fps.

## Tests

| Command | Expected |
| --- | --- |
| `node tests/run.js` | all pass (no code changed) |
| `nix flake check` | pass: `docs/img` under 8 MB, no symlinks, no hex colours |
| `nix flake check --all-systems --no-build` | evaluates |
| the fresh-clone `omarchy plugin validate` (AGENTS.md) | valid |
| the step 3 grep loop | no output |
| `grep -rn rec-create docs README.md` | no output |
| after merge: the Pages site | the hero plays muted and looping; every image and video loads |

## Rollback

It's docs and media only. Revert the merge commit (or the individual step
commits) to restore the old captures and text. Close the six bug issues only
if they turn out to be wrong, not as part of a rollback. On the nixarchy side
nothing changes until its own artifacts are approved.
