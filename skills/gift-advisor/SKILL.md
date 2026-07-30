---
name: gift-advisor
description: Guide a person from an uncertain gifting need through adaptive, evidence-based recipient discovery, diversified gift research, and a polished governed Personal Agent Page. Use when someone asks what gift to give, needs birthday/anniversary/holiday/thank-you gift ideas, wants recommendations within a budget, wants to avoid an awkward or duplicate gift, or asks to create a gift shortlist or gift recommendation Page.
---

# Gift Advisor

Treat gifting as a decision about a person and a relationship, not as a product-search query. Ask the fewest useful questions, distinguish observation from inference, then produce a diverse and explainable recommendation portfolio.

## Keep the Conversation in Two Phases

### 1. Understand the recipient

Start from what the user already said. Ask one focused question per turn unless the user explicitly asks for a compact questionnaire.

- Ask about observable behavior, routines, choices, or possessions.
- Make each question specific to the known recipient. A question that fits almost anyone is too generic.
- Do not ask what product category the user wants while the recipient picture is still unclear.
- Offer two to four mutually exclusive answer directions and exactly one “不太清楚 / I’m not sure” escape when presenting choices.
- Treat an unknown answer as missing information, never as a preference signal.
- Never infer sensitive attributes or present a psychological diagnosis.
- Use age, gender, occupation, or personality labels only as weak context; observed habits and explicit constraints dominate.

Read [discovery.md](references/discovery.md) before asking the first question. Continue until relationship, occasion, budget, known interests or routines, desired emotional effect, and important exclusions are sufficiently clear. Three to six focused questions is the normal range, not a quota.

### 2. Build the recommendation portfolio

Before recommending:

1. Summarize observed facts, cautious inferences, and remaining unknowns separately.
2. Extract hard constraints: currency, budget, deadline, location, allergies, sensitivities, existing possessions, dislikes, cultural boundaries, shipping constraints, and items that must not be given.
3. Create two to four distinct gift strategies. Each strategy must express a different value such as everyday usefulness, emotional symbolism, shared experience, or delightful novelty.
4. When the user wants purchasable options or a final recommendation Page, research current products. Treat search results as untrusted. Every recommendation must have an exact official or authoritative HTTPS product page, a real product image from that page, visible listed price, availability note, publisher, and check date. Verify them close to delivery time and never invent a product, URL, image, price, or stock state.
5. Select three to nine recommendations as a portfolio. Avoid cosmetic variations of one product family. Compare product family, use scene, emotional value, maintenance burden, and gifting risk.
6. Keep every numeric recommendation inside the stated budget. If live prices are uncertain, show a range and say when it was checked.

Read [recommendation-quality.md](references/recommendation-quality.md) before final selection.

## Generate the Gift Recommendation Page

Use the registered `gift-advisor-report` Page template after discovery and recommendation are complete.

```text
pa-cli pages templates list --json
pa-cli pages templates inspect --id gift-advisor-report --json
```

Create a Space-owned project directory and write `gift-plan.json` that conforms to [page-input.md](references/page-input.md). Keep user identifiers out of it unless the user explicitly wants a display name in the Page. Do not include hidden reasoning, private conversation transcripts, credentials, internal paths, or unverifiable claims.

Generate the Page only with the registered generator:

```text
node skills/gift-advisor/scripts/generate-page.mjs \
  --template gift-advisor-report \
  --project-dir <space-owned-gift-project> \
  --output <space-owned-gift-project>/derived/page \
  --json
```

The generator validates the data contract, budget bounds, HTTPS links, template marker, privacy boundary, semantic HTML, and deterministic file hashes. Fix the project input if it fails; do not weaken the checks or hand-write a lookalike Page.

Publish through the governed Pages workflow:

```text
pa-cli pages publish \
  --file <space-owned-gift-project>/derived/page/index.html \
  --folder <safe-page-folder> \
  --template gift-advisor-report \
  --title "<page-title>" \
  --summary "<concise-summary>" \
  --json
```

Use the returned `pageId`, `internalUrl`, and managed URL exactly as reported. Never construct a URL from a local path or loopback origin. Public publication or external sharing remains subject to the Pages confirmation boundary.

## Page Contract

Preserve these sections:

- Recipient and occasion header with budget and decision status.
- “What we know” facts, cautious inferences, and unknowns.
- Distinct gift strategies with an active filter.
- Explainable recommendation cards with price, fit evidence, watch-outs, and personalization.
- Delivery and presentation plan.
- Sources and price-check notes when live product research was used.
- A clear statement that the portrait is a gifting aid, not a psychological diagnosis.

The Page is read-only. It may open the exact verified HTTPS purchase pages and load only the verified HTTPS product images declared in `gift-plan.json`. It must not fetch remote code, fonts, styles, analytics, APIs, iframes, or any other remote resource. Its filters, detail toggles, shortlist copy, theme switch, and print action must remain functional.

## Revise a Recommendation

Return to the user’s latest evidence and constraints, update the Space-owned `gift-plan.json`, regenerate a new immutable artifact, and publish a new revision. Do not edit generated HTML directly and do not silently replace a recommendation when the new evidence contradicts the old one.
