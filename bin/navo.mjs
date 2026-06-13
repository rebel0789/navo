#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import http from "node:http";
import { basename, dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import os from "node:os";
import { fileURLToPath } from "node:url";

const PROJECT_NAME = "Navo";
const VERSION = "0.1.3";
const GITHUB_REPO_URL = "https://github.com/rebel0789/navo";
const PROVIDER_ID = "opencode-go";
const PROVIDER_NAME = "OpenCode Go";
const OPENCODE_BASE_URL = process.env.OCGO_UPSTREAM_BASE_URL || "https://opencode.ai/zen/go/v1";
const MODELS_URL = `${OPENCODE_BASE_URL}/models`;
const DEFAULT_MODEL = "deepseek-v4-flash";
const DEFAULT_CODEX_MODEL = "gpt-5.5";
const DEFAULT_CLAUDE_TEST_MODEL = "minimax-m3";
const CODEX_APP_NAME = "Codex";
const CODEX_RESTART_TIMEOUT_MS = 8_000;
const DEFAULT_PROXY_PORT = 17853;
const DEFAULT_UI_PORT = 17854;
const MODEL_CATALOG_FILENAME = "navo-models.json";
const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_PROOF_FRESH_SECONDS = 300;
const DEFAULT_UPSTREAM_TIMEOUT_MS = 120_000;
const DEFAULT_PROXY_BODY_LIMIT_BYTES = 20 * 1024 * 1024;
const UI_BODY_LIMIT_BYTES = 256 * 1024;
const PRIVATE_DIR_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const UI_SESSION_HEADER = "x-navo-token";
const REASONING_EFFORTS = ["minimal", "low", "medium", "high", "xhigh"];
const APPROVAL_POLICIES = ["untrusted", "on-request", "on-failure", "never"];
const SANDBOX_MODES = ["read-only", "workspace-write", "danger-full-access"];
const KEYCHAIN_SERVICE = "navo";
const KEYCHAIN_ACCOUNT = "default";
const APP_DIR = process.env.NAVO_HOME || join(os.homedir(), ".navo");
const FILE_TOKEN_PATH = join(APP_DIR, "api-key");
const BACKUP_DIR = join(APP_DIR, "backups");
const PID_PATH = join(APP_DIR, "proxy.pid");
const LOG_PATH = join(APP_DIR, "proxy.log");
const UI_PID_PATH = join(APP_DIR, "ui.pid");
const UI_LOG_PATH = join(APP_DIR, "ui.log");
const ROUTING_PATH = join(APP_DIR, "routing.json");
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const INVOKED_NAME = basename(process.argv[1] || "navo").replace(/\.mjs$/u, "");
const CLI_NAME = INVOKED_NAME === "navo" ? INVOKED_NAME : "navo";
const MAX_REASONING_CACHE_ENTRIES = 500;
const reasoningContentByToolCallId = new Map();

const OPENCODE_MODEL_METADATA = new Map([
  ["deepseek-v4-flash", { name: "DeepSeek V4 Flash", note: "Default fast execution model", endpoint: "chat" }],
  ["deepseek-v4-pro", { name: "DeepSeek V4 Pro", note: "Deep coding/reasoning option", endpoint: "chat" }],
  ["glm-5.1", { name: "GLM-5.1", note: "Strong planning/chat pick", endpoint: "chat" }],
  ["glm-5", { name: "GLM-5", note: "Previous GLM fallback", endpoint: "chat" }],
  ["kimi-k2.7-code", { name: "Kimi K2.7 Code", note: "Current Kimi coding model", endpoint: "chat" }],
  ["kimi-k2.6", { name: "Kimi K2.6", note: "Strong agent/execution option", endpoint: "chat" }],
  ["mimo-v2.5-pro", { name: "MiMo V2.5 Pro", note: "MiMo stronger option", endpoint: "chat" }],
  ["mimo-v2.5", { name: "MiMo V2.5", note: "MiMo fast option", endpoint: "chat" }],
  ["minimax-m3", { name: "MiniMax M3", note: "MiniMax flagship option", endpoint: "messages" }],
  ["minimax-m2.7", { name: "MiniMax M2.7", note: "MiniMax fast option", endpoint: "messages" }],
  ["minimax-m2.5", { name: "MiniMax M2.5", note: "MiniMax fallback option", endpoint: "messages" }],
  ["qwen3.7-max", { name: "Qwen3.7 Max", note: "Top Qwen reasoning option", endpoint: "messages" }],
  ["qwen3.7-plus", { name: "Qwen3.7 Plus", note: "High-value Qwen option", endpoint: "messages" }],
  ["qwen3.6-plus", { name: "Qwen3.6 Plus", note: "Qwen long-context option", endpoint: "messages" }]
]);

const OPENCODE_MODEL_ALIASES = new Map([
  ["kimi-k2.7", "kimi-k2.7-code"]
]);

const CODEX_CHAT_MODELS = new Map([
  ...[...OPENCODE_MODEL_METADATA.entries()].map(([id, metadata]) => [id, metadata.note])
]);

const ANTHROPIC_ONLY_DOC_MODELS = new Set([
  ...[...OPENCODE_MODEL_METADATA.entries()]
    .filter(([, metadata]) => metadata.endpoint === "messages")
    .map(([id]) => id)
]);

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));

  try {
    switch (command) {
      case "help":
      case undefined:
        printHelp();
        break;
      case "version":
      case "--version":
      case "-v":
        console.log(`${PROJECT_NAME} ${VERSION}`);
        break;
      case "login":
        await login(options);
        break;
      case "token":
        process.stdout.write(`${readStoredToken()}\n`);
        break;
      case "configure":
      case "config":
        configure(options);
        break;
      case "on":
      case "use":
        configure(options);
        await startProxy(options);
        console.log("OpenCode Go is active. Open a new Codex chat/session to load the saved provider.");
        break;
      case "app":
      case "launch":
        configure(options);
        await startProxy(options);
        launchCodex();
        break;
      case "ui":
      case "dashboard":
        if (options.foreground) {
          await runUi(options);
        } else {
          await startUi(options);
        }
        break;
      case "ui-server":
        await runUi({ ...options, "no-open": true });
        break;
      case "ui-start":
      case "dashboard-start":
        await startUi(options);
        break;
      case "ui-stop":
      case "dashboard-stop":
        stopUi();
        break;
      case "ui-status":
      case "dashboard-status":
        await printUiStatus(options);
        break;
      case "off":
        restore(options);
        stopProxy();
        console.log("OpenCode Go is off. Open a new Codex chat/session to load the saved provider.");
        break;
      case "restore":
        restore(options);
        break;
      case "status":
        await status(options);
        break;
      case "verify":
      case "guard":
        await verify(options);
        break;
      case "models":
        await listModels(options);
        break;
      case "model":
      case "select":
      case "switch":
        await selectModel(options);
        break;
      case "codex-model":
      case "codex":
      case "native":
        await selectCodexModel(options);
        break;
      case "route":
      case "routing":
        await routeModels(options);
        break;
      case "probe":
      case "test":
        await probeOpenCode(options);
        break;
      case "probe-proxy":
        await probeProxy(options);
        break;
      case "probe-routing":
        await probeRouting(options);
        break;
      case "probe-claude":
        await probeClaude(options);
        break;
      case "proxy":
        await runProxy(options);
        break;
      case "proxy-start":
      case "start-proxy":
        await startProxy(options);
        break;
      case "proxy-stop":
      case "stop-proxy":
        stopProxy();
        break;
      case "proxy-status":
        await printProxyStatus(options);
        break;
      case "restart":
        stopProxy();
        await startProxy(options);
        break;
      case "backups":
        printBackups();
        break;
      case "logs":
      case "log":
        printLogs(options);
        break;
      case "snippet":
        printSnippet(options);
        break;
      case "doctor":
        runDoctor();
        break;
      default:
        fail(`Unknown command: ${command}\nRun "${CLI_NAME} help" for usage.`);
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

function parseArgs(argv) {
  const command = argv[0] && !argv[0].startsWith("-") ? argv[0] : "help";
  const args = command === "help" ? argv.slice(1) : argv.slice(1);
  const options = {};
  const positionals = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      positionals.push(...args.slice(index + 1));
      break;
    }

    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }

    const eqIndex = arg.indexOf("=");
    if (eqIndex !== -1) {
      options[arg.slice(2, eqIndex)] = arg.slice(eqIndex + 1);
      continue;
    }

    const key = arg.slice(2);
    const next = args[index + 1];
    if (next && !next.startsWith("--")) {
      options[key] = next;
      index += 1;
    } else {
      options[key] = true;
    }
  }

  options._ = positionals;
  return { command, options };
}

function printHelp() {
  console.log(`${PROJECT_NAME} - Safe model navigation for Codex and OpenCode

Usage:
  ${CLI_NAME} login [--stdin | --api-key <key>]
  ${CLI_NAME} on [--model ${DEFAULT_MODEL}]
  ${CLI_NAME} off
  ${CLI_NAME} app [--model ${DEFAULT_MODEL}]
  ${CLI_NAME} ui
  ${CLI_NAME} ui-stop
  ${CLI_NAME} model [opencode-model]
  ${CLI_NAME} codex-model [codex-model]
  ${CLI_NAME} route --chat glm-5.1 --agent ${DEFAULT_MODEL}
  ${CLI_NAME} route off
  ${CLI_NAME} status
  ${CLI_NAME} verify [--fresh]
  ${CLI_NAME} logs [--lines 100]
  ${CLI_NAME} version

Advanced:
  ${CLI_NAME} configure [--model ${DEFAULT_MODEL}] [--auth keychain|env] [--port ${DEFAULT_PROXY_PORT}]
  ${CLI_NAME} ui --port ${DEFAULT_UI_PORT} [--opencode-port ${DEFAULT_PROXY_PORT}] [--no-open]
  ${CLI_NAME} ui --foreground
  ${CLI_NAME} ui-status
  ${CLI_NAME} launch [--model ${DEFAULT_MODEL}] [--port ${DEFAULT_PROXY_PORT}]
  ${CLI_NAME} codex-model ${DEFAULT_CODEX_MODEL}
  ${CLI_NAME} proxy-start [--port ${DEFAULT_PROXY_PORT}]
  ${CLI_NAME} proxy-stop
  ${CLI_NAME} restart
  ${CLI_NAME} guard --fix
  ${CLI_NAME} probe
  ${CLI_NAME} probe-claude [--model ${DEFAULT_CLAUDE_TEST_MODEL}]
  ${CLI_NAME} probe-proxy
  ${CLI_NAME} probe-routing
  ${CLI_NAME} restore [--backup <path>]
  ${CLI_NAME} backups
  ${CLI_NAME} models [--all]

How it works:
  - Codex currently uses the Responses API for custom providers.
  - OpenCode Go exposes OpenAI-compatible Chat Completions, not Responses.
  - This CLI configures Codex to use a local Responses-to-Chat adapter.
  - The OpenCode connection listens on 127.0.0.1 only and requires your OpenCode Go bearer token from Codex's auth command.

Codex-compatible OpenCode Go models in this helper:
  ${[...CODEX_CHAT_MODELS.keys()].join(", ")}
`);
}

async function login(options) {
  let token = "";
  if (typeof options["api-key"] === "string") {
    token = options["api-key"].trim();
  } else if (options.stdin) {
    token = readAllStdin().trim();
  } else {
    token = (await readHidden("OpenCode Go API key: ")).trim();
  }

  if (!token) {
    throw new Error("No API key provided.");
  }

  storeToken(token);
  console.log(`Stored OpenCode Go API key using ${tokenStoreName()}.`);
}

function configure(options) {
  const model = normalizeModel(String(options.model || DEFAULT_MODEL));
  validateModel(model, Boolean(options.force));

  const authMode = String(options.auth || "keychain");
  if (!["keychain", "env"].includes(authMode)) {
    throw new Error('Invalid --auth value. Use "keychain" or "env".');
  }

  const port = readPort(options);
  const configPath = codexConfigPath();
  const catalogPath = codexModelCatalogPath(configPath);
  const original = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  const backupPath = backupConfig(configPath, original, isManagedConfig(original) ? "managed-config" : "config");
  writeModelCatalog(catalogPath, model);
  removeRoutingConfig();
  const updated = updateCodexConfig(original, { model, authMode, port, catalogPath });

  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, updated, "utf8");

  console.log(`Configured Codex provider "${PROVIDER_ID}" with model "${model}".`);
  console.log(`Codex will call local OpenCode endpoint: ${proxyBaseUrl(port)}`);
  console.log(`Model catalog: ${catalogPath}`);
  console.log(`Backup: ${backupPath}`);

  if (authMode === "keychain" && !hasStoredToken()) {
    console.log(`Next: run "${CLI_NAME} login" so Codex can fetch your OpenCode Go API key.`);
  }

  if (authMode === "env") {
    console.log("Next: make OPENCODE_API_KEY available to the Codex App or shell before starting Codex.");
  }

  console.log(`Start OpenCode mode with "${CLI_NAME} proxy-start", or use "${CLI_NAME} app" to start it and open Codex.`);
}

function launchCodex({ preferActivate = true } = {}) {
  if (process.platform === "darwin") {
    if (preferActivate) {
      const activated = spawnSync("osascript", ["-e", `tell application "${CODEX_APP_NAME}" to activate`], {
        encoding: "utf8"
      });
      if (!activated.error && activated.status === 0) {
        console.log("Activated Codex App.");
        return;
      }
    }

    const result = spawnSync("open", ["-a", CODEX_APP_NAME], { encoding: "utf8" });
    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      throw new Error((result.stderr || result.stdout || "Failed to launch Codex.").trim());
    }
    console.log("Launched Codex App.");
    return;
  }

  const result = spawnSync("codex", ["app"], { encoding: "utf8" });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "Failed to launch Codex.").trim());
  }
  console.log("Launched Codex App.");
}

function restore(options) {
  const configPath = codexConfigPath();
  const backupPath = typeof options.backup === "string" ? options.backup : latestBackupPath();
  if (!backupPath || !existsSync(backupPath)) {
    throw new Error(`No non-OpenCode backup found in ${backupDirs().join(", ")}. Run "${CLI_NAME} backups" to inspect available backups.`);
  }

  const current = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  backupConfig(configPath, current, "pre-restore");
  writeFileSync(configPath, readFileSync(backupPath, "utf8"), "utf8");
  removeOwnedCatalogIfUnused(configPath);
  console.log(`Restored Codex config from ${backupPath}.`);
  console.log(`Run "${CLI_NAME} proxy-stop" if you no longer need OpenCode mode, or use "${CLI_NAME} off" next time.`);
}

async function status(options) {
  const state = await buildState(options);

  console.log(`Safety: ${state.safety.label}`);
  console.log(`Codex config: ${state.codex.configPath}`);
  console.log(`Active model: ${state.codex.model}`);
  console.log(`Active provider: ${state.codex.provider}`);
  console.log(`Model catalog: ${state.codex.catalog}`);
  console.log(`OpenCode Go model catalog: ${state.codex.modelCatalogActive ? "present" : "not active"}`);
  console.log(`OpenCode Go provider block: ${state.codex.hasProvider ? "present" : "missing"}`);
  console.log(`OpenCode Go key: ${state.key.available ? `available via ${state.key.store}` : "not found"}`);
  console.log(`Routing: ${state.routingSummary}`);
  console.log(`OpenCode connection: ${state.connection.running ? `running on ${state.connection.url}` : "not running"}`);
  if (!state.connection.running && state.connection.error) {
    console.log(`OpenCode detail: ${state.connection.error}`);
  }
  if (state.safety.issues.length > 0 && !state.safety.nativeCodex) {
    console.log(`Safety detail: ${state.safety.issues.join("; ")}`);
  } else if (state.safety.nativeCodex) {
    console.log("Safety detail: native Codex path selected; OpenCode mode is not active.");
  }
}

async function buildState(options = {}) {
  const configPath = codexConfigPath();
  const text = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  const model = readTopLevelValue(text, "model") || "(unset)";
  const provider = readTopLevelValue(text, "model_provider") || "(unset)";
  const catalog = readTopLevelValue(text, "model_catalog_json") || "(unset)";
  const managedCatalogPath = codexModelCatalogPath(configPath);
  const hasProvider = new RegExp(`^\\s*\\[model_providers\\.${escapeRegExp(PROVIDER_ID)}\\]\\s*$`, "m").test(text);
  const port = readPort(options);
  const health = await proxyHealth(port);
  const routing = readRoutingConfig();
  let key = { available: false, store: null, masked: "" };
  try {
    const token = readStoredToken();
    key = { available: true, store: tokenStoreName(), masked: maskToken(token) };
  } catch {
    // Keep status/UI usable before login.
  }

  const state = {
    projectName: PROJECT_NAME,
    providerId: PROVIDER_ID,
    providerName: PROVIDER_NAME,
    mode: provider === PROVIDER_ID ? "opencode" : "codex",
    codex: {
      configPath,
      model,
      provider,
      catalog,
      modelCatalogPath: managedCatalogPath,
      modelCatalogActive: catalog === managedCatalogPath && existsSync(managedCatalogPath),
      hasProvider,
      settings: readCodexSettings(text)
    },
    key,
    routing: routing || { enabled: false, chatModel: "", agentModel: "" },
    routingSummary: routingSummary(),
    connection: {
      running: health.ok,
      error: health.ok ? null : health.error || null,
      url: proxyBaseUrl(port),
      port,
      logPath: activeLogPath(),
      pidFiles: connectionPidFiles()
    },
    contextWindow: opencodeModelContextWindow(model),
    models: modelOptions(model, routing),
    codexModels: codexModelOptions(model),
    logs: recentLogLines(80),
    backups: backupSummaries(),
    paths: {
      appDir: APP_DIR
    }
  };
  state.safety = safetyReport(state);
  return state;
}

function contextWindowLabel(tokens) {
  if (!Number.isFinite(tokens) || tokens <= 0) {
    return "Unknown";
  }
  if (tokens >= 1_000_000) {
    return `${Math.round(tokens / 100_000) / 10}M`;
  }
  if (tokens >= 1_000) {
    return `${Math.round(tokens / 1_000)}K`;
  }
  return String(tokens);
}

function opencodeModelMetadata(model) {
  return OPENCODE_MODEL_METADATA.get(normalizeModel(String(model || "").trim())) || null;
}

function opencodeModelContextWindow(model) {
  const metadata = opencodeModelMetadata(model);
  const tokens = metadata?.contextWindow;
  if (!Number.isFinite(tokens) || tokens <= 0) {
    return null;
  }
  return {
    tokens,
    label: contextWindowLabel(tokens),
    source: "OpenCode docs"
  };
}

function opencodeModelEndpoint(model) {
  return opencodeModelMetadata(model)?.endpoint === "messages" ? "messages" : "chat";
}

function opencodeEndpointPath(model) {
  return opencodeModelEndpoint(model) === "messages" ? "/messages" : "/chat/completions";
}

function readCodexSettings(text) {
  return {
    model_reasoning_effort: readTopLevelValue(text, "model_reasoning_effort") || "",
    approval_policy: readTopLevelValue(text, "approval_policy") || "",
    sandbox_mode: readTopLevelValue(text, "sandbox_mode") || ""
  };
}

function modelOptions(activeModel, routing) {
  return [...CODEX_CHAT_MODELS.entries()].map(([id, note]) => ({
    id,
    name: opencodeModelMetadata(id)?.name || id,
    note,
    contextWindow: opencodeModelContextWindow(id),
    active: id === activeModel,
    routeChat: routing?.enabled && routing.chatModel === id,
    routeAgent: routing?.enabled && routing.agentModel === id
  }));
}

