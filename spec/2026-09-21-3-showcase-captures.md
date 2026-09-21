---
status: approved
issue: 3
intent: intent/2026-09-21-3-showcase-captures.md
---

# Spec: Showcase the plugin with captures from a full verified run

## Corrections to the intent

- nixarchy's site already shows the plugin: `docs/manual/plugins.md`
  §MicroVMs embeds `img/features/microvm.gif` (313 KB, from #353) and
  `img/plugins/microvm-panel.jpg` (104 KB). That work replaces those two files
  and adds nothing new there.
- This repo's `README.md` has no images today. Only `docs/index.md` does.
- Both upstream issues the docs describe as pending are closed:
  nixarchy#762 (`run --detach`, `console`, `set-template`) on 2026-09-19, and
  nixarchy-pkg#19 (`opt replace`) the same day. The run confirmed both on
  razer. The text that says "today" in `README.md:83`, `docs/usage.md:149`
  and `:262`, and the "Without it" column in `docs/upstream.md`, describes an
  older install.

## Answers to the intent's open questions

1. **nixarchy's site: copy.** That repo's convention is local GIF and JPG
   files, each verified frame by frame (#353). It never hotlinks, and a copy
   cannot break when this repo moves a file. The copy is about 0.5 MB.
2. **nixarchy's side** gets its own issue and a short intent in that repo
   once this spec is approved. This spec only fixes which two files are
   handed over.
3. **Bugs A–F** become six issues in this repo, opened as plan step 1. None
   is fixed here. Each is a separate task with its own artifacts. B and D do
   not change any capture used below.
4. **No create recording is published for now.** The new one shows bug A's
   false hint. The existing `rec-create.*` (2026-09-18) ends on "started in a
   terminal: … closing that terminal stops the VM", the pre-#762 behaviour
   this change turns into the older-install path, so it would contradict the
   new text. `rec-create.*` is deleted, and `rec-permanent` covers the form.
   Retaking create after A is fixed is a follow-up.

## Design

### The capture set (`docs/img/`)

Source: `~/.cache/nixarchy-microvm-captures-3/`, the verified run.

| File | Status | Shows |
| --- | --- | --- |
| `rec-start.webm`, `.mp4` | new, 18 s | popup: `s` on a stopped VM, the build streamed into the panel, `exit 0 · done` |
| `rec-permanent.webm`, `.mp4` | new, 40 s | menu: `{"create":true}`, kind flipped, `p1` filled in, review, written, *pending apply* |
| `rec-assist.webm`, `.mp4` | new, 58 s | menu: a sentence, "asking claude…", form filled with reasoning, review |
| `popup.png` | replaced | one running and two stopped disposable VMs, cursor on the running one |
| `menu.png` | replaced | two running disposable VMs and a permanent `p1` *pending apply*, footer `a apply` |
| `form-permanent.png` | replaced | permanent form, console only, one share |
| `review.png` | replaced | the exact `apps.nix` line for `p1` and the two commands |
| `assist.png` | replaced | the form filled from the sentence, with the agent's reasoning |
| `busy.png` | new | second start refused: "Busy: run demo-python — press o to watch" |
| `delete-confirm.png` | new | delete dialog naming the state directory, Cancel focused |
| `console.png` | new | the guest's shell through the console: NixOS 26.11, 1 core, 460 MiB |
| `rec-create.webm`, `.mp4` | deleted | (answer 4) |

Not published: `popup-empty.png` and the new `create.*`. Nothing uses the
first, and the second shows bug A.

Budget: about 4.6 MB in total, against the 8 MB check in `flake.nix:147`
and `.github/workflows/ci.yml:34`.

The hero is a `<video controls autoplay muted loop playsinline
preload="metadata">` with the WebM source first, as `docs/index.md:11` does
now. The other videos are `<video controls muted loop playsinline
preload="none" poster=…>`, which don't autoplay. The clips keep the
existing `rec-` prefix.

### `docs/index.md`

- **Hero** (`:10–16`): `rec-start` replaces `rec-create`. Caption: a VM
  started from the bar, its build in the panel, running in the background.
- **One list** (`:62`): the new `popup.png`. The alt text is corrected, since
  the new shot has three disposable VMs and no permanent one.
- **New, after the list:** two sentences and a `shot-pair`, `busy.png` and
  `delete-confirm.png`: one change at a time, from either surface, and
  delete asks with Cancel as the default.
- **New:** one sentence and `console.png`: Enter attaches to a running VM's
  console, and Ctrl-] leaves it running.
- **A form for either kind** (`:72–81`): the existing pair, with the new
  `form-permanent.png` and `review.png`, then `rec-permanent` below the
  pair.
- **Describe it instead** (`:87`): `rec-assist`, with `assist.png` as the
  poster, replaces the still. The caption quotes the real sentence.
- **Two ways in** (`:97`): the new `menu.png`. The caption mentions the
  permanent row and `a apply`.

### `README.md`

- One image under the intro: `docs/img/menu.png`, which has both kinds in one
  list, linked to the Pages site for the recordings. GitHub doesn't play
  `<video>` from repo files, so the README uses a still.
- `:83–85`: the "Today…" paragraph becomes: `s` starts a stopped disposable
  VM in the background with its build in the panel, and Enter attaches to it.
  On a nixarchy from before nixarchy#762, both open `nixarchy vm run` in a
  terminal instead.

### `docs/usage.md`

- §A throwaway shell, steps 5–6: `s` starts the VM, with the first build
  streamed into the panel (`o` shows it again). Enter opens the console, and
  Ctrl-] leaves the VM running. `m` on a stopped VM changes its template. The
  terminal fallback becomes one sentence about older nixarchy.
