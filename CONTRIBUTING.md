# Contributing

Thanks for helping improve Navo.

## Development

```bash
npm link
npm run check
navo help
```

Navo has no runtime npm dependencies.

## Pull Requests

Before opening a PR:

```bash
npm run check
npm pack --dry-run
```

Keep changes focused. Avoid committing local state, logs, API keys, screenshots with secrets, or unrelated demo files.

## Design Principles

- Local-first.
- No prompt or API-key logging.
- Clear provider mode: Codex Native vs OpenCode.
- Always back up Codex config before writing.
- Keep the install path simple.

## Code Style

- Node.js ESM.
- No build step.
- Prefer small helpers over large dependencies.
- Keep dashboard code dependency-free.

