// worker/index.js を fetch 経由で通しで検証する。
// 外部通信 (Claude API) は globalThis.fetch のスタブで置き換え、実際には一切通信しない。
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import worker from "../../worker/index.js";
import {
  LESSON, makeEnv, textResponse, stubUpstream, client, freezeClock, silenceConsole,
} from "../helpers/worker-env.mjs";

const INPUT = { situation: "社内会議で依頼を断る", ng: "I can't do it", native: "" };
const TOTAL_KEY = /^gen:\d{4}-\d{2}-\d{2}:total$/;
const CLIENT_KEY = /^gen:\d{4}-\d{2}-\d{2}:c:[0-9a-f]+$/;
const ADMIN_KEY = /^gen:\d{4}-\d{2}-\d{2}:admin$/;
const USER = { u: "test-user", p: "test-password-not-real" };
const ADMIN = { u: "test-admin", p: "test-admin-password-not-real" };
const adminEnv = (o = {}) => makeEnv({ ADMIN_USERNAME: ADMIN.u, ADMIN_PASSWORD: ADMIN.p, ...o });
const keysOf = (kv, re) => [...kv.store.keys()].filter((k) => re.test(k));

/** 共通の準備: コンソール抑止と時計固定 */
beforeEach((t) => { silenceConsole(t); freezeClock(t); });

describe("ログイン", () => {
  test("正しい認証情報で 200 と HttpOnly の Cookie を返す", async () => {
    // Cookie を発行しない / HttpOnly を外すバグで失敗する
    const { call } = client(worker, makeEnv());
    const res = await call("/api/login", { method: "POST", body: { username: USER.u, password: USER.p } });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).role, "user");
    const sc = res.headers.get("set-cookie");
    assert.match(sc, /^sid=[^;]+\.[^;]+;/);
    assert.match(sc, /HttpOnly/);
    assert.match(sc, /Secure/);
  });

  test("誤パスワードは 401 invalid_credentials、Cookie なし", async () => {
    const { call } = client(worker, makeEnv());
    const res = await call("/api/login", { method: "POST", body: { username: USER.u, password: "wrong" } });
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: "invalid_credentials" });
    assert.equal(res.headers.get("set-cookie"), null);
  });

  test("ID違いとパスワード違いで応答本文が同一（どちらが違うか漏らさない）", async () => {
    const { call } = client(worker, makeEnv());
    const a = await call("/api/login", { method: "POST", body: { username: "nobody", password: USER.p } });
    const b = await call("/api/login", { method: "POST", body: { username: USER.u, password: "wrong" } });
    assert.equal(a.status, b.status);
    assert.equal(await a.text(), await b.text());
  });

  test("JSON でないボディ、文字列以外の値は 400 invalid_body / 401", async () => {
    const { call } = client(worker, makeEnv());
    const bad = await call("/api/login", { method: "POST", body: "not json{" });
    assert.equal(bad.status, 400);
    assert.deepEqual(await bad.json(), { error: "invalid_body" });
    // JSON だが型が違う場合は例外にならず認証失敗になる
    const typed = await call("/api/login", { method: "POST", body: { username: 1, password: 2 } });
    assert.equal(typed.status, 401);
    const nul = await call("/api/login", { method: "POST", body: "null" });
    assert.equal(nul.status, 401);
  });

  test("GET は 405", async () => {
    const { call } = client(worker, makeEnv());
    assert.equal((await call("/api/login")).status, 405);
  });

  test("管理者でログインすると role は admin", async () => {
    const { login } = client(worker, adminEnv());
    const { res } = await login(ADMIN.u, ADMIN.p);
    assert.equal((await res.json()).role, "admin");
  });

  test("管理者の認証情報が未設定なら管理者ログインは存在しない", async () => {
    const { login } = client(worker, makeEnv());
    const { res } = await login(ADMIN.u, ADMIN.p);
    assert.equal(res.status, 401);
  });

  test("認証設定が欠けていると 500 auth_not_configured", async () => {
    const { call } = client(worker, makeEnv({ SESSION_SECRET: undefined }));
    const res = await call("/api/session");
    assert.equal(res.status, 500);
    assert.equal((await res.json()).error, "auth_not_configured");
  });
});

