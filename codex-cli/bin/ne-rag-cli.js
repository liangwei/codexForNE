import { importRagPath } from "./ne-rag-indexer.js";

/**
 * Run NE local RAG utility commands handled by the JS wrapper.
 */
export async function runNeRagCommand(args, env = process.env) {
  const [command, ...rest] = args;
  if (command !== "rag-import") {
    return null;
  }
  return runRagImportCommand(rest, env);
}

async function runRagImportCommand(args, env) {
  const inputPath = args.join(" ").trim();
  if (!inputPath) {
    console.error("Usage: necli rag-import <file-or-directory>");
    return 1;
  }
  try {
    const result = await importRagPath(inputPath, { env });
    console.log(formatImportResult(result));
    return 0;
  } catch (error) {
    console.error(`RAG import failed: ${formatError(error)}`);
    return 1;
  }
}

function formatImportResult(result) {
  return [
    "Local NE RAG import completed.",
    `Files indexed: ${result.files}`,
    `Chunks indexed: ${result.chunks}`,
    `Index: ${result.indexPath}`,
  ].join("\n");
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}
