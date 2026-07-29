# ADR 0010: Project-scoped specialist Agent profiles

- Status: Proposed
- Date: 2026-07-29
- Scope: Personal Agent Node main-Agent delegation, Worker sessions, portable
  Skills, and customer Workspace
- Related: ADR 0003 Core/workspace delivery, `AGENTS.md` main-Agent and Worker
  delegation contract

## Summary

Personal Agent should improve domain specialization without replacing its
existing main-Agent, Worker, Skill, Page, file, or session architecture.

The product will add a small catalog of specialist Agent profiles. A specialist
profile is a named Worker configuration with:

- stable professional instructions;
- a curated list of existing Skills to prefer;
- concise routing signals for the main Agent; and
- project-scoped session identity.

The canonical main Agent remains the only user-facing Agent. It selects a
specialist, starts one Worker session for a new domain project, and resumes that
same session for later work on the same project. The specialist keeps the
professional history of that project in its Codex thread and persists current
facts in ordinary project artifacts. A different project or a different
specialist starts a different Worker session.

This decision deliberately does not introduce a general workflow engine, an
Agent-to-Agent messaging network, a new memory product, a new permission
system, or an autonomous review hierarchy. Users continue to review the
specialist's output and request revisions through the main Agent.

## Goal

The goal is to let focused child Agents handle work in their own professional
domain while preserving the current product and keeping the implementation
small.

The first profiles are:

1. interior design;
2. presentation design;
3. poster and social-visual design; and
4. travel planning.

Success means:

- a domain task receives stable professional instructions instead of only a
  generic Worker prompt;
- the specialist can use the existing reusable Skills and product commands;
- revisions of the same project preserve the specialist's prior reasoning and
  working context;
- unrelated projects do not share a specialist thread;
- cross-domain work receives only the selected source artifacts and task
  context; and
- the user continues to see one coherent conversation with the main Agent.

## Non-goals

This proposal does not:

- turn every Skill into an Agent;
- copy shared Skills into Agent directories;
- introduce peer-to-peer Agent conversations;
- create a separate publishing Agent;
- add an Agent marketplace or Agent settings UI;
- add a declarative workflow or DAG runtime;
- add a separate domain-memory database;
- add automatic creator/reviewer Agent loops;
- replace the existing `main` and `worker` session roles;
- make the Worker a second user-facing assistant; or
- change the user's responsibility to inspect results and request revisions.

## Current architecture

Personal Agent Node already has the required execution foundation:

- the canonical main Agent owns user conversation, delegation, progress, and
  final replies;
- each Worker owns an independent Codex thread;
- Worker sessions can be resumed and recovered after interruption;
- Workers already return governed artifacts and cannot author global Activity
  or Memory;
- `pa-cli session start`, `resume`, `list`, `search`, and `status` provide the
  task lifecycle;
- portable Skills already contain the professional procedures, scripts,
  references, assets, and quality checks used by domain work; and
- Online Pages, managed files, research, media processing, and other shared
  functions already have stable product or Skill entry points.

The missing concept is a first-class specialist profile. Today every created
Worker receives the same base instructions and is identified only as a
`worker`. Domain selection is expressed through task text, Skill invocation,
and a small amount of hard-coded routing.

## Decision

### 1. Keep one canonical main Agent

The main Agent continues to:

- understand the user's current request;
- decide whether the request needs delegation;
- select a specialist profile when one clearly owns the request;
- determine whether the request belongs to an existing project;
- start or resume the appropriate Worker session;
- pass the latest user request and relevant governed artifacts;
- receive progress, completion, missing-input, and failure results; and
- communicate with the user.

The main Agent does not perform the specialist's substantive work after
delegating it.

### 2. Add specialist profiles on top of Workers

A specialist is not a new security role or runtime process type. It remains a
Worker session whose metadata identifies an Agent profile.

The portable source layout will be:

```text
agents/
├── interior-designer/
│   ├── agent.yaml
│   └── AGENT.md
├── presentation-designer/
│   ├── agent.yaml
│   └── AGENT.md
├── poster-designer/
│   ├── agent.yaml
│   └── AGENT.md
└── travel-planner/
    ├── agent.yaml
    └── AGENT.md

registry/
└── agents.json
```

`agent.yaml` is intentionally small:

