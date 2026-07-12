# 拼豆图：响应式布局 + 缩放/平移 - 设计文档

- **日期**: 2026-07-12
- **作者**: 通过 brainstorming 流程生成
- **状态**: 待实施
- **依赖**: 已存在的 MVP + 上两次 zoom/legend/polish spec

## 一、需求文档

### 1.1 背景

上次 UI 美化后，用户反馈两个体验问题：
1. **缺少响应式**：1024px 以下直接堆叠为单列，但 1024-1400px 中间列过宽不好看；缺少中间断点
2. **预览不能放大**：现在预览只是固定 cellPx=24 的小图，玩家看不清单个色号；想要"内嵌屏幕"——画布可缩放、可平移，但不能挤压其他列布局

### 1.2 用户故事

| ID | 故事 | 验收 |
|----|------|------|
| RP-1 | 作为玩家，我希望预览画布随窗口宽度自适应 | 中间列 preview-wrap 设 aspect-ratio: 1/1，canvas 跟随 |
| RP-2 | 作为玩家，我希望页面布局在窄屏（<1024px）下合理堆叠 | 三列变单列，呼吸感一致 |
| RP-3 | 作为玩家，我希望预览有缩放控制条（+/−/复位/数字） | toolbar 浮在画布右上角 |
| RP-4 | 作为玩家，我希望缩放后能拖动平移 | 鼠标拖动画布跟随 |
| RP-5 | 作为玩家，我希望缩放后色号依然清晰 | 用 GPU ctx.scale（不依赖位图缩放）|
| RP-6 | 作为玩家，我希望切换网格/抖动时画布回到初始 | zoom 重置为 1x，pan 重置为 0 |
| RP-7 | 作为玩家，我希望缩放不影响导出图 | composite.ts 不变，导出永远是 cellPx=32 高清 |

### 1.3 范围 / 非目标

**范围内**：
- 中间断点 1400px（左右列 240px / 中间 1fr）
- 1024px 以下堆叠
- ZoomToolbar（+/- 按钮 + 数字输入 + 复位）
- 拖动平移（mouse events）
- 一键复位
- 切换参数时重置 zoom/pan
- ZOOM_LEVELS: [1, 1.5, 2, 3, 4, 6, 8]

**非目标（明确不做）**：
- ❌ 鼠标滚轮缩放
- ❌ 双指缩放 / 触摸 gesture
- ❌ 自定义缩放档位
- ❌ 双击复位
- ❌ 缩放时同步导出图
- ❌ 平移边界 clamp（允许图像超出，玩家自己拖回）
- ❌ 拖动惯性 / 动效
- ❌ 移动端触摸事件
- ❌ 缩放持久化（不存 localStorage）

### 1.4 成功标准

- 100×100 @ 1x 重画 < 16ms（一帧）
- 500×500 @ 4x 重画 < 200ms（GPU 加速）
- 拖动 mousemove 重画 < 16ms
- 缩放 8x 后色号文字边缘锐利（GPU scale 不模糊）
- 切换网格时 zoom/pan 自动重置
- 导出 PNG 不受 zoom 状态影响

## 二、实现方案

### 2.1 架构图

```
                       App (持 zoom/pan state)
                          │
                          ├─► ZoomToolbar (受控：+/- / 数字 / 复位)
                          │       │
                          │       │ 用户操作
                          │       ▼
                          │   setZoom / setPan ──┐
                          │                       │
                          ▼                       │
                  PreviewCanvas ◄──────────────────┘
                  (受控 zoom, pan + 重绘 useEffect)
                       │
                       ├─ 内置 mousedown/move/up 拖动
                       └─ 每次绘制:
                            ctx.save()
                            ctx.translate(panX, panY)
                            ctx.scale(zoom, zoom)
                            drawImage(beadCanvas)
                            ctx.restore()
```

### 2.2 文件清单

| 路径 | 动作 | 责任 |
|------|------|------|
| `src/hooks/useZoomPan.ts` | 新建 | 缩放/平移状态 hook + ZOOM_LEVELS 常量 |
| `src/components/ZoomToolbar.tsx` | 新建 | 缩放控制条 UI |
| `src/components/ZoomToolbar.test.tsx` | 新建 | 单测 4 条 |
| `src/components/PreviewCanvas.tsx` | 修改 | 应用 zoom/pan + 拖动事件 |
| `src/App.tsx` | 修改 | 持 zoom/pan state + 切换参数时重置 |
| `src/styles/global.css` | 修改 | 加 1400px 断点 + aspect-ratio + toolbar 样式 |

