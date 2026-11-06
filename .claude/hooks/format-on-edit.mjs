/**
 * PostToolUse hook: applies ESLint fixes and Prettier to the file just written.
 *
 * It never blocks. Exit 2 only shows the remaining lint errors to Claude, and
 * tools that are not installed yet are skipped silently. Binaries are launched
 * through node directly because .cmd shims cannot be spawned on Windows
 * without a shell.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_DIR =
  process.env.CLAUDE_PROJECT_DIR ??
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const ESLINT_BIN = path.join(PROJECT_DIR, "node_modules", "eslint", "bin", "eslint.js");
const PRETTIER_BIN = path.join(PROJECT_DIR, "node_modules", "prettier", "bin", "prettier.cjs");

const LINTED_EXTENSIONS = new Set([".js", ".mjs", ".cjs"]);
const FORMATTED_EXTENSIONS = new Set([
  ...LINTED_EXTENSIONS,
  ".json",
  ".md",
  ".css",
  ".html",
  ".yml",
  ".yaml",
]);

const MAX_REPORT_LENGTH = 4000;

function runNode(binPath, args) {
  return spawnSync(process.execPath, [binPath, ...args], {
    cwd: PROJECT_DIR,
    encoding: "utf8",
  });
}

async function readStdin() {
  let text = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    text += chunk;
  }
  return text;
}

function lint(filePath) {
  if (!LINTED_EXTENSIONS.has(path.extname(filePath)) || !existsSync(ESLINT_BIN)) {
    return "";
  }
  const result = runNode(ESLINT_BIN, ["--fix", "--no-warn-ignored", filePath]);
  return result.status === 0 ? "" : `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
}

function format(filePath) {
  if (!FORMATTED_EXTENSIONS.has(path.extname(filePath)) || !existsSync(PRETTIER_BIN)) {
    return;
  }
  runNode(PRETTIER_BIN, ["--write", "--ignore-unknown", "--log-level=silent", filePath]);
}

const input = JSON.parse(await readStdin());
const rawPath = input.tool_input?.file_path;

if (typeof rawPath === "string" && rawPath !== "") {
  const filePath = path.resolve(input.cwd ?? PROJECT_DIR, rawPath);
  const lintReport = lint(filePath);
  format(filePath);

  if (lintReport !== "") {
    process.stderr.write(`ESLint reported problems:\n${lintReport.slice(0, MAX_REPORT_LENGTH)}\n`);
    process.exit(2);
  }
}
