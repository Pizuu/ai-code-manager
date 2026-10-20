#!/usr/bin/env bash
# 多 agent 并行：每个 agent 一个独立 git worktree。
#   scripts/agent-worktree.sh new  <lane> <task-slug>   创建 worktree + 分支 feat/<lane>/<task-slug>
#   scripts/agent-worktree.sh list                      列出所有 worktree
#   scripts/agent-worktree.sh sync [path]               rebase 到最新集成分支
#   scripts/agent-worktree.sh rm   <lane> <task-slug>   删除 worktree（分支保留）
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
# shellcheck source=/dev/null
source .agents/config.sh
LANES=.agents/lanes.conf
base_ref(){
  if git rev-parse --verify --quiet "origin/$INTEGRATION_BRANCH" >/dev/null; then echo "origin/$INTEGRATION_BRANCH"; else echo "$INTEGRATION_BRANCH"; fi
}
lane_exists(){ grep -Eq "^$1[[:space:]]" "$LANES"; }
cmd="${1:-}"; shift || true
case "$cmd" in
  new)
    lane="${1:?用法: new <lane> <task-slug>}"; slug="${2:?用法: new <lane> <task-slug>}"
    lane_exists "$lane" || { echo "未知泳道: $lane（见 $LANES）" >&2; exit 1; }
    [[ "$slug" =~ ^[a-zA-Z0-9._-]+$ ]] || { echo "task-slug 只能含字母数字 . _ -" >&2; exit 1; }
    busy=$(git worktree list --porcelain | grep -c "^branch refs/heads/$BRANCH_PREFIX/$lane/" || true)
    if [ "$busy" -gt 0 ]; then echo "警告：泳道 $lane 已有在途任务（同一泳道建议串行）" >&2; fi
    total=$(( $(git worktree list | wc -l) - 1 ))
    if [ "$total" -ge "$MAX_PARALLEL" ]; then echo "已达最大并行数 ($MAX_PARALLEL)，先合入或删除旧 worktree" >&2; exit 1; fi
    git fetch --quiet origin "$INTEGRATION_BRANCH" 2>/dev/null || true
    br="$BRANCH_PREFIX/$lane/$slug"; dir="$WORKTREE_DIR/$lane-$slug"
    mkdir -p "$WORKTREE_DIR"
    git worktree add -b "$br" "$dir" "$(base_ref)"
    echo "已创建: $dir  ($br)"
    echo "允许修改: $(grep -E "^$lane[[:space:]]" "$LANES" | cut -d" " -f2-)"
    echo "Spec Kit: cd $dir && export SPECIFY_FEATURE_DIRECTORY=specs/<NNN-feature> SPECIFY_FEATURE_NO_PERSIST=1"
    ;;
  list) git worktree list ;;
  sync)
    dir="${1:-.}"
    git fetch --quiet origin "$INTEGRATION_BRANCH" 2>/dev/null || true
    ( cd "$dir" && git rebase "$(cd "$ROOT" && base_ref)" )
    ;;
  rm)
    lane="${1:?}"; slug="${2:?}"
    git worktree remove "$WORKTREE_DIR/$lane-$slug"
    ;;
  *) sed -n "2,7p" "$0"; exit 1 ;;
esac
