# 拼豆图：导出图横向布局 + 静态对照表 + UI 美化 - 设计文档

- **日期**: 2026-07-12
- **作者**: 通过 brainstorming 流程生成
- **状态**: 待实施
- **依赖**: 已存在的 MVP + 上一次 zoom/legend/composite spec

## 一、需求文档

### 1.1 背景

上一次的 zoom/legend/composite 变更落地后，用户反馈了 3 个问题：
1. 导出图色号对照表放在拼豆图下方，玩家查看时需要上下扫视；希望放在右侧
2. 网页端的 hover 高亮联动把拼豆图"弄脏"（半透明黄色覆盖层），看起来不专业；明确禁止
3. 整体 UI 简陋，需要视觉优化

### 1.2 用户故事

| ID | 故事 | 验收 |
|----|------|------|
| PL-1 | 作为玩家，我希望导出图里的对照表在拼豆图**右边**，方便对照 | 合成图布局为"左拼豆图 + 右对照表" |
| PL-2 | 作为玩家，我希望网页端的拼豆图**永远干净**（不被覆盖层弄脏） | 移除所有 hover/click 高亮逻辑；拼豆图渲染不含 overlay 图层 |
| PL-3 | 作为玩家，我希望 UI 看起来清爽现代 | 浅色干净风，柔和阴影、统一圆角、清晰层级 |

### 1.3 范围 / 非目标

**范围内**：
- 导出图布局改为左右（拼豆图 + 对照表）
- 移除 ColorLegend 的所有鼠标交互（纯静态展示）
- 移除 PreviewCanvas 的 highlightedIndex overlay
- 移除 App 的 highlightedIndex state
- 重写 global.css 为浅色干净现代风

**非目标（明确不做）**：
- ❌ 重新引入任何形式的预览高亮（用户明确禁止）
- ❌ 深色主题切换
- ❌ 拖拽排序 / 复制色号 / 任何额外交互
- ❌ 改组件 React 结构（UploadZone / ParamPanel / ExportPanel 不合并不重排）
- ❌ 改组件 props API（只删已有 prop，不增新 prop）
- ❌ 引入 Tailwind / CSS-in-JS（保持原生 CSS）
- ❌ 动画 / 过渡

### 1.4 成功标准

- 导出图：拼豆图在左、垂直居中；对照表在右、垂直居中
- 网页预览：**任何鼠标操作都不会让拼豆图被覆盖**
- UI 视觉：浅色背景 + 白卡片 + 柔和阴影 + 圆角统一
- 0 回归：现有算法逻辑（采样/量化/标注）不变；所有算法单测通过

## 二、实现方案

### 2.1 变更面

| 文件 | 变更类型 | 改动量 |
|------|---------|--------|
| `src/pipeline/composite.ts` | 重写布局算法 | ~30 行 |
| `src/components/ColorLegend.tsx` | 简化（删交互）| -20 行 |
| `src/components/ColorLegend.test.tsx` | 删 1 个测试 + 调整 props | -20 行 |
| `src/components/PreviewCanvas.tsx` | 删 highlightedIndex 相关 | -25 行 |
| `src/App.tsx` | 删 highlightedIndex state | -10 行 |
| `src/styles/global.css` | 重写（顶部 :root 变量）| 全量重写 |
| `tests/e2e/flow.spec.ts` | 删 1 个 hover 测试 | -10 行 |

### 2.2 composite.ts 新布局算法

```
左拼豆图 + 右对照表：

canvasW = beadW + cellGap + legendW
canvasH = max(beadH, legendH)    // 高度对齐到较高者

beadX = 0
beadY = (canvasH - beadH) / 2    // 拼豆图垂直居中
legendX = beadW + cellGap
legendY = (canvasH - legendH) / 2 // 对照表垂直居中
```

**视觉示意**：

```
┌─────────────────────────────────────┐
│  ┌─────────┐   色号对照表            │
│  │         │   ─────────           │
│  │ 拼豆图   │   色块 色号 名称 数量  │
│  │ (含标注) │   ██  A01 红   42    │
│  │         │   ██  A03 蓝   28    │
│  │         │   ██  A05 黄   15    │
│  │         │   ...                 │
│  │         │   合计        283     │
│  └─────────┘                        │
└─────────────────────────────────────┘
```

