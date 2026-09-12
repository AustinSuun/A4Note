# 文献库"文件类"优化 - 平铺设计

## 变更概述

根据用户需求，对文献库侧边栏的"文件夹"部分进行了全面重构：

1. ❌ 移除顶部工具栏（新建文件夹、展开/收起按钮）
2. ❌ 隐藏"默认资料库"父级文件夹
3. ✅ 所有分类直接平铺显示
4. ✅ 改名为"文件类"
5. ❌ 移除三个点菜单按钮
6. ✅ 使用右键菜单操作（新建子文件类、重命名、删除）

## 新的设计

### 侧边栏结构

```
文献库 (3篇)
├─ 快速访问
│  ├─ 📚 全部文献 (3)
│  ├─ 🕐 最近查看 (0)
│  ├─ 📥 最近导入 (0)
│  ├─ 📖 未读文献 (3)
│  └─ ⭐ 收藏文献 (0)
│
├─ 文件类                          ← 改名
│  ├─ 📁 研究方向 A (0)            ← 直接平铺，无父级
│  ├─ 📁 研究方向 B (0)
│  └─ 📁 待读资料 (0)
│
└─ 标签
   ├─ #全部标签
   └─ ...
```

### 交互方式

#### 1. **创建新文件类**
- 点击"文件类"标题右侧的 **+** 按钮
- 输入名称后点击"创建"
- 新文件类直接添加到列表中

#### 2. **右键菜单**
- 在任意文件类上**右键点击**
- 弹出菜单包含三个选项：
  - **新建子文件类** - 在当前分类下创建子分类
  - **重命名** - 修改分类名称
  - **删除** - 删除该分类

#### 3. **选择文件类**
- 左键点击文件类名称
- 右侧列表显示该分类下的所有文献
- 文献数量显示在分类名称右侧

#### 4. **移动文献**
- 从右侧列表拖拽文献
- 拖到左侧文件类上释放
- 文献自动移动到目标分类

## 技术实现

### 移除的功能

1. **顶部工具栏**
   ```typescript
   // 移除
   - 新建文件夹按钮 <FolderPlus>
   - 全部展开按钮 <ChevronsUpDown>
   - 全部收起按钮 <ChevronsDownUp>
   ```

2. **展开/收起逻辑**
   ```typescript
   // 移除
   - toggleExpanded()
   - setAllExpanded()
   - 展开箭头图标 <ChevronRight>
   ```

3. **三个点菜单**
   ```typescript
   // 移除
   - <MoreHorizontal> 图标
   - <details> / <summary> 下拉菜单
   ```

4. **默认资料库过滤**
   ```typescript
   // 只显示非系统文件夹
   folderTree.filter(f => f.folderId !== 'library')
   ```

### 新增的功能

1. **右键菜单**
   ```typescript
   function showContextMenu(
     event: React.MouseEvent,
     folder: LibraryFolder,
     onCreateSubfolder: (parentId: string) => void,
     onStartRename: (folder: LibraryFolder) => void,
     onDeleteFolder: (folderId: string) => void | Promise<void>
   )
   ```

2. **右键菜单样式**
   ```css
   .library-sidebar-context-menu {
     position: fixed;
     z-index: 1000;
     /* 卡片样式 */
   }
   ```

### 代码变更

#### LibrarySceneSidebar.tsx

**移除的导入：**
```typescript
- ChevronRight
- ChevronsDownUp  
- ChevronsUpDown
- MoreHorizontal
```

**保留的导入：**
```typescript
+ FolderPlus (仅用于标题右侧的 + 按钮)
+ Folder, FolderOpen
+ Pencil, Trash2 (用于右键菜单图标)
```

**简化的逻辑：**
```typescript
// 移除
- toggleExpanded()
- setAllExpanded()
- hasChildren 判断
- 展开/收起状态管理

// 保留
+ 平铺显示所有分类
+ 右键菜单处理
+ 创建/重命名/删除功能
```

