import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(new URL("../bin/navo.mjs", import.meta.url));

function tempHomes() {
  const root = mkdtempSync(join(tmpdir(), "navo-test-"));
  return {
    root,
    navoHome: join(root, "navo"),
    codexHome: join(root, "codex")
  };
}

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function spawnNavo(args, env) {
  return spawn(process.execPath, [SCRIPT_PATH, ...args], {
    env: {
      ...process.env,
      ...env
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
}

async function runNavo(args, env) {
  const child = spawnNavo(args, env);
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const code = await new Promise((resolve) => child.once("exit", resolve));
  return { code, stdout, stderr };
}

async function waitForUrl(processHandle, url) {
  let lastError = "";
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (processHandle.exitCode !== null) {
      const stderr = processHandle.stderr.read()?.toString() || "";
      throw new Error(`process exited with ${processHandle.exitCode}: ${stderr}`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(300) });
      if (response.ok) {
        return response;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${url}: ${lastError}`);
}

async function withDashboard(callback) {
  const homes = tempHomes();
  const uiPort = await freePort();
  const proxyPort = await freePort();
  const child = spawnNavo([
    "ui",
    "--foreground",
    "--port",
    String(uiPort),
    "--opencode-port",
    String(proxyPort),
    "--no-open"
  ], {
    NAVO_HOME: homes.navoHome,
    CODEX_HOME: homes.codexHome
  });

  try {
    await waitForUrl(child, `http://127.0.0.1:${uiPort}/api/health`);
    await callback({ ...homes, uiPort, proxyPort });
  } finally {
    child.kill("SIGTERM");
  }
}

async function dashboardToken(uiPort) {
  const response = await fetch(`http://127.0.0.1:${uiPort}/`);
  const html = await response.text();
  const match = html.match(/name="navo-session-token"\s+content="([^"]+)"/u);
  assert.ok(match, "dashboard page should include a local session token");
  return match[1];
}

test("foreground dashboard creates a fresh state directory before writing pid", async () => {
  const homes = tempHomes();
  const uiPort = await freePort();
  const proxyPort = await freePort();
  const child = spawnNavo([
    "ui",
    "--foreground",
    "--port",
    String(uiPort),
    "--opencode-port",
    String(proxyPort),
    "--no-open"
  ], {
    NAVO_HOME: homes.navoHome,
    CODEX_HOME: homes.codexHome
  });

  try {
    await waitForUrl(child, `http://127.0.0.1:${uiPort}/api/health`);
    assert.ok(existsSync(join(homes.navoHome, "ui.pid")));
  } finally {
    child.kill("SIGTERM");
  }
});

test("dashboard rejects state-changing requests without its local session token", async () => {
  await withDashboard(async ({ uiPort, codexHome }) => {
    const response = await fetch(`http://127.0.0.1:${uiPort}/api/config`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ sandbox_mode: "danger-full-access" })
    });

    assert.notEqual(response.status, 200);
    assert.equal(existsSync(join(codexHome, "config.toml")), false);
  });
});

