---
status: approved
issue: 17
intent: intent/2026-09-21-17-create-recording.md
---

# Spec: the site shows creating a VM again

Approved in the intent: the clip goes under "A form for either kind",
before the permanent recording. The hero stays `rec-start`.

## Design

### Capture (razer, after it runs nixarchy with #844)

Procedure: AGENTS.md "Retaking the captures". Stage with `docs/capture.sh
--setup` (`demo-shell` and `demo-python`), turn on do-not-disturb, use an
empty workspace, park the pointer off the card, and send keys only while the
popup's layer is up.

The take, in the bar popup, recorded with `wl-screenrec` over the popup
region (as `rec-start` was):

1. open the popup; `c`;
2. Tab to Name, type `demo-new` at a human pace;
3. Tab to Template, ↓ into the list (every template with its note), move to
   `node`, Enter;
4. Enter to create; the list shows `demo-new` *stopped*;
5. hold about 1.5 s.

It's encoded like the others: repeated frames dropped, idle gaps capped at
0.6 s, MP4 at H.264 `-crf 28` and WebM at VP9 `-crf 40`. The target is
about 25–35 s.

Checks before commit:

- a frame sheet at 4 fps over the whole clip, looked at, with no `m:` hint
  on any frame (#4), nothing but the plugin and `demo-*`, and no SSH key;
- the popup must show the fixed plugin. The hint line must be empty with
  the cursor on a stopped disposable row.

Teardown: `docs/capture.sh --teardown` (it removes `demo-new` too),
restore do-not-disturb, and `cmp` both nixarchy files against the snapshot.

### Page (`docs/index.md`)

After the paragraph "**A form for either kind.** …" (`:91–94`) and before
the form/review `shot-pair` (`:96`):

```html
<figure class="shot">
  <video controls muted loop playsinline preload="none" poster="img/popup.png"
         aria-label="Recording of creating a disposable VM from the bar popup: a name, a template picked from the list, enter">
    <source src="img/rec-create.webm" type="video/webm">
    <source src="img/rec-create.mp4" type="video/mp4">
  </video>
  <figcaption>A disposable VM from the keyboard: <kbd>c</kbd>, a name, <kbd>↓</kbd> into the templates and their notes, <kbd>enter</kbd>. It's in the list a moment later.</figcaption>
</figure>
```

It doesn't autoplay (only the hero does). The poster is the existing
`popup.png`.

## Alternatives rejected

- **A second hero.** Two autoplaying videos at the top compete, and the
  hero already shows a VM starting.
- **Reusing the 2026-09-21 take.** It shows #4's hint.

## Risks

- `docs/img` grows by about 1–1.5 MB, to about 6 MB, under the 8 MB limit.
  The flake check enforces it.
- It depends on #844 merging and razer being rebuilt. If that stalls, this
  waits.

## Verification

- The frame sheet above, looked at.
- `du -sb docs/img` under 8388608, `nix flake check`, and the fresh-clone
  `omarchy plugin validate`.
- After merge: the live page returns 200 for `rec-create.webm` and `.mp4`.
