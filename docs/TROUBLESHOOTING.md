# Troubleshooting

Use this guide when Navo looks configured but Codex or the dashboard behaves unexpectedly.

## Global Install Says EEXIST

If `npm install -g @rebel0x/navo` fails because `~/.local/bin/navo` already exists, the machine probably has an old development link from `npm link`.

Clean the old link, then install the published package:

```bash
npm unlink -g navo
npm install -g @rebel0x/navo
navo version
```

Fresh installs do not need this. It is only for machines that previously linked a local checkout.

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
# or, for MiniMax/Qwen models:
upstream_path=/messages
```

## Requested Model And Upstream Model Differ

This can be normal. In single-model mode, Navo forces any request that reaches the bridge to the selected OpenCode model. In split routing mode, Navo chooses the chat or agent model based on whether tools are present.

```text
requested_model=gpt-...
model=deepseek-v4-flash
upstream_host=opencode.ai
```

`requested_model` is what Codex asked for. `model` is what Navo actually sent upstream with the original request context.

## Codex Plugins Or Browser Tools Do Not Appear

Upgrade to Navo `0.1.3` or newer, regenerate the OpenCode catalog, and restart Codex:

```bash
npm install -g @rebel0x/navo@latest
navo on
```

Then quit and reopen Codex, or use the dashboard OpenCode/Codex mode buttons when they prompt for a Codex restart.

Navo `0.1.2` wrote `~/.codex/navo-models.json` with tool capability flags disabled. That can make Codex degrade plugin/browser/tool behavior while OpenCode mode is active. The newer catalog advertises text/search/function-tool support, but still does not claim image input support.

If a plugin reports an MCP error such as `resources/read`, that error is from the plugin runtime itself. Regenerating the catalog fixes Navo's model metadata, but a plugin runtime failure may still require restarting Codex or updating the affected plugin/Codex build.

To use Codex native models again:

```bash
navo codex-model gpt-5.5
navo proxy-stop
```

Then open a new Codex session.

## Restore Did Not Change The Current Session

Codex may keep provider settings for an already-running native-provider session.

After restore or model switching:

```bash
navo status
```

If the chat is already Navo-backed, the next request will be routed to the selected model. If the chat is still native Codex/OpenAI, open a new Codex session.

Opening a new chat can look surprising, but it is the reliable way for a native-provider chat to start using a custom provider/model while preserving existing chat history. Keep using the same project/workspace; the conversation is new, not the project files.

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
