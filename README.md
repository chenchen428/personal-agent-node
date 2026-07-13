# Personal Agent Node

Personal Agent Node is the open-source, local-first runtime for a private personal assistant. It works without Personal Agent Cloud and keeps application data, credentials, files, and Agent state on the user's machine.

Supported connectivity and model choices are independent:

- local/LAN only;
- a user-managed domain and tunnel;
- the optional Personal Agent Cloud Edge;
- BYOK or any OpenAI-compatible Token gateway.

Requires Node.js 22.x. Node 24 removed the permission-model flag used by the template sandbox and is not supported by this beta. See `docs/getting-started.md` for the development bootstrap.

The repository includes the full customer-machine Harness: project and skill registries, Agent instructions, portable skills, reproducible fixtures, workspace guards, runtime workflows, and compatibility bridges for Codex, Claude, Cursor, and generic Agent clients. Run `npm run doctor` after cloning.
