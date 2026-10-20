#!/usr/bin/env bash
# 一次性初始化多 agent 协作：git 仓库、集成分支、GitHub 标签。可重复执行。
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=/dev/null
source .agents/config.sh
chmod +x scripts/*.sh 2>/dev/null || true
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git init -b "$MAIN_BRANCH"
  git add -A && git commit -m "chore: scaffold from AI project generator"
fi
if [ "$INTEGRATION_BRANCH" != "$MAIN_BRANCH" ] && ! git rev-parse --verify --quiet "$INTEGRATION_BRANCH" >/dev/null; then
  git branch "$INTEGRATION_BRANCH" "$MAIN_BRANCH"
  echo "已创建集成分支 $INTEGRATION_BRANCH"
fi
if command -v gh >/dev/null 2>&1 && gh repo view >/dev/null 2>&1; then
  mk(){ gh label create "$1" --color "$2" --description "$3" --force >/dev/null && echo "label: $1"; }
  mk "lane:contracts" 0b57d0 "宪法、specs/（spec、plan、tasks）、接口契约、ADR —— 最先合入"
  mk "lane:frontend" 0b57d0 "独占 src/frontend/ 及其测试"
  mk "lane:backend" 0b57d0 "独占 src/backend/ 及其测试"
  mk "lane:docs" 0b57d0 "用户与开发文档（SPEC、契约除外）"
  mk "lane:infra" 0b57d0 "CI、脚本、泳道配置、Spec Kit 工具文件（.specify、各 agent 技能目录）——仅 coordinator 修改"
  mk "status:ready" 2da44e "任务状态"
  mk "status:in-progress" fbca04 "任务状态"
  mk "status:review" a371f7 "任务状态"
  mk "status:blocked" d73a4a "任务状态"
  mk "status:done" 6e7781 "任务状态"
  mk "agent:codex" c5def5 "OpenAI Codex"
  mk "agent:claude" c5def5 "Claude Code"
  mk "contract-change" e99695 "契约变更，需所有使用方审查"
  if [ "$INTEGRATION_BRANCH" != "$MAIN_BRANCH" ]; then git push -u origin "$INTEGRATION_BRANCH" 2>/dev/null || true; fi
else
  echo "未检测到 gh CLI 或远程仓库：跳过标签创建。"
fi
echo "完成。下一步：运行 scripts/speckit-init.sh，然后在 agent 中运行 specify → clarify → plan。"