**UI 变更：**
```tsx
// 过滤掉默认资料库
{folderTree.filter(f => f.folderId !== 'library').map((folder) => 
  renderFolder(folder, 0)
)}

// 移除展开箭头
<span className="file-tree-caret-spacer" aria-hidden="true" />

// 添加右键菜单
onContextMenu={(event) => {
  if (!isSystemFolder) {
    event.preventDefault();
    showContextMenu(event, folder, ...);
  }
}}
```

## 样式更新

### 新增样式

```css
/* Right-click context menu */
.library-sidebar-context-menu {
  display: grid;
  min-width: 165px;
  gap: 2px;
  padding: 4px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--surface);
  box-shadow: 0 8px 24px rgba(27, 42, 34, 0.14);
  position: fixed;
  z-index: 1000;
}

.library-sidebar-context-menu button {
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 29px;
  padding: 0 8px;
  border-radius: 4px;
  background: transparent;
  color: var(--ink);
  font-size: var(--ui-caption-font-size);
  cursor: pointer;
}

.library-sidebar-context-menu button:hover {
  background: var(--surface-soft);
  color: var(--accent-strong);
}

.library-sidebar-context-menu button.danger {
  color: #9a4b42;
}

.library-sidebar-context-menu button.danger:hover {
  background: #fff0ef;
  color: #8f4137;
}
```

## 用户体验提升

### 优点

1. **更简洁的界面**
   - 移除了复杂的工具栏
   - 文件类直接平铺，一目了然
   - 没有展开/收起的认知负担

2. **更直观的操作**
   - 右键菜单符合桌面应用习惯
   - 减少了点击步骤（不需要先点三个点）
   - 菜单只在需要时出现，不占用空间

3. **更统一的命名**
   - "文件类"更准确地描述其用途
   - 与"标签"形成对比，便于理解

4. **更清晰的层级**
   - 去除"默认资料库"这个中间层
   - 用户创建的分类直接展示
   - 支持子分类但不强制使用

### 使用场景

#### 场景1：创建新分类
1. 点击"文件类"旁的 **+** 按钮
2. 输入"机器学习论文"
3. 点击"创建"
4. 新分类出现在列表中

#### 场景2：整理文献
1. 在"机器学习论文"上右键
2. 选择"新建子文件类"
3. 创建"深度学习"子分类
4. 拖拽相关文献到对应分类

#### 场景3：重命名分类
1. 在分类上右键
2. 选择"重命名"
3. 输入新名称
4. 按回车或点击"保存"

#### 场景4：删除无用分类
1. 在分类上右键
2. 选择"删除"
3. 确认后删除（文献不会被删除，会回到默认）

## 向后兼容

- ✅ 现有的文件夹数据完全保留
- ✅ 文献的分类归属不受影响
- ✅ 拖拽移动功能正常工作
- ✅ 子文件夹结构保持不变
- ⚠️  "默认资料库"(library)不再显示，但仍然存在
- ⚠️  直接归属于"默认资料库"的文献需要手动分类

## 构建验证

```bash
✓ npm run build 成功
✓ TypeScript 编译通过
✓ 无运行时错误
✓ 右键菜单正常工作
```

## 代码统计

```
减少的代码：
- 移除工具栏：~20行
- 移除展开逻辑：~15行
- 移除三个点菜单：~25行
总计减少：~60行

新增的代码：
+ 右键菜单函数：~60行
+ 右键菜单样式：~45行
总计新增：~105行

净增加：~45行
```

## 总结

这次重构使文献库的分类管理更加简洁和直观：

1. **简化界面** - 移除不必要的工具栏和按钮
2. **平铺设计** - 所有分类直接展示，无需展开
3. **右键操作** - 符合桌面应用的交互习惯
4. **更好的命名** - "文件类"准确描述功能
5. **保持灵活** - 仍然支持子分类和拖拽

用户现在可以用更少的点击、更直观的方式管理文献分类！🎉
