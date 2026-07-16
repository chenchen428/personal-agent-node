---
name: travel-guidebook
description: Create researched, printable travel guidebooks as self-contained HTML with optional PDF export. Use for 路书, 旅行指南, 行程手册, travel guidebook, trip planner, 自驾游攻略, multi-day itineraries, route books, or turning existing trip notes into a polished guide.
---

# Travel Guidebook

Create a practical, source-backed travel guide in a warm editorial style. Produce HTML first, let the user review it, and export PDF only after approval.

Keep generated work under `publications/travel-guidebook-<slug>/` in the customer Workspace, or use the user's requested output directory. Never write generated content into this Skill directory.

## Read the bundled resources

- Read [chapter templates](references/chapter-templates.md) before structuring the guide.
- Read [layout CSS](references/layout-css.md) before writing HTML.
- Use [report template](references/report-template.md) for a concise provenance and verification record.
- Use [HTML-to-PDF script](scripts/html2pdf.mjs) only after the HTML checkpoint.

## Workflow

### 1. Establish the brief

Infer what is already clear and ask only for missing choices that change the route:

- origin, destinations, dates, and number of days;
- transport mode and daily pace;
- audience, mobility, dietary, child, or accessibility needs;
- fixed bookings, must-see places, and exclusions;
- budget band and preferred language.

If the user supplies a complete itinerary, begin with route validation. If the user supplies an existing HTML guide, begin with the HTML checkpoint.

### 2. Research current facts

Travel schedules, opening hours, ticket rules, weather, prices, road access, visas, and safety conditions are unstable. Use available web/search tools and prefer:

1. government, attraction, transit, airline, hotel, and venue primary sources;
2. reputable mapping or booking providers for availability and route estimates;
3. recent local reporting for temporary closures or disruptions;
4. community sources only for subjective experience, clearly labeled as such.

Cross-check route-critical facts with two independent sources when practical. Record source URL, retrieval date, and which claim it supports. Never present model memory as a current fact. If current verification is unavailable, label the estimate and tell the user what to recheck before departure.

Do not place credentials, booking references, passport details, home addresses, or private traveler data in the guide unless the user explicitly asks and understands that the artifact will contain them.

### 3. Validate feasibility

Build a day-by-day table before writing prose:

```text
Day / overnight base / stops / travel legs / visit time / meals / buffer / source status
```

For every day, verify:

- total travel plus visit time fits the usable day;
- stops form a geographically coherent route;
- the plan includes meal, transfer, queue, and recovery buffers;
- opening days and timed-entry windows are compatible;
- late arrival does not create an unsafe or impossible transfer;
- high-altitude, heat, cold, driving, hiking, and accessibility constraints are handled conservatively.

Do not diagnose medical fitness. For altitude, pregnancy, chronic conditions, or strenuous activity, advise the traveler to seek qualified medical guidance and follow official local safety advice.

Show the route outline when the user requested planning approval. Otherwise continue with reasonable assumptions and list them in the report.

### 4. Write the guide

Use five parts:

1. cover and trip-at-a-glance;
2. before-you-go checklist;
3. day-by-day route;
4. destination notes and decision support;
5. practical appendix and source notes.

Each day should make these items easy to scan:

- start and end location;
- transport legs with verified or clearly estimated duration;
- two or three priority stops;
- meal and rest options;
- booking or timing constraints;
- fallback for bad weather or closure;
- one short context paragraph explaining why the place matters.

Write from the traveler's point of view. Keep recommendations selective and explain tradeoffs. Do not fabricate ratings, prices, quotations, history, or availability.

### 5. Build self-contained HTML

Create:

```text
publications/travel-guidebook-<slug>/
├── index.html
├── sources.md
└── report.md
```

Start from the bundled CSS and chapter patterns. Keep CSS and decorative SVG in `index.html`. Remote fonts or icons are optional enhancements; the guide must remain readable when they fail. Use semantic headings, tables that fit print width, visible focus states, sufficient contrast, and print-safe page breaks.

Use the available file-editing tool. Do not construct large files through shell heredocs or command-string concatenation.

### 6. HTML checkpoint

Before PDF export:

- verify the HTML opens locally;
- check that every day, booking constraint, fallback, and source note is present;
- verify no text is clipped and tables fit A4 width;
- check links and remove private or local-only paths;
- ask the user to review the HTML.

Do not infer approval. Continue to PDF only when the user asks to export or explicitly approves the HTML.

### 7. Export PDF

The bundled exporter requires Node.js, Playwright, and a compatible Chromium runtime:

```bash
node "skills/travel-guidebook/scripts/html2pdf.mjs" \
  "publications/travel-guidebook-<slug>/index.html"
```

Check dependencies before running. Do not initialize an npm project, install Playwright, or download a browser without the user's approval. If the dependency is unavailable, deliver the HTML and explain the browser print fallback: open `index.html`, print to PDF, enable background graphics, and use A4 paper.

After export, verify that the PDF exists, has a plausible page count and size, and contains no blank or clipped pages.

## Delivery

Return:

- the HTML path;
- the PDF path when exported;
- the source log and report paths;
- verified dates and any estimates or unresolved risks;
- a reminder to recheck time-sensitive facts shortly before travel.

## Quality rules

- Prefer a feasible, calm itinerary over a crowded checklist.
- Use icons as functional labels, not decoration; avoid emoji in the guide.
- Keep body text readable outdoors and in print.
- Preserve source provenance even when citations are visually condensed.
- Keep generated artifacts and customer data outside the Skill directory.
- Never claim that optional map, browser, or research tooling is available until it has been checked.