### 2.3 ColorLegend 静态化

```tsx
// 新接口（移除 highlightedIndex + onHoverIndex）
interface ColorLegendProps {
  legend: LegendRow[];
}

// 组件内：无 onMouseEnter / onMouseLeave / highlighted className
// 渲染纯静态表格
```

### 2.4 PreviewCanvas 简化

```tsx
// 新接口（移除 highlightedIndex）
interface PreviewCanvasProps {
  result: PipelineResult | null;
  palette: Palette;
  cellPx: number;
  isRecomputing: boolean;
}

// 内部：删除 overlay useEffect 和 HIGHLIGHT_COLOR 常量
```

### 2.5 CSS 设计 token

在 `global.css` 顶部集中变量：

```css
:root {
  /* Color */
  --color-bg: #f7f7f8;
  --color-surface: #ffffff;
  --color-text: #1f2328;
  --color-text-muted: #6b7280;
  --color-border: #e5e7eb;
  --color-accent: #2563eb;
  --color-accent-soft: #eff6ff;
  --color-error-bg: #fef2f2;
  --color-error-fg: #b91c1c;

  /* Spacing (4px base) */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;

  /* Radius */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;

  /* Shadow */
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.04);
  --shadow-md: 0 2px 8px rgba(0,0,0,0.06);

  /* Typography */
  --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif;
  --text-xs: 11px;
  --text-sm: 12px;
  --text-base: 14px;
  --text-lg: 16px;
  --text-xl: 18px;
}
```

### 2.6 视觉规范

