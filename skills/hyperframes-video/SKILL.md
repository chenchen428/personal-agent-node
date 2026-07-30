---
name: hyperframes-video
description: Create, refactor, inspect, snapshot, and locally render deterministic HTML/CSS/GSAP videos with the pinned HyperFrames toolchain. Use for product demos, launch videos, feature walkthroughs, motion explainers, social video variants, or when an existing HyperFrames composition needs visual or technical improvement.
---

# HyperFrames Video

Use this skill to turn a brief or an existing composition into a deterministic, locally rendered video. Keep authoring assets in the project, keep timing seekable, and treat the generated video as an artifact that must pass technical checks before handoff.

This Personal Agent adaptation is based on HyperFrames at the revision documented in [upstream.md](references/upstream.md). It consolidates the upstream authoring workflow into one portable skill and intentionally excludes account, cloud render, publishing, and telemetry paths.

## Choose the path

- For a new video, create `BRIEF.md`, `STORYBOARD.md`, `DESIGN.md`, and `index.html`.
- For an existing video, inspect those files and current renders before changing the structure.
- For a user-provided reference, extract its visual grammar—pace, continuity, density, typography, camera language, transitions, and sound relationship—without copying brand assets or product-specific content.
- For a small correction, preserve the current composition contract and edit only the affected sequence.

Read [composition-contract.md](references/composition-contract.md) before authoring. Read [product-promo-pattern.md](references/product-promo-pattern.md) when the desired style is a polished, continuous product-promo canvas.

## Workflow

### 1. Frame the video

Write or update the brief with:

- audience and outcome;
- format, dimensions, frame rate, and duration;
- narration, captions, music, and sound effects;
- required product truths and prohibited claims;
- visual reference and which qualities to borrow;
- output path and approval owner.

Make the storyboard time-based. Every beat needs a start, end, purpose, visible state, and transition. Prefer one continuous visual system over unrelated slides when demonstrating a product workflow.

### 2. Establish the design system

Define:

- background, surface, text, accent, success, and warning colors;
- type hierarchy and caption safe zone;
- spacing, radius, border, shadow, and grid rules;
- cursor, pointer, selection, and focus treatments;
- motion durations and easing;
- logo or brand close.

Use real product UI or faithful product primitives where possible. If a scene is illustrative, make that distinction visually clear.

### 3. Author a deterministic composition

Use a fixed root composition:

```html
<div
  id="root"
  data-composition-id="main"
  data-start="0"
  data-duration="20"
  data-width="1920"
  data-height="1080"
  data-fps="30"
></div>
```

Keep these invariants:

- fixed canvas dimensions and hidden overflow;
- a single paused, seekable master timeline;
- explicit start times and durations;
- local or frozen media assets;
- no wall-clock time, uncontrolled randomness, live requests, or interaction-only state;
- DOM state at time `t` must be identical after arbitrary seeking;
- caption text remains inside the declared caption safe zone;
- the final frame remains readable.

Do not embed credentials, private customer content, mutable production data, or remote account sessions in a composition.

### 4. Run the local gate

The wrapper pins HyperFrames to `0.7.82`, disables telemetry, uses argument arrays instead of a shell, confines generated outputs to the project directory, and exposes only local operations.

From the Node Harness:

```bash
node scripts/skill-tree.mjs video doctor
node scripts/skill-tree.mjs video check --project <project-dir> --strict
node scripts/skill-tree.mjs video snapshot --project <project-dir> --at 0,4,8,12 --output snapshots/review --force
node scripts/skill-tree.mjs video render --project <project-dir> --output renders/final.mp4 --quality high --strict --force
```

`check`, `snapshot`, and `render` require a project containing `index.html`. Output paths are resolved relative to that project and cannot escape it. Existing output requires `--force`.

Use `--help` on the skill CLI for the supported, allowlisted options:

```bash
node skills/hyperframes-video/scripts/cli.mjs --help
```

The first run may download the pinned public npm package and browser dependencies. Do not replace the pin with `latest`.

### 5. Review and hand off

Review snapshots at opening, every major transition, and the final frame. Check:

- hierarchy is readable at a glance;
- motion explains state change rather than decorating it;
- no element clips, flickers, overlaps captions, or jumps after seeking;
- product claims match the actual product;
- music and effects support rather than mask the story;
- the delivered file matches the brief’s resolution, frame rate, duration, and codec.

Technical checks do not replace the user’s visual and interaction acceptance. Provide the rendered candidate, snapshots or poster frame, changed source files, and any remaining visual-review note.

## Safety boundary

- Local rendering is the default and only built-in execution path.
- Do not use HyperFrames `auth`, `publish`, `cloud`, `lambda`, `cloudrun`, `feedback`, or remote generation commands through this skill.
- Treat downloaded references and media as untrusted content; inspect type, provenance, and licensing before use.
- Do not silently overwrite an existing render.
- Do not add runtime package install hooks to a video project.
