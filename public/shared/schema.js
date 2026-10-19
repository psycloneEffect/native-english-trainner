/**
 * 教材1件分のデータ構造の正本。
 *
 * ここを直せば、モデルへの指示・応答の検証・Markdownの組み立てが揃って変わる。
 * 項目を増やすときは SCHEMA に1行足し、必要なら toMarkdown に出力位置を書く。
 *
 * Worker からは相対パスで import（wrangler がバンドルする）。
 * ブラウザからは /shared/schema.js として配信される。
 * この二重利用のため、public/ 配下に置いている。
 */

/** @typedef {{key:string, required?:boolean, type?:string, desc:string, fields?:object}} Field */

/** 応答JSONの項目定義。順序はそのままモデルへの指示の順序になる。 */
export const SCHEMA = [
  { key: "file_title", required: true,
    desc: "場面を表す日本語の短い見出し（15文字程度、記号なし。例: 相手の成功を祝う表現）" },
  { key: "native", required: true,
    desc: "この場面で採用するネイティブ表現1つ。入力の native が指定されていればその文字列をそのまま入れる。未指定ならあなたが選んだ表現を入れる" },
  { key: "lead", required: true,
    desc: "この場面でその表現がなぜ良いのかを1〜2文で" },
  { key: "ng_phrases", required: true, type: "string[]",
    desc: "1件目は入力のNG表現そのまま。似たNG表現があれば最大2件まで追加" },
  { key: "why_ng", required: true,
    desc: "2〜3段落。段落の区切りは \\n\\n（JSON文字列としてエスケープした改行）で表す。生の改行を文字列に含めないこと" },
  { key: "impression", required: true, type: "object",
    desc: "NG表現とネイティブ表現で、相手の受け取り方がどう変わるか",
    fields: {
      listener: { desc: "この場面の聞き手を短く（例: 難関資格に合格した同僚）" },
      ng: { required: true, desc: "ng表現を言われた相手が受ける印象・心の声を1〜2文で" },
      native: { required: true, desc: "native表現を言われた相手が受ける印象・心の声を1〜2文で" },
      gap: { desc: "両者の印象差が関係や評価にどう影響しうるかを1文で" },
    } },
  { key: "standard", required: true, type: "object",
    desc: "同僚や普段のやり取りで使う言い方",
    fields: {
      en: { required: true, desc: "英語フレーズ" },
      ja: { required: true, desc: "日本語訳" },
    } },
  { key: "formal", required: true, type: "object",
    desc: "上司や顧客向けの丁寧な言い方",
    fields: {
      en: { required: true, desc: "英語フレーズ" },
      ja: { required: true, desc: "日本語訳" },
    } },
  { key: "sources", type: "object[]",
    desc: "確認に使った辞書。1〜3件",
    fields: {
      name: { required: true, desc: "辞書名" },
      keyword: { desc: "見出し語" },
      url: { desc: "確認できたURL。推測で組み立てない" },
      note: { required: true, desc: "要約。裏付けが取れなければ末尾に（未検証）" },
    } },
];

/** SCHEMA からモデルへ渡すJSON雛形を組み立てる */
export function schemaBlock() {
  const lines = ["{"];
  SCHEMA.forEach((f, i) => {
    const comma = i < SCHEMA.length - 1 ? "," : "";
    if (f.type === "object" || f.type === "object[]") {
      const inner = Object.entries(f.fields)
        .map(([k, v]) => `    "${k}": "${v.desc}"`)
        .join(",\n");
      const open = f.type === "object[]" ? "[{" : "{";
      const close = f.type === "object[]" ? "}]" : "}";
      lines.push(`  "${f.key}": ${open}`, inner, `  ${close}${comma}`);
    } else if (f.type === "string[]") {
      lines.push(`  "${f.key}": ["${f.desc}"]${comma}`);
    } else {
      lines.push(`  "${f.key}": "${f.desc}"${comma}`);
    }
  });
  lines.push("}");
  return lines.join("\n");
}

const filled = (v) => typeof v === "string" && v.trim().length > 0;

