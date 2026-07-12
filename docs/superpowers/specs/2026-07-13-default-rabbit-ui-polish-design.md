# 拼豆图：默认兔子图 + UI 重设计 - 设计文档

- **日期**: 2026-07-13
- **作者**: 通过 brainstorming 流程生成
- **状态**: 待实施
- **依赖**: 已存在的 MVP（含上一次空状态改动）

## 一、需求文档

### 1.1 背景

用户反馈当前产品：
1. **空状态不够友好**（已修：上一轮加了极简文案）
2. **ExportPanel 选项太多太复杂**（额外尺寸、像素密度——玩家不知道干嘛用）
3. **首屏不直观**——没上传图时空，引导文案仍嫌"空"
4. **UI 整体太素**——当前中性现代风不符合"拼豆玩家多为年轻女性"的产品定位
5. **缺法律声明**——MARD 商标归属未明示

### 1.2 用户故事

| ID | 故事 | 验收 |
|----|------|------|
| DR-1 | 作为玩家，打开页面立刻看到拼豆图 | 默认显示兔子拼豆图，无需任何点击 |
| DR-2 | 作为玩家，看到示例后知道这工具是做什么的 | 兔子图直观展示"拼豆图长这样" |
| DR-3 | 作为玩家，能上传自己的图并切换 | 上传后立刻看到自己的拼豆图 |
| DR-4 | 作为玩家，能一键导出 1 张图 | 页面只有 1 个"导出"按钮，无其他选项 |
| DR-5 | 作为玩家，UI 看起来温暖、可爱、易用 | 柔和马卡龙配色 + 大圆角 + 柔阴影 |
| DR-6 | 作为运营者，页面有法律风险声明 | 页脚 1 行小字含"仅作手工参考"声明 |

### 1.3 范围 / 非目标

**范围内**：
- `public/samples/rabbit.png` 占位图（你后续替换为真实兔子图）
- `useSampleImage` hook：启动时 fetch sample → ImageData
- `App.tsx` 启动时自动 process 示例图
- `ExportPanel` 简化为 1 按钮（删除所有选项）
- `global.css` 重写：马卡龙色板 + 大圆角 + 柔阴影 + 头部 logo 风格
- 页脚加 1 行法律声明

**非目标（明确不做）**：
- ❌ 多图导出 / 额外尺寸
- ❌ 场景化选择（手机看 / 打印 / ...）
- ❌ 像素密度选项
- ❌ 高级选项折叠面板
- ❌ 缩放 / 平移预览
- ❌ 拖动上传
- ❌ 示例图切换按钮
- ❌ 主题切换（暗色模式）
- ❌ 多语言（i18n）
- ❌ 持久化状态（localStorage）
- ❌ 详细法律页面（只有 1 行页脚声明）
- ❌ 教程视频 / 演示 GIF
- ❌ 进度条

### 1.4 成功标准

- 页面加载后**立即**显示兔子拼豆图 + 兔子色号对照表
- 玩家上传后无缝切换
- UI 整体柔和温暖（米白底 + 蜜桃主色 + 大圆角）
- ExportPanel 只有 1 个按钮
- 页脚有法律声明
- typecheck 0 错误；现有 63 测试 0 回归 + 新增 ~6 = **≥ 69 个** 通过

## 二、实现方案

### 2.1 架构图

```
App 启动
  ↓
useSampleImage hook
  ├─ fetch /samples/rabbit.png
  ├─ decode → ImageData
  └─ 返回 { imageData, loading, error }
  ↓
useEffect([imageData, palette, status === 'idle']) 触发
  ↓
process(imageData, { gridSize: 100, enableDither: false })
  ↓
usePipeline.process() (200ms 节流)
  ↓
result 更新 → PreviewCanvas 渲染兔子画
              ColorLegend 渲染兔子色号
  ↓
玩家点击"上传图片" → 选自己图 → process(新图) → result 更新
```

### 2.2 文件清单

| 路径 | 动作 | 责任 |
|------|------|------|
| `public/samples/rabbit.png` | 新建（占位）| 默认示例图 |
| `src/hooks/useSampleImage.ts` | 新建 | fetch sample → ImageData |
| `src/hooks/useSampleImage.test.ts` | 新建 | 3 个单测 |
| `src/components/ExportPanel.tsx` | 简化 | 只 1 按钮 |
| `src/components/ExportPanel.test.tsx` | 简化 | 1 个测试 |
| `src/App.tsx` | 修改 | 启动时 process 示例 + 页脚声明 |
| `src/styles/global.css` | 重写 | 马卡龙色板 + 大圆角 + 柔阴影 |

### 2.3 接口签名

```ts
// src/hooks/useSampleImage.ts (new)
export function useSampleImage(): {
  imageData: ImageData | null;
  loading: boolean;
  error: Error | null;
};

// src/components/ExportPanel.tsx (simplified)
interface Props {
  onExport: () => void;
  disabled: boolean;
}

// 现有接口不变：PreviewCanvas / ColorLegend / usePipeline / usePalette
```

