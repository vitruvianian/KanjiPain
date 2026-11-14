# KanjiPain — Proposed Improvements

Review date: 2026-11-14, against version 0.1.0 (all 13 build checkpoints complete).

This document has three parts:

1. [Brush-like drawing](#1-brush-like-drawing) — making the pad comfortable to write on.
2. [Automatic checking of the drawn kanji](#2-automatic-checking-of-the-drawn-kanji) — how to implement it.
3. [Other improvements](#3-other-improvements) — everything else found during the review.

A suggested order of work is at the [end](#4-suggested-order-of-work).

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

## 4. Suggested order of work

| Order | Work                                                                              | Why here                                                          |
| ----- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 1     | `git init`, first commit, CI                                                      | Baseline before changing tested code                              |
| 2     | Brush drawing (section 1)                                                         | Self-contained; improves every session immediately                |
| 3     | KanjiVG pipeline and reference rendering (2.2, overlay, handwritten answer glyph) | Useful on its own, and the prerequisite for the checker           |
| 4     | Checker core and full-catalog self-test (2.3, 2.4)                                | Pure code; can be proven before any interface exists              |
| 5     | Checker in the feedback screen with override (2.5)                                | The user-visible feature                                          |
| 6     | Catalog loading, WOFF2-only fonts, persistent storage, shortcuts (3.2, 3.3, 3.5)  | Small independent items; can be interleaved anywhere after step 1 |
| 7     | Guided repair, stroke-order animation, component hints, PWA                       | Build on the stroke data and the checker                          |