/** SCHEMA に照らして足りない項目名を返す。空配列なら妥当。 */
export function missingFields(d) {
  if (!d || typeof d !== "object") return ["(not an object)"];
  const missing = [];
  for (const f of SCHEMA) {
    const v = d[f.key];
    if (f.type === "string[]") {
      if (f.required && (!Array.isArray(v) || !v.some(filled))) missing.push(f.key);
    } else if (f.type === "object") {
      const bad = !v || typeof v !== "object" ||
        Object.entries(f.fields).some(([k, spec]) => spec.required && !filled(v[k]));
      if (f.required && bad) missing.push(f.key);
    } else if (f.type === "object[]") {
      if (f.required && !Array.isArray(v)) missing.push(f.key);
    } else if (f.required && !filled(v)) {
      missing.push(f.key);
    }
  }
  return missing;
}

// ---- Markdown 組み立て ----

const code = (s) => "`" + String(s).replace(/`/g, "'").trim() + "`";
const cell = (s) => String(s).replace(/\|/g, "／").replace(/\s*\n\s*/g, " ").trim();

/** 出典URLが無い場合の検索リンク。推測URLではなく検索クエリを使う。 */
export function dictLink(name, keyword) {
  const q = encodeURIComponent(String(keyword || "").trim());
  if (!q) return "";
  const n = String(name || "");
  if (/英辞郎|アルク|alc/i.test(n)) return "https://eow.alc.co.jp/search?q=" + q;
  if (/cambridge/i.test(n)) return "https://dictionary.cambridge.org/search/direct/?datasetsearch=english&q=" + q;
  if (/merriam/i.test(n)) return "https://www.merriam-webster.com/dictionary/" + q;
  if (/oxford/i.test(n)) return "https://www.oxfordlearnersdictionaries.com/search/english/?q=" + q;
  return "";
}

export function toMarkdown(d, situation) {
  const L = [];
  L.push("**シチュエーション:** " + cell(situation), "", d.lead.trim(), "");

  L.push("### ❌ 日本人がやりがちなNGフレーズ", "");
  const ngList = d.ng_phrases.filter(filled);
  ngList.forEach((p) => L.push("* " + code(p)));

  L.push("", "### 💡 なぜNGなのか？（ニュアンスの解説）", "");
  d.why_ng.trim().split(/\n\s*\n/).forEach((para, i, arr) => {
    L.push(para.trim());
    if (i < arr.length - 1) L.push("");
  });

  const im = d.impression;
  L.push("", "### 🎭 この場面での印象の違い", "");
  if (filled(im.listener)) L.push("聞き手: " + cell(im.listener), "");
  L.push("| 言い方 | 相手が受ける印象 |", "| --- | --- |");
  L.push("| ❌ " + code(cell(ngList[0])) + " | " + cell(im.ng) + " |");
  L.push("| ⭕️ " + code(cell(d.native)) + " | " + cell(im.native) + " |");
  if (filled(im.gap)) L.push("", "**差が生むもの:** " + cell(im.gap));

  L.push("", "### ⭕️ ネイティブが使う自然なOKフレーズ", "");
  L.push("* **Standard（同僚や普段のやり取り）:**", "  * " + code(d.standard.en), "  * 日本語訳: " + d.standard.ja.trim(), "");
  L.push("* **Formal（上司や顧客・丁寧なやり取り）:**", "  * " + code(d.formal.en), "  * 日本語訳: " + d.formal.ja.trim(), "");

  L.push("### 📖 ソース・参考情報", "");
  const src = (d.sources || []).filter((x) => x && filled(x.name));
  const names = [...new Set(src.map((x) => x.name.trim()))];
  L.push("* **出典:** " + (names.length ? names.join(" / ") : "なし"));
  L.push("* **解説:**");
  if (!src.length) L.push("  * 参考情報が得られませんでした。辞書で個別に確認してください。");
  src.forEach((x) => {
    const url = filled(x.url) ? x.url.trim() : dictLink(x.name, x.keyword);
    const label = filled(x.url) ? "出典" : "辞書で確認";
    const kw = x.keyword ? "（見出し語: " + String(x.keyword).trim() + "）" : "";
    L.push("  * **" + x.name.trim() + kw + ":** " + String(x.note || "").trim() + (url ? " [" + label + "](" + url + ")" : ""));
  });

  return L.join("\n") + "\n";
}

/** ファイル名に使えない文字を落とす */
export function safeTitle(t) {
  return String(t).replace(/[\\/:*?"<>|\r\n\t]/g, "").trim().slice(0, 40) || "表現メモ";
}

export const pad3 = (n) => String(n).padStart(3, "0");
