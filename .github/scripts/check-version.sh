#!/usr/bin/env bash
# PR の版チェック。main（比較元）と比べて、版の扱いが規則どおりかを確かめる。
#
#   1. worker/index.js の WORKER_VERSION と public/app.js の APP_VERSION が一致している
#   2. 版が x.y.z の形をしている
#   3. CHANGELOG.md にその版の節（## [x.y.z]）がある
#   4. 配信されるコード（worker/ と public/）を変えたなら、版を上げている
#   5. 版を上げたなら、比較元より大きく、まだタグが存在しない
#
# 使い方: check-version.sh <比較元の ref>   例: check-version.sh origin/main
set -euo pipefail

BASE="${1:?比較元の ref を指定してください（例: origin/main）}"
fail=0
err() { echo "::error::$*"; fail=1; }
ok()  { echo "OK: $*"; }

version_in() { # $1: ref（空なら作業ツリー）, $2: ファイル, $3: 定数名
  local src
  if [ -z "$1" ]; then src=$(cat "$2"); else src=$(git show "$1:$2" 2>/dev/null || true); fi
  grep -oP "$3 = \"\\K[^\"]+" <<<"$src" | head -n1 || true
}

WORKER=$(version_in "" worker/index.js WORKER_VERSION)
APP=$(version_in "" public/app.js APP_VERSION)
BASE_V=$(version_in "$BASE" worker/index.js WORKER_VERSION)

echo "この PR: WORKER_VERSION=${WORKER:-なし} / APP_VERSION=${APP:-なし}"
echo "比較元:  WORKER_VERSION=${BASE_V:-なし}（$BASE）"

# 1. 定数の一致
if [ -z "$WORKER" ] || [ -z "$APP" ]; then
  err "版の定数が見つかりません（worker/index.js の WORKER_VERSION、public/app.js の APP_VERSION）"
elif [ "$WORKER" != "$APP" ]; then
  err "WORKER_VERSION ($WORKER) と APP_VERSION ($APP) が一致していません。両方を同じ値にしてください"
else
  ok "2つの定数が一致（$WORKER）"
fi
V="$WORKER"

# 2. 形式
if [ -n "$V" ] && ! [[ "$V" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  err "版 $V が x.y.z の形ではありません"
fi

# 3. CHANGELOG の節
if [ -n "$V" ]; then
  if grep -qF "## [$V]" CHANGELOG.md; then
    ok "CHANGELOG.md に ## [$V] がある"
  else
    err "CHANGELOG.md に ## [$V] の節がありません"
  fi
fi

# 4. コードを変えたのに版が据え置き
changed=$(git diff --name-only "$BASE"...HEAD -- worker public || true)
if [ -n "$changed" ] && [ "$V" = "$BASE_V" ]; then
  err "配信されるコードが変わっていますが、版が $V のままです。変更したファイル:"
  echo "$changed" | sed 's/^/  - /'
elif [ -n "$changed" ]; then
  ok "コードの変更に合わせて版が上がっている（$BASE_V → $V）"
else
  ok "配信されるコードの変更なし（版の据え置きで問題なし）"
fi

# 5. 上げた版が正しい向きで、未使用である
if [ -n "$V" ] && [ -n "$BASE_V" ] && [ "$V" != "$BASE_V" ]; then
  if [ "$(printf '%s\n%s\n' "$BASE_V" "$V" | sort -V | tail -n1)" != "$V" ]; then
    err "版が下がっています（$BASE_V → $V）"
  fi
  if git ls-remote --exit-code --tags origin "refs/tags/v$V" >/dev/null 2>&1; then
    err "タグ v$V は既に存在します。公開済みの版は使い回せないので、次の番号にしてください"
  else
    ok "v$V はまだ使われていない"
  fi
fi

exit "$fail"
