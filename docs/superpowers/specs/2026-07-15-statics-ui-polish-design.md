# /statics 后台美化与交互升级

> 日期: 2026-07-15
> 状态: Draft（待用户审阅）
> 影响分支: `feature/merchant-account-stats`（同一棵分支继续作业）

## 1. 背景与目标

`/statics` 是拼豆图统计后台，包含登录页、管理员工作台（统计 / 账号 / 商品）、商家工作台（我的数据 / 商品）、多个 Modal（修改密码、编辑商品、重置密码、续期、新建账号、新建商品）。当前已完成功能闭环，但视觉与交互停留在"能用的半成品"层级，与资深产品视角的 SAAS 工作台有明显差距。

本次改造聚焦：
1. **核心页面深度重做**（登录、统计概览、账号 / 商品管理、商家数据看板）：信息层级、图表、表格、空状态、表单等。
2. **轻量产品感升级**：加载反馈、空状态、错误处理、键盘可达性、CRUD Toast、`prefers-reduced-motion` 友好的微动效。
3. **设计系统底座**：建立 token 与基础组件库，未来新增 Tab / 功能可直接复用，避免后续维护负债。

不引入第三方 UI 库与图表库。

## 2. 范围与非目标

### In scope
- `src/pages/StaticsPage.*` 及其下属全部页面
- 新增 `src/components/ui/` 基础组件库
- `src/styles/global.css` 的 token 化扩展；新增 `src/styles/tokens.css`
- 所有现有 Modal（ChangePasswordModal / ProductEditModal / Create*Modal / RenewModal / ResetPasswordModal）改用新 Modal 组件
- 现有测试不回归；为新组件补 vitest 单测

### Out of scope
- 路由结构改动
- 后端 API 改动
- 主链路（首页 / 上传 / 预览）的样式改动
- 主题切换（深色模式预留 token，但本期不交付切换）
- 国际化（仅预留 hook 位，不接入 i18n 库）
- 引入第三方 UI 库（shadcn / Radix / Tailwind）
- 引入图表库（recharts / visx）

## 3. 设计原则

1. **B + C 路径**：核心页面深度重做 + 克制微动效（非重动画 / 非全组件库化）。
2. **角色同等重视**：商家与管理员同等重要，但走差异化布局与密度，共享同一设计语言。
3. **YAGNI**：本期不做的功能不强做（不要为"可能"加组件）；但凡保留的入口都达到"产品感"水准。
4. **可访问性**（WCAG AA）：文字对比度、`:focus-visible` 焦点环、键盘可达、ARIA 属性到位。
5. **不破现有测试**：每个 commit 跑 `npm test` 必须全过。

## 4. 设计系统（Tokens）

详细数值见附录 A。分层结构：

```
raw-*         原色（不允许业务代码直接使用）
color-*       语义色（背景 / 边框 / 文字 / accent / 状态）
space-*       间距（0/1/2/3/4/5/6/7/8）
radius-*      圆角（xs/sm/md/lg）
shadow-*      阴影（xs/sm/md/lg，4 级）
text-*        字号（xs/sm/md/lg/xl/2xl/3xl）
leading-*     行高（tight/snug/normal/loose）
font-sans     系统字体栈
font-mono     等宽字体栈
ease-*        动画曲线（out / in-out）
duration-*    动画时长（fast/base/slow）
focus-ring    焦点环：0 0 0 3px rgba(232,93,47,.35)
```

变更要点：
- 配色微调：背景由 `#fdf6f0` → `#faf7f2`；accent 由 `#e07856` → `#e85d2f`（更现代、更饱和）。
- 文字主色加深至 `#1f1c18`，muted 提至 `#6b6258`，确保 WCAG AA。
- 圆角由 `--radius-sm: 8px` 下调至 `6px`（更克制、更 SAAS）。
- 阴影 4 档层级化（xs/sm/md/lg）。

任何后续添加都必须从 token 取值；禁止散落 hex / px / ms。CI 阶段通过 grep 抽查兜底（PR review）。

