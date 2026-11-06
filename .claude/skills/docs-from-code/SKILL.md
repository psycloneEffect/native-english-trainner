---
name: docs-from-code
description: Procedure for writing README, CHANGELOG, and guides in Japanese from verified behavior of the code. Preloaded by the documenter subagent.
user-invocable: false
---

# Documentation from code

Documentation is a claim about the code, so verify each claim. Write all documentation in Japanese.

## Procedure

1. Run `git diff HEAD` and read the changed routes, Secrets, `vars`, and exports to find what readers need to know.
2. Identify the reader: someone deploying from a browser, someone using the tool, or someone developing it.
3. Find the existing text that the change makes false. Fix that first.
4. Write the smallest addition that lets the reader succeed.
5. Verify using the table below.
6. Report what you could not verify.

## Verifying claims

| Claim                     | How to verify                                                              |
| ------------------------- | -------------------------------------------------------------------------- |
| A `node` or `git` command | Run it, if the shell policy allows it                                      |
| A `wrangler` command      | Confirm it in `CLAUDE.md` or the source, and mark it "Not run"             |
| A Secret or `vars` entry  | `wrangler.jsonc` and the code that reads it                                |
| An API route or error     | `worker/index.js`, and `ERR` in `public/app.js` for the message            |
| A UI behavior             | Find it in `public/app.js`, and mark it "Not checked in a browser"         |
| A code example            | Check every import, name, and argument in the source                       |
| A version                 | `WORKER_VERSION` in `worker/index.js` and `APP_VERSION` in `public/app.js` |

Never document planned behavior as if it exists. The owner may deploy using only a browser, so do not add a step that needs local npm.

## Version changes

Follow the README section `バージョン管理`. A release-worthy change must update, in one commit:

- `CHANGELOG.md`, including the compare and tag links at the bottom
- Every `v0.x.y` mention in `README.md`
- `WORKER_VERSION` and `APP_VERSION`, which you cannot edit. Report the required value.

Also update the README when Secrets, `vars`, API routes, or the file layout change.

## Writing rules

- Lead with what the reader can do, and put commands in code blocks.
- Explain behavior, constraints, and failure modes.
- Use one term for one concept throughout.
- Link to a single source of truth instead of copying it. Command lists belong in one place.
- Do not add badges, tables of contents, or empty sections without a need.

## JSDoc

You cannot edit source files. Propose comments in your report for the implementer, in Japanese, and only for exports whose behavior the signature does not explain.

## Templates

Use [references/templates.md](references/templates.md) for CHANGELOG entries and JSDoc proposals.