describe("セッション", () => {
  test("未ログインは authenticated:false / role:null / quota:null", async () => {
    const { call } = client(worker, makeEnv());
    const body = await (await call("/api/session")).json();
    assert.equal(body.authenticated, false);
    assert.equal(body.role, null);
    assert.equal(body.quota, null);
    assert.equal(typeof body.version, "string");
  });

  test("ログイン済みは role と残り回数を返し、peek は消費しない", async () => {
    const env = makeEnv({ DAILY_LIMIT: "5", PER_CLIENT_LIMIT: "2" });
    const { call, login } = client(worker, env);
    const { cookie } = await login(USER.u, USER.p);
    for (let i = 0; i < 2; i++) {
      const body = await (await call("/api/session", { cookie })).json();
      assert.equal(body.authenticated, true);
      assert.equal(body.role, "user");
      assert.deepEqual(body.quota, { client: 2, total: 5 });
    }
    assert.equal(env.QUOTA.puts.length, 0);
  });

  test("管理者のセッションは role:admin、上限未設定なら remaining:null", async () => {
    const { call, login } = client(worker, adminEnv());
    const { cookie } = await login(ADMIN.u, ADMIN.p);
    const body = await (await call("/api/session", { cookie })).json();
    assert.equal(body.role, "admin");
    assert.deepEqual(body.quota, { admin: true, remaining: null });
  });

  test("署名を改ざんした Cookie は未ログイン扱い", async () => {
    const { call, login } = client(worker, makeEnv());
    const { cookie } = await login(USER.u, USER.p);
    const [payload, sig] = cookie.slice(4).split(".");
    const flipped = sig.slice(0, -1) + (sig.endsWith("A") ? "B" : "A");
    const res = await call("/api/session", { cookie: `sid=${payload}.${flipped}` });
    assert.equal((await res.json()).authenticated, false);
  });

  test("payload の role を admin に書き換えても昇格できない", async () => {
    // 署名の検証を外す・role を署名対象から外すバグで失敗する
    const { call, login } = client(worker, adminEnv());
    const { cookie } = await login(USER.u, USER.p);
    const [payload, sig] = cookie.slice(4).split(".");
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    data.r = "admin";
    const forged = Buffer.from(JSON.stringify(data)).toString("base64url");
    const res = await call("/api/session", { cookie: `sid=${forged}.${sig}` });
    assert.equal((await res.json()).authenticated, false);
  });

  test("別の SESSION_SECRET で署名された Cookie は無効", async () => {
    const { login } = client(worker, makeEnv());
    const { cookie } = await login(USER.u, USER.p);
    const other = client(worker, makeEnv({ SESSION_SECRET: "another-test-secret-abcdefghijklmnop" }));
    assert.equal((await (await other.call("/api/session", { cookie })).json()).authenticated, false);
  });

  test("7日を過ぎたセッションは無効", async (t) => {
    const { call, login } = client(worker, makeEnv());
    const { cookie } = await login(USER.u, USER.p);
    t.mock.timers.tick(7 * 24 * 60 * 60 * 1000 + 1000);
    assert.equal((await (await call("/api/session", { cookie })).json()).authenticated, false);
  });

  test("ログアウトは sid を Max-Age=0 で失効させる", async () => {
    const { call } = client(worker, makeEnv());
    const res = await call("/api/logout", { method: "POST" });
    assert.equal(res.status, 200);
    const sc = res.headers.get("set-cookie");
    assert.match(sc, /^sid=;/);
    assert.match(sc, /Max-Age=0/);
  });
});

