# 拼豆图：手机端响应式 + 进度条网格 + 豆子数提示 - 设计文档

- **日期**: 2026-07-14
- **作者**: 通过 brainstorming 流程生成
- **状态**: 待实施
- **依赖**: 已存在的 MVP（含最近 default-rabbit-ui-polish 改动）

## 一、需求文档

### 1.1 背景

用户反馈：
1. **手机端体验差**——三列布局在窄屏挤一起，需要响应式
2. **网格档位过大**——最小 50、最大 500。普通玩家只做 500-2000 颗的小图，100×100 = 10000 颗"拼不起"
3. **不知道选了多大**——现在只显示"100 × 100"，没有"实际豆子数"反馈

### 1.2 用户故事

| ID | 故事 | 验收 |
|----|------|------|
| MR-1 | 作为手机玩家，能在手机上正常浏览 | ≤900px 单列堆叠 |
| MR-2 | 作为玩家，能选择更小网格（普通图案） | 新档位 20/30/50/75/100/150/200/300（最高 300）|
| MR-3 | 作为玩家，看到实际豆子数 | "100 × 100 ≈ 10,000 颗" |
| MR-4 | 作为玩家，用进度条选档位 | 进度条 + 散点预设 |
| MR-5 | 作为玩家，知道哪些是常用档位 | 20-100 档位视觉上突出 |

### 1.3 范围 / 非目标

**范围内**：
- ParamPanel 重写：进度条 + 散点 + beanCount 提示
- App.tsx 计算 beanCount 传给 ParamPanel
- global.css 加 @media 900px 单列堆叠
- 最高网格从 500 降到 300
- 主档位（20-100）视觉突出

**非目标（明确不做）**：
- ❌ 拖拽滑块手势
- ❌ 双指缩放 / 平移
- ❌ 输入框直接输入网格数
- ❌ Tablet 单独断点（用 1400 桌面共用）
- ❌ 横屏/竖屏区分
- ❌ 持久化网格选择（localStorage）
- ❌ 多语言
- ❌ 暗色模式
- ❌ 网格预估渲染时间

### 1.4 成功标准

- 手机（≤900px）单列堆叠，可正常浏览
- 网格档位 20-300，对数刻度
- beanCount 实时显示（如"5,600 颗"）
- 进度条点击轨道/散点都能选档
- 主档位（20-100）视觉突出
- 现有 69 个测试 0 回归

## 二、实现方案

### 2.1 文件清单

| 路径 | 动作 | 责任 |
|------|------|------|
| `src/components/ParamPanel.tsx` | 重写 | 进度条 + 散点 + beanCount 提示 |
| `src/components/ParamPanel.css` | 新建 | 进度条 + 散点样式 |
| `src/components/ParamPanel.test.tsx` | 重写 | 进度条交互测试（≥ 5 个）|
| `src/App.tsx` | 修改 | 计算 beanCount 传给 ParamPanel |
| `src/styles/global.css` | 修改 | 加 @media 900px 单列堆叠 |

### 2.2 架构图

```
ParamPanel 状态 (gridSize, beanCount)
   ↓
用户拖进度条 / 点散点
   ↓
setGridSize(新值) → App 重渲染
   ↓
App 重 process(src, { gridSize, ... })
   ↓
Pipeline.process() → outW × outH
   ↓
App 算 beanCount = outW × outH
   ↓
ParamPanel 收到 beanCount prop，显示"100 × 100 ≈ 10,000 颗"
```

### 2.3 接口签名

```tsx
// src/components/ParamPanel.tsx
interface Props {
  gridSize: number;
  beanCount: number;          // 新增
  onGridSizeChange: (n: number) => void;
  enableDither: boolean;
  onDitherChange: (b: boolean) => void;
  disabled?: boolean;
}

const GRID_PRESETS = [20, 30, 50, 75, 100, 150, 200, 300] as const;

// 内部组件
function ProgressBar({ value, presets, onChange }: {
  value: number;
  presets: readonly number[];
  onChange: (n: number) => void;
}): JSX.Element;
```

### 2.4 进度条组件结构

