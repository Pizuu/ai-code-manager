#!/usr/bin/env bash
# 泳道越界检查：当前分支相对集成分支改动的文件必须全部落在本泳道内。
#   scripts/check-lane.sh [lane] [branch]   默认从分支名 feat/<lane>/... 推导泳道
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
# shellcheck source=/dev/null
source .agents/config.sh
LANES=.agents/lanes.conf
branch="${2:-${GITHUB_HEAD_REF:-$(git rev-parse --abbrev-ref HEAD)}}"
lane="${1:-}"
if [ -z "$lane" ]; then
  if [[ "$branch" =~ ^$BRANCH_PREFIX/([^/]+)/ ]]; then lane="${BASH_REMATCH[1]}"; else
    echo "分支 $branch 不是 worker 分支（feat/<lane>/...），跳过泳道检查。"; exit 0; fi
fi
line=$(grep -E "^$lane[[:space:]]" "$LANES" || true)
[ -n "$line" ] || { echo "未知泳道: $lane" >&2; exit 1; }
read -r -a pats <<< "${line#* }"
shared_line=$(grep -E "^@shared[[:space:]]" "$LANES" || true)
read -r -a shared <<< "${shared_line#* }"
base="origin/$INTEGRATION_BRANCH"
git rev-parse --verify --quiet "$base" >/dev/null || base="$INTEGRATION_BRANCH"
mb=$(git merge-base "$base" HEAD)
bad=0
set -f
while IFS= read -r f; do
  [ -z "$f" ] && continue
  for s in "${shared[@]}"; do
    if [[ "$f" == $s ]]; then echo "✗ $f  (共享热点文件，只能由 coordinator 修改)"; bad=1; continue 2; fi
  done
  ok=0
  for p in "${pats[@]}"; do
    if [[ "$p" == !* ]]; then if [[ "$f" == ${p:1} ]]; then ok=0; break; fi
    elif [[ "$f" == $p ]]; then ok=1; fi
  done
  if [ "$ok" -eq 1 ]; then echo "✓ $f"; else echo "✗ $f  (不属于泳道 $lane)"; bad=1; fi
done < <(git diff --name-only "$mb"...HEAD)
set +f
if [ "$bad" -ne 0 ]; then
  echo "泳道检查失败：请把越界改动移出本分支，或在 PR 中请 coordinator 处理。" >&2
  exit 1
fi
echo "泳道检查通过: $lane"