describe("/api/generate の入口", () => {
  test("未ログインは 401 で、上流を呼ばず残り回数も減らさない", async (t) => {
    const calls = stubUpstream(t, () => textResponse(LESSON));
    const env = makeEnv();
    const { call } = client(worker, env);
    const res = await call("/api/generate", { method: "POST", body: INPUT });
    assert.equal(res.status, 401);
    assert.equal((await res.json()).error, "unauthorized");
    assert.equal(calls.length, 0);
    assert.equal(env.QUOTA.puts.length, 0);
  });

  test("GET は 405", async (t) => {
    stubUpstream(t, () => textResponse(LESSON));
    const { call, login } = client(worker, makeEnv());
    const { cookie } = await login(USER.u, USER.p);
    assert.equal((await call("/api/generate", { cookie })).status, 405);
  });

  test("ANTHROPIC_API_KEY が無いと 500 server_misconfigured で、外部通信も消費もしない", async (t) => {
    const calls = stubUpstream(t, () => textResponse(LESSON));
    const env = makeEnv({ ANTHROPIC_API_KEY: undefined });
    const { call, login } = client(worker, env);
    const { cookie } = await login(USER.u, USER.p);
    const res = await call("/api/generate", { method: "POST", body: INPUT, cookie });
    assert.equal(res.status, 500);
    assert.equal((await res.json()).error, "server_misconfigured");
    assert.equal(calls.length, 0);
    assert.equal(env.QUOTA.puts.length, 0);
  });

  test("入力不足・不正ボディは 400 で、上流を呼ばず消費もしない", async (t) => {
    const calls = stubUpstream(t, () => textResponse(LESSON));
    const env = makeEnv();
    const { call, login } = client(worker, env);
    const { cookie } = await login(USER.u, USER.p);
    for (const body of [{ situation: "s" }, { ng: "n" }, { situation: " ", ng: " " }, {}]) {
      const res = await call("/api/generate", { method: "POST", body, cookie });
      assert.equal(res.status, 400);
      assert.equal((await res.json()).error, "invalid_input");
    }
    const broken = await call("/api/generate", { method: "POST", body: "{oops", cookie });
    assert.equal(broken.status, 400);
    assert.equal((await broken.json()).error, "invalid_body");
    assert.equal(calls.length, 0);
    assert.equal(env.QUOTA.puts.length, 0);
  });

  test("成功時は result と markdown と残り回数を返す", async (t) => {
    stubUpstream(t, () => textResponse(LESSON));
    const env = makeEnv({ DAILY_LIMIT: "5", PER_CLIENT_LIMIT: "3" });
    const { call, login } = client(worker, env);
    const { cookie } = await login(USER.u, USER.p);
    const res = await call("/api/generate", { method: "POST", body: INPUT, cookie });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.result.file_title, LESSON.file_title);
    assert.equal(typeof body.markdown, "string");
    assert.ok(body.markdown.includes("standard en"));
    assert.deepEqual(body.quota, { client: 2, total: 4 });
  });

  test("JSON をコードフェンスで包んだ応答でも取り出せる", async (t) => {
    stubUpstream(t, () => textResponse("```json\n" + JSON.stringify(LESSON) + "\n```"));
    const { call, login } = client(worker, makeEnv());
    const { cookie } = await login(USER.u, USER.p);
    const res = await call("/api/generate", { method: "POST", body: INPUT, cookie });
    assert.equal(res.status, 200);
  });
});

