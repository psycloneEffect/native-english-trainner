---
name: js-test-design
description: Procedure for choosing and writing node:test tests that catch real regressions in plain JavaScript, with no dependency. Preloaded by the test-author subagent.
user-invocable: false
---

# Test design

No compiler checks this code, so tests also guard against wrong names and wrong shapes. Spend them on behavior a caller can observe.

## Setup

- Use `node:test` and `node:assert/strict`, which ship with Node. Do not add Vitest, Jest, or a `package.json`.
- Name files `tests/<source path>.test.mjs`, so `worker/quota.js` is tested by `tests/worker/quota.test.mjs`. The `.mjs` extension makes the test an ES module without a `package.json`.
- Import the code by relative path: `import { normalize } from "../../worker/input.js";`.
- Write test names and comments in Japanese.

## What can be tested here

| Code                      | Level                                                                         |
| ------------------------- | ----------------------------------------------------------------------------- |
| `public/shared/schema.js` | Unit test                                                                     |
| `worker/*.js`             | Unit test with a fake `env`, a fake KV, and a stubbed `fetch`                 |
| `public/app.js`           | Do not import it. It needs React and browser globals. Report it as unverified |

Never call the real Claude API, because it costs money. Stub `fetch` in every test that reaches `worker/claude.js`.

## Procedure

1. **State the behaviors.** Read the specification and the exports, and list what a caller can observe. Do not list private functions.
2. **Pick the cases** with the table below.
3. **Prioritize the rules in `Behavior to preserve` in `CLAUDE.md`.** They protect cost and security, so they come first.
4. **Reuse before you add.** Search `tests/` for helpers and factories.
5. **Write the tests,** and run them with `node --test <path>`.
6. **Challenge each test.** Ask which bug in the code would make it fail. If you cannot name one, rewrite or delete the test.

## Choosing cases

| Input or situation | Cases to consider                                              |
| ------------------ | -------------------------------------------------------------- |
| Collection         | Empty, one item, many, duplicates, upper limit                 |
| String             | Empty, whitespace only, non-ASCII, longer than `MAX_INPUT_LEN` |
| Number             | 0, negative, boundary on both sides, `NaN`, `Infinity`         |
| Optional value     | Omitted, `undefined`, `null` where external data allows it     |
| External data      | Wrong type, missing field, extra field, malformed text         |
| `vars`             | Missing, non-numeric text, `"0"`                               |
| KV                 | Binding missing, key missing, limit reached                    |
| Role               | Non-admin and admin, including which counters change           |
| Asynchronous code  | Rejection, timeout, ordering, cancellation                     |
| Time               | The JST date boundary, by fixing the clock                     |
| Bug fix            | The exact reproduction, written to fail before the fix         |

## Bug reproduction

Write the test, run it, and confirm that it fails for the reason in the bug report. A test that fails for another reason does not reproduce the bug. Leave it failing, and report it as the handoff to the implementer.

## Rules

- Assert on observable results, not on how the code produced them.
- Keep tests independent. Use the `t.mock` context, which restores itself when the test ends.
- Do not use real time, network, or randomness without controlling them.
- Do not use snapshots for logic. Explicit assertions state the intent.
- Do not add a test only to raise the coverage number.

## Examples

- Read [references/node-test-patterns.md](references/node-test-patterns.md) before writing tests.
- Read [references/playwright-e2e.md](references/playwright-e2e.md) only if the owner has adopted Playwright.
