---
name: js-root-cause
description: Evidence-based procedure for diagnosing syntax errors, node:test failures, and async or runtime bugs in plain JavaScript without editing files. Preloaded by the debugger subagent.
user-invocable: false
---

# Root cause analysis

## Procedure

1. **Reproduce.** Get the exact failure with the narrowest command. If you cannot reproduce it, report what you tried and stop.
2. **Write down the facts.** Separate what you observed from what you infer.
3. **List at least two hypotheses.** For each one, name an observation that would confirm it and one that would rule it out.
4. **Test the cheapest hypothesis first.** Stop when one hypothesis explains every observation.
5. **Find the origin.** Trace the bad value or state back to where it first became wrong. That is where the fix belongs.
6. **Propose the smallest fix.** Check its callers for side effects.

You cannot add temporary logging because you cannot edit files. Use the error output, source, tests, and git history. If you need a log to decide, specify the log statement in your report, and ask for it to be added.

You also cannot run `wrangler dev`, a browser, or the real Claude API. If reproducing the failure needs one of them, trace the code, label the result as unreproduced, and state what the main session should run.

## Commands

| Goal                                | Command                                                        |
| ----------------------------------- | -------------------------------------------------------------- |
| Run one test file                   | `node --test <path>`                                           |
| Run one test by name                | `node --test --test-name-pattern="<name>" <path>`              |
| Run all tests                       | `node --test ".claude/hooks/*.test.mjs" "tests/**/*.test.mjs"` |
| Check one file's syntax             | `node --check <file>`                                          |
| See recent changes                  | `git log --oneline -15`, then `git diff HEAD`                  |
| See when a line changed             | `git blame <file>`                                             |
| Find when text was added or removed | `git log -S "<text>" --oneline`                                |

## Where to look by symptom

| Symptom                                   | Check first                                                                  |
| ----------------------------------------- | ---------------------------------------------------------------------------- |
| `undefined` or `TypeError` at runtime     | A misspelled property, an unhandled `null` return, and the shape from Claude |
| A number behaves like text, or `NaN`      | `vars` and KV values, which are strings, and missing `parseInt` checks       |
| An error disappears or nothing happens    | Floating promises, `forEach` with an async callback, and empty `catch`       |
| An operation runs out of order            | Missing `await`, and shared state across `await`                             |
| A test times out                          | Mock timers with real promises, and a promise that never resolves            |
| Tests fail only in the full run           | Module-level state, and mocks or timers that are not restored                |
| `ERR_MODULE_NOT_FOUND`                    | The relative path and its required `.js` extension                           |
| A named import is missing                 | The `export` in the target file, and default versus named exports            |
| A value is `undefined` on load            | Circular imports                                                             |
| Works in the Worker, fails in the browser | `public/shared/schema.js` using an API that only one side has                |
| Works locally, fails after deploy         | `wrangler.jsonc`, missing Secrets or KV binding, and `compatibility_date`    |
| `v0.x / api 0.y` mismatch warning         | `WORKER_VERSION`, `APP_VERSION`, and a stale browser cache                   |
| Generation returns an API error code      | The route in `worker/index.js`, and `ERR` in `public/app.js`                 |
| A stale value in React                    | Closures, effect dependencies, and state mutated in place                    |
| An effect runs too often                  | Unstable object or function dependencies                                     |

`CLAUDE.md` lists accepted trade-offs, such as non-atomic KV counters. Name one if it explains the symptom, but do not propose changing it unless asked.

## Quality bar

- Each claim in the root cause cites evidence, such as a `file:line`, a command result, or a commit.
- The cause explains why the failure happens now, and why it did not happen before, when that is known.
- A proposal that only hides the symptom is not a fix. Examples are a new `catch`, a default value, a longer timeout, or a weaker test.
- If two hypotheses remain, report both, and state what would separate them.
