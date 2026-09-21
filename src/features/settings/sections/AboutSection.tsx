import type { AppDiagnostics } from '../../../platform/nativeApi';
import { Button } from '../../../shared/ui';
import { zh } from '../../../ui/zh';
import { ActionRow, DiagnosticItem, SettingGroup, StatusLine } from '../primitives';
import { useAsyncStatus } from '../useAsyncStatus';

/* About stays informational: the update entry lives in its own category (and in the
   titlebar menu), so this page never duplicates it. */
export function AboutSection({ diagnostics }: { diagnostics: AppDiagnostics | null }) {
  const status = useAsyncStatus();
  const copyDiagnostics = async () => {
    const text = `A4 Note\n版本：${diagnostics?.version ?? '0.1.0'}\n标识：${diagnostics?.identifier ?? 'app.aster.research'}`;
    try {
      await navigator.clipboard.writeText(text);
      status.set('success', zh.settings.diagnosticsCopied);
    } catch {
      status.set('error', zh.settings.pathCopyFailed);
    }
  };
  return (
    <SettingGroup title={zh.settings.about} description="用于问题反馈的版本与运行环境信息。" anchorId="diagnostics">
      <div className="diagnostics-grid" id="setting-about-diagnostics">
        <DiagnosticItem label={zh.settings.productName} value={diagnostics?.product_name ?? 'A4 Note'} />
        <DiagnosticItem label={zh.settings.version} value={diagnostics?.version ?? '0.1.0'} />
        <DiagnosticItem label={zh.settings.identifier} value={diagnostics?.identifier ?? 'app.aster.research'} />
      </div>
      <ActionRow>
        <Button id="setting-copy-diagnostics" onClick={() => void copyDiagnostics()}>{zh.settings.copyDiagnostics}</Button>
      </ActionRow>
      <StatusLine id="about-copy-status" tone={status.status.tone === 'error' ? 'error' : 'success'} message={status.status.message} />
    </SettingGroup>
  );
}
