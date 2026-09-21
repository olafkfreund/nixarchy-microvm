---
status: approved
issue: 17
spec: spec/2026-09-21-17-create-recording.md
---

# Plan: the site shows creating a VM again

## Approved decisions (from the spec)

- Recorded on razer, which now runs the fixed plugin (`ra9mx9…`, since
  2026-09-21), per AGENTS.md "Retaking the captures".
- The take, in the bar popup: `c`; Tab to Name, type `demo-new`; Tab to
  Template, ↓ into the list and move to `node`, Enter; Enter to create;
  hold about 1.5 s on the new *stopped* row.
- Encoded like the other clips: repeated frames dropped, idle gaps capped
  at 0.6 s, H.264 `-crf 28` and VP9 `-crf 40`, about 25–35 s.
- `docs/index.md`: one `<figure>` with a non-autoplaying `rec-create`
  video, `poster="img/popup.png"`, placed after the "A form for either
  kind" paragraph and before the form/review pair. The hero doesn't change.
- A frame sheet at 4 fps over the whole clip is looked at: no `m:` hint, no
  SSH key, nothing but the plugin and `demo-*`.

## Steps

1. **Capture on razer:**
   - Ask for control through ai-mirror.
   - Stage: snapshot `apps.nix`/`services.nix`, run `docs/capture.sh
     --setup`, note and set do-not-disturb, check the workspace is empty,
     park the pointer off the card.
   - Record the take with `wl-screenrec` over the popup region. Every key
     goes through the guarded helper: control held and the plugin layer up.
   - Tear down: `docs/capture.sh --teardown`, restore do-not-disturb,
     `cmp` both files, release control.

   → Verify with a raw clip in scratch, a clean `cmp`, and `nixarchy-vm
   list` free of `demo-*`.
2. **Encode and check:** produce `docs/img/rec-create.webm` and `.mp4`, and
   a 4 fps frame sheet across the whole clip, and look at it.
   → Verify: no frame with an `m:` hint, a key or a stray window; `du -sb
   docs/img` under 8388608.
3. **`docs/index.md`:** the figure from the spec. → Verify that every
   `img/` reference in the page resolves (the grep loop from #3's plan).
4. **Check and ship:** `node tests/run.js`, `nix flake check`, the
   fresh-clone `omarchy plugin validate`, then a PR with "Closes #17"
   linking intent, spec and plan. → Verify that CI is green.
5. **After merge:** the live page returns 200 for both `rec-create` files,
   with sizes matching. → Verify with `curl`.

*How step 1 actually ran (razer, 2026-09-21):* ai-mirror 2.0 on razer
could not type into layer-shell panels (fixed upstream in ai-mirror#26, not
yet on razer), so after the owner's grant the take was one guarded `wtype`
process: control held and the popup layer up, checked once, with a 60 s
timeout. Teardown removed the `demo-*` VMs and restored do-not-disturb, but
did **not** run `capture.sh --teardown`: its `shell.json` restore blanks the
bar (#18, nixarchy#847). `apps.nix`/`services.nix` were compared with the
snapshot (identical), and `shell.json` was untouched. The clip is 12.3 s. A
4 fps sheet of all 49 frames plus the first and last list frames at full
size were checked: no `m:` hint, no key, nothing but the plugin and
`demo-*`.

## Tests

Frame sheet (step 2) · `nix flake check` · validate · CI · live page.

## Rollback

Revert the PR, which removes the two files and the figure.
