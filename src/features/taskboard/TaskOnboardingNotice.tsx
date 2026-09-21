import { useId, useState } from 'react';

/** Only successful onboarding can be collapsed or dismissed; warnings stay visible. */
export function TaskOnboardingNotice({ notice }: {
  notice: { ready: boolean; message: string };
}) {
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const descriptionId = useId();
  if (!notice.ready) {
    return <div className="tb-onboarding tb-onboarding-warning" role="alert">
      {notice.message || 'Agent 接入说明未就绪，请核对项目权限和接入配置。'}
    </div>;
  }
  if (dismissed) return null;
  return <div className="tb-onboarding tb-onboarding-ready">
    <div className="tb-onboarding-summary">
      <span role="status">Agent 接入说明已就绪</span>
      <button type="button" aria-expanded={expanded} aria-controls={descriptionId}
        onClick={() => setExpanded(value => !value)}>
        {expanded ? '收起说明' : '查看说明'}
      </button>
      <button type="button" aria-label="关闭接入成功提示" onClick={() => setDismissed(true)}>×</button>
    </div>
    {expanded && <p id={descriptionId}>{notice.message}</p>}
  </div>;
}
