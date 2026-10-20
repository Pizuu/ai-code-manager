#!/usr/bin/env bash
# 安装 Spec Kit 并在本仓库就地初始化。已存在的 .specify/memory/constitution.md 会被保留。
set -euo pipefail
cd "$(dirname "$0")/.."
command -v uv >/dev/null 2>&1 || { echo "需要 uv：https://docs.astral.sh/uv/" >&2; exit 1; }
command -v specify >/dev/null 2>&1 || uv tool install specify-cli
specify init --here --force --integration codex --script sh --non-interactive
specify extension add bug || true   # 可选：assess → fix → test 修 bug 流程
# Spec Kit 每个项目只有一个活跃集成；其余工具按需追加（需 multi-install safe）：
# specify integration install claude
specify check || true
echo '完成。下一步：在 agent 中运行 $speckit-specify <需求>'