describe("コスト保護（残り回数）", () => {
  test("上流呼び出しの時点で既に消費済み、上流が失敗しても減ったまま", async (t) => {
    // 消費を成功後に回すバグで失敗する（CLAUDE.md: Consume quota before calling Claude）
    const env = makeEnv();
    let totalSeenByUpstream = null;
    stubUpstream(t, () => {
      totalSeenByUpstream = keysOf(env.QUOTA, TOTAL_KEY).map((k) => env.QUOTA.store.get(k));
      return new Response("boom", { status: 500 });
    });
    const { call, login } = client(worker, env);
    const { cookie } = await login(USER.u, USER.p);
    const res = await call("/api/generate", { method: "POST", body: INPUT, cookie });
    assert.equal(res.status, 502);
    assert.deepEqual(totalSeenByUpstream, ["1"]);
    assert.deepEqual(keysOf(env.QUOTA, TOTAL_KEY).map((k) => env.QUOTA.store.get(k)), ["1"]);
    assert.deepEqual(keysOf(env.QUOTA, CLIENT_KEY).map((k) => env.QUOTA.store.get(k)), ["1"]);
  });

  test("不正な JSON を返された失敗でも消費される", async (t) => {
    const env = makeEnv();
    stubUpstream(t, () => textResponse("JSONではない"));
    const { call, login } = client(worker, env);
    const { cookie } = await login(USER.u, USER.p);
    await call("/api/generate", { method: "POST", body: INPUT, cookie });
    assert.equal(env.QUOTA.store.get(keysOf(env.QUOTA, TOTAL_KEY)[0]), "1");
  });

  test("非管理者は KV が無いと 500 quota_not_configured で、上流を呼ばない", async (t) => {
    const calls = stubUpstream(t, () => textResponse(LESSON));
    const { call, login } = client(worker, makeEnv({ QUOTA: undefined }));
    const { cookie } = await login(USER.u, USER.p);
    const res = await call("/api/generate", { method: "POST", body: INPUT, cookie });
    assert.equal(res.status, 500);
    assert.equal((await res.json()).error, "quota_not_configured");
    assert.equal(calls.length, 0);
  });

  test("端末ごとの上限で 429 quota_exceeded scope:client、上流を呼ばない", async (t) => {
    const calls = stubUpstream(t, () => textResponse(LESSON));
    const env = makeEnv({ DAILY_LIMIT: "30", PER_CLIENT_LIMIT: "2" });
    const { call, login } = client(worker, env);
    const { cookie } = await login(USER.u, USER.p);
    const ip = { "cf-connecting-ip": "192.0.2.1" };
    for (let i = 0; i < 2; i++) {
      assert.equal((await call("/api/generate", { method: "POST", body: INPUT, cookie, headers: ip })).status, 200);
    }
    const res = await call("/api/generate", { method: "POST", body: INPUT, cookie, headers: ip });
    assert.equal(res.status, 429);
    const body = await res.json();
    assert.equal(body.error, "quota_exceeded");
    assert.equal(body.scope, "client");
    assert.ok(!Number.isNaN(Date.parse(body.resetAt)));
    assert.equal(calls.length, 2);

    // 別の端末（別IP）は影響を受けない = 端末ごとの識別が効いている
    const other = await call("/api/generate", {
      method: "POST", body: INPUT, cookie, headers: { "cf-connecting-ip": "192.0.2.2" },
    });
    assert.equal(other.status, 200);
  });

  test("全体の上限で 429 quota_exceeded scope:total、上流を呼ばない", async (t) => {
    const calls = stubUpstream(t, () => textResponse(LESSON));
    const env = makeEnv({ DAILY_LIMIT: "2", PER_CLIENT_LIMIT: "10" });
    const { call, login } = client(worker, env);
    const { cookie } = await login(USER.u, USER.p);
    for (const ip of ["192.0.2.1", "192.0.2.2"]) {
      const r = await call("/api/generate", { method: "POST", body: INPUT, cookie, headers: { "cf-connecting-ip": ip } });
      assert.equal(r.status, 200);
    }
    const res = await call("/api/generate", {
      method: "POST", body: INPUT, cookie, headers: { "cf-connecting-ip": "192.0.2.3" },
    });
    assert.equal(res.status, 429);
    const body = await res.json();
    assert.equal(body.error, "quota_exceeded");
    assert.equal(body.scope, "total");
    assert.equal(calls.length, 2);
  });

  test("上限到達後は残り回数が増えない（上限超過リクエストは消費しない）", async (t) => {
    stubUpstream(t, () => textResponse(LESSON));
    const env = makeEnv({ DAILY_LIMIT: "1" });
    const { call, login } = client(worker, env);
    const { cookie } = await login(USER.u, USER.p);
    await call("/api/generate", { method: "POST", body: INPUT, cookie });
    await call("/api/generate", { method: "POST", body: INPUT, cookie });
    assert.equal(env.QUOTA.store.get(keysOf(env.QUOTA, TOTAL_KEY)[0]), "1");
  });
});

