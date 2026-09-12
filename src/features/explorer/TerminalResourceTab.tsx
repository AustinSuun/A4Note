import { useState } from 'react';
import { runProjectCommand, isTauriRuntime } from '../../platform/projects';
import { zh } from '../../ui/zh';

export interface TerminalResourceTabProps {
  cwd: string;
  name?: string;
}

export function TerminalResourceTab({ cwd, name = 'Terminal' }: TerminalResourceTabProps) {
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [output, setOutput] = useState('');
  const [running, setRunning] = useState(false);
  const execute = async () => {
    const executable = command.trim();
    if (!executable || running) return;
    setRunning(true);
    try {
      if (!isTauriRuntime()) throw new Error(zh.workbench.terminalDesktopOnly);
      const result = await runProjectCommand(cwd, executable, args.trim() ? args.trim().split(/\s+/) : []);
      setOutput([`$ ${executable}${args.trim() ? ` ${args.trim()}` : ''}`, result.stdout, result.stderr, `[exit ${result.status}]`].filter(Boolean).join('\n'));
    } catch (error) {
      setOutput(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
    }
  };
  return (
    <section className="terminal-resource-tab">
      <header className="file-tab-header"><div className="file-tab-identity"><h2>{name}</h2><p className="file-tab-path">{cwd}</p></div></header>
      <div className="terminal-command-row">
        <input value={command} onChange={(event) => setCommand(event.target.value)} placeholder={zh.workbench.terminalCommand} aria-label={zh.workbench.terminalCommand} />
        <input value={args} onChange={(event) => setArgs(event.target.value)} placeholder={zh.workbench.terminalArgs} aria-label={zh.workbench.terminalArgs} onKeyDown={(event) => { if (event.key === 'Enter') void execute(); }} />
        <button type="button" className="workbench-action primary" onClick={() => void execute()} disabled={running || !command.trim()}>{running ? zh.workbench.terminalRunning : zh.workbench.terminalRun}</button>
      </div>
      <pre className="terminal-output" aria-live="polite">{output || zh.workbench.terminalEmpty}</pre>
    </section>
  );
}
