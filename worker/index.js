/**
 * Native Biz-English Trainer — Cloudflare Worker のエントリポイント。
 * ここが持つのはルーティングとレスポンスの整形のみ。
 *
 * - POST /api/login    ID/パスワードを検証し、セッションCookieを発行
 * - POST /api/logout   セッションCookieを失効
 * - GET  /api/session  ログイン状態とバージョンを返す
 * - POST /api/generate 教材1件分の JSON と Markdown を返す（要ログイン）
 * - それ以外           public/ の静的ファイルを返す
 *
 * 生成       → claude.js
 * 指示文     → prompt.js
 * 入力の検証 → input.js
 * 認証       → auth.js
 * 出力の構造 → ../public/shared/schema.js
 */

import { toMarkdown } from "../public/shared/schema.js";
import { generate } from "./claude.js";
import { normalize } from "./input.js";
import {
  configError,
  verifyCredentials,
  createSession,
  readSession,
  sessionCookie,
  clearCookie,
  roleOf,
} from "./auth.js";
import { consume, peek } from "./quota.js";

/** このWorkerのバージョン。public/app.js の APP_VERSION と対で更新する。 */
const WORKER_VERSION = "0.8.1";

const json = (body, status = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-app-version": WORKER_VERSION,
      ...extraHeaders,
    },
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    const misconfigured = configError(env);
    if (misconfigured) return json({ error: misconfigured }, 500);

    switch (url.pathname) {
      case "/api/login":
        return handleLogin(request, env);
      case "/api/logout":
        return json({ ok: true }, 200, { "set-cookie": clearCookie() });
      case "/api/session": {
        const session = await readSession(request, env);
        const role = session ? roleOf(session) : null;
        return json({
          authenticated: !!session,
          role,
          version: WORKER_VERSION,
          quota: session ? await peek(request, env, role) : null,
        });
      }
      case "/api/generate":
        return handleGenerate(request, env);
      default:
        return json({ error: "not_found" }, 404);
    }
  },
};

async function handleLogin(request, env) {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }

  const role = verifyCredentials(env, body && body.username, body && body.password);
  if (!role) {
    // ID と パスワードのどちらが違うかは返さない
    return json({ error: "invalid_credentials" }, 401);
  }

  const username = role === "admin" ? env.ADMIN_USERNAME : env.APP_USERNAME;
  const session = await createSession(env, username, role);
  return json({ ok: true, role, version: WORKER_VERSION }, 200, { "set-cookie": sessionCookie(session) });
}

async function handleGenerate(request, env) {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const session = await readSession(request, env);
  if (!session) return json({ error: "unauthorized" }, 401);
  if (!env.ANTHROPIC_API_KEY) return json({ error: "server_misconfigured" }, 500);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }

  const input = normalize(body);
  if (!input) return json({ error: "invalid_input" }, 400);

  // 上限の確認と消費は API を呼ぶ前に行う。
  // 生成に失敗してもトークンは消費されるため、成功時だけ数えると上限が機能しない。
  const quota = await consume(request, env, roleOf(session));
  if (!quota.ok) {
    const status = quota.code === "quota_not_configured" ? 500 : 429;
    return json({ error: quota.code, scope: quota.scope, resetAt: quota.resetAt }, status);
  }

  try {
    const result = await generate(input, env);
    // Markdown の体裁はサーバー側を正本とする。
    // 画面以外（CLI や他ツール）から叩いても同じ出力が得られる。
    const markdown = toMarkdown(result, input.situation);
    return json({ result, markdown, version: WORKER_VERSION, quota: quota.remaining });
  } catch (e) {
    console.error("generate failed", e);
    const status = e && e.status ? e.status : 502;
    return json({ error: (e && e.code) || "upstream_error", message: (e && e.message) || "unknown" }, status);
  }
}
