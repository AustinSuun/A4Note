import type { Section } from './types';

/* Every setting the user can search for is declared once here. Sections render the
   matching control under the same DOM id, which is what lets a search hit move focus
   to the real control instead of a copy of the label. */
export type SettingsAnchor = { id: string; section: Section; title: string; description?: string; keywords: string[] };

export const SECTION_META: Record<Section, { label: string; description: string; keywords: string[] }> = {
  shortcuts: { label: '快捷键', description: '工作台场景切换、命令面板与界面缩放。阅读器绑定在阅读器内设置。', keywords: ['快捷键', '键盘', '鼠标', '绑定', 'shortcut'] },
  general: { label: '通用', description: '语言、界面密度、阅读布局与元数据补全。', keywords: ['通用', '基础', '语言', '简介', 'AI'] },
  appearance: { label: '外观与主题', description: '主题、字体、字号、行距与文档版式。', keywords: ['外观', '主题', '配色', '字体', '字号', '排版'] },
  library: { label: '资料库', description: '资料库位置、备份恢复、浏览器采集与场景。', keywords: ['资料库', '路径', '备份', '恢复', '采集', '场景', '存储'] },
  plugins: { label: '插件管理', description: '已安装插件、插件设置、市场索引与本地插件包。', keywords: ['插件', '扩展', '市场', '本地包', '插件设置'] },
  sync: { label: '同步', description: '多端同步账号、进度与错误。', keywords: ['同步', '账号', '登录', '云端', 'pending'] },
  updates: { label: '软件更新', description: '检查更新、发行说明、下载与安装。', keywords: ['更新', '升级', '版本', '发行说明', '安装'] },
  about: { label: '关于', description: '产品名称、版本与诊断信息。', keywords: ['关于', '版本', '诊断', '标识'] },
};

