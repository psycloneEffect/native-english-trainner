# 開発者向けドキュメント

Native Biz-English Trainer の構成、デプロイ、設定、版の管理についてまとめる。
利用方法は [README](../README.md)、変更履歴は [CHANGELOG](../CHANGELOG.md) を参照。

ビルドは不要。GitHub と Cloudflare のダッシュボードだけで運用できる。

## 構成

```
public/index.html          画面。React は CDN から読み込むためビルド不要
public/app.js              画面のロジック。JSX の代わりに htm を使用（ES モジュール）
public/styles.css          スタイル
public/shared/schema.js    出力スキーマ・検証・Markdown 組み立ての正本（Worker と画面で共有）
worker/index.js            ルーティングとレスポンス整形
worker/claude.js           Claude API の呼び出し、pause_turn の継続、JSON の取り出し
worker/prompt.js           システムプロンプトと指示文
worker/input.js            リクエストの正規化と検証
worker/auth.js             ログインの検証（共有／管理者）と、署名付き Cookie によるセッション管理
worker/quota.js            KV による日次の実行回数制限
wrangler.jsonc             Worker の設定
.github/workflows/         PR の版チェックと、タグ・Release の自動作成
.github/scripts/           上記ワークフローの中身（手元でも実行できる）
```

リクエストの流れ:

```
ブラウザ → POST /api/generate {situation, ng, native?}
        → Worker（Secret のキーを付与）→ Claude Messages API + web_search（辞書4サイト限定）
        → Worker が Markdown まで組み立てて {result, markdown, version, quota} を返す
        → ブラウザは連番を付けてダウンロード
```

プロンプトは Worker 側にあり、画面から送るのは3つの値だけ。
そのため、このエンドポイントを汎用の Claude API プロキシとして使われることはない。

---

## セットアップ

### 1. Claude 側の準備

1. Claude Console（platform.claude.com）で API キーを発行する
2. **Spend Limit を設定する**（月10ドルなど低めで構わない）

web search は API では既定で有効。管理者が無効化していない限り、設定は不要。

### 2. Cloudflare にデプロイ

1. Cloudflare ダッシュボード → Workers & Pages → Create
2. 「Import a repository」を選び、GitHub アカウントを連携して対象リポジトリを選択
3. ビルド設定
   - Build command: **空のまま**（ビルド不要）
   - Deploy command: `npx wrangler deploy`（既定値のままで良い）
4. デプロイを実行

以降、main にコミットするたび自動で再デプロイされる。

ブランチへのコミットではプレビュー用のビルドが走るが、このリポジトリでは毎回失敗している
（main へのビルドは成功する）。原因は未確定。不要なら Settings → Build で
non-production branch builds を無効にすると、PR に失敗の印が付かなくなる。

### 3. Secret を登録する（必須4件・任意2件）

Worker の Settings → Variables and Secrets → Add → Type に **Secret** を選ぶ。
平文の Variable（`MODEL` など `wrangler.jsonc` が持つもの）とは別物なので間違えないこと。

| Variable name | 中身 |
|---|---|
| `ANTHROPIC_API_KEY` | Claude Console で発行したキー |
| `APP_USERNAME` | 共有アカウントのログインID |
| `APP_PASSWORD` | 共有アカウントのパスワード |
| `SESSION_SECRET` | セッション署名用のランダム文字列（32文字以上） |
| `ADMIN_USERNAME` | （任意）管理者のログインID |
| `ADMIN_PASSWORD` | （任意）管理者のパスワード |

`SESSION_SECRET` は手で考えず、ブラウザのコンソールで
`crypto.randomUUID() + crypto.randomUUID()` を実行した結果を使う。

必須の4件のいずれかが欠けていると、画面に `auth_not_configured` が出て生成できない。

**Secret を変更した後は、リポジトリからのビルドで反映するのが安全。**
ダッシュボードの Deploy ボタンで作られた版で、静的ファイルの `ASSETS` バインディングが
外れ、画面が `TypeError: Cannot read properties of undefined (reading 'fetch')` で
落ちたことがある。Builds から main の最新ビルドを再実行すれば戻る。
wrangler でのデプロイでは、登録済みの Secret はそのまま引き継がれる。

