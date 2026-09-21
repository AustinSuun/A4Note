import { useEffect, useRef, useState } from 'react';
import { taskAgentPrompts, type TaskAgentPromptKind } from './taskAgentPrompts';
import './task-agent-prompt-actions.css';

const labels: Record<TaskAgentPromptKind, string> = {
  publisher: '发布者提示词',
  executor: '执行者提示词',
};

async function copyText(text: string) {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Tauri/WebView or an insecure preview may reject the async clipboard API.
  }

  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.left = '-9999px';
  area.style.top = '0';
  document.body.appendChild(area);
  area.select();
  const copied = document.execCommand('copy');
  area.remove();
  if (!copied) throw new Error('clipboard unavailable');
}

export function TaskAgentPromptActions() {
  const [copied, setCopied] = useState<TaskAgentPromptKind | null>(null);
  const [error, setError] = useState('');
  const timer = useRef<number | null>(null);

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  const copy = async (kind: TaskAgentPromptKind) => {
    setError('');
    try {
      await copyText(taskAgentPrompts[kind]);
      setCopied(kind);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(null), 1800);
    } catch {
      setCopied(null);
      setError('复制失败，请查看任务服务文档');
    }
  };

  return <div className="tb-agent-prompt-actions" aria-label="Agent 快速提示词">
    {(Object.keys(labels) as TaskAgentPromptKind[]).map(kind => (
      <button
        key={kind}
        type="button"
        className={copied === kind ? 'is-copied' : ''}
        aria-label={`复制${labels[kind]}`}
        title={`复制${labels[kind]}；完整规则见任务服务文档`}
        onClick={() => void copy(kind)}
      >
        <span className="tb-agent-prompt-icon" aria-hidden="true">⧉</span>
        {copied === kind ? '✓ 已复制' : labels[kind]}
      </button>
    ))}
    {error && <span className="tb-agent-prompt-error" role="status">{error}</span>}
  </div>;
}