### 2.3 接口签名

```ts
// src/hooks/useZoomPan.ts
export interface ZoomPanState {
  readonly zoom: number;
  readonly panX: number;
  readonly panY: number;
}

export const ZOOM_LEVELS: readonly number[] = [1, 1.5, 2, 3, 4, 6, 8];
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 8;

export function useZoomPan(): {
  zoom: number;
  panX: number;
  panY: number;
  setZoom: (z: number) => void;
  setPan: (x: number, y: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
};
```

```tsx
// src/components/ZoomToolbar.tsx
interface Props {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  onZoomChange: (z: number) => void;  // 数字输入框
  disabled: boolean;
}

// src/components/PreviewCanvas.tsx (extended)
interface Props {
  result: PipelineResult | null;
  palette: Palette;
  cellPx: number;
  zoom: number;          // 新增
  panX: number;          // 新增
  panY: number;          // 新增
  onPan: (x: number, y: number) => void;  // 新增
  isRecomputing: boolean;
}
```

### 2.4 渲染逻辑

```tsx
// PreviewCanvas 内部 useEffect
useEffect(() => {
  if (!result || !ref.current) return;
  const c = renderPaletteImage(result.indices, result.gridSize, palette, cellPx, '#ddd');
  const ctx = ref.current.getContext('2d')!;
  ref.current.width = c.width;
  ref.current.height = c.height;

  ctx.fillStyle = '#fafafa';
  ctx.fillRect(0, 0, c.width, c.height);

  if (zoom !== 1 || panX !== 0 || panY !== 0) {
    ctx.save();
    ctx.translate(panX, panY);
    ctx.scale(zoom, zoom);
    ctx.drawImage(c, 0, 0);
    ctx.restore();
  } else {
    ctx.drawImage(c, 0, 0);
  }
}, [result, palette, cellPx, zoom, panX, panY]);
```

### 2.5 拖动平移实现

```tsx
const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);

const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
  if (zoom === 1) return;  // 1x 时不允许拖动
  dragRef.current = {
    startX: e.clientX, startY: e.clientY,
    baseX: panX, baseY: panY,
  };
};

const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
  if (!dragRef.current) return;
  const dx = e.clientX - dragRef.current.startX;
  const dy = e.clientY - dragRef.current.startY;
  onPan(dragRef.current.baseX + dx, dragRef.current.baseY + dy);
};

const onMouseUp = () => { dragRef.current = null; };
```

### 2.6 ZoomToolbar 布局

```
预览容器右上角，position: absolute; top: var(--space-3); right: var(--space-3);

┌─────────┐
│    −    │   ← 缩小
│  1.5x   │   ← 当前缩放 (input number, 1-8)
│    +    │   ← 放大
│    ⊕    │   ← 复位
└─────────┘
```

### 2.7 响应式 CSS

```css
/* 桌面默认（1400+） */
.layout-3col {
  grid-template-columns: var(--left-col-w) 1fr var(--right-col-w);
}

/* 中等屏（1024-1400） */
@media (max-width: 1400px) {
  .layout-3col {
    grid-template-columns: 240px 1fr 240px;
  }
}

/* 窄屏（<1024）堆叠 */
@media (max-width: 1024px) {
  .layout-3col {
    grid-template-columns: 1fr;
  }
}

/* 预览容器自适应 */
.preview-wrap {
  width: 100%;
  aspect-ratio: 1 / 1;
  /* 移除之前的 min-height */
}
```

### 2.8 CSS 变量扩展

```css
:root {
  /* ...已有变量... */
  --zoom-toolbar-w: 48px;
}
```

## 三、数据存储

无新增 / 修改任何持久化数据。zoom/pan 是 UI 局部 state，不入 IndexedDB、不入 localStorage。

## 四、TODO

### 4.1 实施任务

- [ ] `src/hooks/useZoomPan.ts` —— hook + ZOOM_LEVELS 常量
- [ ] `tests/unit/useZoomPan.test.ts`（或 component test）—— 单测 4 条
- [ ] `src/components/ZoomToolbar.tsx` —— 组件
- [ ] `src/components/ZoomToolbar.test.tsx` —— 单测 4 条
- [ ] `src/components/PreviewCanvas.tsx` —— 加 zoom/pan props + 拖动事件 + ctx.transform
- [ ] `src/components/PreviewCanvas.test.tsx`（新建）—— 单测 3 条（ctx.translate/scale 调用）
- [ ] `src/App.tsx` —— 持 zoom/pan state + 切换参数时重置
- [ ] `src/styles/global.css` —— 加响应式断点 + aspect-ratio + toolbar 样式
- [ ] `tests/e2e/flow.spec.ts` —— 加 1-2 个缩放 E2E 用例

