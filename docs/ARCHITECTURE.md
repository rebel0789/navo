# Architecture

Navo has three pieces:

1. A CLI for editing Codex config safely.
2. A local dashboard on `127.0.0.1:17854`.
3. A local OpenCode connection on `127.0.0.1:17853/v1`.

## Provider Modes

### Codex Native

Navo removes its managed provider fields and writes a native Codex model:

```toml
model = "gpt-5.5"
```

Navo is not required in this mode.

### OpenCode Mode

Navo writes:

```toml
model = "deepseek-v4-flash"
model_provider = "opencode-go"
model_catalog_json = "/Users/you/.codex/navo-models.json"
```

And a managed provider block:

```toml
[model_providers.opencode-go]
name = "OpenCode Go"
base_url = "http://127.0.0.1:17853/v1"
wire_api = "responses"
supports_websockets = false
```

Codex sends Responses API requests to Navo. Navo converts them to the OpenCode Go endpoint documented for the selected model. GLM, Kimi, DeepSeek, and MiMo use:

```text
https://opencode.ai/zen/go/v1/chat/completions
```

MiniMax and Qwen use:

```text
https://opencode.ai/zen/go/v1/messages
```

## Routing

In single-model mode, Navo treats the selected model in Codex config as the source of truth. If an older Navo-backed chat asks for a previous model, Navo preserves the request body/context and changes only the upstream model.

When routing is enabled:

```text
No tools in request -> chat/planning model
Tools in request    -> agent/execution model
```

Logs include both model names:

```text
requested_model=gpt-5.4 model=deepseek-v4-flash upstream_host=opencode.ai
```

`requested_model` is what Codex asked for. `model` is what Navo actually sent upstream.

## State

Navo writes state under:

```text
~/.navo
```

Codex config is backed up before changes:

```text
~/.navo/backups
```

The OpenCode connection log is:

```text
~/.navo/proxy.log
```

Logs do not include prompts, messages, headers, or API keys.
