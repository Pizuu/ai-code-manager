#!/usr/bin/env bash
# 集成分支名一致性检查（P0-2）：
#   .agents/config.sh 的 INTEGRATION_BRANCH 是唯一权威；工作流与文档中的分支名必须与之一致，
#   否则会出现「PR 合入集成分支却不触发泳道守卫」这类静默失效。
#   1) .github/workflows/lane-guard.yml 的 pull_request 分支列表必须含当前集成分支；
#   2) 该列表里不得残留已废弃的分支名（除非它仍存在于 origin，作为过渡期历史名保留）；
#   3) 关键文档必须以「集成分支」指称当前分支，不得继续写旧的 dev / hark-dev。
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
# shellcheck source=/dev/null
source .agents/config.sh
BRANCH="$INTEGRATION_BRANCH"
fail=0

if [ -z "$BRANCH" ]; then
  echo "✗ .agents/config.sh 未定义 INTEGRATION_BRANCH" >&2
  exit 1
fi

# 1) lane-guard 的触发列表必须含当前集成分支
GUARD=".github/workflows/lane-guard.yml"
if ! grep -q "branches:.*\b$BRANCH\b" "$GUARD"; then
  echo "✗ $GUARD 的 pull_request.branches 不含当前集成分支 $BRANCH：合入 $BRANCH 的 PR 不会触发泳道守卫" >&2
  fail=1
else
  echo "✓ $GUARD 触发分支含 $BRANCH"
fi

# 1b) 触发列表里的历史名若在 origin 已不存在，必须删掉——否则集成分支再次改名时会静默失效
list=$(sed -n 's/^[[:space:]]*branches:[[:space:]]*\[\([^]]*\)\].*/\1/p' "$GUARD" | head -1 | tr ',' ' ')
for b in $list; do
  b=$(echo "$b" | tr -d '[:space:]')
  [ -z "$b" ] && continue
  [ "$b" = "$BRANCH" ] && continue
  if git rev-parse --verify --quiet "refs/remotes/origin/$b" >/dev/null; then
    echo "  · $b 仍存在于 origin，保留为历史名"
  elif git ls-remote --exit-code --heads origin "$b" >/dev/null 2>&1; then
    echo "  · $b 仍存在于 origin，保留为历史名"
  else
    echo "✗ $GUARD 的触发列表含已不存在的分支 $b：集成分支改名后应清理，否则会掩盖配置漂移" >&2
    fail=1
  fi
done

# 2) 关键文档不得把集成分支写成旧名
#    旧名列表来自本仓库历史：dev → hark-dev → manus。
OLD_NAMES="dev hark-dev"
DOCS=(
  "docs/development/multi-agent.md"
  "docs/development/git-workflow.md"
  "docs/commands/integrate.md"
  "docs/agents/coordinator.md"
  "docs/agents/worker.md"
  "AGENTS.md"
)
for f in "${DOCS[@]}"; do
  [ -f "$f" ] || continue
  # 匹配「集成分支 `old`」「合入 `old`」「向 `old` 提 PR」等指称集成分支的写法
  hits=$(grep -nE "(集成分支|合入|向)[^\`]*\`($(echo "$OLD_NAMES" | tr ' ' '|'))\`" "$f" || true)
  if [ -n "$hits" ]; then
    echo "✗ $f 仍把集成分支写成旧名（当前应为 $BRANCH）：" >&2
    echo "$hits" | sed 's/^/    /' >&2
    fail=1
  else
    echo "✓ $f"
  fi
done

if [ "$fail" -ne 0 ]; then
  echo "集成分支名不一致：请统一改用 $BRANCH（权威来源 .agents/config.sh）。" >&2
  exit 1
fi
echo "集成分支名一致：$BRANCH"
