import assert from 'node:assert/strict';
import {
  shortcutBindingConflicts,
  replaceShortcutBinding,
  reservedShortcutReason,
  shortcutBindingsOverlap,
  SHORTCUT_SCHEMA_VERSION,
  ShortcutRegistry,
  ariaKeyShortcut,
  bindingIdentity,
  bindingsForCommand,
  findShortcutConflicts,
  formatBinding,
  keyboardBindingMatches,
  parseShortcutOverrides,
  resetShortcutOverride,
  resetShortcutScope,
  resolveKeyboardCommand,
  resolveMouseCommand,
  resolveShortcuts,
  serializeShortcutOverrides,
  setShortcutOverride,
} from '../src/core/shortcuts.ts';

const keyboard = (key, extra = {}) => ({ type: 'keyboard', key, ctrl: true, ...extra });
const context = (extra = {}) => ({
  activeSceneId: 'reader', editable: false, composing: false, altGraph: false,
  modalOpen: false, recording: false, ...extra,
});
const commands = [
  { id: 'global.palette', title: '命令面板', group: '工作台', scope: { kind: 'global' }, defaultBindings: [keyboard('k')] },
  { id: 'workbench.search', title: '搜索', group: '工作台', scope: { kind: 'workbench' }, defaultBindings: [keyboard('f')] },
  { id: 'reader.search', title: 'PDF 搜索', group: '阅读', scope: { kind: 'scene', sceneId: 'reader' }, defaultBindings: [keyboard('f')] },
  { id: 'reader.highlight', title: '高亮', group: '阅读工具', scope: { kind: 'scene', sceneId: 'reader' }, defaultBindings: [keyboard('h')] },
  { id: 'reader.back', title: '上一处', group: '阅读导航', scope: { kind: 'scene', sceneId: 'reader' }, defaultBindings: [{ type: 'mouse', button: 3 }] },
  { id: 'library.highlight', title: '资料库 H', group: '资料库', scope: { kind: 'scene', sceneId: 'library' }, defaultBindings: [keyboard('h')] },
];

let checks = 0;
const check = (value, expected, message) => { assert.deepEqual(value, expected, message); checks += 1; };

check(parseShortcutOverrides(null), { schemaVersion: 1, bindings: {} }, 'empty config');
check(parseShortcutOverrides('{bad'), { schemaVersion: 1, bindings: {} }, 'damaged config');
check(parseShortcutOverrides('{"schemaVersion":2,"bindings":{}}'), { schemaVersion: 1, bindings: {} }, 'future config');
const parsed = parseShortcutOverrides(JSON.stringify({ schemaVersion: 1, bindings: {
  'reader.highlight': [keyboard('J')], removed: [{ type: 'wat' }], cleared: null,
} }));
check(parsed.bindings['reader.highlight'][0].key, 'j', 'normalize override');
check(parsed.bindings.removed, undefined, 'ignore invalid binding');
check(parsed.bindings.cleared, null, 'retain cleared binding');
check(JSON.parse(serializeShortcutOverrides(parsed)).schemaVersion, SHORTCUT_SCHEMA_VERSION, 'serialize schema');
check(formatBinding(keyboard('h')), 'Ctrl+H', 'format keyboard');
check(formatBinding({ type: 'mouse', button: 4 }), '鼠标前进键', 'format mouse');
check(ariaKeyShortcut(keyboard('h', { shift: true })), 'Control+Shift+H', 'aria format');
check(bindingIdentity(keyboard('H')), bindingIdentity(keyboard('h')), 'case-insensitive identity');
check(keyboardBindingMatches(keyboard('h'), { key: 'H', code: 'KeyH', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false }), true, 'keyboard match');
check(keyboardBindingMatches(keyboard('h'), { key: 'h', code: 'KeyH', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false }), false, 'modifier mismatch');
check(resolveShortcuts(commands, parsed, context()).map((item) => item.command.id), ['reader.search', 'reader.highlight', 'reader.back', 'workbench.search', 'global.palette'], 'scene isolation and priority');
check(bindingsForCommand(commands[3], parsed)[0].key, 'j', 'user override wins');
check(findShortcutConflicts(commands, { schemaVersion: 1, bindings: {} }, context()).map((item) => item.commandIds), [['reader.search', 'workbench.search']], 'active conflict only');
check(findShortcutConflicts(commands, { schemaVersion: 1, bindings: {} }, context({ activeSceneId: 'library' })).length, 0, 'mutually exclusive scenes can reuse bindings');
const keyEvent = { key: 'f', code: 'KeyF', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false };
check(resolveKeyboardCommand(commands, { schemaVersion: 1, bindings: {} }, context(), keyEvent)?.id, 'reader.search', 'scene wins over workbench');
check(resolveKeyboardCommand(commands, { schemaVersion: 1, bindings: {} }, context({ editable: true }), keyEvent), undefined, 'editable protected');
check(resolveKeyboardCommand(commands, { schemaVersion: 1, bindings: {} }, context({ composing: true }), keyEvent), undefined, 'IME protected');
check(resolveKeyboardCommand(commands, { schemaVersion: 1, bindings: {} }, context({ modalOpen: true }), keyEvent), undefined, 'modal protected');
check(resolveKeyboardCommand(commands, { schemaVersion: 1, bindings: {} }, context({ recording: true }), keyEvent), undefined, 'recorder protected');
check(resolveMouseCommand(commands, { schemaVersion: 1, bindings: {} }, context(), 3)?.id, 'reader.back', 'mouse back bound');
check(resolveMouseCommand(commands, { schemaVersion: 1, bindings: {} }, context(), 4), undefined, 'mouse forward unbound');
let overrides = setShortcutOverride({ schemaVersion: 1, bindings: {} }, 'reader.highlight', [keyboard('j')]);
check(overrides.bindings['reader.highlight'][0].key, 'j', 'set override');
overrides = resetShortcutOverride(overrides, 'reader.highlight');
check(overrides.bindings['reader.highlight'], undefined, 'reset one');
overrides = { schemaVersion: 1, bindings: { 'reader.highlight': [keyboard('j')], 'global.palette': [keyboard('q')] } };
check(resetShortcutScope(overrides, commands, { kind: 'scene', sceneId: 'reader' }).bindings, { 'global.palette': [keyboard('q')] }, 'reset scope');
const registry = new ShortcutRegistry();
const unregister = registry.register(commands[0]);
check(registry.get('global.palette')?.title, '命令面板', 'registry get');
assert.throws(() => registry.register(commands[0]), /Duplicate/); checks += 1;
unregister();
check(registry.list().length, 0, 'registry unregister');


