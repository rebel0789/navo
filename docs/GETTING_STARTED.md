# Getting Started

Navo is a local companion for Codex. It lets users choose between Codex native models and OpenCode Go models, and it can run a local Responses-to-Chat adapter for OpenCode.

## Requirements

- macOS for Codex App controls and Keychain storage.
- Node.js 20 or newer.
- Codex App or Codex CLI installed.
- An OpenCode Go API key for OpenCode mode.

## Install

After Navo is published to npm:

```bash
npm install -g navo
```

For local development from the repository:

```bash
npm link
navo help
```

## First Run

Store your OpenCode Go API key:

```bash
navo login
```

Start the dashboard:

```bash
navo ui
```

Open:

```text
http://127.0.0.1:17854
```

Navo starts the dashboard in the background and opens it in Chrome. The dashboard keeps running after the terminal closes.

To print the URL without opening a browser:

```bash
navo ui --no-open
```

To stop the dashboard:

```bash
navo ui-stop
```

## Choose A Provider

Use Codex native:

```bash
navo codex-model gpt-5.5
```

Use OpenCode through the OpenCode connection:

```bash
navo model deepseek-v4-flash
navo restart
```

In the dashboard, use:

- **Use Codex Native** for Codex/OpenAI provider mode.
- **Use OpenCode Mode** for OpenCode provider mode.

Dashboard switches restart Codex App automatically after changing provider or model. If you switch from the CLI, restart Codex App or start a new Codex session. Existing chats may keep the provider/model they started with; open a new chat in the same project when you want Codex to reload Navo settings.

## Dashboard Runbook

1. Pick the provider mode.
   Use **Use Codex Native** for Codex models and **Use OpenCode Mode** for OpenCode Go models.

2. Start the refreshed session.
   Dashboard switches restart Codex App automatically. For CLI switches, restart Codex App or start a new Codex session.

3. Prove OpenCode traffic.

   ```bash
   navo probe-routing
   navo verify --fresh
   navo logs --lines 20
   ```

4. Read the log fields.
   `requested_model` is what Codex asked for. `model` is what Navo sent upstream. OpenCode proof must include `upstream_host=opencode.ai`.

5. Recover safely.

   ```bash
   navo codex-model gpt-5.5
   navo backups
   navo restore --backup /path/to/file.toml
   ```

## Verify

Check current mode:

```bash
navo status
```

Prove OpenCode traffic:

```bash
navo probe-routing
navo verify --fresh
navo logs --lines 20
```

Good OpenCode proof includes:

```text
upstream_host=opencode.ai
upstream_path=/chat/completions
```

## Undo

Switch back to Codex native:

```bash
navo codex-model gpt-5.5
```

Stop the OpenCode connection:

```bash
navo proxy-stop
```