| 元素 | 规范 |
|------|------|
| 页面背景 | `--color-bg` (#f7f7f8) |
| 卡片 | `--color-surface` + `--radius-md` + 1px `--color-border` + `--shadow-sm` |
| 主按钮 | accent 填充、白字、`--radius-md`、hover 加深 |
| 次按钮 | 透明背景 + 1px border + accent 文字 |
| 输入控件 | 1px border、focus 时 accent 描边 |
| 标题层级 | h1 用 `--text-xl`、h3 用 `--text-base` 加粗 |
| 错误态 | `--color-error-bg` + `--color-error-fg` 文字 |
| 间距节奏 | 卡片内边距 16px，卡片间距 16px，区块间距 24px |

## 三、数据存储

无新增 / 修改任何持久化数据。

## 四、TODO

### 4.1 实施任务

- [ ] 重写 `src/pipeline/composite.ts` —— 左右布局算法
- [ ] 更新 `tests/unit/composite.test.ts` —— 调整 3 个测试断言
- [ ] 简化 `src/components/ColorLegend.tsx` —— 移除 props 和事件
- [ ] 简化 `src/components/ColorLegend.test.tsx` —— 删 hover 测试，调整 props
- [ ] 简化 `src/components/PreviewCanvas.tsx` —— 移除 highlightedIndex 相关
- [ ] 简化 `src/App.tsx` —— 移除 highlightedIndex state
- [ ] 重写 `src/styles/global.css` —— 浅色现代风 + 顶部 :root 变量
- [ ] 更新 `tests/e2e/flow.spec.ts` —— 删 hover 测试
- [ ] 验证：npm test + npm run typecheck + npm run build + 浏览器手测

### 4.2 验收清单

- [ ] composite: canvas 宽 = beadW + cellGap + legendW
- [ ] composite: canvas 高 = max(beadH, legendH)
- [ ] composite: 拼豆图在 canvas 左侧（采样左边 = 拼豆图色）
- [ ] composite: 对照表在 canvas 右侧（采样右边 = 色块色 或 文字）
- [ ] composite: 拼豆图垂直居中
- [ ] ColorLegend: 渲染所有行，不再有 highlighted 类
- [ ] ColorLegend: 不再有鼠标事件
- [ ] 现有 31 + 5 legend + 3 composite = 39 个单测通过（删 1 个 hover 单测）
- [ ] typecheck 0 错误
- [ ] production build 通过
- [ ] 4 个 E2E 用例（删 1 个 hover）通过
- [ ] 浏览器手测：UI 视觉清爽

## 五、常量映射

| 常量 | 值 | 用途 |
|------|----|------|
| `COMPOSITE_CELL_GAP` | 40 | 拼豆图与对照表水平间距 |
| `compositeOptions.legendRowHeight` | 36 | 对照表行高 |
| `compositeOptions.legendColWidth` | 60 | 对照表色块列宽 |
| `compositeOptions.legendPadding` | 16 | 对照表内边距 |
| `--color-accent` | `#2563eb` | 主色（按钮/链接）|
| `--radius-md` | 8px | 卡片/按钮默认圆角 |

## 六、接口协议

### 6.1 变更的函数签名

```ts
// composite.ts: 函数签名不变，仅内部布局算法变更
export function renderComposite(
  indices: Uint8Array,
  gridSize: number,
  palette: Palette,
  options?: Partial<CompositeOptions>
): HTMLCanvasElement;
```

### 6.2 变更的 React props

```tsx
// ColorLegend.tsx: 删除 2 个 props
- highlightedIndex: number | null
- onHoverIndex: (idx: number | null) => void

// PreviewCanvas.tsx: 删除 1 个 prop
- highlightedIndex: number | null
```

### 6.3 不变的接口

- `computeLegend(indices, palette)` —— 不变
- `pipeline.process(...)` / `pipeline.exportComposite(...)` —— 不变
- `usePalette()` / `usePipeline()` —— 不变（只是 usePipeline 的 destructure 不再含 highlightedIndex）
- 所有现有纯函数 API —— 不变

## 七、服务发布

无后端变更。沿用 Vite 静态构建 + 任意静态托管。
- 构建产物 `dist/`：预计增量 < 5KB gzipped（CSS 重写 + 几行 React 变更）

## 八、CR 点

- [ ] composite.ts 新公式：`canvasW = beadW + cellGap + legendW`、`canvasH = max(beadH, legendH)`
- [ ] 拼豆图垂直居中：`beadY = (canvasH - beadH) / 2`
- [ ] 对照表垂直居中：`legendY = (canvasH - legendH) / 2`
- [ ] ColorLegend 完全移除 onHoverIndex 和 highlightedIndex 的引用
- [ ] PreviewCanvas 完全移除 highlightedIndex 的引用
- [ ] App.tsx 完全移除 highlightedIndex state
- [ ] global.css 顶部 :root 集中至少 5 个变量（color / spacing / radius / shadow / font）
- [ ] 不用 emoji、渐变、刺眼颜色
- [ ] 旧测试 0 回归（除删 1 个 ColorLegend hover 单测 + 删 1 个 E2E hover 测试）

## 九、实施步骤

按"风险递增"顺序：

1. **第一步**（影响最小）：删 App.tsx 的 highlightedIndex state（先让代码 build 失败）
2. **第二步**：简化 PreviewCanvas（删除 highlightedIndex prop + overlay）
3. **第三步**：简化 ColorLegend + test
4. **第四步**：更新 E2E（删 hover 测试）
5. **第五步**：重写 composite.ts 布局算法 + 更新 composite 测试
6. **第六步**：重写 global.css（最后做，避免影响前面步骤的视觉验证）
7. **第七步**：最终验收

**为什么这个顺序？**
- 1-4 是"删除型"变更，先做完可以让代码稳定在"无 hover"状态
- 5 是行为变更最复杂的一步（pure-fn），但测试覆盖最完整
- 6 是 UI 美化，风险高但不影响逻辑
- 7 收尾

---

## 自检（写完后再过一遍）

1. **占位符扫描**：无 TBD/TODO/待定项。✓
2. **内部一致性**：架构图 / 接口签名 / TODO 步骤 / CR 点 / DoD 全对齐。✓
3. **范围检查**：聚焦"导出图布局 + 禁用 hover + UI 美化"，单 spec 可落地。✓
4. **歧义检查**：
   - §2.2 明确尺寸公式
   - §2.5 完整列出所有 CSS 变量
   - §4.2 测试断言全部给定
   - "美化" 在 §1.4 + §2.6 + §2.5 三处描述一致（浅色干净现代风 + 不含动画 emoji 渐变）
5. **回归风险**：明确列出"不变"的接口；新增/修改面在 7 个文件但每处改动明确。✓