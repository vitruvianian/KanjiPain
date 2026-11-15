# KanjiPain — Proposed Improvements

Review date: 2026-11-14, against version 0.1.0 (all 13 build checkpoints complete).

This document has four parts:

1. [Brush-like drawing](#1-brush-like-drawing) — making the pad comfortable to write on. _(Done for mouse and touch. Apple Pencil still draws badly: see [1.9](#19-apple-pencil-on-ipad-follow-up-after-device-testing).)_
2. [Automatic checking of the drawn kanji](#2-automatic-checking-of-the-drawn-kanji) — how to implement it. _(Done, together with the stroke-order guide from 2.6.)_
3. [Other improvements](#3-other-improvements) — everything else found during the review.
4. [Decks: the standard Jōyō deck and custom decks](#4-decks-the-standard-jōyō-deck-and-custom-decks). _(Done; see the notes at the top of that section.)_

A suggested order of work is at the [end](#5-suggested-order-of-work).

The two headline features share one foundation: **keep storing the raw pen centreline, and derive everything else from it.** The brush is only a way of _rendering_ the centreline; the checker only _reads_ the centreline. Neither needs to know about the other.

---

## 1. Brush-like drawing

### 1.1 What is wrong today

All of this is in `src/components/DrawingPad.tsx`.

| Problem                                                                                                                                       | Effect while writing                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Strokes are polylines (`M… L… L…`) with a fixed `strokeWidth={10}` in a 1000-unit box                                                         | A uniform 1 % line: about 3.3 px on a 360 px phone. Looks like a ballpoint wire. |
| No smoothing; every raw pointer sample becomes a corner                                                                                       | Visible jitter and angular curves, worst with a mouse or a finger                |
| Only one sample per `pointermove` is used                                                                                                     | Fast strokes become a few long straight segments                                 |
| Pressure and time are discarded (`Point` is `{x, y}` only)                                                                                    | A pen behaves exactly like a mouse; no speed-based width is possible             |
| Every move copies the whole stroke (`[...current.stroke, point]`) and calls `setPreview`, re-rendering the SVG and rebuilding the path string | Quadratic work on long strokes; ink lags behind the pen on slower devices        |
| No writing guide on the paper                                                                                                                 | Hard to judge proportions and centring                                           |
| Touch and pen are treated the same                                                                                                            | A resting palm can start a stroke on a tablet                                    |
| Undo and Clear exist only as buttons below the pad                                                                                            | Correcting a stroke means leaving the writing area                               |

### 1.2 Target feel

- Lines are smooth curves, with no visible corners between samples.
- Width varies: thicker when slow or pressed, thinner when fast or light.
- Stroke endings look like brush endings: a tapered sweep (払い), a blunt stop (止め), a flick (はね).
- Ink appears under the pen with no perceptible delay.
- Small hand tremor is absorbed, without the line feeling like it trails behind.

### 1.3 Recommended approach: render each stroke as a filled outline

Use [`perfect-freehand`](https://github.com/steveruizok/perfect-freehand) (MIT, about 2 kB, no dependencies). It takes input points `[x, y, pressure]` and returns the outline polygon of a variable-width stroke. That outline is drawn as one filled SVG `<path>`, so the existing SVG architecture, `viewBox`, theming and tests of structure all stay.

It provides, as options, exactly the behaviours listed above:

| Option             | Purpose                                       | Starting value (1000-unit box)        |
| ------------------ | --------------------------------------------- | ------------------------------------- |
| `size`             | Base brush diameter                           | 34                                    |
| `thinning`         | How strongly pressure/speed changes width     | 0.6                                   |
| `smoothing`        | Softening of the outline edges                | 0.5                                   |
| `streamline`       | Stabiliser: how much input jitter is absorbed | 0.45 (mouse/touch), 0.3 (pen)         |
| `simulatePressure` | Derive pressure from speed                    | `true` unless `pointerType === 'pen'` |
| `start.taper`      | Taper at the start of the stroke              | 0, with `cap: true` (blunt entry)     |
| `end.taper`        | Taper at the end of the stroke                | about 45                              |
| `last`             | Marks the stroke as finished                  | `true` on pointer up                  |

These are starting values to tune by hand on a phone, a tablet with a pen, and a desktop mouse. Put them in one `BRUSH` constant so tuning is one place.

Convert the outline to a path using quadratic curves through the midpoints of consecutive outline points (the helper shown in the library's README), not `L` segments. That is what removes the last visible corners.

**Alternative considered:** a hand-written Canvas 2D brush (stamping circles along a Catmull-Rom spline). It allows textured, dry-brush ink, but it means replacing the SVG surface, handling device-pixel-ratio and resize redraws, and rewriting the drawing tests. Not worth it unless ink texture becomes a goal.

### 1.4 Input capture changes

1. **Use every sample.** In `onPointerMove`, read `event.nativeEvent.getCoalescedEvents()` and append all of them, falling back to the single event when the method is missing. This is the largest single improvement for fast strokes.
2. **Record pressure and time.** Extend the point to `{ x, y, p?, t? }`: `p` is `event.pressure` for pens, omitted otherwise; `t` is milliseconds since the stroke started. Both are optional, so existing saved drafts stay valid.
3. **Stop re-rendering React per sample.** Keep the active stroke in a ref, push points into it (no array copy), and update the live `<path>`'s `d` attribute directly inside one `requestAnimationFrame` callback per frame. Commit to React state only on pointer up. Wrap `StrokeShape` in `React.memo` so finished strokes are not recomputed while a new one is drawn.
4. **Palm rejection.** Once a `pointerType === 'pen'` event has been seen on the pad, ignore `touch` pointers there for the rest of the session. Keep ignoring a second pointer while a stroke is active, as today.
5. **Optional latency trick.** Chromium exposes `getPredictedEvents()`. Predicted points can be drawn for the current frame only and discarded on the next. Do this last, and only if lag is still visible on real devices.

### 1.5 Storage and limits

- Round `x`/`y` to 4 decimals and `p` to 2 on commit. Draft JSON written to IndexedDB after every stroke shrinks by about two thirds.
- Run a light Ramer–Douglas–Peucker simplification (tolerance about 0.0015) on commit. Coalesced events multiply the point count; this keeps strokes well under the existing 20,000-point cap in `strokesSchema`.
- `pointSchema` in `src/domain/schemas.ts` gains optional `p` (0–1) and `t` (non-negative integer). Backups exclude drawings, so the backup format does not change.

### 1.6 Comfort improvements around the pad

- **Writing guide.** Draw a faint 田字格 (dashed centre cross) on the paper, with a setting to switch to 米字格 (cross plus diagonals) or none. Pure SVG lines below the ink layer, `aria-hidden`.
- **Bigger target on desktop, fitted on phones.** The pad is capped at `32rem`. On phones, size it so the pad plus Undo/Clear fit in the viewport without scrolling (`min(100%, 100dvh - header - buttons)`), so the hand does not have to travel.
- **Undo without leaving the pad.** `Ctrl/Cmd+Z` on desktop, the pen's eraser/barrel button (`event.button === 5` or `buttons & 32`) on tablets, and optionally a two-finger tap. Keep the buttons.
- **Left-handed layout.** A setting that places Undo/Clear on the left side.
- **Comparison overlay on the feedback screen.** Offer a toggle that draws the reference shape, semi-transparent, over the frozen attempt. Today the answer glyph and the attempt are in separate boxes at different sizes, which makes honest self-grading harder than it needs to be. (The reference shape comes from the stroke data in section 2.)

### 1.7 Tests to update

- `e2e/drawing.spec.ts` asserts `d="M250 250 L750 750"` and counts `path`/`circle` elements. With outlines, a dot becomes a small filled path. Keep `data-testid="completed-strokes"`, assert on the fixture's JSON output (`data-testid="strokes"`) for geometry, and count elements by a `data-stroke` attribute instead of by tag name.
- Add unit tests for the pure helpers: rounding, simplification (end points preserved, tolerance respected), and outline generation returning a closed path for 1, 2 and many points.
- Add a WebKit project to Playwright for the drawing spec. iPad Safari is the main pen device and is not covered today.

### 1.8 Implementation steps

1. Add optional `p`/`t` to `Point` and its schema; add rounding and simplification helpers with tests.
2. Add `perfect-freehand`; replace `StrokeShape` with outline rendering; tune `BRUSH`.
3. Switch capture to coalesced events, ref-based live stroke and `requestAnimationFrame`.
4. Add palm rejection, undo shortcuts, guide grid and its setting.
5. Update the drawing e2e spec; add WebKit.
6. Review on a physical phone and a tablet with a pen. This step cannot be replaced by Chromium automation.

### 1.9 Apple Pencil on iPad (follow-up after device testing)

**Reported on 2026-11-14:** writing 年 on an iPad with an Apple Pencil Pro produces thin strokes whose width wobbles along their length. The edges look beaded rather than smooth, and the line follows small tremors of the hand. The same brush looks smooth with a mouse in desktop Chromium. Only Chromium was tested when the brush shipped, and section 1.8 step 6 (a physical tablet with a pen) was never done.

#### Status (2026-11-14): first fix done, device check pending

Twelve recordings of 氷, 年, 書 and 日 were made on the iPad with the Pencil Pro (`tests/browser-fixture/pencil-recorder.html`). They are kept as a compact fixture in `tests/fixtures/pencil-traces.json`. What they showed:

- **iPad Safari provides no coalesced events.** It delivers one sample per frame, about 60 Hz, and about half of those samples have not moved. Predicted events _are_ available.
- **Pencil pressure is low:** the median is 0.2 and 95% of samples are below 0.5.
- **Every pen lift reports pressure 0**, plus an occasional mid-stroke sample. The old code treated those as mouse input, which made stroke ends heavier.

What was changed:

- Stroke building moved to `src/components/stroke-input.ts`. It uses one pressure model per stroke, holds the width on zero-pressure samples, smooths by time, and maps pressure through a curve fitted to the recordings.
- Before the outline is built, `src/components/brush.ts` smooths each stroke with a centripetal Catmull–Rom spline, resamples it evenly, and averages pressure along it.
- The live stroke includes predicted points for one frame.
- The Safari CSS from item 6 was added.

Results on the recordings:

- Edge ripples dropped from 23 to 14 per 1,000 units of outline. A test fails if this rises above 16.
- A pen lift never changes the width, which is also tested.

Still to do:

- Confirm the result on the iPad itself.
- Plan items 6 (a separate pen brush preset with a stored device field), 9 (hover and tilt) and the WebKit replay project. Item 6 turned out not to be needed for this fix.

#### Likely causes in the current code

These are inferences from the code and the screenshot, to be confirmed with recorded Pencil data (step 1 below):

1. **Pressure goes to the brush almost raw.** `nextPressure()` in `src/components/brush.ts` moves 60% of the way to the new pen pressure on _every sample_. The Pencil reports up to 240 samples a second, and once coalesced events are read that is effectively no smoothing. Small pressure changes then become width changes, and `thinning: 0.62` amplifies them, which matches the beaded edges.
2. **Two pressure models can mix within one stroke.** `penPressure()` in `DrawingPad.tsx` returns `null` whenever a sample reports a pressure of 0. That sample then falls back to the _speed_-based model meant for a mouse, and the next sample switches back. If Safari reports 0 for some coalesced or edge samples, the width jumps between the two models. This needs checking against a trace.
3. **The pressure range doesn't fit how people write.** Ordinary handwriting with a Pencil mostly produces pressures of about 0.1–0.4, and the brush treats that as light. That explains why the strokes are thin. A response curve should map the normal writing range onto the full brush range.
4. **Point spacing is much finer than the brush.** Samples closer than 0.004 of the pad are dropped (4 units in a 1000-unit box), but the brush is 36 units wide. Dense points carrying slightly different pressures produce a scalloped outline even after `perfect-freehand` smooths it.
5. **One tuning is used for every device.** `streamline`, `smoothing` and `thinning` were tuned with a mouse. A fast, precise, pressure-sensitive pen wants different values from a finger or a mouse.
6. **Safari-specific CSS is missing.** The pad sets `user-select: none`, but Safari also needs `-webkit-user-select: none`. `-webkit-touch-callout: none` is not set either, so a long press can bring up the selection loupe or callout.

#### Plan

1. **Record before tuning.** Add a development-only "record raw input" switch to the drawing fixture (`tests/browser-fixture/`). It saves every raw sample, coalesced and predicted, with `pointerType`, `pressure`, `tiltX`/`tiltY`, `altitudeAngle`/`azimuthAngle` where present, and `timeStamp`, as JSON. Record a few kanji on the iPad with the Pencil Pro, plus an older Pencil if available. These traces become test fixtures, so every later change is measured against real Pencil data instead of guessed at. The recorder must not ship in `dist/`, which already holds for the fixture.
2. **One pressure model per stroke.** Decide at `pointerdown`: if the pointer is a pen and reports pressure, the whole stroke uses pen pressure; otherwise the whole stroke uses speed. A pen sample with pressure 0 keeps the previous pressure instead of switching models.
3. **Smooth by time, not per sample.** Replace the per-sample easing with a filter based on elapsed time. A one-euro filter is the usual choice for pointer input: it smooths strongly when the pen moves slowly and lags little when it moves fast. Apply it to pressure and, more lightly, to position. Smoothing per sample behaves differently at 60, 120 and 240 Hz; smoothing by time does not.
4. **Pressure response curve.** Map raw pen pressure through a calibrated curve, for example a dead zone below 0.03, then a gamma curve that puts typical writing pressure at about the middle of the brush range. Fit the curve to the recorded traces, not to a guess.
5. **Resample before rendering.** Keep the stored points as they are, but before building the outline, resample each stroke at an even spacing tied to brush size (about a quarter of the diameter) and average pressure over each interval. This removes scallops without discarding any input.
6. **A brush preset per input type.** Use separate `BRUSH` values for pen, touch and mouse: for the pen, a lower `thinning` (about 0.4), a higher `smoothing` and a lighter `streamline`, since the Pencil is already precise. Rendering needs to know which device drew a stroke, so store it with the stroke. Add an optional field on the stroke's first point, for example `d: 'pen'`, which keeps the persisted schema backward compatible; old strokes render with the current preset.
7. **Safari CSS and gestures.** Add `-webkit-user-select: none` and `-webkit-touch-callout: none` to `.drawing-surface`. Confirm on the device that `touch-action: none` stops page panning and double-tap zoom for Pencil input, and that iPadOS Scribble does not intercept the pad.
8. **Latency.** Draw the live stroke from coalesced samples, as now. Where `getPredictedEvents()` exists, draw predicted points for the current frame only and replace them on the next one. Detect the feature at runtime, since Safari support should be verified on the device.
9. **Pencil Pro extras that the web can use.**
   - _Hover:_ M2 and later iPads report the Pencil's position before it touches the screen, as pointer movement with no buttons pressed. A faint dot showing where the stroke will start helps with placement.
   - _Tilt:_ `altitudeAngle` and `azimuthAngle` (or `tiltX`/`tiltY`) can widen the brush slightly when the pen is held at a low angle, as a real brush would. Make it subtle, and optional.
   - _Not possible on the web:_ squeeze, barrel roll and double-tap are not delivered to web pages, so "squeeze to undo" would need a native app wrapper (for example Capacitor with PencilKit). That is out of scope.

#### How to know it is fixed

Make "smooth" measurable, using the recorded traces in unit tests:

- **Width stability.** On a steady part of a stroke, the outline's width should vary by less than about 10% between neighbouring samples. Compute it from the outline, perpendicular to the path.
- **Edge smoothness.** The turning angle between consecutive outline segments should stay below a threshold away from corners and tapers. This catches beading.
- **No model switching.** A pen trace that includes zero-pressure samples produces a single, continuous pressure curve.
- **Device check.** On the iPad with the Pencil Pro, write 永, 年 and 書 at normal speed, then fast. Strokes look even-edged, with width following pressure smoothly. Repeat on a phone with a finger and on a desktop with a mouse, to confirm nothing regressed there.
- **Automated browser coverage.** Add a Playwright WebKit project that replays the recorded traces into the pad as synthetic pointer events, asserting the stored points and rendered paths. This is not a substitute for the device check, but it catches regressions in the pipeline.

---

## 2. Automatic checking of the drawn kanji

### 2.1 The problem is verification, not recognition

The app already knows which character was asked for. It does not need to recognise an arbitrary kanji out of thousands; it only needs to decide whether the strokes match **one known target**. That makes a geometric comparison against reference strokes sufficient, and it has three advantages over a neural recogniser: it runs offline with no model download, it is deterministic and testable, and it can say **what** was wrong (missing stroke, wrong order, wrong direction), not only that something was.

### 2.2 Reference data: KanjiVG

[KanjiVG](https://kanjivg.tagaini.net/) provides, for each kanji, one SVG with every stroke as a separate path, in the correct stroke order and direction, in a 109 × 109 box, drawn in textbook (教科書体) handwriting shapes. It also groups strokes into components and labels each stroke's type.

- Licence: **CC BY-SA 3.0** (Ulrich Apel). It must be attributed on the Sources page and in `DATA_SOURCES.md`, alongside KANJIDIC2, with its own licence copy in `public/licenses/`. Confirm the exact attribution wording against the project's current licence page when importing.
- Files are named by code point (for 日, `065e5.svg`). Use the base file, not the style variants.

**Build pipeline**, following the existing KANJIDIC2 pattern (`scripts/fetch-kanjivg.ts`, `scripts/import-kanjivg.ts`, extended `validate-catalog.ts`):

1. Download a pinned KanjiVG release into `data/raw/`; record URL, date and SHA-256 in the manifest.
2. For each of the 2,136 catalog entries, parse the stroke paths and sample each along its length into a polyline.
3. Normalise to 0–1, simplify, and quantise to integers 0–255.
4. Emit compact JSON: per kanji, an array of strokes, each a flat array of coordinates.
5. Validate: every catalog ID is present, and the stroke count equals `strokeCount` from KANJIDIC2. List any disagreements for manual review instead of failing silently; a small number of characters have legitimately different counts between sources.

**Size.** The catalog has 22,359 strokes in total (maximum 29 in one character). At about 6 points per simplified stroke, the data is roughly 300 kB before compression. Do not put it in the main bundle: split it into files of about 100 kanji in `public/strokes/` and fetch the one needed when a prompt opens (and prefetch the files for the rest of the session queue).

### 2.3 Matching algorithm

A pure module, `src/recognition/`, with no React or storage dependencies.

**Step 1 — Normalise the whole drawing.** Compute the bounding box of all user strokes and of all reference strokes. Scale each uniformly by its longer side and centre it. Uniform scaling matters: 一 must not be stretched into a square. This makes the check independent of where and how large the user wrote.

**Step 2 — Resample each stroke** to a fixed number of points (16 is enough) evenly spaced along its length.

**Step 3 — Cost between one user stroke and one reference stroke.** A weighted sum of:

- mean distance between corresponding points (shape and position together);
- distance between start points and between end points (weighted extra, because start/end position is what distinguishes many strokes);
- length ratio;
- the same mean distance with the user stroke reversed. If the reversed cost is much lower, the stroke is right but was drawn in the wrong direction.

**Step 4 — Assign strokes.** Build the cost matrix of user strokes against reference strokes and compute two totals:

- **in order**: user stroke _i_ against reference stroke _i_;
- **best assignment**: minimum-cost one-to-one matching (Hungarian algorithm; at most 29 × 29, so it takes microseconds).

**Step 5 — Handle count mismatches.** If the user has fewer strokes, test whether one user stroke matches two consecutive reference strokes joined end to end (a common habit in fast handwriting). If more, test the reverse. Anything left unmatched is reported as a missing or extra stroke.

**Step 6 — Check against look-alikes.** Score the same drawing against every other kanji with the same stroke count (±1). That is at most a few hundred comparisons and still takes well under a frame. The target must win, and win by a margin. This is what separates 未 from 末, 土 from 士 and 千 from 干, where the only difference is the relative length of two strokes and a plain threshold on the target alone would accept both.

**Step 7 — Verdict.**

| Verdict           | Condition                                                      | Message to the user                                    |
| ----------------- | -------------------------------------------------------------- | ------------------------------------------------------ |
| `match`           | In-order cost under threshold; target wins the look-alike test | "Shape and stroke order match."                        |
| `match-order`     | Best assignment passes, in-order does not                      | "Right shape; strokes 3 and 4 are in the wrong order." |
| `match-direction` | Passes only with one or more strokes reversed                  | "Right shape; stroke 2 is drawn backwards."            |
| `count`           | Unmatched strokes remain                                       | "One stroke is missing." / "One extra stroke."         |
| `lookalike`       | Another kanji scores better                                    | "This looks more like 末."                             |
| `mismatch`        | Nothing passes                                                 | "This does not match."                                 |
| `unavailable`     | Stroke data failed to load, or paper mode                      | Fall back to today's self-grading, silently            |

Along with the verdict, return per-stroke results so the feedback screen can colour each user stroke (matched, misplaced, extra) and draw missing reference strokes as ghosts. This is where the checker becomes a teaching tool and not only a judge.

### 2.4 Calibration and tests

The reference data can test the checker against itself, with no human samples needed to start:

- **Must accept:** each kanji's reference strokes with random jitter, a global offset, scale change and a slight rotation applied. Run all 2,136.
- **Must reject:** each kanji's reference strokes checked against every other kanji with the same stroke count. This also **produces the confusable list automatically**: any pair that passes is either a threshold problem or a genuine look-alike that needs the margin rule.
- **Order and direction:** shuffle or reverse reference strokes and assert the specific verdict.
- **Real handwriting:** add an opt-in, local-only "save this drawing as a test sample" action in a development build, and collect a few hundred real attempts with their self-grades. Tune thresholds until disagreement with self-grades is low, and bias the thresholds towards **leniency**: a false "wrong" is far more damaging to trust than a false "right".

Make strictness a setting with three levels (lenient, standard, strict), and a separate switch for whether stroke order counts.

### 2.5 How it fits the product

The architecture is built on honest self-grading, and lists this feature as "optional handwriting recognition with user override". The design below keeps that:

- The checker runs when the user presses **Compare answer**, on the frozen strokes. It never runs during the prompt, so it cannot leak the answer.
- The feedback screen shows the verdict above the grade buttons and pre-selects a grade: `match` suggests **Got it** (the user can still pick **Barely** — hesitation is something only they know); `match-order` and `match-direction` suggest **Barely**; everything else suggests **Missed it**.
- **The user's click is still what is recorded.** They may override in either direction. The existing rule that assisted attempts are forced to a miss is unchanged and still enforced in the service.
- Record on `ReviewEvent`: `checkerVerdict`, `checkerVersion`, and whether the final grade differed from the suggestion. This is an optional field, so stored events remain valid; the backup schema gains the same optional fields (a version 1-compatible addition, or version 2 if strictness is preferred). The override rate is the best ongoing measure of checker quality.
- Paper mode is unaffected.
- Replace the line "The app cannot judge your handwriting" in `FeedbackPanel.tsx` and update the limits stated in `README.md` and `ARCHITECTURE.md`.

**Decision needed from you:** whether a `mismatch` verdict should be overridable to **Got it** freely, or only after an explicit "The checker is wrong" confirmation. I recommend the confirmation step: it keeps the override available while making an inflated grade a deliberate act.

### 2.6 Further uses of the same data

Once the stroke data is in place, three smaller features cost little:

1. **Guided repair.** In the repair phase, check each stroke as it is drawn against the next expected reference stroke, and show the ghost of that stroke after two failed tries. This is the same cost function applied to one stroke at a time.
2. **Stroke-order animation** on the introduction and character pages, by drawing the reference paths in sequence.
3. **Handwritten reference glyph and overlay.** Render the answer from the stroke data, so the model shown is a handwriting shape and can be overlaid on the attempt (see 1.6).

### 2.7 Alternatives considered

| Option                                                               | Why not                                                                                                                             |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Neural recogniser in the browser (CNN via ONNX Runtime Web or TF.js) | Several megabytes of model and runtime, needs training data and a training pipeline, and gives a label without explaining the error |
| Browser Handwriting Recognition API                                  | Chromium-only and dependent on the operating system; absent on iOS Safari, the main pen platform                                    |
| Online recognition service                                           | Breaks the no-backend, works-offline promise and sends user drawings to a third party                                               |
| Bitmap comparison of rendered images                                 | Ignores stroke order and direction; sensitive to stroke thickness, which the new brush makes variable                               |
| Stroke count only                                                    | Worth shipping as the very first step (the data is already in the catalog), but it accepts any drawing with the right count         |

### 2.8 Implementation steps

1. KanjiVG fetch/import/validate scripts, manifest entries, licence files, Sources page.
2. `src/recognition/`: normalise, resample, cost, assignment, verdict; unit tests on synthetic data.
3. Full-catalog self-test script (accept/reject matrix); tune thresholds; generate the confusable list.
4. Lazy stroke-data loader with session prefetch and the `unavailable` fallback.
5. Feedback screen: verdict, per-stroke colouring, suggested grade, override flow.
6. Event and backup schema fields; settings for strictness and stroke order.
7. Real-handwriting sample collection and a second tuning pass.
8. Guided repair, animation and overlay as follow-ups.

---

## 3. Other improvements

> **Implemented** (2026-11-14), with these differences from the items below:
>
> - **3.1:** `.github/workflows/ci.yml` runs the release gate on every push and pull request. WebKit runs the drawing, practice, checker and keyboard specs; five tests stay Chromium-only (three synthesize touch and pen input through the Chrome DevTools Protocol, two rely on Tab reaching buttons, which macOS WebKit skips by default).
> - **3.2:** The catalog, teaching notes, component hints and look-alikes load as one chunk in parallel with database startup, and are not schema-validated at runtime. There is no runtime SHA-256 comparison: Web Crypto's digest needs a secure context, which the LAN dev setup lacks, and the build already checks the hashes. The main script is still about 680 kB (React, router, Zod, Dexie), so Vite's chunk-size warning remains. WOFF2-only fonts come from a small Vite plugin; the build went from 10 MB to 6.6 MB.
> - **3.3:** Persistent storage is requested when the learner enters the Dojo for the first time, and Settings shows the result with a button to ask again. The Dojo shows the last backup date and suggests a backup after 50 scheduled reviews; that bookkeeping lives in the device-local `meta` table, not in backups. A restored backup counts as backed up at its export time. The service worker is hand-written and generated by a Vite plugin (`vite-plugins.ts`) instead of `vite-plugin-pwa`, to avoid the Workbox dependency tree. It is untested on real iOS/Android installs.
> - **3.4:** Component hints are generated for 1,940 of 2,136 characters. A part is named by its Jōyō meaning or a built-in component name, otherwise by its stroke count; the names are not reviewed. The hint ladder now puts stroke count before the component hint. The three cue pairs have prompt overrides, drafted by Claude Code and marked as awaiting maintainer review; the change alters the dataset version. The answer is drawn from KanjiVG strokes (not Klee One), so no new font is shipped.
> - **3.5:** The light palette has a manual override in Settings (stored per device in `localStorage`). Contrast drills are an extra session of up to 10 learned look-alike pairs; the look-alike list (594 characters) comes from pairs whose reference shapes pass the checker as each other, not from the self-test's "wrongly accepted" output, which the look-alike margin hides.

### 3.1 Project hygiene

- **The folder is not a git repository.** There is a `.gitignore` but no history. Run `git init` and commit before any of the work above; both features touch tested code and need a baseline to compare against.
- **No continuous integration.** Add a workflow that runs the documented release gate: `npm ci`, `npm run check`, `npm run build`, `npm run test:e2e`.
- **End-to-end tests run on Chromium only.** Add WebKit at least for drawing and practice flows.

### 3.2 Load time and size

- **The main script is 1.06 MB**, because the 726 kB catalog JSON is imported statically in `src/services/catalog.ts`, and all 2,136 entries are then validated with Zod on every start. Load the catalog as a separate fetched asset (or a dynamic import), show the shell first, and skip full runtime validation: the build already verifies the file and its SHA-256. A manifest hash comparison at runtime is enough.
- **Fonts ship twice.** `dist/assets` holds 124 `.woff` and 124 `.woff2` files (most of the 7.9 MB build). Every browser this app supports reads WOFF2; importing a WOFF2-only stylesheet halves the deployed size. They are fetched on demand by Unicode range, so this affects hosting size more than load time.

### 3.3 Data safety

- **Persistent storage is never requested.** The README warns that the browser may evict IndexedDB, but nothing calls `navigator.storage.persist()`. Request it after onboarding and show the result in Settings.
- **Backup reminders.** Show the date of the last export on the home page and prompt after a set number of reviews without one.
- **Installable, offline-capable build.** Already on the roadmap. `vite-plugin-pwa` with a precache of the app shell would deliver offline cold starts; stroke-data files from section 2 should be cached at runtime as they are fetched.

### 3.4 Learning content

- **`teaching-notes.json` is empty.** So the hint ladder for every character is "stroke count", then the full answer. KanjiVG's component grouping can generate a component hint for every character automatically ("left: water; right: 3 strokes"), with the existing leak check in `prompts.ts` guarding against revealing the target.
- **Three pairs of characters have identical meaning cues**: 砂/沙 ("sand"), 捕/捉 ("catch, capture"), 嫉/妬 ("jealous, envy"). Reading cues separate them, but add prompt overrides, and add a duplicate-cue check to `validate-catalog.ts` so new collisions fail the build.
- **The answer is shown in Noto Sans JP**, a print (gothic) design. Several characters are written by hand differently from their print form (令, 心, 糸, 北, 入 and others). For a writing app, show the answer in a textbook-style face — Klee One (SIL OFL) or the KanjiVG shapes from section 2.6.

### 3.5 Practice experience

- **No keyboard shortcuts.** Add `1`/`2`/`3` for the grades, `Enter` for Compare/Continue, `H` for a hint. Desktop paper-mode users grade many cards in a row.
- **Dark theme only.** `tokens.css` defines one palette. Add a light palette under `prefers-color-scheme` with a manual override.
- **Confusable drills.** The look-alike list produced in 2.4 is exactly the input needed for the "contrast drills for 未 and 末" item on the roadmap.

---

## 4. Decks: the standard Jōyō deck and custom decks

> **Implemented.** Differences from the plan below:
>
> - **Backup validation (4.9)** does not require every card's character to be in the catalog or a deck. Deleting a deck leaves its cards (4.8), and a backup made afterwards must still import. The import preview reports the number of such cards instead.
> - **Picking from the Standard deck (4.5, way 3)** is an "Add to deck" control on a character's page. It adds one character directly, without the preview screen.
> - **Not built:** the optional per-deck daily new limit (4.3, 4.8) and hiding the Standard deck from the switcher (4.12). The global daily limit applies to every deck.
> - The full KanjiVG set is 6,703 characters in 64 shards of about 13 kB gzipped each.

### 4.1 Goal

- The 2,136 Jōyō kanji become the **Standard deck**. It is always present and cannot be deleted, renamed or edited.
- Learners can **create their own decks** and practise with one deck at a time: sessions, new-character introductions, due reviews and the Collection are limited to the active deck.
- When characters are imported into a custom deck, **stroke order is added automatically**. Meanings, readings and notes are whatever the learner provides.
- A character the app has no stroke data for is **still accepted**. It has no stroke-order guide and no automatic check: the learner grades it themselves, and the app warns clearly that the character is not recognized.

### 4.2 What the current code assumes

The work is mostly about removing assumptions that there is exactly one fixed catalog:

| Assumption                                                    | Where                                                                       |
| ------------------------------------------------------------- | --------------------------------------------------------------------------- |
| The catalog has exactly 2,136 entries, validated at startup   | `src/services/catalog.ts` (`JOYO_COUNT`), `scripts/catalog-pipeline.ts`     |
| Every card's `kanjiId` exists in that catalog                 | Session service, review service, backup import (catalog-ID validation)      |
| One `datasetVersion` describes all content; sessions pin it   | `SessionRecord.datasetVersion`, `ReviewEvent.datasetVersion`, backup header |
| New characters are introduced in catalog curriculum order     | `src/domain/queue.ts`                                                       |
| Reference strokes exist only for the 2,136 catalog characters | `src/data/strokes.generated.json`, `scripts/import-kanjivg.ts`              |
| The Collection lists and searches the bundled catalog         | `src/features/collection/`                                                  |

### 4.3 Data model

New IndexedDB tables (Dexie schema version 2, with a migration that leaves existing progress untouched):

- **`decks`**: `id`, `name`, `kind` (`standard` | `custom`), `createdAt`, `updatedAt`, `revision`, `order` (curriculum order for new introductions: as imported, by stroke count, or shuffled), and an optional per-deck daily new limit. The standard deck is not stored as editable data; it is a fixed record with the ID `standard` that every service treats as read-only.
- **`deckEntries`**: one row per character in a custom deck: `deckId`, `literal`, `meanings[]`, `readingCues[]`, optional `note` and `mnemonic`, `position`, and `strokeStatus` (`available` | `unrecognized`). Custom entries live in IndexedDB, not in the bundle.

Keep **one card per character, shared across decks** (`kanjiId` stays derived from the code point, as today). A deck decides _which_ cards a session uses and _what the prompt says_; it does not create a second schedule for the same character. So learning 日 in a custom deck also counts in the Standard deck, and progress is never duplicated or lost when a deck is deleted.

- Prompt text comes from the active deck's entry. For the Standard deck that is the KANJIDIC2 data, as now.
- Settings gain `activeDeckId` (default `standard`). Sessions record the `deckId` and that deck's `revision` when they start.

Two alternatives were considered and not recommended:

- **Separate cards per deck.** This would let the same character have independent schedules, but it splits history and makes the shared Collection confusing.
- **Copying custom entries into the bundled catalog format.** The catalog is a validated, hashed build artefact, and user data does not belong in it.

### 4.4 Protecting the Standard deck

- **Services, not just buttons, enforce it.** Any create, update or delete targeting `standard` is rejected in the deck service, so it holds even if the interface has a bug.
- **No edit controls** are shown for the Standard deck. Instead it offers **"Copy to a new deck"**, which creates a custom deck with the same characters and their dictionary meanings. The learner can then edit that copy freely.
- **The Standard deck cannot be emptied or replaced** by import, and backup import never modifies it.

### 4.5 Creating and importing a custom deck

Three ways to add characters, all ending in the same preview screen:

1. **Paste characters**, such as `猫犬鳥` or one per line. Each character becomes an entry with no cues yet.
2. **Import a file**: CSV or TSV with a header row (`kanji`, `meanings`, `readings`, `note`). Multiple meanings or readings are separated with `;`. A JSON format mirroring the deck export is also accepted, so decks can be shared.
3. **Pick from the Standard deck** in the Collection, which pre-fills dictionary meanings that the learner can change.

The import preview shows a table:

- one row per character, with its stroke status;
- characters already in the deck (duplicates are merged, not added twice);
- rows that cannot be used, such as an empty row or more than one character in the `kanji` field;
- unrecognized characters, highlighted with a warning (see 4.7).

The learner confirms, and the import is written in one transaction. Input rules:

- **One character per entry.** Text is normalized to NFC, and variation selectors (U+FE00–FE0F, U+E0100–E01EF) are removed before lookup. A multi-character word is rejected with a clear message rather than guessed at.
- **At least one cue is required to practise an entry.** Recall prompts show a meaning or a reading, never the character itself. An entry with neither can still be saved, but it is listed as "needs a meaning or reading" and skipped by sessions until it has one. The existing leak check in `src/domain/prompts.ts` also applies to user text: a cue that contains the character itself is rejected.
- **Limits.** A maximum of 5,000 entries per deck and 50 decks, with a 5 MiB import file. This is the same defensive style as the existing 25 MiB backup limit.

### 4.6 Automatic stroke order for imported characters

Today the stroke data covers only the 2,136 Jōyō characters. KanjiVG has about **6,600 CJK characters**: measured with the existing encoder, that is 1.57 MB (772 kB gzipped) for the full set.

- **Bundle the full KanjiVG set, split into shards** by code point (for example 64 files of about 12 kB gzipped each), generated by an extended `scripts/import-kanjivg.ts`. The current Jōyō file stays as it is, so the default experience downloads nothing extra.
- **On import**, look up every character and fetch only the shards it needs. Record `strokeStatus: 'available'` and derive the stroke count from the data. Keep the stroke data itself in the shards rather than copying it into IndexedDB, so a stroke-data update reaches existing decks automatically.
- **During practice**, the stroke-order guide, the overlay and the checker use the same `ReferenceStrokes` interface they use today, fed from the shard instead of the Jōyō file. The look-alike comparison in the checker uses the Jōyō set plus the active deck's characters, so it stays fast.
- **Once fetched**, shards are cached by the browser. With the PWA milestone (3.3), they should be cached for offline use as well.
- **Licensing.** The full set remains CC BY-SA 3.0 KanjiVG data. The Sources page and `DATA_SOURCES.md` already credit KanjiVG; extend the text to say the extract covers about 6,600 characters.

### 4.7 Characters that are not recognized

A character counts as **unrecognized** when KanjiVG has no data for it. Examples are rare or historical characters, characters from other CJK scripts, and symbols.

- **The import keeps it.** In the preview it shows a warning: "Not recognized: stroke order and automatic checking are not available for this character. You will grade your drawings yourself."
- **In the deck list** it carries a warning badge, and the deck shows a count, such as "3 characters without stroke data".
- **On the introduction and character pages** the stroke-order section is replaced by the same warning. The current "stroke order unavailable" text in `src/components/StrokeOrder.tsx` becomes this warning.
- **On the feedback screen** there is no verdict, overlay or suggested grade. A warning explains that the character is not recognized, and the grade buttons work exactly as they do for paper attempts. `checkDrawing()` already returns `null` when no reference exists, so this path needs interface text, not new checking logic.
- **The review event records nothing** in `checkerVerdict`, so statistics keep these attempts separate from checked ones.
- **If a later KanjiVG update adds the character,** re-running the lookup (on app start, or from a "Check again" button) upgrades the entry to `available`.

### 4.8 Practice, Collection and settings

- **Deck switcher** on the home page and in Settings. The active deck name is shown in the practice toolbar, so it is always clear what is being studied.
- **Sessions** select due cards and new introductions only from the active deck's characters. A card due in another deck is not shown, but it stays due and appears when that deck is active again.
- **Daily new limit.** One global limit is simpler; a per-deck override is optional and stored on the deck.
- **Deck changes during a session.** A deck cannot be edited or deleted while it has an active session. This is the same rule the app already applies to backup import.
- **Collection** gets a deck filter, defaulting to the active deck. Character pages show which decks contain the character.
- **Deleting a custom deck** removes the deck and its entries. Cards and their history remain, because they are shared. They still appear under the Standard deck if the character is Jōyō, and under "Characters not in any deck" otherwise.

### 4.9 Backup and sharing

- **Backup format version 2** adds `decks` and `deckEntries`. Version 1 files still import, into the Standard deck only.
- **Backup import validation** changes from "every card's character is in the catalog" to "every card's character is in the catalog or in a deck entry in the same backup".
- **Exporting a single deck** (entries only, no progress) as JSON or CSV makes it easy to share a deck with someone else. Importing such a file goes through the import preview in 4.5.

### 4.10 Tests

- **Deck service:** Standard-deck mutations are rejected; duplicates are merged; multi-character and empty rows are rejected; cue leak check; limits; deletion keeps cards and history.
- **Importer:** CSV/TSV/JSON parsing, NFC normalization and variation-selector stripping, and recognized versus unrecognized classification against a small KanjiVG fixture.
- **Sessions:** only active-deck characters appear; due cards from other decks stay due; entries without cues are skipped.
- **Interface:** the import preview warns about unrecognized characters; the feedback screen for an unrecognized character shows the warning and plain self-grading; the stroke-order section shows the warning.
- **Migration and backup:** a version 1 database migrates with all progress intact; a version 1 backup still imports; a version 2 backup round-trips.
- **Browser:** create a deck by pasting characters (one unrecognized), practise it, confirm the warning, grade, and see progress shared with the Standard deck.

### 4.11 Implementation steps

1. Dexie version 2 migration, deck and entry schemas, and a deck service with Standard-deck protection.
2. Catalog abstraction: a `ContentSource` that answers "entry for this character in this deck", replacing direct `catalog.byId` lookups in the session, queue and prompt code.
3. Sharded full-KanjiVG data, a shard loader, and stroke-status lookup.
4. Import parsing and the preview screen; the deck list, switcher and "Copy to a new deck".
5. Sessions and the Collection filtered by the active deck.
6. Unrecognized-character warnings across import, introduction, character page and feedback.
7. Backup version 2 and single-deck export.
8. Documentation (README, ARCHITECTURE, DATA_SOURCES) and the release gate.

### 4.12 Open questions

These are product decisions with a recommended default; none blocks starting step 1.

- **Should a custom deck be able to give a Jōyō character different meanings from the Standard deck?** Recommended: yes. The prompt uses the active deck's text, and the schedule stays shared.
- **Should learning in a custom deck count toward the Standard deck's progress?** Recommended: yes, as described in 4.3. The alternative, separate schedules per deck, is simpler to explain but duplicates work.
- **Should the Standard deck be hideable** for learners who only want their own decks? Recommended: allow hiding it from the switcher, but never deleting it.

---

## 5. Suggested order of work

Steps 1–6, step 7 except guided repair, and step 8 are done, along with all of section 3. Apple Pencil smoothing (1.9) is the next priority: the iPad with a Pencil is the main device for handwriting, and it currently draws worst there.

| Order | Work                                                                                     | Why here                                                          |
| ----- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 1     | `git init`, first commit, CI                                                             | Baseline before changing tested code                              |
| 2     | Brush drawing (section 1)                                                                | Self-contained; improves every session immediately                |
| 3     | KanjiVG pipeline and reference rendering (2.2, overlay, handwritten answer glyph)        | Useful on its own, and the prerequisite for the checker           |
| 4     | Checker core and full-catalog self-test (2.3, 2.4)                                       | Pure code; can be proven before any interface exists              |
| 5     | Checker in the feedback screen with override (2.5)                                       | The user-visible feature                                          |
| 6     | Catalog loading, WOFF2-only fonts, persistent storage, shortcuts (3.2, 3.3, 3.5) — done  | Small independent items; can be interleaved anywhere after step 1 |
| 7     | Guided repair, stroke-order animation, component hints, PWA — all but guided repair done | Build on the stroke data and the checker                          |
| 8     | Decks: Standard deck, custom decks, automatic stroke order (section 4) — done            | Needs the stroke data; touches storage, sessions and backups      |
| 9     | Apple Pencil smoothing on iPad (1.9) — do this next                                      | Main handwriting device; needs recorded Pencil traces first       |
