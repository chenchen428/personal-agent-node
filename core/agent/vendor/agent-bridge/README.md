# Agent Bridge CLI

Local CLI for Agent Bridge. This package runs the single local Codex runner used by the Agent Bridge service.

## Responsibilities

- Register local workspaces and automatically discover local Codex sessions from `~/.codex/sessions`.
- Derive workspaces from each Codex session's `session_meta.payload.cwd`; users do not need to pass workspace paths for normal use.
- Run as exactly one detached background worker on this machine and keep the local runner heartbeat alive.
- Install a launchd / systemd user service for boot startup.
- Fail startup when platform registration fails.
- Drive remote sessions through `codex app-server` and upload stream events directly to `/api/agent-bridge/sessions`.
- Import lightweight resumable Codex session indexes from local JSONL so existing local Codex sessions appear in Web and can be resumed.
- Keep historical JSONL discovery out of the startup critical path; the worker should become `running` before all historical sessions are backfilled.

## Commands

`abg` is the recommended short command. The full `agent-bridge` command remains available and points to the same CLI.

```bash
abg start
```

When `--service-url` is omitted, the CLI prompts for prod / pre / local / custom. The default is
production `https://abg.alibaba-inc.com`; staging is `https://pre-abg.alibaba-inc.com`.

```bash
abg status
abg status --json
```

`status` prints a compact local worker summary for humans or JSON for scripts. Use `info` when full PID metadata is needed.

```bash
abg install-service \
  --config ~/.agent-bridge/harness-env/configs/agent-bridge.json \
  --load
```

`start` mirrors the daemon design from `ali-platform-agent-bridge-cli`: it writes PID metadata under `~/.agent-bridge/harness-env/pids`, logs under `~/.agent-bridge/harness-env/logs`, and starts a detached worker that periodically sends heartbeat.

`install-service` writes the same config to disk and creates a launchd user agent on macOS or a systemd user service on Linux. The service runs the same CLI in foreground mode and is configured to restart automatically.

Agent Bridge is a singleton daemon on a machine. The CLI rejects `--instance-id`, `AGENT_BRIDGE_INSTANCE_ID`, and `config.instanceId`; a single daemon manages all scheduled sessions for that machine.

`--service-url` is the preferred service address option for local, pre, and production environments. `--server-url` and `--base-url` are accepted as aliases for compatibility with older local scripts.
`--workspace`, `--workspace-name`, and `--agent-cmd` are advanced overrides only. Normal users should start one worker and let it discover Codex sessions automatically.

Auto-discovered historical Codex sessions upload only a resumable index: session id, workspace name, `agentAlias`, status, `cliSessionId`, title, and timestamps. They do not upload historical `messages`, local `jsonlPath`, machine specs, or repeated `agentCommand`.

Full history is backfilled on demand instead: when the web opens a historical session it enqueues a `session.history` command, and the worker (`lib/session-history.mjs`) reads native history via app-server `thread/read {includeTurns:true}`, supplements command executions from the local rollout JSONL (codex does not persist exec events into its rollout history), and uploads everything once with negative sequence values plus a `metadata.historyBackfill` marker.

## Runner

Agent Bridge drives a long-lived `codex app-server` (JSON-RPC) process where every session is a live thread. This provides hot resume, interactive approval, graceful interrupt/steer, and codex's native slash commands. The default `codex` alias maps to `codex app-server`; legacy one-shot alias data is normalized away during registration and workspace reads.

### Slash commands

Type these in the session input; the runner routes them to first-class app-server methods instead of a plain turn:

| Input | Action |
|---|---|
| `/compact` | Compact the thread context (`thread/compact/start`) |
| `/review [instructions]` | Run a code-review turn (`review/start`) |
| `/goal <text>` · `/goal clear` · `/goal` | Set / clear / read the thread goal |
| `/fork` | Fork the thread |
| `/rollback [n]` | Roll back the last `n` turns |
| `!<cmd>` or `/shell <cmd>` | Run a shell command in the thread (`thread/shellCommand`) |
| `/<name> [args]` | Run the skill named `<name>` (falls back to a text turn if no such skill) |

Model selection is exposed through the Web controls. Skills are preloaded into the slash panel; `/model` and `/skills` are not primary user commands.