### 2.4 useSampleImage 实现

```ts
import { useEffect, useState } from 'react';

export function useSampleImage() {
  const [imageData, setImageData] = useState<ImageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch('/samples/rabbit.png')
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.blob();
      })
      .then(blob => createImageBitmap(blob))
      .then(bitmap => {
        if (cancelled) return;
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(bitmap, 0, 0);
        setImageData(ctx.getImageData(0, 0, bitmap.width, bitmap.height));
        setLoading(false);
      })
      .catch(e => {
        if (cancelled) return;
        setError(e instanceof Error ? e : new Error(String(e)));
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, []);

  return { imageData, loading, error };
}
```

### 2.5 App.tsx 修改结构

```tsx
export function App() {
  const { palette, error: paletteError } = usePalette();
  const { status, result, error, process, exportComposite } = usePipeline(palette);
  const { imageData: sample } = useSampleImage();
  const [gridSize, setGridSize] = useState(100);
  const [enableDither, setEnableDither] = useState(false);

  // 启动时 + 资源就绪时 → 自动 process 示例
  useEffect(() => {
    if (sample && palette && status === 'idle') {
      process(sample, { gridSize, enableDither });
    }
  }, [sample, palette, status]);

  const handleExport = async () => {
    await exportComposite();
  };

  return (
    <div className="app">
      <header>
        <h1>🐰 拼豆图生成器</h1>
        <p className="subtitle">上传图片 → 一键生成你的拼豆图纸</p>
      </header>

      {error && <p className="error">处理异常：{error.message}</p>}

      <main className="layout-3col">
        <aside className="left">
          <UploadZone onLoad={(data) => process(data, { gridSize, enableDither })} />
          <ParamPanel
            gridSize={gridSize}
            onGridSizeChange={(n) => { setGridSize(n); reprocess({ gridSize: n, enableDither }); }}
            enableDither={enableDither}
            onDitherChange={(b) => { setEnableDither(b); reprocess({ gridSize, enableDither: b }); }}
            disabled={status === 'idle' || status === 'loading'}
          />
          <ExportPanel
            disabled={!result}
            onExport={handleExport}
          />
        </aside>

        <section className="middle">
          <PreviewCanvas
            result={result}
            palette={palette}
            cellPx={24}
            isRecomputing={status === 'recomputing'}
          />
        </section>

        <aside className="right">
          <ColorLegend legend={legend} />
        </aside>
      </main>

      <ProductShowcase />

      <footer className="app-footer">
        <p>© 拼豆图生成器 · 仅作手工参考 · 颜色归各品牌所有</p>
      </footer>
    </div>
  );
}
```

### 2.6 ExportPanel 简化版

```tsx
interface Props {
  onExport: () => void;
  disabled: boolean;
}

export function ExportPanel({ onExport, disabled }: Props) {
  return (
    <div className="export-panel">
      <button
        className="primary"
        disabled={disabled}
        onClick={onExport}
      >
        导出 1 张图
      </button>
      <p className="hint">默认 32px 一格，可直接打印或分享</p>
    </div>
  );
}
```

### 2.7 CSS 柔和马卡龙色板

```css
:root {
  /* Color — 柔和马卡龙 */
  --color-bg: #fdf6f0;
  --color-surface: #ffffff;
  --color-surface-alt: #f5ede5;
  --color-text: #2d2a26;
  --color-text-muted: #968b80;
  --color-border: #f0e6dc;
  --color-border-strong: #d9c9b9;
  --color-accent: #e07856;
  --color-accent-hover: #c95f3f;
  --color-accent-soft: #fce0d6;
  --color-pink: #f7b5c5;
  --color-mint: #a8d8b9;
  --color-yellow: #f8d77f;
  --color-error-bg: #fef2f2;
  --color-error-fg: #b91c1c;

  /* Radius — 大圆角 */
  --radius-sm: 8px;
  --radius-md: 16px;
  --radius-lg: 24px;

  /* Shadow — 柔和 */
  --shadow-sm: 0 2px 6px rgba(180, 130, 100, 0.08);
  --shadow-md: 0 6px 20px rgba(180, 130, 100, 0.12);
  --shadow-lg: 0 12px 32px rgba(180, 130, 100, 0.16);

  /* Typography */
  --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  --text-xs: 11px;
  --text-sm: 12px;
  --text-base: 14px;
  --text-lg: 16px;
  --text-xl: 22px;
  --text-2xl: 28px;

  /* Layout */
  --left-col-w: 280px;
  --right-col-w: 300px;
}
```

### 2.8 关键边界

1. **useSampleImage 失败时优雅降级**：error 状态返回 null imageData，不阻塞主流程
2. **示例图与色板加载独立**：任一先到都先渲染，最终两者都到时 process
3. **不持久化示例图状态**：刷新页面回到兔子示例
4. **ExportPanel 完全简化**：删 useState、删 SIZE_OPTIONS、删 PIXEL_OPTIONS、删 extra state
5. **页脚声明 1 行小字**：不在 body 重复，不弹窗，不显眼但实际存在

