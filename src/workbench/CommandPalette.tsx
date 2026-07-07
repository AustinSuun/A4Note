import { useEffect, useMemo, useState } from 'react';

export type CommandPaletteItem = {
  id: string;
  title: string;
  group: string;
  shortcut?: string;
  disabled?: boolean;
  run: () => void;
};

export type CommandPaletteLabels = {
  title: string;
  placeholder: string;
  empty: string;
};

export function CommandPalette({
  commands,
  query,
  onQueryChange,
  onClose,
  labels,
}: {
  commands: CommandPaletteItem[];
  query: string;
  onQueryChange: (query: string) => void;
  onClose: () => void;
  labels: CommandPaletteLabels;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredCommands = useMemo(() => {
    if (!normalizedQuery) return commands;
    return commands.filter((command) => [command.title, command.group, command.shortcut ?? ''].join(' ').toLowerCase().includes(normalizedQuery));
  }, [commands, normalizedQuery]);
  const activeCommand = filteredCommands[activeIndex] ?? filteredCommands[0] ?? null;

  useEffect(() => {
    setActiveIndex(0);
  }, [normalizedQuery]);

  const runCommand = (command: CommandPaletteItem | null) => {
    if (!command || command.disabled) return;
    command.run();
    onClose();
  };

  return (
    <div className="modal-backdrop command-backdrop" onMouseDown={onClose}>
      <section className="command-palette" onMouseDown={(event) => event.stopPropagation()}>
        <div className="command-input-row">
          <CommandPaletteIcon />
          <input
            autoFocus
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
                return;
              }
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActiveIndex((current) => Math.min(current + 1, Math.max(filteredCommands.length - 1, 0)));
                return;
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActiveIndex((current) => Math.max(current - 1, 0));
                return;
              }
              if (event.key === 'Enter') {
                event.preventDefault();
                runCommand(activeCommand);
              }
            }}
            placeholder={labels.placeholder}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="command-list" role="listbox" aria-label={labels.title}>
          {filteredCommands.length ? (
            filteredCommands.map((command, index) => (
              <button
                key={command.id}
                type="button"
                className={index === activeIndex ? 'command-item active' : 'command-item'}
                disabled={command.disabled}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => runCommand(command)}
              >
                <span>
                  <strong>{command.title}</strong>
                  <em>{command.group}</em>
                </span>
                {command.shortcut ? <kbd>{command.shortcut}</kbd> : null}
              </button>
            ))
          ) : (
            <div className="command-empty">{labels.empty}</div>
          )}
        </div>
      </section>
    </div>
  );
}

function CommandPaletteIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 7h14M5 12h14M5 17h14M8 5v4M16 10v4M11 15v4" />
    </svg>
  );
}