- §Troubleshooting (`:261–263`): the entry becomes "on a nixarchy from
  before #762".
- §Edit (`:186`): drop "until then the key is hidden", since #19 has
  shipped. Keep one clause for older installs.
- **New troubleshooting entry for bug C:** *"no service 'microvm' in
  services.nix"*. Your `services.nix` predates the row: copy the
  `#@ microvm` line from `/etc/nixarchy/services-template.nix`, then try
  again. This documents the current behaviour until bug C is fixed.
- **New troubleshooting entry for bug D/E:** *AI assist stops with no
  message.* Run `claude -p hi` in a terminal. An expired login is the usual
  cause.

### `docs/upstream.md`

Both rows are marked shipped, with the close dates. "Without it" becomes
"on an older install". The table stays, because detection still matters for
older installs.

### Handover to nixarchy (its own process, answer 2)

- `docs/img/features/microvm.gif` ← `rec-start`, as a GIF: 488 px wide,
  about 12 fps, a two-pass palette, 600 KB at most.
- `docs/img/plugins/microvm-panel.jpg` ← `menu.png` as a JPEG, quality 85.
- The alt text in `plugins.md:129` and `:131` updated to match. No other text
  changes.

## Alternatives rejected

- **Hotlinking nixarchy's images from this repo's Pages.** It goes against
  that repo's convention, and a rename here would break it silently.
- **Publishing either create clip.** The new one shows bug A as if it were
  intended. The old one shows pre-#762 behaviour as the current behaviour.
- **Fixing A–F in this task.** The intent says no runtime changes. The bugs
  have different owners (C and E touch nixarchy and claude behaviour) and each
  needs its own test.
- **Replacing every still with a video.** The page would get heavy (8 MB
  budget), and stills with alt text are more accessible.
- **Publishing `popup-empty.png`.** It says nothing the text doesn't.

## Risks

- **`docs/img` over 8 MB:** the planned set is about 4.6 MB. The flake check
  and CI fail loudly if it grows past the limit.
- **Autoplay:** only the hero autoplays (see Design), so the page does not
  start three videos at once.
- **No create video until A is fixed:** the disposable create flow is shown
  by text, the form still and `rec-permanent` only. That is accepted, and
  the retake is filed with A.
- **nixarchy branch:** that repo is on `docs/836-nested-claude-md`, which
  isn't mine. Its change is made on a fresh branch from its main, after its
  own intent.

## Verification

- `nix flake check`: tests, no symlinks, no hex colours, `docs/img` under
  8 MB.
- `du -sb docs/img` recorded in the PR.
- Jekyll build of `docs/` (the Pages workflow), then load the page. Every
  `<img>` and `<video>` resolves, and the hero plays muted and looping.
- Every changed sentence checked against the run's evidence in the intent's
  test table.
- The README image renders on GitHub's branch view.
- Before committing to nixarchy, a frame sheet of the new GIF is looked at,
  as #353 requires.
