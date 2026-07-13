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

Use `personal-agent <command> --help --json` for parameters, required capability, and risk metadata once the registry marks the CLI implemented.