export const SETTINGS_CATALOG: SettingsAnchor[] = [
  { id: 'setting-shortcuts', section: 'shortcuts', title: '工作台快捷键', description: '自定义键盘和鼠标侧键、冲突检查及恢复默认。', keywords: ['快捷键', '键盘', '鼠标', '录制', '绑定'] },
  { id: 'setting-language', section: 'general', title: '界面语言', description: '当前界面语言。', keywords: ['语言', '中文', 'language', 'locale'] },
  { id: 'setting-density', section: 'general', title: '界面密度', description: '紧凑或舒适的界面间距。', keywords: ['密度', '紧凑', '舒适', '间距', 'density'] },
  { id: 'setting-reader-layout', section: 'general', title: '默认阅读布局', description: '打开 PDF 时使用的默认布局。', keywords: ['阅读布局', '专注', '笔记', 'AI', '默认布局'] },
  { id: 'setting-metadata-sources', section: 'general', title: '元数据补全来源', description: 'Crossref、arXiv 或仅本地提取。', keywords: ['元数据', 'crossref', 'arxiv', '补全', '文献信息'] },
  { id: 'setting-online-metadata', section: 'general', title: '启用在线补全', description: '允许联网补全文献元数据。', keywords: ['在线补全', '联网', '元数据', 'online'] },
  { id: 'setting-ai-provider', section: 'general', title: 'AI Provider', description: '选择对话使用的 AI Provider。', keywords: ['ai', 'provider', '模型', '助手'] },
  { id: 'setting-theme', section: 'appearance', title: '主题预设', description: 'A4 Note、纸张浅色或深夜专注。', keywords: ['主题', '配色', '深色', '浅色', 'theme'] },
  { id: 'setting-interface-font', section: 'appearance', title: '界面字体', description: '工具栏与设置界面的字体。', keywords: ['界面字体', '字体', 'font'] },
  { id: 'setting-interface-font-size', section: 'appearance', title: '界面字号', description: '界面文字大小，10 到 32 像素。', keywords: ['界面字号', '字号', 'font size', '缩放'] },
  { id: 'setting-document-font', section: 'appearance', title: '文档正文字体', description: 'Markdown 与笔记正文的字体。', keywords: ['正文字体', '文档字体', 'serif', '衬线'] },
  { id: 'setting-code-font', section: 'appearance', title: '代码字体', description: '代码块使用的等宽字体。', keywords: ['代码字体', '等宽', 'mono'] },
  { id: 'setting-line-height', section: 'appearance', title: '文档行距', description: '紧凑或舒适的正文行距。', keywords: ['行距', '行高', 'line height'] },
  { id: 'setting-document-layout', section: 'appearance', title: '文档版式', description: '流式或窄栏版式。', keywords: ['版式', '布局', '宽度', '窄栏'] },
  { id: 'setting-library-paths', section: 'library', title: '资料库位置', description: '资料库根目录、数据库与文件库路径。', keywords: ['路径', '根目录', '数据库', '文件库', '位置'] },
  { id: 'setting-backup', section: 'library', title: '创建资料库备份', description: '把资料库数据库与库内附件打包备份。', keywords: ['备份', 'backup', '导出'] },
  { id: 'setting-restore', section: 'library', title: '从备份恢复', description: '用备份替换当前资料库。', keywords: ['恢复', '还原', 'restore', '回滚'] },
  { id: 'setting-scenes', section: 'library', title: '场景开关', description: '启用或停用工作台场景。', keywords: ['场景', '开关', '工作台'] },
  { id: 'setting-capture', section: 'library', title: '浏览器论文采集', description: '浏览器扩展与桌面软件的通信、采集任务。', keywords: ['采集', '浏览器', '扩展', 'capture', '最近任务'] },
  { id: 'setting-plugin-filter', section: 'plugins', title: '筛选插件', description: '按名称或 ID 过滤已安装插件。', keywords: ['筛选', '搜索插件', '过滤'] },
  { id: 'setting-plugin-list', section: 'plugins', title: '已安装插件', description: '启用/停用插件并打开插件设置。', keywords: ['已安装插件', '启停', '插件列表'] },
  { id: 'setting-plugin-settings', section: 'plugins', title: '插件设置', description: '所选插件暴露的设置项。', keywords: ['插件设置', '选项'] },
  { id: 'setting-market-source', section: 'plugins', title: '插件市场索引', description: '市场索引 URL 与刷新。', keywords: ['市场', '索引', 'url', '插件市场'] },
  { id: 'setting-market-list', section: 'plugins', title: '市场可用插件', description: '市场索引中的插件。', keywords: ['市场插件', '可安装'] },
  { id: 'setting-import-plugin', section: 'plugins', title: '导入插件包', description: '导入已签名的本地插件包。', keywords: ['导入', '本地插件包', '签名'] },
  { id: 'setting-sync-account', section: 'sync', title: '同步账号', description: '登录或退出同步服务。', keywords: ['账号', '登录', '登出', '同步凭据'] },
  { id: 'setting-sync-actions', section: 'sync', title: '立即同步', description: '手动触发一次同步。', keywords: ['立即同步', '手动同步', '刷新同步'] },
  { id: 'setting-sync-status', section: 'sync', title: '同步状态', description: '待处理操作、最近成功时间与错误。', keywords: ['同步状态', 'pending', '错误', '最近成功'] },
  { id: 'setting-update-check', section: 'updates', title: '检查更新', description: '查询官方 GitHub Releases。', keywords: ['检查更新', '升级', '新版本'] },
  { id: 'setting-update-notes', section: 'updates', title: '发行说明', description: '当前候选版本的更新内容。', keywords: ['发行说明', '更新内容', 'changelog', 'release notes'] },
  { id: 'setting-update-download', section: 'updates', title: '下载并验证更新', description: '下载更新包并校验签名。', keywords: ['下载更新', '校验签名'] },
  { id: 'setting-update-install', section: 'updates', title: '备份并安装更新', description: '备份资料库后退出安装。', keywords: ['安装更新', '退出安装', '备份安装'] },
  { id: 'setting-update-release-page', section: 'updates', title: '官方发布页', description: '在浏览器打开 GitHub 发布页。', keywords: ['发布页', 'github', '浏览器插件'] },
  { id: 'setting-about-diagnostics', section: 'about', title: '版本与诊断信息', description: '产品名称、版本与标识符。', keywords: ['诊断', '版本', '标识', 'about'] },
  { id: 'setting-copy-diagnostics', section: 'about', title: '复制诊断信息', description: '把版本信息复制到剪贴板。', keywords: ['复制诊断', '剪贴板'] },
];

export type SettingsSearchHit = SettingsAnchor & { sectionLabel: string };

const normalize = (value: string) => value.trim().toLowerCase();

function scoreAnchor(anchor: SettingsAnchor, query: string): number {
  const title = anchor.title.toLowerCase();
  if (title.startsWith(query)) return 100;
  if (title.includes(query)) return 80;
  if (anchor.keywords.some((keyword) => keyword.toLowerCase().includes(query))) return 60;
  if ((anchor.description ?? '').toLowerCase().includes(query)) return 40;
  const sectionLabel = SECTION_META[anchor.section].label.toLowerCase();
  if (sectionLabel.includes(query)) return 30;
  return 0;
}

/* Section-level matches are folded in so searching a category name ("同步") still
   lands the user on that category even when no individual setting title matches. */
export function searchSettings(query: string, limit = 12): SettingsSearchHit[] {
  const needle = normalize(query);
  if (!needle) return [];
  return SETTINGS_CATALOG
    .map((anchor) => ({ anchor, score: scoreAnchor(anchor, needle) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ anchor }) => ({ ...anchor, sectionLabel: SECTION_META[anchor.section].label }));
}
