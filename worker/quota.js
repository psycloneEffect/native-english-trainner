/**
 * 日次の実行回数の上限。トークンの使われすぎを防ぐのが目的。
 *
 * 必要な設定:
 *   KV Namespace を作り、バインディング名 QUOTA で紐づける
 *   vars.DAILY_LIMIT        全体の1日あたり上限（既定 30）
 *   vars.PER_CLIENT_LIMIT   端末ごとの1日あたり上限（既定 10）
 *
 * 2段構えにしている理由:
 * - 全体の上限は財布を守る。これを超えたらその日は誰も実行できない。
 * - 端末ごとの上限は、1人が全体の枠を使い切るのを防ぐ。
 *   1アカウントの共有運用のため、利用者の区別は接続元IPのハッシュで代用する。
 *
 * 管理者:
 *   全体・端末ごとの上限を受けず、それらのカウンタも増やさない。
 *   自分の試行で全体の枠を食い、他の利用者がその日使えなくなるのを避けるため。
 *   vars.ADMIN_DAILY_LIMIT を設定した場合だけ、管理者専用のカウンタで上限をかける。
 *   未設定なら無制限。費用の最終的な歯止めは Claude Console の Spend Limit が担う。
 *
 * 既知の制約:
 * - KV は結果整合で、読み取りと書き込みが不可分ではない。同時に実行されると
 *   数回ぶん超過しうる。厳密な上限が要るなら Durable Object に置き換える。
 *   ここでは「桁が違う使われ方を止める」ことが目的なので、この精度で足りる。
 * - カウントは API 呼び出しの前に加算する。生成が失敗してもトークンは消費される
 *   ため、成功時だけ数えると再試行で上限が意味をなさなくなる。
 */

const DEFAULT_DAILY_LIMIT = 30;
const DEFAULT_PER_CLIENT_LIMIT = 10;
const KEY_TTL_SEC = 60 * 60 * 48; // 2日で自動削除

/** JST の YYYY-MM-DD。日付の変わり目を利用者の感覚に合わせる。 */
function todayJst() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" });
}

/** 接続元IPは保存せず、ハッシュの先頭だけを識別子にする */
async function clientId(request) {
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
  return [...new Uint8Array(buf)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const limitOf = (value, fallback) => {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

async function readCount(kv, key) {
  const v = await kv.get(key);
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** 翌日0時(JST)のISO文字列。画面に「いつ戻るか」を出すために返す。 */
function resetAtJst() {
  const now = new Date();
  const jstMs = now.getTime() + 9 * 60 * 60 * 1000;
  const next = new Date(Math.floor(jstMs / 86400000) * 86400000 + 86400000);
  return new Date(next.getTime() - 9 * 60 * 60 * 1000).toISOString();
}

/** 管理者の上限。未設定・不正値なら null（無制限）。 */
const adminLimitOf = (env) => {
  const n = parseInt(env.ADMIN_DAILY_LIMIT, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * 管理者の1回ぶんを処理する。全体・端末のカウンタには触れない。
 * 無制限なら KV も不要。
 */
async function consumeAdmin(env) {
  const limit = adminLimitOf(env);
  if (limit === null) return { ok: true, remaining: { admin: true, remaining: null } };

  const kv = env.QUOTA;
  if (!kv) return { ok: false, code: "quota_not_configured" };

  const key = `gen:${todayJst()}:admin`;
  const used = await readCount(kv, key);
  if (used >= limit) {
    return { ok: false, code: "quota_exceeded", scope: "admin", resetAt: resetAtJst() };
  }
  await kv.put(key, String(used + 1), { expirationTtl: KEY_TTL_SEC });
  return { ok: true, remaining: { admin: true, remaining: limit - used - 1 } };
}

async function peekAdmin(env) {
  const limit = adminLimitOf(env);
  if (limit === null) return { admin: true, remaining: null };
  const kv = env.QUOTA;
  if (!kv) return null;
  const used = await readCount(kv, `gen:${todayJst()}:admin`);
  return { admin: true, remaining: Math.max(0, limit - used) };
}

/**
 * 残り回数を確認し、問題なければ1回ぶん消費する。
 * 成功: { ok: true, remaining: { client, total } }（管理者は { admin: true, remaining }）
 * 失敗: { ok: false, code, scope, resetAt }
 */
export async function consume(request, env, role = "user") {
  if (role === "admin") return consumeAdmin(env);

  const kv = env.QUOTA;
  // 設定漏れで上限なしに動くより、止まる方が安全（目的が費用の防止のため）
  if (!kv) return { ok: false, code: "quota_not_configured" };

  const dailyLimit = limitOf(env.DAILY_LIMIT, DEFAULT_DAILY_LIMIT);
  const clientLimit = limitOf(env.PER_CLIENT_LIMIT, DEFAULT_PER_CLIENT_LIMIT);

  const day = todayJst();
  const cid = await clientId(request);
  const totalKey = `gen:${day}:total`;
  const clientKey = `gen:${day}:c:${cid}`;

  const [total, client] = await Promise.all([readCount(kv, totalKey), readCount(kv, clientKey)]);

  if (total >= dailyLimit) {
    return { ok: false, code: "quota_exceeded", scope: "total", resetAt: resetAtJst() };
  }
  if (client >= clientLimit) {
    return { ok: false, code: "quota_exceeded", scope: "client", resetAt: resetAtJst() };
  }

  await Promise.all([
    kv.put(totalKey, String(total + 1), { expirationTtl: KEY_TTL_SEC }),
    kv.put(clientKey, String(client + 1), { expirationTtl: KEY_TTL_SEC }),
  ]);

  return {
    ok: true,
    remaining: { client: clientLimit - client - 1, total: dailyLimit - total - 1 },
  };
}

/** 消費せずに残りだけ見る。画面の表示用。 */
export async function peek(request, env, role = "user") {
  if (role === "admin") return peekAdmin(env);

  const kv = env.QUOTA;
  if (!kv) return null;

  const dailyLimit = limitOf(env.DAILY_LIMIT, DEFAULT_DAILY_LIMIT);
  const clientLimit = limitOf(env.PER_CLIENT_LIMIT, DEFAULT_PER_CLIENT_LIMIT);

  const day = todayJst();
  const cid = await clientId(request);
  const [total, client] = await Promise.all([
    readCount(kv, `gen:${day}:total`),
    readCount(kv, `gen:${day}:c:${cid}`),
  ]);

  return {
    client: Math.max(0, clientLimit - client),
    total: Math.max(0, dailyLimit - total),
  };
}
