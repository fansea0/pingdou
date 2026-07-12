# 拼豆图：放大预览 + 色号对照表 + 合成导出 - 设计文档

- **日期**: 2026-07-12
- **作者**: 通过 brainstorming 流程生成
- **状态**: 待实施
- **依赖**: 已存在的 MVP（`docs/superpowers/specs/2026-07-12-pingdou-design.md`）

## 一、需求文档

### 1.1 背景

MVP 完成后发现核心体验缺陷：缩略图看不清每格色号、配方表要导出 CSV 才看得到、导出三件套不方便分享。本变更聚焦**预览体验**与**分享能力**两个体验痛点。

### 1.2 用户故事

| ID | 故事 | 验收 |
|----|------|------|
| ZL-1 | 作为玩家，我希望预览大到能看清每个色号 | 预览 cellPx ≥ 24，每格编号肉眼可读 |
| ZL-2 | 作为玩家，我希望预览区超出容器时能滚动查看 | overflow: auto 滚动 |
| ZL-3 | 作为玩家，我希望右侧有实时色号对照表，列出使用了哪些色及数量 | 列出 color swatch / 色号 / 名称 / 数量 |
| ZL-4 | 作为玩家，我希望对照表与拼豆图联动（hover 一行 → 拼豆图上该色号格子高亮） | hover 行为生效，离开恢复 |
| ZL-5 | 作为玩家，我希望导出一张图就能分享（拼豆图 + 对照表合在一起） | 单张 PNG，拼豆图在上、对照表在下 |
| ZL-6 | 作为玩家，我希望导出图里的拼豆图本身含色号文字（不用单独看标注图） | 标注图 + 对照表合一 |

### 1.3 范围 / 非目标

**范围内**：
- 预览固定 cellPx=24 + 滚动容器
- 右侧 ColorLegend 实时派生 + hover 联动
- 单张合成图导出（PNG，含拼豆图本体带色号标注 + 下方对照表）
- 维持现有"用户不上传图就看不到预览"模式

**非目标（明确不做）**：
- ❌ 可缩放/可拖拽画布
- ❌ 鼠标移动放大镜
- ❌ 对照表排序自定义（仅 count desc）
- ❌ 对照表复制色号按钮
- ❌ 导出格式选择（PNG only）
- ❌ 网格滚动跟随 hover

### 1.4 成功标准

- 200×200 合成图渲染 ≤ 1.5s
- hover 高亮响应 < 50ms（仅画 overlay 图层，不重渲全图）
- 现有 31 个单测 0 回归
- 现有"导出三件套"行为保留或下线（待 §6 决定，默认下线）

## 二、实现方案

### 2.1 复用现有架构

不动：`sampler / ditherer / quantizer / renderer / annotator / recipe / pipeline`
改动：`PreviewCanvas.tsx`（扩展）、`ExportPanel.tsx`（简化）、`App.tsx`（布局重构）
新增：`legend.ts`（pure-fn）、`composite.ts`（pure-fn）、`ColorLegend.tsx`（UI）

### 2.2 数据流（单一可信源）

```
Pipeline result (indices, gridSize)  ←  唯一可信源
    │
    ├──► PreviewCanvas  (固定 cellPx=24，溢出滚动)
    │
    ├──► ColorLegend    (派生 legend = computeLegend(indices, palette))
    │       │
    │       └── onHoverIndex(n) ──► App 高亮 state ──► PreviewCanvas overlay 图层
    │
    └──► Composite      (导出时合成：标注图 + 对照表)
```

**关键约束**：同一份 `indices`，preview/legend/export 三视图**永远一致**，不存在数据同步问题。

### 2.3 模块接口

```ts
// src/pipeline/legend.ts (new)
export interface LegendRow {
  readonly id: string;                       // "A01"
  readonly name: string;                     // "白"
  readonly rgb: readonly [number, number, number];
  readonly count: number;
  readonly index: number;                    // palette 索引，用于联动
}

export function computeLegend(
  indices: Uint8Array,
  palette: Palette
): LegendRow[];
// 行为：遍历 indices 计数，按 count desc 排序，仅返回 count > 0

// src/pipeline/composite.ts (new)
export interface CompositeOptions {
  readonly cellPx: number;             // 推荐 ≥ 24
  readonly fontPx: number;             // 标注图文字大小
  readonly cellGap: number;            // 拼豆图与对照表之间的留白（默认 40）
  readonly legendRowHeight: number;    // 对照表行高（默认 36）
  readonly legendColWidth: number;     // 对照表色块列宽（默认 60）
  readonly legendPadding: number;      // 对照表内边距（默认 16）
}

export function renderComposite(
  indices: Uint8Array,
  gridSize: number,
  palette: Palette,
  options?: Partial<CompositeOptions>
): HTMLCanvasElement;
// 行为：返回一张 canvas，
//      上半 = 带色号标注的拼豆图（复用 renderAnnotatedImage）
//      下半 = 对照表（色块 / 色号 / 名称 / 计数）
// 宽 = max(拼豆图宽, 对照表宽)
// 高 = 拼豆图高 + cellGap + 对照表高

// src/components/ColorLegend.tsx (new)
interface ColorLegendProps {
  legend: LegendRow[];
  highlightedIndex: number | null;
  onHoverIndex: (idx: number | null) => void;
}

// src/components/PreviewCanvas.tsx (extended)
interface PreviewCanvasProps {
  result: PipelineResult | null;
  palette: Palette;
  cellPx: number;                       // 固定 24
  highlightedIndex: number | null;      // 新增
  isRecomputing: boolean;
}
```