// Configuration evolution and conflicts use the same helpers as the recorder.
const empty = parseShortcutOverrides(null);
const changed = setShortcutOverride(empty, 'reader.highlight', [keyboard('j')]);
check(bindingsForCommand({...commands[3], id:'new.command'}, changed)[0].key, 'h', 'new command inherits default');
check(resolveShortcuts(commands, parseShortcutOverrides('{"schemaVersion":1,"bindings":{"deleted.id":null}}'), context()).length, 5, 'deleted command ignored');
check(shortcutBindingConflicts(commands, empty, commands[3], [keyboard('k')]).map(c=>c.id), ['global.palette'], 'global/scene conflict');
check(shortcutBindingConflicts(commands, empty, commands[3], [keyboard('h')]).length, 0, 'exclusive scenes share keys');
const replaced = replaceShortcutBinding(commands, empty, commands[3], [keyboard('k')]);
check(bindingsForCommand(commands[0], replaced), [], 'replacement removes conflicting default');
check(bindingsForCommand(commands[3], replaced)[0].key, 'k', 'replacement installs candidate');
check(bindingsForCommand(commands[0], empty)[0].key, 'k', 'cancel/preview cannot mutate original');
const disjoint = commands.map(c=> c.id === 'workbench.search' ? {...c,inactiveSceneIds:['reader']} : c);
check(shortcutBindingConflicts(disjoint, empty, disjoint[2], [keyboard('f')]).length,0,'explicit visibility excludes false conflicts');
check(resolveShortcuts(disjoint, empty, context()).some(c=>c.command.id==='workbench.search'),false,'excluded scene not dispatched');
check(shortcutBindingsOverlap(keyboard('h'), keyboard('j',{code:'KeyH',semantics:'code'})),true,'physical/logical ambiguity warns conservatively');
check(keyboardBindingMatches(keyboard('j',{code:'KeyH',semantics:'code'}),{...keyEvent,key:'j',code:'KeyH'}),true,'physical key uses code');
check(keyboardBindingMatches(keyboard('h'),{...keyEvent,key:'j',code:'KeyH'}),false,'logical key uses key');
for (const binding of [keyboard('h',{ctrl:'yes'}),keyboard('h',{semantics:'code'}),keyboard('Control'),{type:'mouse',button:1}]) {
  check(parseShortcutOverrides(JSON.stringify({schemaVersion:1,bindings:{invalid:[binding]}})).bindings.invalid,undefined,'invalid binding rejected');
}
check(Object.keys(parseShortcutOverrides('{"schemaVersion":1,"bindings":{"__proto__":null,"constructor":null}}').bindings),[],'prototype keys rejected');
check(ariaKeyShortcut(keyboard('Enter',{alt:true})), 'Control+Alt+Enter', 'ARIA canonical Enter');
check(ariaKeyShortcut(keyboard('+',{shift:true})), 'Control+Shift+Plus', 'ARIA canonical Plus');
check(!!reservedShortcutReason(keyboard('F4',{ctrl:false,alt:true})),true,'OS reserved warning');
check(!!reservedShortcutReason(keyboard('r')),true,'WebView reserved warning');
check(reservedShortcutReason({type:'mouse',button:3}),null,'mouse is not a keyboard reservation');
console.log(`Shortcut core verification passed: ${checks} checks`);