```yaml
schemaVersion: 1
id: interior-designer
version: 1
displayName: Interior Design Agent
description: Handles renovation, floor-plan, layout, and interior delivery work.
instructions: AGENT.md
skills:
  - home-renovation
  - interior-design
  - visual-content
  - media-toolkit
  - personal-files
  - personal-pages
routing:
  - renovation
  - interior design
  - floor plan
  - furniture layout
  - 装修
  - 室内设计
  - 户型
  - 家居布局
```

The profile does not duplicate Skill instructions. `AGENT.md` contains only the
stable professional identity and composition guidance:

- the domain it owns;
- how it interprets a task;
- which existing Skills it should prefer;
- the expected result shape;
- how it handles user-requested revisions;
- domain-specific boundaries that apply across its Skills; and
- how it reports artifacts and missing inputs to the main Agent.

### 3. Reuse shared Skills from one source

Skills remain the reusable capability layer. A Skill may be listed by any
number of specialist profiles.

For example:

```text
interior-designer ─────┐
presentation-designer ─┼── personal-pages
travel-planner ────────┘
```

`personal-pages`, `personal-files`, `visual-content`, `media-toolkit`,
`deep-research`, and similar shared Skills continue to have one source
directory and one registry entry. An Agent profile references them by Skill ID;
it never vendors, forks, or copies their content.

Agent profile loading does not need to hide every other installed Skill in the
first implementation. The profile prompt tells the Worker which Skills own its
normal work, while the existing Skill trigger and safety rules remain
available. A later implementation may restrict the exposed catalog if prompt
size or incorrect Skill selection becomes an observed problem.

### 4. Use project-scoped sticky Worker sessions

The specialist session key is:

```text
mainSessionId + agentId + projectKey
```

The main session preserves the user relationship. `agentId` preserves the
professional identity. `projectKey` separates independent projects handled by
the same specialist.

Examples:

```text
main session
├── interior-designer / home-renovation-001
├── interior-designer / parents-home-renovation-001
├── presentation-designer / annual-review-2026
└── travel-planner / japan-2026-october
```

The first task for a project starts a Worker session. Later tasks for that same
project resume the same Worker session. The session may be `idle` between
tasks; `idle` means the current turn is complete, not that the project history
must be discarded.

This keeps useful tacit context such as:

- why an earlier option was chosen;
- which options the user rejected;
- assumptions already discussed;
- the location and lineage of working files;
- earlier tool or generation problems;
- the relationship between current and previous artifacts; and
- domain terminology established during the project.

### 5. Persist current truth in project artifacts

The Worker thread preserves professional working history, but it is not the
authoritative database for the current result.

Each specialist continues to use its existing domain artifacts:

- interior design uses its governed project schema, evidence, requirements,
  revisions, scene, audit, and publication records;
- presentation design keeps the brief, outline, visual direction, deck, and
  revision notes in its task directory;
- poster design keeps its content plan, source assets, layout source, renders,
  and delivery record;
- travel planning keeps the trip brief, itinerary, sources, unresolved facts,
  HTML, and optional PDF.

On every resumed task, the specialist should treat information in this order:

1. the user's latest feedback;
2. the current verified project files and revision;
3. previously confirmed decisions;
4. prior conversation and discarded drafts.

This prevents stale statements in the thread from overriding the current
artifact state.

### 6. Start or resume by explicit project identity

The main Agent resumes a specialist session when all of the following are true:

- the request belongs to the same domain;
- it refers to the same project or artifact lineage;
- one matching child session exists under the current main session;
- the user is continuing, answering, correcting, or revising that work; and
- no independent concurrent turn is already mutating the same project.

Typical resume requests include:

- answering a question raised by the specialist;
- supplying a missing measurement, source, or image;
- revising the current layout, style, itinerary, poster, or deck;
- regenerating or republishing the current deliverable;
- continuing interrupted work; and
- explicitly continuing a named prior project.

The main Agent starts a new specialist session when:

- the request belongs to another domain;
- it concerns another home, trip, deck, campaign, or other independent project;
- the user explicitly asks to start over without the previous working history;
- independent branches must run concurrently;
- multiple historical projects match and the user selects a different one; or
- an incompatible future profile version requires a fresh continuation
  session.

Keyword similarity alone is never sufficient to resume a session. If multiple
projects match and the target is material, the main Agent asks one concise
clarifying question.

### 7. Generate and retain `projectKey` internally

`projectKey` is an internal routing identity, not a user-facing name.

When an existing governed domain object has a stable project ID, that ID should
be used. Otherwise the main Agent or orchestrator generates an opaque key when
the first Worker session starts.