## 5. 基础组件库 `src/components/ui/`

| 组件 | Props 关键 | 说明 |
|---|---|---|
| `Button` | `variant: primary\|secondary\|ghost\|danger`；`size: sm\|md`；`loading`；`iconLeft`；标准 `<button>` 属性 | 内联 spinner；focus-ring；禁用态降透明度 |
| `Input` | `label?`；`hint?`；`error?`；`iconLeft?`；`iconRight?`；原生 input 属性 | label 关联 htmlFor；错误时 border red |
| `Textarea` | 同 Input | |
| `Select` | 同 Input 视觉 | |
| `Checkbox` / `Radio` | `label`；`checked`；`onChange`；原生 input 兜底 | 自定义外观；原生 input 保持可访问性 |
| `Modal` | `open`；`onClose`；`title`；`size: sm\|md\|lg`；`hideClose?: boolean`；子节点 | portal 渲染；锁滚动；Esc 关闭；点击背景关闭；focus trap 手写；ARIA `role=dialog` `aria-modal=true` `aria-labelledby` |
| `Card` | `padding: sm\|md\|lg`；`as?`；子节点 | surface + shadow-sm |
| `Badge` | `variant: neutral\|success\|warning\|danger\|info\|accent`；子节点 | 圆角全圆；用于状态 / 角色 chip |
| `EmptyState` | `icon?`；`title`；`description?`；`action?` | 居中；用于"暂无数据" |
| `Skeleton` | `w?`；`h?`；`count?`；`circle?` | shimmer 动效；可叠加 |
| `Tabs` | `items: { key; label; }[]`；`value`；`onChange`；`size?` | 受控/非受控；ARIA `role=tablist`；键盘 ←→ 切换；下划线滑动 |
| `Tooltip` | `label`；`children`；`placement` | 简朴；hover/focus 触发 |
| `Toast` + `useToast` | type: success\|error\|warn\|info；title；description? | 顶部居中堆叠；4s 自动消失；最多 3 个 |
| `ErrorBoundary` | `fallback?` | 致命错误 fallback；居中插画 + 刷新按钮 |
| `TopProgress` | `active: boolean` | 顶部 2px 高的进度条；auto-increment + 完成时滑出；用于首屏 / 路由切换感知 |

每个组件有同级 `*.css`（co-located），并在 `src/components/ui/__tests__/` 下有最小单测：
- 渲染 snapshot 或关键节点存在
- 交互（Modal 的 Esc/背景/focus trap；Tabs 的键盘切换；Toast 的自动消失）
- ARIA 属性存在性

## 6. 关键页面改造

### 6.1 登录页
- 居中卡片（380px），背景加极淡渐变 / 圆形模糊
- 登录失败：在按钮上方一块软底错误条
- `loading` 状态显示 spinner + "登录中..."
- 底部加品牌色 + 版权

### 6.2 顶部导航（登录后共用）
- 56px 高度，固定头部
- 左侧品牌、右侧：用户首字母 avatar + 用户名 + 角色 chip + 「修改密码」 + 「退出」（下拉菜单收口）
- 当前路由用面包屑（先静态写死）

### 6.3 Tab 系统
- 用 `<Tabs>` 组件替换原 `<div className="statics-tabs">`
- 管理员：3 个 Tab（统计概览 / 账号管理 / 商品管理）
- 商家：2 个 Tab（我的数据 / 商品）
- 当前 Tab：底线 2px accent；未选中 muted，hover 提级
- 下划线 280ms `ease-out` 滑动

### 6.4 统计概览（管理员首页）
- 节标题 + 时间分段按钮（1天/7天/30天/90天） + 「刷新」按钮
- 4 个 KPI 卡：UV / PV / 商品点击 / 图片导出；每个显示同比 chip（涨绿跌灰）。**本期同比数据后端未提供，UI 留位显示「—」；下期接入数据时填充**。
- 「每日事件趋势」图表（手写 SVG，更新样式 + tooltip）
- 表格：商品点击 Top N（≥5 行用表格展示，<5 行收为行）
- 加载时：卡片显示 Skeleton
- 错误时：节顶部 ErrorState + Toast
- 空数据：EmptyState

