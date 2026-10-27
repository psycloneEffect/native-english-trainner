#!/usr/bin/env bash
# 版のタグを付け、MINOR / MAJOR なら Release の下書きを作る。
#
# 対象の版:
#   自動実行（VERSION 未指定）: main にある版のうち、既存の最新タグより新しいものすべて。
#     短時間に複数の版が main に入り、途中の実行が置き換えられても、次の実行がまとめて拾う。
#     最新タグより古い版は対象にしない（タグを付けないと決めた過去の版に、勝手に付けないため）。
#   手動実行（VERSION 指定）: 指定した版だけ。過去の版を後から補うときに使う。
#
# タグを打つコミットの選び方:
#   main の履歴（--first-parent、つまり main に直接載ったコミットとマージ）のうち、
#   その版の定数を2つとも持つコミットを候補にし、ビルド中の候補が無くなるまで待ってから、
#   Workers Builds が成功した最も古い候補に打つ。
#   - タグ名とコードの版が必ず一致する（v0.5.0 のような食い違いが起きない）
#   - ビルドに失敗したコミットには打たない
#   - 版を上げたコミットのビルドが失敗し、同じ版のまま直した場合も、直した方に付く
#
# 途中で失敗したときの復旧:
#   タグを付けた後に下書きの作成が失敗した場合、自動実行ではその版は対象外になる。
#   手動実行で同じ版を指定すると、タグが既にあって下書きが無い MINOR / MAJOR に限り、下書きだけを作る。
#
# 環境変数:
#   VERSION   付ける版（手動実行）。空なら自動実行
#   REPO      owner/repo（Actions では GITHUB_REPOSITORY）
#   GH_TOKEN  gh が使うトークン（contents: write と checks: read が必要）
#   DRY_RUN   1 にすると、何を作るかを表示するだけで何も作らない
#   TIMEOUT   ビルドの完了を待つ秒数（既定 1500）
set -euo pipefail

REPO="${REPO:-${GITHUB_REPOSITORY:?REPO を指定してください}}"
TIMEOUT="${TIMEOUT:-1500}"
BRANCH="${BRANCH:-origin/main}"
DRY_RUN="${DRY_RUN:-0}"
SEMVER='^[0-9]+\.[0-9]+\.[0-9]+$'

