import {
  ArrowUpRight,
  BookOpenText,
  BrainCircuit,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock3,
  FileText,
  Highlighter,
  LibraryBig,
  ListChecks,
  MessageSquareText,
  NotebookPen,
  Pause,
  PenLine,
  Play,
  Plus,
  Sparkles,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import type { PaperDocument } from '../../core/types';

export type OverviewSceneProps = {
  isActive: boolean;
  papers: PaperDocument[];
  recentPaperIds: string[];
  onOpenPaper: (paperId: string) => void;
  onOpenLibrary: () => void;
  onOpenImport: () => void;
};

type OverviewTask = {
  id: string;
  title: string;
  date: string;
  completed: boolean;
};

type OverviewLog = {
  id: string;
  content: string;
  kind: 'reading' | 'note' | 'task';
  createdAt: string;
};

type OverviewOrganizer = {
  tasks: OverviewTask[];
  logs: OverviewLog[];
  readingSeconds: number;
};

const ORGANIZER_STORAGE_KEY = 'aster.overviewOrganizer';
const CALENDAR_WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

export function OverviewScene({ isActive, papers, recentPaperIds, onOpenPaper, onOpenLibrary, onOpenImport }: OverviewSceneProps) {
  const dashboard = useMemo(() => buildDashboardData(papers, recentPaperIds), [papers, recentPaperIds]);
  const dateLabel = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' }).format(new Date());
  const [organizer, setOrganizer] = useState<OverviewOrganizer>(loadOrganizer);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [taskComposerOpen, setTaskComposerOpen] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDate, setTaskDate] = useState(dateKey(new Date()));
  const [logContent, setLogContent] = useState('');
  const [logKind, setLogKind] = useState<OverviewLog['kind']>('note');
  const [readingStartedAt, setReadingStartedAt] = useState<number | null>(null);
  const [readingTick, setReadingTick] = useState(Date.now());
  const readingSeconds = organizer.readingSeconds + (readingStartedAt ? Math.floor((readingTick - readingStartedAt) / 1000) : 0);
  const calendarDays = useMemo(() => buildCalendarDays(calendarMonth), [calendarMonth]);
  const tasksByDate = useMemo(() => groupTasksByDate(organizer.tasks), [organizer.tasks]);
  const upcomingTasks = useMemo(
    () => [...organizer.tasks].filter((task) => !task.completed).sort((left, right) => left.date.localeCompare(right.date)).slice(0, 5),
    [organizer.tasks],
  );

  useEffect(() => {
    try {
      localStorage.setItem(ORGANIZER_STORAGE_KEY, JSON.stringify(organizer));
    } catch (error) {
      console.error('Failed to persist overview organizer state', error);
    }
  }, [organizer]);

  useEffect(() => {
    if (!readingStartedAt) return;
    const timer = window.setInterval(() => setReadingTick(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [readingStartedAt]);

  const recordLog = (content: string, kind: OverviewLog['kind']) => {
    const trimmed = content.trim();
    if (!trimmed) return;
    setOrganizer((current) => ({
      ...current,
      logs: [createLog(trimmed, kind), ...current.logs].slice(0, 80),
    }));
  };

  const createTask = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const title = taskTitle.trim();
    if (!title || !taskDate) return;
    const task: OverviewTask = { id: `task-${Date.now()}`, title, date: taskDate, completed: false };
    setOrganizer((current) => ({
      ...current,
      tasks: [...current.tasks, task].sort((left, right) => left.date.localeCompare(right.date)),
      logs: [createLog(`新任务：${title}`, 'task'), ...current.logs].slice(0, 80),
    }));
    setTaskTitle('');
    setTaskComposerOpen(false);
  };

  const toggleTask = (taskId: string) => {
    setOrganizer((current) => {
      const task = current.tasks.find((item) => item.id === taskId);
      if (!task) return current;
      const completed = !task.completed;
      return {
        ...current,
        tasks: current.tasks.map((item) => item.id === taskId ? { ...item, completed } : item),
        logs: completed ? [createLog(`完成任务：${task.title}`, 'task'), ...current.logs].slice(0, 80) : current.logs,
      };
    });
  };

  const toggleReadingTimer = () => {
    if (!readingStartedAt) {
      setReadingTick(Date.now());
      setReadingStartedAt(Date.now());
      return;
    }
    const seconds = Math.max(0, Math.floor((Date.now() - readingStartedAt) / 1000));
    setOrganizer((current) => ({
      ...current,
      readingSeconds: current.readingSeconds + seconds,
      logs: seconds >= 60 ? [createLog(`阅读 ${formatDuration(seconds)}`, 'reading'), ...current.logs].slice(0, 80) : current.logs,
    }));
    setReadingStartedAt(null);
  };

  const openTaskComposerForDate = (date: Date) => {
    setTaskDate(dateKey(date));
    setTaskComposerOpen(true);
  };

  return (
    <section className={isActive ? 'scene active overview-scene overview-scene--active' : 'scene active overview-scene'}>
      <header className="overview-header">
        <div>
          <p className="overview-date">{dateLabel}</p>
          <h1>研究总览</h1>
        </div>
        <button type="button" className="overview-import-button" onClick={onOpenImport}>
          <Plus size={16} strokeWidth={2.2} />
          导入论文
        </button>
      </header>

      <div className="overview-grid">
        <section className="overview-focus" aria-labelledby="overview-focus-title">
          <div className="overview-focus-copy">
            <span className="overview-kicker"><Sparkles size={14} fill="currentColor" /> 本周研究节奏</span>
            <h2 id="overview-focus-title">研究节奏，一目了然</h2>
            <p>
              已沉淀 <strong>{dashboard.knowledgeCount}</strong> 条笔记、标注和对话主题，
              {dashboard.activePaperCount ? `覆盖 ${dashboard.activePaperCount} 篇论文。` : '等待新的研究素材。'}
            </p>
            {dashboard.focusPaper ? (
              <button type="button" className="overview-continue-button" onClick={() => onOpenPaper(dashboard.focusPaper!.paperId)}>
                <BookOpenText size={17} />
                继续阅读
                <ArrowUpRight size={16} />
              </button>
            ) : (
              <button type="button" className="overview-continue-button" onClick={onOpenImport}>
                <Plus size={17} />
                导入第一篇论文
              </button>
            )}
          </div>
          <div className="overview-progress" aria-label={`研究沉淀进度 ${dashboard.momentum}%`}>
            <div className="overview-progress-ring" style={{ '--overview-progress': `${dashboard.momentum * 3.6}deg` } as CSSProperties}>
              <div>
                <strong>{dashboard.momentum}%</strong>
                <span>沉淀度</span>
              </div>
            </div>
            <span className="overview-progress-caption">本周资料沉淀</span>
          </div>
        </section>

        <section className="overview-stat-grid" aria-label="资料库概览">
          <article className="overview-stat overview-stat--mint">
            <span className="overview-stat-icon"><LibraryBig size={20} /></span>
            <strong>{papers.length}</strong>
            <span>收藏论文</span>
            <em>{dashboard.tagCount} 个研究标签</em>
          </article>
          <article className="overview-stat overview-stat--sun">
            <span className="overview-stat-icon"><PenLine size={20} /></span>
            <strong>{dashboard.noteCount}</strong>
            <span>阅读笔记</span>
            <em>{dashboard.annotationCount} 条标注</em>
          </article>
          <article className="overview-stat overview-stat--coral">
            <span className="overview-stat-icon"><BrainCircuit size={20} /></span>
            <strong>{dashboard.aiThreadCount}</strong>
            <span>AI 主题</span>
            <em>已绑定论文主题</em>
          </article>
          <article className="overview-stat overview-stat--sky">
            <span className="overview-stat-icon"><Clock3 size={20} /></span>
            <strong>{formatDuration(readingSeconds)}</strong>
            <span>阅读时长</span>
            <button type="button" className="overview-timer-button" onClick={toggleReadingTimer}>
              {readingStartedAt ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" />}
              {readingStartedAt ? '暂停' : '开始'}
            </button>
          </article>
        </section>

        <section className="overview-recent" aria-labelledby="overview-recent-title">
          <div className="overview-section-heading">
            <div>
              <h2 id="overview-recent-title">继续阅读</h2>
            </div>
            <button type="button" className="overview-text-button" onClick={onOpenLibrary}>
              全部论文 <ChevronRight size={16} />
            </button>
          </div>
          <div className="overview-recent-list">
            {dashboard.recentPapers.map(({ paper, isRecent }, index) => (
              <button key={paper.paperId} type="button" className="overview-paper-row" onClick={() => onOpenPaper(paper.paperId)}>
                <span className={`overview-paper-index overview-paper-index--${index % 3}`}>{String(index + 1).padStart(2, '0')}</span>
                <span className="overview-paper-copy">
                  <strong>{paper.title}</strong>
                  <span>{paper.authors || '未知作者'} · {paper.year || '年份待补充'}</span>
                </span>
                <span className="overview-paper-meta">
                  <em>{isRecent ? '最近打开' : paper.notes.length ? '已有笔记' : '待开始'}</em>
                  <ChevronRight size={17} />
                </span>
              </button>
            ))}
            {!dashboard.recentPapers.length && (
              <div className="overview-recent-empty">
                <FileText size={20} />
                <span>暂时没有可继续的论文</span>
              </div>
            )}
          </div>
        </section>

        <section className="overview-insights" aria-labelledby="overview-insights-title">
          <div className="overview-section-heading">
            <div>
              <h2 id="overview-insights-title">研究信号</h2>
            </div>
          </div>
          <div className="overview-insight-list">
            <div className="overview-insight overview-insight--highlight">
              <span><Highlighter size={17} /></span>
              <div><strong>{dashboard.annotationCount} 条重点标注</strong><small>笔记与标注</small></div>
            </div>
            <div className="overview-insight overview-insight--chat">
              <span><MessageSquareText size={17} /></span>
              <div><strong>{dashboard.aiThreadCount} 个讨论主题</strong><small>论文上下文</small></div>
            </div>
          </div>
          <div className="overview-topics">
            <span>活跃主题</span>
            <div>
              {dashboard.topTags.length
                ? dashboard.topTags.map((tag, index) => <button key={tag} type="button" className={`overview-topic overview-topic--${index % 4}`} onClick={onOpenLibrary}>{tag}</button>)
                : <em>暂无主题</em>}
            </div>
          </div>
        </section>

        <section className="overview-planner" aria-labelledby="overview-planner-title">
          <div className="overview-section-heading overview-planner-heading">
            <div>
              <h2 id="overview-planner-title">研究日历</h2>
            </div>
            <div className="overview-calendar-navigation">
              <button type="button" className="overview-icon-button" onClick={() => setCalendarMonth((current) => shiftMonth(current, -1))} title="上个月" aria-label="上个月">
                <ChevronLeft size={17} />
              </button>
              <strong>{new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long' }).format(calendarMonth)}</strong>
              <button type="button" className="overview-icon-button" onClick={() => setCalendarMonth((current) => shiftMonth(current, 1))} title="下个月" aria-label="下个月">
                <ChevronRight size={17} />
              </button>
            </div>
          </div>
          <div className="overview-planner-layout">
            <div className="overview-calendar" role="grid" aria-label="研究日历">
              {CALENDAR_WEEKDAYS.map((weekday) => <span key={weekday} className="overview-calendar-weekday" role="columnheader">周{weekday}</span>)}
              {calendarDays.map((day) => {
                const key = dateKey(day.date);
                const dayTasks = tasksByDate.get(key) ?? [];
                return (
                  <button
                    key={key}
                    type="button"
                    className={calendarDayClass(day.date, calendarMonth)}
                    onClick={() => openTaskComposerForDate(day.date)}
                    aria-label={`${key}，${dayTasks.length} 个任务`}
                  >
                    <time>{day.date.getDate()}</time>
                    <span className="overview-calendar-task-list">
                      {dayTasks.slice(0, 2).map((task) => <span key={task.id} className={task.completed ? 'completed' : ''}>{task.title}</span>)}
                      {dayTasks.length > 2 && <span className="overview-calendar-more">+{dayTasks.length - 2}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
            <aside className="overview-task-panel" aria-labelledby="overview-task-title">
              <div className="overview-task-panel-heading">
                <div><ClipboardList size={17} /><h3 id="overview-task-title">近期任务</h3></div>
                <button type="button" className="overview-add-task" onClick={() => setTaskComposerOpen(true)}><Plus size={14} /> 新任务</button>
              </div>
              <div className="overview-task-list">
                {upcomingTasks.length ? upcomingTasks.map((task) => (
                  <label key={task.id} className="overview-task-item">
                    <input type="checkbox" checked={task.completed} onChange={() => toggleTask(task.id)} />
                    <span><strong>{task.title}</strong><time>{formatTaskDate(task.date)}</time></span>
                  </label>
                )) : <div className="overview-task-empty"><ListChecks size={20} /><span>暂无待办</span></div>}
              </div>
              {taskComposerOpen && (
                <form className="overview-task-composer" onSubmit={createTask}>
                  <input value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} placeholder="任务名称" aria-label="任务名称" autoFocus />
                  <input type="date" value={taskDate} onChange={(event) => setTaskDate(event.target.value)} aria-label="任务日期" />
                  <div>
                    <button type="submit" className="overview-task-submit"><Plus size={14} /> 添加</button>
                    <button type="button" className="overview-icon-button" title="取消" aria-label="取消" onClick={() => setTaskComposerOpen(false)}><X size={16} /></button>
                  </div>
                </form>
              )}
            </aside>
          </div>
        </section>

        <section className="overview-logbook" aria-labelledby="overview-logbook-title">
          <div className="overview-section-heading">
            <div>
              <h2 id="overview-logbook-title">研究日志</h2>
            </div>
          </div>
          <div className="overview-logbook-layout">
            <form
              className="overview-log-composer"
              onSubmit={(event) => {
                event.preventDefault();
                recordLog(logContent, logKind);
                setLogContent('');
              }}
            >
              <div className="overview-log-composer-heading"><NotebookPen size={17} /><strong>新记录</strong></div>
              <textarea value={logContent} onChange={(event) => setLogContent(event.target.value)} placeholder="记录今天的研究进展" aria-label="日志内容" rows={4} />
              <div>
                <select value={logKind} onChange={(event) => setLogKind(event.target.value as OverviewLog['kind'])} aria-label="日志类型">
                  <option value="note">研究笔记</option>
                  <option value="reading">阅读记录</option>
                  <option value="task">任务记录</option>
                </select>
                <button type="submit" className="overview-log-submit"><Plus size={14} /> 写入日志</button>
              </div>
            </form>
            <div className="overview-log-list" aria-label="日志历史">
              {organizer.logs.length ? organizer.logs.map((log) => (
                <article key={log.id} className={`overview-log-item overview-log-item--${log.kind}`}>
                  <span className="overview-log-marker" />
                  <div><strong>{log.content}</strong><time>{formatLogTime(log.createdAt)}</time></div>
                </article>
              )) : <div className="overview-log-empty"><NotebookPen size={22} /><span>暂无记录</span></div>}
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}

function loadOrganizer(): OverviewOrganizer {
  const fallback: OverviewOrganizer = { tasks: [], logs: [], readingSeconds: 0 };
  try {
    const raw = localStorage.getItem(ORGANIZER_STORAGE_KEY);
    if (!raw) return fallback;
    const value = JSON.parse(raw) as Partial<OverviewOrganizer>;
    return {
      tasks: Array.isArray(value.tasks) ? value.tasks.filter(isOverviewTask).slice(0, 120) : [],
      logs: Array.isArray(value.logs) ? value.logs.filter(isOverviewLog).slice(0, 80) : [],
      readingSeconds: typeof value.readingSeconds === 'number' && Number.isFinite(value.readingSeconds) ? Math.max(0, value.readingSeconds) : 0,
    };
  } catch {
    return fallback;
  }
}

function isOverviewTask(value: unknown): value is OverviewTask {
  if (!value || typeof value !== 'object') return false;
  const task = value as Partial<OverviewTask>;
  return typeof task.id === 'string' && typeof task.title === 'string' && typeof task.date === 'string' && typeof task.completed === 'boolean';
}

function isOverviewLog(value: unknown): value is OverviewLog {
  if (!value || typeof value !== 'object') return false;
  const log = value as Partial<OverviewLog>;
  return typeof log.id === 'string' && typeof log.content === 'string' && typeof log.createdAt === 'string' && (log.kind === 'reading' || log.kind === 'note' || log.kind === 'task');
}

function createLog(content: string, kind: OverviewLog['kind']): OverviewLog {
  return { id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, content, kind, createdAt: new Date().toISOString() };
}

function buildCalendarDays(month: Date) {
  const start = new Date(month.getFullYear(), month.getMonth(), 1);
  const mondayOffset = (start.getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, index) => ({ date: new Date(month.getFullYear(), month.getMonth(), index - mondayOffset + 1) }));
}

function groupTasksByDate(tasks: OverviewTask[]) {
  const grouped = new Map<string, OverviewTask[]>();
  tasks.forEach((task) => grouped.set(task.date, [...(grouped.get(task.date) ?? []), task]));
  return grouped;
}

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function shiftMonth(month: Date, amount: number) {
  return new Date(month.getFullYear(), month.getMonth() + amount, 1);
}

function calendarDayClass(date: Date, month: Date) {
  const classes = ['overview-calendar-day'];
  if (date.getMonth() !== month.getMonth()) classes.push('outside');
  if (dateKey(date) === dateKey(new Date())) classes.push('today');
  return classes.join(' ');
}

function formatDuration(seconds: number) {
  const totalMinutes = Math.floor(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatTaskDate(date: string) {
  const taskDate = new Date(`${date}T00:00:00`);
  if (Number.isNaN(taskDate.getTime())) return date;
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', weekday: 'short' }).format(taskDate);
}

function formatLogTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}

function buildDashboardData(papers: PaperDocument[], recentPaperIds: string[]) {
  const paperById = new Map(papers.map((paper) => [paper.paperId, paper]));
  const recentlyOpened = recentPaperIds.map((paperId) => paperById.get(paperId)).filter((paper): paper is PaperDocument => Boolean(paper));
  const fallbackPapers = [...papers].sort(comparePaperActivity);
  const recentPapers = (recentlyOpened.length ? recentlyOpened : fallbackPapers).slice(0, 4).map((paper) => ({ paper, isRecent: recentlyOpened.some((recent) => recent.paperId === paper.paperId) }));
  const noteCount = papers.reduce((total, paper) => total + paper.notes.length, 0);
  const annotationCount = papers.reduce((total, paper) => total + paper.annotations.length, 0);
  const aiThreadCount = papers.reduce((total, paper) => total + paper.aiThreads.length, 0);
  const activePaperCount = papers.filter((paper) => paper.notes.length || paper.annotations.length || paper.aiThreads.length).length;
  const tagCounts = new Map<string, number>();
  papers.forEach((paper) => paper.tags.forEach((tag) => tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1)));
  const topTags = [...tagCounts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'zh-CN')).slice(0, 5).map(([tag]) => tag);
  const knowledgeCount = noteCount + annotationCount + aiThreadCount;
  const momentum = papers.length ? Math.min(100, Math.round((knowledgeCount / Math.max(papers.length * 4, 1)) * 100)) : 0;

  return {
    focusPaper: recentlyOpened[0] ?? fallbackPapers[0] ?? null,
    recentPapers,
    noteCount,
    annotationCount,
    aiThreadCount,
    activePaperCount,
    tagCount: tagCounts.size,
    topTags,
    knowledgeCount,
    momentum,
  };
}

function comparePaperActivity(left: PaperDocument, right: PaperDocument) {
  const leftActivity = latestActivityAt(left);
  const rightActivity = latestActivityAt(right);
  if (leftActivity !== rightActivity) return rightActivity - leftActivity;
  return right.notes.length + right.annotations.length + right.aiThreads.length - (left.notes.length + left.annotations.length + left.aiThreads.length);
}

function latestActivityAt(paper: PaperDocument) {
  const dates = [paper.createdAt, ...paper.notes.map((note) => note.updatedAt), ...paper.annotations.map((annotation) => annotation.createdAt)]
    .filter((value): value is string => Boolean(value))
    .map((value) => Date.parse(value))
    .filter(Number.isFinite);
  return dates.length ? Math.max(...dates) : 0;
}
