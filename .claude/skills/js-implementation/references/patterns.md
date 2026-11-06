# JavaScript patterns

These patterns are plain ES modules that run with no build step. Comments are in Japanese, as the repository requires.

## Validating at a trust boundary

A JSDoc annotation proves nothing at runtime. Check the value where it enters. `worker/input.js` uses this approach.

```js
/** 受け取った値を検証する。条件を満たさなければ null。 */
export function parseCount(value) {
  const count = parseInt(value, 10);
  return Number.isFinite(count) && count > 0 ? count : null;
}
```

`vars` and KV values arrive as strings, so a comparison without parsing compares text.

## A result object for expected failures

Use this when callers must handle the failure, as `consume` in `worker/quota.js` does.

```js
/**
 * @returns {{ok: true, value: number} | {ok: false, code: string}}
 */
export function parseLimit(text) {
  const value = Number(text);
  if (!Number.isInteger(value)) return { ok: false, code: "limit_invalid" };
  if (value < 1) return { ok: false, code: "limit_out_of_range" };
  return { ok: true, value };
}
```

## A switch that fails on an unknown state

No compiler reports a missing case, so throw by default instead of returning `undefined`.

```js
export function describeState(state) {
  switch (state.status) {
    case "idle":
      return "未実行";
    case "loading":
      return "生成中";
    case "failure":
      return state.error.message;
    default:
      throw new Error(`未対応の状態: ${state.status}`);
  }
}
```

## An API error

The client shows a message for each code, so a new code needs an entry in `ERR` in `public/app.js`.

```js
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

export function quotaError(result) {
  return json({ error: result.code, resetAt: result.resetAt }, 429);
}
```

## Wrapping an error

Keep the original failure in `cause`.

```js
export async function readJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error("レスポンスを JSON として読めない", { cause: error });
  }
}
```

## Asynchronous work

`forEach` does not wait for async callbacks. Use `map` with `Promise.all`, or `for...of` when the order matters.

```js
export async function loadAll(ids, load) {
  return Promise.all(ids.map((id) => load(id)));
}

export async function runInOrder(steps) {
  for (const step of steps) {
    await step();
  }
}
```

## Omitting optional values

`JSON.stringify` drops `undefined` but keeps `null`. Decide which one the receiver expects, and omit the key when the value is absent.

```js
export function toOptions(limit) {
  return limit === undefined ? {} : { limit };
}
```