function codexModelOptions(activeModel) {
  const fallback = [
    { id: DEFAULT_CODEX_MODEL, name: "GPT-5.5" },
    { id: "gpt-5.4", name: "GPT-5.4" },
    { id: "gpt-5.4-mini", name: "GPT-5.4-Mini" },
    { id: "gpt-5.3-codex-spark", name: "GPT-5.3-Codex-Spark" },
    { id: "codex-auto-review", name: "Codex Auto Review" }
  ];
  const cachePath = join(process.env.CODEX_HOME || join(os.homedir(), ".codex"), "models_cache.json");
  const seen = new Set();
  const output = [];

  if (existsSync(cachePath)) {
    try {
      const cached = JSON.parse(readFileSync(cachePath, "utf8"));
      const models = Array.isArray(cached.models) ? cached.models : [];
      for (const model of models) {
        const id = String(model.slug || model.id || model.name || "").trim();
        if (!id || seen.has(id) || CODEX_CHAT_MODELS.has(id)) {
          continue;
        }
        seen.add(id);
        output.push({
          id,
          name: String(model.display_name || model.name || id),
          active: id === activeModel
        });
      }
    } catch {
      // Fall through to static defaults.
    }
  }

  for (const model of fallback) {
    if (!seen.has(model.id)) {
      seen.add(model.id);
      output.push({ ...model, active: model.id === activeModel });
    }
  }

  return output;
}

async function verify(options) {
  if (options.fix) {
    configure({ ...options, model: options.model || DEFAULT_MODEL });
    await startProxy(options);
  }

  const state = await buildState(options);
  const requireFresh = Boolean(options.fresh || options["require-fresh"]);
  const freshSeconds = readFreshSeconds(options);
  const proofFresh = state.safety.proof?.fresh ?? false;
  console.log(`Safety: ${state.safety.label}`);
  for (const check of state.safety.checks) {
    console.log(`${check.ok ? "ok" : "fail"} ${check.name}: ${check.detail}`);
  }

  if (state.safety.recentOpenCodeRequest) {
    console.log(`last OpenCode request: ${state.safety.recentOpenCodeRequest}`);
    console.log(`proof age: ${formatAge(state.safety.proof.ageSeconds)}${state.safety.proof.fresh ? " fresh" : " stale"}`);
  } else {
    console.log("last OpenCode request: not seen in activity log yet");
  }

  if (requireFresh) {
    console.log(`${proofFresh ? "ok" : "fail"} fresh proof: ${proofFresh ? `within ${freshSeconds}s` : `missing or older than ${freshSeconds}s`}`);
  }

  if (!state.safety.ready || (requireFresh && !proofFresh)) {
    console.log(`Fix: ${CLI_NAME} guard --fix && open a new Codex session.`);
    if (requireFresh) {
      console.log(`Then run: ${CLI_NAME} probe-routing && ${CLI_NAME} verify --fresh`);
    }
    process.exitCode = 1;
  }
}

function safetyReport(state) {
  const proof = latestOpenCodeProof();
  const recentOpenCodeRequest = proof.line;
  const checks = [
    {
      name: "provider",
      ok: state.codex.provider === PROVIDER_ID,
      detail: state.codex.provider === PROVIDER_ID
        ? PROVIDER_ID
        : `current provider is ${state.codex.provider}; Codex may use OpenAI`
    },
    {
      name: "model catalog",
      ok: state.codex.modelCatalogActive,
      detail: state.codex.modelCatalogActive ? state.codex.catalog : "Navo model catalog is not active"
    },
    {
      name: "provider block",
      ok: state.codex.hasProvider,
      detail: state.codex.hasProvider ? "present" : "missing"
    },
    {
      name: "OpenCode connection",
      ok: state.connection.running,
      detail: state.connection.running ? state.connection.url : (state.connection.error || "not running")
    },
    {
      name: "OpenCode key",
      ok: state.key.available,
      detail: state.key.available ? state.key.store : "missing"
    }
  ];
  const ready = checks.every((check) => check.ok);
  const issues = checks.filter((check) => !check.ok).map((check) => `${check.name}: ${check.detail}`);
  const nativeCodex = state.mode === "codex" && codexModelOptions(state.codex.model).some((model) => model.id === state.codex.model);
  const label = nativeCodex
    ? "Codex native active"
    : ready
    ? (recentOpenCodeRequest ? "OpenCode path ready" : "OpenCode path configured; run one test turn to prove upstream")
    : "OpenAI risk: Codex is not fully routed through Navo";
  return {
    ready,
    label,
    checks,
    issues,
    nativeCodex,
    recentOpenCodeRequest,
    proof
  };
}

function latestOpenCodeProof() {
  const logs = recentLogLines(250).lines;
  const line = [...logs].reverse().find((entry) =>
    entry.includes("status=200") &&
    entry.includes("upstream_host=opencode.ai") &&
    (entry.includes("upstream_path=/chat/completions") || entry.includes("upstream_path=/messages"))
  ) || "";
  const at = parseLogTimestamp(line);
  const ageSeconds = at ? Math.max(0, Math.round((Date.now() - at.getTime()) / 1000)) : null;
  return {
    line,
    at: at ? at.toISOString() : null,
    ageSeconds,
    fresh: ageSeconds !== null && ageSeconds <= DEFAULT_PROOF_FRESH_SECONDS
  };
}

function parseLogTimestamp(line) {
  const match = String(line || "").match(/^(\d{4}-\d{2}-\d{2}T[^\s]+Z)\s/);
  if (!match) {
    return null;
  }
  const date = new Date(match[1]);
  return Number.isNaN(date.getTime()) ? null : date;
}

function readFreshSeconds(options) {
  const value = Number(options["fresh-seconds"] || DEFAULT_PROOF_FRESH_SECONDS);
  if (!Number.isInteger(value) || value < 1 || value > 86_400) {
    throw new Error(`Invalid --fresh-seconds value: ${options["fresh-seconds"]}`);
  }
  return value;
}

function formatAge(seconds) {
  if (seconds === null || seconds === undefined) {
    return "unknown";
  }
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) {
    return `${minutes}m ${rest}s`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function latestOpenCodeRequestLine() {
  return latestOpenCodeProof().line;
}

async function listModels(options = {}) {
  if (!options.all) {
    for (const [id, metadata] of OPENCODE_MODEL_METADATA.entries()) {
      const endpoint = metadata.endpoint === "messages" ? "messages" : "chat-completions";
      console.log(`* ${id}  ${metadata.name} (${endpoint})`);
    }
    console.log(`Source: OpenCode Go documentation. Run "${CLI_NAME} models --all" to inspect the live /models endpoint.`);
    return;
  }

  const response = await fetchWithTimeout(MODELS_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch models: HTTP ${response.status}`);
  }

  const body = await response.json();
  const models = Array.isArray(body.data) ? body.data : [];
  for (const item of models) {
    const id = item.id;
    const metadata = opencodeModelMetadata(id);
    const note = metadata
      ? `${metadata.name} (${metadata.endpoint === "messages" ? "messages" : "chat-completions"})`
      : "not in Navo's docs-backed selector; verify OpenCode docs before using";
    console.log(`${metadata ? "*" : "-"} ${id}  ${note}`);
  }
}

async function selectModel(options) {
  const requested = normalizeModel(String(options.model || options._?.[0] || "").trim());
  if (requested) {
    switchModel(requested, options);
    return;
  }

  const current = readTopLevelValue(existsSync(codexConfigPath()) ? readFileSync(codexConfigPath(), "utf8") : "", "model");
  if (!process.stdin.isTTY) {
    throw new Error(`Pass a model name, for example: ${CLI_NAME} model ${DEFAULT_MODEL}`);
  }

  const model = await pickModel("Choose active OpenCode Go model", { current });
  if (!model) {
    throw new Error("No model selected.");
  }
  switchModel(model, options);
}

async function selectCodexModel(options) {
  const requested = String(options.model || options._?.[0] || "").trim();
  if (requested) {
    switchToCodexModel(requested, options);
    return;
  }

  const current = readTopLevelValue(existsSync(codexConfigPath()) ? readFileSync(codexConfigPath(), "utf8") : "", "model");
  if (!process.stdin.isTTY) {
    throw new Error(`Pass a Codex model name, for example: ${CLI_NAME} codex-model ${DEFAULT_CODEX_MODEL}`);
  }

  const model = await pickCodexModel("Choose Codex native model", { current });
  if (!model) {
    throw new Error("No Codex model selected.");
  }
  switchToCodexModel(model, options);
}

function switchModel(model, options) {
  validateModel(model, Boolean(options.force));
  removeRoutingConfig();
  configure({ ...options, model });
  console.log(`Selected OpenCode Go model: ${model}`);
  console.log("Single-model mode selected; split chat/agent routing is disabled.");
  console.log("Open a new Codex chat/session for the saved model to take effect.");
}

function switchToCodexModel(model, options = {}) {
  validateCodexModel(model, Boolean(options.force));
  const configPath = codexConfigPath();
  const original = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  const backupPath = backupConfig(configPath, original, "codex-native");
  const updated = updateCodexNativeConfig(original, { model });

  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, updated, "utf8");
  removeOwnedCatalogIfUnused(configPath);
  if (!options["keep-connection"] && !options.keepConnection) {
    stopProxy();
  }

  console.log(`Selected Codex native model: ${model}.`);
  console.log(`Backup: ${backupPath}`);
  console.log("Open a new Codex chat/session for the saved model to take effect.");
}

async function routeModels(options) {
  const mode = String(options._?.[0] || "").trim().toLowerCase();
  if (["off", "disable", "disabled", "none"].includes(mode)) {
    removeRoutingConfig();
    console.log("Model routing disabled. OpenCode mode will use the model Codex requests.");
    return;
  }

  const existing = readRoutingConfig();
  const chatModel = normalizeModel(String(options.chat || options.plan || options.planning || existing?.chatModel || "").trim());
  const agentModel = normalizeModel(String(options.agent || options.execute || options.exec || existing?.agentModel || "").trim());

  if (!chatModel && !agentModel) {
    if (!process.stdin.isTTY) {
      console.log(`Routing: ${routingSummary()}`);
      console.log(`Enable with: ${CLI_NAME} route --chat glm-5.1 --agent ${DEFAULT_MODEL}`);
      console.log("No-tool turns route to --chat. Tool-enabled turns route to --agent.");
      return;
    }

    const pickedChat = await pickModel("Choose chat/planning model", { current: existing?.chatModel || "glm-5.1" });
    const pickedAgent = await pickModel("Choose agent/execution model", { current: existing?.agentModel || DEFAULT_MODEL });
    if (!pickedChat || !pickedAgent) {
      throw new Error("Routing setup cancelled.");
    }
    writeRouting(pickedChat, pickedAgent, options);
    return;
  }

  if (!chatModel || !agentModel) {
    throw new Error(`Routing needs both models. Example: ${CLI_NAME} route --chat glm-5.1 --agent ${DEFAULT_MODEL}`);
  }

  writeRouting(chatModel, agentModel, options);
}

function writeRouting(chatModel, agentModel, options) {
  validateModel(chatModel, Boolean(options.force));
  validateModel(agentModel, Boolean(options.force));
  writeRoutingConfig({ enabled: true, chatModel, agentModel });
  console.log(`Model routing enabled: chat/planning=${chatModel}, agent/execution=${agentModel}`);
  console.log(`Restart OpenCode mode with \`${CLI_NAME} restart\` so detached processes load the new routing code if needed.`);
}

async function probeOpenCode(options) {
  const model = normalizeModel(String(options.model || DEFAULT_MODEL));
  validateModel(model, Boolean(options.force));
  const token = readStoredToken();

  const json = await testOpenCodeToken(token, model);
  const content = json?.choices?.[0]?.message?.content;
  console.log(content || JSON.stringify(json, null, 2));
}

async function testOpenCodeToken(token, model = DEFAULT_MODEL) {
  const selectedModel = normalizeModel(String(model || DEFAULT_MODEL));
  validateModel(selectedModel, false);
  if (!token || !String(token).trim()) {
    throw new Error("Enter an OpenCode API key first.");
  }

  const endpoint = opencodeModelEndpoint(selectedModel);
  const requestBody = {
    model: selectedModel,
    messages: [{ role: "user", content: "Reply with exactly: ok" }],
    max_tokens: 8,
    stream: false
  };
  const response = await fetchWithTimeout(`${OPENCODE_BASE_URL}${opencodeEndpointPath(selectedModel)}`, {
    method: "POST",
    headers: openCodeRequestHeaders(token, endpoint),
    body: JSON.stringify(endpoint === "messages" ? chatCompletionsToAnthropicMessages(requestBody) : requestBody)
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`OpenCode probe failed: HTTP ${response.status}\n${text}`);
  }

  try {
    const json = JSON.parse(text);
    return endpoint === "messages" ? anthropicMessageToChatCompletion(json, requestBody) : json;
  } catch {
    return { raw: text };
  }
}

function maskToken(token) {
  const text = String(token || "").trim();
  if (!text) {
    return "";
  }
  if (text.length <= 10) {
    return `${text.slice(0, 2)}••••${text.slice(-2)}`;
  }
  return `${text.slice(0, 5)}••••••••${text.slice(-4)}`;
}

async function probeProxy(options) {
  const model = normalizeModel(String(options.model || DEFAULT_MODEL));
  validateModel(model, Boolean(options.force));
  const json = await postProxyResponse(options, {
    model,
    input: "Reply with exactly: ok",
    max_output_tokens: 8,
    stream: false
  });
  console.log(json.output_text || JSON.stringify(json.output || json, null, 2));
}

async function probeRouting(options) {
  const routing = readRoutingConfig();
  if (!routing?.enabled) {
    throw new Error(`Routing is disabled. Enable it with: ${CLI_NAME} route --chat glm-5.1 --agent ${DEFAULT_MODEL}`);
  }

  const chatJson = await postProxyResponse(options, {
    model: routing.agentModel,
    input: "Reply with exactly: chat",
    max_output_tokens: 8,
    stream: false
  });
  console.log(`chat probe response_model=${chatJson.model || "(unknown)"}`);

  const agentJson = await postProxyResponse(options, {
    model: routing.chatModel,
    input: "Reply with exactly: agent",
    tools: [{
      type: "function",
      name: "noop",
      description: "No-op routing probe.",
      parameters: {
        type: "object",
        properties: {}
      }
    }],
    max_output_tokens: 8,
    stream: false
  });
  console.log(`agent probe response_model=${agentJson.model || "(unknown)"}`);
  console.log("OpenCode proof:");
  for (const line of recentLogLines(8).lines.filter((entry) => entry.includes("upstream_host=opencode.ai")).slice(-4)) {
    console.log(line);
  }
}

async function postProxyResponse(options, body) {
  const port = readPort(options);
  const token = readStoredToken();
  const response = await fetchWithTimeout(`${proxyBaseUrl(port)}/responses`, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`OpenCode probe failed: HTTP ${response.status}\n${text}`);
  }

  return JSON.parse(text);
}

async function probeClaude(options) {
  const model = String(options.model || DEFAULT_CLAUDE_TEST_MODEL);
  validateClaudeModel(model, Boolean(options.force));
  const token = readStoredToken();

  const response = await fetchWithTimeout(`${OPENCODE_BASE_URL}/messages`, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${token}`,
      "x-api-key": token,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model,
      max_tokens: 8,
      messages: [{ role: "user", content: "Reply with exactly: ok" }]
    })
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Claude-style probe failed: HTTP ${response.status}\n${text}`);
  }

  const json = JSON.parse(text);
  const content = Array.isArray(json.content)
    ? json.content.map((part) => part.text || "").join("")
    : JSON.stringify(json);
  console.log(content || JSON.stringify(json, null, 2));
}

function printSnippet(options) {
  const model = normalizeModel(String(options.model || DEFAULT_MODEL));
  validateModel(model, Boolean(options.force));
  const authMode = String(options.auth || "keychain");
  process.stdout.write(buildManagedConfigBlock({ model, authMode, port: readPort(options) }));
}

function runDoctor() {
  const result = spawnSync("codex", ["doctor", "--summary", "--ascii"], {
    stdio: "inherit"
  });

  if (result.error) {
    throw result.error;
  }

  process.exitCode = result.status ?? 1;
}

async function runUi(options) {
  const uiPort = readUiPort(options);
  const opencodeOptions = { ...options, port: options["opencode-port"] || DEFAULT_PROXY_PORT };
  const url = `http://127.0.0.1:${uiPort}`;
  const uiSecurity = {
    token: createSessionToken(),
    allowedOrigins: new Set([
      `http://127.0.0.1:${uiPort}`,
      `http://localhost:${uiPort}`
    ])
  };

  ensurePrivateAppDir();

  const server = http.createServer((req, res) => {
    handleUiRequest(req, res, opencodeOptions, uiSecurity).catch((error) => {
      sendUiError(res, error);
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(uiPort, "127.0.0.1", resolve);
  });

  writePrivateFile(UI_PID_PATH, `${process.pid}\n`);
  console.log(`${PROJECT_NAME} dashboard: ${url}`);
  console.log(`OpenCode local endpoint: ${proxyBaseUrl(readPort(opencodeOptions))}`);
  if (!options.foreground) {
    console.log("Dashboard server is running.");
  } else {
    console.log("Press Ctrl+C to stop the dashboard.");
  }

  if (!options["no-open"]) {
    openUrlOnce(url, options);
  }

  const shutdown = () => {
    try {
      if (existsSync(UI_PID_PATH) && readFileSync(UI_PID_PATH, "utf8").trim() === String(process.pid)) {
        unlinkSync(UI_PID_PATH);
      }
    } catch {
      // Best effort cleanup.
    }
    server.close(() => process.exit(0));
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

async function startUi(options) {
  const uiPort = readUiPort(options);
  const opencodePort = options["opencode-port"] || DEFAULT_PROXY_PORT;
  const url = `http://127.0.0.1:${uiPort}`;
  const health = await uiHealth(uiPort);
  if (health.ok) {
    console.log(`${PROJECT_NAME} dashboard already running: ${url}`);
    if (!options["no-open"]) {
      openUrlOnce(url, options);
    }
    return;
  }

  ensurePrivateAppDir();
  const logFd = openSync(UI_LOG_PATH, "a");
  chmodBestEffort(UI_LOG_PATH, PRIVATE_FILE_MODE);
  const args = [
    SCRIPT_PATH,
    "ui-server",
    "--port",
    String(uiPort),
    "--opencode-port",
    String(opencodePort),
    "--no-open"
  ];
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: { ...process.env }
  });
  child.unref();
  closeSync(logFd);
  writePrivateFile(UI_PID_PATH, `${child.pid}\n`);

  for (let attempt = 0; attempt < 40; attempt += 1) {
    await sleep(125);
    const nextHealth = await uiHealth(uiPort);
    if (nextHealth.ok) {
      console.log(`${PROJECT_NAME} dashboard: ${url}`);
      console.log(`OpenCode local endpoint: ${proxyBaseUrl(Number(opencodePort) || DEFAULT_PROXY_PORT)}`);
      console.log(`Dashboard log: ${UI_LOG_PATH}`);
      if (!options["no-open"]) {
        openUrlOnce(url, options);
      }
      return;
    }
  }

  throw new Error(`Dashboard did not become ready. Check ${UI_LOG_PATH}.`);
}

function stopUi() {
  if (!existsSync(UI_PID_PATH)) {
    console.log("Navo dashboard pid file not found; nothing to stop.");
    return;
  }

  const pid = Number(readFileSync(UI_PID_PATH, "utf8").trim());
  try {
    if (Number.isInteger(pid) && pid > 0) {
      process.kill(pid, "SIGTERM");
      console.log(`Stopped Navo dashboard process ${pid}.`);
    }
  } catch {
    console.log(`Navo dashboard process ${pid} was not running; removed stale pid file.`);
  }
  if (existsSync(UI_PID_PATH)) {
    unlinkSync(UI_PID_PATH);
  }
}

async function printUiStatus(options) {
  const uiPort = readUiPort(options);
  const health = await uiHealth(uiPort);
  console.log(`Navo dashboard: ${health.ok ? "running" : "not running"}`);
  console.log(`URL: http://127.0.0.1:${uiPort}`);
  if (existsSync(UI_PID_PATH)) {
    console.log(`PID file: ${UI_PID_PATH} (${readFileSync(UI_PID_PATH, "utf8").trim()})`);
  }
  console.log(`Log: ${UI_LOG_PATH}`);
  if (!health.ok && health.error) {
    console.log(`Detail: ${health.error}`);
  }
}

async function uiHealth(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(800)
    });
    if (response.ok) {
      return { ok: true };
    }
    const fallback = await fetch(`http://127.0.0.1:${port}/`, {
      signal: AbortSignal.timeout(800)
    });
    return { ok: fallback.ok };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message === "fetch failed" ? `not reachable on 127.0.0.1:${port}` : message };
  }
}

