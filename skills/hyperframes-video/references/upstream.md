# Upstream provenance

- Repository: <https://github.com/heygen-com/hyperframes>
- Revision: `5244dde5f10c221221924985aa4651d89fb7c98a`
- License: Apache-2.0
- Audited: 2026-07-30
- Published CLI pin used by this adaptation: `hyperframes@0.7.82`

This skill adapts the upstream HyperFrames router, core authoring rules, animation guidance, CLI workflow, media rules, and product-launch-video workflow into one Personal Agent skill.

The following upstream capability groups are intentionally not exposed by the bundled wrapper:

- account authentication;
- public publishing;
- HeyGen Cloud, AWS Lambda, and Google Cloud Run rendering;
- feedback and telemetry management;
- transcription, text-to-speech, and background-removal generation.

Those capabilities require separate privacy, authorization, dependency, or external-write decisions and must not be inferred from a request to create or render a local video.
