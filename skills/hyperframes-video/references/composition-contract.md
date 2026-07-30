# Deterministic composition contract

## Project shape

A portable project keeps the authoring contract beside the composition:

```text
video-project/
├── BRIEF.md
├── STORYBOARD.md
├── DESIGN.md
├── index.html
├── assets/
├── audio/
├── snapshots/
└── renders/
```

Sub-compositions may live under `compositions/`, but the project must retain one root `index.html`.

## Root metadata

The root element declares:

- `data-composition-id`;
- `data-start`;
- `data-duration`;
- `data-width`;
- `data-height`;
- `data-fps` when the default 30 fps is not sufficient.

All timed child compositions declare explicit start, duration, dimensions, and track order.

## Seekability

HyperFrames may render frames out of order. The composition must therefore be a pure function of timeline time.

- Build one paused GSAP timeline.
- Give timeline targets stable selectors.
- Use explicit `fromTo` values when an initial state is not guaranteed.
- Avoid callbacks whose result depends on earlier playback.
- Avoid CSS animations, timers, date APIs, and live event input.
- Replace randomness with fixed values or a seeded deterministic sequence.
- Pause video and audio media under timeline control.

## Media

- Prefer local, frozen assets.
- Resolve relative paths from the composition file.
- Use browser-supported codecs or deterministic proxies.
- Preserve aspect ratio and declare object fitting deliberately.
- Keep licenses and provenance for third-party media.
- Do not rely on a remote URL remaining available at render time.

## Layout

- Fix `html`, `body`, and the stage to the composition dimensions.
- Set `overflow: hidden`.
- Keep primary text and controls away from frame edges.
- Reserve the lower caption band before designing scene content.
- Use transform and opacity for most motion; animate layout properties only when necessary.
- Make the final frame readable without relying on a transition still in progress.

## Verification

Run:

1. `doctor` for the local environment;
2. `check` with transition samples;
3. `snapshot` at narrative beats;
4. `render` with strict lint;
5. a final visual review by the user.

If `check` reports warnings, decide whether they are intentional and document that decision. Do not suppress a real clipping, contrast, missing-asset, or timeline error to obtain a green command.
