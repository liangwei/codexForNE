import { spawn } from "node:child_process";

const REQUEST_TIMEOUT_MS = 60000;
const STARTUP_TIMEOUT_MS = 30000;
const MAX_STDERR_CHARS = 4000;
const PROTOCOL_VERSION = "2025-06-18";

/**
 * Create a line-oriented JSON-RPC input handler for MCP stdio.
 */
export function createLineInput(onLine) {
  let buffer = "";
  return (chunk) => {
    buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) {
        return;
      }
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      if (line.trim()) {
        onLine(line);
      }
    }
  };
}

/**
 * Create a remote MCP client backed by a spawned stdio server.
 */
export function createRemoteClient(server, clientInfo) {
  const child = spawn(server.command, server.args, {
    cwd: server.cwd,
    env: process.env,
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const state = createJsonRpcState(child, server);
  return {
    close: () => closeChild(child),
    initialize: async () => {
      await state.waitForSpawn();
      await state.request("initialize", initializeParams(clientInfo), STARTUP_TIMEOUT_MS);
      state.notify("notifications/initialized", {});
    },
    request: (method, params) => state.request(method, params, REQUEST_TIMEOUT_MS),
  };
}

/**
 * Return a JSON-RPC success response.
 */
export function writeResult(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

/**
 * Return a JSON-RPC error response.
 */
export function writeError(id, code, message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`);
}

/**
 * Check whether a JSON object is a request that expects a response.
 */
export function isRequest(message) {
  return message && typeof message.method === "string" && Object.hasOwn(message, "id");
}

/**
 * Format unknown thrown values into user-facing error text.
 */
export function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

function createJsonRpcState(child, server) {
  let nextId = 1;
  let stdoutBuffer = "";
  let stderrBuffer = "";
  const pending = new Map();
  const spawnPromise = new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });

  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk.toString("utf8");
    consumeChildStdout();
  });
  child.stderr.on("data", (chunk) => {
    stderrBuffer = `${stderrBuffer}${chunk.toString("utf8")}`.slice(-MAX_STDERR_CHARS);
  });
  child.once("exit", (code, signal) => {
    rejectPending(pending, `${server.command} exited with code ${code ?? "null"} signal ${signal ?? "null"}.`);
  });

  function consumeChildStdout() {
    for (;;) {
      const newline = stdoutBuffer.indexOf("\n");
      if (newline < 0) {
        return;
      }
      const line = stdoutBuffer.slice(0, newline).replace(/\r$/, "");
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
      if (line.trim()) {
        handleChildLine(line, pending);
      }
    }
  }

  return {
    notify: (method, params) => sendJson(child, { jsonrpc: "2.0", method, params }),
    request: (method, params, timeoutMs) => {
      const id = nextId++;
      sendJson(child, { jsonrpc: "2.0", id, method, params });
      return waitForResponse(pending, id, timeoutMs, () => stderrBuffer.trim());
    },
    waitForSpawn: () => spawnPromise,
  };
}

function handleChildLine(line, pending) {
  let message;
  try {
    message = JSON.parse(line);
  } catch (error) {
    rejectPending(pending, `MCP server wrote invalid JSON: ${formatError(error)}`);
    return;
  }
  if (!Object.hasOwn(message, "id")) {
    return;
  }
  const entry = pending.get(message.id);
  if (!entry) {
    return;
  }
  pending.delete(message.id);
  clearTimeout(entry.timeout);
  if (message.error) {
    entry.reject(new Error(message.error.message || JSON.stringify(message.error)));
    return;
  }
  entry.resolve(message.result);
}

function waitForResponse(pending, id, timeoutMs, getStderr) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      const stderr = getStderr();
      reject(new Error(timeoutMessage(stderr)));
    }, timeoutMs);
    pending.set(id, { reject, resolve, timeout });
  });
}

function timeoutMessage(stderr) {
  return stderr ? `MCP request timed out.\nMCP stderr:\n${stderr}` : "MCP request timed out.";
}

function rejectPending(pending, message) {
  for (const [id, entry] of pending) {
    pending.delete(id);
    clearTimeout(entry.timeout);
    entry.reject(new Error(message));
  }
}

function initializeParams(clientInfo) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo,
  };
}

function sendJson(child, message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

function closeChild(child) {
  child.stdin.end();
  if (child.exitCode === null && !child.killed) {
    child.kill();
  }
}