### 2.9 视觉示意（柔和马卡龙）

```
┌──────────────────────────────────────────────────┐
│  🐰 拼豆图生成器                                    │  ← 头部 emoji + 大标题
│  上传图片 → 一键生成你的拼豆图纸                    │
├──────────────────────────────────────────────────┤
│  ┌──────────┐  ┌──────────────┐  ┌──────────┐    │
│  │ 上传     │  │   兔子拼豆图   │  │ 色号对照  │    │
│  │ ┌────┐  │  │              │  │ ──────  │    │
│  │ │    │  │  │              │  │ A01 红  │    │
│  │ └────┘  │  │              │  │ A02 蓝  │    │
│  │        │  │              │  │ ...    │    │
│  │ 网格 100│  │              │  │        │    │
│  │ 抖动 □  │  │              │  │        │    │
│  │        │  │              │  │        │    │
│  │ [导出1张]│  └──────────────┘  └──────────┘    │
│  └──────────┘                                    │
├──────────────────────────────────────────────────┤
│  购买拼豆（ProductShowcase）                       │
├──────────────────────────────────────────────────┤
│  © 拼豆图生成器 · 仅作手工参考 · 颜色归各品牌所有  │  ← 页脚
└──────────────────────────────────────────────────┘
```

## 三、数据存储

无新增持久化数据。

## 四、TODO

### 4.1 实施任务

- [ ] `public/samples/rabbit.png` 创建（占位图）
- [ ] `src/hooks/useSampleImage.ts` + 单测 3 条
- [ ] `src/components/ExportPanel.tsx` 简化为 1 按钮 + 单测 1 条
- [ ] `src/App.tsx` 启动时 process 示例 + 页脚声明
- [ ] `src/styles/global.css` 重写为马卡龙色板
- [ ] 浏览器手测

### 4.2 验收清单

- [ ] useSampleImage 3 个单测通过
- [ ] ExportPanel 1 个单测通过
- [ ] typecheck 0 错误
- [ ] npm test 现有 63 + 新增 4 = **≥ 67 个** 通过
- [ ] npm run build 通过
- [ ] 浏览器手测：默认兔子图、上传切换、UI 柔和、页脚声明

## 五、常量映射

| 常量 | 值 | 用途 |
|------|----|------|
| `--color-bg` | `#fdf6f0` | 暖米白 |
| `--color-accent` | `#e07856` | 蜜桃主色 |
| `--radius-md` | `16px` | 大圆角 |
| `--radius-lg` | `24px` | 卡片圆角 |
| `--shadow-md` | 暖色柔阴影 | 卡片 |
| `--text-2xl` | `28px` | 头部主标题 |

## 六、接口协议

### 6.1 变更的接口

```tsx
// ExportPanel: 删除 3 个 props
- currentGridSize: number
+ onExport: () => void  // 简化为单参数
+ disabled: boolean

// 新增 hook
+ useSampleImage(): { imageData, loading, error }
```

### 6.2 不变的接口

- `usePalette()` / `usePipeline()`
- `Pipeline` 类 / 所有 algorithm
- `PreviewCanvas` / `ColorLegend` / `ProductShowcase` / `UploadZone` / `ParamPanel`
- `computeLegend()` / `renderComposite()`

## 七、服务发布

无后端变更。沿用 Vite 静态构建。
- 构建产物增量 < 3KB gzipped（含示例图 base64 不变）

## 八、CR 点

- [ ] 启动后立即显示兔子图（无需点击）
- [ ] ExportPanel 完全简化，**只有 1 个按钮**
- [ ] useSampleImage 失败时优雅降级
- [ ] 页脚有法律声明 1 行小字
- [ ] CSS 整体改马卡龙色板（暖米白 + 蜜桃主色 + 大圆角 + 柔阴影）
- [ ] 头部有 🐰 emoji + 加大标题
- [ ] 不破坏现有 63 测试
- [ ] 不引入新依赖

## 九、实施步骤

按"风险递增"顺序：

1. **useSampleImage hook + 单测**（最底层，5 分钟）
2. **ExportPanel 简化 + 单测**（改一个组件）
3. **App.tsx 接入 + 页脚声明**（核心）
4. **CSS 重写**（最后做，避免影响前面验证）
5. **浏览器手测**

---

## 自检（写完后再过一遍）

1. **占位符扫描**：无 TBD/TODO/待定项。✓
2. **内部一致性**：架构图 / 接口 / TODO / CR 全对齐。✓
3. **范围检查**：聚焦"默认兔子 + UI 简化 + 声明"，单 spec 可落地（7 个文件改动）。✓
4. **歧义检查**：
   - "默认兔子"已明确：内置 `samples/rabbit.png`，启动时自动加载
   - "UI 柔和"已明确：马卡龙色板 + 大圆角 + 柔阴影
   - "法律声明"已明确：页脚 1 行小字
5. **回归风险**：明确列出"不变"的接口；新增面在 7 个文件。✓