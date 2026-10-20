# Specification Quality Checklist: 三板块工作台与 Agent CLI

**Purpose**: 在进入 plan 前检验 spec 的完整性与质量
**Created**: 2026-10-20
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] CHK001 不含实现细节（语言、框架、API）——技术选择只在 plan/research
- [x] CHK002 聚焦用户价值与原因（每个故事有 Why this priority）
- [x] CHK003 面向非技术读者可读
- [x] CHK004 必填章节齐全（场景、需求、成功标准）

## Requirement Completeness

- [x] CHK005 无 `[NEEDS CLARIFICATION]` 残留（7 问已裁决）
- [x] CHK006 需求可测试且无歧义（FR-101–FR-116 均有对应验收场景或测试任务）
- [x] CHK007 成功标准可度量（SC-101 尺寸误差、SC-102 合并记录一致、SC-103 五条路径）
- [x] CHK008 成功标准与实现无关（以用户可见结果描述）
- [x] CHK009 所有验收场景已定义（US1–US5）
- [x] CHK010 边界情况已识别（非 JSON 行、非零退出、`-` 开头提示词、.cmd 包装、分支已删除、非仓库）
- [x] CHK011 范围有界（PR/CI 显示「暂无」，逐条审批 CLI 工具列为后续）
- [x] CHK012 依赖与假设已列出（git、opencode 1.19.x、字体替代）

## Feature Readiness

- [x] CHK013 每条 FR 有清晰验收标准
- [x] CHK014 用户场景覆盖主流程（导航、看板、Git、CLI 对话、内置 agent 保留）
- [x] CHK015 视觉基准明确（三份 HTML 原型，Figma 补缺）