### 4.2 验收清单

- [ ] useZoomPan 4 个单测通过
- [ ] ZoomToolbar 4 个单测通过
- [ ] PreviewCanvas 3 个单测通过
- [ ] typecheck 0 错误
- [ ] npm test 现有 45 + 新增 11 = **56 个** 通过
- [ ] npm run build 通过
- [ ] 浏览器手测：1024/1400/800 三个断点 + zoom 1-8x + 拖动 + 复位

## 五、常量映射

| 常量 | 值 | 用途 |
|------|----|------|
| `ZOOM_LEVELS` | [1, 1.5, 2, 3, 4, 6, 8] | 缩放档位 |
| `MIN_ZOOM` | 1 | 最小缩放 |
| `MAX_ZOOM` | 8 | 最大缩放 |
| 左列宽（桌面） | 280px | `--left-col-w` |
| 右列宽（桌面） | 300px | `--right-col-w` |
| 左/右列宽（中等） | 240px | @media (max-width: 1400px) |
| 1024px | 断点 | @media (max-width: 1024px) 单列 |

## 六、接口协议

### 6.1 不变的接口

- `computeLegend(indices, palette)` —— 不变
- `renderComposite(...)` —— 不变（导出图不受 zoom 影响）
- `pipeline.process(...)` / `pipeline.exportComposite(...)` —— 不变
- `usePalette()` / `usePipeline()` —— 不变
- `ColorLegend` / `ZoomToolbar` 之外的所有 UI 组件 props —— 不变

### 6.2 变更的接口

```tsx
// PreviewCanvas.tsx: 新增 4 个 props
+ zoom: number
+ panX: number
+ panY: number
+ onPan: (x: number, y: number) => void
```

## 七、服务发布

无后端变更。沿用 Vite 静态构建 + 任意静态托管。
- 构建产物 `dist/`：预计增量 < 10KB gzipped（ZoomToolbar 组件 + useZoomPan hook）

## 八、CR 点

- [ ] zoom/pan state 由 App 持有，ZoomToolbar 和 PreviewCanvas 都受控
- [ ] canvas 元素 width/height 固定 `cellPx × gridSize`，**不随 zoom 变化**（位图清晰度恒定）
- [ ] ctx.scale 在 zoom=1 时跳过（节省开销）
- [ ] 拖动只在 zoom > 1 时启用（zoom=1 时光标不变 grab）
- [ ] 切换网格/抖动/上传时**重置 zoom=1 + pan=0**
- [ ] 1024px 以下三列堆叠为单列
- [ ] 1400px 以下左右列收缩为 240px
- [ ] ZoomToolbar 在画布右上角绝对定位
- [ ] ZOOM_LEVELS 含 1, 1.5, 2, 3, 4, 6, 8
- [ ] Toolbar 数字输入框越界值按 Enter 裁剪
- [ ] 导出 PNG 不受 zoom 状态影响（始终 cellPx=32 高清）

## 九、实施步骤

按"风险递增"顺序：

1. **useZoomPan hook + 单测**（最底层，pure 状态逻辑）
2. **ZoomToolbar 组件 + 单测**（受控 UI，逻辑简单）
3. **PreviewCanvas zoom/pan/拖动 + 单测**（核心交互逻辑）
4. **App.tsx 接入 + 切换参数时重置**
5. **global.css 响应式 + toolbar 样式**
6. **E2E 增加 1-2 用例**（缩放/复位）
7. **最终验收**

---

## 自检（写完后再过一遍）

1. **占位符扫描**：无 TBD/TODO/待定项。✓
2. **内部一致性**：架构图 / 接口 / TODO / CR 全对齐。✓
3. **范围检查**：聚焦"响应式 + 缩放/平移"，单 spec 可落地。✓
4. **歧义检查**：
   - §2.7 完整列出三个断点的 CSS
   - §2.4 zoom=1 跳过 ctx.save/restore 已明确
   - §2.5 zoom=1 时禁用拖动已明确
   - "内嵌屏幕" = canvas 跟随容器 (aspect-ratio) + ctx.scale 缩放 + 拖动平移，三处描述一致
5. **回归风险**：明确列出"不变"的接口；新增面在 5 个文件 + 1 个测试文件。✓