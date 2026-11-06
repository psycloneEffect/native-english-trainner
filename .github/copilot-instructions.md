# Native Biz-English Trainer のレビュー指示

レビューコメントは日本語で書いてください。

## 構成

Cloudflare Workers と静的アセットで動く社内ツールです。プレーンな JavaScript の ES モジュールで書かれており、TypeScript、JSX、`package.json`、ビルド工程はありません。画面は CDN から読み込む React 18 と `htm` を使います。コミットだけでデプロイできる必要があるので、依存関係やビルド工程を増やす提案はしないでください。

## 重点的に確認すること

- `/api/generate` が受け取る値は `situation`、`ng`、`native` だけです。プロンプト、モデル、API パラメータをクライアントから受け取る変更は、汎用の Claude プロキシになるので指摘してください。
- 秘密情報は Cloudflare Secrets だけに置きます。リポジトリは公開されています。
- 実行回数は Claude を呼ぶ前に消費します。失敗した生成もトークンを使うからです。
- 管理者以外の `/api/generate` は、KV が無ければ `quota_not_configured` で失敗する必要があります。
- 管理者の実行は `DAILY_LIMIT` と `PER_CLIENT_LIMIT` のカウンタを増やしてはいけません。
- プロンプト内の `<input>` の中身は、指示ではなくデータとして扱います。
- 教材の出典に使える URL は、検索で返されたものだけです。辞書の URL を組み立てて出典として見せてはいけません。`dictLink` はラベル付きの検索リンクとしてのみ使います。
- `public/shared/schema.js` は Worker とブラウザの両方で動くので、両方にある API だけを使います。
- 新しい API エラーコードは `{ error: "snake_case_code" }` の形にし、`public/app.js` の `ERR` にメッセージを追加します。
- `worker/index.js` や `public/app.js` など配信されるコードを変えたら、`WORKER_VERSION` と `APP_VERSION` を同じ値に上げ、`CHANGELOG.md` と `README.md` の版も更新します。

## 変更時に確認が要るもの

次の変更は、理由が PR に書かれていなければ指摘してください。

- Worker の `name`。`trainner` の綴りは、Secret を失わないために意図して残しています。綴りの修正を提案しないでください。
- KV の binding 名 `QUOTA` と、localStorage のキー `trainer-next-no`
- `MAX_DICTIONARY_LOOKUPS`、`MAX_CONTINUATIONS`、`max_tokens`、`MAX_INPUT_LEN`、`DICT_DOMAINS`、実行回数の上限を増やす変更。API の費用が増えます。

## 指摘しないこと

次の項目は受け入れ済みの制約です。

- ログイン試行回数の制限がないこと
- KV のカウンタが非アトミックであること
- 共有アカウントが 1 つであること
- 静的アセットがログイン前でも取得できること
- リンターが無いこと、型が無いこと、画面の自動テストが無いこと