Secret の値はダッシュボードで読み返せない。分からなくなったら新しい値で上書きする。

### 4. 実行回数の上限（KV）

トークンの使われすぎを防ぐため、1日あたりの実行回数に上限を設ける。

1. ダッシュボード → Storage & Databases → KV → Create a namespace
2. 作成された **Namespace ID** を `wrangler.jsonc` の `kv_namespaces` に記入してコミット

**binding は必ず `QUOTA` にする。** ダッシュボードが例示する `KV_BINDING` のままだと、
JSON は正しくても `quota_not_configured` になる。Namespace ID は秘密情報ではない。

上限は `wrangler.jsonc` の `vars` で変える。ダッシュボードで Variable として追加しても、
次のデプロイで `wrangler.jsonc` の内容に上書きされて消える。

| 変数 | 未設定時 | 意味 |
|---|---|---|
| `DAILY_LIMIT` | 30 | 全体の1日あたり上限。財布を守るための値 |
| `PER_CLIENT_LIMIT` | 10 | 端末（接続元IP）ごとの上限。1人が枠を使い切るのを防ぐ |
| `ADMIN_DAILY_LIMIT` | 無制限 | 管理者の1日あたり上限 |

日付の境界は日本時間。カウンタは2日後に自動削除されるので、掃除は不要。

- **カウントは Claude API を呼ぶ前に加算する。** 生成が失敗してもトークンは消費されるため、
  成功時だけ数えると再試行で上限が意味をなさなくなる。
- **KV が未設定だと、共有アカウントは生成できない**（`quota_not_configured`）。
  設定漏れで上限なしに動くより止まる方が安全、という判断。
- **KV は結果整合のため、同時実行で数回ぶん超過しうる。** 厳密な上限が要るなら
  Durable Object に置き換える。ここは桁違いの使われ方を止めるのが目的。
- 端末の区別は接続元IPのハッシュ。共有回線では全員が同じ端末として数えられることがある。

**費用の最終的な歯止めは Claude Console の Spend Limit。** アプリ側の上限と必ず併用すること。

### 5. ログインとセッション

- セッションは署名付き Cookie（`sid`、HttpOnly / Secure / SameSite=Strict）で7日間保持される。
  サーバー側に保存領域を持たない。
- 全員を強制ログアウトさせたいときは `SESSION_SECRET` を別の値に差し替える。
  **パスワードを変えただけでは、発行済みのセッションは切れない。**
- 公開URL（オリジン）が変わると、Cookie も localStorage の連番も引き継がれない。

### 6. 管理者（任意）

開発者自身が上限を受けずに使うための仕組み。

1. Secret に `ADMIN_USERNAME` と `ADMIN_PASSWORD` を登録して、リポジトリから再デプロイ
2. 管理者のIDとパスワードでログインすると、残り回数の位置に金色で
   「管理者（無制限）」または「管理者・本日の残り N 回」（`ADMIN_DAILY_LIMIT` 設定時）と出る

管理者の実行は、全体と端末ごとのどちらのカウンタにも加算されない。
開発中の試行で、他の利用者がその日使える枠を食わないため。

- **管理者のパスワードは、漏れたときの被害が最も大きい。** 共有パスワードとは別の、
  十分に強い値にし、誰にも共有しないこと。
- `ADMIN_*` を共有アカウントと完全に同じ値にすると全員が管理者になるため、
  その場合は管理者ログインを無効として扱う。
- 役割は署名付きのセッションに入るので、`SESSION_SECRET` を知らない限り書き換えられない。
- 0.8.0 より前に発行されたセッションは、共有アカウントとして扱う。

### 既知の制約

