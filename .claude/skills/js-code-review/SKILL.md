---
name: js-code-review
description: Review procedure and severity criteria for plain JavaScript changes in this Cloudflare Worker and browser app, covering runtime contracts, module boundaries, error handling, and repository constraints. Preloaded by the reviewer subagent.
user-invocable: false
---

# JavaScript code review

No type checker or linter runs here, so review catches what those tools would catch elsewhere.

## Procedure

1. Read your memory. Note the conventions and the declined findings.
2. Run `git status`, then `git diff HEAD`. Read untracked files directly, because the diff omits them.
3. For each changed file, read the whole file and the callers of anything whose contract changed.
4. Compare the change with the specification, if there is one. Missing behavior is a finding.
5. Run `node --check` on each changed `.js` file, and the tests with `node --test ".claude/hooks/*.test.mjs" "tests/**/*.test.mjs"`, unless their results were given to you. The Worker dry-run belongs to the main session, so state that you did not run it.
6. Before you report a finding, confirm it by reading the code. Drop anything you cannot support with evidence.

## Severity

| Level      | Criteria                                                                                                  |
| ---------- | --------------------------------------------------------------------------------------------------------- |
| Critical   | Wrong behavior in a realistic case, data loss, a security hole, uncontrolled API cost, or a broken deploy |
| Warning    | A failure under less common conditions, a broken module rule, or a missing test                           |
| Suggestion | A real improvement to readability or maintainability that can safely wait                                 |

Do not raise a severity for emphasis. If you are unsure whether a problem is real, say so in the finding.

## Checklist

**Repository constraints**

Check the change against these sections of `CLAUDE.md`: `Hard constraints`, `Where changes go`, `Behavior to preserve`, and `Do not change without asking`. A violation is at least a Warning, and usually Critical. Do not report the accepted trade-offs listed there.

**Runtime contracts**

- Does every caller handle each shape a function can return, such as `null` or `{ ok: false, code }`?
- Is a name, property, or import misspelled? `node --check` does not find these, so trace them by hand.
- Is external data validated at the boundary: request bodies, Claude responses, KV values, `vars`, and cookies?
- Are `vars` parsed before use? They arrive as strings, so check `NaN`, `0`, and missing values.
- Do `switch` statements and lookups handle a new value, or fail silently with `undefined`?

**Module boundaries**

- Does `public/shared/schema.js` use only APIs available in both the Worker and the browser?
- Does output structure stay in `schema.js`, and tutor tone and sourcing stay in `worker/prompt.js`?
- Does `worker/index.js` hold only routing and response shaping?
- Do new imports create a cycle? Do browser imports use `/shared/schema.js` and Worker imports use a relative path?

**Error handling**

- Is any failure swallowed by an empty `catch`, or replaced with a misleading default?
- Is the original error kept in `cause` when it is wrapped?
- Is every promise awaited, returned, or deliberately marked with `void`?
- Does partial failure leave state inconsistent?
- Does a new API error use `{ error: "snake_case_code" }`, with a message in `ERR` in `public/app.js`?

**Correctness and security**

- Boundaries: empty, single item, limits, `undefined`, `NaN`
- Races across `await`, and stale results from earlier requests
- Hard-coded secrets, and secrets in logs. This repository is public.
- Input that reaches `innerHTML`, `dangerouslySetInnerHTML`, the prompt outside `<input>`, or a URL
- HTML from Markdown must pass through DOMPurify before it reaches the page

**React and htm**

- Stale closures, incomplete effect dependencies, and state mutated in place
- JSX is not valid here. Components use `html` template literals.

**Tests**

- Would the tests fail if the changed behavior broke?
- Were any tests weakened, skipped, or removed?
- Are the failure paths tested? Do tests avoid the real Claude API?
- State that browser behavior is unverified unless it was tested in a browser.

## Writing findings

Each finding has a `file:line`, the concrete failure it causes, and a suggested fix. Compare:

- Weak: "Error handling could be improved."
- Strong: "`worker/quota.js:42` returns success when KV is missing, so a non-admin request runs with no limit. Return `quota_not_configured`."

## Memory

Keep entries short, under these headings in `MEMORY.md`:

- **Recurring problems:** patterns that came up more than once
- **Conventions:** project rules that are not obvious from the code
- **Declined findings:** what the owner decided not to change, and why

Do not raise a declined finding again unless the reason no longer applies. Your memory directory is excluded from the public repository, so never copy an unfixed vulnerability into a tracked file.
