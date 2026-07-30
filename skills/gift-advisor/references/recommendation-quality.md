# Recommendation Quality

## Portfolio rule

Build a portfolio, not a ranked pile of near-duplicates. Give each candidate a normalized product family and compare candidates across:

- product family;
- use scene;
- gifting value;
- maintenance and setup;
- personalization;
- social or cultural risk.

Keep one item per product family by default. Retain a second only when the use scene and gifting value are materially different, and explain why.

## Evidence rule

For every recommendation, record:

- the observed fact or explicit constraint it responds to;
- the cautious preference inference;
- the gifting implication;
- one concrete watch-out;
- one optional presentation or personalization idea.

Do not claim the recipient will love an item. Use calibrated language such as “更可能适合”, “与…一致”, or “需要先确认”.

## Product and price rule

- Never invent a brand, model, merchant, stock state, rating, price, or URL.
- Keep researched URLs on `https://` and link to the exact product or authoritative source when possible.
- For every Page recommendation, require an exact official or authoritative product page, a real product image sourced from that page, a visible listed price, availability note, merchant or publisher, and one shared check date.
- Record the listed currency and price separately from the decision-budget range. Explain exchange-rate, shipping, tax, accessory, or regional uncertainty in `priceNote`.
- When price, image, or availability cannot be verified, keep researching or remove the candidate; do not put it in the final purchasable Page.
- Apply the budget to the complete gift, including required accessories, personalization, packaging, and shipping when known.
- Reject a numeric recommendation outside the declared min/max instead of hiding the mismatch.

## Safety and sensitivity

Treat clothing sizes, skincare, fragrance, health products, food restrictions, pets, children, workplace hierarchy, and culturally sensitive occasions as higher-risk. State what must be confirmed before purchase. Avoid coercive, intimate, medical, or stigmatizing interpretations.

## Final check

The final set should:

- contain three to nine items;
- cover at least two distinct strategies;
- stay within budget;
- respect every exclusion;
- avoid duplicate families;
- provide a reason and a watch-out for every item;
- make uncertainty visible;
- provide a verified purchase link and real product image for every recommendation.
