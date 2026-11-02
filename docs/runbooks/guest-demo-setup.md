# ゲストデモの構築手順

- 対象読者: このリポジトリの運用者（GitHub と Cloudflare のダッシュボードを操作できる人）
- 前提: [ADR 0001](../adr/0001-guest-access.md) の決定事項。作業はすべてブラウザで完結する
- 所要: フェーズ1〜3が約1時間、フェーズ4（実装）は別途

「要確認」と書いた箇所は、作業時に画面や公式ドキュメントで確認すること。

---

## フェーズ0: 決めておくこと

ADR 0001 の10章の未決事項を決める。最低限、次の3つが決まらないと実装に入れない。

- [ ] リセットの基準（`QUOTA_TZ`）
- [ ] サンプル3件の題材
- [ ] デモの Worker 名（既定: `native-english-trainner-demo`）

## フェーズ1: リポジトリを公開する準備

コードもポートフォリオとして見せる場合だけ行う。デモの公開だけなら非公開のままでよい
（デモの Worker は非公開リポジトリからでもデプロイできる）。

### 1-1. 所内インスタンスを守る（公開前に必須）

デモのURLから workers.dev のサブドメイン（`ai-builds-lab`）が分かるため、
所内インスタンスのURLは隠しても推測できる。そして所内のログインには試行回数の制限がない。

- [ ] 所内インスタンスの前段に Cloudflare Access を置く
      （Worker の Settings → Domains & Routes の workers.dev で有効化できる。要確認）
- [ ] Access を置かない場合は、共有パスワードを長いランダム値に替え、ログイン試行の制限を実装するまで公開を延期する

### 1-2. 履歴の確認

- [ ] Codespaces で履歴全体をスキャンする（例: gitleaks）。
      簡易チェックでは秘密情報らしき文字列は見つかっていないが、網羅的ではない
- [ ] 履歴に残る情報を受け入れられるか確認する
  - コミットの作者名（実名）。メールアドレスは GitHub の noreply なので問題ない
  - 所内インスタンスのURL
  - 開発中のやり取り（コミットメッセージ、PRの本文・コメント）
- [ ] 履歴を残したくない場合は、公開せず「新規リポジトリ方式」（下の補足）に切り替える

### 1-3. 公開の設定

- [ ] `LICENSE` を追加する（コードの再利用を許すか決める。許さないなら「All rights reserved」を README に明記）
- [ ] Settings → Code security で Secret scanning と Push protection を有効にする
- [ ] Settings → Actions → General で、フォークからのPRのワークフロー実行に承認を必須にする
- [ ] Settings → General → Danger Zone → Change visibility → Public
- [ ] 公開後、Security タブで secret scanning の検出が無いことを確認する

### 補足: リポジトリの選び方

| 方式 | 可否 | 理由 |
|---|---|---|
| 元リポジトリを Public にする | 推奨 | 正本が1つのまま。デモも所内向けも同じコードからデプロイできる |
| 新規 Public リポジトリにスナップショットを置く | 可 | 履歴を見せずに済む。ただし2つのリポジトリの同期が永続的な手間になる |
| 元リポジトリをフォークして Public にする | 不可 | 非公開リポジトリのフォークは非公開で、フォークの公開範囲は単独で変えられない |

## フェーズ2: Claude Console

Default Workspace にはワークスペース単位の費用上限を設定できない。

- [ ] ワークスペースを2つ作る（例: `trainer-internal`, `trainer-demo`）
- [ ] それぞれに月額の費用上限を設定する（デモは低め。例: 月5ドル）
- [ ] それぞれのワークスペースでAPIキーを発行する
      （命名例: `anthropic-trainer-internal-prod`, `anthropic-trainer-demo-prod`）
- [ ] 所内インスタンスのキーを差し替える
  1. 所内 Worker の Secret `ANTHROPIC_API_KEY` を新キーに替える
  2. リポジトリからの再デプロイで反映する（ダッシュボードの Deploy ボタンは使わない。過去に `ASSETS` が外れた）
  3. 生成を1回試す
  4. 旧キーを Console で無効化・削除する
- [ ] デモ用のキーは、フェーズ5で Worker を作るまで安全な場所（Secret Manager 等）に保管する

## フェーズ3: Cloudflare のリソース

### 3-1. KV

- [ ] Storage & Databases → KV → Create（名前例: `native-english-trainner-demo-quota`）
- [ ] Namespace ID を控える（秘密情報ではない。`wrangler.jsonc` に書く）

### 3-2. Turnstile

- [ ] Turnstile → Add widget
  - Hostname: デモのURLのホスト名（`native-english-trainner-demo.ai-builds-lab.workers.dev`）
  - Widget mode: Invisible（または Managed）
- [ ] Site key を控える（公開値。`wrangler.jsonc` の `TURNSTILE_SITE_KEY` に書く）
- [ ] Secret key は Secret として扱う（フェーズ5で Worker に登録する）

### 3-3. 鍵の生成

- [ ] `SESSION_SECRET`（デモ用。所内向けとは別の値）
- [ ] `QUOTA_SALT`（デモ用と所内向けで別々の値）

