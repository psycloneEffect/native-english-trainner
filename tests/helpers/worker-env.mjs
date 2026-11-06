// worker の API テスト共通の道具。実際の Claude API には絶対に接続しない。

export const SESSION_SECRET = "test-only-session-secret-0123456789abcdef";

/** 最小限の KV 互換。put したキーも記録する。 */
export function fakeKv(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    puts: [],
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { this.puts.push(k); store.set(k, v); },
  };
}

/** 有効な教材 JSON（schema の必須項目を満たす） */
export const LESSON = {
  file_title: "テスト題",
  native: "native phrase",
  lead: "導入",
  ng_phrases: ["ng phrase"],
  why_ng: "理由",
  impression: { ng: "NG の印象", native: "自然な印象" },
  standard: { en: "standard en", ja: "標準" },
  formal: { en: "formal en", ja: "丁寧" },
  sources: [],
};

/** undefined を渡したキーは env から取り除く（KV なし等を表現するため） */
export function makeEnv(overrides = {}) {
  const env = {
    APP_USERNAME: "test-user",
    APP_PASSWORD: "test-password-not-real",
    SESSION_SECRET,
    ANTHROPIC_API_KEY: "dummy-not-a-real-key",
    MODEL: "test-model-from-env",
    QUOTA: fakeKv(),
    ASSETS: { fetch: async (req) => new Response("asset:" + new URL(req.url).pathname) },
    ...overrides,
  };
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
  return env;
}

export const textResponse = (obj, stop_reason = "end_turn") => ({
  stop_reason,
  content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj) }],
});

/**
 * globalThis.fetch を差し替える。handler(url, init, n) が返す値:
 *   Response ならそのまま、それ以外は 200 の JSON として返す。
 * Anthropic 以外の URL への通信は例外にして、テストを失敗させる。
 * t.mock なのでテスト終了時に元へ戻る。
 */
export function stubUpstream(t, handler) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    if (String(url) !== "https://api.anthropic.com/v1/messages") {
      throw new Error("想定外の URL への通信: " + url);
    }
    calls.push({ url: String(url), init, body: JSON.parse(init.body) });
    const out = await handler(String(url), init, calls.length);
    return out instanceof Response
      ? out
      : new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } });
  });
  return calls;
}

/** worker.fetch を呼ぶ小さな道具 */
export function client(worker, env) {
  const call = (path, { method = "GET", body, cookie, headers = {} } = {}) =>
    worker.fetch(
      new Request("http://test.invalid" + path, {
        method,
        headers: {
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
          ...(cookie ? { cookie } : {}),
          ...headers,
        },
        body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
      }),
      env,
    );
  const login = async (username, password) => {
    const res = await call("/api/login", { method: "POST", body: { username, password } });
    const sc = res.headers.get("set-cookie");
    return { res, cookie: sc ? sc.split(";")[0] : null };
  };
  return { call, login };
}

/** 日付の境界で不安定にならないよう、JST の正午に時計を固定する */
export function freezeClock(t) {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-06-15T03:00:00Z") });
}

/** worker が失敗時に出す console.error / warn を黙らせる */
export function silenceConsole(t) {
  t.mock.method(console, "error", () => {});
  t.mock.method(console, "warn", () => {});
}
