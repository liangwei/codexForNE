#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { callNeMcpProxyTool, NE_MCP_TOOLS } from "./ne-mcp-tools.js";
import { createLineInput, formatError, isRequest, writeError, writeResult } from "./ne-mcp-rpc.js";
import { callNeRagTool, isNeRagToolName, NE_RAG_TOOLS } from "./ne-rag-tools.js";

const PROTOCOL_VERSION = "2025-06-18";
const CLIENT_INFO = Object.freeze({ name: "necli", version: readPackageVersion() });
const NE_LITERATURE_TOOLS = Object.freeze([...NE_MCP_TOOLS, ...NE_RAG_TOOLS]);

process.stdin.setEncoding("utf8");
process.stdin.on(
  "data",
  createLineInput((line) => {
    void handleRawMessage(line);
  }),
);

async function handleRawMessage(line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch (error) {
    writeError(null, -32700, formatError(error));
    return;
  }

  if (!isRequest(message)) {
    return;
  }

  try {
    const result = await handleRequest(message.method, message.params);
    writeResult(message.id, result);
  } catch (error) {
    writeError(message.id, -32603, formatError(error));
  }
}

async function handleRequest(method, params) {
  if (method === "initialize") {
    return initializeResult(params);
  }
  if (method === "ping") {
    return {};
  }
  if (method === "tools/list") {
    return { tools: NE_LITERATURE_TOOLS };
  }
  if (method === "tools/call") {
    return callNeLiteratureTool(params);
  }
  throw new Error(`Unsupported MCP method: ${method}`);
}

function callNeLiteratureTool(params) {
  if (isNeRagToolName(params?.name)) {
    return callNeRagTool(params);
  }
  return callNeMcpProxyTool(params, CLIENT_INFO);
}

function initializeResult(params) {
  return {
    protocolVersion: params?.protocolVersion ?? PROTOCOL_VERSION,
    capabilities: { tools: {} },
    serverInfo: {
      name: "necli-mcp",
      version: CLIENT_INFO.version,
    },
  };
}

function readPackageVersion() {
  const binDir = path.dirname(fileURLToPath(import.meta.url));
  const packageJsonPath = path.join(binDir, "..", "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  return typeof packageJson.version === "string" ? packageJson.version : "0.0.0";
}
