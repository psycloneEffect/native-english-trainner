---
name: js-implementation
description: Procedure for implementing an approved plain JavaScript change in this Cloudflare Worker and browser app, with no TypeScript, JSX, or build step. Preloaded by the implementer subagent.
user-invocable: false
---

# JavaScript implementation

Follow these steps in order.

1. **Read the source of truth.** Read the specification or plan you were given. If behavior is undefined, report the question instead of inventing an answer.
2. **Find the right file.** Use `Where changes go` in `CLAUDE.md`. Output fields belong in `SCHEMA` in `public/shared/schema.js`.
3. **Find the local pattern.** Use search to find how this codebase already solves a similar problem. Reuse its helpers, naming, and return shapes.
4. **Define the data shapes.** Decide the inputs, outputs, and failure results before any logic. No compiler checks them, so state any shape that is not obvious in a Japanese comment or JSDoc.
5. **Mark the boundaries.** List where data enters from outside the program. Validate it there, so that inner code receives trusted values.
6. **Implement the smallest change.** Write comments in Japanese, and explain why rather than what.
7. **Update the versions when needed.** A release-worthy change sets `WORKER_VERSION` and `APP_VERSION` to the same value. State the value in your report, so that `documenter` can update the docs.
8. **Verify.** Run `node --check <file>` on each changed `.js` file, then `node --test ".claude/hooks/*.test.mjs" "tests/**/*.test.mjs"`. Fix the causes. State that browser behavior and the Worker dry-run were not checked.

## Runtime limits

| Location                  | Rule                                                                                   |
| ------------------------- | -------------------------------------------------------------------------------------- |
| `public/shared/schema.js` | Runs in both the Worker and the browser, so use only APIs available in both            |
| `worker/`                 | Runs on Workers. Import shared code by relative path                                   |
| `public/app.js`           | Runs in the browser. React and `htm` are globals from CDNs. Import `/shared/schema.js` |
| Components                | Use `html` template literals, never JSX                                                |

## Choosing a technique

| Situation                                        | Use                                                      |
| ------------------------------------------------ | -------------------------------------------------------- |
| A value has several mutually exclusive states    | A `status` string, and a `switch` that throws by default |
| Data comes from a request, Claude, KV, or `vars` | A function that validates it and returns a known shape   |
| A caller is expected to recover from a failure   | `{ ok: false, code }`, as in `worker/quota.js`           |
| A failure must reach the client                  | `{ error: "snake_case_code" }`, plus a message in `ERR`  |
| A failure is a programmer mistake                | Throw and let it propagate                               |
| An array element may be missing                  | Check for `undefined` before use                         |
| Several independent promises                     | `Promise.all`                                            |

Code examples are in [references/patterns.md](references/patterns.md). Read that file when you apply one of these techniques.

## Stop and report instead of working around

- The change needs a dependency, `package.json`, a build step, or a change to `wrangler.jsonc`.
- The change touches anything under `Do not change without asking` in `CLAUDE.md`.
- `/api/generate` would need to accept anything beyond `situation`, `ng`, and `native`.
- A test appears to be wrong.
- The specification conflicts with existing behavior.
