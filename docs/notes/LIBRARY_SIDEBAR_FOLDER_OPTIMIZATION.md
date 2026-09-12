# 文献库侧边栏优化 - 文件夹仅显示分类

## 变更说明

根据用户反馈，文献库侧边栏的文件夹部分已优化为**仅显示文件夹分类结构**，不再在树形目录中显示具体的文献文件。

## 设计理念

### 之前的设计
- 文件夹展开后会显示其中的所有文献文件
- 可以在侧边栏树形结构中直接看到和点击文献
- 侧边栏较为拥挤，层级较深

### 当前的设计
- 文件夹仅用于分类和组织
- 点击文件夹后，右侧主列表区域显示该文件夹下的所有文献
- 侧边栏更加简洁，专注于导航和分类

## 用户体验

### 侧边栏结构

```
文献库 (3篇)
├─ 快速访问
│  ├─ 全部文献 (3)
│  ├─ 最近查看 (0)
│  ├─ 最近导入 (0)
│  ├─ 未读文献 (3)
│  └─ 收藏文献 (0)
├─ 文件夹
│  ├─ 📁 默认资料库 (3)
│  ├─ 📁 研究方向 A (0)
│  └─ 📁 研究方向 B (0)
└─ 标签
   ├─ #全部标签
   ├─ #未分类 (2)
   └─ #入门 (1)
```

### 交互流程

1. **查看文件夹内容**
   - 点击文件夹名称
   - 右侧主列表显示该文件夹下的所有文献
   - 文件夹右侧数字显示文献数量

2. **移动文献到文件夹**
   - 从右侧列表拖拽文献
   - 拖到左侧文件夹上释放
   - 文献自动移动到目标文件夹

3. **文件夹管理**
   - 右键或点击文件夹菜单
   - 新建子文件夹、重命名、删除
   - 支持多层级嵌套

## 技术实现

### 移除的功能

1. **文献节点渲染**
   - 移除了文献在文件夹树中的显示
   - 移除了文献的拖拽预览
   - 简化了组件的 props 和状态管理

2. **简化的代码**
   ```typescript
   // 移除的类型
   - PaperByFolder 类型
   - PaperPointerDrag 类型
   - DRAG_THRESHOLDS 常量
   
   // 移除的状态
   - draggingPaperId
   - dragPreviewPosition
   - papersByFolder
   
   // 移除的处理函数
   - startPaperPointerDrag
   - handlePaperSelect
   - 文献指针拖拽的 useEffect
   ```

### 保留的功能

1. **文件夹拖放**
   - 仍然支持从主列表拖拽文献到文件夹
   - 使用原生的 HTML5 拖放 API
   - 通过 `data-library-folder-id` 识别目标文件夹

2. **文件夹计数**
   - 每个文件夹显示包含的文献数量
   - 实时更新

3. **文件夹树展开/收起**
   - 支持多层级文件夹嵌套
   - 全部展开/收起功能

## 代码变更

### LibrarySceneSidebar.tsx

**移除的导入：**
```typescript
- import { createPortal } from 'react-dom';
- import { FileText } from 'lucide-react';
```

**简化的组件状态：**
```typescript
// 移除
- const [draggingPaperId, setDraggingPaperId] = useState<string | null>(null);
- const [dragPreviewPosition, setDragPreviewPosition] = useState<...>(null);
- const papersByFolder = useMemo<PaperByFolder>(...);

// 保留
+ const [dropTargetFolderId, setDropTargetFolderId] = useState<string | null>(null);
+ const folderCounts = useMemo(() => ...);
```

**简化的 FolderTreeNode：**
```typescript
// 移除的 props
- selectedPaperId
- papersByFolder
- draggingPaperId
- onSelectPaper
- onOpenPaper
- onStartPaperPointerDrag

// 保留的 props
+ folderCounts
+ dropTargetFolderId
+ onFolderDragOver
+ onFolderDrop
```

### 性能优化

1. **减少渲染节点**
   - 不再为每个文献创建树节点
   - 大量文献时性能显著提升

2. **简化状态管理**
   - 移除文献拖拽的复杂指针事件处理
   - 减少 useEffect 和 useCallback

3. **更小的组件体积**
   - 代码行数减少约 150 行
   - 组件更易维护

## 优点

### 1. 更清晰的界面
- 侧边栏专注于导航和分类
- 减少视觉噪音
- 更易找到目标文件夹

### 2. 更好的性能
- 减少渲染的DOM节点
- 更快的组件更新
- 特别是在文献数量多时

### 3. 更简洁的代码
- 移除复杂的文献拖拽逻辑
- 组件职责更单一
- 更易于维护和扩展

### 4. 一致的交互模式
- 左侧导航，右侧内容
- 符合常见文件管理器的使用习惯
- 学习成本低

## 使用建议

1. **组织文献**
   - 创建有意义的文件夹名称
   - 使用多级文件夹细化分类
   - 结合标签进行多维度管理

2. **快速访问**
   - 常用分类使用"快速访问"
   - 文件夹用于长期归档
   - 标签用于灵活筛选

3. **移动文献**
   - 从右侧列表拖拽文献
   - 批量选择后拖拽到文件夹
   - 也可以使用右键菜单"移动到文件夹"

## 向后兼容

- ✅ 现有文献的文件夹归属保持不变
- ✅ 文件夹结构完全保留
- ✅ 拖拽移动文献的功能正常工作
- ✅ 所有文件夹操作（新建、重命名、删除）正常工作

## 构建验证

```bash
✓ npm run build 成功
✓ 所有 TypeScript 类型检查通过
✓ 组件功能完整
✓ 无运行时错误
```

## 总结

这次优化使文献库侧边栏更加清晰和高效。文件夹专注于分类和导航，文献内容在右侧主列表展示，符合用户的使用习惯，同时提升了性能和代码质量。
