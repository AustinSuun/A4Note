import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
} from 'react';
import {
  TaskClient,
  type AcceptanceState,
  type Snapshot,
  type Detail,
  type TaskStatus,
  type Task,
} from '../../platform/projectTasks';
import './taskboard.css';
import { TaskStageSwitcher, TaskStageWorkspace } from './TaskStageViews';
import './taskboard-polish.css';
import { tasksForStage, visibleTaskStage, type TaskStage } from './taskStageModel';
import { useTaskStageSession } from './useTaskStageSession';
import { TaskReviewSummary } from './TaskReviewSummary';
import { TaskTitlebarActions } from './TaskTitlebarActions';
import { TaskAgentPromptActions } from './TaskAgentPromptActions';
import { TaskDetailNavigation, TaskEventTimeline, type DetailSection } from './TaskDetailSections';
import {
  loadProjectsPreference,
  isSameProjectPath,
  saveProjectsPreference,
  addManagedProject,
  updateProjectName,
  removeManagedProject,
  setActiveProjectId,
  setSidebarOpenPref,
  type ManagedProject,
  type ProjectsPreferenceData,
} from '../../platform/projectTasksPreference';
import { TaskCreateProjectDialog } from './TaskCreateProjectDialog';
import { TaskProjectSidebar } from './TaskProjectSidebar';
import { TaskShellSidebar } from './TaskShellSidebar';
import { selectProjectFolder } from '../../platform/projectTaskLauncher';
import {TaskDetailDialog} from './TaskDetailDialog';
import {TaskAttachments} from './TaskImageViewer';
import { TaskAcceptancePanel } from './TaskAcceptancePanel';
import { TaskServiceControls } from './TaskServiceControls';
import { TaskBindingGuide } from './TaskBindingGuide';
import {
  savedLocalTaskPort,
  launchLocalTasks,
  supportsLocalTaskLaunch,
} from '../../platform/projectTaskLauncher';
let retainedClient: TaskClient | null = null;
let retainedProjectId: string | null = null;
let retainedServiceId: string | null = null;
const taskColumns: [TaskStatus, string, string][] = [
  ['queued', '任务队列', '已发布，等待 Agent 领取'],
  ['in_progress', '正在进行', '执行 Agent 的工作'],
  ['review', '待检查效果', '由你确认，满意后归档'],
  ['archived', '已归档', '已确认的交付结果'],
];
const time = (v: string) =>
  new Date(v).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
const isAgentStale = (lastSeen?: string) =>
  !!lastSeen && Date.now() - Date.parse(lastSeen) > 120000;