### 2.4 App.tsx 三列布局

```
┌─────────────┬──────────────────────────────┬──────────────┐
│ UploadZone  │                              │              │
│ ParamPanel  │   PreviewCanvas              │              │
│ ExportPanel │   (固定 cellPx=24,           │ ColorLegend  │
│             │    overflow: auto,           │ (实时 + hover │
│             │    highlightedIndex overlay) │  联动)        │
│             │                              │              │
└─────────────┴──────────────────────────────┴──────────────┘
```

## 三、数据存储

本变更不新增任何持久化数据。现有 IndexedDB 缓存（色板）不动。

## 四、TODO

### 4.1 实施任务

- [ ] `src/pipeline/legend.ts` - pure function `computeLegend`
- [ ] `src/pipeline/legend.test.ts` - 单测 4 条
- [ ] `src/pipeline/composite.ts` - pure function `renderComposite`
- [ ] `src/pipeline/composite.test.ts` - 单测 3 条
- [ ] `src/components/ColorLegend.tsx` - UI 组件 + hover 联动
- [ ] 修改 `src/components/PreviewCanvas.tsx` - 增加 highlightedIndex + 滚动容器 + overlay 图层
- [ ] 修改 `src/components/ExportPanel.tsx` - 简化文案、调整 props（新增 highlightedIndex）
- [ ] 重构 `src/App.tsx` - 三列布局、legend 派生、highlight state、export 单图
- [ ] 修改 `src/pipeline/pipeline.ts` - `exportAll` 改为只导合成图（移除原三件套逻辑，详见 §6）
- [ ] 修改 `src/pipeline/exporter.ts` - 新增 `triggerDownloadSingle(blob, filename)` 或复用现有
- [ ] 修改 `tests/e2e/flow.spec.ts` - 增加 hover 高亮 + 合成图导出用例
- [ ] README 更新 - "高亮联动 + 合成导出" 一节

### 4.2 验收清单

- [ ] 新增 7 条单测通过
- [ ] 现有 31 条单测 0 回归
- [ ] typecheck 0 错误
- [ ] production build 通过（产物 < 200KB gzipped）
- [ ] Playwright E2E 增加 2 条用例通过
- [ ] 桌面 Chrome / Safari 手测一次

## 五、常量、状态映射

### 5.1 视觉常量

| 常量 | 值 | 说明 |
|------|----|------|
| `PREVIEW_CELL_PX` | 24 | 预览固定 cellPx |
| `COMPOSITE_CELL_PX` | 32 | 导出合成图 cellPx |
| `COMPOSITE_FONT_PX` | 12 | 合成图标号文字大小（cellPx × 0.375）|
| `COMPOSITE_CELL_GAP` | 40 | 拼豆图与对照表间距 |
| `LEGEND_ROW_HEIGHT` | 36 | 对照表行高 |
| `LEGEND_COL_WIDTH` | 60 | 对照表色块列宽 |
| `LEGEND_PADDING` | 16 | 对照表内边距 |
| `HIGHLIGHT_OVERLAY_COLOR` | `'rgba(255,235,59,0.6)'` | 高亮色（半透明黄）|

### 5.2 App 状态扩展

```ts
// 新增到 App 局部 state
const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null);
const [exporting, setExporting] = useState(false);
```

## 六、接口协议

### 6.1 现有导出三件套的处理（决策点）

原 `pipeline.exportAll` 导出三件套（色块大图 + 标注图 + CSV）。新 spec 要求"导出一张组合图"。

**默认决策**：移除三件套导出。理由：
- 组合图已经包含色块大图 + 标注图（叠加在同一张里）
- CSV 配方表的信息已经被右侧 ColorLegend 实时覆盖，且组合图下方对照表也有"数量"列
- 用户可手动汇总（保留 CSV 是 nice-to-have，但 MVP 阶段可以下线）

