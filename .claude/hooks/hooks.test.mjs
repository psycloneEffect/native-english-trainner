import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { evaluate, globToRegExp, splitShellCommand, toProjectRelative } from "./policy-core.mjs";

const HOOK_DIR = path.dirname(fileURLToPath(import.meta.url));
const policy = JSON.parse(readFileSync(path.join(HOOK_DIR, "..", "agent-policy.json"), "utf8"));
const projectDir = path.resolve("/repo");

const write = (agent, filePath, tool = "Write") => ({
  agent_type: agent,
  tool_name: tool,
  cwd: projectDir,
  tool_input: { file_path: filePath },
});
const shell = (agent, command, tool = "Bash") => ({
  agent_type: agent,
  tool_name: tool,
  cwd: projectDir,
  tool_input: { command },
});
const decide = (input) => evaluate(input, policy, { projectDir });

describe("write permissions", () => {
  const cases = [
    ["implementer", "src/a/b.ts", true],
    ["implementer", "tests/a.test.ts", false],
    ["implementer", "src/a/b.test.ts", false],
    ["implementer", "src/__tests__/b.ts", false],
    ["implementer", "package.json", false],
    ["implementer", ".claude/agent-policy.json", false],
    ["implementer", "src/../tests/a.test.ts", false],
    ["implementer", "/etc/passwd", false],
    ["implementer", "src/.env", false],
    ["test-author", "tests/a.test.ts", true],
    ["test-author", "e2e/a.spec.ts", true],
    ["test-author", "src/a.ts", false],
    ["test-runner", "src/a.ts", false],
    ["debugger", "src/a.ts", false],
    ["ui-verifier", "e2e/a.spec.ts", false],
    ["reviewer", ".claude/agent-memory/reviewer/MEMORY.md", true],
    ["reviewer", ".claude/agent-memory/implementer/MEMORY.md", false],
    ["reviewer", "src/a.ts", false],
    ["librarian", "docs/research/zod.md", true],
    ["librarian", "docs/guide.md", false],
    ["documenter", "docs/guide.md", true],
    ["documenter", "README.md", true],
    ["documenter", "CHANGELOG.md", true],
    ["documenter", "docs/research/zod.md", false],
    ["documenter", "docs/specs/feature.md", false],
    ["documenter", "src/a.ts", false],
    ["general-purpose", "src/a.ts", false],
    ["Explore", "src/a.ts", false],
  ];

  for (const [agent, filePath, allowed] of cases) {
    it(`${agent} ${allowed ? "may" : "may not"} write ${filePath}`, () => {
      assert.equal(decide(write(agent, filePath)).allow, allowed);
    });
  }

  it("does not restrict the main session", () => {
    const { agent_type: _omitted, ...input } = write("implementer", "package.json");
    assert.equal(decide(input).allow, true);
  });

  it("checks Edit and NotebookEdit too", () => {
    assert.equal(decide(write("test-author", "src/a.ts", "Edit")).allow, false);
    assert.equal(
      decide({
        agent_type: "test-author",
        tool_name: "NotebookEdit",
        cwd: projectDir,
        tool_input: { notebook_path: "src/a.ipynb" },
      }).allow,
      false,
    );
  });

  it("fails closed when the path is missing", () => {
    assert.equal(
      decide({ agent_type: "implementer", tool_name: "Write", tool_input: {} }).allow,
      false,
    );
  });

  it("leaves read-only tools alone", () => {
    const input = { agent_type: "reviewer", tool_name: "Read", tool_input: { file_path: "src/a" } };
    assert.equal(decide(input).allow, true);
  });
});

describe("Windows paths", () => {
  const windows = { projectDir: "C:\\repo", cwd: "C:\\repo", pathApi: path.win32 };

  it("normalizes backslashes", () => {
    assert.equal(toProjectRelative("C:\\repo\\src\\a.ts", windows), "src/a.ts");
  });

  it("detects a different drive as outside the project", () => {
    assert.equal(toProjectRelative("D:\\repo\\src\\a.ts", windows), null);
  });

  it("applies globs without regard to case", () => {
    const input = {
      agent_type: "implementer",
      tool_name: "Edit",
      cwd: "C:\\repo",
      tool_input: { file_path: "C:\\REPO\\SRC\\a.ts" },
    };
    assert.equal(evaluate(input, policy, windows).allow, true);
  });

  it("blocks an out-of-role Windows path", () => {
    const input = {
      agent_type: "implementer",
      tool_name: "Edit",
      cwd: "C:\\repo",
      tool_input: { file_path: "C:\\repo\\tests\\a.test.ts" },
    };
    assert.equal(evaluate(input, policy, windows).allow, false);
  });
});

