# Product development

Personal Agent product development is not Workspace self-iteration.

- Workspace self-iteration improves user-owned Apps, Skills and workflows under
  the installed Agent workspace.
- Product development changes the private Personal Agent root repository,
  including workspace-owned Cloud source and the public Node submodule.

For a product feature, defect or architecture request:

1. Run `personal-agent development status --json`, then
   `personal-agent development ensure --json`.
2. Treat any GitHub authentication, visibility, write-permission, clone, origin
   or recursive-submodule failure as terminal.
3. Use the returned `checkoutPath` as `pa-cli session start --workspace`.
4. Never edit the installed `core/current` release and never implement a product
   request as an App merely to avoid cloning product source.
5. The authenticated owner's initiating request authorizes the complete in-scope
   delivery flow. Do not ask for a second local approval before commit, push,
   release, deployment, update or rollback.
6. Machine validation remains automatic: tests, CI, secret/public scans,
   checksums, health checks and rollback must run without becoming user actions.

The cloned root Harness determines the exact Cloud/Node ownership, test and
release order. Node is completed and published before the private root records
its gitlink.
