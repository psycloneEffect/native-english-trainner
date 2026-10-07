/** リクエストボディの正規化と検証。 */

/** 1項目あたりの最大文字数。長文を投げてトークンを消費されるのを防ぐ。 */
const MAX_INPUT_LEN = 400;

/**
 * 受け取ったボディを整形する。要件を満たさなければ null。
 * native は任意（空ならモデルが表現を選ぶ）。
 */
export function normalize(body) {
  const trim = (v) => (typeof v === "string" ? v.trim().slice(0, MAX_INPUT_LEN) : "");
  const input = {
    situation: trim(body && body.situation),
    native: trim(body && body.native),
    ng: trim(body && body.ng),
  };
  if (!input.situation || !input.ng) return null;
  return input;
}