test("dashboard shows honest model controls without duplicate mode action cards", async () => {
  await withDashboard(async ({ uiPort }) => {
    const pageResponse = await fetch(`http://127.0.0.1:${uiPort}/`);
    const html = await pageResponse.text();
    assert.match(html, /Revert to Codex Mode/u);
    assert.doesNotMatch(html, /id="codex-model-select"/u);
    assert.match(html, /id="context-row" hidden/u);
    assert.match(html, /pendingModelSelection/u);
    assert.match(html, /updatePendingModelSelection/u);
    assert.match(html, /selectedOpenCodeModelForAction/u);
    assert.match(html, /providerSwitchNeedsRestart/u);
    assert.match(html, /<a class="top-link" href="https:\/\/github\.com\/rebel0789\/navo" target="_blank" rel="noreferrer">Star on GitHub<\/a>/u);
    assert.match(html, /class="setup-star-link"/u);
    assert.match(html, /api\("\/api\/model", \{ model: pendingModelSelection \}/u);
    assert.doesNotMatch(html, /OpenCode API Key:/u);
    assert.doesNotMatch(html, /<dd>200K<\/dd>/u);
    assert.doesNotMatch(html, /Use Codex Default/u);

    const stateResponse = await fetch(`http://127.0.0.1:${uiPort}/api/state`);
    const body = await stateResponse.json();
    const flash = body.state.models.find((model) => model.id === "deepseek-v4-flash");
    const glm = body.state.models.find((model) => model.id === "glm-5.1");
    const modelIds = body.state.models.map((model) => model.id);
    assert.deepEqual(modelIds, [
      "deepseek-v4-flash",
      "deepseek-v4-pro",
      "glm-5.1",
      "glm-5",
      "kimi-k2.7-code",
      "kimi-k2.6",
      "mimo-v2.5-pro",
      "mimo-v2.5",
      "minimax-m3",
      "minimax-m2.7",
      "minimax-m2.5",
      "qwen3.7-max",
      "qwen3.7-plus",
      "qwen3.6-plus"
    ]);
    assert.equal(modelIds.includes("kimi-k2.5"), false);
    assert.equal(flash.contextWindow, null);
    assert.equal(glm.contextWindow, null);
  });
});

test("dashboard restore only accepts known Navo backup paths", async () => {
  await withDashboard(async ({ root, uiPort, codexHome }) => {
    const token = await dashboardToken(uiPort);
    const notABackup = join(root, "not-a-navo-backup.toml");
    writeFileSync(notABackup, 'model = "evil"\n', "utf8");

    const response = await fetch(`http://127.0.0.1:${uiPort}/api/restore`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-navo-token": token
      },
      body: JSON.stringify({ backup: notABackup })
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.match(body.error, /known Navo backup/u);
    assert.equal(existsSync(join(codexHome, "config.toml")), false);
  });
});

test("models command shows docs-backed Go models and marks live-only models", async () => {
  const homes = tempHomes();
  const upstream = http.createServer((req, res) => {
    if (req.url === "/models") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        data: [
          { id: "deepseek-v4-flash" },
          { id: "minimax-m3" },
          { id: "hy3-preview" }
        ]
      }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "not found" } }));
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const address = upstream.address();
  const upstreamPort = address && typeof address === "object" ? address.port : 0;
  const env = {
    NAVO_HOME: homes.navoHome,
    CODEX_HOME: homes.codexHome,
    OCGO_UPSTREAM_BASE_URL: `http://127.0.0.1:${upstreamPort}`
  };

  try {
    const visible = await runNavo(["models"], env);
    assert.equal(visible.code, 0, visible.stderr);
    assert.match(visible.stdout, /deepseek-v4-flash/u);
    assert.match(visible.stdout, /glm-5\.1/u);
    assert.match(visible.stdout, /minimax-m3/u);
    assert.match(visible.stdout, /qwen3\.7-plus/u);
    assert.doesNotMatch(visible.stdout, /hy3-preview/u);
    assert.match(visible.stdout, /OpenCode Go documentation/u);

    const all = await runNavo(["models", "--all"], env);
    assert.equal(all.code, 0, all.stderr);
    assert.match(all.stdout, /minimax-m3/u);
    assert.match(all.stdout, /hy3-preview/u);
    assert.match(all.stdout, /not in Navo's docs-backed selector/u);
  } finally {
    await new Promise((resolve) => upstream.close(resolve));
  }
});

