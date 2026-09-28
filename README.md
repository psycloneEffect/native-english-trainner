# Taka, Biz-English Trainer（ビルド不要版）

ローカル環境不要。GitHubとCloudflareのダッシュボードだけでデプロイできる。

```
public/index.html   画面。React は CDN から読み込むためビルド不要
public/app.js       画面のロジック。JSXの代わりに htm を使用
public/styles.css   スタイル
worker/index.js     APIキーを保持し Claude Messages API を呼ぶ中継
wrangler.jsonc      Worker の設定
```

リクエストの流れ:

```
ブラウザ → POST /api/generate {situation, native, ng}
        → Worker（Secretのキーを付与）→ Claude Messages API + web_search（辞書4サイト限定）
        → JSON を返す → ブラウザで Markdown を組み立ててダウンロード
```

プロンプトは Worker 側にあり、フロントから送るのは3つの値だけ。
そのため、このエンドポイントを汎用のClaude APIプロキシとして使われることはない。

---

## 手順1: GitHubにリポジトリを作る

1. GitHubで新規リポジトリを作成（Privateで可）
2. リポジトリ画面で `.` キーを押すと、ブラウザ内エディタ（github.dev）が開く
3. 上記の5ファイルを同じ階層構造で作成し、内容を貼り付ける
4. 左の「ソース管理」タブからコミットする

ファイルのアップロードだけなら、リポジトリ画面の Add file → Upload files でも良い。

## 手順2: Claude側の準備

1. Claude Console（platform.claude.com）でAPIキーを発行する
2. **Spend Limit を設定する**（月10ドルなど低めで構わない）

web search はAPIでは既定で有効。管理者が無効化していない限り、設定は不要。

## 手順3: Cloudflareにデプロイ

1. Cloudflareダッシュボード → Workers & Pages → Create
2. 「Import a repository」を選び、GitHubアカウントを連携して対象リポジトリを選択
3. ビルド設定
   - Build command: **空のまま**（ビルド不要）
   - Deploy command: `npx wrangler deploy`（既定値のままで良い）
4. デプロイを実行

以降、GitHubにコミットするたび自動で再デプロイされる。

## 手順4: APIキーを登録する

1. デプロイしたWorkerの Settings → Variables and Secrets
2. Add → Type に **Secret** を選択
3. Variable name: `ANTHROPIC_API_KEY` / Value: 発行したキー
4. 保存してデプロイし直す（Deployments → 最新のものを Retry でも良い）

`MODEL` と `REQUIRE_ACCESS` は `wrangler.jsonc` に平文で持つ通常の変数なので、こちらに入れない。

## 手順5: アクセス制限（デプロイ直後に必ず行う）

この時点では、URLを知っていれば誰でもAPIクレジットを消費できる。

1. ダッシュボード → Zero Trust（初回はチーム名の設定が必要）
2. Access → Applications → Add an application → Self-hosted
3. 対象にこのWorkerのドメインを指定
4. ポリシーで自分のメールアドレスのみ許可
5. 動作確認後、`wrangler.jsonc` の `REQUIRE_ACCESS` を `"true"` にしてコミット

注意: `REQUIRE_ACCESS` のチェックはヘッダの存在確認のみで、JWTの署名検証はしていない。
本来の防御線は Access のポリシー側にある。

`workers.dev` のサブドメインにAccessを直接適用できるかは未確認。
適用できない場合は、Cloudflareで管理しているドメインのサブドメインにWorkerのルートを割り当て、そちらに適用する。

---

## カスタマイズ

| 目的                   | 変更箇所                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------- |
| モデル変更             | `wrangler.jsonc` の `vars.MODEL`                                                      |
| 講師の口調・出典ルール | `worker/index.js` の `SYSTEM_PROMPT`                                                  |
| 出力項目の追加         | `worker/index.js` の `buildUserPrompt` 内のJSON定義 → `public/app.js` の `toMarkdown` |
| Markdownの体裁         | `public/app.js` の `toMarkdown`                                                       |
| 検索対象の辞書         | `worker/index.js` の `DICT_DOMAINS`                                                   |

## 制約

- TypeScriptの型チェックとJSXは使えない（ビルドを無くしたトレードオフ）。
- 連番はブラウザのlocalStorage保存のため、端末をまたぐと共有されない。
  共有したい場合は Workers KV に現在値を持たせる。
- CDN（cdnjs / jsDelivr）が落ちると画面が動かない。これを避けるなら、
  React等を `public/vendor/` に配置して相対パスで読み込む。
