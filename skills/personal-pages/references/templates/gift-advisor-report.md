# Gift Advisor Report

Template ID: `gift-advisor-report`
Implementation: version `1`
Generator: `node skills/gift-advisor/scripts/generate-page.mjs --template gift-advisor-report --project-dir <space-owned-gift-project> --output <space-owned-gift-project>/derived/page --json`
Artifact marker: `personal-agent-page-template`
Publication: fail-closed artifact validation and persisted template provenance are required

Use this template when the user wants help deciding what gift to give, wants a budget-aware gift shortlist, or asks for a gift recommendation Page. Invoke `gift-advisor` before generation.

## Required discovery

Keep discovery in the main conversation. Ask one recipient-specific question at a time and use observable behavior rather than personality diagnosis. Normally learn the relationship, occasion, budget/currency, one or more routines or interests, the intended emotional effect, and meaningful exclusions. Unknown answers stay unknown and do not affect ranking.

Do not auto-delegate an ordinary “what should I give?” question as Page production. The main Agent should first use the skill to understand the recipient. Delegate deterministic Page generation only after the portrait and recommendation portfolio are sufficiently complete.

## Required project

Create a Space-owned project containing `gift-plan.json`. It must separate observed facts, cautious inferences, and unknowns; define two to four distinct strategies; and contain three to nine recommendations from distinct product families. Every recommendation carries a numeric in-budget price range, evidence, watch-outs, personalization, and an explicit comparison score.

Every recommendation must identify one current real product. Require the exact official or authoritative public HTTPS product page, a real HTTPS product image from that page, brand, model, merchant/publisher, visible listed price and currency, availability note, price note, and one shared check date. Every product page must have a matching source row. Never include a guessed product, URL, image, price, hidden reasoning, private transcript, credential, internal path, or sensitive inference.

## Fixed framework

- Recipient, relationship, occasion, budget, and gifting intent.
- Facts, cautious inferences, unknowns, and non-diagnostic disclaimer.
- Strategy overview and interactive strategy filters.
- Explainable recommendation cards with fit/price sorting.
- Detail toggles, shortlist selection and copy, theme switch, and print action.
- Delivery and presentation plan.
- Real product imagery, exact purchase links, listed prices, sources, and check notes on every recommendation.
- Responsive Web and mobile layouts.

## Security and acceptance

The Page is read-only. Its only remote loads are the exact verified HTTPS product images declared in the plan. Verified product links open in a separate tab. It loads no remote code, font, stylesheet, analytics, iframe, file URL, loopback API, Agent tool, or undeclared image origin.

Run schema, budget, portfolio diversity, product-page/image/source/date consistency, HTTPS, semantic HTML, CSP, privacy, remote-code, and deterministic-hash checks. Require template v1, the registered artifact marker, and `visualAcceptance: user`.

Normal template use does not open a browser, capture screenshots, or claim visual approval. Publish with `pa-cli pages publish --template gift-advisor-report`; require the Page manifest to contain the exact inspected contract digest and HTML SHA-256.