async function handleUiRequest(req, res, opencodeOptions, uiSecurity) {
  const url = new URL(req.url || "/", "http://127.0.0.1");

  if (req.method === "GET" && url.pathname === "/") {
    sendHtml(res, dashboardHtmlV2(uiSecurity.token));
    return;
  }

  if (req.method === "GET" && url.pathname === "/favicon.ico") {
    sendSvg(res, faviconSvg());
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/state") {
    sendJson(res, 200, { ok: true, state: await buildState(opencodeOptions) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/logs") {
    const lines = Number(url.searchParams.get("lines") || 120);
    sendJson(res, 200, { ok: true, logs: recentLogLines(lines) });
    return;
  }

  if (req.method !== "POST" || !url.pathname.startsWith("/api/")) {
    sendJson(res, 404, { ok: false, error: "Not found" });
    return;
  }

  verifyUiMutationRequest(req, uiSecurity);
  const body = await readJsonBody(req, UI_BODY_LIMIT_BYTES);

  switch (url.pathname) {
    case "/api/key":
      await uiAction(res, opencodeOptions, async () => {
        const token = String(body.apiKey || body.key || "").trim();
        if (!token) {
          throw new Error("Enter an OpenCode API key first.");
        }
        storeToken(token);
      });
      return;
    case "/api/clear-key":
      await uiAction(res, opencodeOptions, async () => {
        clearStoredToken();
      });
      return;
    case "/api/clear-activity":
      await uiAction(res, opencodeOptions, async () => {
        clearActivityLog();
      });
      return;
    case "/api/test-opencode":
      await uiAction(res, opencodeOptions, async () => {
        const model = uiOpenCodeModel(body);
        validateModel(model, Boolean(body.force));
        const token = String(body.apiKey || body.key || "").trim() || readStoredToken();
        const { upstreamModel } = await testAndRecordOpenCodeToken(token, model);
        return {
          message: `API key active. OpenCode accepted ${upstreamModel}.`,
          test: {
            ok: true,
            model,
            upstreamModel
          }
        };
      });
      return;
    case "/api/start-opencode":
      await uiAction(res, opencodeOptions, async () => {
        const model = uiOpenCodeModel(body);
        validateModel(model, Boolean(body.force));
        removeRoutingConfig();
        const token = String(body.apiKey || body.key || "").trim();
        let upstreamModel = model;
        if (token) {
          ({ upstreamModel } = await testAndRecordOpenCodeToken(token, model));
          storeToken(token);
        } else {
          ({ upstreamModel } = await testAndRecordOpenCodeToken(readStoredToken(), model));
        }
        if (!hasStoredToken()) {
          throw new Error("Enter an OpenCode API key first.");
        }
        configure({ ...opencodeOptions, model });
        await startProxy(opencodeOptions);
        await restartCodexIfRequested(body);
        return {
          message: `API key active. OpenCode mode started with ${upstreamModel}.`,
          test: {
            ok: true,
            model,
            upstreamModel
          }
        };
      });
      return;
    case "/api/on":
      await uiAction(res, opencodeOptions, async () => {
        removeRoutingConfig();
        configure({ ...opencodeOptions, model: uiOpenCodeModel(body) });
        await startProxy(opencodeOptions);
        await restartCodexIfRequested(body);
      });
      return;
    case "/api/guard":
      await uiAction(res, opencodeOptions, async () => {
        removeRoutingConfig();
        configure({ ...opencodeOptions, model: uiOpenCodeModel(body) });
        await startProxy(opencodeOptions);
        if (body.restartCodex) {
          await restartCodexApp();
        }
      });
      return;
    case "/api/off":
      await uiAction(res, opencodeOptions, async () => {
        restore(opencodeOptions);
        stopProxy();
      });
      return;
    case "/api/stop-opencode":
      await uiAction(res, opencodeOptions, async () => {
        stopProxy();
      });
      return;
    case "/api/model":
      await uiAction(res, opencodeOptions, async () => {
        const model = normalizeModel(String(body.model || "").trim());
        if (!model) {
          throw new Error("Choose a model first.");
        }
        switchModel(model, opencodeOptions);
        await startProxy(opencodeOptions);
        await restartCodexIfRequested(body);
      });
      return;
    case "/api/codex-model":
      await uiAction(res, opencodeOptions, async () => {
        const model = String(body.model || "").trim();
        if (!model) {
          throw new Error("Choose a Codex model first.");
        }
        switchToCodexModel(model, { ...opencodeOptions, keepConnection: body.keepConnection });
        await restartCodexIfRequested(body);
      });
      return;
    case "/api/route":
      await uiAction(res, opencodeOptions, async () => {
        if (!body.enabled) {
          removeRoutingConfig();
          return;
        }
        const chatModel = normalizeModel(String(body.chatModel || "").trim());
        const agentModel = normalizeModel(String(body.agentModel || "").trim());
        if (!chatModel || !agentModel) {
          throw new Error("Routing needs both chat and agent models.");
        }
        writeRouting(chatModel, agentModel, opencodeOptions);
      });
      return;
    case "/api/config":
      await uiAction(res, opencodeOptions, async () => {
        setCodexSettings(body);
      });
      return;
    case "/api/restart":
      await uiAction(res, opencodeOptions, async () => {
        stopProxy();
        await startProxy(opencodeOptions);
      });
      return;
    case "/api/open-codex":
      await uiAction(res, opencodeOptions, async () => {
        launchCodex();
      });
      return;
    case "/api/quit-codex":
      await uiAction(res, opencodeOptions, async () => {
        quitCodexApp();
      });
      return;
    case "/api/restart-codex":
      await uiAction(res, opencodeOptions, async () => {
        await restartCodexApp();
      });
      return;
    case "/api/restore":
      await uiAction(res, opencodeOptions, async () => {
        if (!body.backup) {
          throw new Error("Choose a backup first.");
        }
        restore({ ...opencodeOptions, backup: knownRestoreBackupPath(body.backup) });
      });
      return;
    default:
      sendJson(res, 404, { ok: false, error: "Not found" });
  }
}

function uiOpenCodeModel(body) {
  return normalizeModel(String(body.model || activeConfiguredOpenCodeModel()).trim());
}

async function restartCodexIfRequested(body) {
  if (!body.restartCodex) {
    return;
  }
  await restartCodexApp();
}

async function testAndRecordOpenCodeToken(token, model) {
  const json = await testOpenCodeToken(token, model);
  const upstreamModel = json.model || model;
  appendActivityLog("api_key_test", {
    status: 200,
    model,
    requested_model: model,
    upstream_host: upstreamHost(),
    upstream_path: opencodeEndpointPath(model),
    upstream_model: upstreamModel
  });
  return { json, upstreamModel };
}

async function uiAction(res, opencodeOptions, action) {
  try {
    const extra = await action();
    sendJson(res, 200, { ok: true, ...(extra || {}), state: await buildState(opencodeOptions) });
  } catch (error) {
    sendUiError(res, error);
  }
}

function sendUiError(res, error) {
  sendJson(res, error?.status || 500, {
    ok: false,
    error: safeErrorMessage(error)
  });
}

function createSessionToken() {
  return randomBytes(32).toString("base64url");
}

function verifyUiMutationRequest(req, uiSecurity) {
  const contentType = String(req.headers["content-type"] || "").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    throw httpError(415, "Dashboard actions require application/json.");
  }

  const secFetchSite = String(req.headers["sec-fetch-site"] || "").toLowerCase();
  if (secFetchSite && !["same-origin", "same-site", "none"].includes(secFetchSite)) {
    throw httpError(403, "Rejected cross-site dashboard request.");
  }

  const origin = req.headers.origin ? String(req.headers.origin) : "";
  if (origin && !uiSecurity.allowedOrigins.has(origin)) {
    throw httpError(403, "Rejected dashboard request from another origin.");
  }

  const supplied = String(req.headers[UI_SESSION_HEADER] || "");
  if (!timingSafeEqualString(supplied, uiSecurity.token)) {
    throw httpError(403, "Missing or invalid dashboard session token.");
  }
}

function timingSafeEqualString(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function knownRestoreBackupPath(path) {
  const requested = String(path || "");
  const known = backupSummaries().find((backup) => backup.restoreable && backup.path === requested);
  if (!known) {
    throw httpError(400, "Choose a known Navo backup from the restore list.");
  }
  return known.path;
}

function sendHtml(res, html) {
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-security-policy": "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY"
  });
  res.end(html);
}

function sendSvg(res, svg) {
  res.writeHead(200, {
    "content-type": "image/svg+xml; charset=utf-8",
    "cache-control": "public, max-age=86400",
    "x-content-type-options": "nosniff"
  });
  res.end(svg);
}

function faviconSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#0d1321"/>
  <path d="M20 36h9c4 0 5-16 9-16s5 24 9 24 5-8 9-8" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round"/>
  <path d="M24 17 10 32l14 15M40 17l14 15-14 15" fill="none" stroke="#2f6df6" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
}

function openUrlOnce(url, options = {}) {
  if (process.platform !== "darwin") {
    return;
  }

  const result = spawnSync("open", ["-a", "Google Chrome", url], { encoding: "utf8" });
  if (result.error) {
    const fallback = spawnSync("open", [url], { encoding: "utf8" });
    if (fallback.error) {
      console.warn(`Could not open browser: ${fallback.error.message}`);
      return;
    }
  }

  rememberUiOpened(url);
}

function uiOpenMarkerPath(url) {
  const safe = Buffer.from(url).toString("base64url");
  return join(APP_DIR, `ui-open-${safe}.json`);
}

function recentlyOpenedUi(url) {
  const markerPath = uiOpenMarkerPath(url);
  if (!existsSync(markerPath)) {
    return false;
  }

  try {
    const marker = JSON.parse(readFileSync(markerPath, "utf8"));
    return Date.now() - Number(marker.openedAt || 0) < 10 * 60 * 1000;
  } catch {
    return false;
  }
}

function rememberUiOpened(url) {
  ensurePrivateAppDir();
  writePrivateFile(uiOpenMarkerPath(url), `${JSON.stringify({ url, openedAt: Date.now() }, null, 2)}\n`);
}

function quitCodexApp({ quiet = false } = {}) {
  if (process.platform !== "darwin") {
    throw new Error("Codex App controls are only available on macOS.");
  }

  const result = spawnSync("osascript", ["-e", `tell application "${CODEX_APP_NAME}" to quit`], {
    encoding: "utf8"
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0 && !quiet) {
    throw new Error((result.stderr || result.stdout || "Failed to quit Codex App.").trim());
  }
  if (!quiet) {
    console.log("Quit Codex App.");
  }
}

async function restartCodexApp() {
  if (process.env.NAVO_SKIP_CODEX_RESTART === "1") {
    console.log("Skipped Codex App restart because NAVO_SKIP_CODEX_RESTART=1.");
    return;
  }
  if (process.platform !== "darwin") {
    launchCodex();
    return;
  }

  quitCodexApp({ quiet: true });
  await waitForCodexExit(CODEX_RESTART_TIMEOUT_MS);
  launchCodex({ preferActivate: true });
}

async function waitForCodexExit(timeoutMs) {
  const startedAt = Date.now();
  while (isCodexAppRunning()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for Codex App to quit. Quit Codex manually, then open it again.");
    }
    await sleep(150);
  }
}

function isCodexAppRunning() {
  if (process.platform !== "darwin") {
    return false;
  }
  const result = spawnSync("pgrep", ["-x", CODEX_APP_NAME], { encoding: "utf8" });
  if (result.error) {
    return false;
  }
  return result.status === 0;
}

