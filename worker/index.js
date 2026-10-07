/**
 * Native Biz-English Trainer — Cloudflare Worker のエントリポイント。
 * ここが持つのはルーティングとレスポンスの整形のみ。
 *
 * - /api/generate : 教材1件分の JSON と Markdown を返す
 * - それ以外       : public/ の静的ファイルを返す
 *
 * 生成       → claude.js
 * 指示文     → prompt.js
 * 入力の検証 → input.js
 * アクセス   → auth.js
 * 出力の構造 → ../public/shared/schema.js
 */

import { toMarkdown } from "../public/shared/schema.js";
import { generate } from "./claude.js";
import { normalize } from "./input.js";
import { checkAccess } from "./auth.js";

/** このWorkerのバージョン。public/app.js の APP_VERSION と対で更新する。 */
const WORKER_VERSION = "0.4.0";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-app-version": WORKER_VERSION,
    },
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/api/generate") return env.ASSETS.fetch(request);
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

    const denied = checkAccess(request, env);
    if (denied) return json({ error: denied }, 401);
    if (!env.ANTHROPIC_API_KEY) return json({ error: "server_misconfigured" }, 500);

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "invalid_body" }, 400);
    }

    const input = normalize(body);
    if (!input) return json({ error: "invalid_input" }, 400);

    try {
      const result = await generate(input, env);
      // Markdown の体裁はサーバー側を正本とする。
      // 画面以外（CLI や他ツール）から叩いても同じ出力が得られる。
      const markdown = toMarkdown(result, input.situation);
      return json({ result, markdown, version: WORKER_VERSION });
    } catch (e) {
      console.error("generate failed", e);
      const status = e && e.status ? e.status : 502;
      return json({ error: (e && e.code) || "upstream_error", message: (e && e.message) || "unknown" }, status);
    }
  },
};