**保留路径（可选）**：如需 CSV，下载由 ColorLegend 旁的"下载 CSV"按钮触发，**不影响** 主导出按钮。

### 6.2 导出按钮文案

旧："导出三件套"  
新："导出合成图"

### 6.3 错误处理

| 错误 | 严重度 | 反馈 |
|------|--------|------|
| 合成图 canvas 创建失败 | error | toast「浏览器内存不足」 |
| 合成图渲染超 5s | warn | toast「图像较大，请耐心等待」 |
| 对照表 0 行 | warn | 界面对照表区域显示「当前图像未匹配到任何色号」 |

## 七、服务发布

本变更无服务端。"发布"沿用 Vite 静态构建 + 任意静态托管。
- 构建产物 `dist/`：预计增量 < 20KB gzipped（新增 2 个 pure-fn + 1 个 UI 组件 + 1 个 overlay 渲染）
- 缓存策略：同 MVP（`index.html` 不缓存，assets 强缓存）

## 八、CR 点（自查清单）

实施时关注：

- [ ] `computeLegend` / `renderComposite` 是 pure function，不依赖 React，不读 DOM 状态
- [ ] highlightedIndex 不进入 pipeline（不改 indices），仅 UI 局部 state
- [ ] preview 的高亮通过单独 canvas overlay 实现，**不重画整个拼豆图**
- [ ] 对照表派生 `useMemo([result, palette])`，避免每次 render 重算
- [ ] 合成图大尺寸（500×500 + cellPx=32 ≈ 200MB 内存）需加内存提示或 size guard
- [ ] hover 离开事件正确清除 highlightedIndex（避免卡住高亮）
- [ ] 不破坏现有 31 个测试 + 不修改 sampler/ditherer/quantizer/renderer/annotator/recipe
- [ ] App 三列布局在 1024px 窄屏降级为单列堆叠（响应式）
- [ ] README "高亮联动 + 合成导出" 节配图（或说明文字）

## 九、实施步骤

按"自底向上"：

### Step 1: pure-fn legend
1. 实现 `computeLegend` + 单测

### Step 2: pure-fn composite
2. 实现 `renderComposite`（先调现有 `renderAnnotatedImage` 拿上半部分，再画下半部分对照表到同一 canvas）
3. 单测：canvas 尺寸、上下两部分都在同一 canvas、对照表行数与 computeLegend 一致

### Step 3: ColorLegend UI
4. 实现 `ColorLegend.tsx` 组件 + hover 事件

### Step 4: PreviewCanvas 扩展
5. 增加 highlightedIndex prop
6. 实现 overlay 图层绘制（透明 fillRect 覆盖匹配的格子）

### Step 5: 装配 + 重构
7. App.tsx 三列布局 + legend 派生 + highlight state
8. ExportPanel.tsx 简化文案
9. pipeline.exportAll 改造为只导出合成图

### Step 6: E2E + 文档
10. Playwright 增加 hover + 导出合成图两条用例
11. README 增加 "高亮联动 + 合成导出" 节

---

## 附录 A：对照表示例（视觉约定）

```
┌──────────────────────────────────────────────┐
│ 拼豆图（含色号文字标注）                      │
│   ┌─┬─┬─┬─┐                                  │
│   │A01│A05│A07│ ...                          │
│   ├─┼─┼─┼─┤                                  │
│   │A03│A05│A05│                              │
│   └─┴─┴─┴─┘                                  │
├──────────────────────────────────────────────┤  ← cellGap = 40
│ 色号对照表                                     │
│   ┌──┬────┬─────┬────┐                       │
│   │色块│色号 │名称  │数量│                      │
│   ├──┼────┼─────┼────┤                       │
│   │██ │A05 │灰白 │ 42 │                      │
│   │██ │A01 │白  │ 31 │                      │
│   │██ │A07 │天蓝│ 28 │                      │
│   └──┴────┴─────┴────┘                       │
└──────────────────────────────────────────────┘
```

---

## 自检（写完后再过一遍）

1. **占位符扫描**：无 TBD/TODO/待定项。✓
2. **内部一致性**：架构图 / 数据流 / 接口签名 / TODO 步骤 全对齐。✓
3. **范围检查**：聚焦"放大 + 对照表 + 合成导出"，单 spec 可落地。✓
4. **歧义检查**：
   - §6.1 明确说明三件套下线决定
   - §5.1 数值常量全部给定
   - "高亮" 在 §2.3/2.4/4.2 三处描述一致（hover 行为，离开清除）
5. **回归风险**：明确列出"不动"的现有模块；新增的改动面在 4-5 个文件。✓