function dashboardHtmlV2(sessionToken) {
  const models = JSON.stringify(modelOptions("", { enabled: false }));
  const reasoningEfforts = JSON.stringify(REASONING_EFFORTS);
  const approvalPolicies = JSON.stringify(APPROVAL_POLICIES);
  const sandboxModes = JSON.stringify(SANDBOX_MODES);
  const sessionHeader = JSON.stringify(UI_SESSION_HEADER);
  const sessionValue = JSON.stringify(sessionToken);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="navo-session-token" content="${htmlAttr(sessionToken)}">
  <title>${PROJECT_NAME}</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f8fa;
      --surface: #ffffff;
      --surface-soft: #f9fbfc;
      --ink: #111820;
      --muted: #63717d;
      --faint: #8997a2;
      --line: #dce4e9;
      --line-strong: #b9c6ce;
      --blue: #1f63f2;
      --green: #16845f;
      --amber: #9b6500;
      --red: #b42332;
      --shadow: 0 16px 40px rgba(17, 24, 32, 0.08);
      --radius: 8px;
    }

    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    html { scroll-behavior: smooth; }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--ink);
      font: 14px/1.45 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: 0;
    }

    button, input, select {
      font: inherit;
      letter-spacing: 0;
    }

    button {
      min-height: 34px;
      border: 1px solid var(--line-strong);
      border-radius: 7px;
      background: #fff;
      color: var(--ink);
      padding: 0 12px;
      cursor: pointer;
    }

    button:hover { border-color: #7f909b; }
    button:disabled { cursor: wait; opacity: 0.62; }
    button.primary { background: var(--blue); border-color: var(--blue); color: #fff; font-weight: 720; }
    button.green { background: var(--green); border-color: var(--green); color: #fff; font-weight: 720; }
    button.danger { border-color: #dc9aa2; color: var(--red); }

    input, select {
      width: 100%;
      min-height: 38px;
      border: 1px solid var(--line-strong);
      border-radius: 7px;
      background: #fff;
      color: var(--ink);
      padding: 0 11px;
      outline: none;
    }

    input:focus, select:focus, button:focus-visible {
      outline: 2px solid rgba(31, 99, 242, 0.22);
      outline-offset: 2px;
    }

    .app {
      width: min(1420px, calc(100vw - 36px));
      margin: 0 auto;
      padding: 0 0 28px;
    }

    .topbar {
      position: sticky;
      top: 0;
      z-index: 20;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto auto;
      gap: 14px;
      align-items: center;
      min-height: 56px;
      border-bottom: 1px solid rgba(185, 198, 206, 0.64);
      background: rgba(255, 255, 255, 0.92);
      backdrop-filter: blur(18px);
    }

    .brand {
      display: inline-flex;
      gap: 10px;
      align-items: center;
      min-width: 0;
    }

    .mark {
      width: 27px;
      height: 27px;
      border-radius: 7px;
      background: #111820;
      color: white;
      display: grid;
      place-items: center;
      box-shadow: 0 8px 20px rgba(17, 24, 32, 0.16);
    }

    .mark svg { width: 19px; height: 19px; }
    .brand strong { font-size: 18px; line-height: 1; letter-spacing: 0; }

    .nav {
      display: inline-flex;
      gap: 4px;
      padding: 3px;
      border: 1px solid var(--line);
      border-radius: 9px;
      background: #fff;
    }

    .nav button {
      min-height: 30px;
      border: 0;
      color: var(--muted);
      background: transparent;
      font-weight: 700;
    }

	    .nav button.active {
	      color: var(--ink);
	      background: #eef2f5;
	    }

	    .configured #setup-nav-btn,
	    .setup-required #settings-btn {
	      display: none;
	    }

    .top-actions {
      display: inline-flex;
      gap: 8px;
      justify-content: flex-end;
      align-items: center;
    }

    .top-link {
      min-height: 34px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--line-strong);
      border-radius: 7px;
      padding: 0 12px;
      color: var(--ink);
      background: #fff;
      font-weight: 700;
      text-decoration: none;
      white-space: nowrap;
    }

    .top-link:hover { border-color: #7f909b; }

    .view { display: none; }
    .view.active { display: block; }

    .hero {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 16px;
      align-items: end;
      padding: 18px 0 14px;
    }

    h1, h2, h3, p { margin: 0; }
    h1 { font-size: 34px; line-height: 1.06; letter-spacing: 0; }
    h2 { font-size: 17px; line-height: 1.2; }
    h3 { font-size: 14px; line-height: 1.25; }
    .lead { max-width: 660px; margin-top: 9px; color: var(--muted); font-size: 15px; line-height: 1.45; }
    .small { color: var(--muted); font-size: 12px; }

    .status-strip {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 16px;
      margin: 20px 0 16px;
    }

    .stat, .panel, .doc-shell {
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--surface);
      box-shadow: var(--shadow);
    }

    .stat {
      min-height: 78px;
      padding: 13px 14px;
      display: grid;
      align-content: center;
      gap: 5px;
    }

    .stat span {
      color: var(--faint);
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
    }

    .stat strong {
      font-size: 15px;
      line-height: 1.2;
      overflow-wrap: anywhere;
    }

    .shell {
      display: grid;
      grid-template-columns: minmax(390px, 0.72fr) minmax(0, 1.28fr);
      gap: 14px;
      align-items: start;
    }

    .stack { display: grid; gap: 14px; }
    .panel { padding: 16px; }
    .panel-head {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: start;
      margin-bottom: 14px;
    }

    .field { display: grid; gap: 6px; }
    label {
      color: var(--muted);
      font-size: 12px;
      font-weight: 760;
    }

    .form-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }

    .setup-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.4fr) minmax(220px, 0.6fr);
      gap: 10px;
      align-items: end;
    }

    .row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      margin-top: 10px;
    }

    .mode-buttons {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }

    .model-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      margin-top: 12px;
    }

    .control-tabs {
      display: flex;
      gap: 18px;
      border-bottom: 1px solid var(--line);
      margin: -4px 0 14px;
    }

    .control-tab {
      min-height: 38px;
      border: 0;
      border-bottom: 2px solid transparent;
      border-radius: 0;
      background: transparent;
      color: var(--muted);
      padding: 0 2px;
      font-weight: 760;
    }

    .control-tab.active {
      color: var(--blue);
      border-bottom-color: var(--blue);
    }

    .tool-panel {
      display: none;
    }

    .tool-panel.active {
      display: block;
    }

    .mode-choice-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
      margin-top: 10px;
    }

    .mode-choice {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface-soft);
      padding: 12px;
      display: grid;
      gap: 5px;
    }

    .mode-choice strong {
      font-size: 13px;
    }

    .mode-choice span {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.35;
    }

    .model-button {
      min-height: 58px;
      display: grid;
      gap: 3px;
      align-content: center;
      text-align: left;
      background: var(--surface-soft);
      border-color: var(--line);
      padding: 9px 10px;
    }

    .model-button strong { font-size: 13px; overflow-wrap: anywhere; }
    .model-button span { color: var(--muted); font-size: 12px; line-height: 1.25; }
    .model-button.active { border-color: var(--blue); box-shadow: inset 0 0 0 1px var(--blue); background: #f3f7ff; }
    .model-button.chat { border-left: 4px solid #4998ff; }
    .model-button.agent { border-right: 4px solid #25a76f; }

    .switch {
      display: inline-grid;
      grid-template-columns: 42px auto;
      gap: 8px;
      align-items: center;
      font-weight: 720;
    }

    .switch input {
      appearance: none;
      width: 42px;
      height: 24px;
      margin: 0;
      border-radius: 999px;
      background: #c9d4da;
      position: relative;
      cursor: pointer;
    }

    .switch input::after {
      content: "";
      position: absolute;
      width: 18px;
      height: 18px;
      left: 3px;
      top: 3px;
      border-radius: 50%;
      background: white;
      transition: transform 0.16s ease;
    }

    .switch input:checked { background: var(--green); }
    .switch input:checked::after { transform: translateX(18px); }

    .status-line {
      display: flex;
      flex-wrap: wrap;
      gap: 7px;
      margin-top: 10px;
    }

    .pill {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: #fff;
      padding: 0 9px;
      font-size: 12px;
      font-weight: 760;
      white-space: nowrap;
    }

    .pill.ok { color: var(--green); border-color: #9ed7c3; }
    .pill.warn { color: var(--amber); border-color: #dfc27d; }
    .pill.bad { color: var(--red); border-color: #e3a1aa; }

    .activity-list {
      display: grid;
      gap: 8px;
      max-height: 520px;
      overflow: auto;
      padding-right: 2px;
    }

    .activity-table {
      width: 100%;
      overflow: auto;
    }

    .activity-row {
      display: grid;
      grid-template-columns: 92px minmax(120px, 0.8fr) minmax(170px, 1fr) 110px;
      gap: 14px;
      align-items: center;
      min-height: 44px;
      border-bottom: 1px solid var(--line);
      color: var(--muted);
      font-size: 13px;
    }

    .activity-row.header {
      color: var(--faint);
      font-weight: 800;
      text-transform: uppercase;
      font-size: 11px;
    }

    .activity-row strong {
      color: var(--ink);
      font-weight: 720;
    }

    .status-chip {
      width: fit-content;
      border-radius: 999px;
      background: #dff5e9;
      color: var(--green);
      padding: 2px 8px;
      font-weight: 760;
    }

    .status-chip.bad {
      background: #fde8ea;
      color: var(--red);
    }

    .activity-panel-wide {
      margin-top: 14px;
    }

    .activity {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface-soft);
      padding: 10px;
      display: grid;
      gap: 8px;
    }

    .activity-top {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      align-items: center;
    }

    .activity-title {
      display: inline-flex;
      gap: 7px;
      align-items: center;
      font-weight: 780;
    }

    .dot {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: var(--faint);
    }

    .dot.ok { background: var(--green); }
    .dot.bad { background: var(--red); }
    .dot.warn { background: var(--amber); }

    .activity-meta {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 6px;
    }

    .kv {
      min-width: 0;
      color: var(--muted);
      font: 12px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      overflow-wrap: anywhere;
    }

    .empty {
      border: 1px dashed var(--line-strong);
      border-radius: 8px;
      padding: 20px;
      color: var(--muted);
      background: var(--surface-soft);
    }

    .trust-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 8px;
      margin-top: 12px;
    }

    .trust-item {
      min-height: 74px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface-soft);
      padding: 10px;
      display: grid;
      align-content: start;
      gap: 4px;
    }

    .trust-item strong {
      font-size: 12px;
      line-height: 1.25;
    }

    .trust-item span {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.35;
    }

    .stored-key {
      display: none;
      margin-top: 12px;
      border-top: 1px solid var(--line);
      padding-top: 12px;
      color: var(--muted);
      font-size: 12px;
    }

    .stored-key.show {
      display: block;
    }

    .setup-required .status-strip,
    .setup-required #workspace-panel {
      display: none;
    }

    .setup-required .shell {
      grid-template-columns: minmax(0, 560px) minmax(320px, 1fr);
    }

    .doc-shell {
      display: grid;
      grid-template-columns: 240px minmax(0, 1fr);
      overflow: hidden;
    }

    .doc-nav {
      border-right: 1px solid var(--line);
      background: var(--surface-soft);
      padding: 14px;
      display: grid;
      align-content: start;
      gap: 4px;
    }

    .doc-nav a {
      color: var(--muted);
      text-decoration: none;
      border-radius: 6px;
      padding: 8px 9px;
      font-weight: 720;
    }

    .doc-nav a:hover { background: #eef2f5; color: var(--ink); }
    .doc-content {
      padding: 22px 26px 28px;
      display: grid;
      gap: 24px;
    }

    .doc-section {
      max-width: 820px;
      display: grid;
      gap: 10px;
      padding-bottom: 18px;
      border-bottom: 1px solid var(--line);
    }

    .doc-section:last-child { border-bottom: 0; }
    .doc-section p { color: var(--muted); }
    .steps { display: grid; gap: 8px; counter-reset: steps; }
    .step {
      display: grid;
      grid-template-columns: 28px minmax(0, 1fr);
      gap: 10px;
      align-items: start;
    }
    .step::before {
      counter-increment: steps;
      content: counter(steps);
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: #eaf0ff;
      color: var(--blue);
      display: grid;
      place-items: center;
      font-size: 12px;
      font-weight: 800;
    }

    code, .cmd {
      font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      border-radius: 6px;
    }

    code {
      background: #edf2f5;
      padding: 1px 5px;
    }

    .cmd {
      display: block;
      background: #111820;
      color: #d8e3ea;
      padding: 10px 11px;
      overflow-wrap: anywhere;
      white-space: pre-wrap;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }

    th, td {
      border-bottom: 1px solid var(--line);
      padding: 8px 6px;
      text-align: left;
      vertical-align: middle;
    }

    th { color: var(--muted); font-weight: 780; }
    td.path { color: var(--muted); overflow-wrap: anywhere; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }

    .setup-stage {
      min-height: calc(100vh - 86px);
      display: grid;
      place-items: start center;
      padding: 28px 0 12px;
    }

    .setup-card {
      width: min(760px, 100%);
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface);
      box-shadow: var(--shadow);
      padding: 26px;
      display: grid;
      gap: 16px;
      text-align: center;
    }

    .welcome-pill, .mini-pill {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: fit-content;
      min-height: 26px;
      border-radius: 999px;
      background: #edf4ff;
      color: var(--blue);
      font-size: 12px;
      font-weight: 780;
      padding: 0 13px;
    }

    .welcome-pill {
      justify-self: center;
    }

    .key-box, .existing-card {
      width: min(560px, 100%);
      justify-self: center;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface);
      padding: 20px;
      display: grid;
      gap: 12px;
      text-align: left;
    }

    .key-head {
      display: grid;
      grid-template-columns: 34px minmax(0, 1fr);
      gap: 12px;
      align-items: center;
    }

    .key-icon {
      width: 34px;
      height: 34px;
      border-radius: 8px;
      background: #eef2f5;
      color: var(--ink);
      display: grid;
      place-items: center;
    }

    .key-icon svg {
      width: 18px;
      height: 18px;
      stroke-width: 2.2;
    }

    .trust-box {
      border: 1px solid #cfe0f5;
      border-radius: 8px;
      background: #f5f9ff;
      padding: 13px 14px;
      display: grid;
      gap: 6px;
      color: var(--muted);
      font-size: 12px;
    }

    .trust-box strong {
      color: var(--ink);
      font-size: 13px;
    }

    .trust-box span::before {
      content: "✓";
      margin-right: 8px;
      color: var(--green);
      font-weight: 800;
    }

    .center-row {
      display: flex;
      justify-content: center;
      margin-top: 4px;
    }

    button.big {
      min-width: 240px;
      min-height: 48px;
      font-size: 16px;
    }

    .center {
      text-align: center;
    }

    .existing-card {
      display: none;
    }

    .existing-card.show {
      display: grid;
    }

    .stored-line {
      display: flex;
      flex-wrap: wrap;
      gap: 9px;
      align-items: center;
    }

	    .stored-line strong {
	      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
	      overflow-wrap: anywhere;
	    }

    .link-button {
      min-height: 30px;
      border: 0;
      background: transparent;
      color: var(--blue);
      padding: 0;
      font-weight: 720;
      width: fit-content;
    }

    .setup-foot {
      border-top: 1px solid var(--line);
      margin: 4px -26px -26px;
      padding: 20px 26px 24px;
      color: var(--muted);
      font-size: 12px;
    }

    .setup-foot-row {
      display: flex;
      gap: 14px;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
    }

    .setup-foot-copy {
      display: grid;
      gap: 6px;
      min-width: min(100%, 420px);
    }

    .setup-foot strong {
      color: var(--ink);
      font-size: 14px;
    }

    .setup-foot a {
      color: var(--ink);
      font-weight: 800;
      text-decoration: none;
    }

    .setup-star-link {
      min-height: 36px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 1px solid #111820;
      border-radius: 7px;
      background: #111820;
      color: #fff !important;
      padding: 0 14px;
      font-weight: 800;
      white-space: nowrap;
    }

    .setup-star-link:hover {
      background: #26313b;
      border-color: #26313b;
    }

    .status-card, .model-card {
      min-height: 250px;
      display: grid;
      align-content: start;
      gap: 12px;
    }

    .status-title {
      display: block;
      margin-top: 16px;
      font-size: 20px;
    }

    .status-title::before {
      content: "";
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 999px;
      background: var(--green);
      margin-right: 9px;
    }

    .status-title.warn::before { background: var(--amber); }
    .status-title.bad::before { background: var(--red); }

    .status-list {
      display: grid;
      gap: 9px;
      margin: 6px 0 4px;
    }

    .status-list div {
      display: grid;
      grid-template-columns: 120px minmax(0, 1fr);
      gap: 10px;
      align-items: baseline;
    }

	    .status-list.compact div {
	      grid-template-columns: 130px minmax(0, 1fr);
	    }

	    .model-picker-grid {
	      display: grid;
	      grid-template-columns: repeat(2, minmax(0, 1fr));
	      gap: 10px;
	    }

	    .model-picker-grid.single {
	      grid-template-columns: 1fr;
	    }

	    .model-select-block {
	      display: grid;
	      gap: 6px;
	      color: var(--muted);
	      font-size: 12px;
	      font-weight: 760;
	    }

	    .model-action-row {
	      display: grid;
	      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
	      gap: 10px;
	    }

    dt {
      color: var(--muted);
      font-size: 12px;
      font-weight: 760;
    }

    dd {
      margin: 0;
      color: var(--ink);
      overflow-wrap: anywhere;
    }

	    .action-grid {
	      display: grid;
	      grid-template-columns: repeat(3, minmax(0, 1fr));
	      gap: 10px;
	      margin-top: 14px;
	    }

	    .action-card {
	      min-height: 102px;
	      border: 1px solid var(--line);
	      border-radius: 8px;
	      background: var(--surface-soft);
	      padding: 14px;
	      display: grid;
	      justify-items: start;
	      align-content: start;
	      gap: 8px;
	      text-align: left;
	    }

    .action-card strong {
      font-size: 13px;
    }

    .action-card span {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.35;
    }

	    .action-card em {
	      justify-self: start;
	      min-height: 24px;
	      border-radius: 999px;
	      background: #edf2f5;
	      color: var(--muted);
	      padding: 3px 9px;
	      font-style: normal;
	      font-size: 12px;
	      font-weight: 760;
	    }

    .action-card.active em {
      background: #dff5e9;
      color: var(--green);
    }

    .toast {
      position: fixed;
      right: 18px;
      bottom: 18px;
      max-width: min(440px, calc(100vw - 36px));
      border-radius: 8px;
      background: #111820;
      color: white;
      box-shadow: var(--shadow);
      padding: 11px 12px;
      opacity: 0;
      transform: translateY(16px);
      pointer-events: none;
      transition: opacity 0.18s ease, transform 0.18s ease;
      z-index: 50;
    }

    .toast.show { opacity: 1; transform: translateY(0); }

	    @media (max-width: 900px) {
	      .app { width: min(100vw - 24px, 1320px); }
	      .topbar, .hero, .shell, .status-strip, .form-grid, .setup-grid, .mode-buttons, .model-grid, .model-picker-grid, .model-action-row, .doc-shell, .action-grid {
	        grid-template-columns: 1fr;
	      }
	      .topbar { position: static; padding: 10px 0; }
	      .nav, .top-actions { justify-content: flex-start; }
	      h1 { font-size: 28px; }
      .trust-grid { grid-template-columns: 1fr; }
      .doc-nav { border-right: 0; border-bottom: 1px solid var(--line); }
      .doc-content { padding: 18px; }
	      .activity-meta { grid-template-columns: 1fr; }
	      .setup-card { padding: 20px 16px; }
	      .setup-foot { margin: 0 -16px -20px; }
	      .activity-row {
	        min-width: 620px;
	      }
    }
  </style>
</head>
<body class="setup-required">
  <div class="app">
    <header class="topbar">
      <div class="brand">
        <div class="mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M5 12h4.4c1.5 0 2.1-3.3 3.6-3.3s2.1 6.6 3.6 6.6S18.7 12 20 12" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
            <path d="M8 6 3 12l5 6M16 6l5 6-5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
	        </div>
	        <strong>Navo</strong>
	      </div>
	      <nav class="nav" aria-label="Primary">
	        <button id="setup-nav-btn" class="nav-item active" data-view="setup">Setup</button>
	        <button class="nav-item" data-view="control">Control</button>
	        <button class="nav-item" data-view="activity">Activity</button>
	        <button class="nav-item" data-view="docs">Docs</button>
      </nav>
      <div class="top-actions">
        <a class="top-link" href="${GITHUB_REPO_URL}" target="_blank" rel="noreferrer">Star on GitHub</a>
        <button id="refresh-btn">Refresh</button>
        <button id="settings-btn" title="Settings">Settings</button>
      </div>
    </header>

    <main id="setup-view" class="view active">
      <section class="setup-stage">
        <div class="setup-card">
          <div class="welcome-pill">Welcome to Navo</div>
          <h1>Let's connect Navo to OpenCode</h1>
          <p class="lead">Add your OpenCode API key to enable local model switching for Codex.</p>

          <div class="key-box">
            <div class="key-head">
              <div class="key-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <circle cx="7.5" cy="14.5" r="3.5" stroke="currentColor"/>
                  <path d="M10.2 11.8 18 4m-2 2 4 4m-6-2 3 3" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </div>
              <div>
                <h2>OpenCode API Key</h2>
                <p class="small">Your key is stored securely and never shared.</p>
              </div>
            </div>
            <div class="field">
              <input id="api-key-input" type="password" autocomplete="off" placeholder="Paste key to save locally">
            </div>
            <p class="small">Get your key from <a href="https://opencode.ai" target="_blank" rel="noreferrer">opencode.ai</a></p>

            <div class="trust-box">
              <strong>Your key stays on this Mac.</strong>
              <span>Stored in Apple Keychain on macOS.</span>
              <span>Only used to test and make requests to OpenCode.</span>
              <span>Never sent anywhere else.</span>
              <span>Prompts and headers are never logged.</span>
            </div>

            <div class="center-row">
              <button id="start-opencode-btn" class="primary big">Test & Continue</button>
            </div>
            <p class="small center">We'll run a quick test request with DeepSeek V4 Flash, then open model controls.</p>
          </div>

          <div id="stored-key-card" class="existing-card">
            <h2>Existing setup</h2>
            <p class="small">If you've already set up Navo, your key is stored securely.</p>
            <div class="stored-line">
              <span>Current key:</span>
              <strong id="setup-masked-key-value"></strong>
              <button id="setup-test-opencode-btn">Test</button>
            </div>
            <button id="clear-key-btn" class="link-button">Clear saved key</button>
          </div>

          <footer class="setup-foot">
            <div class="setup-foot-row">
              <div class="setup-foot-copy">
                <strong>100% Local • Secure • Private</strong>
                <span>Navo runs locally on your Mac. Nothing leaves your machine except requests to OpenCode.</span>
                <span>If Navo saves you setup time, a GitHub star helps more Codex and OpenCode users find it.</span>
              </div>
              <a class="setup-star-link" href="${GITHUB_REPO_URL}" target="_blank" rel="noreferrer">Star on GitHub</a>
            </div>
          </footer>
        </div>
      </section>
    </main>

    <main id="control-view" class="view">
      <div class="status-strip">
        <section class="panel status-card">
          <div class="panel-head">
            <div>
              <h2>Status <span id="status-mode-pill" class="mini-pill">OpenCode mode</span></h2>
              <strong id="status-title" class="status-title">Active</strong>
            </div>
          </div>
          <p id="status-copy" class="small">Navo is routing Codex requests to OpenCode.</p>
	          <dl class="status-list">
	            <div><dt>Mode</dt><dd id="status-provider-value">-</dd></div>
	            <div><dt>Local bridge</dt><dd id="endpoint-value">-</dd></div>
	            <div><dt>Last check</dt><dd id="last-check-value">-</dd></div>
	            <div><dt>Upstream</dt><dd id="upstream-value">-</dd></div>
	          </dl>
	          <button id="test-opencode-control-btn">Test Connection</button>
	        </section>

	        <section class="panel model-card">
	          <h2>Active Model</h2>
	          <div class="model-picker-grid single">
	            <label class="model-select-block">
	              <span>OpenCode model</span>
	              <select id="model-select"></select>
	            </label>
	          </div>
	          <dl class="status-list compact">
	            <div><dt>Provider</dt><dd id="provider-value">-</dd></div>
	            <div id="context-row" hidden><dt>Context window</dt><dd id="context-window-value">-</dd></div>
	            <div><dt>Reasoning</dt><dd id="reasoning-value">-</dd></div>
	            <div><dt>Status</dt><dd id="model-status-value">-</dd></div>
	          </dl>
	          <div class="model-action-row">
	            <button id="change-model-btn" class="primary">Use OpenCode Mode</button>
	            <button id="revert-codex-btn">Revert to Codex Mode</button>
	          </div>
	        </section>
      </div>

      <section class="panel">
        <h2>Actions</h2>
        <p class="small">Utility actions only. Model switching is handled above.</p>
        <div class="action-grid">
          <button id="open-codex-btn" class="action-card">
            <strong>Open Codex</strong>
            <span>Bring Codex forward without closing chats</span>
            <em>Open</em>
          </button>
          <button id="restart-bridge-btn" class="action-card">
            <strong>Restart Bridge</strong>
            <span>Refresh the local OpenCode connection</span>
            <em>Restart</em>
          </button>
          <button class="action-card nav-jump" data-view="activity">
            <strong>View Activity</strong>
            <span>Inspect privacy-safe local request proof</span>
            <em>View logs</em>
          </button>
        </div>
      </section>

      <section id="activity-panel" class="panel activity-panel-wide">
        <div class="panel-head">
          <div>
            <h2>Recent Activity</h2>
          </div>
          <button class="nav-jump link-button" data-view="activity">View all activity</button>
        </div>
        <div id="activity-list" class="activity-table"></div>
      </section>

	    </main>

    <main id="activity-view" class="view">
      <section class="hero">
        <div>
          <h1>Activity</h1>
          <p class="lead">Simple local proof of when requests ran, which model handled them, and whether they succeeded.</p>
        </div>
      </section>
      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>All Activity</h2>
            <p class="small">Prompts, headers, and API keys are never logged.</p>
          </div>
          <div class="top-actions">
            <button id="clear-activity-btn">Clear Activity</button>
            <button id="refresh-logs-btn">Refresh</button>
          </div>
        </div>
        <div id="logs-list" class="activity-table"></div>
      </section>
    </main>

    <main id="docs-view" class="view">
      <section class="hero">
        <div>
          <h1>Documentation</h1>
          <p class="lead">A clean runbook for installing, choosing a mode, verifying OpenCode traffic, reading activity, and recovering safely.</p>
        </div>
      </section>
      <div class="doc-shell">
        <aside class="doc-nav">
          <a href="#doc-start">Start</a>
          <a href="#doc-modes">Choose mode</a>
          <a href="#doc-verify">Verify</a>
          <a href="#doc-logs">Activity</a>
          <a href="#doc-recover">Recover</a>
          <a href="#doc-cli">CLI</a>
        </aside>
	        <article class="doc-content">
	          <section id="doc-start" class="doc-section">
	            <h2>Start</h2>
	            <p>Run the local dashboard, paste the OpenCode Go key on Setup, then use Control to choose a Go chat-compatible model. The dashboard binds to <code>127.0.0.1</code> only.</p>
	            <code class="cmd">navo ui</code>
	            <div class="steps">
	              <div class="step"><p>Use <strong>Setup</strong> to save the OpenCode API key locally.</p></div>
	              <div class="step"><p>Use <strong>Active Model</strong> to choose an OpenCode Go chat-compatible model.</p></div>
	              <div class="step"><p>Use <strong>Revert to Codex Mode</strong> when you want Codex's native provider path again.</p></div>
	            </div>
	          </section>
	          <section id="doc-modes" class="doc-section">
	            <h2>Choose Mode</h2>
	            <p><strong>OpenCode Mode</strong> configures Codex to call Navo's local adapter, which forwards to OpenCode Go chat-completions models. <strong>Codex Mode</strong> removes the Navo provider/catalog and switches Codex back to its normal provider path.</p>
	            <code class="cmd">navo codex-model gpt-5.5
	navo model deepseek-v4-flash</code>
	          </section>
	          <section id="doc-verify" class="doc-section">
	            <h2>Verify</h2>
	            <p>Do not rely on asking the assistant which model it is. Use local proof from the adapter health check, a fresh routing probe, and the privacy-safe activity log.</p>
	            <code class="cmd">navo probe-routing
	navo verify --fresh
	navo logs --lines 20</code>
	          </section>
	          <section id="doc-logs" class="doc-section">
	            <h2>Activity</h2>
	            <p>Activity rows show request time, model, route, and result. They do not include prompts, request headers, API keys, or upstream error echoes.</p>
	          </section>
	          <section id="doc-recover" class="doc-section">
	            <h2>Recover</h2>
	            <p>Switch back to Codex mode from Active Model or the CLI. Existing Codex sessions may need a restart or a new chat to reload provider settings.</p>
	            <code class="cmd">navo codex-model gpt-5.5
	navo backups
	navo restore --backup /path/to/file.toml</code>
          </section>
          <section id="doc-cli" class="doc-section">
            <h2>CLI</h2>
            <code class="cmd">navo login
navo ui
navo status
navo route --chat glm-5.1 --agent deepseek-v4-flash
navo verify --fresh</code>
          </section>
        </article>
      </div>
    </main>

  </div>

  <div id="toast" class="toast"></div>

  <script>
    const knownModels = ${models};
    const reasoningEfforts = ${reasoningEfforts};
    const approvalPolicies = ${approvalPolicies};
    const sandboxModes = ${sandboxModes};
    const navoSessionHeader = ${sessionHeader};
    const navoSessionToken = ${sessionValue};
    let currentState = null;
    let busyCount = 0;
    let lastTestResult = null;
    let pendingModelSelection = "";

    const $ = (id) => document.getElementById(id);

    function optionList(select, items, value, includeEmpty) {
      if (!select) return;
      const previous = select.value || value || "";
      select.textContent = "";
      if (includeEmpty) {
        const option = document.createElement("option");
        option.value = "";
        option.textContent = "(unset)";
        select.append(option);
      }
      for (const item of items) {
        const option = document.createElement("option");
        const id = typeof item === "string" ? item : item.id;
	        const label = typeof item === "string" ? item : (item.name || item.id);
	        option.value = id;
        option.textContent = label === id ? id : label + " (" + id + ")";
        select.append(option);
      }
      select.value = value || previous || "";
      if (select.options.length > 0 && select.value !== (value || previous || "")) {
        select.value = value && [...select.options].some((option) => option.value === value)
          ? value
          : select.options[0].value;
      }
    }

    function setText(id, value) {
      const node = $(id);
      if (node) node.textContent = value ?? "";
    }

    function setClass(id, className, enabled) {
      const node = $(id);
      if (node) node.classList.toggle(className, Boolean(enabled));
    }

    function on(id, event, handler) {
      const node = $(id);
      if (node) node.addEventListener(event, handler);
    }

    function setBusy(isBusy) {
      busyCount += isBusy ? 1 : -1;
      busyCount = Math.max(0, busyCount);
      document.querySelectorAll("button").forEach((button) => {
        button.disabled = busyCount > 0;
      });
    }

    function toast(message) {
      const node = $("toast");
      node.textContent = message;
      node.classList.add("show");
      clearTimeout(toast.timer);
      toast.timer = setTimeout(() => node.classList.remove("show"), 2800);
    }

    async function fetchJson(path, options) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch(path, { ...(options || {}), signal: controller.signal });
        const text = await response.text();
        let json;
        try {
          json = text ? JSON.parse(text) : {};
        } catch {
          throw new Error(text || "Navo returned a non-JSON response");
        }
        if (!response.ok) throw new Error(json.error || "Navo request failed");
        return { response, json };
      } finally {
        clearTimeout(timeout);
      }
    }

    function humanError(error) {
      const message = error && error.message ? error.message : String(error);
      if (message === "Failed to fetch" || message.includes("NetworkError")) {
        return "Navo is not reachable. Restart with: navo ui";
      }
      if (message.includes("aborted")) return "Request timed out. Check the Navo terminal.";
      return message;
    }

    async function api(path, body, doneText) {
      setBusy(true);
      try {
        const response = await fetchJson(path, {
          method: "POST",
          headers: { "content-type": "application/json", [navoSessionHeader]: navoSessionToken },
          body: JSON.stringify(body || {})
        });
        if (!response.json.ok) throw new Error(response.json.error || "Action failed");
        if (response.json.state) {
          currentState = response.json.state;
          if (response.json.test) {
            lastTestResult = response.json.test;
          }
          render();
        }
        toast(response.json.message || doneText || "Done");
        return true;
      } catch (error) {
        toast(humanError(error));
        return false;
      } finally {
        setBusy(false);
      }
    }

    async function refresh() {
      if (busyCount > 0) return;
      try {
        const response = await fetchJson("/api/state", { cache: "no-store" });
        if (!response.json.ok) throw new Error(response.json.error || "Refresh failed");
        currentState = response.json.state;
        render();
      } catch (error) {
        toast(humanError(error));
      }
    }

	    function showView(name, updateHash) {
	      document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === name + "-view"));
	      document.querySelectorAll(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === name));
	      if (updateHash !== false && location.hash !== "#" + name) history.replaceState(null, "", "#" + name);
	    }

	    function modelById(modelId) {
	      const models = [
	        ...((currentState && currentState.models) || []),
	        ...knownModels
	      ];
	      return models.find((item) => item && item.id === modelId) || null;
	    }

	    function configuredOpenCodeModel(state) {
	      const configured = state && state.mode === "opencode" && state.codex.model !== "(unset)"
	        ? state.codex.model
	        : "deepseek-v4-flash";
	      return modelById(configured) ? configured : "deepseek-v4-flash";
	    }

	    function selectedOpenCodeModel(state) {
	      const configured = configuredOpenCodeModel(state);
	      if (pendingModelSelection && !modelById(pendingModelSelection)) {
	        pendingModelSelection = "";
	      }
	      if (pendingModelSelection && pendingModelSelection === configured) {
	        pendingModelSelection = "";
	      }
	      return pendingModelSelection || configured;
	    }

	    function hasDraftModelSelection(state) {
	      const selected = selectedOpenCodeModelForAction(state);
	      return Boolean(selected && selected !== configuredOpenCodeModel(state));
	    }

	    function modelStatusText(state) {
	      const openCodeReady = state.mode === "opencode" && state.connection.running && state.key.available;
	      if (hasDraftModelSelection(state)) {
	        return state.mode === "codex" ? "Ready to switch to OpenCode" : "Ready to switch";
	      }
	      return state.mode === "codex"
	        ? "Codex mode active"
	        : (lastTestResult ? "API key active" : openCodeReady ? "Ready" : (state.key.available ? "Key saved" : "Key missing"));
	    }

	    function selectedOpenCodeModelForAction(state) {
	      const selected = $("model-select")?.value || pendingModelSelection || "";
	      return modelById(selected) ? selected : selectedOpenCodeModel(state || currentState);
	    }

	    function providerSwitchNeedsRestart(targetMode) {
	      return !currentState || currentState.mode !== targetMode;
	    }

	    async function updatePendingModelSelection() {
	      const selected = $("model-select")?.value || "";
	      const configured = configuredOpenCodeModel(currentState);
	      pendingModelSelection = selected && selected !== configured ? selected : "";
	      renderSelectedModelDetails();
	      if (currentState) {
	        setText("model-status-value", modelStatusText(currentState));
	      }
	      if (!pendingModelSelection || !currentState || currentState.mode !== "opencode" || !currentState.key.available) {
	        return;
	      }
	      setText("model-status-value", "Switching...");
	      const ok = await api("/api/model", { model: pendingModelSelection }, "OpenCode model saved. Existing Navo chats use it on the next request.");
	      if (ok) {
	        pendingModelSelection = "";
	      }
	    }

	    function renderSelectedModelDetails() {
	      const selected = $("model-select")?.value || "";
	      const model = modelById(selected);
	      const context = model && model.contextWindow;
	      const contextRow = $("context-row");
	      if (contextRow) {
	        contextRow.hidden = !context;
	      }
	      if (context) {
	        setText("context-window-value", context.label + " " + (context.source || "verified metadata"));
	      }
	    }

	    function render() {
	      if (!currentState) return;
	      const state = currentState;
	      const activeOpenCodeModel = selectedOpenCodeModel(state);

	      optionList($("model-select"), state.models || knownModels, activeOpenCodeModel);
	      renderSelectedModelDetails();

	      const openCodeReady = state.mode === "opencode" && state.connection.running && state.key.available;
	      const needsSetup = !state.key.available;
	      document.body.classList.toggle("setup-required", needsSetup);
	      document.body.classList.toggle("configured", state.key.available);

	      const modeLabel = state.mode === "opencode" ? "OpenCode Mode" : "Codex Mode";
	      const statusTitle = needsSetup
	        ? "Setup Required"
	        : state.mode === "opencode"
	        ? (state.connection.running ? "OpenCode Mode Active" : "OpenCode Mode Needs Bridge")
	        : "Codex Mode Active";
	      const statusTone = needsSetup ? "bad" : (state.mode === "opencode" && !state.connection.running ? "warn" : "");
	      const lastCheckText = lastTestResult
	        ? "API key active: " + lastTestResult.upstreamModel
	        : state.safety.proof && state.safety.proof.ageSeconds !== null
	        ? (state.safety.proof.fresh ? "OK " : "Stale ") + state.safety.proof.ageSeconds + "s ago"
	        : state.mode === "codex"
	        ? "Codex mode"
	        : state.connection.running
	        ? "Proxy reachable"
	        : state.key.available
	        ? "Ready; click Test"
	        : "Add API key";
	      setText("status-title", statusTitle);
	      $("status-title")?.classList.toggle("warn", statusTone === "warn");
	      $("status-title")?.classList.toggle("bad", statusTone === "bad");
	      setText("status-copy", lastTestResult
	        ? "API key active. OpenCode accepted " + lastTestResult.upstreamModel + "."
	        : state.mode === "codex"
	        ? "Codex is using its native provider path. The OpenCode bridge is not in the request path."
	        : openCodeReady
	        ? "Navo is routing Codex requests to OpenCode through the local bridge."
	        : (state.key.available ? "Your OpenCode key is saved. Start OpenCode mode when you are ready." : "Add your OpenCode API key on the setup page."));
	      setText("status-mode-pill", state.mode === "opencode" ? "OpenCode" : "Codex");
	      setText("status-provider-value", modeLabel);
	      setText("endpoint-value", state.mode === "opencode" ? state.connection.url : "Codex direct");
	      setText("last-check-value", lastCheckText);
	      setText("upstream-value", state.mode === "opencode" ? "opencode.ai" : "Codex provider");
	      setText("provider-value", state.mode === "opencode" ? "OpenCode" : "Codex Mode");
	      setText("reasoning-value", "Codex default");
	      setText("model-status-value", modelStatusText(state));
	      $("stored-key-card").classList.toggle("show", state.key.available);
	      setText("setup-masked-key-value", state.key.masked || "(not saved)");

      if (needsSetup && !location.hash) {
        showView("setup", false);
      } else if (!needsSetup && !location.hash) {
        showView("control", false);
      }
      renderActivity(state);
    }

    function updatePill(node, text, status) {
      if (!node) return;
      node.textContent = text;
      node.className = "pill " + status;
    }

    function parseLogLine(line) {
      const firstSpace = line.indexOf(" ");
      const secondSpace = firstSpace >= 0 ? line.indexOf(" ", firstSpace + 1) : -1;
      const item = { time: firstSpace > 0 ? line.slice(0, firstSpace) : "", event: "", fields: {}, raw: line };
      if (secondSpace < 0) {
        item.event = firstSpace > 0 ? line.slice(firstSpace + 1) : line;
        return item;
      }
      item.event = line.slice(firstSpace + 1, secondSpace);
      const rest = line.slice(secondSpace + 1);
      const pattern = /(\\w+)=("[^"]*"|\\S+)/g;
      let match;
      while ((match = pattern.exec(rest))) {
        let value = match[2];
        if (value.startsWith('"') && value.endsWith('"')) {
          try { value = JSON.parse(value); } catch {}
        }
        item.fields[match[1]] = value;
      }
      return item;
    }

    function renderActivity(state) {
      const lines = state.logs && state.logs.lines ? state.logs.lines : [];
      const items = lines.map(parseLogLine).reverse();
      renderActivityList($("activity-list"), items.slice(0, 8));
      renderActivityList($("logs-list"), items);
    }

    function renderActivityList(target, items) {
      if (!target) return;
      target.textContent = "";
      if (!items.length) {
        const empty = document.createElement("div");
        empty.className = "empty";
        empty.textContent = "No requests yet. Activity will appear here after you start OpenCode mode.";
        target.append(empty);
        return;
      }
      const header = document.createElement("div");
      header.className = "activity-row header";
      for (const label of ["Time", "Request", "Model", "Result"]) {
        const cell = document.createElement("div");
        cell.textContent = label;
        header.append(cell);
      }
      target.append(header);
      for (const item of items) {
        const f = item.fields || {};
        const status = String(f.status || "");
        const tone = status.startsWith("2") ? "ok" : (status ? "bad" : "warn");
        const row = document.createElement("div");
        row.className = "activity-row";
        const values = [
          item.time ? new Date(item.time).toLocaleTimeString() : "-",
          activityRequestLabel(item),
          activityModelLabel(item),
          activityResultLabel(item)
        ];
        values.forEach((value, index) => {
          const cell = document.createElement("div");
          if (index === 2) {
            const strong = document.createElement("strong");
            strong.textContent = value;
            cell.append(strong);
          } else if (index === 3) {
            const chip = document.createElement("span");
            chip.className = "status-chip " + (tone === "bad" ? "bad" : "");
            chip.textContent = value;
            cell.append(chip);
          } else {
            cell.textContent = value;
          }
          row.append(cell);
        });
        target.append(row);
      }
    }

    function activityRequestLabel(item) {
      const f = item.fields || {};
      if (item.event === "startup") return "Started";
      if (item.event === "api_key_test") return "Connection test";
      if (f.route === "agent") return "Agent request";
      return "Codex request";
    }

    function activityModelLabel(item) {
      const f = item.fields || {};
      return f.model || f.upstream_model || "-";
    }

    function activityResultLabel(item) {
      const status = String((item.fields || {}).status || "");
      if (!status) return "Done";
      return status.startsWith("2") ? "Succeeded" : "Failed";
    }

    document.querySelectorAll(".nav-item, .nav-jump").forEach((button) => {
      button.addEventListener("click", () => showView(button.dataset.view, true));
    });

    on("refresh-btn", "click", refresh);
    on("refresh-logs-btn", "click", refresh);
    on("settings-btn", "click", () => showView("setup", true));
    on("open-codex-btn", "click", () => api("/api/open-codex", {}, "Opening Codex"));
    on("restart-bridge-btn", "click", () => api("/api/restart", {}, "Bridge restarted"));
    on("model-select", "change", updatePendingModelSelection);
    on("setup-test-opencode-btn", "click", () => {
      api("/api/test-opencode", { apiKey: $("api-key-input").value, model: selectedOpenCodeModelForAction(currentState) }, "API key active");
    });
    on("test-opencode-control-btn", "click", () => {
      api("/api/test-opencode", { apiKey: $("api-key-input").value, model: selectedOpenCodeModelForAction(currentState) }, "API key active");
    });
    on("start-opencode-btn", "click", async () => {
      const shouldRestart = providerSwitchNeedsRestart("opencode");
      const ok = await api(
        "/api/start-opencode",
        { apiKey: $("api-key-input").value, model: selectedOpenCodeModelForAction(currentState), restartCodex: shouldRestart },
        shouldRestart ? "OpenCode mode started and Codex restarted" : "OpenCode mode saved. Existing Navo chats use it on the next request."
      );
      if (ok) {
        $("api-key-input").value = "";
        showView("control", true);
      }
    });
    on("change-model-btn", "click", () => {
      const shouldRestart = providerSwitchNeedsRestart("opencode");
      api(
        "/api/model",
        { model: selectedOpenCodeModelForAction(currentState), restartCodex: shouldRestart },
        shouldRestart ? "OpenCode mode selected and Codex restarted" : "OpenCode model saved. Existing Navo chats use it on the next request."
      );
    });
    on("revert-codex-btn", "click", () => {
      if (confirm("Revert to Codex mode and restart Codex?")) api("/api/codex-model", { model: "gpt-5.5", restartCodex: true }, "Codex mode selected and Codex restarted");
    });
    on("clear-key-btn", "click", () => {
      if (confirm("Clear the locally saved OpenCode API key?")) api("/api/clear-key", {}, "Saved key cleared");
    });
    on("clear-activity-btn", "click", () => {
      if (confirm("Clear local Navo activity rows? This only clears the local log file.")) api("/api/clear-activity", {}, "Activity cleared");
    });

    function viewFromHash() {
      const value = (location.hash || "").replace("#", "");
      if (value.startsWith("doc-")) return "docs";
      return ["setup", "control", "activity", "docs"].includes(value) ? value : "";
    }

    window.addEventListener("hashchange", () => {
      const next = viewFromHash();
      if (next) showView(next, false);
    });
    const initialView = viewFromHash();
    if (initialView) showView(initialView, false);
    refresh();
    setInterval(refresh, 5000);
  </script>