version_at() { git show "$1:$2" 2>/dev/null | grep -oP "$3 = \"\\K[^\"]+" | head -n1 || true; }
gt() { [ "$1" != "$2" ] && [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | tail -n1)" = "$1" ]; }
tag_exists() { git ls-remote --exit-code --tags origin "refs/tags/v$1" >/dev/null 2>&1; }
release_exists() { # 下書きも含めて探す
  [ -n "$(gh api "repos/$REPO/releases" --paginate --jq ".[] | select(.tag_name == \"v$1\") | .id")" ]
}
build_status() { # 最新の Workers Builds の "status conclusion"、無ければ "none -"
  gh api "repos/$REPO/commits/$1/check-runs" \
    --jq '[.check_runs[] | select(.name | startswith("Workers Builds"))] | sort_by(.started_at) | last
          | if . == null then "none -" else "\(.status) \(.conclusion // "-")" end'
}

HEAD_SHA=$(git rev-parse "$BRANCH")
HEAD_V=$(version_at "$HEAD_SHA" worker/index.js WORKER_VERSION)
mapfile -t MAIN_COMMITS < <(git rev-list --first-parent --reverse "$BRANCH")

create_draft() { # $1: 版
  local v="$1" notes
  notes=$(mktemp)
  # 本文はタグ対象のコミットではなく main の最新の CHANGELOG から取る。
  # 過去の版を補うとき、対象のコミットの時点では節がまだ書かれていないことがあるため。
  git show "$BRANCH:CHANGELOG.md" 2>/dev/null \
    | awk -v v="$v" 'index($0, "## [" v "]") == 1 {on=1; next} on && /^## \[/ {exit} on {print}' > "$notes" || true
  [ -s "$notes" ] || echo "CHANGELOG.md に $v の節が見つかりませんでした。" > "$notes"
  if [ "$DRY_RUN" = "1" ]; then
    echo "  [DRY_RUN] Release の下書きを作る。本文の先頭:"; head -n 4 "$notes" | sed 's/^/    /'
    return 0
  fi
  gh release create "v$v" --repo "$REPO" --verify-tag --draft --title "v$v" --notes-file "$notes"
  echo "  Release の下書きを作成。タイトルを整えてから公開してください"
}

# 戻り値: 0 = 完了または対象外、1 = 失敗
process() {
  local v="$1" mode="$2" patch="${1##*.}"
  echo "== v$v（${mode}）"
  [[ "$v" =~ $SEMVER ]] || { echo "::error::版 '$v' が x.y.z の形ではありません"; return 1; }

  if tag_exists "$v"; then
    # 手動実行に限り、下書きの作成だけが失敗していた MINOR / MAJOR を直す
    if [ "$mode" = manual ] && [ "$patch" = 0 ] && ! release_exists "$v"; then
      echo "  タグはあるが下書きが無いので、下書きだけを作る"
      create_draft "$v"
    else
      echo "  タグは既にあるので何もしない"
    fi
    return 0
  fi

  local -a cands=()
  local c
  for c in "${MAIN_COMMITS[@]}"; do
    [ "$(version_at "$c" worker/index.js WORKER_VERSION)" = "$v" ] || continue
    [ "$(version_at "$c" public/app.js APP_VERSION)" = "$v" ] || continue
    cands+=("$c")
  done
  if [ "${#cands[@]}" -eq 0 ]; then
    echo "::error::$BRANCH に、版 $v の定数を2つとも持つコミットがありません"
    return 1
  fi

  # ビルド中の候補が無くなるまで待つ。チェックがまだ無い "none" は、main の先頭だけ待つ
  # （古いコミットでチェックが無いのは、当時ビルドが無かったため。待っても来ない）
  local -A st=()
  local waited=0 pending
  while :; do
    pending=0
    for c in "${cands[@]}"; do
      st[$c]=$(build_status "$c")
      case "${st[$c]}" in
        completed*) ;;
        none*) [ "$c" = "$HEAD_SHA" ] && pending=1 ;;
        *) pending=1 ;;
      esac
    done
    [ "$pending" = 0 ] && break
    if [ "$waited" -ge "$TIMEOUT" ]; then echo "  ビルド待ちが ${TIMEOUT} 秒を超えたので、現時点の結果で判断する"; break; fi
    echo "  ビルド待ち（${waited}秒経過）"; sleep 20; waited=$((waited + 20))
  done

  local target=""
  for c in "${cands[@]}"; do
    echo "  ${c:0:7}: ${st[$c]}"
    if [ -z "$target" ] && [ "${st[$c]}" = "completed success" ]; then target="$c"; fi
  done

  if [ -z "$target" ]; then
    if [ "$mode" = auto ] && [ "$v" != "$HEAD_V" ]; then
      # 新しい版で置き換えられた版。動いたことが無いので、タグは付けずに先へ進む
      echo "::warning::v$v はビルドが成功したコミットが無く、新しい版で置き換えられているのでタグを付けない"
      return 0
    fi
    echo "::error::v$v の定数を持つコミットのうち、Workers Builds が成功したものがありません"
    return 1
  fi

  echo "  タグを付けるコミット: $(git log -1 --format='%h %s' "$target")"
  if [ "$DRY_RUN" = "1" ]; then
    echo "  [DRY_RUN] タグ v$v → ${target:0:7}"
  else
    git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" \
      tag -a "v$v" "$target" -m "v$v"
    git push origin "refs/tags/v$v"
    echo "  タグ v$v を付けた"
  fi

  # PATCH はタグのみ。MINOR / MAJOR は下書きを作り、人が内容を確認して公開する
  if [ "$patch" = 0 ]; then create_draft "$v"; else echo "  PATCH なので Release は作らない"; fi
}

# 対象の版を決める
if [ -n "${VERSION:-}" ]; then
  MODE=manual
  VERSIONS=("$VERSION")
else
  MODE=auto
  LATEST=$(git ls-remote --tags --refs origin 'refs/tags/v*' | sed 's#.*refs/tags/v##' | grep -E "$SEMVER" | sort -V | tail -n1 || true)
  echo "既存の最新タグ: ${LATEST:+v}${LATEST:-なし}"
  mapfile -t VERSIONS < <(
    for c in "${MAIN_COMMITS[@]}"; do version_at "$c" worker/index.js WORKER_VERSION; done \
      | grep -E "$SEMVER" | sort -uV \
      | while read -r v; do if [ -z "$LATEST" ] || gt "$v" "$LATEST"; then echo "$v"; fi; done
  )
fi

if [ "${#VERSIONS[@]}" -eq 0 ]; then
  echo "最新タグより新しい版は無い。何もしない"
  exit 0
fi
echo "対象: ${VERSIONS[*]}"

failed=0
for v in "${VERSIONS[@]}"; do process "$v" "$MODE" || failed=1; done
exit "$failed"
