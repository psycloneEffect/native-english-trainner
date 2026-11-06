---
name: check-triage
description: Procedure for running syntax checks and node:test suites in this plain JavaScript repository, and reducing long output to a short triage. Preloaded by the test-runner subagent.
user-invocable: false
---

# Check triage

This repository has no `package.json`, type checker, or linter, so there are no `npm run` scripts.

## Procedure

1. Run `ls worker` to get the current list of Worker files.
2. Syntax-check each file with its own command. `node --check` takes one file, and the agent policy blocks shell loops. Separate the commands with `;` so that one failure does not hide the others:
   `node --check worker/index.js; node --check public/app.js; node --check public/shared/schema.js`
3. Run all tests: `node --test ".claude/hooks/*.test.mjs" "tests/**/*.test.mjs"`. Keep the quotes, because Node expands these patterns itself. For specific tests, use `node --test <path>` or `node --test --test-name-pattern="<name>" <path>`.
4. Run both steps even when the first fails, unless you were asked for only one.
5. Group the failures by cause, and read only the source lines needed to locate each cause.

Use only these commands. Do not retry a failing test to get a pass. If a test passes on a second run, report it as flaky.

`npx wrangler@4 deploy --dry-run` belongs to the main session, and the policy blocks it for you. Report it as "not run".

## Reading the results

- `node --check` finds syntax errors only. It does not find undefined names, wrong imports, or failures at runtime, so a pass proves little on its own.
- A pattern that matches nothing is not an error. `tests/` may not exist yet, and then only the hook tests run. Report the real test count, and never describe zero tests as coverage.
- One hook test that creates a symlink may be skipped on Windows. That skip is expected.

## Reading syntax errors

`node --check` prints the file and line, the source line with a caret, and then the error.

| Message                                    | Usual cause                                         |
| ------------------------------------------ | --------------------------------------------------- |
| `Unexpected token`                         | A missing bracket or comma, or JSX in a `.js` file  |
| `Unexpected end of input`                  | An unclosed block, or an unterminated template      |
| `Identifier 'x' has already been declared` | A duplicate `const` or `let`, or a duplicate import |
| `await is only valid in async functions`   | `await` in a function that is not `async`           |
| `Missing initializer in const declaration` | Type annotations or other TypeScript syntax         |

For any other message, quote it without guessing what it means.

## Classifying test failures

| What you see                                                  | Class      | Meaning                                             |
| ------------------------------------------------------------- | ---------- | --------------------------------------------------- |
| `AssertionError`, or `ERR_ASSERTION` with expected and actual | Assertion  | The behavior differs from the test                  |
| Another error thrown from `worker/` or `public/`              | Crash      | The code failed before it reached the assertion     |
| `test timed out`, or a promise still pending at exit          | Timeout    | A missing `await`, an unresolved promise, or timers |
| `ERR_MODULE_NOT_FOUND`, or a whole test file fails to load    | Collection | An import or setup error, which hides other tests   |
| Passes alone, fails in the full run                           | Order      | State shared between tests                          |

Fix nothing yourself. A collection error comes first in your report, because it hides other results.