ブラウザのコンソールで `crypto.randomUUID() + crypto.randomUUID()` を実行した結果を使う。
値はチャット・Issue・PRに貼らない。

## フェーズ4: 実装（v0.9.0）

PR を2つに分ける。

### PR-A: リリース自動化の修正（PR #3 のマージ後）

- [ ] `.github/scripts/release.sh` のチェック名の照合を、
      `startswith("Workers Builds")` から完全一致 `"Workers Builds: native-english-trainner"` に変える
      （チェック名の実物を、マージ済みコミットの Checks で確認してから書く）
- [ ] ドキュメントのみの扱いでバージョンは上げない

### PR-B: ゲスト機能

ADR 0001 の7章のとおり。

- [ ] `worker/quota.js`: HMAC 識別子、IPv6 /64、`QUOTA_TZ`、ゲスト用 consume/peek
- [ ] `worker/turnstile.js`、`worker/samples.js`（新規）
- [ ] `worker/auth.js`、`worker/index.js`、`worker/input.js`
- [ ] `public/app.js`、`public/samples/`、`public/privacy.html`
- [ ] `wrangler.jsonc`: `env.demo`（KV の ID、Turnstile の Site key）と所内向けの `QUOTA_TZ`
- [ ] 両定数を `0.9.0` に、`CHANGELOG.md` に節を追加
- [ ] README（使い方）と `docs/DEVELOPMENT.md`（構築・エラーコード）を更新
- [ ] Codespaces で `npx wrangler@4 deploy --dry-run` と `npx wrangler@4 deploy --env demo --dry-run` を実行し、
      両方で `ASSETS` と `QUOTA` が出ることを確認

所内向けの Secret に `QUOTA_SALT` を**マージ前に**登録しておく（未登録なら生成を止める実装にするため）。

サンプル3件は、マージ後に所内インスタンスの管理者で生成し、内容を確認してから
`public/samples/` に入れる別のPR（PATCH）で追加してもよい。

## フェーズ5: デモ Worker の作成

1. [ ] Workers & Pages → Create → Import a repository → 同じリポジトリを選ぶ
2. [ ] 設定
   - Project name: `native-english-trainner-demo`（`wrangler.jsonc` から導かれる名前と一致させる。要確認）
   - Build command: 空
   - Deploy command: `npx wrangler deploy --env demo`
   - Production branch: `main`
3. [ ] 初回デプロイを実行する（Secret 未登録なので、画面は出るが生成はエラーになるのが正常）
4. [ ] Settings → Variables and Secrets に Secret を登録する
   - `ANTHROPIC_API_KEY`（デモ用ワークスペースのキー）
   - `SESSION_SECRET`、`QUOTA_SALT`、`TURNSTILE_SECRET`
   - 管理者を置く場合のみ `ADMIN_USERNAME` / `ADMIN_PASSWORD`（所内向けと別の値）
5. [ ] リポジトリからの再デプロイで Secret を反映する（Deployments の最新を Retry、または空コミット）
6. [ ] 所内 Worker の Workers Builds の設定が変わっていないことを確認する（Deploy command が `npx wrangler deploy` のまま）

## フェーズ6: 動作確認

デモ:

- [ ] トップに「ゲストとして試す」が出て、共有アカウントではログインできない
- [ ] サンプル3件が即時に表示される
- [ ] プリセット入力で生成しても残り回数が減らない
- [ ] 自由入力で生成でき、残り回数が5→4に減る
- [ ] 残り回数とリセット時刻（基準時刻と現地時刻）が表示される
- [ ] 6回目で端末上限のメッセージが出る（別回線、例えばスマホのモバイル回線では残っている）
- [ ] 開発者ツールで `turnstileToken` を消して送ると 403 `turnstile_failed`
- [ ] 注意書きとプライバシー表記へのリンクが出る

所内:

- [ ] ログインと生成が従来どおり動く
- [ ] `/api/guest` が 404
- [ ] 画面右下のバージョンが両インスタンスとも `v0.9.0 / api 0.9.0`

費用:

- [ ] Console のデモ用ワークスペースで、確認中の生成の費用が記録されている
- [ ] 1回あたりの費用を記録し、`GUEST_DAILY_LIMIT` を見直す（目安: 月額上限 ÷ 30 ÷ 1回の費用）

## フェーズ7: リリース

- [ ] Actions → release が `v0.9.0` のタグを打つ（自動。失敗時は Run workflow で `0.9.0` を指定）
- [ ] 下書きのリリースのタイトルを `v0.9.0 - Guest demo mode` にして Publish
- [ ] ADR 0001 の状態を「承認」に変える
- [ ] ポートフォリオにデモのURL（と公開した場合はリポジトリのURL）を載せる

## 運用

- 週1回程度、Console のデモ用ワークスペースの使用額を見る
- 全体上限に毎日達するようなら、上限を上げる前に濫用か本当の需要かを見極める
  （同じ識別子が上限に張り付いている、深夜に集中している、など）
- デモを止めたいときは、デモ Worker の `GUEST_MODE` を `off` にして再デプロイする。
  緊急時は Console でデモ用のキーを無効化すれば、Worker を触らずに即座に止まる