export function TaskBoard({
  defaultServiceUrl = 'http://127.0.0.1:4319',
}: {
  defaultServiceUrl?: string;
}) {
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [editRevision, setEditRevision] = useState<number | null>(null);
  const [acceptance, setAcceptance] = useState<AcceptanceState | null>(null);
  const [detailSection, setDetailSection] = useState<DetailSection>('requirements');
  const sectionScroll = useRef<Partial<Record<DetailSection, number>>>({});
  const changeDetailSection = (next: DetailSection) => {
    const body = document.querySelector<HTMLElement>('.tb-detail-dialog[open] .tb-dialog-body');
    if (body) sectionScroll.current[detailSection] = body.scrollTop;
    setDetailSection(next);
    requestAnimationFrame(() => { if (body?.isConnected) body.scrollTop = sectionScroll.current[next] ?? 0; });
  };
  const [localPort, setLocalPort] = useState(savedLocalTaskPort);
  const [manual, setManual] = useState(false);
  const [projectsState, setProjectsState] = useState<ProjectsPreferenceData>(() =>
    retainedClient ? { ...loadProjectsPreference(), activeProjectId: retainedProjectId } : loadProjectsPreference(),
  );
  const [connectedProjectId, setConnectedProjectId] = useState<string | null>(retainedClient ? retainedProjectId : null);
  const [removingProject, setRemovingProject] = useState<ManagedProject | null>(null);
  const [unsavedSwitchTarget, setUnsavedSwitchTarget] = useState<string | null>(null);
  const activeProjectIdRef = useRef<string | null>(projectsState.activeProjectId);
  activeProjectIdRef.current = projectsState.activeProjectId;

  const activeProject = projectsState.projects.find(
    (p) => p.id === projectsState.activeProjectId,
  ) ?? null;
  const [base, setBase] = useState(retainedClient?.base ?? defaultServiceUrl),
    [token, setToken] = useState(''),
    [client, setClient] = useState<TaskClient | null>(retainedClient),
    [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [detail, setDetail] = useState<Detail | null>(null),
    [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState(''),
    [network, setNetwork] = useState('连接中'),
    [busy, setBusy] = useState(false),
    [showCreate, setShowCreate] = useState(false),
    [editing, setEditing] = useState(false),
    [draft, setDraft] = useState({
      title: '',
      description: '',
      acceptance: '',
      priority: 'normal',
    }),
    [feedback, setFeedback] = useState(''),
    [releaseReason, setReleaseReason] = useState(''),
    [releaseOpen, setReleaseOpen] = useState(false),
    [feedbackOpen, setFeedbackOpen] = useState(false),
    feedbackPanelRef = useRef<HTMLDivElement>(null),
    [purpose, setPurpose] = useState('reference'),
    [caption, setCaption] = useState('');
  const stageSession = useTaskStageSession(snapshot?.project.id ?? '');
  const filter = stageSession.stage, query = stageSession.view.query;
  const setQuery = (query: string) => stageSession.updateView({ query });
  const [reviewDetail, setReviewDetail] = useState<Detail | null>(null);
  const stageContainer = useRef<HTMLDivElement>(null);
  const operationLock = useRef(false);
  useLayoutEffect(() => {
    const area = stageContainer.current?.querySelector<HTMLElement>('.tb-stage-layout, .tb-board');
    if (area) { area.scrollTop = stageSession.view.top; area.scrollLeft = stageSession.view.left; }
  }, [snapshot?.project.id, filter]);
  const previewId = stageSession.view.selectedId;
  /** The review actions live at the end of the scrolling body; reveal the feedback panel when it opens. */
  useEffect(() => {
    if (!feedbackOpen) return;
    const panel = feedbackPanelRef.current;
    if (!panel) return;
    const frame = requestAnimationFrame(() => panel.scrollIntoView({ block: 'nearest' }));
    return () => cancelAnimationFrame(frame);
  }, [feedbackOpen]);
  const previewTask = snapshot?.tasks.find(task => task.id === previewId);
  useEffect(() => {
    setReviewDetail(null);
    if (!client || filter !== 'review' || !previewId || previewTask?.status !== 'review') return;
    let active = true;
    void client.detail(previewId).then(value => {
      if (active && clientRef.current === client) setReviewDetail(value);
    }).catch(() => { if (active) setError('验收详情读取失败，请刷新连接后重试'); });
    return () => { active = false; };
  }, [client, filter, previewId, snapshot?.sequence, previewTask?.status]);
  const supportsQueue = true;
  // The overview is an active-work board. Archived work remains available from
  // the top stage switcher, but is intentionally not a live overview column.
  const overviewColumns = taskColumns.filter(([id]) => id !== 'archived');
  const selectedRef = useRef(selected),
    detailRequest = useRef(0),
    fileInput = useRef<HTMLInputElement>(null);
  selectedRef.current = selected;
  const clientRef = useRef(client);
  clientRef.current = client;
  const loadDetail = useCallback(async (id: string, c: TaskClient) => {
    const n = ++detailRequest.current;
    const d = await c.detail(id);
    if (
      clientRef.current === c &&
      n === detailRequest.current &&
      selectedRef.current === id
    )
      setDetail(old => old?.id === d.id && old.revision > d.revision ? old : d);
    // Acceptance state is optional on older services; never fail the detail view for it.
    try {
      const a = await c.acceptance(id);
      if (clientRef.current === c && n === detailRequest.current && selectedRef.current === id) setAcceptance(a);
    } catch {
      if (clientRef.current === c && n === detailRequest.current) setAcceptance(null);
    }
  }, []);
  const refresh = useCallback(
    async (c: TaskClient) => {
      const s = await c.snapshot();
      if (clientRef.current !== c) return;
      if (retainedServiceId && s.project.id !== retainedServiceId) throw Error('服务项目身份已变化，请断开并重新选择项目。');
      setSnapshot((old) => (!old || s.sequence >= old.sequence ? s : old));
      if (selectedRef.current) await loadDetail(selectedRef.current, c);
    },
    [loadDetail],
  );
  useEffect(() => {
    if (!client) return;
    let active = true;
    const controller = new AbortController();
    const update = () => {
      if (active)
        void refresh(client)
          .then(() => active && setNetwork('已连接'))
          .catch(() => active && setNetwork('服务离线，显示最后快照'));
    };
    update();
    const timer = setInterval(update, 10000);
    void (async () => {
      while (!controller.signal.aborted) {
        try {
          await client.events(controller.signal, update);
        } catch {
          if (!controller.signal.aborted) {
            setNetwork('实时重连中');
            await new Promise((r) => setTimeout(r, 2000));
          }
        }
      }
    })();
    return () => {
      active = false;
      clearInterval(timer);
      controller.abort();
    };
  }, [client, refresh]);
  const run = async (fn: () => Promise<void>) => {
    if (operationLock.current) return;
    operationLock.current = true;
    const source = clientRef.current;
    setError('');
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      if (source && clientRef.current === source) void refresh(source).catch(() => {});
    } finally {
      operationLock.current = false;
      setBusy(false);
    }
  };
  const hasUnsaved = () => editing || !!feedback.trim() || !!caption.trim() ||
    (showCreate && !!(draft.title.trim() || draft.description.trim() || draft.acceptance.trim()));
  const mayLeave = () => !operationLock.current && (!hasUnsaved() || window.confirm('有未保存的编辑、反馈或附件说明。确定放弃并切换？'));
  const clearSelection = () => {
    selectedRef.current = null;
    ++detailRequest.current;
    setSelected(null); setDetail(null); setReviewDetail(null);
    setEditing(false); setFeedback(''); setFeedbackOpen(false); setCaption(''); setShowCreate(false);
  };
  const changeStage = (next: TaskStage) => {
    if (next === filter || !mayLeave()) return;
    clearSelection();
    stageSession.setStage(next);
  };
  const disconnectView = () => {
    clearSelection();
    clientRef.current?.cancelPending();
    clientRef.current = null;
    retainedClient = null; retainedProjectId = null; retainedServiceId = null;
    setClient(null); setSnapshot(null); setConnectedProjectId(null);
    setNetwork('未连接');
  };
  const connectProject = async (project: ManagedProject) => {
    disconnectView();
    activeProjectIdRef.current = project.id;
    setProjectsState(setActiveProjectId(project.id));
    setLocalPort(project.port ?? 4319);
    setNetwork('连接中');
    const connection = await launchLocalTasks(project.port ?? 4319, false, project.path);
    if (!connection || activeProjectIdRef.current !== project.id) return;
    if (!isSameProjectPath(connection.projectRoot, project.path))
      throw Error('启动服务返回的目录与所选项目不同，已阻止连接。请重新选择正确目录。');
    // Directory repair may rebind a saved project to the directory that actually holds
    // its tasks. The root check above proves it is the same project folder, so the new
    // service identity is accepted and persisted below instead of blocking the user.
    const c = new TaskClient(connection.url, connection.operatorToken);
    const me = await c.request<{ role: string }>('/me');
    if (me.role !== 'human') throw Error('看板连接需要项目所有者权限。');
    const next = await c.snapshot();
    if (next.project.id !== connection.projectId)
      throw Error('服务快照与所选项目身份不一致，已阻止加载。');
    if (activeProjectIdRef.current !== project.id) return;
    const port = Number(new URL(connection.url).port);
    const prefs = loadProjectsPreference();
    const updated = { ...prefs, activeProjectId: project.id, projects: prefs.projects.map(p =>
      p.id === project.id ? { ...p, port, serviceProjectId: next.project.id, lastConnected: new Date().toISOString() } : p) };
    saveProjectsPreference(updated); setProjectsState(updated); setLocalPort(port);
    retainedClient = c; retainedProjectId = project.id; retainedServiceId = next.project.id;
    clientRef.current = c;
    setClient(c); setSnapshot(next); setBase(connection.url); setToken('');
    setConnectedProjectId(project.id); setNetwork('已连接');
  };
  const switchProject = (targetId: string, force = false) => {
    if (operationLock.current || (targetId === connectedProjectId && client)) return;
    if (!force && hasUnsaved()) { setUnsavedSwitchTarget(targetId); return; }
    const target = loadProjectsPreference().projects.find(p => p.id === targetId);
    if (target) void run(() => connectProject(target));
  };
  const openProjectPath = async (path: string) => {
    const prefs = loadProjectsPreference();
    const existing = prefs.projects.find(p => isSameProjectPath(p.path, path));
    const result = addManagedProject(path, undefined, existing?.port ?? localPort);
    setProjectsState(result.state);
    await connectProject(result.project);
  };
  const startLocal = (chooseProject = false) => {
    if (!mayLeave()) return;
    return run(async () => {
      if (!supportsLocalTaskLaunch()) throw Error('请在桌面版打开本机项目，或使用手动连接。');
      // Opening always chooses a folder; reconnecting is a separate explicit action.
      if (chooseProject || !activeProject) {
        const path = await selectProjectFolder();
        if (path) await openProjectPath(path);
      } else await connectProject({ ...activeProject, port: localPort });
    });
  };
  const handleAddProject = () => startLocal(true);
  const newProject = () => {
    if (!mayLeave()) return;
    if (!supportsLocalTaskLaunch()) { setError('新建本机项目需要桌面版 A4 Note。'); return; }
    setShowCreateProject(true);
  };
  const connect = () => {
    if (!mayLeave()) return;
    return run(async () => {
      const c = new TaskClient(base, token.trim());
      const me = await c.request<{ role: string }>('/me');
      if (me.role !== 'human') throw Error('看板需要项目所有者连接凭据，Agent请使用命令行或MCP');
      const next = await c.snapshot();
      disconnectView();
      activeProjectIdRef.current = null;
      setProjectsState(p => ({ ...p, activeProjectId: null }));
      retainedClient = c; retainedProjectId = null; retainedServiceId = next.project.id;
      clientRef.current = c;
      setClient(c); setSnapshot(next); setToken(''); setNetwork('已连接');
    });
  };
  const choose = (id: string, section?: DetailSection) => {
    if (!mayLeave()) return;
    stageSession.updateView({ selectedId: id });
    sectionScroll.current = {};
    setAcceptance(null);
    setDetailSection(section ?? (['review', 'archived'].includes(snapshot?.tasks.find(t => t.id === id)?.status ?? '') ? 'evidence' : 'requirements'));
    selectedRef.current = id;
    setSelected(id);
    setDetail(null);
    setEditing(false);
    setFeedback('');
    setReleaseReason('');
    setReleaseOpen(false);
    setFeedbackOpen(false);
    setPurpose('reference');
    setCaption('');
    if (client) void run(() => loadDetail(id, client));
  };
  const action = (kind: string, extra: Record<string, unknown> = {}) =>
    run(async () => {
      if (!client || !detail) return;
      const d = await client.update(detail.id, {
        action: kind,
        revision: detail.revision,
        ...extra,
      });
      if (clientRef.current === client && selectedRef.current === d.id) setDetail(d);
      await refresh(client);
    });
  const releaseStaleTask = () =>
    run(async () => {
      if (!client || !detail) return;
      const reason = releaseReason.trim();
      if (!reason) throw Error('请填写交还原因');
      const d = await client.update(detail.id, { action: 'release_stale', revision: detail.revision, reason });
      if (clientRef.current === client && selectedRef.current === d.id) setDetail(d);
      setReleaseReason(''); setReleaseOpen(false);
      await refresh(client);
    });
  /** Feedback is cleared only after the service accepted the return; a failed request keeps the draft. */
  const requestChanges = () =>
    run(async () => {
      if (!client || !detail) return;
      const d = await client.update(detail.id, { action: 'request_changes', revision: detail.revision, feedback });
      if (clientRef.current === client && selectedRef.current === d.id) setDetail(d);
      setFeedback('');
      setFeedbackOpen(false);
      await refresh(client);
    });
  const addFiles = (files: File[]) =>
    run(async () => {
      if (!client || !detail) throw Error('请先打开一个任务');
      if (detail.status === 'archived') throw Error('已归档任务不可添加附件');
      if (files.length > 10) throw Error('一次最多添加10个文件');
      let d = await client.detail(detail.id);
      for (const file of files) {
        d = await client.addFile(d.id, file, purpose, d.revision, caption);
      }
      if (clientRef.current === client && selectedRef.current === d.id) setDetail(d);
      await refresh(client);
    });
  const paste = (event: ClipboardEvent) => {
    const images = Array.from(event.clipboardData.items)
      .filter((i) => i.kind === 'file' && i.type.startsWith('image/'))
      .map((i) => i.getAsFile())
      .filter((f): f is File => !!f);
    if (images.length) {
      event.preventDefault();
      if (busy) {
        setError('正在上传，请稍后再粘贴');
        return;
      }
      void addFiles(
        images.map(
          (f, i) =>
            new File(
              [f],
              `粘贴图片-${Date.now()}-${i}.${f.type === 'image/jpeg' ? 'jpg' : f.type === 'image/webp' ? 'webp' : 'png'}`,
              { type: f.type },
            ),
        ),
      );
    }
  };
  const closeDetail = () => {
    if (busy) return;
    if ((editing || feedback.trim() || caption.trim()) &&
        !window.confirm('有未保存的编辑、反馈或附件说明。确定放弃并关闭？')) return;
    selectedRef.current = null;
    setSelected(null);
    setDetail(null);
    setEditing(false);
    setFeedback('');
    setFeedbackOpen(false);
    setCaption('');
  };
  const loadAcceptance = async (id: string, c: TaskClient) => {
    try { setAcceptance(await c.acceptance(id)); } catch { setAcceptance(null); }
  };
  const acceptanceAction = (body: Record<string, unknown>, confirm?: string) => run(async () => {
    if (!client || !detail) return;
    if (confirm && !window.confirm(confirm)) return;
    const out = await client.acceptanceAction(detail.id, body);
    setAcceptance({ config: out.config, runs: out.runs });
    await updatePlanView(out.task);
  });
  const updatePlanView = async (next: Detail) => {
    if (selectedRef.current === next.id) setDetail(next);
    if (client) await refresh(client);
  };
  const owner = (id: string | null) =>
    snapshot?.agents.find((a) => a.id === id);
  const filtered = tasksForStage(snapshot?.tasks ?? [], 'all', query, snapshot?.agents ?? []);
  return (
    <section className={client ? "taskboard taskboard--connected" : "taskboard"} aria-label="项目任务看板">
      <div className="tb-body-layout">
        <TaskShellSidebar>
        <TaskProjectSidebar
          projects={projectsState.projects}
          activeProjectId={projectsState.activeProjectId}
          connectedProjectId={network === '已连接' ? connectedProjectId : null}
          sidebarOpen={true}
          isConnecting={busy}
          onToggleSidebar={() => {
            const next = !projectsState.sidebarOpen;
            const updated = setSidebarOpenPref(next);
            setProjectsState(updated);
          }}
          onSelectProject={(id) => switchProject(id)}
          onAddProject={() => void handleAddProject()}
          onCreateProject={newProject}
          onRenameProject={(id, name) => {
            const updated = updateProjectName(id, name);
            setProjectsState(updated);
          }}
          onRequestRemoveProject={(p) => setRemovingProject(p)}
        />
        </TaskShellSidebar>
        <div className="tb-main-content">
          <header className="tb-header">
            <div className="tb-heading">

              <h1>任务</h1>
              <span className="tb-project-name">
                {activeProject?.name ?? snapshot?.project.name ?? '项目协作'}
              </span>
            </div>
        <TaskTitlebarActions>
          {client && <TaskStageSwitcher value={filter} tasks={snapshot?.tasks ?? []} supportsQueue={supportsQueue}
            disabled={busy} onChange={changeStage} />}
          <TaskAgentPromptActions />
          {client && (
            <>
              <button
                className="tb-primary"
                disabled={busy}
                onClick={() => {
                  if (!mayLeave()) return;
                  clearSelection();
                  setDraft({
                    title: '',
                    description: '',
                    acceptance: '',
                    priority: 'normal',
                  });
                  setShowCreate(true);
                }}
              >
                ＋ 新任务
              </button>
            </>
          )}
        </TaskTitlebarActions>
      </header>
      {busy && <div role="status">正在处理请求… <button onClick={() => {
        clientRef.current?.cancelPending();
        setError('已请求取消。写入操作可能已在服务端完成，请刷新核对后再操作，勿直接重复提交。');
      }}>取消等待</button></div>}
      {error && (
        <div className="tb-error" role="alert">
          {error}
          <button aria-label="关闭提示" onClick={() => setError('')}>
            ×
          </button>
        </div>
      )}
      <TaskServiceControls
        connected={!!client}
        boundProject={network === '已连接' ? (activeProject?.name ?? snapshot?.project.name) : undefined}
        boundPort={network === '已连接' ? localPort : undefined}
      />
      {!client ? (
        <div className="tb-connect">
          <div className="tb-connect-icon">▦</div>
          <h2>打开项目，监控任务进度</h2>
          <p>选择要监控的项目文件夹，自动启动该项目的看板服务，供 Agent 连接、领取任务和更新进度。</p>
          <TaskBindingGuide
            connected={!!client}
            projectPath={activeProject?.path}
            port={localPort}
            busy={busy}
            onStart={(choose) => void startLocal(choose)}
          />
          <button
            className="tb-primary tb-start-local"
            disabled={busy || !supportsLocalTaskLaunch()}
            onClick={() => void startLocal(true)}
          >
            {busy ? '正在连接项目…' : '打开项目文件夹并启动看板'}
          </button>
          {supportsLocalTaskLaunch() && <div className="tb-project-entry-actions">
            <button disabled={busy} onClick={newProject}>＋ 新建项目</button>
            {activeProject && <button disabled={busy} onClick={() => void startLocal(false)}>重新连接 {activeProject.name}</button>}
          </div>}
          {activeProject && <p className="tb-project-location">当前选择：{activeProject.path} · {busy ? '连接中' : '未连接，不能读取任务'}</p>}
          <small>
            {supportsLocalTaskLaunch()
              ? '打开项目会弹出文件夹选择器；重新连接会复用上次目录。连接时在AGENTS.md追加Agent接入说明（保留已有规则）；无需打开终端或复制凭据。监控的是 Agent 上报的任务进度，不会自动扫描文件或执行任务。与 Agent 的对话仍在原来的软件中进行。'
              : '当前是浏览器预览，不能启动本机程序。请使用包含此功能的桌面版，或手动连接已有服务。'}
          </small>
          {supportsLocalTaskLaunch() && (
            <details className="tb-local-options">
              <summary>本机项目与端口</summary>
              <label>
                本机服务端口
                <input
                  type="number"
                  min={1024}
                  max={65535}
                  value={localPort}
                  onChange={(e) => setLocalPort(Number(e.target.value))}
                />
              </label>
              <button disabled={busy} onClick={() => void startLocal(true)}>
                打开其他项目并启动看板
              </button>
            </details>
          )}
          <button
            className="tb-manual-toggle"
            disabled={busy}
            onClick={() => setManual(!manual)}
          >
            {manual ? '收起手动连接' : '手动连接 / 远程服务'}
          </button>
          {manual && (
            <>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void connect();
                }}
              >
                <label>
                  服务地址
                  <input
                    value={base}
                    onChange={(e) => setBase(e.target.value)}
                    placeholder="http://127.0.0.1:4319"
                    required
                  />
                </label>
                <label>
                  项目所有者凭据
                  <input
                    type="password"
                    autoComplete="off"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    required
                  />
                </label>
                <button className="tb-primary" disabled={busy}>
                  连接看板
                </button>
              </form>
              <small>
                凭据仅保存在本页内存中。通过本机 cli.mjs access
                获取，不要提交到项目仓库。
              </small>
            </>
          )}
        </div>
      ) : (
        <>
          <nav className="tb-filters" aria-label="任务筛选">

            <input
              aria-label="搜索任务或Agent"
              placeholder="搜索任务或 Agent 代号…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </nav>
          <div className="tb-workspace" ref={stageContainer} onScrollCapture={event => {
            const area = event.target as HTMLElement;
            if (area.classList.contains('tb-stage-layout') || area.classList.contains('tb-board'))
              stageSession.updateView({ top: area.scrollTop, left: area.scrollLeft }, false);
          }}>
            {previewTask && filter !== 'all' && previewTask.status !== filter && <div className="tb-stage-moved" role="status">
              所选任务已流转到其他阶段，旧阶段操作已隐藏。
              <button onClick={() => changeStage(visibleTaskStage(previewTask.status))}>前往任务当前阶段</button>
            </div>}
            <TaskStageWorkspace stage={filter} tasks={snapshot?.tasks ?? []} agents={snapshot?.agents ?? []}
              query={query} supportsQueue={supportsQueue} selectedId={previewId}
              loading={!snapshot} error={network === '服务离线，显示最后快照' ? '服务离线' : ''}
              onClearQuery={() => setQuery('')} onOpen={task => {
                if (filter === 'review') { if (mayLeave()) stageSession.updateView({ selectedId: task.id }); }
                else choose(task.id);
              }}
              renderActions={undefined}
              reviewContent={reviewDetail && reviewDetail.id === previewId && previewTask?.status === 'review' ?
                <TaskReviewSummary key={`${snapshot?.project.id}:${reviewDetail.id}:${reviewDetail.revision}`}
                  task={reviewDetail} client={client} agents={snapshot?.agents ?? []} onOpen={() => choose(reviewDetail.id)} /> : <p>正在读取所选交付…</p>}
              overview={<div className="tb-board">
              {overviewColumns
                .map(([status, title, caption]) => (
                  <section className={'tb-column tb-' + status} key={status}>
                    <header>
                      <h2>
                        <i />
                        {title}
                        <span>
                          {(snapshot?.tasks ?? []).filter((t) => t.status === status).length}
                        </span>
                      </h2>
                      <p>{caption}</p>
                    </header>
                    <div className="tb-cards">
                      {filtered
                        .filter((t) => t.status === status)
                        .map((t) => {
                          const a = owner(t.owner),
                            stale =
                              a &&
                              isAgentStale(a.last_seen);
                          return (
                            <div className="tb-card-group" key={t.id}>
                            <button
                              className={
                                'tb-card ' +
                                (selected === t.id ? 'selected' : '')
                              }
                              onClick={() => choose(t.id)}
                            >
                              <div className="tb-card-meta">
                                <span className={'tb-priority ' + t.priority}>
                                  {
                                    {
                                      high: '高优先级',
                                      normal: '普通',
                                      low: '低优先级',
                                    }[t.priority]
                                  }
                                </span>
                                <span>{time(t.updated_at)}</span>
                              </div>
                              <h3>{t.title}</h3>
                              <p>
                                {(t.status === 'backlog' ? t.feedback : '') ||
                                  t.progress ||
                                  t.description ||
                                  '等待补充任务说明'}
                              </p>
                              <footer>
                                <span>
                                  {a ? (
                                    <>
                                      <i className="tb-avatar">
                                        {a.alias.slice(0, 1)}
                                      </i>
                                      {a.alias} · {a.id.slice(0, 4)}
                                      {stale ? ' · 状态待确认' : ''}
                                    </>
                                  ) : (
                                    '尚未领取'
                                  )}
                                </span>
                                <span>v{t.spec_revision}</span>
                              </footer>
                            </button>
                            </div>
                          );
                        })}
                      {!filtered.some((t) => t.status === status) && (
                        <div className="tb-empty">
                          {status === 'review'
                            ? (query.trim() ? '没有符合搜索条件的任务' : '完成结果会出现在这里')
                            : (query.trim() ? '没有符合搜索条件的任务' : '暂无任务')}
                        </div>
                      )}
                    </div>
                  </section>
                ))}
            </div>} />
            {selected && (
              <TaskDetailDialog key={selected} title={'任务详情 · ' + (detail?.title ?? '加载中…')}
                subtitle={detail ? `${snapshot?.project.name ?? '项目'} · ${taskColumns.find(c => c[0] === detail.status)?.[1] ?? detail.status} · ${owner(detail.owner)?.alias ?? '尚无执行Agent'} · 需求 v${detail.spec_revision} · 提交记录 ${detail.events.filter(e => e.kind === 'task.submit').at(-1)?.seq ?? '未记录'}（非构建版本）` : undefined}
                navigation={detail && <TaskDetailNavigation value={detailSection} onChange={changeDetailSection} />}
                busy={busy} onClose={closeDetail} error={error} onDismissError={() => setError('')}>
              <aside
                className="tb-detail"
                aria-label="任务详情"
                onPaste={paste}
                onDragOver={(e) => {
                  e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (!busy && e.dataTransfer.files.length)
                    void addFiles(Array.from(e.dataTransfer.files));
                }}
              >
                {!detail ? (
                  <p>加载中…</p>
                ) : (
                  <>
                    <section hidden={detailSection !== 'requirements'} aria-label="任务要求与验收标准">
                    <div className="tb-detail-title">
                      {detail.status !== 'archived' && (
                        <button
                          disabled={busy}
                          onClick={() => {
                            if (editing && !window.confirm('确定放弃当前要求编辑？')) return;
                            setDraft({
                              title: detail.title,
                              description: detail.description,
                              acceptance: detail.acceptance,
                              priority: detail.priority,
                            });
                            setEditRevision(detail.revision);
                            setEditing(!editing);
                          }}
                        >
                          {editing ? '取消编辑' : '编辑要求'}
                        </button>
                      )}
                    </div>

                    {editing ? (
                      <form
                        className="tb-edit"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void run(async () => {
                            const d = await client.update(detail.id, {
                              action: 'edit',
                              revision: editRevision,
                              ...draft,
                            });
                            if (selectedRef.current === d.id) {
                              setDetail(d);
                              setEditing(false);
                            }
                            await refresh(client);
                          });
                        }}
                      >
                        {editRevision !== detail.revision && <div role="alert">
                          任务已被更新。你的草稿已保留，但不能用旧草稿覆盖新要求。请复制需要保留的内容，再重新载入最新要求。
                          <button type="button" disabled={busy} onClick={() => {
                            if (!window.confirm('重新载入将替换当前草稿，确定已保存需要保留的内容？')) return;
                            setDraft({ title: detail.title, description: detail.description, acceptance: detail.acceptance, priority: detail.priority });
                            setEditRevision(detail.revision);
                          }}>重新载入最新要求</button>
                        </div>}
                        <TaskFields draft={draft} setDraft={setDraft} />
                        <button className="tb-primary" disabled={busy || editRevision !== detail.revision}>
                          保存新版本要求
                        </button>
                      </form>
                    ) : (
                      <>
                        <h3>任务说明</h3>
                        <p className="tb-prose">
                          {detail.description || '尚未填写'}
                        </p>
                        <h3>验收要求</h3>
                        <p className="tb-prose">
                          {detail.acceptance || '尚未填写'}
                        </p>
                      </>
                    )}
                    </section>
                    <section hidden={detailSection !== 'execution'} aria-label="执行与反馈">
                    {detail.owner && (
                      <div className="tb-assignee">
                        执行 Agent：
                        <strong>
                          {owner(detail.owner)?.alias ?? detail.owner}
                        </strong>
                        <small>
                          最近心跳：
                          {owner(detail.owner)
                            ? time(owner(detail.owner)!.last_seen)
                            : '未知'}
                          ；失联不会自动转交任务
                        </small>
                      </div>
                    )}
                    {detail.claimed_spec !== null &&
                      detail.claimed_spec !== detail.spec_revision && (
                        <div className="tb-notice">
                          要求或参考附件已更新，执行 Agent 尚未确认这一版。
                        </div>
                      )}
                    {detail.feedback && (
                      <>
                        <h3>调整意见</h3>
                        <p className="tb-prose">{detail.feedback}</p>
                      </>
                    )}
                    {detail.status === 'in_progress' && (
                      <>
                        <h3>执行阶段</h3>
                        <p className="tb-prose">
                          {detail.progress || '执行中'}
                        </p>
                      </>
                    )}
                    <TaskEventTimeline task={detail} agents={snapshot?.agents ?? []} />
                    </section>
                    <section hidden={detailSection !== 'evidence'} aria-label="验收与证据工作区">
                    <TaskReviewSummary key={`${snapshot?.project.id}:${detail.id}`} task={detail} client={client} agents={snapshot?.agents ?? []} variant="dialog"/>
                    <TaskAcceptancePanel key={`${snapshot?.project.id}:${detail.id}:${detail.revision}`} task={detail}
                      state={acceptance} enabled={snapshot?.capabilities?.acceptance === true} busy={busy} onAction={acceptanceAction} />
                    <details><summary>管理任务附件（粘贴、上传与替代）</summary>
                    <div className="tb-section-title">
                      <h3>
                        任务附件 <span>{detail.attachments.length}</span>
                      </h3>
                      <small>单个文件 ≤ 10MB</small>
                    </div>
                    {detail.status !== 'archived' && (
                      <div className="tb-upload">
                        <select
                          aria-label="附件用途"
                          value={purpose}
                          onChange={(e) => setPurpose(e.target.value)}
                        >
                          <option value="reference">需求参考</option>
                          <option value="reproduction">复现材料</option>
                          <option value="result">完成结果</option>
                        </select>
                        <input
                          aria-label="附件说明"
                          placeholder="附件说明（可选）：标出了需要调整的位置…"
                          maxLength={1000}
                          value={caption}
                          onChange={(e) => setCaption(e.target.value)}
                        />
                        <div
                          className="tb-paste-zone"
                          tabIndex={0}
                          role="group"
                          aria-label="粘贴图片区域"
                        >
                          <b>{busy ? '处理中…' : '在这里粘贴截图'}</b>
                          <span>Ctrl / ⌘ + V，也可以拖入图片或文件</span>
                          <button
                            disabled={busy}
                            onClick={() => fileInput.current?.click()}
                          >
                            选择文件
                          </button>
                        </div>
                        <input
                          ref={fileInput}
                          type="file"
                          multiple
                          hidden
                          onChange={(e) => {
                            const files = Array.from(e.target.files ?? []);
                            e.target.value = '';
                            if (files.length) void addFiles(files);
                          }}
                        />
                      </div>
                    )}
                    <TaskAttachments key={detail.id} files={detail.attachments}
                      client={client} readonly={detail.status === 'archived' || busy}
                      remove={(file) => {
                            if (
                              window.confirm(
                                '标记此附件已被替代？旧图仍保留，参考附件变化将更新需求版本。',
                              )
                            )
                              void run(async () => {
                                const d = await client.removeFile(
                                  file.id,
                                  detail.revision,
                                );
                                if (clientRef.current === client && selectedRef.current === d.id) setDetail(d);
                                await refresh(client);
                              });
                          }}
                    />
                    </details>
                    {detail.status === 'archived' && (
                      <div className="tb-notice">
                        已验收归档。附件和结果保留，任务为只读。
                      </div>
                    )}
                    </section>
                    <section hidden={detailSection !== 'history'} aria-label="任务历史原始记录">
                      <TaskEventTimeline task={detail} agents={snapshot?.agents ?? []} />
                    </section>
                    {detail.status !== 'archived' && (
                      <section className="tb-detail-actions-section" aria-label="验收与任务操作">
                        <div className={'tb-detail-actions' + (detail.status === 'review' ? ' is-review' : '')}>
                          {detail.status === 'review' && (
                            <div className="tb-review-actions">
                              <section className="tb-delivery-status" aria-label="交付合并状态">
                                <p>交付提交：{detail.delivery?.commit ?? (detail.delivery?.kind === 'none' ? '非代码交付' : '未记录')}</p>
                                <p>main：{detail.integration?.status ?? '尚未合并'} · {detail.integration?.after ?? '无合并提交'}</p>
                                {detail.integration?.error && <p role="alert">{detail.integration.error}；验收已记录，处理后可重试下方验收归档。</p>}
                                <p>本地合并不等于远端推送或发布。</p>
                              </section>
                              <p className="tb-review-hint">
                                <strong>检查效果</strong>
                                Agent 已提交，确认实际效果后再归档；不满意可退回调整。
                              </p>
                              <div className="tb-review-buttons">
                                <button type="button" disabled={busy} aria-expanded={feedbackOpen} aria-controls="tb-feedback-input"
                                  onClick={() => setFeedbackOpen((v) => !v)}>
                                  需要调整
                                </button>
                                <button
                                  type="button"
                                  className="tb-primary tb-archive"
                                  disabled={busy || detail.claimed_spec !== detail.spec_revision}
                                  title={detail.claimed_spec !== detail.spec_revision ? '执行 Agent 尚未确认最新需求版本，暂不能归档' : undefined}
                                  onClick={() => void action('archive')}
                                >
                                  效果满意，归档
                                </button>
                              </div>
                              {feedbackOpen && (
                                <div className="tb-feedback-panel" role="group" aria-label="调整意见" ref={feedbackPanelRef}>
                                  <label htmlFor="tb-feedback-input">需要调整的地方</label>
                                  <textarea
                                    id="tb-feedback-input"
                                    autoFocus
                                    placeholder="写明需要调整的位置或问题；也可以回原来的对话沟通。"
                                    value={feedback}
                                    onChange={(e) => setFeedback(e.target.value)}
                                  />
                                  <div className="tb-feedback-buttons">
                                    <button type="button" disabled={busy} onClick={() => setFeedbackOpen(false)}>
                                      收起{feedback.trim() ? '（保留已写内容）' : ''}
                                    </button>
                                    <button type="button" className="tb-primary" disabled={busy} onClick={() => void requestChanges()}>
                                      提交调整意见并退回
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                          {detail.status === 'in_progress' && detail.owner && isAgentStale(owner(detail.owner)?.last_seen) && (
                            <div className="tb-release-stale" role="group" aria-label="交还离线任务">
                              {releaseOpen ? <div className="tb-release-stale-panel">
                                <strong>交还离线任务并退回队列</strong>
                                <p>负责人将被清空，任务可重新领取；任务、附件和历史不会删除。</p>
                                <label htmlFor="tb-release-stale-reason">交还原因
                                  <textarea id="tb-release-stale-reason" autoFocus required placeholder="请说明为何确认执行者已离线"
                                    value={releaseReason} onChange={(event) => setReleaseReason(event.target.value)} />
                                </label>
                                <div className="tb-release-stale-buttons">
                                  <button type="button" disabled={busy} onClick={() => setReleaseOpen(false)}>取消</button>
                                  <button type="button" className="tb-release-stale-confirm" disabled={busy || !releaseReason.trim()}
                                    onClick={() => void releaseStaleTask()}>确认交还并退回队列</button>
                                </div>
                              </div> : <button type="button" className="tb-release-stale-trigger" disabled={busy}
                                onClick={() => setReleaseOpen(true)}>交还离线任务、退回队列</button>}
                            </div>
                          )}
                          <details className="tb-more-actions">
                            <summary>更多操作</summary>
                            <div className="tb-danger-zone" role="group" aria-label="危险操作">
                              <p>删除会移除任务及其附件记录，且不可恢复；与验收归档无关。</p>
                              <button type="button" className="tb-danger" disabled={busy || (detail.status === 'in_progress' && !!detail.owner)}
                                title={detail.status === 'in_progress' && detail.owner ? '执行中且有负责人的任务不能删除' : undefined}
                                onClick={() => void run(async () => {
                                  if (!client || !detail) return;
                                  if (!window.confirm('确定删除该任务？其附件记录将一并删除，操作不可恢复。')) return;
                                  await client.update(detail.id, { action: 'delete', revision: detail.revision });
                                  selectedRef.current = null;
                                  setSelected(null); setDetail(null); setEditing(false); setFeedback(''); setFeedbackOpen(false); setReleaseReason(''); setReleaseOpen(false); setPurpose('reference'); setCaption('');
                                  await refresh(client);
                                })}>删除任务</button>
                            </div>
                          </details>
                        </div>
                      </section>
                    )}
                  </>
                )}
              </aside>
              </TaskDetailDialog>
            )}
          </div>
        </>
      )}
      {showCreate && (
        <div className="tb-modal-backdrop">
          <section
            className="tb-modal"
            role="dialog"
            aria-modal="true"
            aria-label="创建任务"
          >
            <header>
              <h2>创建任务</h2>
              <button
                aria-label="取消创建"
                onClick={() => setShowCreate(false)}
              >
                ×
              </button>
            </header>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  if (!client) return;
                  const d = await client.create(draft);
                  setShowCreate(false);
                  setDetailSection('requirements');
                  sectionScroll.current = {};
                  selectedRef.current = d.id;
                  setSelected(d.id);
                  setDetail(d);
                  await refresh(client);
                });
              }}
            >
              <TaskFields draft={draft} setDraft={setDraft} />
              <p>创建后可在详情中直接粘贴截图。</p>
              <button className="tb-primary" disabled={busy}>
                创建任务
              </button>
            </form>
          </section>
        </div>
      )}
        </div>
      </div>

      {removingProject && (
        <div className="tb-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="tb-remove-title">
          <div className="tb-modal tb-confirm-modal">
            <header>
              <h2 id="tb-remove-title">从列表移除项目</h2>
              <button type="button" aria-label="关闭" onClick={() => setRemovingProject(null)}>×</button>
            </header>
            <p>确定要从看板列表中移除项目<strong>「{removingProject.name}」</strong>吗？</p>
            <div className="tb-remove-warning">
              仅移除本应用的项目入口，不删除磁盘项目文件、任务数据库、附件、项目内 Agent 接入说明，也不停止已运行服务或其他 Agent。
            </div>
            <p className="tb-project-path-hint">路径：{removingProject.path}</p>
            <div className="tb-modal-actions">
              <button type="button" onClick={() => setRemovingProject(null)}>取消</button>
              <button
                type="button"
                className="tb-danger"
                onClick={() => {
                  if (!mayLeave()) return;
                  const toRemove = removingProject;
                  setRemovingProject(null);
                  const res = removeManagedProject(toRemove.id);
                  setProjectsState(res.state);
                  if (toRemove.id === connectedProjectId) {
                    clearSelection();
                    clientRef.current = null;
                    setConnectedProjectId(null);
                    retainedClient = null; retainedProjectId = null; retainedServiceId = null;
                    setClient(null);
                    setSnapshot(null);
                    setDetail(null);
                    setSelected(null);
                  }
                  if (res.nextActiveId) {
                    switchProject(res.nextActiveId, true);
                  }
                }}
              >
                从列表移除
              </button>
            </div>
          </div>
        </div>
      )}

      {showCreateProject && <TaskCreateProjectDialog onClose={() => setShowCreateProject(false)}
        onCreated={path => { setShowCreateProject(false); void run(() => openProjectPath(path)); }} />}
      {unsavedSwitchTarget && (
        <div className="tb-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="tb-unsaved-title">
          <div className="tb-modal tb-confirm-modal">
            <header>
              <h2 id="tb-unsaved-title">未保存的内容</h2>
            </header>
            <p>当前有未保存的任务草稿、方案、反馈或附件说明，切换项目将丢弃未保存内容，是否继续？</p>
            <div className="tb-modal-actions">
              <button type="button" onClick={() => setUnsavedSwitchTarget(null)}>留在当前项目</button>
              <button
                type="button"
                className="tb-primary"
                onClick={() => {
                  const target = unsavedSwitchTarget;
                  setUnsavedSwitchTarget(null);
                  switchProject(target, true);
                }}
              >
                放弃并切换
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
function TaskFields({
  draft,
  setDraft,
}: {
  draft: {
    title: string;
    description: string;
    acceptance: string;
    priority: string;
  };
  setDraft: (v: {
    title: string;
    description: string;
    acceptance: string;
    priority: string;
  }) => void;
}) {
  return (
    <>
      <label>
        任务标题
        <input
          autoFocus
          required
          maxLength={160}
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
        />
      </label>
      <label>
        任务说明
        <textarea
          maxLength={16000}
          rows={5}
          value={draft.description}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
        />
      </label>
      <label>
        验收标准／不要修改的范围
        <textarea
          maxLength={8000}
          rows={3}
          value={draft.acceptance}
          onChange={(e) => setDraft({ ...draft, acceptance: e.target.value })}
        />
      </label>
      <label>
        优先级
        <select
          value={draft.priority}
          onChange={(e) => setDraft({ ...draft, priority: e.target.value })}
        >
          <option value="high">高</option>
          <option value="normal">普通</option>
          <option value="low">低</option>
        </select>
      </label>
    </>
  );
}