Examples shown in prompts or diagnostics may be readable, but the runtime must
not depend on a user-provided title being unique.

The Worker session stores both:

```json
{
  "agentId": "interior-designer",
  "agentProfileVersion": 1,
  "projectKey": "project_7e6b2f20"
}
```

The title and task description remain user-readable metadata; they are not the
identity key.

### 8. Use task-oriented turns inside the sticky session

Every `start` or `resume` input is still a concrete task. The main Agent passes:

- the user's latest request, preserving dates, quantities, names, and
  constraints;
- the intended outcome;
- newly supplied governed object IDs;
- relevant existing artifact IDs or project paths already owned by the
  specialist;
- explicit feedback on the current result; and
- the deliverables expected from this turn.

The main Agent does not need to reconstruct all previous project history on
resume because the specialist thread and project artifacts already contain it.

A new specialist session, including a cross-domain handoff, receives a fuller
task packet:

```json
{
  "agentId": "presentation-designer",
  "objective": "Create a presentation from the accepted interior-design result.",
  "userRequest": "把装修方案做成一份 PPT",
  "inputs": [
    {
      "kind": "page",
      "id": "page_123",
      "purpose": "Accepted interior-design delivery"
    }
  ],
  "context": {
    "audience": "Home owner and family",
    "language": "zh-CN"
  },
  "deliverables": [
    "Presentation",
    "Published presentation Page"
  ]
}
```

The exact wire format may remain plain task text in the first implementation.
The important contract is that the task preserves the complete user request,
governed artifact references, constraints, and deliverables.

### 9. Keep cross-Agent communication mediated by the main Agent

Specialists do not directly share threads or send conversational messages to
one another.

For cross-domain work:

1. the source specialist completes or updates its artifact;
2. the main Agent selects the artifact and relevant result summary;
3. the main Agent starts or resumes the target specialist;
4. the target specialist receives only that selected context; and
5. the target result returns to the main Agent.

For example, turning an interior-design result into a presentation starts a
presentation session with the accepted design artifacts. It does not grant the
presentation specialist access to the interior specialist's complete thread.

This preserves context isolation without adding an Agent messaging bus.

### 10. Let the domain specialist publish its own deliverable

Publishing is part of the domain task when the user asks for a published
result. It does not require a separate publishing Agent.

Examples:

- the interior specialist generates and publishes the interior delivery Page;
- the presentation specialist generates and publishes the deck;
- the travel specialist publishes the guidebook Page and exports PDF when
  requested;
- the poster specialist renders and registers the managed output files.

The specialist uses the existing shared `personal-pages` Skill and
`pa-cli pages publish` contract. The Page service continues to validate the
template, artifact, visibility, and returned URL. The specialist returns the
real `pageId`, URL or `linkNotice`, and artifact metadata to the main Agent. The
main Agent communicates the result to the user.

If the user asks only for a draft, the task stops before publication.

### 11. Preserve the existing main/Worker authority boundary

This proposal requires no new permission framework. Existing rules remain:

- the main Agent owns Activity, Memory, user communication, and final-reply
  attachment selection;
- Workers execute assigned work and report artifacts;
- Workers do not send independent channel notifications;
- publication and file operations continue through their registered product
  contracts; and
- current authorization and confirmation behavior remains unchanged.

## Initial specialist catalog

### Interior Design Agent

Primary Skills:

- `home-renovation`
- `interior-design`
- `visual-content`
- `media-toolkit`
- `personal-files`
- `personal-pages`

Owns renovation briefs, floor-plan evidence, layout and concept work, governed
scene generation, revisions, audits, and interior delivery Pages.

### Presentation Design Agent

Primary Skills:

- `guizang-ppt-skill`
- `content-workbench`
- `visual-content`
- `media-toolkit`
- `deep-research`
- `personal-files`
- `personal-pages`

Owns audience and presentation framing, outline and narrative, visual system,
deck generation, revision, and publication.

### Poster Design Agent

Primary Skills:

- `guizang-social-card-skill`
- `visual-content`
- `media-toolkit`
- `content-workbench`
- `personal-files`

Owns posters, social cards, carousel images, WeChat cover pairs, rendering, and
revision of the same visual campaign.

### Travel Planning Agent

Primary Skills:

- `travel-guidebook`
- `deep-research`
- `knowledge-capture`
- `content-workbench`
- `personal-files`
- `personal-pages`

Owns trip constraints, current source research, itinerary feasibility,
guidebook generation, revision, publication, and optional PDF export.

