---
name: home-renovation
description: Turn a home-renovation idea into a traceable brief, space and storage plan, budget and quote comparison, material decisions, visual-reference board, construction sequence, and acceptance checklist. Use for 装修、家装、旧房改造、全屋翻新、局部改造、户型优化、软装搭配、装修预算、报价对比、选材、施工计划、验收清单、装修避坑、mood board, interior-design references, or deciding what to ask a designer or contractor.
---

# Home Renovation

Convert an ambiguous renovation goal into staged decisions. Keep observed facts, assumptions, current sourced requirements, professional sign-off, and personal preferences visibly separate.

Generated plans belong under the customer Workspace, for example `projects/home-renovation-<slug>/`, or in the user's requested output directory. Never put customer addresses, floor plans, quotations, photos, or generated project files inside this Skill.

## Read The Relevant References

- Read [project brief](references/project-brief.md) for a whole-home or multi-room plan.
- Read [planning and budget](references/planning-and-budget.md) for phasing, schedules, quotations, or cost decisions.
- Read [materials and quality](references/materials-and-quality.md) for selection, substitutions, samples, and acceptance.
- Read [visual references](references/visual-references.md) for Pinterest, 小红书, Houzz, image search, mood boards, or style exploration.
- Read [safety and compliance](references/safety-and-compliance.md) whenever structural work, fire separation, electrical service, gas, plumbing, waterproofing, hazardous materials, permits, or building-management approval may be involved.

## Choose The Work Mode

| User need | Default output |
| --- | --- |
| Early ideas or an unclear scope | concise brief plus unknowns and next decisions |
| Whole-home or multi-room renovation | staged decision pack |
| Layout or storage question | measured constraints, options, and tradeoff table |
| Budget or quotation comparison | normalized scope and like-for-like comparison |
| Materials or product choice | requirement matrix, samples, evidence, and acceptance checks |
| Inspiration or style references | bounded, traceable candidate board |
| Active-site problem | observed symptom, immediate risk boundary, evidence request, and escalation path |

Do not force a complete project pack for one narrow question. Answer the immediate decision first, then identify only the next dependency that matters.

## 1. Establish The Decision Context

Capture what is already known and mark everything else as unknown:

- jurisdiction, property type, age, occupancy state, floor, and building-management constraints;
- measured area, available drawings, site photos, fixed structure, shafts, windows, doors, meters, and service entries;
- rooms and systems in scope, retained items, exclusions, and desired lifespan;
- total budget and whether appliances, furniture, design fees, tax, permits, temporary housing, and contingency are included;
- target dates, must-not-move dates, household routines, children, older adults, accessibility needs, pets, allergies, and maintenance tolerance;
- style words, disliked outcomes, reference images, and priority order among cost, quality, schedule, appearance, flexibility, and low maintenance.

Ask only for a missing fact that would materially change safety, cost, layout, or procurement. Otherwise proceed with a labeled assumption. Never invent measurements from an unscaled image or infer that a wall is non-structural from a floor plan alone.

## 2. Separate Evidence From Preference

Maintain four labels throughout the work:

- **Observed**: measured on site or visible in user-provided evidence.
- **Specified**: stated in a current official rule, approved drawing, contract, or manufacturer document.
- **Estimated**: a planning allowance that needs a quote, measurement, opening-up inspection, or professional calculation.
- **Preferred**: an aesthetic or lifestyle choice that can change without being presented as a requirement.

For current codes, permits, product specifications, prices, lead times, warranties, and contractor availability, browse and cite current primary sources. Use `$deep-research` when several systems, products, or quotations need structured comparison. Community posts may reveal practical failure modes but do not establish compliance or product performance.

## 3. Build Options Before Recommendations

For every material decision, present two or three feasible options with the same comparison fields:

```text
Option / solves / prerequisites / space effect / cost band / schedule effect /
maintenance / failure modes / evidence / reversibility / decision deadline
```

