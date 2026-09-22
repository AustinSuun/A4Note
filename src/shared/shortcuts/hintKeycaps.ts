import type { ShortcutBinding } from '../../core/shortcuts';

/** Use structured bindings: splitting display text at '+' loses the Plus key. */
export function hintKeycaps(binding: ShortcutBinding, omitHeldControl = false): string[] {
  // DOM buttons are zero-based: 3 = back (M4), 4 = forward (M5).
  // Full localized names stay in formatBinding for control/editor titles and ARIA.
  if (binding.type === 'mouse') return [binding.button === 3 ? 'M4' : 'M5'];
  const names: Record<string, string> = { enter: 'Enter', escape: 'Esc', backspace: 'Backspace', delete: 'Delete', space: 'Space', tab: 'Tab', arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→' };
  const value = binding.semantics === 'code' && binding.code ? binding.code.replace(/^Key/, '') : binding.key;
  const key = names[value.toLowerCase()] ?? (value.length === 1 ? value.toUpperCase() : value.replace(/^f(\d+)$/i, 'F$1'));
  return [binding.ctrl && !omitHeldControl ? 'Ctrl' : '', binding.alt ? 'Alt' : '', binding.shift ? 'Shift' : '', binding.meta ? 'Meta' : '', key].filter(Boolean);
}
