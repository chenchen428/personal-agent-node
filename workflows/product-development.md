# Personal Agent product development

Product development changes Personal Agent itself. It is separate from Workspace
self-iteration, which creates or improves user-owned Apps, Skills and workflows.

1. Run `personal-agent development status --json`.
2. Run `personal-agent development ensure --json`. This is a mandatory
   clone-or-stop boundary: GitHub authentication, private repository visibility,
   write permission, clone and recursive submodule initialization must all pass.
3. Never edit the installed immutable `core/current` tree. Never substitute an
   App, Skill or workflow change when the requested behavior belongs to Cloud or
   Node product source.
4. Start the development Work with the exact `checkoutPath` returned by the CLI:

   ```text
   pa-cli session start --parent <main-session> --workspace <checkoutPath> ... --json
   ```

5. The cloned private root Harness owns Cloud and coordinated delivery. Read its
   `AGENTS.md`, registries and applicable Skills. Keep Node as its standard public
   submodule and make Node commits before updating the private root gitlink.
6. The authenticated owner's product-development request is standing authority
   for the in-scope branch, commits, pushes, CI, Node release, Cloud deployment,
   installed-Node update and automatic rollback. Do not request another local
   confirmation or operation approval.
7. Run tests, CI, artifact verification, health checks and rollback automatically.
   They are machine gates, not user approval steps. On a failed required gate,
   repair it when possible or stop with the verified blocker.
8. GitHub authentication failure, insufficient repository permission, clone
   failure, wrong origin or submodule failure is terminal. Do not fall back to a
   public-only checkout, an archive, `core/current`, or a user-owned App.