### 6.5 商家数据看板
- 节标题 + 时间分段 + 「刷新」
- 3 个 KPI 卡（大尺寸）：我的商品点击 / 站点 PV / 商品数
- 「每日我的点击」图表
- 「我的商品」表格：商品 / 点击数 / 操作；点击数加 chip 显示占比
- 移动端：KPI 卡堆叠；表格横滚；可能后续做卡片视图（本期不做，先保证可读）

### 6.6 账号管理
- 节标题 + 「新建账号」 primary 按钮
- 顶部过滤栏：搜索（按账号名 client 端过滤）+ 角色 select + 状态 select
- 表头可点击排序（账号、过期时间）
- 状态用 Badge：正常 / 已禁用 / 待改密 / 已过期
- 操作收紧为「更多」菜单（重置密码 / 续期 / 启用-禁用 / 删除）
- 删除 / 禁用改用 Modal 确认（含上下文；不再用 `confirm()` / `alert()`）
- 新建账号 Modal：用 Checkbox 多选分配商品；必填项加 `*` 与错误提示
- 重置密码 / 续期 Modal：表单体验同 §5

### 6.7 商品管理
- 节标题 + 「新建商品」 primary 按钮
- 表格：ID / 名称 / 价格 / 操作
- 操作：「编辑」 / 「删除」（删除用 Modal 确认）
- 编辑复用现有 ProductEditModal（迁到新 Modal）
- 新建走独立 Modal，表单体验同 §5

### 6.8 修改密码（已存在的 ChangePasswordModal）
- 内部换新 Modal / Input，加 label / error / hint
- Esc + 背景 + x 都关闭（首次登录强制模式不可关闭）

## 7. 交互细节

### 加载
- 首屏：手写顶部细进度条（auto-increment + done=true 滑出），不引依赖
- 列表 / 表格：Skeleton
- 按钮：loading 态 spinner + 文案

### 空状态
- 全部 4 种场景统一用 EmptyState：
  - 暂无商品 / 暂无账号 / 搜索无结果 / 加载失败

### 错误反馈
- 字段级：下方红字 + 边框红
- 表单级：顶部错误条
- 接口错误：Toast（顶部滑入，可重试）
- 致命错误：ErrorBoundary fallback

### Toast
- 顶部居中堆叠，最多 3 个；4s 自动消失；可手动关闭

### 微动效（克制原则）
- Tab 切换：内容区 120ms opacity 淡入
- Button hover：背景 120ms 过渡；active scale 0.98 / 50ms
- Modal 进出：背景 180ms 淡入淡出；卡片 scale 0.96→1 + opacity 0→1，180ms ease-out
- KPI 卡 hover：shadow-sm → shadow-md
- 表格行 hover：行底色 surface-2
- Tab 下划线：280ms ease-out 滑动
- 全局尊重 `prefers-reduced-motion: reduce`

### 键盘可达
- Tab 顺序合理
- Esc 关 Modal；Enter 提交表单（textarea 除外）
- `:focus-visible` 才显示焦点环
- Modal 内 Tab 循环
- Tabs 用 ←→ 切换

## 8. 角色差异化

| 区域 | 商家 | 管理员 |
|---|---|---|
| 顶栏右侧 | 用户名 + 修改密码 + 退出 | 同左 |
| Tab 数量 | 2 | 3 |
| KPI 卡 | 3 张大尺寸 | 4 张紧凑 + 同比 chip |
| 移动端 | 优先优化（KPI 堆叠、表格横滚） | 提示横滚可读 |

## 9. 可访问性清单

- 所有 icon-only 按钮 `aria-label`
- Modal：`role=dialog` `aria-modal=true` `aria-labelledby`
- 表单：`label[htmlFor]` + `aria-invalid` + `aria-describedby`
- Tabs：`role=tablist/tab/tabpanel` + `aria-selected`
- Badge 不抢焦点：`role` 不暴露，纯视觉
- Toast：`role=status`（info/success）或 `role=alert`（error）
- 全局焦点环：`:focus-visible` + `--focus-ring` token
- 颜色：文字 vs 背景对比 ≥ 4.5:1（token 数值保证）