describe("shell permissions", () => {
  const cases = [
    ["test-runner", "npm run test", true],
    ["test-runner", "npm run test -- tests/a.test.ts", true],
    ["test-runner", "npm run typecheck 2>&1 | tail -20", true],
    ["test-runner", "cd sub && npm run lint", true],
    ["test-runner", 'grep -rn "a|b;c" src', true],
    ["reviewer", "git diff HEAD", true],
    ["librarian", "npm run test", false],
    ["ui-verifier", "npm run test:e2e -- e2e/a.spec.ts", true],
    ["ui-verifier", "npm run test", false],
    ["implementer", "npm install left-pad", false],
    ["implementer", "npx tsc", false],
    ["implementer", "git commit -m x", false],
    ["implementer", "git push", false],
    ["debugger", "rm -rf src", false],
    ["debugger", "sed -i s/a/b/ src/a.ts", false],
    ["debugger", "node -e 'x'", false],
    ["debugger", "npm run test && rm -rf src", false],
    ["debugger", "npm run test; rm -rf src", false],
    ["debugger", "npm run test | tee out.txt", false],
    ["debugger", "cat src/a.ts > tests/a.test.ts", false],
    ["debugger", "cat src/a.ts >> tests/a.test.ts", false],
    ["debugger", "echo $(rm -rf src)", false],
    ["debugger", "cat `rm -rf src`", false],
    ["debugger", 'cat "$(rm -rf src)"', false],
    ["debugger", "git diff --output=x", false],
    ["debugger", "find . -delete", false],
    ["debugger", "find . -exec rm {} ;", false],
    ["debugger", "npm run test -- --outputFile=x.json", false],
    ["debugger", "cat .env", false],
    ["debugger", "cat src/.env.local", false],
    ["debugger", "npm run testevil", false],
    ["Explore", "git log -5", true],
    ["Explore", "npm run test", false],
    ["general-purpose", "rm -rf src", false],
  ];

  for (const [agent, command, allowed] of cases) {
    it(`${agent} ${allowed ? "may" : "may not"} run: ${command}`, () => {
      assert.equal(decide(shell(agent, command)).allow, allowed);
    });
  }

  it("checks the PowerShell tool too", () => {
    assert.equal(decide(shell("debugger", "Remove-Item src", "PowerShell")).allow, false);
  });

  it("keeps quoted operators inside one segment", () => {
    assert.deepEqual(splitShellCommand("grep 'a&&b' src && git status"), [
      "grep 'a&&b' src",
      "git status",
    ]);
  });

  it("rejects an unterminated quote", () => {
    assert.equal(splitShellCommand("grep 'abc"), null);
  });
});

describe("globToRegExp", () => {
  it("matches direct and nested children with **/", () => {
    const pattern = globToRegExp("src/**/*.test.*");
    assert.ok(pattern.test("src/a.test.ts"));
    assert.ok(pattern.test("src/x/y/a.test.ts"));
    assert.ok(!pattern.test("src/a.ts"));
  });

  it("does not let * cross a directory", () => {
    assert.ok(!globToRegExp("src/*.ts").test("src/x/a.ts"));
  });

  it("does not treat a sibling directory as a child", () => {
    assert.ok(!globToRegExp("src/**").test("src-evil/a.ts"));
  });
});

describe("hook process", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "agent-policy-"));
  after(() => rmSync(scratch, { recursive: true, force: true }));

  const run = (stdin, env = {}) =>
    spawnSync(process.execPath, [path.join(HOOK_DIR, "enforce-agent-policy.mjs")], {
      input: stdin,
      encoding: "utf8",
      env: { ...process.env, CLAUDE_PROJECT_DIR: scratch, ...env },
    });

  it("exits 0 for an allowed call", () => {
    const input = write("implementer", path.join(scratch, "src", "a.ts"));
    assert.equal(run(JSON.stringify(input)).status, 0);
  });

  it("exits 2 and explains a denied call", () => {
    const result = run(JSON.stringify(write("implementer", path.join(scratch, "package.json"))));
    assert.equal(result.status, 2);
    assert.match(result.stderr, /may not write "package\.json"/);
  });

  it("fails closed on malformed input", () => {
    assert.equal(run("not json").status, 2);
  });

  it("does not follow a symlink out of an allowed directory", (context) => {
    mkdirSync(path.join(scratch, "src"), { recursive: true });
    mkdirSync(path.join(scratch, "tests"), { recursive: true });
    try {
      symlinkSync(path.join(scratch, "tests"), path.join(scratch, "src", "link"), "dir");
    } catch {
      context.skip("This environment cannot create symlinks.");
      return;
    }
    const input = write("implementer", path.join(scratch, "src", "link", "a.test.ts"));
    assert.equal(run(JSON.stringify(input)).status, 2);
  });
});