describe("管理者の実行", () => {
  test("共有カウンタ（total / 端末）を増やさず、KV が無くても動く", async (t) => {
    // 管理者が全体の枠を食うバグで失敗する
    const calls = stubUpstream(t, () => textResponse(LESSON));
    const env = adminEnv({ DAILY_LIMIT: "1", PER_CLIENT_LIMIT: "1" });
    const { call, login } = client(worker, env);
    const { cookie } = await login(ADMIN.u, ADMIN.p);
    for (let i = 0; i < 3; i++) {
      const res = await call("/api/generate", { method: "POST", body: INPUT, cookie });
      assert.equal(res.status, 200);
      assert.deepEqual((await res.json()).quota, { admin: true, remaining: null });
    }
    assert.equal(calls.length, 3);
    assert.equal(env.QUOTA.puts.length, 0);
    assert.equal(keysOf(env.QUOTA, TOTAL_KEY).length + keysOf(env.QUOTA, CLIENT_KEY).length, 0);
  });

  test("ADMIN_DAILY_LIMIT 未設定なら KV 無しでも実行できる", async (t) => {
    stubUpstream(t, () => textResponse(LESSON));
    const { call, login } = client(worker, adminEnv({ QUOTA: undefined }));
    const { cookie } = await login(ADMIN.u, ADMIN.p);
    const res = await call("/api/generate", { method: "POST", body: INPUT, cookie });
    assert.equal(res.status, 200);
  });

  test("ADMIN_DAILY_LIMIT があれば管理者専用カウンタで止まり、共有カウンタは不変", async (t) => {
    const calls = stubUpstream(t, () => textResponse(LESSON));
    const env = adminEnv({ ADMIN_DAILY_LIMIT: "2" });
    const { call, login } = client(worker, env);
    const { cookie } = await login(ADMIN.u, ADMIN.p);
    const r1 = await call("/api/generate", { method: "POST", body: INPUT, cookie });
    assert.deepEqual((await r1.json()).quota, { admin: true, remaining: 1 });
    assert.equal((await call("/api/generate", { method: "POST", body: INPUT, cookie })).status, 200);
    const res = await call("/api/generate", { method: "POST", body: INPUT, cookie });
    assert.equal(res.status, 429);
    const body = await res.json();
    assert.equal(body.error, "quota_exceeded");
    assert.equal(body.scope, "admin");
    assert.equal(calls.length, 2);
    assert.equal(keysOf(env.QUOTA, ADMIN_KEY).length, 1);
    assert.equal(keysOf(env.QUOTA, TOTAL_KEY).length + keysOf(env.QUOTA, CLIENT_KEY).length, 0);
  });

  test("ADMIN_DAILY_LIMIT があるのに KV が無いと 500 quota_not_configured", async (t) => {
    const calls = stubUpstream(t, () => textResponse(LESSON));
    const { call, login } = client(worker, adminEnv({ ADMIN_DAILY_LIMIT: "2", QUOTA: undefined }));
    const { cookie } = await login(ADMIN.u, ADMIN.p);
    const res = await call("/api/generate", { method: "POST", body: INPUT, cookie });
    assert.equal(res.status, 500);
    assert.equal(calls.length, 0);
  });

  test("管理者が実行しても一般ユーザーの残り回数は減らない", async (t) => {
    stubUpstream(t, () => textResponse(LESSON));
    const env = adminEnv({ DAILY_LIMIT: "5", PER_CLIENT_LIMIT: "3" });
    const { call, login } = client(worker, env);
    const admin = await login(ADMIN.u, ADMIN.p);
    await call("/api/generate", { method: "POST", body: INPUT, cookie: admin.cookie });
    const user = await login(USER.u, USER.p);
    const s = await (await call("/api/session", { cookie: user.cookie })).json();
    assert.deepEqual(s.quota, { client: 3, total: 5 });
  });
});