```tsx
function ProgressBar({ value, presets, onChange }: ProgressBarProps) {
  const min = presets[0];
  const max = presets[presets.length - 1];

  const ratioToValue = (ratio: number): number => {
    const logMin = Math.log(min);
    const logMax = Math.log(max);
    const logValue = logMin + (logMax - logMin) * Math.max(0, Math.min(1, ratio));
    return Math.exp(logValue);
  };

  const valueToRatio = (v: number): number => {
    return (Math.log(v) - Math.log(min)) / (Math.log(max) - Math.log(min));
  };

  const onTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const rawValue = ratioToValue(ratio);
    // 找最近档位
    const nearest = presets.reduce((prev, cur) =>
      Math.abs(cur - rawValue) < Math.abs(prev - rawValue) ? cur : prev
    );
    onChange(nearest);
  };

  return (
    <div className="grid-progress" onClick={onTrackClick} role="slider" aria-valuenow={value} aria-valuemin={min} aria-valuemax={max}>
      <div className="grid-progress-track">
        <div
          className="grid-progress-fill"
          style={{ width: `${valueToRatio(value) * 100}%` }}
        />
      </div>
      {presets.map(p => {
        const isMain = p >= 20 && p <= 100;
        const isActive = p === value;
        return (
          <button
            key={p}
            type="button"
            className={`grid-preset ${isActive ? 'active' : ''} ${isMain ? 'main' : ''}`}
            style={{ left: `${valueToRatio(p) * 100}%` }}
            onClick={(e) => { e.stopPropagation(); onChange(p); }}
            aria-label={`网格 ${p}`}
            disabled={disabled}
          >
            {p}
          </button>
        );
      })}
    </div>
  );
}
```

### 2.5 ParamPanel 重写结构

```tsx
export function ParamPanel({
  gridSize,
  beanCount,
  onGridSizeChange,
  enableDither,
  onDitherChange,
  disabled,
}: Props) {
  return (
    <div className="param-panel">
      <label className="grid-label">网格大小（长边豆子数）</label>

      <ProgressBar
        value={gridSize}
        presets={GRID_PRESETS}
        onChange={onGridSizeChange}
      />

      <p className="bean-count">
        {gridSize} × {gridSize}  ≈  <strong>{beanCount.toLocaleString()}</strong> 颗
      </p>
      <p className="hint">推荐 20-100 档位（普通图案常用范围）</p>

      <label className="checkbox">
        <input
          type="checkbox"
          checked={enableDither}
          onChange={e => onDitherChange(e.target.checked)}
          disabled={disabled}
        />
        启用抖动（细节更平滑）
      </label>
    </div>
  );
}
```

### 2.6 响应式 CSS

```css
/* 现有桌面布局 */
.layout-3col {
  display: grid;
  grid-template-columns: var(--left-col-w) 1fr var(--right-col-w);
  gap: var(--space-4);
  margin-top: var(--space-5);
}

@media (max-width: 1400px) {
  .layout-3col {
    grid-template-columns: 240px 1fr 240px;
  }
}

/* 手机/窄屏：单列堆叠 */
@media (max-width: 900px) {
  .layout-3col {
    grid-template-columns: 1fr;
    gap: var(--space-3);
  }
  .preview-wrap {
    aspect-ratio: auto;
    min-height: 320px;
  }
  header h1 {
    font-size: var(--text-xl);
  }
}
```

### 2.7 进度条 CSS

```css
.grid-progress {
  position: relative;
  height: 32px;
  margin: var(--space-3) 0;
  cursor: pointer;
  user-select: none;
}
.grid-progress-track {
  position: absolute;
  top: 14px;
  left: 0;
  right: 0;
  height: 4px;
  background: var(--color-border);
  border-radius: var(--radius-sm);
}
.grid-progress-fill {
  height: 100%;
  background: var(--color-accent);
  border-radius: var(--radius-sm);
  transition: width 0.2s;
}
.grid-preset {
  position: absolute;
  top: 0;
  transform: translateX(-50%);
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 2px solid var(--color-border);
  background: var(--color-surface);
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--color-text-muted);
  cursor: pointer;
  transition: all 0.15s;
}
.grid-preset:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
  transform: translateX(-50%) scale(1.1);
}
.grid-preset.main {
  background: var(--color-accent-soft);
  border-color: var(--color-accent);
  color: var(--color-accent);
}
.grid-preset.active {
  background: var(--color-accent);
  color: white;
  border-color: var(--color-accent);
  box-shadow: 0 0 0 4px var(--color-accent-soft);
}
.bean-count {
  font-size: var(--text-base);
  color: var(--color-text);
  margin: var(--space-2) 0 var(--space-1);
}
.bean-count strong {
  color: var(--color-accent);
  font-weight: 700;
}
```

### 2.8 App.tsx 修改

```tsx
// 计算 beanCount
const beanCount = result ? result.outW * result.outH : 0;

// 传给 ParamPanel
<ParamPanel
  gridSize={gridSize}
  beanCount={beanCount}
  onGridSizeChange={...}
  ...
/>
```

### 2.9 关键边界

