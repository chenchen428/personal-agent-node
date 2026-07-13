# Local development

1. Install Node.js 22 or newer and Codex.
2. Run `npm install` and `npm test`.
3. Initialize an ignored data root with `node projects/core/node/bin/private-site.mjs init --domain personal-agent.local --data-root .local/node`.
4. Put `PERSONAL_AGENT_AUTH_PASSWORD` in `.local/node/secrets/applications/site.env`.
5. Build and activate an immutable release before production use.