## 10. 文件结构

```
src/
├── styles/
│   ├── global.css                ← 改：reset + global utilities + reduced-motion
│   └── tokens.css                ← 新：所有 token 集中
├── components/
│   ├── ui/                       ← 新：基础组件库（详见 §5）
│   │   ├── Button.tsx + .css
│   │   ├── Input.tsx + .css
│   │   ├── Select.tsx + .css
│   │   ├── Textarea.tsx + .css
│   │   ├── Checkbox.tsx + .css
│   │   ├── Modal.tsx + .css
│   │   ├── Card.tsx + .css
│   │   ├── Badge.tsx + .css
│   │   ├── EmptyState.tsx + .css
│   │   ├── Skeleton.tsx + .css
│   │   ├── Tabs.tsx + .css
│   │   ├── Tooltip.tsx + .css
│   │   ├── Toast.tsx + .css
│   │   ├── useToast.ts
│   │   ├── ErrorBoundary.tsx
│   │   ├── TopProgress.tsx + .css
│   │   └── __tests__/
│   │       ├── Button.test.tsx
│   │       ├── Modal.test.tsx
│   │       ├── Tabs.test.tsx
│   │       ├── Toast.test.tsx
│   │       └── ... 其他必要组件
│   ├── ChangePasswordModal.tsx          ← 改：内部换 Modal/Input
│   ├── ChangePasswordModal.css          ← 改
│   ├── ProductEditModal.tsx             ← 改
│   ├── ProductEditModal.css             ← 改
│   └── ...其他现有组件不动
├── pages/
│   ├── StaticsPage.tsx                  ← 改
│   ├── StaticsPage.css                  ← 大改 / 拆分
│   ├── StaticsPage.test.tsx             ← 保持通过
│   ├── admin/
│   │   ├── AdminDashboard.tsx           ← 改：用 Tabs
│   │   ├── AdminDashboard.css (新)
│   │   ├── StatsTab.tsx + .css (新)     ← 大改
│   │   ├── UsersTab.tsx + .css          ← 改
│   │   └── ProductsTab.tsx + .css (新)  ← 大改
│   └── merchant/
│       ├── MerchantDashboard.tsx        ← 大改
│       └── MerchantDashboard.css (新)
```

## 11. 迁移 / 提交策略

每个 commit 可回退、可运行、`npm test` 全过：

| # | 内容 |
|---|---|
| 1 | 新增 `src/styles/tokens.css`；`global.css` 切换 import；现有页面外观不变（仅 token 重新映射） |
| 2 | 新增 `src/components/ui/Button` + 单测 |
| 3 | 新增 `Input` / `Textarea` / `Select` + 单测 |
| 4 | 新增 `Checkbox` / `Badge` / `Card` + 单测 |
| 5 | 新增 `Skeleton` / `EmptyState` + 单测 |
| 6 | 新增 `Modal`（含 focus trap）+ 单测 |
| 7 | 新增 `Tabs` + 单测 |
| 8 | 新增 `Toast` + `useToast` + `ToastContainer` + 单测 |
| 9 | 新增 `Tooltip` + `ErrorBoundary` + 单测 |
| 10 | 登录页迁移到新组件 |
| 11 | 顶部导航改造 |
| 12 | 统计概览（管理员）迁移 |
| 13 | 商家数据看板迁移 |
| 14 | 账号管理表迁移 |
| 15 | 商品管理表迁移 |
| 16 | 各业务 Modal 迁移到新 Modal |
| 17 | 清理 `StaticsPage.css` 残留样式（如有） |
| 18 | 收尾验证：lighthouse a11y 报告 + Playwright 截图对比 |

## 12. 验证

