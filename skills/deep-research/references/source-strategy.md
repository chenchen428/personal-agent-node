# Source Strategy

## Contents

1. Source hierarchy
2. Research lanes
3. Query design
4. Evidence handling

## Source Hierarchy

Prefer sources in this order unless the research question requires lived experience:

1. Primary: official documentation, filings, standards, datasets, papers, release notes, repositories.
2. Independent expert: peer review, reputable benchmarks, established analysts, technical postmortems.
3. Community evidence: maintainer discussions, issue trackers, practitioner forums, user reviews.
4. Discovery-only: aggregators, summaries, unsourced posts. Use these to find stronger sources, not as sole support for material claims.

## Research Lanes

| Lane | Primary sources | Useful secondary evidence |
|---|---|---|
| Academic | Original paper, DOI, dataset, author repository | Reviews, citation graph, replications |
| Technical selection | Official docs, changelog, benchmark code | Maintainer issues, production reports, technical forums |
| Market/competitor | Company filings, pricing, product docs | Analyst reports, customer reviews, reputable press |
| Due diligence | Filings, court/regulator records, audited statements | Credible investigative reporting, expert commentary |
| Chinese technology | Official Chinese docs and repositories | 掘金, SegmentFault, 知乎, V2EX as practitioner context |

Use community sources for experience claims such as reliability, learning curve, or support quality. Do not use them to override an official specification without explaining the conflict.

## Query Design

Generate several query families rather than one long query:

- exact product/paper/company name plus the target field;
- official-domain queries;
- version/year/date variants;
- exact error messages or benchmark names;
- negative evidence: limitations, migration, deprecation, incident, lawsuit, recall;
- English and Chinese terminology when relevant.

For software issues, search open and closed repository issues and verify the affected version. For papers, search title, author, DOI, later versions, and replications. For current products, check the page date and changelog.

## Evidence Handling

- Record what each source directly establishes.
- Cross-check material or surprising claims with two independent sources when possible.
- Distinguish a source's statement from your inference.
- Preserve disagreements and explain likely reasons such as version, methodology, geography, or date.
- Never fabricate publication dates, metrics, quotes, or URLs.
- Treat absence of evidence as a gap, not evidence of absence.
