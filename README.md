# Native Biz-English Trainer（ビルド不要版）

ローカル環境不要。GitHubとCloudflareのダッシュボードだけでデプロイできる。

```
public/index.html        画面。React は CDN から読み込むためビルド不要
public/app.js            画面のロジック。JSXの代わりに htm を使用（ESモジュール）
public/styles.css        スタイル
public/shared/schema.js  出力スキーマ・検証・Markdown組み立ての正本（Worker と画面で共有）
worker/index.js          ルーティングとレスポンス整形
worker/claude.js         Claude API の呼び出し、pause_turn の継続、JSON の取り出し
worker/prompt.js         システムプロンプトと指示文
worker/input.js          リクエストの正規化と検証
worker/auth.js           ログインの検証と、署名付きCookieによるセッション管理
worker/quota.js          KVによる日次の実行回数制限
wrangler.jsonc           Worker の設定
```

リクエストの流れ:

```
ブラウザ → POST /api/generate {situation, ng, native?}
        → Worker（Secretのキーを付与）→ Claude Messages API + web_search（辞書4サイト限定）
        → Worker が Markdown まで組み立てて {result, markdown, version} を返す
        → ブラウザは連番を付けてダウンロード
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

## 手順4: Secret を登録する（4件）

いずれも Workerの Settings → Variables and Secrets → Add → Type に **Secret** を選ぶ。
平文の Variable（`MODEL` など `wrangler.jsonc` が持つもの）とは別物なので間違えないこと。

| Variable name | 中身 |
|---|---|
| `ANTHROPIC_API_KEY` | Claude Console で発行したキー |
| `APP_USERNAME` | ログインID |
| `APP_PASSWORD` | ログインパスワード |
| `SESSION_SECRET` | セッション署名用のランダム文字列（32文字以上） |

`SESSION_SECRET` は手で考えず、ランダムに生成した値を使う。ブラウザのコンソールで
`crypto.randomUUID() + crypto.randomUUID()` を実行した結果で足りる。

4件を保存したらデプロイし直す（Deployments → 最新のものを Retry）。
Secret は追加しただけでは実行中のWorkerに反映されない。

いずれかが欠けていると、画面に `auth_not_configured` が出て生成できない。

## 手順5: 実行回数の上限を設定する（KV）

トークンの使われすぎを防ぐため、1日あたりの実行回数に上限を設ける。

1. ダッシュボード → Storage & Databases → KV → Create a namespace
   （名前は `native-english-trainner-quota` など任意）
2. 作成された **Namespace ID** をコピー
3. `wrangler.jsonc` の `kv_namespaces[0].id` に貼ってコミット

Namespace ID は秘密情報ではないので、リポジトリに書いて問題ない。

上限は `wrangler.jsonc` の `vars` で変える。

| 変数 | 既定 | 意味 |
|---|---|---|
| `DAILY_LIMIT` | 30 | 全体の1日あたり上限。財布を守るための値 |
| `PER_CLIENT_LIMIT` | 10 | 端末（接続元IP）ごとの上限。1人が枠を使い切るのを防ぐ |

日付の境界は日本時間。カウンタは2日後に自動削除されるので、掃除は不要。

### 仕様上の注意

- **カウントは Claude API を呼ぶ前に加算する。** 生成が失敗してもトークンは消費される
  ため、成功時だけ数えると再試行で上限が意味をなさなくなる。
- **KVが未設定だと生成できない**（`quota_not_configured`）。設定漏れで上限なしに
  動くより止まる方が安全、という判断。
- **KVは結果整合のため、同時実行で数回ぶん超過しうる。** 厳密な上限が要るなら
  Durable Object に置き換える。ここは桁違いの使われ方を止めるのが目的。
- 利用者の区別は接続元IPのハッシュ。社内の共有回線では全員が同じ端末として
  数えられることがある。その場合は `PER_CLIENT_LIMIT` を上げるか、
  アカウントを利用者ごとに分ける。

**費用の最終的な歯止めは Claude Console の Spend Limit。** この上限はあくまで
アプリ側の防御なので、Console側の設定を必ず併用すること。

## 手順6: ログインの確認

公開URLを開くとログイン画面が出る。手順4で登録したIDとパスワードでログインする。

- セッションは署名付きCookie（`sid`、HttpOnly / Secure / SameSite=Strict）で7日間保持される。
- サーバー側にセッションの保存領域を持たないため、KVなどの追加設定は不要。
- 全員を強制ログアウトさせたいときは `SESSION_SECRET` を別の値に差し替える。
  発行済みのセッションが一斉に無効になる。

### 既知の制約

- **ログイン試行回数の制限がない。** 状態を持たない構成のため、総当たり対策は
  パスワードの強度に依存する。所内限定公開を前提とした割り切り。
- **1アカウントの共有運用。** 誰が実行したかは記録されない。
  利用者ごとのトークン制限を入れる段階で、アカウントを分けるか
  Cloudflare Access の個人IDに切り替える。
- 静的ファイル（画面のJS・CSS）はログイン前でも取得できる。
  秘匿が必要になったら Cloudflare Access を前段に置く。

---

## バージョン管理

現在: **v0.7.0**（変更履歴は [CHANGELOG.md](./CHANGELOG.md)）

採番は Semantic Versioning に準拠する。所内限定の内部ツールのため、`1.0.0` までは
仕様変更を破壊的変更として扱わない。`1.0.0` は「ログインとトークン制限が入り、
自分以外も常用できる状態」とする。

| 変更の種類 | 上げる桁 | 例 |
|---|---|---|
| 出力Markdownの構成変更、互換性のない仕様変更 | MINOR（1.0.0 以降は MAJOR） | 項目の追加・削除 |
| 機能追加、UI改訂 | MINOR | クリアボタンの追加 |
| バグ修正、文言調整、プロンプトの微修正 | PATCH | JSONパースの修正 |

バージョンは2か所に持つ。**必ず同じ値に揃えてコミットすること。**

- `worker/index.js` の `WORKER_VERSION`
- `public/app.js` の `APP_VERSION`

画面右下に `v0.7.0 / api 0.7.0` と表示される。両者が食い違う場合は、
ブラウザが古いJSをキャッシュしているか、デプロイが失敗している。
不一致時は画面上部に警告が出る。

### リリース手順（ブラウザのみ）

1. 2つの定数と `CHANGELOG.md` を更新してコミット
2. Cloudflare のデプロイ完了を確認
3. GitHub の Releases → Draft a new release
4. Choose a tag に `v0.7.0` を入力して「Create new tag」
5. 本文に CHANGELOG の該当節を貼って Publish

タグを打っておくと、デプロイが壊れたときに動作していた時点のZIPをブラウザから取得できる。

---

## カスタマイズ

| 目的 | 変更箇所 |
|---|---|
| モデル変更 | `wrangler.jsonc` の `vars.MODEL` |
| 講師の口調・出典ルール | `worker/prompt.js` の `SYSTEM_PROMPT` |
| ログイン情報の変更 | Worker の Secret（`APP_USERNAME` / `APP_PASSWORD`）を差し替えて再デプロイ |
| セッションの有効期間 | `worker/auth.js` の `SESSION_TTL_MS` |
| 出力項目の追加 | `public/shared/schema.js` の `SCHEMA`（必要なら `toMarkdown` に出力位置を追記） |
| Markdownの体裁 | `public/shared/schema.js` の `toMarkdown` |
| 検索対象の辞書 | `worker/claude.js` の `DICT_DOMAINS` |

## API

いずれも JSON。`/api/generate` はログイン済みのセッションCookieを必要とする。

| メソッド | パス | 用途 |
|---|---|---|
| POST | `/api/login` | `{username, password}` を検証し、セッションCookieを発行 |
| POST | `/api/logout` | セッションCookieを失効 |
| GET | `/api/session` | `{authenticated, version}` を返す |
| POST | `/api/generate` | 教材を生成（要ログイン） |

`POST /api/generate`

```json
{ "situation": "必須。誰にどんな状況で言うか", "ng": "必須。つい言ってしまう表現", "native": "任意。空ならモデルが選ぶ" }
```

```json
{ "result": { "...": "構造化データ" }, "markdown": "教材本文", "version": "0.7.0" }
```

Markdown はサーバー側で組み立てるため、画面以外から叩いても同じ出力が得られる。
エラー時は `{ "error": "code", "message": "詳細" }` を返す。
セッションが無い・切れている場合は 401 と `unauthorized`。

## 制約

- TypeScriptの型チェックとJSXは使えない（ビルドを無くしたトレードオフ）。
- 連番はブラウザのlocalStorage保存のため、端末をまたぐと共有されない。
  共有したい場合は Workers KV に現在値を持たせる。
- CDN（cdnjs / jsDelivr）が落ちると画面が動かない。これを避けるなら、
  React等を `public/vendor/` に配置して相対パスで読み込む。
