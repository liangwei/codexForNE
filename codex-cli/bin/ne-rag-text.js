import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  NE_RAG_CHUNK_OVERLAP,
  NE_RAG_CHUNK_SIZE,
} from "./ne-rag-config.js";

const SUPPORTED_TEXT_EXTENSIONS = new Set([".md", ".txt"]);
const PDF_EXTENSION = ".pdf";

/**
 * Resolve a user-provided RAG path against the current working directory.
 */
export function resolveRagInputPath(inputPath, cwd = process.cwd()) {
  const cleaned = stripWrappingQuotes(requirePath(inputPath));
  return path.resolve(cwd, cleaned);
}

/**
 * Recursively scan a file or directory for importable local RAG files.
 */
export async function scanRagFiles(inputPath) {
  const inputStat = await stat(inputPath);
  if (inputStat.isFile()) {
    assertImportableFile(inputPath);
    return [inputPath];
  }
  if (!inputStat.isDirectory()) {
    throw new Error(`RAG path is neither a file nor a directory: ${inputPath}`);
  }
  return scanDirectory(inputPath);
}

/**
 * Extract plain text from an importable local RAG file.
 */
export async function extractRagText(filePath) {
  assertImportableFile(filePath);
  return readFile(filePath, "utf8");
}

/**
 * Split text into overlapping chunks for embedding.
 */
export function chunkRagText(text) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return [];
  }
  const chunks = [];
  for (let start = 0; start < cleaned.length; start = nextStart(start)) {
    const end = Math.min(start + NE_RAG_CHUNK_SIZE, cleaned.length);
    chunks.push(cleaned.slice(start, end));
    if (end === cleaned.length) {
      break;
    }
  }
  return chunks;
}

async function scanDirectory(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await scanDirectory(fullPath)));
    } else if (entry.isFile() && isImportableFile(fullPath)) {
      files.push(fullPath);
    } else if (entry.isFile() && path.extname(fullPath).toLowerCase() === PDF_EXTENSION) {
      throw pdfUnsupportedError(fullPath);
    }
  }
  return files;
}

function assertImportableFile(filePath) {
  if (isImportableFile(filePath)) {
    return;
  }
  if (path.extname(filePath).toLowerCase() === PDF_EXTENSION) {
    throw pdfUnsupportedError(filePath);
  }
  throw new Error(`Unsupported RAG file type: ${path.extname(filePath) || "(none)"}`);
}

function isImportableFile(filePath) {
  return SUPPORTED_TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function nextStart(start) {
  return Math.max(start + NE_RAG_CHUNK_SIZE - NE_RAG_CHUNK_OVERLAP, start + 1);
}

function pdfUnsupportedError(filePath) {
  return new Error(
    `PDF import is not bundled in this NE-CLI build yet: ${filePath}. Import .md or .txt files.`,
  );
}

function requirePath(inputPath) {
  if (typeof inputPath === "string" && inputPath.trim()) {
    return inputPath.trim();
  }
  throw new Error("A file or directory path is required.");
}

function stripWrappingQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