</body>
</html>`;
}

async function runProxy(options) {
  const port = readPort(options);
  ensurePrivateAppDir();

  const server = http.createServer((req, res) => {
    handleProxyRequest(req, res).catch((error) => {
      sendJson(res, error?.status || 500, error instanceof Error ? error : {
        error: {
          message: String(error),
          type: "proxy_error"
        }
      });
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });

  writePrivateFile(PID_PATH, `${process.pid}\n`);
  logActivity("startup", {
    listen: proxyBaseUrl(port),
    upstream_base: OPENCODE_BASE_URL,
    pid: process.pid
  });

  const shutdown = () => {
    try {
      if (existsSync(PID_PATH) && readFileSync(PID_PATH, "utf8").trim() === String(process.pid)) {
        unlinkSync(PID_PATH);
      }
    } catch {
      // Best effort cleanup.
    }
    server.close(() => process.exit(0));
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

async function startProxy(options) {
  const port = readPort(options);
  const health = await proxyHealth(port);
  if (health.ok) {
    console.log(`OpenCode connection already running on ${proxyBaseUrl(port)}.`);
    return;
  }

  ensurePrivateAppDir();
  const logFd = openSync(LOG_PATH, "a");
  chmodBestEffort(LOG_PATH, PRIVATE_FILE_MODE);
  const child = spawn(process.execPath, [SCRIPT_PATH, "proxy", "--port", String(port)], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: { ...process.env }
  });
  child.unref();
  closeSync(logFd);
  writePrivateFile(PID_PATH, `${child.pid}\n`);

  for (let attempt = 0; attempt < 40; attempt += 1) {
    await sleep(125);
    const nextHealth = await proxyHealth(port);
    if (nextHealth.ok) {
      console.log(`Started OpenCode connection on ${proxyBaseUrl(port)}.`);
      console.log(`Activity log: ${LOG_PATH}`);
      return;
    }
  }

  throw new Error(`OpenCode connection did not become ready. Check ${LOG_PATH}.`);
}

function stopProxy() {
  const pidPaths = uniquePaths([PID_PATH]);
  let sawPidFile = false;

  for (const pidPath of pidPaths) {
    if (!existsSync(pidPath)) {
      continue;
    }

    sawPidFile = true;
    const pid = Number(readFileSync(pidPath, "utf8").trim());
    if (!Number.isInteger(pid) || pid <= 0) {
      unlinkSync(pidPath);
      console.log(`Removed invalid OpenCode pid file: ${pidPath}`);
      continue;
    }

    try {
      process.kill(pid, "SIGTERM");
      unlinkSync(pidPath);
      console.log(`Stopped OpenCode process ${pid}.`);
    } catch (error) {
      unlinkSync(pidPath);
      console.log(`OpenCode process ${pid} was not running; removed stale pid file.`);
    }
  }

  if (!sawPidFile) {
    console.log("OpenCode pid file not found; nothing to stop.");
  }
}

async function printProxyStatus(options) {
  const port = readPort(options);
  const health = await proxyHealth(port);
  console.log(`OpenCode connection: ${health.ok ? "running" : "not running"}`);
  console.log(`URL: ${proxyBaseUrl(port)}`);
  for (const pidPath of uniquePaths([PID_PATH])) {
    if (existsSync(pidPath)) {
      console.log(`PID file: ${pidPath} (${readFileSync(pidPath, "utf8").trim()})`);
    }
  }
  console.log(`Log: ${activeLogPath()}`);
  if (!health.ok && health.error) {
    console.log(`Detail: ${health.error}`);
  }
}

function printLogs(options) {
  const lines = Number(options.lines || 100);
  const count = Number.isInteger(lines) && lines > 0 && lines <= 5000 ? lines : 100;
  const logPath = activeLogPath();
  if (!existsSync(logPath)) {
    console.log(`No activity log found at ${logPath}.`);
    return;
  }

  const result = spawnSync("tail", ["-n", String(count), logPath], {
    encoding: "utf8"
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error((result.stderr || "Failed to read activity log.").trim());
  }
  process.stdout.write(result.stdout);
}

function recentLogLines(lines = 100) {
  const count = Number.isInteger(Number(lines)) && Number(lines) > 0 && Number(lines) <= 5000
    ? Number(lines)
    : 100;
  const logPath = activeLogPath();
  if (!existsSync(logPath)) {
    return { path: logPath, lines: [] };
  }

  const result = spawnSync("tail", ["-n", String(count), logPath], {
    encoding: "utf8"
  });
  if (result.error || result.status !== 0) {
    const detail = result.error?.message || result.stderr || "Failed to read activity log.";
    return { path: logPath, lines: [detail.trim()] };
  }

  return {
    path: logPath,
    lines: result.stdout.split(/\r?\n/).filter(Boolean)
  };
}

function clearActivityLog() {
  ensurePrivateAppDir();
  writePrivateFile(LOG_PATH, "");
}

function connectionPidFiles() {
  return uniquePaths([PID_PATH])
    .filter((pidPath) => existsSync(pidPath))
    .map((pidPath) => ({
      path: pidPath,
      pid: readFileSync(pidPath, "utf8").trim()
    }));
}

async function handleProxyRequest(req, res) {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const context = {
    requestId: randomId(),
    startedAt: Date.now(),
    method: req.method || "UNKNOWN",
    path: url.pathname
  };

  if ((req.method === "GET" || req.method === "HEAD") && ["/", "/v1"].includes(url.pathname)) {
    sendJson(res, 200, {
      ok: true,
      name: PROJECT_NAME,
      opencode: proxyBaseUrl(DEFAULT_PROXY_PORT),
      upstream: upstreamHost()
    });
    if (req.method !== "HEAD") {
      logRequest(context, { status: 200, route: "opencode_info" });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (!url.pathname.startsWith("/v1/")) {
    sendJson(res, 404, { error: { message: "Not found", type: "not_found" } });
    logRequest(context, { status: 404, error_type: "not_found" });
    return;
  }

  try {
    const token = tokenFromRequest(req);

    if (req.method === "GET" && url.pathname === "/v1/models") {
      await forwardModels(res, token, context);
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
      await forwardChatCompletions(req, res, token, context);
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/responses") {
      const body = await readJsonBody(req, proxyBodyLimitBytes());
      await handleResponsesRequest(req, res, token, body, context);
      return;
    }

    sendJson(res, 404, {
      error: {
        message: `Unsupported local OpenCode route: ${req.method} ${url.pathname}`,
        type: "not_found"
      }
    });
    logRequest(context, { status: 404, error_type: "unsupported_route" });
  } catch (error) {
    logRequest(context, {
      status: error?.status || 500,
      error_type: error?.status === 401 ? "auth_error" : "proxy_error",
      error_message: safeErrorMessage(error)
    });
    throw error;
  }
}

async function forwardModels(res, token, context) {
  const upstream = await fetchWithTimeout(MODELS_URL, {
    headers: { authorization: `Bearer ${token}` }
  });
  logRequest(context, {
    status: upstream.status,
    upstream_host: upstreamHost(),
    upstream_path: "/models"
  });
  await pipeFetchResponse(res, upstream);
}

async function forwardChatCompletions(req, res, token, context) {
  const rawBody = await readRawBody(req, proxyBodyLimitBytes());
  const body = safeJson(rawBody) || {};
  const routedBody = { ...body };
  const routing = applyModelRouting(routedBody);
  const toolOrder = normalizeToolMessageOrder(routedBody);
  const compatibility = applyProviderCompatibility(routedBody);
  const endpoint = opencodeModelEndpoint(routedBody.model);
  const upstreamPath = opencodeEndpointPath(routedBody.model);
  const upstreamBody = endpoint === "messages"
    ? chatCompletionsToAnthropicMessages({ ...routedBody, stream: false })
    : routedBody;
  const upstream = await fetchWithTimeout(`${OPENCODE_BASE_URL}${upstreamPath}`, {
    method: "POST",
    headers: openCodeRequestHeaders(token, endpoint, req.headers["content-type"] || "application/json"),
    signal: requestAbortSignal(req, res),
    body: JSON.stringify(upstreamBody)
  });
  const logFields = {
    status: upstream.status,
    model: routedBody.model,
    requested_model: routing.requestedModel,
    route: routing.route,
    thinking: compatibility.thinking,
    reasoning_replayed: compatibility.reasoningReplayed,
    tool_choice: compatibility.toolChoice,
    synthetic_tools: toolOrder.syntheticToolMessages,
    stream: Boolean(routedBody.stream),
    stream_forced_off: endpoint === "messages" && Boolean(routedBody.stream),
    tools: Array.isArray(routedBody.tools) ? routedBody.tools.length : 0,
    upstream_host: upstreamHost(),
    upstream_path: upstreamPath
  };

  if (endpoint === "chat") {
    logRequest(context, logFields);
    await pipeFetchResponse(res, upstream);
    return;
  }

  const upstreamText = await upstream.text();
  if (!upstream.ok) {
    logRequest(context, { ...logFields, error_type: "upstream_error", error_message: upstreamErrorMessage(upstreamText) });
    sendJson(res, upstream.status, safeJson(upstreamText) || {
      error: {
        message: upstreamText || `OpenCode returned HTTP ${upstream.status}`,
        type: "upstream_error"
      }
    });
    return;
  }

  const chatJson = anthropicMessageToChatCompletion(JSON.parse(upstreamText), routedBody);
  logRequest(context, { ...logFields, upstream_model: chatJson.model });
  sendJson(res, 200, chatJson);
}

async function handleResponsesRequest(req, res, token, responsesBody, context) {
  const chatBody = responsesToChatCompletions(responsesBody);
  const routing = applyModelRouting(chatBody);
  const toolOrder = normalizeToolMessageOrder(chatBody);
  const compatibility = applyProviderCompatibility(chatBody);
  const endpoint = opencodeModelEndpoint(chatBody.model);
  const upstreamPath = opencodeEndpointPath(chatBody.model);
  const upstreamBody = endpoint === "messages"
    ? chatCompletionsToAnthropicMessages({ ...chatBody, stream: false })
    : { ...chatBody, stream: false };
  const upstream = await fetchWithTimeout(`${OPENCODE_BASE_URL}${upstreamPath}`, {
    method: "POST",
    headers: openCodeRequestHeaders(token, endpoint),
    signal: requestAbortSignal(req, res),
    body: JSON.stringify(upstreamBody)
  });

  const upstreamText = await upstream.text();
  const logFields = {
    status: upstream.status,
    model: chatBody.model,
    requested_model: routing.requestedModel,
    route: routing.route,
    thinking: compatibility.thinking,
    reasoning_replayed: compatibility.reasoningReplayed,
    tool_choice: compatibility.toolChoice,
    synthetic_tools: toolOrder.syntheticToolMessages,
    stream: Boolean(responsesBody.stream),
    tools: Array.isArray(chatBody.tools) ? chatBody.tools.length : 0,
    upstream_host: upstreamHost(),
    upstream_path: upstreamPath
  };
  if (!upstream.ok) {
    logRequest(context, { ...logFields, error_type: "upstream_error", error_message: upstreamErrorMessage(upstreamText) });
    sendJson(res, upstream.status, safeJson(upstreamText) || {
      error: {
        message: upstreamText || `OpenCode returned HTTP ${upstream.status}`,
        type: "upstream_error"
      }
    });
    return;
  }

  const upstreamJson = JSON.parse(upstreamText);
  const chatJson = endpoint === "messages" ? anthropicMessageToChatCompletion(upstreamJson, chatBody) : upstreamJson;
  const reasoningStored = rememberDeepSeekReasoning(chatJson);
  const responseJson = chatCompletionToResponse(chatJson, responsesBody);
  logRequest(context, { ...logFields, reasoning_stored: reasoningStored, upstream_model: chatJson.model });
  if (responsesBody.stream) {
    sendResponsesSse(res, responseJson);
  } else {
    sendJson(res, 200, responseJson);
  }
}

function responsesToChatCompletions(body) {
  const messages = [];
  if (typeof body.instructions === "string" && body.instructions.trim()) {
    messages.push({ role: "system", content: body.instructions });
  }

  for (const message of responsesInputToMessages(body.input)) {
    messages.push(message);
  }

  if (messages.length === 0) {
    messages.push({ role: "user", content: "" });
  }

  const chatBody = {
    model: body.model || DEFAULT_MODEL,
    messages
  };

  const tools = responsesToolsToChatTools(body.tools);
  if (tools.length > 0) {
    chatBody.tools = tools;
  }

  if (body.tool_choice !== undefined) {
    chatBody.tool_choice = responsesToolChoiceToChat(body.tool_choice);
  }
  if (body.parallel_tool_calls !== undefined) {
    chatBody.parallel_tool_calls = body.parallel_tool_calls;
  }
  if (body.max_output_tokens !== undefined) {
    chatBody.max_tokens = body.max_output_tokens;
  }
  if (body.temperature !== undefined) {
    chatBody.temperature = body.temperature;
  }
  if (body.top_p !== undefined) {
    chatBody.top_p = body.top_p;
  }

  return chatBody;
}

function responsesInputToMessages(input) {
  if (typeof input === "string") {
    return [{ role: "user", content: input }];
  }

  if (!Array.isArray(input)) {
    return [];
  }

  const messages = [];
  let pendingToolCalls = [];
  const flushPendingToolCalls = () => {
    if (pendingToolCalls.length === 0) {
      return;
    }
    messages.push({
      role: "assistant",
      content: null,
      tool_calls: pendingToolCalls
    });
    pendingToolCalls = [];
  };

  for (const item of input) {
    if (!item || typeof item !== "object") {
      continue;
    }

    if (item.type === "function_call_output") {
      flushPendingToolCalls();
      messages.push({
        role: "tool",
        tool_call_id: item.call_id || item.id || "call_unknown",
        content: stringifyOutput(item.output)
      });
      continue;
    }

    if (item.type === "function_call") {
      pendingToolCalls.push({
        id: item.call_id || item.id || "call_unknown",
        type: "function",
        function: {
          name: item.name,
          arguments: stringifyOutput(item.arguments || "")
        }
      });
      continue;
    }

    flushPendingToolCalls();

    const role = normalizeChatRole(item.role || (item.type === "message" ? item.role : undefined));
    if (!role) {
      continue;
    }

    messages.push({
      role,
      content: contentToText(item.content)
    });
  }

  flushPendingToolCalls();
  return messages;
}

function normalizeChatRole(role) {
  if (role === "developer") {
    return "system";
  }
  if (["system", "user", "assistant", "tool"].includes(role)) {
    return role;
  }
  return undefined;
}

function contentToText(content) {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return stringifyOutput(content ?? "");
  }

  return content
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }
      if (!part || typeof part !== "object") {
        return "";
      }
      return part.text ?? part.input_text ?? part.output_text ?? part.refusal ?? "";
    })
    .filter(Boolean)
    .join("\n");
}

function responsesToolsToChatTools(tools) {
  if (!Array.isArray(tools)) {
    return [];
  }

  return tools
    .filter((tool) => tool && typeof tool === "object" && (tool.type === "function" || tool.name || tool.function))
    .map((tool) => {
      if (tool.type === "function" && tool.function) {
        return tool;
      }
      return {
        type: "function",
        function: {
          name: tool.name || tool.function?.name,
          description: tool.description || tool.function?.description || "",
          parameters: tool.parameters || tool.function?.parameters || { type: "object", properties: {} }
        }
      };
    })
    .filter((tool) => tool.function.name);
}

function responsesToolChoiceToChat(choice) {
  if (typeof choice === "string") {
    return choice;
  }
  if (choice?.type === "function" && choice.name) {
    return { type: "function", function: { name: choice.name } };
  }
  return choice;
}

function openCodeRequestHeaders(token, endpoint, contentType = "application/json") {
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": contentType
  };
  if (endpoint === "messages") {
    headers["x-api-key"] = token;
    headers["anthropic-version"] = "2023-06-01";
  }
  return headers;
}

function chatCompletionsToAnthropicMessages(chatBody) {
  const system = [];
  const messages = [];
  const inputMessages = Array.isArray(chatBody.messages) ? chatBody.messages : [];

  for (const message of inputMessages) {
    const role = normalizeChatRole(message?.role);
    if (!role) {
      continue;
    }

    if (role === "system") {
      const text = contentToText(message.content).trim();
      if (text) {
        system.push(text);
      }
      continue;
    }

    if (role === "tool") {
      messages.push({
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: message.tool_call_id || "call_unknown",
          content: contentToText(message.content)
        }]
      });
      continue;
    }

    const content = chatMessageToAnthropicContent(message);
    messages.push({
      role: role === "assistant" ? "assistant" : "user",
      content: content.length > 0 ? content : [{ type: "text", text: "" }]
    });
  }

  if (messages.length === 0) {
    messages.push({ role: "user", content: [{ type: "text", text: "" }] });
  }

  const body = {
    model: chatBody.model || DEFAULT_MODEL,
    max_tokens: Number.isFinite(chatBody.max_tokens) ? chatBody.max_tokens : 4096,
    messages
  };

  if (system.length > 0) {
    body.system = system.join("\n\n");
  }

  const tools = chatToolsToAnthropicTools(chatBody.tools);
  if (tools.length > 0) {
    body.tools = tools;
  }

  const toolChoice = chatToolChoiceToAnthropic(chatBody.tool_choice);
  if (toolChoice) {
    body.tool_choice = toolChoice;
  }

  if (chatBody.temperature !== undefined) {
    body.temperature = chatBody.temperature;
  }
  if (chatBody.top_p !== undefined) {
    body.top_p = chatBody.top_p;
  }

  return body;
}

function chatMessageToAnthropicContent(message) {
  const blocks = chatContentToAnthropicBlocks(message?.content);
  if (Array.isArray(message?.tool_calls)) {
    for (const toolCall of message.tool_calls) {
      const name = toolCall?.function?.name;
      if (!name) {
        continue;
      }
      blocks.push({
        type: "tool_use",
        id: toolCall.id || `call_${randomId()}`,
        name,
        input: parseToolArguments(toolCall.function.arguments)
      });
    }
  }
  return blocks;
}

function chatContentToAnthropicBlocks(content) {
  if (typeof content === "string") {
    return content ? [{ type: "text", text: content }] : [];
  }
  if (!Array.isArray(content)) {
    const text = contentToText(content);
    return text ? [{ type: "text", text }] : [];
  }

  const blocks = [];
  for (const part of content) {
    if (typeof part === "string") {
      if (part) {
        blocks.push({ type: "text", text: part });
      }
      continue;
    }
    if (!part || typeof part !== "object") {
      continue;
    }
    const text = part.text ?? part.input_text ?? part.output_text ?? part.refusal;
    if (text) {
      blocks.push({ type: "text", text: String(text) });
    }
  }
  return blocks;
}

function chatToolsToAnthropicTools(tools) {
  if (!Array.isArray(tools)) {
    return [];
  }
  return tools
    .map((tool) => {
      const definition = tool?.function || tool;
      const name = definition?.name;
      if (!name) {
        return null;
      }
      return {
        name,
        description: definition.description || "",
        input_schema: definition.parameters || definition.input_schema || { type: "object", properties: {} }
      };
    })
    .filter(Boolean);
}

function chatToolChoiceToAnthropic(choice) {
  if (!choice || choice === "auto") {
    return undefined;
  }
  if (choice === "required") {
    return { type: "any" };
  }
  if (choice?.type === "function" && choice.function?.name) {
    return { type: "tool", name: choice.function.name };
  }
  return undefined;
}

function parseToolArguments(value) {
  if (!value) {
    return {};
  }
  if (typeof value === "object") {
    return value;
  }
  const parsed = safeJson(String(value));
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

function anthropicMessageToChatCompletion(messageJson, requestBody) {
  const text = [];
  const toolCalls = [];
  const content = Array.isArray(messageJson.content) ? messageJson.content : [];

  for (const part of content) {
    if (!part || typeof part !== "object") {
      continue;
    }
    if (part.type === "text" && part.text) {
      text.push(part.text);
      continue;
    }
    if (part.type === "tool_use" && part.name) {
      toolCalls.push({
        id: part.id || `call_${randomId()}`,
        type: "function",
        function: {
          name: part.name,
          arguments: JSON.stringify(part.input || {})
        }
      });
    }
  }

  const message = {
    role: "assistant",
    content: text.join("\n") || null
  };
  if (toolCalls.length > 0) {
    message.tool_calls = toolCalls;
  }

  return {
    id: messageJson.id || `chatcmpl_${randomId()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: messageJson.model || requestBody.model || DEFAULT_MODEL,
    choices: [{
      index: 0,
      message,
      finish_reason: toolCalls.length > 0 || messageJson.stop_reason === "tool_use" ? "tool_calls" : messageJson.stop_reason === "max_tokens" ? "length" : "stop"
    }],
    usage: anthropicUsageToChatUsage(messageJson.usage)
  };
}