Test each option against the measured envelope, circulation, storage, lighting, ventilation, acoustics, cleaning access, repair access, and future replacement. Prefer a simpler option when the added complexity has no user-valued benefit.

Do not label a concept as construction-ready. Any dimension that controls fabrication, demolition, service capacity, waterproofing, or safety must be verified on site and, where applicable, approved by the responsible licensed professional or authority.

## 4. Keep Budget, Scope, And Schedule Coupled

Build a scope breakdown before comparing totals. Normalize quotations by quantity, unit, specification, included labor, preparatory work, finishing work, protection, waste removal, tax, warranty, exclusions, and change-order rules.

Keep three budgets visible:

1. base scope;
2. risk allowance tied to named uncertainties;
3. optional upgrades that can be removed without breaking the base design.

Tie procurement dates to measurement and approval gates. Do not order made-to-measure items from concept dimensions. Do not hide an over-budget plan by moving necessary work into an unlabeled “later” bucket.

## 5. Use Visual References As Decision Evidence

Treat reference images as communication aids, not buildable specifications or licensed project assets. Record the source page, retrieval date, room type, view role, relevant features, mismatches, and rights status when known.

Use an available authorized search or visible-browser capability only after confirming it exists. For Pinterest or another login-gated source, keep discovery bounded, stop at login/CAPTCHA/rate limits, never inspect cookies or hidden state, and never mass-download. If direct retrieval is unavailable, produce a query plan or work from user-confirmed links instead of pretending the images were collected.

Apply the workflow in [visual references](references/visual-references.md). A good board includes enough full-room context to judge layout plus supporting material or detail views. Popularity never overrides spatial relevance, realism, source traceability, or a hard quality rejection.

## 6. Sequence Decisions And Acceptance

Create stage gates appropriate to the scope:

1. survey and existing-condition record;
2. brief and scope freeze;
3. concept options;
4. measured design and engineering coordination;
5. quotation normalization and contract scope;
6. samples, mockups, and long-lead approval;
7. site preparation and concealed works;
8. hold-point inspections before covering;
9. finishes, fixtures, commissioning, and defect correction;
10. handover documents, warranties, maintenance, and final account.

For each gate, name the decision owner, required input, evidence, acceptance criterion, and consequence of proceeding early. Preserve photos and records for concealed work without exposing private location data outside the user's Workspace.

## Page Delivery

When the user requests a装修设计 Page, an interactive floor-plan delivery, SketchUp/SU presentation, or a visual home-design Page, hand the design model to `$interior-design` and publish through `$personal-pages`. The Page must use the registered `interior-design-delivery` generator with the redacted user floor plan; never recreate a similar-looking Page or substitute the configured template example.

Use deterministic scope, model, geometry, template-marker, and publication checks only. Do not open a browser, take screenshots, click through the result, or perform Agent-owned visual acceptance. Return the published Page and leave desktop, mobile, and interaction acceptance to the user.

## Safety Boundary

Do not provide a definitive structural, fire, electrical, gas, waterproofing, hazardous-material, or code-compliance approval. Stop and recommend isolation, emergency services, building management, the utility, or a qualified local professional when there is immediate danger, an unknown load-bearing element, exposed live wiring, gas odor, active flooding, significant cracking or movement, fire damage, suspected hazardous material, or another red flag described in [safety and compliance](references/safety-and-compliance.md).

Never tell the user to bypass permits, conceal work from an authority, disable a safety device, work live, disturb suspected hazardous material, or rely on an AI-generated drawing for construction.

## Completion Contract

Deliver only what the request needs, chosen from:

- a dated brief with observed facts, assumptions, preferences, and unknowns;
- a room/system scope matrix and option table;
- a normalized budget or quotation comparison;
- a decision and procurement schedule;
- a traceable visual-reference board;
- a risk register and professional-verification list;
- stage-gate, inspection, and handover checklists;
- direct sources beside current or safety-relevant claims.

End with the next few decisions in dependency order. State which measurements, quotations, samples, rules, or professional approvals remain unresolved.
