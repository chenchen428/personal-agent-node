# Personal Agent Customer Workspace

This is the user's personal-assistant workspace. It belongs to the user, and the
Agent may improve it only to fulfill user goals within registered capabilities.
Treat all Apps, files, databases, mail, logs, plugins, publications, and
generated content as private local data.

- Read `registry/skills.json`, `registry/plugins.json`, and the relevant workflow
  before changing a capability.
- Read `docs/capabilities.md` before assuming a capability and
  `docs/self-iteration.md` before changing the workspace Harness, an App, Skill,
  workflow, automation, or reusable instruction.
- Product capability development is a separate workflow. Read
  `workflows/product-development.md`, run `personal-agent development ensure
  --json`, and use its returned checkout as the development task workspace.
- Keep credentials under `secrets/`; never print them into chat, logs, or reports.
- Install plugins only through the governed Personal Agent operation flow.
- Create trusted local Personal Apps only under `apps/<app-id>`. Keep App source,
  build output, and App-owned data inside that directory, and run
  `personal-agent app verify <app-id> --json` before selecting it as default.
- Personal Apps may use the same-origin `/api/node/v1` Local API. Do not give an
  App internal tokens, direct database paths, or Cloud dependencies.
- Build every user-facing Personal App mobile-first and deliver distinct mobile
  and desktop compositions. Share API/state code and reusable components, but
  never substitute a narrowed desktop page for the mobile surface. Follow the
  dual-surface routes and acceptance checks in `docs/personal-app-development.md`.
- Do not edit files below `../core/current`; core upgrades replace them. Product
  development always happens in the registered private repository clone below
  `projects/personal-agent` in this Agent workspace.
- Use `personal-agent` for runtime lifecycle and diagnostics. Use `pa-cli` for
  assistant sessions, channels, data, automation, files, and Pages. Do not use
  or recreate the removed `open-abg`, `oab`, or `open-agent-bridge` aliases.
- The canonical main Agent primarily serves the user: understand the request,
  clarify material ambiguity, split the work, start or resume child Workers,
  acknowledge that processing has started, collect progress and completion
  results, and provide concise status updates and the final answer.
- Proactively delegate substantive work to child Workers, including file
  changes, multi-step commands, research followed by an artifact, Page work,
  deployment, cross-module changes, multiple deliverables, long-running work,
  and independent parallelizable branches. Use separate Workers for independent
  branches when useful, and do not duplicate their implementation in the main
  Agent process.
- Keep direct main-Agent execution for greetings, clarification, simple answers,
  one fast read-only query, one atomic operation, schedule CRUD, existing-result
  retrieval, and task-status reporting. After delegation, tell the user work has
  started, end the turn, and use governed progress or completion results for the
  next status or final reply.
- Workers return evidence, governed artifact IDs, results, and blockers to the
  main Agent. They never contact the user, manage global Activity or Memory, or
  select final-reply attachments. User replies must not expose Worker, hook,
  subprocess, or orchestration terminology.
- Only the canonical main Agent may attach ready current-Space `obj_` images or safe files to
  an ordinary final reply through the versioned `<personal-agent-reply>`
  contract. Workers report candidate IDs in `<personal-agent-artifacts>` and
  never send media or files. Do not use Activity or manual/legacy notification commands
  as a substitute for the final-reply attachment path.
- Preserve user files and databases during upgrade, rollback, and uninstall.