1. **进度条用对数刻度**——20 到 300 跨 15 倍，线性刻度会让 20-50 挤一起
2. **散点是绝对定位**——`left: %` 按对数计算
3. **主档位（20-100）**用 `.main` 类视觉区别（柔和底色 + 主色文字）
4. **当前档位**用 `.active` 类（高亮 + 阴影环）
5. **点击轨道** → 计算最近档位
6. **响应式**——只改 layout 网格模板，**不重渲染组件**
7. **键盘可访问**——Tab 焦点 + Enter 触发
8. **beanCount = 0 时**显示"—"（无 result 状态）
9. **CSS 单独文件**——ParamPanel.css 与 global.css 分离，避免污染

---

## 三、数据存储

无新增数据。beanCount 是 result.outW × outH 派生值。

## 四、TODO

### 4.1 实施任务

- [ ] `src/components/ParamPanel.css` 新建
- [ ] `src/components/ParamPanel.tsx` 重写（进度条 + 散点 + beanCount）
- [ ] `src/components/ParamPanel.test.tsx` 重写（≥ 5 个测试）
- [ ] `src/App.tsx` 传 beanCount 给 ParamPanel
- [ ] `src/styles/global.css` 加 @media 900px 单列堆叠

### 4.2 验收清单

- [ ] ParamPanel ≥ 5 个新测试通过
- [ ] typecheck 0 错误
- [ ] npm test 现有 69 + 新增 ~5 = **≥ 74 个** 通过
- [ ] npm run build 通过
- [ ] 浏览器手测：进度条交互、beanCount 显示、手机单列堆叠

## 五、常量映射

| 常量 | 值 | 用途 |
|------|----|------|
| `GRID_PRESETS` | [20, 30, 50, 75, 100, 150, 200, 300] | 8 个网格档位 |
| `MAIN_PRESETS_RANGE` | [20, 100] | 主档位范围（视觉突出）|
| `@media (max-width: 900px)` | 手机断点 | 单列堆叠 |
| `@media (max-width: 1400px)` | 平板断点 | 左右列稍窄（已有）|

## 六、接口协议

### 6.1 变更的接口

```tsx
// ParamPanel: 新增 beanCount prop
interface Props {
  gridSize: number;
+ beanCount: number;
  onGridSizeChange: (n: number) => void;
  enableDither: boolean;
  onDitherChange: (b: boolean) => void;
  disabled?: boolean;
}
```

### 6.2 不变的接口

- `usePipeline` / `usePalette` / `useSampleImage`
- `Pipeline` 类 / 所有 algorithm
- `PreviewCanvas` / `ColorLegend` / `ExportPanel` / `UploadZone` / `ProductShowcase`
- `computeLegend()` / `renderComposite()`

## 七、服务发布

无后端变更。沿用 Vite 静态构建。
- 构建产物增量 < 2KB gzipped

## 八、CR 点

- [ ] 进度条用对数刻度（不能用线性）
- [ ] 散点 `left: %` 按对数计算
- [ ] 8 个档位（20-300）按对数排布
- [ ] 主档位（20-100）有 `.main` class
- [ ] 当前档位有 `.active` class（高亮 + 阴影环）
- [ ] 点击轨道 → 最近档位
- [ ] 点击散点 → 停止传播（避免重复触发）
- [ ] beanCount 用 `toLocaleString()` 格式化（千分位）
- [ ] @media 900px 单列堆叠
- [ ] 手机端 preview-wrap 仍可滚动查看
- [ ] 不引入新依赖
- [ ] 现有 69 测试 0 回归

## 九、实施步骤

按"风险递增"顺序：

1. **ParamPanel.css + ParamPanel.tsx 重写**（最核心，~150 行）
2. **ParamPanel.test.tsx 重写**（≥ 5 个测试）
3. **App.tsx 传 beanCount**（核心连接）
4. **global.css 加 @media 900px**（CSS 媒体查询，最简单）
5. **浏览器手测**

---

## 自检（写完后再过一遍）

1. **占位符扫描**：无 TBD/TODO/待定项。✓
2. **内部一致性**：架构图 / 接口 / TODO / CR 全对齐。✓
3. **范围检查**：聚焦"手机端 + 进度条 + 豆子数"，单 spec 可落地（5 个文件改动）。✓
4. **歧义检查**：
   - "对数刻度"已明确（不能让 20-50 挤一起）
   - "主档位（20-100）"已明确视觉突出
   - "beanCount = outW × outH"已明确
   - "≤900px 单列堆叠"已明确
5. **回归风险**：明确列出"不变"的接口；新增面在 5 个文件。✓