# HTML Report Style

Use this contract for every Deep Research HTML deliverable. It adapts the editorial reporting system demonstrated by the Compass Loop TDD report without copying its dependencies or content.

## Required Structure

1. Open with a deep navy report hero containing the literal research topic, one-sentence research question, date, item count, source count, and language.
2. Use a warm paper canvas, white data surfaces, navy primary ink, restrained gold accents, and teal evidence/status accents.
3. Pair editorial serif headings with a system sans-serif body and monospace only for code or identifiers. Keep letter spacing at zero except tiny uppercase metadata.
4. Provide a sticky numbered desktop table of contents. Hide it cleanly on narrower screens.
5. Lead the article with three overview metrics, the core research questions, and a comparison table.
6. Give every research item a numbered section with its summary, all configured fields, confidence, direct evidence links, gaps, and source list.
7. End with an explicit limitations section and generation metadata.

## Interaction And Portability

- Include a thin scroll-progress indicator and active table-of-contents state.
- Keep the HTML self-contained. Do not use Tailwind, remote fonts, external JavaScript, a CDN, or assets borrowed from the reference page.
- Escape all research content. Only emit validated HTTP(S) source URLs, with `noopener noreferrer` on new tabs.
- Support mobile widths without horizontal page overflow; allow only wide tables or heatmaps to scroll inside their own container.
- Add print rules that preserve the hero color and avoid splitting tables, field blocks, or callouts when practical.
- Use cards only for metrics or true grouped artifacts, with a maximum 8px radius. Keep report sections unframed.

## Content Rules

- Make the topic the hero heading. Put explanation in the lede, not in a decorative subtitle.
- Prefer tables for exact comparison mappings and prose for synthesis.
- Use green for verified/high-confidence evidence, amber for partial evidence or gaps, and muted red only for low confidence or material risk.
- Never remove a configured field because it is awkward to display. Preserve the gap and confidence instead.
- Do not publish automatically. Hand the finished HTML to `open-agent-bridge` only when the user asks for a public or shareable URL.