- **ログイン試行回数の制限がない。** 総当たり対策はパスワードの強度に依存する。
- **共有アカウントは1つ。** 共有アカウントの利用者同士は区別されない。
- 静的ファイル（画面の JS・CSS）はログイン前でも取得できる。
- TypeScript の型チェックと JSX は使えない（ビルドを無くしたトレードオフ）。
- 連番はブラウザの localStorage に保存するため、端末やブラウザをまたぐと共有されない。
- CDN（cdnjs / jsDelivr）が落ちると画面が動かない。避けるなら React 等を
  `public/vendor/` に置いて相対パスで読み込む。

---

## 版の管理

採番は Semantic Versioning に準拠する。所内限定の内部ツールのため、`1.0.0` までは
仕様変更を破壊的変更として扱わない。

| 変更の種類 | 上げる桁 | 例 |
|---|---|---|
| 互換性のない仕様変更 | MINOR（`1.0.0` 以降は MAJOR） | 出力 Markdown の構成変更 |
| 機能追加、UI 改訂 | MINOR | 管理者ロールの追加 |
| 不具合修正、文言調整 | PATCH | 残り回数表示の修正 |

**配信されるコード（`worker/` と `public/`）を1行でも変えたら、版を上げる。**
版を据え置くと、古い JS を掴んだブラウザと新しい Worker が同じ版を名乗り、
不一致を検知できなくなるため。`wrangler.jsonc` や Secret、ドキュメントだけの変更では上げない。

版は2か所に持ち、**必ず同じ値にする。**

- `worker/index.js` の `WORKER_VERSION`
- `public/app.js` の `APP_VERSION`

画面右下に `v（画面の版） / api（サーバーの版）` が表示され、食い違うと画面上部に警告が出る。

### PR の版チェック（自動）

`.github/workflows/version-check.yml` が PR ごとに次を確かめ、違反があれば PR を失敗にする。

1. 2つの定数が一致している
2. 版が `x.y.z` の形をしている
3. `CHANGELOG.md` にその版の節（`## [x.y.z]`）がある
4. 配信されるコードを変えたなら、版を上げている
5. 上げた版が main より大きく、まだタグが存在しない

手元でも同じものを実行できる: `bash .github/scripts/check-version.sh origin/main`

### タグと Release（自動）

`.github/workflows/release.yml` が、main への反映ごとに動く。

- **対象は、既存の最新タグより新しい版すべて。** 短時間に複数の版が main に入り、
  途中の実行が新しい push に置き換えられても、次の実行がまとめて拾う。
  最新タグより古い版には触れない（タグを付けないと決めた過去の版に、勝手に付けないため）。
- **タグはパッチを含むすべての版に付く。** その版の定数を2つとも持つ main 上のコミットを候補にし、
  ビルド中の候補が無くなるまで待ってから、**Workers Builds が成功した最も古い候補**に付ける。
  タグ名とコードの版が必ず一致し、ビルドに失敗したコミットには付かない。
  版を上げたコミットのビルドが失敗し、同じ版のまま直した場合は、直した方に付く。
- 一度も成功しないまま新しい版に置き換えられた版は、警告を出してタグを付けない。
  main の先頭の版で成功が無い場合は、ジョブを失敗にする。
- **Release は MINOR / MAJOR（`x.y.0`）だけ、下書きで作る。** 本文は CHANGELOG の該当節。
  タイトルは `vx.y.z` になっているので、`vx.y.z - 内容`（英語）の形に整えてから公開する。
  PATCH はタグのみで、内容は CHANGELOG と次の MINOR の Release で伝える。

**手動実行**（Actions タブ → release → Run workflow）では、版を1つ指定する。

- 過去の版を後から補うときに使う。自動実行と同じ規則で、正しいコミットを探してタグを付ける。
  該当するコミットが無ければ失敗する
- タグを付けた後に下書きの作成だけが失敗していた MINOR / MAJOR は、同じ版を指定すると
  下書きだけを作り直す。PATCH や、下書きが既にある版では何もしない

### リリースの手順

1. 作業ブランチで、コードの変更・2つの定数・`CHANGELOG.md` をまとめてコミットする
2. PR を作る。版チェックが通ることを確認する
3. マージする
4. Workers Builds の成功後、タグが自動で付く（MINOR / MAJOR は Release の下書きも）
5. 下書きがあれば、タイトルを整えて公開する

