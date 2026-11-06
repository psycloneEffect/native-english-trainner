/**
 * Pure decision logic for the agent policy hook. It performs no I/O so that
 * every rule can be unit-tested, including Windows paths on a Linux runner.
 */

import path from "node:path";

const WRITE_TOOL_PATH_FIELDS = {
  Write: "file_path",
  Edit: "file_path",
  MultiEdit: "file_path",
  NotebookEdit: "notebook_path",
};

const SHELL_TOOLS = new Set(["Bash", "PowerShell"]);

const HARMLESS_REDIRECTIONS = /(?:\b[12])?>>?\s*\/dev\/null|\b2>&1\b/g;

const FORBIDDEN_ARGUMENTS =
  /(?:^|\s)(?:--output\S*|-(?:delete|exec|execdir|ok|okdir|fls|fprint\S*)(?:\s|$))|(?:^|[\s/"'])\.(?:env|dev\.vars)(?:\.\S*)?(?:[\s"']|$)/;

// A shell profile allows "node --test", which must not become a way to run inline
// code, load a secrets file, or write a report outside the write policy.
const FORBIDDEN_NODE_ARGUMENTS =
  /(?:^|\s)(?:--import|--require|-r|--eval|-e|--print|-p|--loader|--experimental-loader|--env-file\S*|--test-reporter\S*|--watch\S*)(?:[=\s]|$)/;

const ALLOW = Object.freeze({ allow: true, reason: "" });

const deny = (reason) => ({ allow: false, reason });

/** Converts a project-relative glob into a regular expression. */
export function globToRegExp(glob, { ignoreCase = false } = {}) {
  let source = "";
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index];
    if (character !== "*") {
      source += character.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
      continue;
    }
    if (glob[index + 1] !== "*") {
      source += "[^/]*";
      continue;
    }
    index += 1;
    if (glob[index + 1] === "/") {
      index += 1;
      source += "(?:.*/)?";
    } else {
      source += ".*";
    }
  }
  return new RegExp(`^${source}$`, ignoreCase ? "i" : "");
}

function matchesAny(relativePath, globs = [], options = {}) {
  return globs.some((glob) => globToRegExp(glob, options).test(relativePath));
}

/** Returns the POSIX-style project-relative path, or null when outside the project. */
export function toProjectRelative(filePath, { projectDir, cwd, pathApi = path }) {
  const absolutePath = pathApi.resolve(cwd ?? projectDir, filePath);
  const relativePath = pathApi.relative(projectDir, absolutePath);
  const escapesProject =
    relativePath === ".." ||
    relativePath.startsWith(`..${pathApi.sep}`) ||
    pathApi.isAbsolute(relativePath);
  if (relativePath === "" || escapesProject) {
    return null;
  }
  return relativePath.split(pathApi.sep).join("/");
}

function evaluateWrite(toolName, toolInput, agentName, rules, policy, context) {
  const filePath = toolInput?.[WRITE_TOOL_PATH_FIELDS[toolName]];
  if (typeof filePath !== "string" || filePath === "") {
    return deny(`${toolName} did not provide a file path.`);
  }

  const relativePath = toProjectRelative(filePath, context);
  if (relativePath === null) {
    return deny(`"${agentName}" may not write outside the project: ${filePath}`);
  }

  const globOptions = { ignoreCase: context.pathApi === path.win32 };
  if (matchesAny(relativePath, policy.neverWrite, globOptions)) {
    return deny(`"${relativePath}" is protected for every subagent.`);
  }
  if (matchesAny(relativePath, rules.denyWrite, globOptions)) {
    return deny(`"${agentName}" may not write "${relativePath}" (out of role).`);
  }
  if (matchesAny(relativePath, rules.write, globOptions)) {
    return ALLOW;
  }

  const allowed = rules.write?.length ? rules.write.join(", ") : "nothing";
  return deny(
    `"${agentName}" may not write "${relativePath}". Allowed: ${allowed}. ` +
      "Report the needed change to the Orchestrator instead.",
  );
}

/**
 * Splits a command line on unquoted control operators. Returns null when it
 * contains a construct that cannot be vetted: redirection, command
 * substitution, or an unterminated quote.
 */
export function splitShellCommand(command) {
  const cleaned = command.replace(HARMLESS_REDIRECTIONS, " ");
  const segments = [];
  let current = "";
  let quote = null;

  for (let index = 0; index < cleaned.length; index += 1) {
    const character = cleaned[index];

    if (quote === "'") {
      if (character === "'") quote = null;
      current += character;
      continue;
    }
    if (character === "`" || (character === "$" && cleaned[index + 1] === "(")) {
      return null;
    }
    if (character === "\\" && index + 1 < cleaned.length) {
      current += character + cleaned[index + 1];
      index += 1;
      continue;
    }
    if (quote === '"') {
      if (character === '"') quote = null;
      current += character;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      current += character;
      continue;
    }
    if (character === ">" || character === "<") {
      return null;
    }
    if (character === ";" || character === "\n" || character === "&" || character === "|") {
      if (cleaned[index + 1] === character) index += 1;
      segments.push(current);
      current = "";
      continue;
    }
    current += character;
  }

  if (quote !== null) return null;
  segments.push(current);
  return segments.map((segment) => segment.trim()).filter(Boolean);
}

function isCommandAllowed(segment, allowedPrefixes) {
  if (FORBIDDEN_ARGUMENTS.test(segment)) return false;
  if (/^node\s/.test(segment) && FORBIDDEN_NODE_ARGUMENTS.test(segment)) return false;
  return allowedPrefixes.some((prefix) => segment === prefix || segment.startsWith(`${prefix} `));
}

function evaluateShell(toolInput, agentName, rules, policy) {
  const command = toolInput?.command;
  if (typeof command !== "string" || command.trim() === "") {
    return deny("The shell tool did not provide a command.");
  }

  const profile = policy.shellProfiles[rules.shell];
  if (!profile) {
    return deny(`"${agentName}" has no shell access.`);
  }

  const segments = splitShellCommand(command);
  if (segments === null) {
    return deny(
      "Redirection and command substitution are not allowed for subagents. " +
        `Rejected: ${command}`,
    );
  }

  const rejected = segments.find((segment) => !isCommandAllowed(segment, profile));
  if (rejected !== undefined) {
    return deny(
      `"${agentName}" may not run "${rejected}" (profile "${rules.shell}"). ` +
        `Allowed prefixes: ${profile.join(", ")}.`,
    );
  }
  return ALLOW;
}

/**
 * Decides whether a tool call may proceed.
 *
 * The main session (the human Orchestrator) carries no agent_type and is not
 * restricted. Agents missing from the policy, including built-ins such as
 * general-purpose, fall back to the read-only default rules.
 */
export function evaluate(input, policy, { projectDir, pathApi = path }) {
  const agentName = input.agent_type;
  if (!agentName) return ALLOW;

  const rules = policy.agents[agentName] ?? policy.defaultAgent;
  const context = { projectDir, cwd: input.cwd, pathApi };

  if (input.tool_name in WRITE_TOOL_PATH_FIELDS) {
    return evaluateWrite(input.tool_name, input.tool_input, agentName, rules, policy, context);
  }
  if (SHELL_TOOLS.has(input.tool_name)) {
    return evaluateShell(input.tool_input, agentName, rules, policy);
  }
  return ALLOW;
}