test("proxy activity log does not include upstream prompt echoes", async () => {
  const homes = tempHomes();
  const proxyPort = await freePort();
  const upstream = http.createServer((req, res) => {
    if (req.url === "/chat/completions") {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({
        error: {
          message: "bad prompt SECRET_PROMPT_SHOULD_NOT_LOG bearer abc123"
        }
      }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "not found" } }));
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const address = upstream.address();
  const upstreamPort = address && typeof address === "object" ? address.port : 0;

  const env = {
    NAVO_HOME: homes.navoHome,
    CODEX_HOME: homes.codexHome,
    OCGO_UPSTREAM_BASE_URL: `http://127.0.0.1:${upstreamPort}`
  };
  const starter = spawnNavo(["proxy-start", "--port", String(proxyPort)], env);
  const starterExit = await new Promise((resolve) => starter.once("exit", resolve));
  assert.equal(starterExit, 0);

  try {
    const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/responses`, {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: "deepseek-v4-flash",
        input: "SECRET_PROMPT_SHOULD_NOT_LOG",
        max_output_tokens: 8
      })
    });
    assert.equal(response.status, 400);

    const log = readFileSync(join(homes.navoHome, "proxy.log"), "utf8");
    assert.doesNotMatch(log, /SECRET_PROMPT_SHOULD_NOT_LOG/u);
    assert.doesNotMatch(log, /abc123/u);
  } finally {
    await new Promise((resolve) => spawnNavo(["proxy-stop"], env).once("exit", resolve));
    await new Promise((resolve) => upstream.close(resolve));
  }
});

test("proxy routes documented messages models to the selected OpenCode messages endpoint", async () => {
  const homes = tempHomes();
  const proxyPort = await freePort();
  const upstreamRequests = [];
  const upstream = http.createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      upstreamRequests.push({ url: req.url, body: JSON.parse(body || "{}") });
      if (req.url === "/messages") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          id: "msg_test",
          type: "message",
          role: "assistant",
          model: "qwen3.7-plus",
          content: [{ type: "text", text: "ok" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 3, output_tokens: 1 }
        }));
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "wrong endpoint" } }));
    });
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const address = upstream.address();
  const upstreamPort = address && typeof address === "object" ? address.port : 0;

  const env = {
    NAVO_HOME: homes.navoHome,
    CODEX_HOME: homes.codexHome,
    OCGO_UPSTREAM_BASE_URL: `http://127.0.0.1:${upstreamPort}`
  };
  const starter = spawnNavo(["proxy-start", "--port", String(proxyPort)], env);
  const starterExit = await new Promise((resolve) => starter.once("exit", resolve));
  assert.equal(starterExit, 0);

  try {
    const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/responses`, {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: "qwen3.7-plus",
        input: "Reply with exactly: ok",
        max_output_tokens: 8
      })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.model, "qwen3.7-plus");
    assert.equal(body.output_text, "ok");

    assert.equal(upstreamRequests.length, 1);
    assert.equal(upstreamRequests[0].url, "/messages");
    assert.equal(upstreamRequests[0].body.model, "qwen3.7-plus");
    assert.deepEqual(upstreamRequests[0].body.messages, [{
      role: "user",
      content: [{ type: "text", text: "Reply with exactly: ok" }]
    }]);

    const log = readFileSync(join(homes.navoHome, "proxy.log"), "utf8");
    assert.match(log, /upstream_path=\/messages/u);
    assert.match(log, /model=qwen3\.7-plus/u);
    assert.doesNotMatch(log, /model=mimo/u);
  } finally {
    await new Promise((resolve) => spawnNavo(["proxy-stop"], env).once("exit", resolve));
    await new Promise((resolve) => upstream.close(resolve));
  }
});

test("proxy forces old Navo chats to the currently configured single model", async () => {
  const homes = tempHomes();
  const proxyPort = await freePort();
  const upstreamRequests = [];
  const upstream = http.createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      upstreamRequests.push({ url: req.url, body: JSON.parse(body || "{}") });
      if (req.url === "/chat/completions") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          id: "chatcmpl_override",
          object: "chat.completion",
          model: "kimi-k2.7-code",
          choices: [{
            index: 0,
            message: { role: "assistant", content: "ok" },
            finish_reason: "stop"
          }],
          usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 }
        }));
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "wrong endpoint" } }));
    });
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const address = upstream.address();
  const upstreamPort = address && typeof address === "object" ? address.port : 0;
  const env = {
    NAVO_HOME: homes.navoHome,
    CODEX_HOME: homes.codexHome,
    OCGO_UPSTREAM_BASE_URL: `http://127.0.0.1:${upstreamPort}`
  };

  const configured = await runNavo(["configure", "--model", "kimi-k2.7-code", "--port", String(proxyPort)], env);
  assert.equal(configured.code, 0, configured.stderr);
  const starter = spawnNavo(["proxy-start", "--port", String(proxyPort)], env);
  const starterExit = await new Promise((resolve) => starter.once("exit", resolve));
  assert.equal(starterExit, 0);

  try {
    const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/responses`, {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: "mimo-v2.5-pro",
        input: "Keep this old chat context",
        max_output_tokens: 8
      })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.model, "kimi-k2.7-code");
    assert.equal(body.output_text, "ok");

    assert.equal(upstreamRequests.length, 1);
    assert.equal(upstreamRequests[0].url, "/chat/completions");
    assert.equal(upstreamRequests[0].body.model, "kimi-k2.7-code");
    assert.deepEqual(upstreamRequests[0].body.messages, [{
      role: "user",
      content: "Keep this old chat context"
    }]);

    const log = readFileSync(join(homes.navoHome, "proxy.log"), "utf8");
    assert.match(log, /requested_model=mimo-v2\.5-pro/u);
    assert.match(log, /model=kimi-k2\.7-code/u);
    assert.match(log, /route=selected_model_override/u);
  } finally {
    await new Promise((resolve) => spawnNavo(["proxy-stop"], env).once("exit", resolve));
    await new Promise((resolve) => upstream.close(resolve));
  }
});

test("configure writes Navo state and backups with private file modes", async () => {
  const homes = tempHomes();
  const configuredPort = await freePort();
  const modelMessages = {
    instructions_template: "Native Codex instructions {{instructions}}",
    instructions_variables: { instructions: "test" }
  };
  mkdirSync(homes.codexHome, { recursive: true });
  writeFileSync(join(homes.codexHome, "models_cache.json"), JSON.stringify({
    models: [{
      base_instructions: "Native Codex base instructions",
      model_messages: modelMessages
    }]
  }), "utf8");
  const child = spawnNavo([
    "configure",
    "--model",
    "deepseek-v4-flash",
    "--port",
    String(configuredPort)
  ], {
    NAVO_HOME: homes.navoHome,
    CODEX_HOME: homes.codexHome
  });
  const exitCode = await new Promise((resolve) => child.once("exit", resolve));
  assert.equal(exitCode, 0);

  const backupDir = join(homes.navoHome, "backups");
  assert.equal(statSync(homes.navoHome).mode & 0o777, 0o700);
  assert.equal(statSync(backupDir).mode & 0o777, 0o700);

  const catalog = JSON.parse(readFileSync(join(homes.codexHome, "navo-models.json"), "utf8"));
  const flash = catalog.models.find((model) => model.slug === "deepseek-v4-flash");
  const qwen = catalog.models.find((model) => model.slug === "qwen3.7-plus");
  const slugs = catalog.models.map((model) => model.slug);
  assert.equal(slugs.includes("kimi-k2.7-code"), true);
  assert.equal(slugs.includes("kimi-k2.5"), false);
  assert.equal(slugs.includes("minimax-m3"), true);
  assert.equal(slugs.includes("qwen3.7-max"), true);
  assert.equal(flash.context_window, 128_000);
  assert.equal(qwen.context_window, 128_000);
  assert.equal(flash.web_search_tool_type, "text");
  assert.equal(flash.supports_parallel_tool_calls, true);
  assert.equal(flash.supports_search_tool, true);
  assert.equal(flash.shell_type, "shell_command");
  assert.deepEqual(flash.service_tiers, []);
  assert.equal(flash.supports_reasoning_summaries, true);
  assert.equal(flash.default_reasoning_summary, "none");
  assert.equal(flash.support_verbosity, true);
  assert.equal(flash.default_verbosity, "low");
  assert.equal(flash.use_responses_lite, false);
  assert.equal(flash.base_instructions, "Native Codex base instructions");
  assert.deepEqual(flash.model_messages, modelMessages);
  assert.equal(flash.apply_patch_tool_type, null);
  assert.equal(flash.supports_image_detail_original, false);
  assert.deepEqual(flash.input_modalities, ["text"]);

  const backups = readdirSync(backupDir).filter((name) => name.endsWith(".toml"));
  assert.equal(backups.length, 1);
  assert.equal(statSync(join(backupDir, backups[0])).mode & 0o777, 0o600);

  const status = await runNavo(["status"], {
    NAVO_HOME: homes.navoHome,
    CODEX_HOME: homes.codexHome
  });
  assert.equal(status.code, 0, status.stderr);
  assert.match(status.stdout, new RegExp(`127\\.0\\.0\\.1:${configuredPort}`, "u"));
});

test("configure normalizes the documented Kimi K2.7 alias to the Codex config id", async () => {
  const homes = tempHomes();
  const child = spawnNavo([
    "configure",
    "--model",
    "kimi-k2.7",
    "--port",
    String(await freePort())
  ], {
    NAVO_HOME: homes.navoHome,
    CODEX_HOME: homes.codexHome
  });
  const exitCode = await new Promise((resolve) => child.once("exit", resolve));
  assert.equal(exitCode, 0);

  const config = readFileSync(join(homes.codexHome, "config.toml"), "utf8");
  assert.match(config, /model = "kimi-k2\.7-code"/u);
});
