# Changelog

形式は [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/)、採番は
[Semantic Versioning](https://semver.org/lang/ja/) に準拠する。

所内限定の内部ツールのため、`1.0.0` までは仕様変更を破壊的変更として扱わない。
`1.0.0` は「ログインとトークン制限が入り、自分以外も常用できる状態」を基準とする。

## [Unreleased]

### 追加予定
- ログイン機能（Cloudflare Access のIDをWorkerで参照）
- ユーザー単位のトークン/実行回数の上限（自分以外に適用）

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

[Unreleased]: https://github.com/psycloneEffect/native-english-trainner/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/psycloneEffect/native-english-trainner/releases/tag/v0.4.0
[0.3.0]: https://github.com/psycloneEffect/native-english-trainner/releases/tag/v0.3.0
[0.2.0]: https://github.com/psycloneEffect/native-english-trainner/releases/tag/v0.2.0
[0.1.0]: https://github.com/psycloneEffect/native-english-trainner/releases/tag/v0.1.0
