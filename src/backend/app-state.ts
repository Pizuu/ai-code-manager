/**
 * 主进程运行时状态：当前项目、运行中的会话、待批准请求登记表。
 */
import path from 'node:path';
import type { ApprovalRequest, ProjectInfo } from '../../contracts/ipc.ts';

interface PendingApproval {
  request: ApprovalRequest;
  resolve: (approved: boolean) => void;
}

/** 审批登记表：agent 侧 await request()，渲染进程 agent:approve → resolve()。 */
export class ApprovalRegistry {
  private readonly pending = new Map<string, PendingApproval>();

  request(req: ApprovalRequest): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.pending.set(req.id, { request: req, resolve });
    });
  }

  /** 返回被解析请求的会话 ID；未知 ID 返回 null（可能已因停止而被拒绝）。 */
  resolve(approvalId: string, approved: boolean): string | null {
    const p = this.pending.get(approvalId);
    if (!p) return null;
    this.pending.delete(approvalId);
    p.resolve(approved);
    return p.request.sessionId;
  }

  /** 停止会话时把其全部待批准请求视为拒绝（FR-010）。返回被拒绝的 ID。 */
  rejectAllForSession(sessionId: string): string[] {
    const ids: string[] = [];
    for (const [id, p] of this.pending) {
      if (p.request.sessionId !== sessionId) continue;
      this.pending.delete(id);
      p.resolve(false);
      ids.push(id);
    }
    return ids;
  }

  pendingFor(sessionId: string): ApprovalRequest[] {
    return [...this.pending.values()].filter((p) => p.request.sessionId === sessionId).map((p) => p.request);
  }
}

export class AppState {
  project: ProjectInfo | null = null;
  readonly running = new Map<string, AbortController>();
  readonly approvals = new ApprovalRegistry();
  /**
   * 看板功能（规格）手动选择，按项目根保存（契约 v1.4 board:setFeature）。
   * 无条目 = 自动（最新）。仅运行时内存，不持久化：AppState 本就无落盘机制，
   * 重启后回到自动，与 project / running 等其它运行时状态一致。
   */
  private readonly boardFeatureByRoot = new Map<string, string>();

  /** 该项目手动选择的功能 id；未选择返回 null（= 自动）。 */
  boardFeatureFor(root: string): string | null {
    return this.boardFeatureByRoot.get(root) ?? null;
  }

  /** 记录手动选择；featureId = null 清除选择，回到自动（最新）。 */
  setBoardFeature(root: string, featureId: string | null): void {
    if (featureId === null) this.boardFeatureByRoot.delete(root);
    else this.boardFeatureByRoot.set(root, featureId);
  }

  setProject(root: string | null): ProjectInfo | null {
    this.project = root ? { root, name: path.basename(root) || root } : null;
    return this.project;
  }

  /** 停止会话：中止请求与命令，拒绝待批准项。 */
  stop(sessionId: string): string[] {
    this.running.get(sessionId)?.abort();
    return this.approvals.rejectAllForSession(sessionId);
  }
}