### タグが無い版

`0.1.0` から `0.4.0` と `0.6.0` には対応するコミットが無い、または特定できないため、
タグを付けていない。体裁のために後から付けると、タグの中身がその版にならないので付けない。

`v0.5.0` のタグは `0d89388` を指しているが、そのコミットの版の定数は `0.4.0` のまま。
`0.5.0` の定数を持つ最初のコミットは `ef51a34`。公開済みのタグは付け替えない方針のため、
そのまま残している。

---

## カスタマイズ

| 目的 | 変更箇所 |
|---|---|
| モデル変更 | `wrangler.jsonc` の `vars.MODEL` |
| 講師の口調・出典ルール | `worker/prompt.js` の `SYSTEM_PROMPT` |
| ログイン情報の変更 | Worker の Secret（`APP_USERNAME` / `APP_PASSWORD`）を差し替えて再デプロイ |
| 管理者の有効化・変更 | Worker の Secret（`ADMIN_USERNAME` / `ADMIN_PASSWORD`）を登録・差し替えて再デプロイ |
| 実行回数の上限 | `wrangler.jsonc` の `vars`（`DAILY_LIMIT` / `PER_CLIENT_LIMIT` / `ADMIN_DAILY_LIMIT`） |
| セッションの有効期間 | `worker/auth.js` の `SESSION_TTL_MS` |
| 出力項目の追加 | `public/shared/schema.js` の `SCHEMA`（必要なら `toMarkdown` に出力位置を追記） |
| Markdown の体裁 | `public/shared/schema.js` の `toMarkdown` |
| 検索対象の辞書 | `worker/claude.js` の `DICT_DOMAINS` |

## API

いずれも JSON。`/api/generate` はログイン済みのセッション Cookie を必要とする。

| メソッド | パス | 用途 |
|---|---|---|
| POST | `/api/login` | `{username, password}` を検証し、セッション Cookie を発行。`role` を返す |
| POST | `/api/logout` | セッション Cookie を失効 |
| GET | `/api/session` | `{authenticated, role, version, quota}` を返す |
| POST | `/api/generate` | 教材を生成（要ログイン） |

`POST /api/generate` の入力と出力:

```json
{ "situation": "必須。誰にどんな状況で言うか", "ng": "必須。つい言ってしまう表現", "native": "任意。空ならモデルが選ぶ" }
```

```json
{ "result": { "...": "構造化データ" }, "markdown": "教材本文", "version": "x.y.z", "quota": { "client": 9, "total": 29 } }
```

管理者の `quota` は `{ "admin": true, "remaining": 99 }`（無制限なら `remaining` は `null`）。

Markdown はサーバー側で組み立てるため、画面以外から叩いても同じ出力が得られる。
エラー時は `{ "error": "code", "message": "詳細" }` を返す。

| コード | HTTP | 意味 |
|---|---|---|
| `invalid_body` | 400 | リクエストの本文が JSON ではない |
| `invalid_input` | 400 | 必須の入力が欠けている |
| `unauthorized` | 401 | セッションが無い、または切れている |
| `invalid_credentials` | 401 | ID またはパスワードが違う |
| `not_found` | 404 | 存在しない API |
| `method_not_allowed` | 405 | メソッドが違う |
| `quota_exceeded` | 429 | アプリの上限に到達。`scope` は `total` / `client` / `admin` |
| `rate_limited` | 429 | Claude API 側の利用上限に到達 |
| `auth_not_configured` | 500 | ログイン用の Secret が未設定 |
| `server_misconfigured` | 500 | `ANTHROPIC_API_KEY` が未設定 |
| `quota_not_configured` | 500 | KV が未設定 |
| `invalid_json` | 502 | 生成結果の形式が不正（再実行で通ることが多い） |
| `empty_completion` | 502 | 生成結果が空だった |
| `upstream_error` | 502 | Claude API の呼び出しに失敗 |
