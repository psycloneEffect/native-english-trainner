# Changelog

形式は [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/)、採番は
[Semantic Versioning](https://semver.org/lang/ja/) に準拠する。

所内限定の内部ツールのため、`1.0.0` までは仕様変更を破壊的変更として扱わない。
`1.0.0` は「ログインとトークン制限が入り、自分以外も常用できる状態」を基準とする。

`0.5.0` が最初にタグを打ったリリース。`0.1.0` から `0.4.0` は開発中の区切りとして
さかのぼって記録したもので、対応するタグは存在しない。

## [Unreleased]

### 追加予定
- ログイン機能（Cloudflare Access のIDをWorkerで参照）
- ユーザー単位のトークン/実行回数の上限（自分以外に適用）
- Claude API 呼び出しのタイムアウト（課題3）

## [0.5.0] - 2026-10-07

### 追加
- `/api/generate` が組み立て済みの `markdown` と `version` を返す（課題2）。
  画面以外のクライアントから叩いても同じ出力が得られる
- 画面とAPIのバージョン表示、および不一致の警告

### 変更
- 出力スキーマ・検証・Markdown組み立てを `public/shared/schema.js` に集約（課題1）。
  項目の追加・変更はこの1ファイルで完結する
- `public/app.js` を ES モジュール化（`<script type="module">`）
- Markdown の組み立てを画面から Worker 側へ移動（課題2）。画面側の組み立ては版ずれ時の保険として残す
- `worker/index.js` を責務ごとに分割（claude.js / prompt.js / input.js / auth.js）。
  index.js はルーティングとレスポンス整形のみを持つ

## [0.4.0] - 2026-10-06

### 追加
- ネイティブ表現の入力を任意化。空欄の場合はモデルが場面に合う表現を選ぶ
- 応答JSONに `native` を追加し、印象比較の表はこの値を使う

### 変更
- 入力欄の順序を「シチュエーション → つい言ってしまう表現 → ネイティブならこう言う」に変更

## [0.3.0] - 2026-10-06

### 追加
- 各入力欄のクリアボタン（✕）、結果の「閉じる」ボタン
- 生成中のスピナー表示

### 変更
- UIを緑系・丸ゴシックに全面改訂。NGは赤ではなく橙を使用
- 辞書検索の上限を `MAX_DICTIONARY_LOOKUPS = 2` として定数化（従来5回）

### 修正
- `why_ng` の生の改行で `JSON.parse` が失敗する問題（`invalid_json`）

## [0.2.0] - 2026-10-06

### 追加
- シチュエーション入力欄
- 「🎭 この場面での印象の違い」セクション（NG/OKの受け取られ方を表で対比）

## [0.1.0] - 2026-10-06

### 追加
- Cloudflare Workers への初回デプロイ（静的アセット同梱）
- Claude Messages API + web_search（辞書4サイトに限定）による教材生成
- Markdown のダウンロードと連番付与

[Unreleased]: https://github.com/psycloneEffect/native-english-trainner/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/psycloneEffect/native-english-trainner/releases/tag/v0.5.0
