# 拼豆图：空状态引导文案优化 - 设计文档

- **日期**: 2026-07-13
- **作者**: 通过 brainstorming 流程生成
- **状态**: 待实施
- **依赖**: 已存在的 MVP（无新外部依赖）

## 一、需求文档

### 1.1 背景

用户反馈：**未上传图片时，中间预览区和右侧色号对照表显示不友好**。
- 中间预览区显示一个米色空方框（看起来像 bug）
- 右侧显示"当前图像未匹配到任何色号"（这句话在玩家没上传时也出现，**语义不准确**）
- 两块区域视觉上"很轻"，没有引导

### 1.2 用户故事

| ID | 故事 | 验收 |
|----|------|------|
| ES-1 | 作为玩家，打开页面后能看到明确指引"要上传图片" | 中间预览区显示"上传图片以查看预览" |
| ES-2 | 作为玩家，右侧能知道色号对照表什么时候出现 | 右侧显示"上传图片后查看色号对照表" |
| ES-3 | 作为玩家，上传后两区自动切换到实际内容 | result/legend 更新后空状态文案消失 |
| ES-4 | 作为玩家，视觉上不感觉"页面坏了" | 米色容器保留作为视觉锚点 |

### 1.3 范围 / 非目标

**范围内**：
- `PreviewCanvas` 在 result=null 时显示引导文案
- `ColorLegend` 在 legend=[] 时显示引导文案
- 加 `.empty-state` 通用 CSS 类

**非目标（明确不做）**：
- ❌ 上传图标 / drag-drop 视觉提示
- ❌ 教程视频 / GIF 演示
- ❌ 多语言空状态文案
- ❌ 空状态动画
- ❌ EmptyState 通用组件（YAGNI）
- ❌ 错误态用红色（保持空状态视觉一致）
- ❌ 清除已上传图按钮

### 1.4 成功标准

- 初始空状态：两区显示极简一句话，米色背景
- 上传图片后：两区自动切换到 canvas + 色号表
- 文案居中、字号与现有 `.product-loading` 一致
- typecheck 0 错误；现有 59 测试 0 回归 + 新增 4 测试 = **≥ 63 个** 通过

## 二、实现方案

### 2.1 文件清单

| 路径 | 动作 | 责任 |
|------|------|------|
| `src/components/PreviewCanvas.tsx` | 修改 | result=null 时显示空状态 |
| `src/components/ColorLegend.tsx` | 修改 | legend=[] 时显示空状态 |
| `src/styles/global.css` | 修改 | 加 `.empty-state` 通用类 |

### 2.2 架构图

```
PreviewCanvas (result: null)
   ↓
if (result) → <canvas ref>   // 实际预览
else        → <p.empty-state> "上传图片以查看预览"

ColorLegend (legend: [])
   ↓
if (legend.length > 0) → 表格
else                  → <p.empty-state> "上传图片后查看色号对照表"
```

### 2.3 PreviewCanvas 修改结构

```tsx
export function PreviewCanvas({ result, palette, cellPx, isRecomputing }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!result || !ref.current) return;
    // 现有绘制逻辑（不变）
  }, [result, palette, cellPx]);

  return (
    <div className="preview-wrap">
      <div className={isRecomputing ? 'preview-scroll dim' : 'preview-scroll'}>
        {result ? (
          <canvas ref={ref} className="preview" />
        ) : (
          <p className="empty-state">上传图片以查看预览</p>
        )}
      </div>
      {isRecomputing && <div className="overlay">计算中...</div>}
    </div>
  );
}
```

**关键**：
- 米色容器（`.preview-scroll`）保留，只改其内部
- `result` truthy → 渲染 canvas
- `result` null → 渲染 `<p className="empty-state">`
- `isRecomputing` overlay 不变

### 2.4 ColorLegend 修改结构

