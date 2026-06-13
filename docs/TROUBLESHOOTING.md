# Troubleshooting

Use this guide when Navo looks configured but Codex or the dashboard behaves unexpectedly.

## Dashboard Says Fetch Failed

The dashboard talks to its own local API on `127.0.0.1`.

Check that the dashboard is running:

```bash
navo ui-status
```

Then open:

```text
http://127.0.0.1:17854
```

If the page is open but actions fail:

```bash
navo status
navo restart
navo logs --lines 20
```

If the port is stuck, start on another port:

```bash
navo ui --port 17855
```

## Browser Opens Repeatedly

`navo ui` starts or focuses the persistent local dashboard and opens Chrome once by default.

This command starts the dashboard without opening a browser:

```bash
navo ui --no-open
```

To stop the dashboard:

```bash
navo ui-stop
```

If Chrome does not appear, open `http://127.0.0.1:17854` manually.

## Assistant Says It Is GPT-5

Do not use the assistant's self-report as proof. A model can answer from system identity text or cached session context.

Use OpenCode proof:

```bash
navo probe-routing
navo verify --fresh
navo logs --lines 20
```

OpenCode proof must include:

```text
upstream_host=opencode.ai
upstream_path=/chat/completions
```

## Requested Model And Upstream Model Differ

This can be normal when split routing is enabled.

```text
requested_model=gpt-...
model=deepseek-v4-flash
upstream_host=opencode.ai
```

`requested_model` is what Codex asked for. `model` is what Navo actually sent upstream.

To use Codex native models again:

```bash
navo codex-model gpt-5.5
navo proxy-stop
```

Then restart Codex App or start a new session.

## Restore Did Not Change The Current Session

Codex may keep provider settings for an already-running session.

After restore or model switching:

```bash
navo status
```

Then restart Codex App or open a new Codex session.

Opening a new chat can look surprising, but it is the reliable way for Codex to reload a custom provider/model. Keep using the same project/workspace; the conversation is new, not the project files.

## Safe Recovery

Return to Codex native:

```bash
navo codex-model gpt-5.5
navo proxy-stop
```

Restore a saved config:

```bash
navo backups
navo restore --backup /path/to/backup.toml
```
