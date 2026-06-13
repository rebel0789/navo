# Getting Started

Navo is a local companion for Codex. It lets users choose between Codex native models and OpenCode Go models, and it can run a local Responses adapter for the OpenCode Go endpoints documented by OpenCode.

## Requirements

- macOS for Codex App controls and Keychain storage.
- Node.js 20 or newer.
- Codex App or Codex CLI installed.
- An OpenCode Go API key for OpenCode mode.

## Install

After Navo is published to npm, the shortest path is:

```bash
npx -y @rebel0x/navo@latest ui
```

That downloads the latest package, starts the local dashboard, and opens the setup flow. The dashboard can store the OpenCode Go API key locally and switch Codex between Codex native mode and OpenCode mode.

For a persistent install:

```bash
npm install -g @rebel0x/navo
navo ui
```

For local development from the repository:

```bash
npm link
navo help
```

## First Run From The Terminal

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

Use OpenCode Go through the local OpenCode connection:

```bash
navo model deepseek-v4-flash
navo restart
```

In the dashboard, use:

- **Revert to Codex Mode** in **Active Model** for Codex/OpenAI provider mode.
- **Use OpenCode Mode** in **Active Model** for OpenCode provider mode.

Dashboard provider-mode switches restart Codex so the app reloads the provider. If OpenCode mode is already active, selecting another OpenCode model saves config without restarting Codex. Existing Navo-backed chats keep their context and are routed to the selected model on the next request. Native Codex chats do not hit Navo until Codex reloads the Navo provider.

## Dashboard Runbook

1. Pick the provider mode.
   Use **Revert to Codex Mode** for Codex models and **Use OpenCode Mode** for OpenCode Go models.

2. Start or continue the right session.
   Existing Navo-backed chats can continue and will be routed by the bridge to the selected model. Open a new Codex chat when the current chat is still using the native Codex/OpenAI provider.

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
# or, for MiniMax/Qwen models:
upstream_path=/messages
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