function anthropicUsageToChatUsage(usage) {
  if (!usage) {
    return undefined;
  }
  const promptTokens = usage.input_tokens ?? 0;
  const completionTokens = usage.output_tokens ?? 0;
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: usage.total_tokens ?? promptTokens + completionTokens
  };
}

function chatCompletionToResponse(chatJson, requestBody) {
  const choice = chatJson.choices?.[0] || {};
  const output = chatChoiceToResponseOutput(choice);
  const createdAt = chatJson.created || Math.floor(Date.now() / 1000);
  const response = {
    id: chatJson.id?.startsWith("resp_") ? chatJson.id : `resp_${chatJson.id || randomId()}`,
    object: "response",
    created_at: createdAt,
    status: "completed",
    background: false,
    error: null,
    incomplete_details: null,
    instructions: requestBody.instructions || null,
    max_output_tokens: requestBody.max_output_tokens || null,
    model: chatJson.model || requestBody.model || DEFAULT_MODEL,
    output,
    output_text: outputToText(output),
    parallel_tool_calls: requestBody.parallel_tool_calls ?? true,
    previous_response_id: requestBody.previous_response_id || null,
    reasoning: requestBody.reasoning || null,
    store: false,
    temperature: requestBody.temperature ?? null,
    text: requestBody.text || { format: { type: "text" } },
    tool_choice: requestBody.tool_choice || "auto",
    tools: requestBody.tools || [],
    top_p: requestBody.top_p ?? null,
    truncation: requestBody.truncation || "disabled",
    usage: chatUsageToResponseUsage(chatJson.usage)
  };
  return response;
}

