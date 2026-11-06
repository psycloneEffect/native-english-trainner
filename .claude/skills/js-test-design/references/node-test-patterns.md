# node:test patterns

These examples run as `tests/worker/<name>.test.mjs` with `node --test`, and need no dependency.

## Table-driven cases

```js
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalize } from "../../worker/input.js";

describe("normalize", () => {
  const rejected = [
    ["ボディがない", undefined],
    ["situation がない", { ng: "x" }],
    ["ng が空白だけ", { situation: "x", ng: "   " }],
    ["文字列でない", { situation: 1, ng: 2 }],
  ];

  for (const [reason, body] of rejected) {
    it(`${reason}ときは null を返す`, () => {
      assert.equal(normalize(body), null);
    });
  }

  it("許可された項目だけを返す", () => {
    const result = normalize({ situation: "a", ng: "b", model: "evil", prompt: "evil" });
    assert.deepEqual(result, { situation: "a", native: "", ng: "b" });
  });
});
```

## A fake KV and env

Pass the dependencies in. This covers the cost rules in `Behavior to preserve`.

```js
import assert from "node:assert/strict";
import { it } from "node:test";

import { consume } from "../../worker/quota.js";

function fakeKv() {
  const store = new Map();
  return {
    store,
    get: async (key) => store.get(key) ?? null,
    put: async (key, value) => {
      store.set(key, value);
    },
  };
}

const request = new Request("https://example.test/", {
  headers: { "cf-connecting-ip": "203.0.113.1" },
});

it("KV がないと利用者の実行を止める", async () => {
  const result = await consume(request, {});
  assert.deepEqual(result, { ok: false, code: "quota_not_configured" });
});

it("管理者は共有カウンタを増やさない", async () => {
  const kv = fakeKv();
  const result = await consume(request, { QUOTA: kv }, "admin");
  assert.equal(result.ok, true);
  assert.equal(kv.store.size, 0);
});

it("全体の上限に達すると拒否する", async () => {
  const env = { QUOTA: fakeKv(), DAILY_LIMIT: "1", PER_CLIENT_LIMIT: "5" };
  assert.equal((await consume(request, env)).ok, true);
  const second = await consume(request, env);
  assert.equal(second.code, "quota_exceeded");
  assert.equal(second.scope, "total");
});
```

## Rejections

Await the assertion. Without `await`, the test can pass before the assertion runs.

```js
import assert from "node:assert/strict";
import { it } from "node:test";

async function load(id) {
  await Promise.resolve();
  if (id === "") throw new RangeError("ID がない");
  return id;
}

it("ID が空なら RangeError で失敗する", async () => {
  await assert.rejects(load(""), RangeError);
});
```

## Stubbing fetch

Tests must never reach the real Claude API. `t.mock` restores `fetch` when the test ends.

```js
import assert from "node:assert/strict";
import { it } from "node:test";

async function fetchStatus(url) {
  const response = await fetch(url);
  return response.status;
}

it("レスポンスのステータスを返す", async (t) => {
  const fakeFetch = t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 503 }));

  assert.equal(await fetchStatus("https://example.test"), 503);
  assert.equal(fakeFetch.mock.callCount(), 1);
});
```

## Fixing the clock

The quota day changes at midnight JST, so fix the clock to test the boundary.

```js
import assert from "node:assert/strict";
import { it } from "node:test";

const todayJst = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" });

it("UTC の 15:00 に JST の日付が変わる", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-01-01T14:59:59Z") });
  assert.equal(todayJst(), "2026-01-01");

  t.mock.timers.setTime(Date.parse("2026-01-01T15:00:00Z"));
  assert.equal(todayJst(), "2026-01-02");
});
```

## Mock timers

```js
import assert from "node:assert/strict";
import { it } from "node:test";

function debounce(action, delayMs) {
  let timer;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(action, delayMs);
  };
}

it("待ち時間のあとに1回だけ実行する", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const action = t.mock.fn();
  const debounced = debounce(action, 100);

  debounced();
  debounced();
  t.mock.timers.tick(99);
  assert.equal(action.mock.callCount(), 0);

  t.mock.timers.tick(1);
  assert.equal(action.mock.callCount(), 1);
});
```

## Test data

A factory keeps tests readable when an object gains a field.

```js
import assert from "node:assert/strict";
import { it } from "node:test";

function makeBody(overrides = {}) {
  return { situation: "会議の冒頭", ng: "Let's start.", native: "", ...overrides };
}

it("指定しなかった項目は既定値のままになる", () => {
  assert.equal(makeBody({ ng: "x" }).situation, "会議の冒頭");
});
```
