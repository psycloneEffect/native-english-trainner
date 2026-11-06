import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
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
    ["implementer", "worker/a/b.js", true],
    ["implementer", "public/app.js", true],
    ["implementer", "public/shared/schema.js", true],
    ["implementer", "tests/a.test.mjs", false],
    ["implementer", "worker/a.test.mjs", false],
    ["implementer", "public/__tests__/b.js", false],
    ["implementer", "package.json", false],
    ["implementer", "wrangler.jsonc", false],
    ["implementer", "README.md", false],
    ["implementer", ".github/workflows/ci.yml", false],
    ["implementer", ".claude/agent-policy.json", false],
    ["implementer", "worker/../tests/a.test.mjs", false],
    ["implementer", "/etc/passwd", false],
    ["implementer", "worker/.env", false],
    ["implementer", ".dev.vars", false],
    ["implementer", "worker/.dev.vars.local", false],
    ["test-author", "tests/a.test.mjs", true],
    ["test-author", "tests/e2e/a.spec.mjs", true],
    ["test-author", "e2e/a.spec.mjs", false],
    ["test-author", "worker/a.test.mjs", false],
    ["test-author", "tests/.dev.vars", false],
    ["test-author", "worker/a.js", false],
    ["test-runner", "worker/a.js", false],
    ["debugger", "worker/a.js", false],
    ["ui-verifier", "tests/e2e/a.spec.mjs", false],
    ["reviewer", ".claude/agent-memory/reviewer/MEMORY.md", true],
    ["reviewer", ".claude/agent-memory/implementer/MEMORY.md", false],
    ["reviewer", "worker/a.js", false],
    ["librarian", "docs/research/kv.md", true],
    ["librarian", "docs/guide.md", false],
    ["documenter", "docs/guide.md", true],
    ["documenter", "README.md", true],
    ["documenter", "CHANGELOG.md", true],
    ["documenter", "docs/research/kv.md", false],
    ["documenter", "docs/specs/feature.md", false],
    ["documenter", "worker/a.js", false],
    ["general-purpose", "worker/a.js", false],
    ["Explore", "worker/a.js", false],
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
    assert.equal(decide(write("test-author", "worker/a.js", "Edit")).allow, false);
    assert.equal(
      decide({
        agent_type: "test-author",
        tool_name: "NotebookEdit",
        cwd: projectDir,
        tool_input: { notebook_path: "worker/a.ipynb" },
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
    const input = { agent_type: "reviewer", tool_name: "Read", tool_input: { file_path: "worker/a.js" } };
    assert.equal(decide(input).allow, true);
  });
});

describe("Windows paths", () => {
  const windows = { projectDir: "C:\\repo", cwd: "C:\\repo", pathApi: path.win32 };

  it("normalizes backslashes", () => {
    assert.equal(toProjectRelative("C:\\repo\\worker\\a.js", windows), "worker/a.js");
  });

  it("detects a different drive as outside the project", () => {
    assert.equal(toProjectRelative("D:\\repo\\worker\\a.js", windows), null);
  });

  it("applies globs without regard to case", () => {
    const input = {
      agent_type: "implementer",
      tool_name: "Edit",
      cwd: "C:\\repo",
      tool_input: { file_path: "C:\\REPO\\WORKER\\a.js" },
    };
    assert.equal(evaluate(input, policy, windows).allow, true);
  });

  it("blocks an out-of-role Windows path", () => {
    const input = {
      agent_type: "implementer",
      tool_name: "Edit",
      cwd: "C:\\repo",
      tool_input: { file_path: "C:\\repo\\tests\\a.test.mjs" },
    };
    assert.equal(evaluate(input, policy, windows).allow, false);
  });
});

