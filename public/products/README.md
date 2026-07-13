# 商品配置指南

## 目录结构

```
public/
├── data/products.json   ← 商品数据（名称、价格、描述、链接）
└── products/            ← 商品图片（JPG/PNG，建议 800×800 正方形）
    ├── 128-set.jpg
    ├── 24-set.jpg
    └── tools.jpg
```

---

## 一、配置商品数据

编辑 `public/data/products.json`，每个商品字段如下：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 唯一标识，推荐 `p-xxx` 格式 |
| `name` | string | 是 | 商品名称，显示在卡片上 |
| `image` | string | 是 | 图片路径，`/products/xxx.jpg` |
| `price` | number | 是 | 价格，单位元，如 `99.00` |
| `currency` | string | 是 | 固定为 `"CNY"` |
| `description` | string | 是 | 简短描述，显示在价格上方 |
| `url` | string | 是 | 购买链接（淘宝/微信等） |
| `badge` | string | 否 | 角标文案，如 `"热销"` / `"新品"` |

### 示例条目

```json
{
  "id": "p-128-set",
  "name": "128 色 MARD 拼豆套装",
  "image": "/products/128-set.jpg",
  "price": 99.00,
  "currency": "CNY",
  "description": "包含 MARD 全 128 色，每包约 1000 颗",
  "url": "https://item.taobao.com/iid=REPLACE_ME_128",
  "badge": "热销"
}
```

### 替换购买链接

将 `url` 中的 `REPLACE_ME_*` 替换为真实链接：

- **淘宝**：`https://item.taobao.com/item.htm?id=商品ID`
- **微信小程序**：直链即可
- **有赞/微店**：商品页 URL

### 添加 / 删除商品

- JSON 数组中的每个对象对应一个商品卡片
- 删除条目或将 `id` 对应的图片移除即可下架
- 支持任意数量，桌面端自动按 3 列网格展示，移动端为横向滑动轮播

---

## 二、替换商品图片

### 准备图片

1. 用手机拍摄实物图（光线均匀，背景简洁）
2. 裁剪为正方形最佳
3. 压缩到 200-500 KB（可用 TinyPNG 或 Squoosh）
4. 以商品 ID 命名放入 `public/products/` 目录

### 示例

```
public/products/
├── 128-set.jpg    ← "128 色 MARD 拼豆套装" 的图片
├── 24-set.jpg     ← "24 色入门套装" 的图片
└── tools.jpg      ← "拼豆工具套装" 的图片
```

### 图片要求

| 属性 | 建议值 |
|------|--------|
| 格式 | JPG（照片）或 PNG（截图） |
| 尺寸 | 800×800 px（正方形） |
| 文件大小 | 200-500 KB |
| 内容 | 实物拍摄，商品主体居中 |

### 占位回退

图片尚未上传时，卡片会自动显示商品名作为文字占位（浅色渐变背景），不会报错。
这是预期的 fallback 行为，上线前替换即可。

---

## 三、验证

替换完成后运行：

```bash
npm run build
```

构建产物 `dist/products/` 目录下会包含所有图片，商品卡片会自动显示真实图片和链接。

---

## 四、快速 checklist（上线前）

- [ ] 替换 `public/data/products.json` 中的 `url`（去掉 `REPLACE_ME_*`）
- [ ] 准备商品图放入 `public/products/`
- [ ] 可选：调整 `description` 文案
- [ ] `npm run build` 确认无报错
- [ ] 本地 `npm run dev` 预览卡片展示效果