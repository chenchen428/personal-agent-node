# Local development

1. Install Node.js 22 or newer and Codex.
2. Run `npm install` and `npm test`.
3. Initialize an ignored Workspace with `npx tsx core/runtime/bin/private-site.mjs init --domain personal-agent.local --data-root .local/workspace`.
4. Put `PERSONAL_AGENT_AUTH_PASSWORD` in `.local/workspace/secrets/applications/site.env`.
5. Build and activate an immutable release before production use.