## Runtime and API plan

### Agent registry

Add:

```text
registry/agents.json
schemas/personal-agent/agents.schema.json
scripts/agent-guard.mjs
```

The guard verifies:

- profile IDs and directories are unique;
- `agent.yaml` and `AGENT.md` exist;
- the manifest schema is supported;
- every referenced Skill exists in `registry/skills.json`;
- routing terms are non-empty and bounded;
- no profile path escapes `agents/`; and
- the installed Workspace contains the registered profile source.

### Session metadata

Keep `role` as `worker`. Store specialist fields in `metadata_json`:

```json
{
  "createdBy": "pa-cli",
  "agentId": "interior-designer",
  "agentProfileVersion": 1,
  "projectKey": "project_7e6b2f20"
}
```

No database migration is required for the first implementation.

### CLI

Extend session creation:

```bash
pa-cli session start \
  --agent interior-designer \
  --project-key project_7e6b2f20 \
  --parent <main-session-id> \
  --title "Home renovation" \
  --description "Interior concept and delivery" \
  --task-file <task-file> \
  --json
```

`--agent` and `--project-key` are optional so generic Workers and existing
callers continue to work.

Extend lookup:

```bash
pa-cli session list \
  --parent <main-session-id> \
  --agent interior-designer \
  --project-key project_7e6b2f20 \
  --all \
  --json
```

`session resume` keeps the original profile and project metadata. It must not
accept flags that silently change the existing Agent identity.

### HTTP API

Extend `POST /api/sessions` with optional:

```json
{
  "agentId": "interior-designer",
  "projectKey": "project_7e6b2f20"
}
```

Extend `GET /api/sessions` with optional `agent` and `project` filters.

Unknown Agent IDs fail with a clear client error instead of silently starting a
generic Worker.

### Orchestrator prompt composition

For a specialist Worker, compose:

```text
base Worker instructions
+ selected specialist AGENT.md
+ concise selected-Skill guidance
+ current task input
```

The base Worker instructions remain the source of main/Worker boundaries,
artifact return format, publication rules, and user-notification restrictions.
The specialist instructions add professional behavior; they do not replace the
base contract.

The loaded profile ID and version are recorded in session metadata and events
so a resumed session cannot silently change professional identity.

### Main-Agent routing instructions

Generate a concise specialist catalog from `registry/agents.json` for the main
Agent. The main Agent should:

1. handle simple direct requests itself under the existing rules;
2. select a specialist only when its domain clearly owns substantive work;
3. search child sessions by parent, Agent, and project;
4. resume a unique matching project;
5. create a new project session when no match exists;
6. ask a concise question only when multiple material projects match; and
7. use a generic Worker when no specialist owns the task.

The catalog should not inject every specialist's full `AGENT.md` into the main
Agent.

### Installed Workspace

Extend Workspace seeding and release packaging to include:

```text
agents/
registry/agents.json
scripts/agent-guard.mjs
```

Built-in profile source is product-managed in the same way as other portable
Harness source. User task data and generated artifacts remain under the
customer-owned Workspace and are never written into `agents/`.

Compatibility bridge changes are not required because the initial runtime
loads Agent profiles through the Personal Agent registry rather than expecting
Codex, Claude, Cursor, or another client to discover a new standard directory.

## Detailed dispatch examples

### New interior project

1. User supplies a floor plan and asks for a design.
2. Main Agent selects `interior-designer`.
3. No matching project exists.
4. Main Agent starts a Worker with a generated `projectKey`.
5. Worker applies the interior Skills, creates the project, and publishes when
   requested.
6. Worker returns the project and Page artifacts.
7. Main Agent reports the result.

### Revision of the same interior project

1. User asks to preserve a piano area and change the wood tone.
2. Main Agent identifies the accepted interior artifact or named project.
3. Main Agent finds the matching `interior-designer` session.
4. Main Agent resumes it with the user's feedback.
5. Worker reloads the current project revision, applies the revision, verifies
   it, and republishes when requested.
6. Main Agent reports the updated result.

### Another home

1. User supplies a different floor plan for a parent.
2. Main Agent recognizes an independent project.
3. Main Agent starts a second `interior-designer` session with another
   `projectKey`.
4. Neither specialist thread receives the other home's context.

### Interior result to presentation

1. User asks to turn the accepted design into a presentation.
2. Main Agent selects the accepted design artifacts.
3. Main Agent starts `presentation-designer` with a new presentation
   `projectKey`.
