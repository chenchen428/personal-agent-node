# Third-Party Skill Notices

The workspace skill tree includes adapted workflow ideas from the following MIT-licensed projects. Upstream repositories are audit inputs only; the workspace stores its own consolidated skills and CLI implementation.

## Deep-Research-skills

Source: https://github.com/Weizhena/Deep-Research-skills
Revision: `e5479f857f484cde13fe69d2f3ce8de7af193bc7`

MIT License

Copyright (c) 2026 Lan Zheng

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Channel runtime components

The production release may include these pinned, unmodified runtime components:

- sing-box `1.13.14`, source `https://github.com/SagerNet/sing-box`, GPL-3.0-or-later. Its license is shipped beside the binary.
- CloakBrowser Chromium `146.0.7680.177.5`, source `https://github.com/CloakHQ/CloakBrowser`, MIT.
- xiaohongshu-mcp PR #509 revision `0cf885c2d02745678ec6cc91b401d898373064e9`, source `https://github.com/xpzouying/xiaohongshu-mcp`. The pinned upstream revision declares no license (`NOASSERTION`); a checksum-pinned minimal source set is compiled locally into an external, unmodified private runtime, no upstream source is committed or shipped, and the resulting binary is used only by this private workspace.

## Desktop shell components

The platform release includes a compiled Tauri 2 desktop shell. Direct runtime dependencies are pinned in `core/desktop/src-tauri/Cargo.lock` and enumerated with their licenses in `SBOM.cdx.json`.

- Tauri `2.11.5`, source `https://github.com/tauri-apps/tauri`, Apache-2.0 OR MIT.
- Tauri single-instance plugin `2.4.3`, source `https://github.com/tauri-apps/plugins-workspace`, Apache-2.0 OR MIT.
- opener `0.8.5`, source `https://github.com/Seeneva/opener`, Apache-2.0 OR MIT.

The shell links to the operating system WebView runtime rather than redistributing Chromium, WebView2, WKWebView, or WebKitGTK inside the immutable Node payload.

## Guizang social card skill

Source: https://github.com/op7418/guizang-social-card-skill

Revision: `cf4b810fac1c73fb65a2bb31d8c9278d82cbc4c5`

License: GNU Affero General Public License v3.0 only

The complete corresponding Skill source, templates, references, scripts, license, and modification notice are distributed under `skills/guizang-social-card-skill/`.

## Guizang PPT skill

Source: https://github.com/op7418/guizang-ppt-skill

Revision: `82fe5ae129e8c2a12e1155fcabed6703342749d6`

License: GNU Affero General Public License v3.0 only

The complete corresponding Skill source, templates, references, scripts, license, and modification notice are distributed under `skills/guizang-ppt-skill/`.

## Travel Guidebook

Source: https://github.com/geekjourneyx/travel-guidebook

Revision: `e8ae3fe82eac448751b957cf84f42fb069de645c`

License: MIT

Copyright (c) 2026 GeekJourney

Personal Agent keeps the upstream license in `skills/travel-guidebook/LICENSE` and distributes an adapted Skill manifest, renderer, and essential references without upstream promotional assets.

## Anthropic frontend-design

Source: https://github.com/anthropics/skills

Revision: `9d2f1ae187231d8199c64b5b762e1bdf2244733d`

License: Apache License 2.0

The license and modification notice are distributed under `skills/frontend-design/`.

## UI/UX Pro Max

Source: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill

Revision: `f8ac5e1266dba8354ea96e19994d9f4345e7ec31`

License: MIT

Copyright (c) 2024 Next Level Builder

Personal Agent distributes the Skill's local search scripts and design data under `skills/ui-ux-pro-max/`, with Workspace-relative invocation paths.

## baoyu-skills

Source: https://github.com/JimLiu/baoyu-skills
Revision: `6b7a2e417500561a5ecdd0b168332f4142584617`

MIT License

Copyright (c) 2026 Jim Liu

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
