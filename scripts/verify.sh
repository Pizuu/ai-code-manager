#!/usr/bin/env bash
# 本地验证：运行本技术栈的真实检查，遇到失败即停。
set -euo pipefail
cd "$(dirname "$0")/.."
echo "==> lint"
npx eslint .
echo "==> typecheck"
npx tsc --noEmit
echo "==> 集成分支名一致性"
bash scripts/check-branch-config.sh
echo "==> test"
npm run test
echo "==> build"
npm run build
echo "==> web 预览冒烟"
node scripts/web-smoke.ts
echo "全部检查通过。"
