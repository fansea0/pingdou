# 拼豆图生成器 SEO 基线设计

## 目标

让 `https://拼豆.xyz/` 的首页向搜索引擎和社交平台准确说明其用途：在线将图片转换为拼豆图纸，并提供 MARD 色号对照。

## 范围

- 为首页设置唯一、简洁的中文标题与 description，覆盖“拼豆图生成器”“拼豆图纸在线生成”“MARD 色号对照”。
- 在 HTML 源码中提供 canonical、robots、Open Graph、Twitter Card、主题色和 `zh-CN` 文档语言。
- 在 HTML 源码中嵌入 `WebSite` 与 `WebApplication` JSON-LD，使用正式首页 URL、中文站点名和工具功能描述。
- 新增 `public/robots.txt`，允许公开首页被抓取，禁止后台 `/statics`，并声明 sitemap 地址。
- 新增 `public/sitemap.xml`，仅包含规范首页 URL。
- 在现有首页的静态 HTML 中加入一段面向用户的工具说明，使核心主题无需等待 JavaScript 渲染即可被理解。

## 索引边界

- 仅将根路径 `/` 声明为可索引的公开页面。
- `/statics` 是登录后的统计后台，不写入 sitemap，并通过 robots 规则禁止抓取。
- 不新增虚构的内容页、评价、评分或 FAQ 结构化数据。

## 不变项

- 图片处理、导出、商品展示和后台鉴权逻辑不变。
- 不承诺搜索排名；本次交付仅改善抓取、理解、去重与搜索结果展示的技术基础。

## 验证

- 新增测试检查关键 meta、canonical 与 JSON-LD 内容。
- 验证 robots 与 sitemap 的正式 URL、抓取规则和 XML 格式。
- 运行类型检查和生产构建。
