export type TaskStatus = 'backlog' | 'queued' | 'in_progress' | 'review' | 'archived';
export type Task = {
  id: string;
  title: string;
  description: string;
  acceptance: string;
  status: TaskStatus;
  priority: 'high' | 'normal' | 'low';
  owner: string | null;
  revision: number;
  spec_revision: number;
  claimed_spec: number | null;
  delivery_revision?: number;
  acceptance_archive_run?: string | null;
  progress: string;
  result: string;
  feedback: string;
  updated_at: string;
  created_at: string;
};
export type Agent = {
  id: string;
  alias: string;
  role: string;
  last_seen: string;
  presence?: 'online' | 'offline' | 'unknown';
};
export type Attachment = {
  id: string;
  task_id: string;
  name: string;
  mime: string;
  size: number;
  purpose: 'reference' | 'reproduction' | 'result';
  created_at: string;
  created_by: string;
  caption: string;
  retired_at: string | null;
};
export type AcceptanceCapability = 'command' | 'browser' | 'desktop';
export type AcceptanceCriterion = {
  id: string; label: string; expected: string;
  capability: AcceptanceCapability; objective: boolean; screenshotRequired: boolean;
};
export type AcceptanceConfig = {
  mode: 'manual' | 'automatic'; revision: number; specRevision: number | null;
  approvedBy: string | null; approvedAt: number | null; criteria: AcceptanceCriterion[];
};
export type AcceptanceTarget = {
  kind: AcceptanceCapability; source: string; version: string; sha256: string;
};
export type AcceptanceCheck = {
  id: string; capability: AcceptanceCapability; expected: string;
  status: 'passed' | 'failed' | 'not_run' | 'blocked'; actual: string; steps: string;
  screenshotAttachmentId?: string;
};
export type AcceptanceRun = {
  id: string; revision: number; status: 'waiting' | 'running' | 'completed' | 'cancelled';
  createdAt: number; expiresAt: number; claimedAt: number | null; completedAt: number | null;
  cancelledAt?: number | null; runnerId: string | null; capabilities: AcceptanceCapability[];
  criteria: AcceptanceCriterion[]; reportHash: string | null;
  outcome: { decision: 'eligible_for_auto_archive' | 'advisory_pass' | 'needs_human_review'; reasons: string[] } | null;
  binding: { projectId: string; taskId: string; developerId: string; specRevision: number;
    deliveryRevision: number; criteriaRevision: number; mode: 'manual' | 'automatic'; target: AcceptanceTarget };
  report?: { environment: string; target: AcceptanceTarget; checks: AcceptanceCheck[]; reportAttachmentId: string };
};
export type AcceptanceState = { config: AcceptanceConfig; runs: AcceptanceRun[] };
export type Detail = Task & {
  attachments: Attachment[];
  events: {
    seq: number;
    actor: string;
    kind: string;
    payload: string;
    created_at: string;
  }[];
};
export type Snapshot = {
  capabilities?: {queue?: boolean; acceptance?: boolean};
  project: { id: string; name: string };
  sequence: number;
  tasks: Task[];
  agents: Agent[];
};
export class TaskClient {
  constructor(
    public base: string,
    private token: string,
  ) {
    this.base = base.replace(/\/$/, '');
    if (this.base && !/^https?:\/\//.test(this.base))
      throw Error('服务地址需要http或https');
  }
  private pending = new Set<AbortController>();
  cancelPending() { for (const controller of this.pending) controller.abort(); }
  private async bounded<T>(work: (signal: AbortSignal) => Promise<T>, timeoutMs = 30000): Promise<T> {
    const controller = new AbortController();
    this.pending.add(controller);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try { return await work(controller.signal); }
    catch (error) {
      if (controller.signal.aborted) throw Error(timedOut
        ? '请求超时。写入结果可能已保存，请刷新核对后再操作。'
        : '请求已取消。写入结果可能已保存，请刷新核对后再操作。');
      throw error;
    } finally { clearTimeout(timer); this.pending.delete(controller); }
  }
  async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    return this.bounded(async signal => {
    const response = await fetch(this.base + '/api' + path, {
      ...options,
      signal,
      redirect: 'error',
      headers: {
        Authorization: 'Bearer ' + this.token,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    });
    if (!response.ok) {
      const b = await response.json().catch(() => ({}));
      throw Error(b.error ?? `连接失败 (${response.status})`);
    }
    return response.json() as Promise<T>;
    });
  }
  snapshot() {
    return this.request<Snapshot>('/snapshot');
  }
  detail(id: string) {
    return this.request<Detail>('/tasks/' + id);
  }
  create(body: unknown) {
    return this.request<Detail>('/tasks', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }
  update(id: string, body: unknown) {
    return this.request<Detail>('/tasks/' + id, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  }
  async addFile(
    id: string,
    file: File,
    purpose: string,
    revision: number,
    caption: string,
  ) {
    if (file.size > 10 * 1024 * 1024) throw Error('单个文件不能超过10MB');
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(Error('文件读取失败'));
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.readAsDataURL(file);
    });
    return this.request<Detail>('/tasks/' + id + '/attachments', {
      method: 'POST',
      body: JSON.stringify({
        name: file.name,
        base64,
        purpose,
        revision,
        caption,
      }),
    });
  }
  acceptance(id: string) {
    return this.request<AcceptanceState>('/tasks/' + id + '/acceptance');
  }
  acceptanceAction(id: string, body: Record<string, unknown>) {
    return this.request<{ task: Detail } & AcceptanceState>('/tasks/' + id + '/acceptance', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }
  removeFile(id: string, revision: number) {
    return this.request<Detail>('/attachments/' + id, {
      method: 'DELETE',
      body: JSON.stringify({ revision }),
    });
  }
  async file(id: string) {
    return this.bounded(async signal => {
    const response = await fetch(this.base + '/api/attachments/' + id, {
      headers: { Authorization: 'Bearer ' + this.token },
      signal, redirect: 'error',
    });
    if (!response.ok) throw Error('附件读取失败');
    return response.blob();
    });
  }
  async events(signal: AbortSignal, onChange: () => void) {
    const r = await fetch(this.base + '/api/events', {
      headers: { Authorization: 'Bearer ' + this.token },
      signal, redirect: 'error',
    });
    if (!r.ok || !r.body) throw Error('实时连接中断');
    const reader = r.body.getReader(),
      decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) throw Error('实时连接关闭');
      buf += decoder.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const event = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (event.includes('data:')) onChange();
      }
    }
  }
}
