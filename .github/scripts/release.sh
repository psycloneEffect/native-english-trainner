#!/usr/bin/env bash
# 版のタグを付け、MINOR / MAJOR なら Release の下書きを作る。
#
# タグを打つコミットの選び方:
#   main の履歴（--first-parent、つまり main に直接載ったコミットとマージ）を古い順にたどり、
#   その版の定数を持つコミットのうち、Workers Builds が最初に成功したものに打つ。
#   - タグ名とコードの版が必ず一致する（v0.5.0 のような食い違いが起きない）
#   - ビルドに失敗したコミットには打たない（「実際に動いた」コミットだけ）
#   - 版を上げたコミットのビルドが失敗し、同じ版のまま直した場合も、直した方に付く
#   最新の候補だけはビルドの完了を待つ。それより古い候補は現在の結果だけを見る。
#
# 環境変数:
#   VERSION   付ける版。省略時は作業ツリーの WORKER_VERSION
#   REPO      owner/repo（Actions では GITHUB_REPOSITORY）
#   GH_TOKEN  gh が使うトークン（contents: write と checks: read が必要）
#   DRY_RUN   1 にすると、選ばれるコミットを表示するだけで何も作らない
#   TIMEOUT   最新の候補のビルドを待つ秒数（既定 1500）
set -euo pipefail

REPO="${REPO:-${GITHUB_REPOSITORY:?REPO を指定してください}}"
TIMEOUT="${TIMEOUT:-1500}"
BRANCH="${BRANCH:-origin/main}"

version_at() { git show "$1:$2" 2>/dev/null | grep -oP "$3 = \"\\K[^\"]+" | head -n1 || true; }

V="${VERSION:-$(grep -oP 'WORKER_VERSION = "\K[^"]+' worker/index.js | head -n1)}"
[[ "$V" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "::error::版 '$V' が x.y.z の形ではありません"; exit 1; }
TAG="v$V"
echo "対象の版: $V"

if git ls-remote --exit-code --tags origin "refs/tags/$TAG" >/dev/null 2>&1; then
  echo "$TAG は既に存在するので何もしません"
  exit 0
fi

# この版の定数を持つ main 上のコミット（古い順）。2つの定数が揃っているものだけ。
mapfile -t CANDIDATES < <(
  for c in $(git rev-list --first-parent --reverse "$BRANCH"); do
    [ "$(version_at "$c" worker/index.js WORKER_VERSION)" = "$V" ] || continue
    [ "$(version_at "$c" public/app.js APP_VERSION)" = "$V" ] || continue
    echo "$c"
  done
)
if [ "${#CANDIDATES[@]}" -eq 0 ]; then
  echo "::error::$BRANCH に、版 $V の定数を持つコミットがありません"
  exit 1
fi
echo "候補: ${#CANDIDATES[@]} 件（${CANDIDATES[*]:0:5}）"

build_status() { # 最新の Workers Builds の "status conclusion"、無ければ "none -"
  gh api "repos/$REPO/commits/$1/check-runs" \
    --jq '[.check_runs[] | select(.name | startswith("Workers Builds"))] | sort_by(.started_at) | last
          | if . == null then "none -" else "\(.status) \(.conclusion // "-")" end'
}

TARGET=""
last="${CANDIDATES[${#CANDIDATES[@]}-1]}"
for c in "${CANDIDATES[@]}"; do
  s=$(build_status "$c")
  if [ "$c" = "$last" ]; then
    waited=0
    while [ "${s%% *}" != "completed" ] && [ "$waited" -lt "$TIMEOUT" ]; do
      echo "  ${c:0:7}: ビルド待ち（$s、${waited}秒経過）"
      sleep 20; waited=$((waited + 20)); s=$(build_status "$c")
    done
  fi
  echo "  ${c:0:7}: $s"
  if [ "$s" = "completed success" ]; then TARGET="$c"; break; fi
done

if [ -z "$TARGET" ]; then
  echo "::error::版 $V の定数を持つコミットのうち、Workers Builds が成功したものがありません。タグは付けません"
  exit 1
fi
echo "タグを付けるコミット: $(git log -1 --format='%h %s' "$TARGET")"

# CHANGELOG のその版の節（次の ## [ の手前まで）を Release 本文に使う。
# 取得元はタグ対象のコミットではなく main の最新。過去の版を補うとき、
# 対象のコミットの時点ではまだ節が書かれていないことがあるため。
NOTES=$(mktemp)
git show "$BRANCH:CHANGELOG.md" 2>/dev/null \
  | awk -v v="$V" 'index($0, "## [" v "]") == 1 {on=1; next} on && /^## \[/ {exit} on {print}' > "$NOTES" || true
[ -s "$NOTES" ] || echo "CHANGELOG.md に $V の節が見つかりませんでした。" > "$NOTES"

PATCH="${V##*.}"
if [ "${DRY_RUN:-0}" = "1" ]; then
  echo "--- DRY_RUN: ここで止める ---"
  echo "タグ: $TAG → ${TARGET:0:7}"
  [ "$PATCH" = "0" ] && echo "Release: 下書きを作成（MINOR / MAJOR のため）" || echo "Release: 作らない（PATCH のため。タグのみ）"
  echo "--- Release 本文の先頭 ---"; head -n 8 "$NOTES"
  exit 0
fi

git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" \
  tag -a "$TAG" "$TARGET" -m "$TAG"
git push origin "refs/tags/$TAG"
echo "タグ $TAG を ${TARGET:0:7} に付けました"

# PATCH はタグのみ。MINOR / MAJOR は下書きを作り、人が内容を確認して公開する
if [ "$PATCH" = "0" ]; then
  gh release create "$TAG" --repo "$REPO" --verify-tag --draft --title "$TAG" --notes-file "$NOTES"
  echo "Release の下書きを作成しました。タイトルを整えてから公開してください"
fi
