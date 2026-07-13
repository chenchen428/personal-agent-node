# Research Schema

## Contents

1. Project layout
2. `project.json`
3. Result files
4. Validation rules

## Project Layout

```text
<project>/
├── project.json
├── results/
│   ├── <item-id>.json
│   └── ...
└── report.html
```

## `project.json`

```json
{
  "schemaVersion": 1,
  "topic": "Research question",
  "slug": "research-question",
  "createdAt": "2026-07-10T00:00:00.000Z",
  "language": "zh-CN",
  "questions": ["What decision must this research support?"],
  "items": [
    {"id": "item-a", "name": "Item A", "context": "Why it is in scope"}
  ],
  "fields": [
    {
      "id": "capability",
      "label": "Capability",
      "description": "What the item can reliably do",
      "required": true
    }
  ],
  "execution": {
    "batchSize": 4,
    "itemsPerAgent": 1,
    "resultsDir": "results"
  }
}
```

Keep field IDs stable, lowercase, and snake_case. Add context to similarly named items so researchers do not compare the wrong object.

## Result Files

Store one file per item at `results/<item-id>.json`:

```json
{
  "itemId": "item-a",
  "status": "complete",
  "researchedAt": "2026-07-10T00:00:00.000Z",
  "summary": "Evidence-backed summary.",
  "fields": {
    "capability": {
      "value": "Structured value or prose",
      "confidence": "high",
      "sourceIds": ["s1"]
    }
  },
  "sources": [
    {
      "id": "s1",
      "title": "Primary source title",
      "url": "https://example.com/source",
      "publisher": "Publisher",
      "publishedAt": "2026-07-01",
      "accessedAt": "2026-07-10"
    }
  ],
  "gaps": []
}
```

`value` may be a string, number, boolean, array, or object. `sourceIds` must name entries in the same file. Use `status: partial` and explain gaps when required evidence is unavailable.

## Validation Rules

- Every configured item has exactly one result file.
- `itemId` equals the configured item ID.
- Every required field exists and uses `{value, confidence, sourceIds}`.
- Confidence is `high`, `medium`, or `low`.
- Every field cites at least one known source ID.
- Every source has an HTTP(S) URL and title.
- Partial results explain their gaps.

The CLI validates structure and coverage, not factual truth. The primary agent still audits whether sources actually support the claims.

The default report command renders `report.html`. Markdown remains an explicit compatibility format through `--format markdown`.
