export const SHORTCUT_SCHEMA_VERSION = 1 as const;

export type ShortcutScope =
  | { kind: 'global' }
  | { kind: 'workbench' }
  | { kind: 'scene'; sceneId: string };

export type KeyboardShortcutBinding = {
  type: 'keyboard';
  key: string;
  code?: string;
  semantics?: 'key' | 'code';
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  meta?: boolean;
};

export type MouseShortcutBinding = {
  type: 'mouse';
  button: 3 | 4;
};

export type ShortcutBinding = KeyboardShortcutBinding | MouseShortcutBinding;

export type ShortcutContext = {
  activeSceneId: string;
  editable: boolean;
  composing: boolean;
  altGraph: boolean;
  modalOpen: boolean;
  recording: boolean;
};

export type ShortcutCommand = {
  id: string;
  title: string;
  group: string;
  scope: ShortcutScope;
  defaultBindings: ShortcutBinding[];
  allowInEditable?: boolean;
  anchorId?: string;
  isVisible?: (context: ShortcutContext) => boolean;
  isEnabled?: (context: ShortcutContext) => boolean;
};

export type ShortcutOverrides = {
  schemaVersion: typeof SHORTCUT_SCHEMA_VERSION;
  bindings: Record<string, ShortcutBinding[] | null>;
};

export type ResolvedShortcut = {
  command: ShortcutCommand;
  bindings: ShortcutBinding[];
  enabled: boolean;
};

export type ShortcutConflict = {
  binding: ShortcutBinding;
  commandIds: string[];
};

const EMPTY_OVERRIDES: ShortcutOverrides = {
  schemaVersion: SHORTCUT_SCHEMA_VERSION,
  bindings: {},
};

function normalizedKey(key: string) {
  return key.length === 1 ? key.toLocaleLowerCase() : key.toLocaleLowerCase();
}

export function normalizeBinding(binding: ShortcutBinding): ShortcutBinding {
  if (binding.type === 'mouse') return { type: 'mouse', button: binding.button };
  const semantics = binding.semantics ?? (binding.code ? 'code' : 'key');
  return {
    type: 'keyboard',
    key: normalizedKey(binding.key),
    ...(binding.code ? { code: binding.code } : {}),
    semantics,
    ctrl: Boolean(binding.ctrl),
    alt: Boolean(binding.alt),
    shift: Boolean(binding.shift),
    meta: Boolean(binding.meta),
  };
}

export function bindingIdentity(binding: ShortcutBinding) {
  const normalized = normalizeBinding(binding);
  if (normalized.type === 'mouse') return `mouse:${normalized.button}`;
  const value = normalized.semantics === 'code' ? normalized.code ?? normalized.key : normalized.key;
  return [
    'keyboard',
    normalized.semantics,
    value,
    normalized.ctrl ? 'ctrl' : '',
    normalized.alt ? 'alt' : '',
    normalized.shift ? 'shift' : '',
    normalized.meta ? 'meta' : '',
  ].join(':');
}

export function formatBinding(binding: ShortcutBinding) {
  const normalized = normalizeBinding(binding);
  if (normalized.type === 'mouse') return normalized.button === 3 ? '鼠标后退键' : '鼠标前进键';
  const parts = [
    normalized.ctrl ? 'Ctrl' : '',
    normalized.alt ? 'Alt' : '',
    normalized.shift ? 'Shift' : '',
    normalized.meta ? 'Meta' : '',
    normalized.semantics === 'code' && normalized.code ? normalized.code.replace(/^Key/, '') : normalized.key.length === 1 ? normalized.key.toUpperCase() : normalized.key,
  ].filter(Boolean);
  return parts.join('+');
}

export function ariaKeyShortcut(binding: ShortcutBinding) {
  const normalized = normalizeBinding(binding);
  if (normalized.type === 'mouse') return undefined;
  const key = normalized.semantics === 'code' && normalized.code
    ? normalized.code.replace(/^Key/, '')
    : normalized.key.length === 1 ? normalized.key.toUpperCase() : normalized.key;
  return [
    normalized.ctrl ? 'Control' : '',
    normalized.alt ? 'Alt' : '',
    normalized.shift ? 'Shift' : '',
    normalized.meta ? 'Meta' : '',
    key,
  ].filter(Boolean).join('+');
}

function validBinding(value: unknown): value is ShortcutBinding {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ShortcutBinding>;
  if (candidate.type === 'mouse') return candidate.button === 3 || candidate.button === 4;
  if (candidate.type !== 'keyboard' || typeof candidate.key !== 'string' || !candidate.key) return false;
  if (candidate.semantics && candidate.semantics !== 'key' && candidate.semantics !== 'code') return false;
  return !candidate.code || typeof candidate.code === 'string';
}

export function parseShortcutOverrides(raw: string | null | undefined): ShortcutOverrides {
  if (!raw) return EMPTY_OVERRIDES;
  try {
    const value = JSON.parse(raw) as Partial<ShortcutOverrides>;
    if (value.schemaVersion !== SHORTCUT_SCHEMA_VERSION || !value.bindings || typeof value.bindings !== 'object') {
      return EMPTY_OVERRIDES;
    }
    const bindings: ShortcutOverrides['bindings'] = {};
    for (const [commandId, commandBindings] of Object.entries(value.bindings)) {
      if (commandBindings === null) {
        bindings[commandId] = null;
      } else if (Array.isArray(commandBindings) && commandBindings.every(validBinding)) {
        bindings[commandId] = commandBindings.map(normalizeBinding);
      }
    }
    return { schemaVersion: SHORTCUT_SCHEMA_VERSION, bindings };
  } catch {
    return EMPTY_OVERRIDES;
  }
}

