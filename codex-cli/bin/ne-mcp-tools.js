import { getDefaultNeMcpServers, resolveNeMcpServerName } from "./ne-mcp-config.js";
import { createRemoteClient } from "./ne-mcp-rpc.js";

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 5;
const RAW_ARGUMENTS = Object.freeze({});

const RAW_TOOL_NAMES = Object.freeze({
  folder: "noteExpressWeb_search_articles_by_folder",
  pdf: "noteExpressWeb_get_article_pdf_content",
  save: "noteExpressWeb_save_articles",
  search: "noteExpressWeb_search_articles",
});

/**
 * MCP tool definitions exposed by the NE-CLI literature proxy.
 */
export const NE_MCP_TOOLS = Object.freeze([
  tool("ne_mcp_list_tools", "List raw tools exposed by NE or Qingti MCP.", {
    server: serverProperty(),
  }),
  tool(
    "ne_mcp_search_articles",
    "Search literature/articles in NE or Qingti through MCP.",
    {
      server: serverProperty(),
      query: stringProperty("Search query for NE/Qingti literature."),
      page: numberProperty("1-based result page. Default: 1."),
      pageSize: numberProperty("Results per page. Default: 5."),
    },
    ["query"],
  ),
  tool(
    "ne_mcp_search_folder",
    "Search literature/articles by NE or Qingti folder name.",
    {
      server: serverProperty(),
      folder: stringProperty("NE/Qingti folder name to search."),
    },
    ["folder"],
  ),
  tool(
    "ne_mcp_get_article_pdf",
    "Read PDF text/content for an article id returned by NE or Qingti MCP search.",
    {
      server: serverProperty(),
      articleId: stringProperty("Article id returned by MCP search."),
    },
    ["articleId"],
  ),
  tool("ne_mcp_count_articles", "Count matching literature/articles in NE or Qingti.", {
    server: serverProperty(),
    query: stringProperty("Optional query. Empty counts all matched literature."),
  }),
  tool(
    "ne_mcp_save_articles",
    "Save articles to NE or Qingti. Call ne_mcp_list_tools first if fields are unclear.",
    {
      server: serverProperty(),
      data: {
        description: "Payload for noteExpressWeb_save_articles.",
        type: ["object", "array"],
      },
    },
    ["data"],
  ),
  tool(
    "ne_mcp_call_tool",
    "Call a raw NE or Qingti MCP tool by name.",
    {
      server: serverProperty(),
      name: stringProperty("Raw MCP tool name returned by ne_mcp_list_tools."),
      arguments: {
        additionalProperties: true,
        description: "Raw MCP tool arguments.",
        type: "object",
      },
    },
    ["name"],
  ),
]);

/**
 * Execute an NE MCP proxy tool and return a standard MCP CallToolResult.
 */
export async function callNeMcpProxyTool(params, clientInfo) {
  const name = requireString(params?.name, "tools/call requires a tool name.");
  const args = objectOrEmpty(params?.arguments);
  const resultText = await executeProxyTool(name, args, clientInfo);
  return { content: [{ type: "text", text: resultText }], isError: false };
}

async function executeProxyTool(name, args, clientInfo) {
  switch (name) {
    case "ne_mcp_list_tools":
      return formatToolList(await remoteListTools(args.server, clientInfo));
    case "ne_mcp_search_articles":
      return formatMcpResult(await remoteCallTool(args.server, RAW_TOOL_NAMES.search, searchArgs(args), clientInfo));
    case "ne_mcp_search_folder":
      return formatMcpResult(await remoteCallTool(args.server, RAW_TOOL_NAMES.folder, folderArgs(args), clientInfo));
    case "ne_mcp_get_article_pdf":
      return formatMcpResult(await remoteCallTool(args.server, RAW_TOOL_NAMES.pdf, pdfArgs(args), clientInfo));
    case "ne_mcp_count_articles":
      return formatMcpResult(await remoteCallTool(args.server, RAW_TOOL_NAMES.search, countArgs(args), clientInfo));
    case "ne_mcp_save_articles":
      return formatMcpResult(await remoteCallTool(args.server, RAW_TOOL_NAMES.save, saveArgs(args), clientInfo));
    case "ne_mcp_call_tool":
      return formatMcpResult(await remoteCallTool(args.server, requireString(args.name, "name is required."), objectOrEmpty(args.arguments), clientInfo));
    default:
      throw new Error(`Unknown NE MCP proxy tool: ${name}`);
  }
}

