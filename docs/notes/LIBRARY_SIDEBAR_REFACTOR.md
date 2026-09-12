# 文献库侧边栏重构

## 概述

文献库侧边栏已重构，新增"快速访问"功能区，提供更便捷的文献筛选和访问方式。

## 新增功能

### 快速访问

快速访问区域位于侧边栏顶部，包含以下预设视图：

1. **全部文献** - 显示所有文献（保留原有功能）
2. **最近查看** - 显示最近查看过的文献，按查看时间倒序排列
3. **最近导入** - 显示最近导入的50篇文献，按导入时间倒序排列
4. **未读文献** - 显示所有标记为未读的文献
5. **收藏文献** - 显示所有收藏的文献

### 结构布局

```
文献库
├─ 快速访问
│  ├─ 全部文献
│  ├─ 最近查看
│  ├─ 最近导入
│  ├─ 未读文献
│  └─ 收藏文献
├─ 文件夹
│  ├─ 默认资料库
│  ├─ 研究方向 A
│  ├─ 研究方向 B
│  └─ 待读资料
└─ 标签
   ├─ 全部标签
   ├─ 标签1
   └─ 标签2
```

## 数据模型变更

### PaperDocument 类型扩展

在 `src/core/types.ts` 中，`PaperDocument` 接口新增以下字段：

```typescript
export interface PaperDocument {
  // ... 原有字段
  lastViewedAt?: string;   // 最后查看时间
  isRead?: boolean;        // 是否已读
  isFavorite?: boolean;    // 是否收藏
}
```

这些字段都是可选的，以保持向后兼容性。

## 实现细节

### 组件变更

#### LibrarySceneSidebar.tsx

1. 导入新的图标组件：`Clock`, `FileDown`, `BookOpen`, `Star`
2. 新增计算逻辑：
   - `recentlyViewedPapers` - 根据 `lastViewedAt` 排序
   - `recentlyImportedPapers` - 根据 `createdAt` 排序，限制50条
   - `unreadPapers` - 过滤 `isRead === false`
   - `favoritePapers` - 过滤 `isFavorite === true`

#### LibraryScene.tsx

1. 更新 `visiblePapers` 计算逻辑，支持快速访问过滤器：
   - `'all'` - 显示全部
   - `'recently-viewed'` - 最近查看
   - `'recently-imported'` - 最近导入
   - `'unread'` - 未读文献
   - `'favorites'` - 收藏文献
   - 其他值 - 按文件夹ID过滤

2. 更新 `activeFolderLabel` 显示正确的标签名称

## 使用说明

### 用户交互

1. 点击快速访问中的任意选项，右侧文献列表会自动过滤显示对应的文献
2. 每个快速访问选项右侧显示该分类下的文献数量
3. 快速访问与文件夹、标签过滤可以配合使用

### 后续开发需要

以下功能需要在后端/持久化层实现：

1. **记录查看时间** - 当用户打开文献时，更新 `lastViewedAt` 字段
2. **标记已读/未读** - 提供UI操作来切换 `isRead` 状态
3. **收藏功能** - 提供UI操作来切换 `isFavorite` 状态
4. **数据持久化** - 确保这些新字段能正确保存到数据库

### 建议的实现位置

```typescript
// 在打开文献时更新查看时间
onOpenPaper: (paperId: string) => {
  // 更新 lastViewedAt 为当前时间
  updatePaperMetadata(paperId, { 
    lastViewedAt: new Date().toISOString() 
  });
  // 打开文献
  openReader(paperId);
}

// 在文献详情面板或操作菜单中添加
- 标记为已读/未读按钮
- 收藏/取消收藏按钮
```

## 样式

所有样式已在 `src/ui/styles/workbench.css` 中定义：
- `.library-sidebar-section` - 区域容器
- `.library-sidebar-section-heading` - 区域标题
- `.library-sidebar-nav` - 导航按钮
- `.library-sidebar-nav.active` - 激活状态

## 向后兼容性

- 所有新增的 `PaperDocument` 字段都是可选的
- 原有的"全部文献"功能保持不变
- 文件夹和标签功能完全保留

## 测试

构建测试已通过：
```bash
npm run build  # ✓ 构建成功
```

## 未来优化

1. 添加自定义快速访问分类的功能
2. 支持快速访问的排序和显隐设置
3. "最近导入"的数量限制可配置化
4. 添加"最近修改"、"本周添加"等更多时间维度的快速访问