function chatChoiceToResponseOutput(choice) {
  const message = choice.message || {};
  const output = [];

  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    for (const toolCall of message.tool_calls) {
      output.push({
        type: "function_call",
        id: `fc_${toolCall.id || randomId()}`,
        call_id: toolCall.id || `call_${randomId()}`,
        name: toolCall.function?.name || "",
        arguments: toolCall.function?.arguments || "",
        status: "completed"
      });
    }
  }

  if (message.content) {
    output.push({
      type: "message",
      id: `msg_${randomId()}`,
      status: "completed",
      role: "assistant",
      content: [{
        type: "output_text",
        text: typeof message.content === "string" ? message.content : stringifyOutput(message.content),
        annotations: []
      }]
    });
  }

  if (output.length === 0) {
    output.push({
      type: "message",
      id: `msg_${randomId()}`,
      status: "completed",
      role: "assistant",
      content: [{ type: "output_text", text: "", annotations: [] }]
    });
  }

  return output;
}

function chatUsageToResponseUsage(usage) {
  if (!usage) {
    return null;
  }
  return {
    input_tokens: usage.prompt_tokens ?? usage.input_tokens ?? 0,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens: usage.completion_tokens ?? usage.output_tokens ?? 0,
    output_tokens_details: { reasoning_tokens: 0 },
    total_tokens: usage.total_tokens ?? 0
  };
}

function sendResponsesSse(res, responseJson) {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive"
  });

  const started = { ...responseJson, status: "in_progress", output: [] };
  writeSse(res, "response.created", { type: "response.created", response: started });

  responseJson.output.forEach((item, outputIndex) => {
    writeSse(res, "response.output_item.added", {
      type: "response.output_item.added",
      output_index: outputIndex,
      item: item.type === "message" ? { ...item, content: [] } : { ...item, arguments: "" }
    });

    if (item.type === "message") {
      item.content.forEach((part, contentIndex) => {
        const emptyPart = { ...part, text: "" };
        writeSse(res, "response.content_part.added", {
          type: "response.content_part.added",
          item_id: item.id,
          output_index: outputIndex,
          content_index: contentIndex,
          part: emptyPart
        });
        if (part.text) {
          writeSse(res, "response.output_text.delta", {
            type: "response.output_text.delta",
            item_id: item.id,
            output_index: outputIndex,
            content_index: contentIndex,
            delta: part.text
          });
        }
        writeSse(res, "response.output_text.done", {
          type: "response.output_text.done",
          item_id: item.id,
          output_index: outputIndex,
          content_index: contentIndex,
          text: part.text || ""
        });
        writeSse(res, "response.content_part.done", {
          type: "response.content_part.done",
          item_id: item.id,
          output_index: outputIndex,
          content_index: contentIndex,
          part
        });
      });
    }

    if (item.type === "function_call") {
      if (item.arguments) {
        writeSse(res, "response.function_call_arguments.delta", {
          type: "response.function_call_arguments.delta",
          item_id: item.id,
          output_index: outputIndex,
          delta: item.arguments
        });
      }
      writeSse(res, "response.function_call_arguments.done", {
        type: "response.function_call_arguments.done",
        item_id: item.id,
        output_index: outputIndex,
        arguments: item.arguments || ""
      });
    }

    writeSse(res, "response.output_item.done", {
      type: "response.output_item.done",
      output_index: outputIndex,
      item
    });
  });

  writeSse(res, "response.completed", { type: "response.completed", response: responseJson });
  res.end();
}

