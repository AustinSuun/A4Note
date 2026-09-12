import { createBuiltinScenePlugin } from './builtinScenePlugins';
import type { AsterPlugin, SceneContribution } from './types';

/** First-party Markdown workspace. Its scene is plugin-managed so it can be disabled independently. */
const defaultMarkdownScene: SceneContribution = {
  id: 'markdown',
  label: '笔记',
  icon: 'M',
  key: '5',
  pluginId: 'markdown.core',
  scope: 'workspace',
  sidebarMode: 'workspace',
  defaultSidebarPanel: 'markdown.files',
  resourceKinds: ['markdown'],
  enabledByDefault: true,
};

export function createMarkdownPlugin(scene: SceneContribution = defaultMarkdownScene): AsterPlugin {
  const scenePlugin = createBuiltinScenePlugin({ ...defaultMarkdownScene, ...scene, pluginId: 'markdown.core' }, {
    view: { id: 'markdown.core.view' },
    sidebar: { id: 'markdown.files' },
    resourceOpeners: [{
      id: 'markdown.editor',
      kind: 'markdown',
      title: '打开 Markdown 编辑器',
      sceneId: 'markdown',
      tabKind: 'markdown',
      priority: 100,
      open: ({ uri, title }) => ({ kind: 'markdown', title: title ?? 'Markdown', state: { uri } }),
    }],
  });
  return {
    ...scenePlugin,
    id: 'markdown.core',
    name: 'A4 Note Markdown',
    manifest: {
      id: 'markdown.core',
      name: 'A4 Note Markdown',
      version: '1.0.0',
      distribution: 'builtin',
      permissions: ['scenes', 'resources', 'workbench', 'settings'],
    },
    activate: (context) => {
      scenePlugin.activate(context);
      context.settings.register({
        id: 'markdown.documentLayout',
        title: '正文宽度',
        defaultValue: 'fluid',
        options: [
          { value: 'fluid', label: '自适应宽度（全宽）' },
          { value: 'narrow', label: '居中阅读栏（约 760px）' },
        ],
        description: '控制 Markdown 编辑和阅读时的正文最大宽度。',
        sceneId: 'markdown',
      });
      context.settings.register({
        id: 'markdown.titleAlignment',
        title: '文档标题对齐',
        defaultValue: 'left',
        options: [
          { value: 'left', label: '居左' },
          { value: 'center', label: '居中' },
          { value: 'right', label: '居右' },
        ],
        description: '控制 Markdown 文档标题在编辑和阅读时的水平位置。',
        sceneId: 'markdown',
      });
      context.settings.register({
        id: 'markdown.documentFontSize',
        title: 'Markdown 正文字号',
        defaultValue: 20,
        description: '设置 Markdown 编辑器、预览和笔记属性使用的基准字号（像素）。',
        sceneId: 'markdown',
      });
      context.settings.register({
        id: 'markdown.paragraphIndent',
        title: '段首缩进',
        defaultValue: false,
        description: '启用后，正文段落首行缩进两个字符（标题、列表、引用块不受影响）。',
        sceneId: 'markdown',
      });
    },
  };
}

export const markdownPlugin: AsterPlugin = createMarkdownPlugin();
