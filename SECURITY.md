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

