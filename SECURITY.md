# Security

## Reporting

Please report security issues privately by opening a GitHub Security Advisory on the repository.

Do not file public issues for vulnerabilities involving tokens, auth, local config writes, or prompt leakage.

## Local Data

Navo stores state under:

```text
~/.navo
```

OpenCode API keys are stored in macOS Keychain when available, with a chmod `0600` file fallback.

## Logging

Navo activity logs intentionally avoid:

- prompts
- message content
- request headers
- API keys

Logs include routing metadata such as status, requested model, routed model, upstream host, and latency.

## Threat Model

Navo runs local HTTP servers bound to:

```text
127.0.0.1
```

Do not bind these servers to public network interfaces.

The dashboard also requires a per-process local session token for state-changing
actions, rejects cross-site browser requests, and only restores backups that
Navo created and lists. The local OpenCode connection requires a bearer token
from Codex before it forwards model traffic.

## Local Permissions

Navo creates `~/.navo` and `~/.navo/backups` with private directory
permissions. Token fallback files, local logs, pid files, routing config, and
Codex config backups are written with private file permissions.
