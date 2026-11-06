/**
 * PreToolUse hook: enforces .claude/agent-policy.json for subagents.
 *
 * Exit 0 allows the tool call. Exit 2 blocks it and shows stderr to Claude.
 * Any internal failure also exits 2, so that a broken hook fails closed.
 */

import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { evaluate } from "./policy-core.mjs";

const HOOK_DIR = path.dirname(fileURLToPath(import.meta.url));
const POLICY_PATH = path.resolve(HOOK_DIR, "..", "agent-policy.json");
const DEFAULT_PROJECT_DIR = path.resolve(HOOK_DIR, "..", "..");

function block(message) {
  process.stderr.write(`[agent-policy] ${message}\n`);
  process.exit(2);
}

async function readStdin() {
  let text = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    text += chunk;
  }
  return text;
}

/** Resolves symlinks in the deepest existing ancestor, so a link cannot escape a directory. */
function canonicalize(targetPath) {
  let existing = path.resolve(targetPath);
  const missingParts = [];
  while (!existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    missingParts.unshift(path.basename(existing));
    existing = parent;
  }
  return path.join(realpathSync(existing), ...missingParts);
}

function canonicalizeInput(input, projectDir) {
  const toolInput = { ...input.tool_input };
  for (const field of ["file_path", "notebook_path"]) {
    if (typeof toolInput[field] === "string" && toolInput[field] !== "") {
      toolInput[field] = canonicalize(path.resolve(input.cwd ?? projectDir, toolInput[field]));
    }
  }
  return { ...input, tool_input: toolInput };
}

try {
  const input = JSON.parse(await readStdin());
  const policy = JSON.parse(readFileSync(POLICY_PATH, "utf8"));
  const projectDir = canonicalize(process.env.CLAUDE_PROJECT_DIR ?? DEFAULT_PROJECT_DIR);

  const decision = evaluate(canonicalizeInput(input, projectDir), policy, { projectDir });
  if (!decision.allow) {
    block(decision.reason);
  }
} catch (error) {
  block(`Policy check failed, so the tool call was blocked: ${error.message}`);
}