describe("shell permissions", () => {
  const cases = [
    ["test-runner", "node --test", true],
    ["test-runner", 'node --test "tests/**/*.test.mjs"', true],
    ["test-runner", 'node --test ".claude/hooks/*.test.mjs" "tests/**/*.test.mjs" 2>&1 | tail -20', true],
    ["test-runner", "node --check worker/index.js", true],
    ["test-runner", "node --check worker/index.js; node --check public/app.js", true],
    ["test-runner", "cd worker && node --check index.js", true],
    ["test-runner", 'node --test 2>&1; echo "EXIT=$?"', true],
    ["debugger", "echo x > worker/a.js", false],
    ["test-runner", 'grep -rn "a|b;c" worker', true],
    ["test-runner", "grep -rn -e foo worker", true],
    ["reviewer", "git diff HEAD", true],
    ["librarian", "node --test", false],
    ["ui-verifier", "npm run test:e2e -- tests/e2e/a.spec.mjs", true],
    ["ui-verifier", "node --test", false],
    ["test-runner", 'for f in worker/*.js; do node --check "$f"; done', false],
    ["implementer", "npm install left-pad", false],
    ["implementer", "npm run test", false],
    ["implementer", "npx wrangler@4 deploy", false],
    ["implementer", "npx wrangler@4 deploy --dry-run", false],
    ["implementer", "git commit -m x", false],
    ["implementer", "git push", false],
    ["debugger", "rm -rf worker", false],
    ["debugger", "sed -i s/a/b/ worker/a.js", false],
    ["debugger", "node -e 'x'", false],
    ["debugger", "node worker/a.js", false],
    ["debugger", "node --testevil", false],
    ["debugger", "node --test --import data:text/javascript,x", false],
    ["debugger", "node --test --import=./x.mjs", false],
    ["debugger", "node --test --require ./x.cjs", false],
    ["debugger", "node --test -r ./x.cjs", false],
    ["debugger", "node --test --env-file=.dev.vars", false],
    ["debugger", "node --test --test-reporter-destination=x.txt", false],
    ["debugger", "node --test --test-reporter=./x.mjs", false],
    ["debugger", "node --test --watch", false],
    ["debugger", "node --test && rm -rf worker", false],
    ["debugger", "node --test; rm -rf worker", false],
    ["debugger", "node --test | tee out.txt", false],
    ["debugger", "cat worker/a.js > tests/a.test.mjs", false],
    ["debugger", "cat worker/a.js >> tests/a.test.mjs", false],
    ["debugger", "echo $(rm -rf worker)", false],
    ["debugger", "cat `rm -rf worker`", false],
    ["debugger", 'cat "$(rm -rf worker)"', false],
    ["debugger", "git diff --output=x", false],
    ["debugger", "find . -delete", false],
    ["debugger", "find . -exec rm {} ;", false],
    ["debugger", "cat .env", false],
    ["debugger", "cat worker/.env.local", false],
    ["debugger", "cat .dev.vars", false],
    ["debugger", "cat worker/.dev.vars.local", false],
    ["Explore", "git log -5", true],
    ["Explore", "node --test", false],
    ["general-purpose", "rm -rf worker", false],
  ];

  for (const [agent, command, allowed] of cases) {
    it(`${agent} ${allowed ? "may" : "may not"} run: ${command}`, () => {
      assert.equal(decide(shell(agent, command)).allow, allowed);
    });
  }

  it("checks the PowerShell tool too", () => {
    assert.equal(decide(shell("debugger", "Remove-Item worker", "PowerShell")).allow, false);
  });

  it("keeps quoted operators inside one segment", () => {
    assert.deepEqual(splitShellCommand("grep 'a&&b' worker && git status"), [
      "grep 'a&&b' worker",
      "git status",
    ]);
  });

  it("rejects an unterminated quote", () => {
    assert.equal(splitShellCommand("grep 'abc"), null);
  });
});

describe("commands documented in skills", () => {
  const cases = [
    ["debugger", 'node --test --test-name-pattern="handles empty input" tests/a.test.mjs'],
    ["debugger", 'node --test ".claude/hooks/*.test.mjs" "tests/**/*.test.mjs"'],
    ["debugger", "node --check worker/index.js"],
    ["debugger", "git log --oneline -15"],
    ["debugger", 'git log -S "normalize" --oneline'],
    ["debugger", "git blame worker/a.js"],
    ["test-runner", "ls worker"],
    ["test-runner", 'node --test --test-name-pattern="handles empty input" tests/a.test.mjs'],
    ["implementer", "node --check public/shared/schema.js"],
    ["test-author", "node --test tests/worker/quota.test.mjs"],
    ["reviewer", "node --check public/app.js"],
    ["documenter", "git diff HEAD"],
    ["ui-verifier", 'npm run test:e2e -- --grep "search"'],
    ["ui-verifier", "npm run test:e2e -- --last-failed"],
    ["ui-verifier", "npm run test:e2e -- tests/e2e/a.spec.mjs --repeat-each=5 --retries=0"],
  ];

  for (const [agent, command] of cases) {
    it(`${agent} may run: ${command}`, () => {
      assert.equal(decide(shell(agent, command)).allow, true);
    });
  }
});

describe("agent definitions", () => {
  const agentsDir = path.join(HOOK_DIR, "..", "agents");
  const skillsDir = path.join(HOOK_DIR, "..", "skills");
  const agentFiles = readdirSync(agentsDir).filter((file) => file.endsWith(".md"));

  const frontmatter = (filePath) => {
    const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(filePath, "utf8"));
    assert.ok(match, `${filePath} has no frontmatter`);
    return match[1];
  };

  for (const file of agentFiles) {
    it(`${file} preloads skills that exist`, () => {
      const names = [...frontmatter(path.join(agentsDir, file)).matchAll(/^ {2}- (\S+)$/gm)].map(
        (match) => match[1],
      );
      assert.ok(names.length > 0, "no skills listed");
      for (const name of names) {
        const skillPath = path.join(skillsDir, name, "SKILL.md");
        assert.ok(existsSync(skillPath), `missing ${skillPath}`);
        assert.match(frontmatter(skillPath), new RegExp(`^name: ${name}$`, "m"));
      }
    });

    it(`${file} has a policy entry`, () => {
      assert.ok(file.replace(/\.md$/, "") in policy.agents);
    });
  }

  it("no preloaded skill disables model invocation", () => {
    for (const name of readdirSync(skillsDir)) {
      const content = frontmatter(path.join(skillsDir, name, "SKILL.md"));
      assert.doesNotMatch(content, /^disable-model-invocation: true$/m);
    }
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
    const input = write("implementer", path.join(scratch, "worker", "a.js"));
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
    mkdirSync(path.join(scratch, "worker"), { recursive: true });
    mkdirSync(path.join(scratch, "tests"), { recursive: true });
    try {
      symlinkSync(path.join(scratch, "tests"), path.join(scratch, "worker", "link"), "dir");
    } catch {
      context.skip("This environment cannot create symlinks.");
      return;
    }
    const input = write("implementer", path.join(scratch, "worker", "link", "a.js"));
    assert.equal(run(JSON.stringify(input)).status, 2);
  });
});
