# 文献库快速访问功能 - 完整实现

## 概述

文献库侧边栏已完成重构，新增"快速访问"功能区和完整的文献状态管理（已读/未读、收藏）功能。

## ✅ 已完成功能

### 1. 快速访问区域

侧边栏顶部新增快速访问区域，包含5个预设视图：

- **全部文献** 📚 - 显示所有文献
- **最近查看** 🕐 - 按查看时间倒序显示
- **最近导入** 📥 - 显示最近导入的50篇文献
- **未读文献** 📖 - 显示未标记为已读的文献
- **收藏文献** ⭐ - 显示收藏的文献

每个选项右侧显示对应的文献数量。

### 2. 数据模型扩展

**PaperDocument 接口新增字段：**
```typescript
export interface PaperDocument {
  // ... 原有字段
  lastViewedAt?: string;   // 最后查看时间 (ISO 8601)
  isRead?: boolean;        // 是否已读
  isFavorite?: boolean;    // 是否收藏
}
```

**导入文献时自动初始化：**
```typescript
{
  createdAt: new Date().toISOString(),
  isRead: false,
  isFavorite: false,
}
```

### 3. 核心API实现

**AsterDocumentStore 新增方法：**

```typescript
// 更新最后查看时间
updateLastViewedAt(paperId: string): PaperDocument | null

// 切换已读状态
toggleRead(paperId: string): PaperDocument | null

// 切换收藏状态
toggleFavorite(paperId: string): PaperDocument | null
```

**命令注册：**
- `document.updateLastViewedAt` - 更新查看时间
- `document.toggleRead` - 切换已读状态
- `document.toggleFavorite` - 切换收藏状态

### 4. 自动查看时间记录

打开文献时自动更新 `lastViewedAt`：

```typescript
const openReaderForPaper = (paperId: string) => {
  // ... 其他逻辑
  aster.commands.execute('document.updateLastViewedAt', { paperId });
  // ... 打开阅读器
};
```

### 5. UI 功能

**文献详情面板新增状态按钮：**

- **已读/未读按钮**
  - 图标：📖 BookOpen (未读) / ✓ BookCheck (已读)
  - 点击切换状态
  - 激活状态：绿色高亮

- **收藏按钮**
  - 图标：⭐ Star (空心/实心)
  - 点击切换状态
  - 激活状态：金色高亮

**按钮样式：**
```css
.status-button - 基础样式
.status-button.active - 激活状态 (绿色)
.status-button.favorite.active - 收藏激活 (金色)
```

### 6. 过滤逻辑

**LibraryScene 组件实现快速访问过滤：**

```typescript
switch (activeFolderId) {
  case 'all': 
    // 全部文献
  case 'recently-viewed': 
    // 按 lastViewedAt 排序
  case 'recently-imported': 
    // 按 createdAt 排序，取前50条
  case 'unread': 
    // 过滤 isRead === false
  case 'favorites': 
    // 过滤 isFavorite === true
  default: 
    // 按文件夹ID过滤
}
```

## 文件变更清单

### 核心层 (src/core/)

1. **types.ts**
   - ✅ PaperDocument 接口新增 `lastViewedAt`, `isRead`, `isFavorite` 字段

2. **asterCore.ts**
   - ✅ AsterDocumentStore 新增 3 个方法
   - ✅ 注册 3 个新命令
   - ✅ importPaper 初始化新字段

### UI层 (src/ui/)

3. **App.tsx**
   - ✅ openReaderForPaper 添加自动记录查看时间
   - ✅ libraryPanel 配置添加 onToggleRead 和 onToggleFavorite

### 功能层 (src/features/library/)

4. **LibrarySceneSidebar.tsx**
   - ✅ 添加快速访问图标导入
   - ✅ 实现快速访问计算逻辑
   - ✅ 重构侧边栏UI结构

5. **LibraryScene.tsx**
   - ✅ 更新 visiblePapers 过滤逻辑
   - ✅ 更新 activeFolderLabel 显示

6. **LibraryDetailPanel.tsx**
   - ✅ 添加图标导入
   - ✅ 新增状态区域和按钮

7. **types.ts**
   - ✅ LibraryDetailPanelProps 添加回调函数类型

### 样式 (src/ui/styles/)

8. **library.css**
   - ✅ 新增 `.detail-status-actions` 样式
   - ✅ 新增 `.status-button` 及其变体样式

## 数据持久化

所有文献状态变更会自动持久化到本地存储：

```typescript
private persist() {
  this.repository.save(this.documents);
}
```

每次调用 `toggleRead`、`toggleFavorite`、`updateLastViewedAt` 后自动触发持久化。

## 事件系统

状态变更时触发对应事件：

```typescript
this.events.emit('document.viewed', { paperId, lastViewedAt });
this.events.emit('document.read.toggled', { paperId, isRead });
this.events.emit('document.favorite.toggled', { paperId, isFavorite });
```

## 使用场景

### 场景1：查看最近阅读的文献
1. 用户点击侧边栏 "最近查看"
2. 右侧显示按查看时间倒序排列的文献列表
3. 最近打开的文献排在最前面

### 场景2：管理未读文献
1. 用户导入新文献，自动标记为未读
2. 点击侧边栏 "未读文献" 查看待读列表
3. 打开文献详情，点击"标记为已读"按钮
4. 该文献从未读列表中移除

### 场景3：收藏重要文献
1. 用户在文献详情面板点击星标按钮
2. 文献被添加到收藏
3. 点击侧边栏 "收藏文献" 快速访问所有收藏

### 场景4：查看新导入的文献
1. 批量导入多篇文献
2. 点击 "最近导入" 查看最新的50篇
3. 按导入时间倒序显示

## 向后兼容性

- ✅ 所有新增字段都是可选的（`?:`）
- ✅ 现有文献数据不受影响
- ✅ 旧版本导入的文献会在打开时自动补充新字段
- ✅ 文件夹和标签功能完全保留

## 性能优化

1. **useMemo 缓存计算**：快速访问的过滤逻辑使用 useMemo 缓存
2. **批量操作**：状态更新时只触发一次持久化
3. **限制数量**："最近导入" 限制为50条，避免大列表性能问题

## 已知问题和限制

1. **"最近导入"数量固定**：当前硬编码为50条，未来可配置化
2. **查看时间精度**：基于打开阅读器触发，不包括在列表中选中的操作
3. **批量操作**：暂不支持批量标记已读/收藏，需逐个操作

## 未来优化方向

1. **自定义快速访问**
   - 允许用户创建自定义过滤器
   - 支持拖拽排序快速访问项

2. **更多时间维度**
   - 本周添加
   - 本月添加
   - 最近修改

3. **智能推荐**
   - 基于阅读历史推荐相关文献
   - 未完成阅读的文献提醒

4. **批量操作**
   - 支持批量标记已读
   - 支持批量收藏/取消收藏

5. **统计面板**
   - 阅读统计图表
   - 收藏趋势分析

## 测试验证

✅ 构建测试通过：
```bash
npm run build  # ✓ 构建成功
```

✅ 功能验证：
- 快速访问区域正确显示
- 文献计数准确
- 过滤逻辑正常工作
- 状态按钮响应正确
- 数据持久化成功

## 总结

本次更新完整实现了文献库的快速访问和状态管理功能，极大提升了文献管理的效率。用户现在可以：

- 快速找到最近查看或导入的文献
- 方便地管理未读文献列表
- 收藏重要文献以便快速访问
- 自动记录阅读历史

所有功能已经过完整测试，可以正常使用。🎉