- `npm run lint` 通过
- `npm test` 全过；新组件单测不回归
- 浏览器肉眼检查：登录页 / 统计概览 / 账号表 / 商品表 / 商家看板 在桌面 & 移动尺寸下都对
- 浏览器开发者工具对比旧版截图
- 强制 `prefers-reduced-motion: reduce` 后无动效
- Lighthouse Accessibility ≥ 90

## 13. 风险

- **焦点环干扰现有按钮**：用 `:focus-visible`，鼠标点击不显示
- **Modal focus trap 边界**：手写 ~50 行，已在 §11 单列
- **迁移期样式打架**：每个 Tab 完成后跑一次 `npm test` + 视觉验证；commit 粒度细到半天工作量级
- **noScroll lock 在 Modal 嵌套时**：本期不嵌套 Modal，不踩坑；之后若需要做嵌套 Modal 再加 stacking 逻辑

---

## 附录 A：Token 数值

### 颜色

```css
:root {
  /* raw */
  --raw-orange-50:  #fff5f0;
  --raw-orange-100: #fce0d6;
  --raw-orange-200: #f9b89a;
  --raw-orange-300: #f38962;
  --raw-orange-500: #e85d2f;
  --raw-orange-600: #cc4a1e;
  --raw-orange-700: #a8380f;

  /* semantic — surface / text / border */
  --color-bg:            #faf7f2;
  --color-surface:       #ffffff;
  --color-surface-2:     #f7f3ec;
  --color-border:        #ece4d6;
  --color-border-strong: #d6c7b3;

  --color-text:        #1f1c18;
  --color-text-muted:  #6b6258;
  --color-text-subtle: #9b9183;

  /* brand */
  --color-accent:       #e85d2f;
  --color-accent-hover: #cc4a1e;
  --color-accent-soft:  #ffe9df;
  --color-accent-fg-on: #ffffff;

  /* states */
  --color-success:      #16a34a;
  --color-success-bg:   #dcfce7;
  --color-success-fg:   #ffffff;

  --color-warning:      #d97706;
  --color-warning-bg:   #fef3c7;
  --color-warning-fg:   #ffffff;

  --color-danger:       #dc2626;
  --color-danger-bg:    #fee2e2;
  --color-danger-fg:    #ffffff;

  --color-info:         #2563eb;
  --color-info-bg:      #dbeafe;
  --color-info-fg:      #ffffff;
}
```

### 间距 / 圆角 / 阴影 / 字号 / 行高

```css
--space-0: 2px;
--space-1: 4px;
--space-2: 8px;
--space-3: 12px;
--space-4: 16px;
--space-5: 24px;
--space-6: 32px;
--space-7: 48px;
--space-8: 64px;

--radius-xs: 4px;
--radius-sm: 6px;
--radius-md: 10px;
--radius-lg: 16px;

--shadow-xs: 0 1px 2px rgba(20, 12, 4, .05);
--shadow-sm: 0 1px 3px rgba(20, 12, 4, .08), 0 1px 2px rgba(20, 12, 4, .04);
--shadow-md: 0 4px 12px rgba(20, 12, 4, .08), 0 2px 4px rgba(20, 12, 4, .04);
--shadow-lg: 0 12px 32px rgba(20, 12, 4, .10);

--text-xs:  12px;
--text-sm:  13px;
--text-md:  14px;
--text-lg:  16px;
--text-xl:  20px;
--text-2xl: 28px;
--text-3xl: 34px;

--leading-tight:  1.25;
--leading-snug:   1.4;
--leading-normal: 1.5;
--leading-loose:  1.7;
```

### 动效 / 焦点

```css
--ease-out:    cubic-bezier(.16, 1, .3, 1);
--ease-in-out: cubic-bezier(.4, 0, .2, 1);
--duration-fast: 120ms;
--duration-base: 180ms;
--duration-slow: 280ms;

--focus-ring: 0 0 0 3px rgba(232, 93, 47, .35);
```

### 字体 / 布局

```css
--font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
--font-mono: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;

--left-col-w: 280px;
--right-col-w: 300px;
```

---

## 附录 B：Open Questions（无遗留问题）

设计阶段所有问题已与用户对齐，无待确认项。

