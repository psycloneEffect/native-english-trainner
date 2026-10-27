/**
 * ログインとセッションの検証。
 *
 * 認証情報はすべて Cloudflare の Secret から読む。コードにも設定ファイルにも書かない。
 *   APP_USERNAME   ログインID
 *   APP_PASSWORD   パスワード
 *   SESSION_SECRET セッション署名用のランダム文字列（32文字以上を推奨）
 *
 * セッションは署名付きCookie（sid）で保持する。サーバー側に状態を持たないため、
 * Workers KV などのストレージを増やさずに済む。失効させたい場合は SESSION_SECRET を
 * 入れ替える。全員のセッションが一斉に無効になる。
 *
 * 管理者（任意）:
 *   ADMIN_USERNAME / ADMIN_PASSWORD を Secret に登録すると管理者ログインが有効になる。
 *   管理者は実行回数の上限を受けない（ADMIN_DAILY_LIMIT を設定した場合はその値まで）。
 *   未登録なら管理者は存在せず、挙動は従来と同じ。
 *
 * 既知の制約:
 * - ログイン試行回数の制限がない。状態を持たない構成のため、総当たり対策は
 *   パスワードの強度に依存する。所内限定公開を前提とした割り切り。
 *   管理者のパスワードは漏れたときの被害が最も大きいので、特に強くすること。
 * - 共有アカウントは1つ。誰が実行したかは区別しない。
 */

const COOKIE_NAME = "sid";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7日

const enc = new TextEncoder();

const b64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const fromB64url = (s) => {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(pad + "=".repeat((4 - (pad.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

/** 文字列の比較にかかる時間を入力内容に依存させない */
function timingSafeEqual(a, b) {
  const x = enc.encode(a);
  const y = enc.encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

/** 設定が揃っているか。欠けていればエラーコードを返す。 */
export function configError(env) {
  if (!env.APP_USERNAME || !env.APP_PASSWORD || !env.SESSION_SECRET) return "auth_not_configured";
  return null;
}

/**
 * 管理者の認証情報が使える状態か。
 * 未設定なら管理者ログインは存在しない。共有アカウントと完全に同じ値の場合も
 * 無効として扱う（全員が管理者になってしまうため）。
 */
function adminEnabled(env) {
  if (!env.ADMIN_USERNAME || !env.ADMIN_PASSWORD) return false;
  if (env.ADMIN_USERNAME === env.APP_USERNAME && env.ADMIN_PASSWORD === env.APP_PASSWORD) {
    console.warn("ADMIN_* が APP_* と同じ値のため、管理者ログインを無効にしています");
    return false;
  }
  return true;
}

const matches = (username, password, u, p) =>
  timingSafeEqual(username, u) && timingSafeEqual(password, p);

/**
 * ID/パスワードを検証し、役割を返す。
 * "admin" | "user" のいずれか。一致しなければ null。
 * 管理者を先に判定するので、IDが共有アカウントと同じでもパスワードで区別できる。
 */
export function verifyCredentials(env, username, password) {
  if (typeof username !== "string" || typeof password !== "string") return null;
  if (adminEnabled(env) && matches(username, password, env.ADMIN_USERNAME, env.ADMIN_PASSWORD)) {
    return "admin";
  }
  if (matches(username, password, env.APP_USERNAME, env.APP_PASSWORD)) return "user";
  return null;
}

/**
 * Set-Cookie 用のセッション文字列を作る。
 * 役割は署名付きの payload に入るので、SESSION_SECRET を知らない限り書き換えられない。
 */
export async function createSession(env, username, role = "user") {
  const payload = b64url(enc.encode(JSON.stringify({ u: username, r: role, exp: Date.now() + SESSION_TTL_MS })));
  const sig = await hmac(env.SESSION_SECRET, payload);
  return `${payload}.${sig}`;
}

/** セッションの役割。0.8.0 より前に発行されたセッションには r が無いので user とみなす。 */
export const roleOf = (session) => (session && session.r === "admin" ? "admin" : "user");

/** Cookie からセッションを読む。妥当なら { u, r, exp }、そうでなければ null。 */
export async function readSession(request, env) {
  const raw = (request.headers.get("cookie") || "")
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(COOKIE_NAME + "="));
  if (!raw) return null;

  const [payload, sig] = raw.slice(COOKIE_NAME.length + 1).split(".");
  if (!payload || !sig) return null;

  const expected = await hmac(env.SESSION_SECRET, payload);
  if (!timingSafeEqual(sig, expected)) return null;

  try {
    const data = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
    if (!data || typeof data.exp !== "number" || data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

export const sessionCookie = (value) =>
  `${COOKIE_NAME}=${value}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;

export const clearCookie = () =>
  `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
