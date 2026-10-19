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
 * 既知の制約:
 * - ログイン試行回数の制限がない。状態を持たない構成のため、総当たり対策は
 *   パスワードの強度に依存する。所内限定公開を前提とした割り切り。
 * - 1アカウントの共有運用。利用者ごとのトークン制限を入れる段階で、
 *   アカウントを分けるか、Cloudflare Access の個人IDに切り替える。
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

/** ID/パスワードを検証する */
export function verifyCredentials(env, username, password) {
  return (
    typeof username === "string" &&
    typeof password === "string" &&
    timingSafeEqual(username, env.APP_USERNAME) &&
    timingSafeEqual(password, env.APP_PASSWORD)
  );
}

/** Set-Cookie 用のセッション文字列を作る */
export async function createSession(env, username) {
  const payload = b64url(enc.encode(JSON.stringify({ u: username, exp: Date.now() + SESSION_TTL_MS })));
  const sig = await hmac(env.SESSION_SECRET, payload);
  return `${payload}.${sig}`;
}

/** Cookie からセッションを読む。妥当なら { u, exp }、そうでなければ null。 */
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
