# Command Map

The normative machine-readable command tree is `registry/commands.json`. Every command supports `--json`; Agents must not parse table or text output.

| Intent | Command domain |
| --- | --- |
| Product health and capability discovery | `status`, `doctor`, `capabilities` |
| Conversations and installed skills | `chat`, `skill` |
| Messaging and managed social accounts | `channel`, `managed-platform`, `managed-account`, `managed-task` |
| Extensions and private content | `extension`, `content`, `file`, `automation` |
| Models and connectivity | `model`, `connection`, `cloud`, `edge` |
| Data protection and lifecycle | `backup`, `update`, `audit` |
| Two-stage approval | `operation approve`, `operation execute` |

`personal-agent cloud connect --json [--cloud-url <https-url>] [--no-open]` performs browser device authorization. During the wait it emits a `cloud.device-authorization` progress envelope containing only `userCode`, `verificationUrl`, `verificationUrlComplete`, expiry and polling interval; its final stdout remains the standard command envelope. Never request an email, authorization code, slug, device code, enrollment credential, or Node token on the command line.

Use `personal-agent <command> --help --json` for parameters, required capability, and risk metadata once the registry marks the CLI implemented.
