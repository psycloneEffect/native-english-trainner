---
name: playwright-verification
description: Procedure for running Playwright, classifying failures, and detecting flaky browser tests without editing files. Applies only after the owner adopts Playwright. Preloaded by the ui-verifier subagent.
user-invocable: false
---

# Playwright verification

Playwright is a dependency, and this repository has not adopted it. Adopting it is the owner's decision.

## Procedure

1. Check that `package.json` exists and has a `test:e2e` script. If it does not, report that Playwright is not set up and stop. Do not try to install it.
2. Find the tests related to the change by searching `tests/e2e/`.
3. Run the narrowest useful set, then the full suite if that passes.
4. For each failure, read the evidence in the order below.
5. Check whether the failure is flaky.
6. Classify the failure. Check that the changed behavior has a test at all.

## Commands

| Goal                   | Command                                                               |
| ---------------------- | --------------------------------------------------------------------- |
| Full suite             | `npm run test:e2e`                                                    |
| One file               | `npm run test:e2e -- tests/e2e/<file>.spec.mjs`                             |
| By test name           | `npm run test:e2e -- --grep "<name>"`                                 |
| Only the last failures | `npm run test:e2e -- --last-failed`                                   |
| Check for flakiness    | `npm run test:e2e -- tests/e2e/<file>.spec.mjs --repeat-each=5 --retries=0` |

Do not use headed or UI modes, because they need someone at the screen. Tests must stub `/api/generate`, because a real generation calls the Claude API and costs money.

## Reading the evidence

1. The terminal output: the error, the locator, and the expected and received values
2. The test source: what the test is trying to confirm
3. Files under `test-results/<test>/`. Read `error-context.md` when it exists, and use `Read` to view any screenshot.
4. The application code for the failing behavior

You cannot open `trace.zip` here. Report its path so that the human can run `npx playwright show-trace <path>`.

Whether screenshots and traces are produced depends on the `screenshot` and `trace` options in the Playwright configuration. If they are missing, report that as a limit of your evidence.

## Classifying failures

| Class       | Signs                                                                                |
| ----------- | ------------------------------------------------------------------------------------ |
| Application | The page shows wrong content or state, or the console or network shows an error      |
| Test        | The app looks right, but the locator or expectation is outdated, or too strict       |
| Flaky       | Results differ across `--repeat-each` runs. Look for fixed waits and shared data     |
| Environment | The server does not start, a browser is missing, or a port or service is unavailable |

State your confidence, and name the evidence that would change your classification. Do not recommend retries or longer timeouts as the fix for a flaky test. Name the race condition if you can find it.

## What a screenshot cannot prove

A passing test shows only what it asserts. If layout or appearance matters and no test or screenshot covers it, say that a human should look.