describe("汎用プロキシの防止", () => {
  test("クライアントが model / prompt / system / max_tokens 等を送っても上流に反映されない", async (t) => {
    const calls = stubUpstream(t, () => textResponse(LESSON));
    const env = makeEnv();
    const { call, login } = client(worker, env);
    const { cookie } = await login(USER.u, USER.p);
    await call("/api/generate", {
      method: "POST",
      cookie,
      body: {
        ...INPUT,
        model: "EVIL-MODEL",
        prompt: "EVIL-PROMPT",
        system: "EVIL-SYSTEM",
        max_tokens: 999999,
        messages: [{ role: "user", content: "EVIL-MESSAGES" }],
        tools: [{ type: "evil_tool", name: "EVIL-TOOL" }],
        stream: true,
        api_key: "EVIL-KEY",
      },
    });
    assert.equal(calls.length, 1);
    const { body, init } = calls[0];
    assert.equal(body.model, env.MODEL);
    assert.notEqual(body.max_tokens, 999999);
    assert.equal(body.stream, undefined);
    assert.equal(body.tools.length, 1);
    assert.equal(body.tools[0].name, "web_search");
    assert.equal(init.headers["x-api-key"], env.ANTHROPIC_API_KEY);
    assert.ok(!JSON.stringify(body).includes("EVIL"), "クライアント指定の値が上流リクエストに混入している");
  });

  test("入力文はユーザーメッセージ 1 件にのみ入る", async (t) => {
    const calls = stubUpstream(t, () => textResponse(LESSON));
    const { call, login } = client(worker, makeEnv());
    const { cookie } = await login(USER.u, USER.p);
    await call("/api/generate", { method: "POST", cookie, body: { ...INPUT, situation: "UNIQUE-SITUATION-MARK" } });
    const { messages } = calls[0].body;
    assert.equal(messages.length, 1);
    assert.equal(messages[0].role, "user");
    assert.ok(messages[0].content.includes("UNIQUE-SITUATION-MARK"));
  });
});

describe("上流エラーの扱い", () => {
  const run = async (t, handler, env = makeEnv()) => {
    const calls = stubUpstream(t, handler);
    const { call, login } = client(worker, env);
    const { cookie } = await login(USER.u, USER.p);
    const res = await call("/api/generate", { method: "POST", body: INPUT, cookie });
    return { res, body: await res.json(), calls };
  };

  test("上流 429 は 429 rate_limited", async (t) => {
    const { res, body } = await run(t, () => new Response("slow down", { status: 429 }));
    assert.equal(res.status, 429);
    assert.equal(body.error, "rate_limited");
  });

  test("上流の 429 以外のエラー（400/500/529）は 502 upstream_error", async (t) => {
    for (const status of [400, 500, 529]) {
      const { res, body } = await run(t, () => new Response("err", { status }));
      assert.equal(res.status, 502, `upstream ${status}`);
      assert.equal(body.error, "upstream_error");
    }
  });

  test("エラー本文は長くても 500 文字に切り詰める", async (t) => {
    const { body } = await run(t, () => new Response("x".repeat(5000), { status: 500 }));
    assert.ok(body.message.length <= 500);
  });

  test("JSON でないテキストは 502 invalid_json", async (t) => {
    const { res, body } = await run(t, () => textResponse("すみません、作れませんでした"));
    assert.equal(res.status, 502);
    assert.equal(body.error, "invalid_json");
  });

  test("壊れた JSON は 502 invalid_json", async (t) => {
    const { res, body } = await run(t, () => textResponse('{"file_title": "a", '));
    assert.equal(res.status, 502);
    assert.equal(body.error, "invalid_json");
  });

  test("必須項目が欠けた JSON は 502 invalid_json", async (t) => {
    const { lead, ...partial } = LESSON;
    const { res, body } = await run(t, () => textResponse(partial));
    assert.equal(res.status, 502);
    assert.equal(body.error, "invalid_json");
    assert.match(body.message, /lead/);
  });

  test("文字列内の生の改行を含む JSON は修復されて成功する", async (t) => {
    const raw = JSON.stringify(LESSON).replace("導入", "導\n入");
    const { res, body } = await run(t, () => textResponse(raw));
    assert.equal(res.status, 200);
    assert.equal(body.result.lead, "導\n入");
  });

  test("sources が無い応答は空配列で補われる", async (t) => {
    const { sources, ...noSources } = LESSON;
    const { res, body } = await run(t, () => textResponse(noSources));
    assert.equal(res.status, 200);
    assert.deepEqual(body.result.sources, []);
  });

  test("テキストブロックが無い応答は 502", async (t) => {
    const { res } = await run(t, () => ({ stop_reason: "end_turn", content: [] }));
    assert.equal(res.status, 502);
  });
});