4. Presentation Agent receives the artifacts and the new presentation task,
   not the interior thread.
5. Later presentation revisions resume the presentation session.

### Missing input

1. Specialist cannot proceed without a material choice.
2. Specialist ends the turn with the missing question and current project
   reference.
3. Main Agent asks the user.
4. The user's answer resumes the same specialist session.

### Interrupted execution

An unfinished specialist task uses the existing Worker recovery path. Recovery
resumes the same session and does not create a new project or repeat completed
publication side effects.

## Implementation sequence

### Slice 1: Registry and profile loader

- add `registry/agents.json`;
- add the Agent manifest schema and guard;
- add the four profile directories;
- load and validate a profile by ID;
- include profile source in Workspace seeding and packaging; and
- keep all runtime behavior unchanged when `agentId` is absent.

### Slice 2: Session metadata and CLI/API

- add `--agent` and `--project-key` to `pa-cli session start`;
- accept and validate the fields in `POST /api/sessions`;
- persist them in `metadata_json`;
- return them in session summaries;
- add list filters; and
- ensure resume preserves the original profile identity.

### Slice 3: Specialist prompt composition

- append the selected `AGENT.md` after base Worker instructions;
- expose the selected profile and Skill list in sanitized diagnostic events;
- add prompt-composition tests;
- fail closed on missing or invalid registered profile source; and
- preserve generic Worker behavior.

### Slice 4: Main-Agent routing

- inject only the concise registered Agent catalog into main-Agent
  instructions;
- implement the `agentId + projectKey` lookup path;
- update start/resume guidance;
- remove domain-specific routing text that is fully owned by a specialist
  profile only after equivalent behavior is covered; and
- keep existing Page-template direct routing until its specialist replacement
  passes the same behavior tests.

This sequence avoids a flag day. Every slice is independently testable and the
existing generic Worker remains the fallback.

## Verification

### Registry tests

- valid profiles pass;
- duplicate IDs fail;
- missing instructions fail;
- unknown Skill references fail;
- path traversal fails; and
- installed profile sources match the release registry.

### Session tests

- generic session creation remains unchanged;
- specialist creation records `agentId`, profile version, and `projectKey`;
- unknown Agent IDs fail;
- list filters return the expected session;
- resume retains Agent identity;
- two projects using the same specialist remain distinct; and
- two specialists using the same source artifact remain distinct.

### Prompt tests

- the Worker base contract remains present;
- the selected specialist instructions are present;
- unrelated specialist instructions are absent;
- referenced Skills are named without duplicating their full instructions; and
- main-only Activity and Memory capabilities are not granted to Workers.

### Behavior cases

At minimum, cover:

1. new interior project;
2. revision of the same interior project;
3. second independent interior project;
4. accepted interior result handed to presentation design;
5. missing-input question and resume;
6. interrupted Worker recovery;
7. specialist Page publication and artifact return; and
8. generic non-domain Worker fallback.

### Repository checks

Implementation changes must pass the Node Harness requirements:

```bash
npm run doctor
npm run guard
npm run baseline:verify
node scripts/skill-tree.mjs cases verify
npm run frontend:guard
npm test
npm run check
```

Documentation-only adoption of this proposed ADR does not claim the Agent
registry or runtime behavior is implemented.

## Compatibility and rollback

All new fields are optional. Existing sessions without `agentId` remain generic
Workers. Existing `pa-cli session start` callers remain valid.

If specialist routing causes a regression:

- stop selecting profiles in the main-Agent instructions;
- continue running generic Workers;
- preserve existing specialist session records as ordinary Worker sessions; and
- leave generated projects and artifacts unchanged.

Removing the routing entry does not delete sessions or customer data.

## Consequences

Positive consequences:

- domain work receives a stable professional identity;
- iterative work retains useful professional history;
- unrelated projects stay isolated;
- shared Skills remain maintainable in one place;
- publishing remains part of the owning domain task;
- user-requested revisions fit the existing session resume mechanism; and
- implementation stays close to the current Worker architecture.

Tradeoffs:

- the main Agent must identify or generate a project key correctly;
- long-lived project threads may eventually require a continuation session;
- current project files must remain the source of truth when thread history is
  stale;
- profile routing quality depends on concise, non-overlapping descriptions; and
- a specialist profile improves consistency but does not replace user review.

These tradeoffs are preferable to either a fully stateless child on every turn
or a large new multi-Agent platform.