function searchArgs(args) {
  return {
    query: requireString(args.query, "query is required."),
    page: positiveInteger(args.page, DEFAULT_PAGE),
    pageSize: positiveInteger(args.pageSize, DEFAULT_PAGE_SIZE),
  };
}

function folderArgs(args) {
  return { folder: requireString(args.folder, "folder is required.") };
}

function pdfArgs(args) {
  return { article_id: requireString(args.articleId, "articleId is required.") };
}

function countArgs(args) {
  return {
    query: optionalString(args.query) ?? "",
    page: DEFAULT_PAGE,
    pageSize: 1,
  };
}

function saveArgs(args) {
  return { data: requirePayload(args.data) };
}

async function remoteListTools(serverName, clientInfo) {
  return withRemoteMcp(serverName, clientInfo, (client) => client.request("tools/list", {}));
}

async function remoteCallTool(serverName, name, args, clientInfo) {
  return withRemoteMcp(serverName, clientInfo, (client) =>
    client.request("tools/call", { name, arguments: args }),
  );
}

async function withRemoteMcp(serverName, clientInfo, action) {
  const client = createRemoteClient(resolveServerConfig(serverName), clientInfo);
  try {
    await client.initialize();
    return await action(client);
  } finally {
    client.close();
  }
}

function resolveServerConfig(serverName) {
  const servers = getDefaultNeMcpServers();
  const resolved = resolveNeMcpServerName(serverName);
  const server = servers[resolved];
  if (!server) {
    throw new Error(`MCP server is not configured: ${resolved}`);
  }
  return server;
}

function formatToolList(result) {
  const tools = Array.isArray(result?.tools) ? result.tools : [];
  if (tools.length === 0) {
    return "No MCP tools returned.";
  }
  return tools.map(formatToolInfo).join("\n\n");
}

function formatToolInfo(toolInfo) {
  const title = typeof toolInfo.title === "string" ? ` (${toolInfo.title})` : "";
  const description = typeof toolInfo.description === "string" ? `: ${toolInfo.description}` : "";
  const lines = [`- ${toolInfo.name}${title}${description}`];
  appendJsonLine(lines, "inputSchema", toolInfo.inputSchema);
  appendJsonLine(lines, "outputSchema", toolInfo.outputSchema);
  appendJsonLine(lines, "annotations", toolInfo.annotations);
  return lines.join("\n");
}

function formatMcpResult(result) {
  const content = Array.isArray(result?.content) ? result.content : [];
  const text = content.map(formatContentItem).filter(Boolean).join("\n");
  if (text) {
    return text;
  }
  return JSON.stringify(result ?? {}, null, 2);
}

function formatContentItem(item) {
  if (item?.type === "text" && typeof item.text === "string") {
    return item.text;
  }
  return JSON.stringify(item, null, 2);
}

function appendJsonLine(lines, label, value) {
  if (value && typeof value === "object") {
    lines.push(`  ${label}: ${JSON.stringify(value)}`);
  }
}

function tool(name, description, properties, required = []) {
  return {
    name,
    description,
    inputSchema: {
      additionalProperties: false,
      properties,
      required,
      type: "object",
    },
    annotations: { readOnlyHint: name !== "ne_mcp_save_articles" },
  };
}

function serverProperty() {
  return {
    description: "MCP server alias: qingti/qt/qingtibase or ne/noteexpress. Default: qingti.",
    type: "string",
  };
}

function stringProperty(description) {
  return { description, type: "string" };
}

function numberProperty(description) {
  return { description, minimum: 1, type: "number" };
}

function objectOrEmpty(value) {
  if (value === undefined || value === null) {
    return RAW_ARGUMENTS;
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  throw new Error("MCP tool arguments must be an object.");
}

function optionalString(value) {
  return typeof value === "string" ? value : undefined;
}

function requireString(value, message) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  throw new Error(message);
}

function requirePayload(value) {
  if (value !== undefined && value !== null) {
    return value;
  }
  throw new Error("data is required.");
}

function positiveInteger(value, defaultValue) {
  if (value === undefined) {
    return defaultValue;
  }
  if (Number.isInteger(value) && value > 0) {
    return value;
  }
  throw new Error("Pagination values must be positive integers.");
}