describe("pause_turn の継続", () => {
  const setup = async (t, handler) => {
    const calls = stubUpstream(t, handler);
    const { call, login } = client(worker, makeEnv());
    const { cookie } = await login(USER.u, USER.p);
    const res = await call("/api/generate", { method: "POST", body: INPUT, cookie });
    return { res, calls };
  };

  test("pause_turn が続いても上流呼び出しは初回 + 3 回で止まる", async (t) => {
    // 継続上限が無い / 上限を超えるバグで失敗する（費用の暴走）
    const { res, calls } = await setup(t, () => ({
      stop_reason: "pause_turn",
      content: [{ type: "server_tool_use", id: "x", name: "web_search", input: {} }],
    }));
    assert.equal(calls.length, 4);
    assert.equal(res.status, 502);
  });

  test("pause_turn の後に完了すれば成功し、会話が引き継がれる", async (t) => {
    const paused = [{ type: "server_tool_use", id: "x", name: "web_search", input: {} }];
    const { res, calls } = await setup(t, (_u, _i, n) =>
      n === 1 ? { stop_reason: "pause_turn", content: paused } : textResponse(LESSON));
    assert.equal(res.status, 200);
    assert.equal(calls.length, 2);
    const msgs = calls[1].body.messages;
    assert.equal(msgs.length, 2);
    assert.equal(msgs[1].role, "assistant");
    assert.deepEqual(msgs[1].content, paused);
  });

  test("継続しても残り回数の消費は 1 回ぶんだけ", async (t) => {
    const paused = [{ type: "server_tool_use", id: "x", name: "web_search", input: {} }];
    const env = makeEnv();
    stubUpstream(t, (_u, _i, n) => (n < 3 ? { stop_reason: "pause_turn", content: paused } : textResponse(LESSON)));
    const { call, login } = client(worker, env);
    const { cookie } = await login(USER.u, USER.p);
    await call("/api/generate", { method: "POST", body: INPUT, cookie });
    assert.equal(env.QUOTA.store.get(keysOf(env.QUOTA, TOTAL_KEY)[0]), "1");
  });
});

describe("ルーティング", () => {
  test("/api/ 以外は env.ASSETS.fetch に渡し、認証も上流も不要", async (t) => {
    const calls = stubUpstream(t, () => textResponse(LESSON));
    const seen = [];
    const env = makeEnv({
      SESSION_SECRET: undefined, // 認証設定が無くても静的ファイルは返る
      ASSETS: { fetch: async (req) => { seen.push(new URL(req.url).pathname); return new Response("asset-body"); } },
    });
    const { call } = client(worker, env);
    const res = await call("/index.html");
    assert.equal(await res.text(), "asset-body");
    await call("/");
    await call("/apixyz"); // "/api/" で始まらないので静的扱い
    assert.deepEqual(seen, ["/index.html", "/", "/apixyz"]);
    assert.equal(calls.length, 0);
  });

  test("未知の /api/* は 404 not_found", async () => {
    const { call } = client(worker, makeEnv());
    const res = await call("/api/unknown");
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: "not_found" });
  });

  test("API の応答に x-app-version ヘッダが付く", async () => {
    const { call } = client(worker, makeEnv());
    assert.match((await call("/api/session")).headers.get("x-app-version"), /^\d+\.\d+\.\d+$/);
  });
});
