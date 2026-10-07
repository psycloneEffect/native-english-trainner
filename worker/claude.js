/**
 * Claude Messages API の呼び出しと、応答からの教材データの取り出し。
 * HTTPの往復・pause_turn の継続・壊れたJSONの修復は、すべてこの層で閉じる。
 */

import { missingFields } from "../public/shared/schema.js";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompt.js";

const API_URL = "https://api.anthropic.com/v1/messages";

/** 辞書サイトのみを検索対象にする。無関係なブログを出典にさせないための制約。 */
const DICT_DOMAINS = [
  "eow.alc.co.jp",
  "dictionary.cambridge.org",
  "merriam-webster.com",
  "oxfordlearnersdictionaries.com",
];

/** 1回の生成で辞書を検索する上限回数。増やすほど出典は厚くなるが、その分レスポンスが遅くなる。 */
const MAX_DICTIONARY_LOOKUPS = 2;

/** pause_turn で返ってきたときに会話を継続する上限回数。 */
const MAX_CONTINUATIONS = 3;

/** 教材1件分のデータを生成する。失敗時は { status, code, message } を投げる。 */
export async function generate(input, env) {
  const messages = [{ role: "user", content: buildUserPrompt(input) }];

  let data = await callApi(env, messages);
  // Web検索を使うと1回で完結せず pause_turn で返ることがある
  for (let i = 0; i < MAX_CONTINUATIONS && data.stop_reason === "pause_turn"; i++) {
    messages.push({ role: "assistant", content: data.content });
    data = await callApi(env, messages);
  }

  const text = (data.content || [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n")
    .trim();

  if (!text) throw { status: 502, code: "empty_completion", message: "no text block" };

  const parsed = extractJson(text);
  const missing = missingFields(parsed);
  if (missing.length) {
    throw { status: 502, code: "invalid_json", message: "missing: " + missing.join(", ") };
  }
  if (!Array.isArray(parsed.sources)) parsed.sources = [];
  return parsed;
}

async function callApi(env, messages) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: env.MODEL || "claude-sonnet-5",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages,
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
          max_uses: MAX_DICTIONARY_LOOKUPS,
          allowed_domains: DICT_DOMAINS,
        },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw {
      status: res.status === 429 ? 429 : 502,
      code: res.status === 429 ? "rate_limited" : "upstream_error",
      message: text.slice(0, 500),
    };
  }
  return res.json();
}

function extractJson(text) {
  const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw { status: 502, code: "invalid_json", message: "no JSON object found" };
  }
  const raw = stripped.slice(start, end + 1);
  try {
    return JSON.parse(raw);
  } catch (e) {
    // モデルが文字列リテラル内に生の改行やタブを出すことがあるため、
    // 文字列の内側だけをエスケープして再試行する
    try {
      return JSON.parse(escapeControlCharsInStrings(raw));
    } catch (e2) {
      throw { status: 502, code: "invalid_json", message: e2.message };
    }
  }
}

/** JSON文字列リテラルの内側にある生の制御文字を \n / \t などに変換する */
function escapeControlCharsInStrings(src) {
  let out = "";
  let inString = false;
  let escaped = false;
  for (const ch of src) {
    if (escaped) { out += ch; escaped = false; continue; }
    if (ch === "\\") { out += ch; escaped = inString; continue; }
    if (ch === '"') { inString = !inString; out += ch; continue; }
    if (inString && ch === "\n") { out += "\\n"; continue; }
    if (inString && ch === "\r") { out += "\\r"; continue; }
    if (inString && ch === "\t") { out += "\\t"; continue; }
    if (inString && ch < " ") { continue; }
    out += ch;
  }
  return out;
}