export function serializeShortcutOverrides(overrides: ShortcutOverrides) {
  return JSON.stringify({
    schemaVersion: SHORTCUT_SCHEMA_VERSION,
    bindings: Object.fromEntries(Object.entries(overrides.bindings).sort(([a], [b]) => a.localeCompare(b))),
  });
}

export function bindingsForCommand(command: ShortcutCommand, overrides: ShortcutOverrides) {
  const override = overrides.bindings[command.id];
  if (override === null) return [];
  return (override ?? command.defaultBindings).map(normalizeBinding);
}

export function scopeIsActive(scope: ShortcutScope, context: ShortcutContext) {
  return scope.kind !== 'scene' || scope.sceneId === context.activeSceneId;
}

function scopeRank(scope: ShortcutScope) {
  return scope.kind === 'scene' ? 3 : scope.kind === 'workbench' ? 2 : 1;
}

export function resolveShortcuts(
  commands: readonly ShortcutCommand[],
  overrides: ShortcutOverrides,
  context: ShortcutContext,
): ResolvedShortcut[] {
  return commands
    .filter((command) => scopeIsActive(command.scope, context) && (command.isVisible?.(context) ?? true))
    .map((command) => ({
      command,
      bindings: bindingsForCommand(command, overrides),
      enabled: command.isEnabled?.(context) ?? true,
    }))
    .sort((left, right) => scopeRank(right.command.scope) - scopeRank(left.command.scope));
}

export function findShortcutConflicts(
  commands: readonly ShortcutCommand[],
  overrides: ShortcutOverrides,
  context: ShortcutContext,
): ShortcutConflict[] {
  const byBinding = new Map<string, { binding: ShortcutBinding; commandIds: string[] }>();
  for (const resolved of resolveShortcuts(commands, overrides, context)) {
    for (const binding of resolved.bindings) {
      const identity = bindingIdentity(binding);
      const entry = byBinding.get(identity) ?? { binding, commandIds: [] };
      entry.commandIds.push(resolved.command.id);
      byBinding.set(identity, entry);
    }
  }
  return [...byBinding.values()].filter((entry) => entry.commandIds.length > 1);
}

export type KeyboardLikeEvent = {
  key: string;
  code?: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
};

export function keyboardBindingMatches(binding: KeyboardShortcutBinding, event: KeyboardLikeEvent) {
  const normalized = normalizeBinding(binding) as KeyboardShortcutBinding;
  const valueMatches = normalized.semantics === 'code'
    ? Boolean(normalized.code && event.code === normalized.code)
    : normalized.key === normalizedKey(event.key);
  return valueMatches
    && normalized.ctrl === event.ctrlKey
    && normalized.alt === event.altKey
    && normalized.shift === event.shiftKey
    && normalized.meta === event.metaKey;
}

export function eventTargetIsEditable(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || (target instanceof HTMLElement && target.isContentEditable)
    || Boolean(target.closest('[contenteditable="true"], [role="textbox"]'));
}

export function canDispatchShortcut(command: ShortcutCommand, context: ShortcutContext) {
  if (context.composing || context.altGraph || context.modalOpen || context.recording) return false;
  if (context.editable && !command.allowInEditable) return false;
  return command.isEnabled?.(context) ?? true;
}

export function resolveKeyboardCommand(
  commands: readonly ShortcutCommand[],
  overrides: ShortcutOverrides,
  context: ShortcutContext,
  event: KeyboardLikeEvent,
) {
  return resolveShortcuts(commands, overrides, context).find(({ command, bindings, enabled }) =>
    enabled
    && canDispatchShortcut(command, context)
    && bindings.some((binding) => binding.type === 'keyboard' && keyboardBindingMatches(binding, event)),
  )?.command;
}

export function resolveMouseCommand(
  commands: readonly ShortcutCommand[],
  overrides: ShortcutOverrides,
  context: ShortcutContext,
  button: number,
) {
  if (button !== 3 && button !== 4) return undefined;
  return resolveShortcuts(commands, overrides, context).find(({ command, bindings, enabled }) =>
    enabled
    && canDispatchShortcut(command, context)
    && bindings.some((binding) => binding.type === 'mouse' && binding.button === button),
  )?.command;
}

export function setShortcutOverride(
  current: ShortcutOverrides,
  commandId: string,
  bindings: ShortcutBinding[] | null,
): ShortcutOverrides {
  return {
    schemaVersion: SHORTCUT_SCHEMA_VERSION,
    bindings: { ...current.bindings, [commandId]: bindings?.map(normalizeBinding) ?? null },
  };
}

export function resetShortcutOverride(current: ShortcutOverrides, commandId: string) {
  const bindings = { ...current.bindings };
  delete bindings[commandId];
  return { schemaVersion: SHORTCUT_SCHEMA_VERSION, bindings } satisfies ShortcutOverrides;
}

export function resetShortcutScope(
  current: ShortcutOverrides,
  commands: readonly ShortcutCommand[],
  scope: ShortcutScope,
) {
  const ids = new Set(commands.filter((command) => JSON.stringify(command.scope) === JSON.stringify(scope)).map((command) => command.id));
  return {
    schemaVersion: SHORTCUT_SCHEMA_VERSION,
    bindings: Object.fromEntries(Object.entries(current.bindings).filter(([id]) => !ids.has(id))),
  } satisfies ShortcutOverrides;
}

export class ShortcutRegistry {
  readonly #commands = new Map<string, ShortcutCommand>();

  register(command: ShortcutCommand) {
    if (this.#commands.has(command.id)) throw new Error(`Duplicate shortcut command: ${command.id}`);
    this.#commands.set(command.id, command);
    return () => this.#commands.delete(command.id);
  }

  list() {
    return [...this.#commands.values()];
  }

  get(id: string) {
    return this.#commands.get(id);
  }
}