```tsx
export function ColorLegend({ legend }: Props) {
  if (legend.length === 0) {
    return (
      <aside className="legend-wrap">
        <p className="empty-state">上传图片后查看色号对照表</p>
      </aside>
    );
  }

  return (
    <aside className="legend-wrap">
      <h3 className="legend-title">色号对照表</h3>
      <p className="legend-subtitle">当前图像所用色号</p>
      <div className="legend-table">
        {/* ... 现有表头 + 数据行 ... */}
      </div>
    </aside>
  );
}
```

**关键**：
- 删除旧的 `<p className="legend-empty">当前图像未匹配到任何色号</p>`（语义不准）
- 改为 `legend.length === 0` 时渲染 `<p className="empty-state">`
- `legend.length > 0` 时保持原有结构

### 2.5 关键边界

1. **不引入新组件**：直接改现有 JSX（YAGNI）
2. **不引入新 prop**：纯文本条件渲染
3. **米色容器保留**：作为视觉锚点，告知用户"这里是预览位置"
4. **CSS 通用化**：`.empty-state` 类，未来其他空状态可复用
5. **不破坏 ProductShowcase**：那里独立用 `.product-loading`/`.product-error`

### 2.6 新增 CSS

```css
.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  min-height: 200px;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
  text-align: center;
  padding: var(--space-5);
}
```

`min-height: 200px` 确保空状态文案不会在窄屏塌缩。

## 三、数据存储

无数据存储变化。

## 四、TODO

### 4.1 实施任务

- [ ] `src/styles/global.css` 加 `.empty-state` 样式
- [ ] `src/components/PreviewCanvas.tsx` 加空状态分支 + 1 个单测
- [ ] `src/components/ColorLegend.tsx` 加空状态分支 + 1 个单测
- [ ] `src/components/PreviewCanvas.test.tsx`（新建）+ 2 个空状态单测
- [ ] `src/components/ColorLegend.test.tsx`（新建）+ 2 个空状态单测

### 4.2 验收清单

- [ ] PreviewCanvas 2 个单测通过
- [ ] ColorLegend 2 个单测通过
- [ ] typecheck 0 错误
- [ ] npm test 现有 59 + 新增 4 = **≥ 63 个** 通过
- [ ] npm run build 通过
- [ ] 浏览器手测初始空状态 + 上传后切换都正确

## 五、常量映射

无新常量。

## 六、接口协议

### 6.1 不变的接口

- 现有所有 props 不变
- 所有 pipeline 模块不变
- 现有所有 CSS 类不变

### 6.2 变更的接口

无 props 变化；仅修改内部 JSX。

## 七、服务发布

无后端变更。沿用 Vite 静态构建。
- 构建产物增量 < 1KB gzipped

## 八、CR 点

- [ ] PreviewCanvas 容器保留，仅改内部
- [ ] ColorLegend 删除旧 "legend-empty" 文案
- [ ] `.empty-state` 通用类，未来可复用
- [ ] 文案与现有 `.product-loading` 视觉一致
- [ ] 文案不超长（极简一句话）
- [ ] 不破坏 result 切换时的重渲染性能
- [ ] 不引入新依赖

## 九、实施步骤

按"风险递增"顺序：

1. **global.css 加 `.empty-state`**（最简单，2 行 CSS）
2. **PreviewCanvas 修改 + 单测**（核心变更 + 测试）
3. **ColorLegend 修改 + 单测**（核心变更 + 测试）
4. **浏览器手测**（验收）

---

## 自检（写完后再过一遍）

1. **占位符扫描**：无 TBD/TODO/待定项。✓
2. **内部一致性**：架构图 / 接口 / TODO / CR 全对齐。✓
3. **范围检查**：聚焦"空状态文案"，单 spec 可落地（4 个文件改动）。✓
4. **歧义检查**：
   - 极简文案 2 句已明确："上传图片以查看预览" / "上传图片后查看色号对照表"
   - 完全保留 PreviewCanvas 容器已明确
5. **回归风险**：明确列出"不变"的接口；新增面在 3 个文件，纯加性变更。✓