/* Native Biz-English Trainer — フロントエンド（ビルド不要）
   React は UMD、JSX の代わりに htm を使う。 */
(function () {
  const { useState, useRef, useMemo } = React;
  const html = htm.bind(React.createElement);
  const NO_KEY = "taka-next-no";

  /** 画面側のバージョン。worker/index.js の WORKER_VERSION と対で更新する。 */
  const APP_VERSION = "0.4.0";

  // ---------- 連番 ----------
  function loadNo() {
    try {
      const v = parseInt(localStorage.getItem(NO_KEY), 10);
      return Number.isFinite(v) && v > 0 && v <= 999 ? v : 1;
    } catch (e) {
      return 1;
    }
  }
  function saveNo(n) {
    try { localStorage.setItem(NO_KEY, String(n)); } catch (e) { /* プライベートモード等 */ }
  }
  const pad3 = (n) => String(n).padStart(3, "0");
  const safeTitle = (t) =>
    String(t).replace(/[\\/:*?"<>|\r\n\t]/g, "").trim().slice(0, 40) || "表現メモ";

  // ---------- Markdown 組み立て ----------
  const code = (s) => "`" + String(s).replace(/`/g, "'").trim() + "`";
  const cell = (s) => String(s).replace(/\|/g, "／").replace(/\s*\n\s*/g, " ").trim();

  /** 出典URLが無い場合の検索リンク。推測URLではなく検索クエリを使う。 */
  function dictLink(name, keyword) {
    const q = encodeURIComponent(String(keyword || "").trim());
    if (!q) return "";
    const n = String(name || "");
    if (/英辞郎|アルク|alc/i.test(n)) return "https://eow.alc.co.jp/search?q=" + q;
    if (/cambridge/i.test(n)) return "https://dictionary.cambridge.org/search/direct/?datasetsearch=english&q=" + q;
    if (/merriam/i.test(n)) return "https://www.merriam-webster.com/dictionary/" + q;
    if (/oxford/i.test(n)) return "https://www.oxfordlearnersdictionaries.com/search/english/?q=" + q;
    return "";
  }

  function toMarkdown(d, situation) {
    const L = [];
    L.push("**シチュエーション:** " + cell(situation), "", d.lead.trim(), "");

    L.push("### ❌ 日本人がやりがちなNGフレーズ", "");
    const ngList = d.ng_phrases.filter((p) => typeof p === "string" && p.trim());
    ngList.forEach((p) => L.push("* " + code(p)));

    L.push("", "### 💡 なぜNGなのか？（ニュアンスの解説）", "");
    d.why_ng.trim().split(/\n\s*\n/).forEach((para, i, arr) => {
      L.push(para.trim());
      if (i < arr.length - 1) L.push("");
    });

    const im = d.impression;
    L.push("", "### 🎭 この場面での印象の違い", "");
    if (im.listener && im.listener.trim()) L.push("聞き手: " + cell(im.listener), "");
    L.push("| 言い方 | 相手が受ける印象 |", "| --- | --- |");
    L.push("| ❌ " + code(cell(ngList[0])) + " | " + cell(im.ng) + " |");
    L.push("| ⭕️ " + code(cell(d.native)) + " | " + cell(im.native) + " |");
    if (im.gap && im.gap.trim()) L.push("", "**差が生むもの:** " + cell(im.gap));

    L.push("", "### ⭕️ ネイティブが使う自然なOKフレーズ", "");
    L.push("* **Standard（同僚や普段のやり取り）:**", "  * " + code(d.standard.en), "  * 日本語訳: " + d.standard.ja.trim(), "");
    L.push("* **Formal（上司や顧客・丁寧なやり取り）:**", "  * " + code(d.formal.en), "  * 日本語訳: " + d.formal.ja.trim(), "");

    L.push("### 📖 ソース・参考情報", "");
    const src = (d.sources || []).filter((x) => x && typeof x.name === "string" && x.name.trim());
    const names = [...new Set(src.map((x) => x.name.trim()))];
    L.push("* **出典:** " + (names.length ? names.join(" / ") : "なし"));
    L.push("* **解説:**");
    if (!src.length) L.push("  * 参考情報が得られませんでした。辞書で個別に確認してください。");
    src.forEach((x) => {
      const url = (x.url && x.url.trim()) || dictLink(x.name, x.keyword);
      const label = x.url && x.url.trim() ? "出典" : "辞書で確認";
      const kw = x.keyword ? "（見出し語: " + String(x.keyword).trim() + "）" : "";
      L.push("  * **" + x.name.trim() + kw + ":** " + String(x.note || "").trim() + (url ? " [" + label + "](" + url + ")" : ""));
    });

    return L.join("\n") + "\n";
  }

  // ---------- エラー文言 ----------
  const ERR = {
    unauthorized: "認証が必要です。ページを再読み込みしてログインし直してください。",
    invalid_input: "シチュエーションと、つい言ってしまう表現を入力してください。",
    rate_limited: "APIの利用上限に達しました。時間を置いて再実行してください。",
    invalid_json: "生成結果の形式が不正でした。もう一度Askしてください。",
    empty_completion: "回答が空でした。入力を見直してください。",
    server_misconfigured: "サーバー側にAPIキーが設定されていません。",
    upstream_error: "Claude APIの呼び出しに失敗しました。",
  };

  // ---------- 部品 ----------
  /** ヒーロー。NGの吹き出しとOKの吹き出しが入れ替わる様子を示す */
  function Hero() {
    return html`<svg class="art" viewBox="0 0 96 96" width="96" height="96" role="img"
      aria-label="NGの吹き出しがOKの吹き出しに変わる様子">
      <path d="M6 14h52a6 6 0 0 1 6 6v22a6 6 0 0 1-6 6H26l-12 10V48H6a6 6 0 0 1-6-6V20a6 6 0 0 1 6-6z"
        transform="translate(4 2)" fill="var(--ng-soft)" stroke="var(--ng)" stroke-width="2.5" stroke-linejoin="round" />
      <line x1="16" y1="26" x2="52" y2="38" stroke="var(--ng)" stroke-width="3" stroke-linecap="round" />
      <path d="M38 44h46a6 6 0 0 1 6 6v24a6 6 0 0 1-6 6H62L50 92V80H38a6 6 0 0 1-6-6V50a6 6 0 0 1 6-6z"
        fill="var(--leaf-soft)" stroke="var(--leaf)" stroke-width="2.5" stroke-linejoin="round" />
      <path d="M48 62l8 8 16-16" fill="none" stroke="var(--leaf)" stroke-width="4"
        stroke-linecap="round" stroke-linejoin="round" />
    </svg>`;
  }

  /** 入力欄の右端に出るクリアボタン */
  function ClearButton(props) {
    if (!props.show) return null;
    return html`<button type="button" class="clear-btn" aria-label=${props.label + "を消す"}
      onClick=${(e) => { e.preventDefault(); props.onClear(); }}>✕</button>`;
  }

  // ---------- 画面 ----------
  function App() {
    const [situation, setSituation] = useState("");
    const [native, setNative] = useState("");
    const [ng, setNg] = useState("");
    const [no, setNo] = useState(loadNo);
    const [noText, setNoText] = useState(() => pad3(loadNo()));
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState({ text: "", err: false });
    const [output, setOutput] = useState(null);
    const [view, setView] = useState("preview");
    const [apiVersion, setApiVersion] = useState(null);
    const ctlRef = useRef(null);

    const canAsk = !busy && situation.trim() && ng.trim();

    const preview = useMemo(() => {
      if (!output) return "";
      return DOMPurify.sanitize(marked.parse(output.md))
        .replace(/<table>/g, '<div class="table-scroll"><table>')
        .replace(/<\/table>/g, "</table></div>");
    }, [output]);

    async function ask() {
      const ctl = new AbortController();
      ctlRef.current = ctl;
      setBusy(true);
      setStatus({ text: "辞書を確認しながら書いています…（30秒〜1分ほど）", err: false, busy: true });
      try {
        const res = await fetch("/api/generate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ situation: situation.trim(), native: native.trim(), ng: ng.trim() }),
          signal: ctl.signal,
        });
        const body = await res.json();
        setApiVersion(res.headers.get("x-app-version") || body.version || null);
        if (!res.ok || !body.result) {
          const c = body.error || String(res.status);
          throw new Error((ERR[c] || "エラーが発生しました。") + "（code: " + c + (body.message ? " / " + body.message : "") + "）");
        }
        const md = toMarkdown(body.result, situation.trim());
        setOutput({ md: md, filename: pad3(no) + "_" + safeTitle(body.result.file_title) + ".md" });
        setView("preview");
        setStatus({ text: "", err: false });
      } catch (e) {
        if (e.name === "AbortError") setStatus({ text: "停止しました。", err: false });
        else setStatus({ text: e.message, err: true });
      } finally {
        setBusy(false);
      }
    }

    function download() {
      if (!output) return;
      const blob = new Blob([output.md], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = output.filename;
      a.click();
      URL.revokeObjectURL(url);
      const next = Math.min(no + 1, 999);
      setNo(next);
      saveNo(next);
      setNoText(pad3(next));
      setStatus({ text: output.filename + " を保存しました。次の番号は " + pad3(next) + " です。", err: false });
    }

    return html`
    <div class="wrap">
      <header>
        <${Hero} />
        <div>
          <h1>その一言、相手にはこう聞こえています</h1>
          <p>場面とNG表現を入れると、ネイティブの言い方と受け取られ方の違いを1枚のノートにまとめます。</p>
        </div>
      </header>

      <div class="sheet">
        <label class="field">
          <span>どんなシチュエーションですか？</span>
          <textarea rows="2" value=${situation} onInput=${(e) => setSituation(e.target.value)}
            placeholder="例: 難関資格に苦労して合格した同僚から「I finally passed!」と報告された"></textarea>
          <${ClearButton} show=${!!situation && !busy} label="シチュエーション" onClear=${() => setSituation("")} />
        </label>

        <label class="field ng">
          <span>つい言ってしまう表現</span>
          <input value=${ng} onInput=${(e) => setNg(e.target.value)} placeholder="Oh great." autocomplete="off" spellcheck="false" />
          <${ClearButton} show=${!!ng && !busy} label="NG表現" onClear=${() => setNg("")} />
        </label>

        <label class="field ok">
          <span>ネイティブならこう言う<span class="opt">空欄なら探します</span></span>
          <input value=${native} onInput=${(e) => setNative(e.target.value)} placeholder="" autocomplete="off" spellcheck="false"
            onKeyDown=${(e) => { if (e.key === "Enter" && canAsk) ask(); }} />
          <${ClearButton} show=${!!native && !busy} label="ネイティブ表現" onClear=${() => setNative("")} />
        </label>

        <div class="row">
          <label class="field no" style=${{ marginBottom: 0 }}>
            <span>ファイル番号</span>
            <input type="text" inputmode="numeric" maxlength="3" value=${noText}
              onInput=${(e) => setNoText(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))}
              onBlur=${() => {
                const v = parseInt(noText, 10);
                const n = Number.isFinite(v) && v > 0 ? v : 1;
                setNo(n); saveNo(n); setNoText(pad3(n));
              }} />
          </label>
          <button class="ghost" onClick=${() => { setNo(1); saveNo(1); setNoText("001"); }} disabled=${busy || no === 1}>001に戻す</button>
          <div class="spacer"></div>
          ${busy
            ? html`<button class="ghost" onClick=${() => ctlRef.current && ctlRef.current.abort()}>停止</button>`
            : html`<button onClick=${ask} disabled=${!canAsk}>Ask</button>`}
        </div>

        <div class=${"status" + (status.err ? " err" : "")} role="status" aria-live="polite">
          ${status.busy ? html`<span class="spin"></span>` : null}${status.text}
        </div>
      </div>

      ${apiVersion && apiVersion !== APP_VERSION && html`
      <p class="version-warn">画面 v${APP_VERSION} とサーバー v${apiVersion} の版が一致していません。
        ブラウザの再読み込み（Ctrl+Shift+R）を試してください。</p>`}

      ${output && html`
      <section class="result">
        <div class="result-head">
          <strong class="fname">${output.filename}</strong>
          <div class="tabs">
            <button aria-pressed=${view === "preview"} onClick=${() => setView("preview")}>プレビュー</button>
            <button aria-pressed=${view === "raw"} onClick=${() => setView("raw")}>Markdown</button>
          </div>
        </div>
        <div class="doc">
          ${view === "preview"
            ? html`<div dangerouslySetInnerHTML=${{ __html: preview }}></div>`
            : html`<pre class="raw">${output.md}</pre>`}
        </div>
        <div class="actions">
          <button onClick=${download}>Markdownをダウンロード</button>
          <button class="ghost" onClick=${ask} disabled=${!canAsk}>作り直す</button>
          <button class="ghost" onClick=${() => setOutput(null)} disabled=${busy}>閉じる</button>
        </div>
      </section>`}
      <footer class="ver">v${APP_VERSION}${apiVersion ? " / api " + apiVersion : ""}</footer>
    </div>`;
  }

  ReactDOM.createRoot(document.getElementById("root")).render(html`<${App} />`);
})();