function updateCodexConfig(text, options) {
  const withoutProvider = removeManagedProviderBlocks(text);
  const lines = withoutProvider.split(/\r?\n/);
  const firstTableIndex = lines.findIndex((line) => /^\s*\[/.test(line));
  const preamble = firstTableIndex === -1 ? lines : lines.slice(0, firstTableIndex);
  const rest = firstTableIndex === -1 ? [] : lines.slice(firstTableIndex);

  const updatedPreamble = setTopLevelValues(preamble, {
    model: options.model,
    model_provider: PROVIDER_ID,
    model_catalog_json: options.catalogPath
  });

  const pieces = [
    updatedPreamble.join("\n").replace(/\s+$/u, ""),
    rest.join("\n").replace(/\s+$/u, ""),
    buildManagedConfigBlock(options).replace(/\s+$/u, "")
  ].filter(Boolean);

  return `${pieces.join("\n\n")}\n`;
}

function updateCodexNativeConfig(text, options) {
  const withoutProvider = removeManagedProviderBlocks(text);
  const lines = withoutProvider.split(/\r?\n/);
  const firstTableIndex = lines.findIndex((line) => /^\s*\[/.test(line));
  const preamble = firstTableIndex === -1 ? lines : lines.slice(0, firstTableIndex);
  const rest = firstTableIndex === -1 ? [] : lines.slice(firstTableIndex);

  const updatedPreamble = setOrRemoveTopLevelValues(preamble, {
    model: options.model,
    model_provider: null,
    model_catalog_json: null
  });

  const pieces = [
    updatedPreamble.join("\n").replace(/\s+$/u, ""),
    rest.join("\n").replace(/\s+$/u, "")
  ].filter(Boolean);

  return `${pieces.join("\n\n")}\n`;
}

function setTopLevelValues(lines, values) {
  const output = [...lines];

  for (const [key, value] of Object.entries(values)) {
    const re = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`);
    let replaced = false;

    for (let index = 0; index < output.length; index += 1) {
      if (!re.test(output[index])) {
        continue;
      }

      if (replaced) {
        output.splice(index, 1);
        index -= 1;
      } else {
        output[index] = `${key} = ${tomlString(value)}`;
        replaced = true;
      }
    }

    if (!replaced) {
      output.push(`${key} = ${tomlString(value)}`);
    }
  }

  return output;
}

function setCodexSettings(values) {
  const settings = {};
  let touched = 0;
  touched += addValidatedSetting(settings, values, "model_reasoning_effort", REASONING_EFFORTS);
  touched += addValidatedSetting(settings, values, "approval_policy", APPROVAL_POLICIES);
  touched += addValidatedSetting(settings, values, "sandbox_mode", SANDBOX_MODES);

  if (touched === 0) {
    throw new Error("No Codex settings selected.");
  }

  const configPath = codexConfigPath();
  const original = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  const lines = original.split(/\r?\n/);
  const firstTableIndex = lines.findIndex((line) => /^\s*\[/.test(line));
  const preamble = firstTableIndex === -1 ? lines : lines.slice(0, firstTableIndex);
  const rest = firstTableIndex === -1 ? [] : lines.slice(firstTableIndex);
  const updatedPreamble = setOrRemoveTopLevelValues(preamble, settings);
  const updated = [
    updatedPreamble.join("\n").replace(/\s+$/u, ""),
    rest.join("\n").replace(/\s+$/u, "")
  ].filter(Boolean).join("\n\n");

  backupConfig(configPath, original, "settings");
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${updated}\n`, "utf8");
  console.log("Updated Codex settings.");
}

function addValidatedSetting(target, values, key, allowedValues) {
  if (!Object.prototype.hasOwnProperty.call(values || {}, key)) {
    return 0;
  }
  const value = typeof values?.[key] === "string" ? values[key].trim() : "";
  if (!value) {
    target[key] = null;
    return 1;
  }
  if (!allowedValues.includes(value)) {
    throw new Error(`Invalid ${key}: ${value}`);
  }
  target[key] = value;
  return 1;
}

function setOrRemoveTopLevelValues(lines, values) {
  const output = [...lines];

  for (const [key, value] of Object.entries(values)) {
    const re = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`);
    let replaced = false;

    for (let index = 0; index < output.length; index += 1) {
      if (!re.test(output[index])) {
        continue;
      }

      if (value === null) {
        output.splice(index, 1);
        index -= 1;
        continue;
      }

      if (replaced) {
        output.splice(index, 1);
        index -= 1;
      } else {
        output[index] = `${key} = ${tomlString(value)}`;
        replaced = true;
      }
    }

    if (!replaced && value !== null) {
      output.push(`${key} = ${tomlString(value)}`);
    }
  }

  return output;
}

function removeManagedProviderBlocks(text) {
  const lines = text.split(/\r?\n/);
  const output = [];
  let index = 0;

  while (index < lines.length) {
    if (isManagedComment(lines[index])) {
      index += 1;
      continue;
    }

    if (isManagedProviderTable(lines[index])) {
      index += 1;
      while (index < lines.length && !/^\s*\[/.test(lines[index])) {
        index += 1;
      }
      continue;
    }

    output.push(lines[index]);
    index += 1;
  }

  return output.join("\n").replace(/\s+$/u, "");
}

function isManagedComment(line) {
  return /^\s*#\s*Managed by [^.]+\./u.test(line);
}

function isManagedProviderTable(line) {
  return new RegExp(`^\\s*\\[model_providers\\.${escapeRegExp(PROVIDER_ID)}(?:\\.auth)?\\]\\s*$`).test(line);
}

function buildManagedConfigBlock({ authMode, port }) {
  const header = [
    `# Managed by ${PROJECT_NAME}. Remove this block or run \`${CLI_NAME} off\` to undo.`,
    `[model_providers.${PROVIDER_ID}]`,
    `name = ${tomlString(PROVIDER_NAME)}`,
    `base_url = ${tomlString(proxyBaseUrl(port || DEFAULT_PROXY_PORT))}`,
    'wire_api = "responses"',
    "supports_websockets = false"
  ];

  if (authMode === "env") {
    return `${header.concat([
      'env_key = "OPENCODE_API_KEY"',
      'env_key_instructions = "Set OPENCODE_API_KEY to your OpenCode Go API key."'
    ]).join("\n")}\n`;
  }

  return `${header.concat([
    "",
    `[model_providers.${PROVIDER_ID}.auth]`,
    `command = ${tomlString(process.execPath)}`,
    `args = [${tomlString(SCRIPT_PATH)}, "token"]`,
    "timeout_ms = 5000",
    "refresh_interval_ms = 300000"
  ]).join("\n")}\n`;
}

function writeModelCatalog(catalogPath, primaryModel) {
  const baseInstructions = codexBaseInstructions();
  const models = catalogModels(primaryModel).map((model, priority) => catalogEntry(model, priority, baseInstructions));
  const data = `${JSON.stringify({ models }, null, 2)}\n`;

  mkdirSync(dirname(catalogPath), { recursive: true });
  writeFileSync(catalogPath, data, "utf8");
}

function catalogModels(primaryModel) {
  const seen = new Set();
  const output = [];
  for (const model of [primaryModel, ...CODEX_CHAT_MODELS.keys()]) {
    const normalized = normalizeModel(String(model || "").trim());
    const key = normalized.replace(/:latest$/u, "");
    if (!normalized || seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(normalized);
  }
  return output;
}

function catalogEntry(model, priority, baseInstructions) {
  const contextWindow = opencodeModelContextWindow(model)?.tokens || DEFAULT_CONTEXT_WINDOW;
  return {
    slug: model,
    display_name: model,
    description: "OpenCode Go subscription model",
    default_reasoning_level: null,
    supported_reasoning_levels: [],
    shell_type: "default",
    visibility: "list",
    supported_in_api: true,
    priority,
    additional_speed_tiers: [],
    availability_nux: null,
    upgrade: null,
    base_instructions: baseInstructions,
    model_messages: null,
    supports_reasoning_summaries: false,
    default_reasoning_summary: "auto",
    support_verbosity: false,
    default_verbosity: null,
    apply_patch_tool_type: null,
    web_search_tool_type: "text",
    truncation_policy: { mode: "bytes", limit: 10_000 },
    supports_parallel_tool_calls: true,
    supports_image_detail_original: false,
    context_window: contextWindow,
    max_context_window: contextWindow,
    auto_compact_token_limit: null,
    effective_context_window_percent: 95,
    experimental_supported_tools: [],
    input_modalities: ["text"],
    supports_search_tool: true
  };
}

function codexBaseInstructions() {
  const cachePath = join(process.env.CODEX_HOME || join(os.homedir(), ".codex"), "models_cache.json");
  if (existsSync(cachePath)) {
    try {
      const cached = JSON.parse(readFileSync(cachePath, "utf8"));
      const models = Array.isArray(cached.models) ? cached.models : [];
      for (const model of models) {
        if (typeof model.base_instructions === "string" && model.base_instructions.trim()) {
          return model.base_instructions;
        }
      }
    } catch {
      // Fall back to the generic instructions below.
    }
  }

  return "You are Codex, a coding agent. You and the user share the same workspace and collaborate to achieve the user's goals.";
}

function codexModelCatalogPath(configPath = codexConfigPath()) {
  return join(dirname(configPath), MODEL_CATALOG_FILENAME);
}

function removeOwnedCatalogIfUnused(configPath) {
  const catalogPath = codexModelCatalogPath(configPath);
  const configText = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  if (readTopLevelValue(configText, "model_catalog_json") === catalogPath) {
    return;
  }
  try {
    if (existsSync(catalogPath)) {
      unlinkSync(catalogPath);
    }
  } catch {
    // The config restore already succeeded; leave cleanup as best effort.
  }
}

function readTopLevelValue(text, key) {
  const firstTable = text.search(/^\s*\[/m);
  const preamble = firstTable === -1 ? text : text.slice(0, firstTable);
  const match = preamble.match(new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*["']?([^"'\\n#]+)["']?`, "m"));
  return match?.[1]?.trim();
}

function validateModel(model, force) {
  if (CODEX_CHAT_MODELS.has(model)) {
    return;
  }

  if (force) {
    return;
  }

  throw new Error(
    `Model "${model}" is not in this helper's docs-backed OpenCode Go list.\n` +
    `Use --force to write it anyway, or choose one of:\n  ${[...CODEX_CHAT_MODELS.keys()].join(", ")}`
  );
}

function validateCodexModel(model, force) {
  if (codexModelOptions(model).some((item) => item.id === model)) {
    return;
  }

  if (force) {
    return;
  }

  throw new Error(
    `Codex model "${model}" is not in the local Codex model cache.\n` +
    `Use --force to write it anyway, or choose one of:\n  ${codexModelOptions("").map((item) => item.id).join(", ")}`
  );
}

function validateClaudeModel(model, force) {
  if (ANTHROPIC_ONLY_DOC_MODELS.has(model)) {
    return;
  }

  if (force) {
    return;
  }

  throw new Error(
    `Model "${model}" is not in this helper's Claude-style OpenCode Go list.\n` +
    `Use --force to try it anyway, or choose one of:\n  ${[...ANTHROPIC_ONLY_DOC_MODELS].join(", ")}`
  );
}

function normalizeModel(model) {
  const withoutProvider = model.startsWith(`${PROVIDER_ID}/`) ? model.slice(PROVIDER_ID.length + 1) : model;
  return OPENCODE_MODEL_ALIASES.get(withoutProvider) || withoutProvider;
}

function tokenFromRequest(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.toLowerCase().startsWith("bearer ")) {
    throw httpError(401, "Missing bearer token. Codex must authenticate to the local OpenCode endpoint.");
  }

  const token = auth.slice("bearer ".length).trim();
  if (!token) {
    throw httpError(401, "Empty bearer token.");
  }
  return token;
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function applyModelRouting(chatBody) {
  const requestedModel = normalizeModel(String(chatBody.model || DEFAULT_MODEL));
  const routing = readRoutingConfig();
  if (!routing?.enabled) {
    const configured = activeConfiguredOpenCodeModelInfo();
    if (configured.active) {
      chatBody.model = configured.model;
      return {
        requestedModel,
        route: requestedModel === configured.model ? "selected_model" : "selected_model_override"
      };
    }

    if (CODEX_CHAT_MODELS.has(requestedModel)) {
      chatBody.model = requestedModel;
      return { requestedModel, route: "default" };
    }

    const fallbackModel = activeConfiguredOpenCodeModel();
    chatBody.model = fallbackModel;
    return { requestedModel, route: "unsupported_model_fallback" };
  }

  const hasTools = Array.isArray(chatBody.tools) && chatBody.tools.length > 0;
  const route = hasTools ? "agent" : "chat";
  const routedModel = hasTools ? routing.agentModel : routing.chatModel;
  if (routedModel) {
    chatBody.model = routedModel;
  }

  return { requestedModel, route };
}

function applyProviderCompatibility(chatBody) {
  const model = normalizeModel(String(chatBody.model || ""));
  if (!isDeepSeekV4Model(model)) {
    return { thinking: "", reasoningReplayed: 0, toolChoice: "" };
  }

  const toolChoice = normalizeDeepSeekToolChoice(chatBody);
  const reasoningReplayed = replayDeepSeekReasoning(chatBody.messages);
  return { thinking: chatBody.thinking?.type || "default", reasoningReplayed, toolChoice };
}

function normalizeDeepSeekToolChoice(chatBody) {
  if (chatBody.tool_choice && chatBody.tool_choice !== "auto") {
    delete chatBody.tool_choice;
    return "auto";
  }
  return "";
}

function rememberDeepSeekReasoning(chatJson) {
  const message = chatJson?.choices?.[0]?.message;
  const reasoningContent = typeof message?.reasoning_content === "string" ? message.reasoning_content : "";
  const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
  if (!reasoningContent || toolCalls.length === 0) {
    return 0;
  }

  let stored = 0;
  for (const toolCall of toolCalls) {
    const id = String(toolCall?.id || "");
    if (!id) {
      continue;
    }
    reasoningContentByToolCallId.set(id, reasoningContent);
    stored += 1;
  }

  while (reasoningContentByToolCallId.size > MAX_REASONING_CACHE_ENTRIES) {
    const oldest = reasoningContentByToolCallId.keys().next().value;
    reasoningContentByToolCallId.delete(oldest);
  }

  return stored;
}

function replayDeepSeekReasoning(messages) {
  if (!Array.isArray(messages)) {
    return 0;
  }

  let replayed = 0;
  for (const message of messages) {
    if (message?.role !== "assistant" || !Array.isArray(message.tool_calls) || message.reasoning_content) {
      continue;
    }
    const reasoningContent = message.tool_calls
      .map((toolCall) => reasoningContentByToolCallId.get(String(toolCall?.id || "")))
      .find((content) => typeof content === "string" && content);
    if (reasoningContent) {
      message.reasoning_content = reasoningContent;
      replayed += 1;
    }
  }
  return replayed;
}

function normalizeToolMessageOrder(chatBody) {
  if (!Array.isArray(chatBody.messages)) {
    return { syntheticToolMessages: 0 };
  }

  const toolMessages = new Map();
  for (const message of chatBody.messages) {
    if (message?.role !== "tool") {
      continue;
    }
    const id = String(message.tool_call_id || "");
    if (!id) {
      continue;
    }
    if (!toolMessages.has(id)) {
      toolMessages.set(id, []);
    }
    toolMessages.get(id).push(message);
  }

  const normalized = [];
  let syntheticToolMessages = 0;
  for (let index = 0; index < chatBody.messages.length; index += 1) {
    const message = chatBody.messages[index];
    if (message?.role === "tool") {
      continue;
    }

    if (message?.role === "assistant" && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      const assistant = { ...message, tool_calls: [...message.tool_calls] };
      while (
        chatBody.messages[index + 1]?.role === "assistant" &&
        Array.isArray(chatBody.messages[index + 1].tool_calls) &&
        chatBody.messages[index + 1].tool_calls.length > 0
      ) {
        index += 1;
        if (!assistant.reasoning_content && chatBody.messages[index].reasoning_content) {
          assistant.reasoning_content = chatBody.messages[index].reasoning_content;
        }
        assistant.tool_calls.push(...chatBody.messages[index].tool_calls);
      }

      normalized.push(assistant);
      for (const toolCall of assistant.tool_calls) {
        const id = String(toolCall.id || "");
        const bucket = toolMessages.get(id);
        if (bucket && bucket.length > 0) {
          normalized.push(bucket.shift());
        } else if (id) {
          normalized.push({ role: "tool", tool_call_id: id, content: "" });
          syntheticToolMessages += 1;
        }
      }
      continue;
    }

    normalized.push(message);
  }

  chatBody.messages = normalized;
  return { syntheticToolMessages };
}

function isDeepSeekV4Model(model) {
  return /^deepseek-v4(?:-|$)/u.test(model);
}

function upstreamErrorMessage(text) {
  const json = safeJson(text);
  const code = json?.error?.type || json?.error?.code || "upstream_error";
  return `Upstream request failed (${safeLogCode(code)}).`;
}

function activeConfiguredOpenCodeModel() {
  return activeConfiguredOpenCodeModelInfo().model;
}

function activeConfiguredOpenCodeModelInfo() {
  try {
    const configPath = codexConfigPath();
    const text = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
    const provider = readTopLevelValue(text, "model_provider") || "";
    const model = normalizeModel(String(readTopLevelValue(text, "model") || DEFAULT_MODEL));
    if (provider === PROVIDER_ID && CODEX_CHAT_MODELS.has(model)) {
      return { model, active: true };
    }
  } catch {
    // Fall through to the stable default.
  }
  return { model: DEFAULT_MODEL, active: false };
}

function routingSummary() {
  const routing = readRoutingConfig();
  if (!routing?.enabled) {
    return "disabled";
  }
  return `enabled chat/planning=${routing.chatModel}, agent/execution=${routing.agentModel}`;
}

function readRoutingConfig() {
  for (const routingPath of uniquePaths([ROUTING_PATH])) {
    if (!existsSync(routingPath)) {
      continue;
    }
    try {
      const config = JSON.parse(readFileSync(routingPath, "utf8"));
      if (!config?.enabled) {
        continue;
      }
      return {
        enabled: true,
        chatModel: normalizeModel(String(config.chatModel || "")),
        agentModel: normalizeModel(String(config.agentModel || ""))
      };
    } catch {
      // Try the next routing config path.
    }
  }
  return undefined;
}

function writeRoutingConfig(config) {
  ensurePrivateAppDir();
  writePrivateFile(ROUTING_PATH, `${JSON.stringify(config, null, 2)}\n`);
}

function removeRoutingConfig() {
  for (const routingPath of uniquePaths([ROUTING_PATH])) {
    if (existsSync(routingPath)) {
      unlinkSync(routingPath);
    }
  }
}

async function pipeFetchResponse(res, upstream) {
  const text = await upstream.text();
  res.writeHead(upstream.status, {
    "content-type": upstream.headers.get("content-type") || "application/json"
  });
  res.end(text);
}

async function fetchWithTimeout(url, options = {}) {
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => {
    timeoutController.abort();
  }, upstreamTimeoutMs());
  const signals = [timeoutController.signal, options.signal].filter(Boolean);
  const signal = signals.length > 1 ? AbortSignal.any(signals) : signals[0];

  try {
    return await fetch(url, { ...options, signal });
  } catch (error) {
    if (timeoutController.signal.aborted) {
      throw httpError(504, "Upstream request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function requestAbortSignal(req, res) {
  const controller = new AbortController();
  const abortIfOpen = () => {
    if (!res?.writableEnded) {
      controller.abort();
    }
  };
  req.on("aborted", abortIfOpen);
  req.on("close", () => {
    if (!req.complete) {
      abortIfOpen();
    }
  });
  res?.on("close", abortIfOpen);
  return controller.signal;
}

async function readJsonBody(req, limitBytes = proxyBodyLimitBytes()) {
  const raw = await readRawBody(req, limitBytes);
  if (!raw.trim()) {
    return {};
  }
  return JSON.parse(raw);
}

async function readRawBody(req, limitBytes = proxyBodyLimitBytes()) {
  return await new Promise((resolve, reject) => {
    let body = "";
    let settled = false;
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      if (settled) {
        return;
      }
      body += chunk;
      if (Buffer.byteLength(body, "utf8") > limitBytes) {
        settled = true;
        reject(httpError(413, "Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!settled) {
        settled = true;
        resolve(body);
      }
    });
    req.on("error", (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
  });
}

function sendJson(res, status, body) {
  const actualStatus = body instanceof Error && body.status ? body.status : status;
  const payload = body instanceof Error
    ? { error: { message: body.message, type: "proxy_error" } }
    : body;
  res.writeHead(actualStatus, {
    "content-type": "application/json",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  res.end(JSON.stringify(payload));
}

function writeSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function logRequest(context, fields = {}) {
  logActivity("request", {
    request_id: context.requestId,
    method: context.method,
    path: context.path,
    ms: Date.now() - context.startedAt,
    ...fields
  });
}

function logActivity(event, fields = {}) {
  console.error(formatActivityLine(event, fields));
}

function appendActivityLog(event, fields = {}) {
  ensurePrivateAppDir();
  writePrivateFile(LOG_PATH, `${formatActivityLine(event, fields)}\n`, { flag: "a" });
}

function formatActivityLine(event, fields = {}) {
  const parts = Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}=${safeLogValue(value)}`);
  return `${new Date().toISOString()} ${event}${parts.length > 0 ? ` ${parts.join(" ")}` : ""}`;
}

function safeLogValue(value) {
  const text = String(value).replace(/[\r\n]/g, " ").slice(0, 240);
  if (/[\s=]/.test(text)) {
    return JSON.stringify(text);
  }
  return text;
}

function safeLogCode(value) {
  return String(value || "upstream_error").replace(/[^a-z0-9_.:-]/giu, "_").slice(0, 80) || "upstream_error";
}

function safeErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/bearer\s+[a-z0-9._~+/=-]+/giu, "bearer [redacted]").slice(0, 240);
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function outputToText(output) {
  return output
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content || [])
    .filter((part) => part.type === "output_text")
    .map((part) => part.text || "")
    .join("");
}

function stringifyOutput(value) {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value ?? "");
}

function randomId() {
  return Math.random().toString(36).slice(2, 12);
}

function codexConfigPath() {
  const codexHome = process.env.CODEX_HOME || join(os.homedir(), ".codex");
  return join(codexHome, "config.toml");
}

function backupConfig(configPath, content, label = "config") {
  ensurePrivateBackupDir();
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.(\d{3})Z$/, "$1Z");
  const backupPath = join(BACKUP_DIR, `${label}-${timestamp}.toml`);
  writePrivateFile(backupPath, content);
  return backupPath;
}

function latestBackupPath() {
  const backups = listBackupFiles()
    .filter((backupPath) => backupName(backupPath).startsWith("config-"))
    .filter((backupPath) => {
      try {
        return !isManagedConfig(readFileSync(backupPath, "utf8"));
      } catch {
        return false;
      }
    });
  return backups.at(-1);
}

function printBackups() {
  const backups = backupSummaries();
  if (backups.length === 0) {
    console.log(`No backups found in ${backupDirs().join(", ")}.`);
    return;
  }

  for (const backup of backups) {
    console.log(`${backup.path}  ${backup.kind} model=${backup.model} provider=${backup.provider}`);
  }
}

function backupSummaries() {
  return listBackupFiles().map((backupPath) => {
    try {
      const text = readFileSync(backupPath, "utf8");
      const managed = isManagedConfig(text);
      return {
        path: backupPath,
        name: backupName(backupPath),
        kind: managed ? "opencode" : "restore",
        restoreable: !managed,
        model: readTopLevelValue(text, "model") || "(unset)",
        provider: readTopLevelValue(text, "model_provider") || "(unset)"
      };
    } catch {
      return {
        path: backupPath,
        name: backupName(backupPath),
        kind: "unreadable",
        restoreable: false,
        model: "(unknown)",
        provider: "(unknown)"
      };
    }
  });
}

function listBackupFiles() {
  const files = [];
  for (const backupDir of backupDirs()) {
    if (!existsSync(backupDir)) {
      continue;
    }

    const result = spawnSync("find", [backupDir, "-type", "f", "-name", "*.toml", "-print"], {
      encoding: "utf8"
    });

    if (result.status === 0) {
      files.push(...result.stdout.split("\n").filter(Boolean));
    }
  }

  return uniquePaths(files).sort();
}

function isManagedConfig(text) {
  return readTopLevelValue(text, "model_provider") === PROVIDER_ID ||
    new RegExp(`^\\s*\\[model_providers\\.${escapeRegExp(PROVIDER_ID)}\\]\\s*$`, "m").test(text);
}

function backupName(backupPath) {
  return backupPath.split(/[\\/]/).at(-1) || backupPath;
}

function backupDirs() {
  return uniquePaths([BACKUP_DIR]);
}

function activeLogPath() {
  return LOG_PATH;
}

function uniquePaths(paths) {
  return [...new Set(paths.filter(Boolean))];
}

function ensurePrivateAppDir() {
  ensurePrivateDir(APP_DIR);
}

function ensurePrivateBackupDir() {
  ensurePrivateAppDir();
  ensurePrivateDir(BACKUP_DIR);
}

function ensurePrivateDir(path) {
  mkdirSync(path, { recursive: true, mode: PRIVATE_DIR_MODE });
  chmodBestEffort(path, PRIVATE_DIR_MODE);
}

function writePrivateFile(path, content, options = {}) {
  writeFileSync(path, content, {
    encoding: "utf8",
    mode: PRIVATE_FILE_MODE,
    ...options
  });
  chmodBestEffort(path, PRIVATE_FILE_MODE);
}

function chmodBestEffort(path, mode) {
  try {
    chmodSync(path, mode);
  } catch {
    // Permission hardening is best effort for unusual filesystems.
  }
}

function storeToken(token) {
  ensurePrivateAppDir();

  if (process.platform === "darwin" && commandExists("security")) {
    spawnSync("security", ["delete-generic-password", "-s", KEYCHAIN_SERVICE, "-a", KEYCHAIN_ACCOUNT], {
      stdio: "ignore"
    });

    const result = spawnSync("security", [
      "add-generic-password",
      "-U",
      "-s",
      KEYCHAIN_SERVICE,
      "-a",
      KEYCHAIN_ACCOUNT,
      "-w",
      token
    ], { encoding: "utf8" });

    if (result.status === 0) {
      return;
    }

    console.warn("Keychain storage failed, falling back to a chmod 0600 token file.");
  }

  writePrivateFile(FILE_TOKEN_PATH, `${token}\n`);
}

function clearStoredToken() {
  if (process.env.OPENCODE_API_KEY?.trim()) {
    throw new Error("OPENCODE_API_KEY is set in the environment. Remove it from your shell or app environment instead.");
  }

  if (process.platform === "darwin" && commandExists("security")) {
    spawnSync("security", ["delete-generic-password", "-s", KEYCHAIN_SERVICE, "-a", KEYCHAIN_ACCOUNT], {
      stdio: "ignore"
    });
  }

  if (existsSync(FILE_TOKEN_PATH)) {
    unlinkSync(FILE_TOKEN_PATH);
  }
}

function readStoredToken() {
  if (process.env.OPENCODE_API_KEY?.trim()) {
    return process.env.OPENCODE_API_KEY.trim();
  }

  if (process.platform === "darwin" && commandExists("security")) {
    for (const service of [KEYCHAIN_SERVICE]) {
      const result = spawnSync("security", [
        "find-generic-password",
        "-w",
        "-s",
        service,
        "-a",
        KEYCHAIN_ACCOUNT
      ], { encoding: "utf8" });

      if (result.status === 0 && result.stdout.trim()) {
        return result.stdout.trim();
      }
    }
  }

  for (const tokenPath of uniquePaths([FILE_TOKEN_PATH])) {
    if (existsSync(tokenPath)) {
      const token = readFileSync(tokenPath, "utf8").trim();
      if (token) {
        return token;
      }
    }
  }

  throw new Error(`OpenCode Go API key not found. Run "${CLI_NAME} login" or set OPENCODE_API_KEY.`);
}

function hasStoredToken() {
  try {
    readStoredToken();
    return true;
  } catch {
    return false;
  }
}

function tokenStoreName() {
  if (process.env.OPENCODE_API_KEY?.trim()) {
    return "OPENCODE_API_KEY";
  }

  if (process.platform === "darwin" && commandExists("security")) {
    const services = [[KEYCHAIN_SERVICE, "macOS Keychain"]];
    for (const [service, label] of services) {
      const result = spawnSync("security", [
        "find-generic-password",
        "-w",
        "-s",
        service,
        "-a",
        KEYCHAIN_ACCOUNT
      ], { encoding: "utf8" });
      if (result.status === 0 && result.stdout.trim()) {
        return label;
      }
    }
  }

  return FILE_TOKEN_PATH;
}

async function proxyHealth(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(800)
    });
    return { ok: response.ok };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const detail = message === "fetch failed"
      ? `not reachable on 127.0.0.1:${port}`
      : message;
    return { ok: false, error: detail };
  }
}

function proxyBaseUrl(port) {
  return `http://127.0.0.1:${port}/v1`;
}

function upstreamTimeoutMs() {
  return readPositiveIntEnv("NAVO_UPSTREAM_TIMEOUT_MS", DEFAULT_UPSTREAM_TIMEOUT_MS, 1_000, 10 * 60 * 1000);
}

function proxyBodyLimitBytes() {
  return readPositiveIntEnv("NAVO_PROXY_BODY_LIMIT_BYTES", DEFAULT_PROXY_BODY_LIMIT_BYTES, 1024, 100 * 1024 * 1024);
}

function readPositiveIntEnv(name, fallback, min, max) {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    return fallback;
  }
  return value;
}

function upstreamHost() {
  try {
    return new URL(OPENCODE_BASE_URL).host;
  } catch {
    return OPENCODE_BASE_URL;
  }
}

function readPort(options = {}) {
  const explicitPort = options.port;
  const port = Number(explicitPort || configuredProviderPort() || DEFAULT_PROXY_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${explicitPort || port}`);
  }
  return port;
}

function configuredProviderPort() {
  try {
    const configPath = codexConfigPath();
    if (!existsSync(configPath)) {
      return null;
    }
    const text = readFileSync(configPath, "utf8");
    const baseUrl = readProviderValue(text, PROVIDER_ID, "base_url");
    if (!baseUrl) {
      return null;
    }
    const url = new URL(baseUrl);
    const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
    return Number.isInteger(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

function readProviderValue(text, providerId, key) {
  const table = new RegExp(`^\\s*\\[model_providers\\.${escapeRegExp(providerId)}\\]\\s*$`, "m");
  const match = table.exec(text);
  if (!match) {
    return "";
  }
  const rest = text.slice(match.index + match[0].length);
  const nextTable = rest.search(/^\s*\[/m);
  const section = nextTable === -1 ? rest : rest.slice(0, nextTable);
  const valueMatch = section.match(new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*["']?([^"'\\n#]+)["']?`, "m"));
  return valueMatch?.[1]?.trim() || "";
}

function readUiPort(options) {
  const port = Number(options.port || DEFAULT_UI_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid UI port: ${options.port}`);
  }
  return port;
}

function commandExists(command) {
  const result = spawnSync("which", [command], {
    stdio: "ignore"
  });
  return result.status === 0;
}

function readAllStdin() {
  return readFileSync(0, "utf8");
}

async function readHidden(prompt) {
  if (!process.stdin.isTTY) {
    return readAllStdin();
  }

  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  return await new Promise((resolve, reject) => {
    let value = "";

    function cleanup() {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
    }

    process.stdin.on("data", function onData(char) {
      if (char === "\u0003") {
        cleanup();
        reject(new Error("Cancelled."));
        return;
      }

      if (char === "\r" || char === "\n") {
        process.stdin.off("data", onData);
        cleanup();
        resolve(value);
        return;
      }

      if (char === "\u007f") {
        value = value.slice(0, -1);
        return;
      }

      value += char;
    });
  });
}

async function readLine(prompt) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(prompt);
  } finally {
    rl.close();
  }
}

async function pickModel(title, { current } = {}) {
  const items = [...CODEX_CHAT_MODELS.entries()].map(([model, note]) => ({
    value: model,
    label: `${model}${model === current ? "  (active)" : ""}`,
    detail: note
  }));
  return await pickFromList(title, items, { currentValue: current });
}

async function pickCodexModel(title, { current } = {}) {
  const items = codexModelOptions(current).map((model) => ({
    value: model.id,
    label: `${model.id}${model.id === current ? "  (active)" : ""}`,
    detail: model.name || "Codex native model"
  }));
  return await pickFromList(title, items, { currentValue: current });
}

async function pickFromList(title, items, { currentValue } = {}) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Interactive selection requires a TTY.");
  }

  let index = Math.max(0, items.findIndex((item) => item.value === currentValue));
  let renderedLines = 0;
  const pageSize = Math.max(4, Math.min(10, (process.stdout.rows || 18) - 6));

  const cleanup = () => {
    process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdout.write("\x1b[?25h");
  };

  const render = () => {
    if (renderedLines > 0) {
      process.stdout.write(`\x1b[${renderedLines}A`);
    }

    const start = Math.min(
      Math.max(0, index - Math.floor(pageSize / 2)),
      Math.max(0, items.length - pageSize)
    );
    const visible = items.slice(start, start + pageSize);
    const lines = [
      `${title}`,
      "Use Up/Down, PageUp/PageDown, Enter to select, q to cancel.",
      ""
    ];

    visible.forEach((item, offset) => {
      const itemIndex = start + offset;
      const cursor = itemIndex === index ? ">" : " ";
      const marker = item.value === currentValue ? "*" : " ";
      lines.push(`${cursor}${marker} ${item.label}`);
      lines.push(`   ${item.detail}`);
    });
    lines.push("");
    lines.push(`${index + 1}/${items.length}`);

    process.stdout.write(lines.map((line) => `\x1b[2K${line}`).join("\n"));
    process.stdout.write("\n");
    renderedLines = lines.length;
  };

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  process.stdout.write("\x1b[?25l");
  render();

  return await new Promise((resolve, reject) => {
    const finish = (value) => {
      process.stdin.off("data", onData);
      cleanup();
      resolve(value);
    };

    const failPick = (error) => {
      process.stdin.off("data", onData);
      cleanup();
      reject(error);
    };

    const onData = (key) => {
      if (key === "\u0003") {
        failPick(new Error("Cancelled."));
        return;
      }
      if (key === "q" || key === "Q" || key === "\u001b") {
        finish(undefined);
        return;
      }
      if (key === "\r" || key === "\n") {
        finish(items[index]?.value);
        return;
      }
      if (key === "\u001b[A" || key === "k") {
        index = Math.max(0, index - 1);
        render();
        return;
      }
      if (key === "\u001b[B" || key === "j") {
        index = Math.min(items.length - 1, index + 1);
        render();
        return;
      }
      if (key === "\u001b[5~") {
        index = Math.max(0, index - pageSize);
        render();
        return;
      }
      if (key === "\u001b[6~") {
        index = Math.min(items.length - 1, index + pageSize);
        render();
      }
    };

    process.stdin.on("data", onData);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tomlString(value) {
  return JSON.stringify(String(value));
}

function htmlAttr(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

await main();
