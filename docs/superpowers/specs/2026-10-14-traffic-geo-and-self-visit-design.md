# 流量来源地 + 自我访问区分

- **日期**: 2026-10-14
- **分支**: `feat/traffic-geo-and-self-visit-stats`
- **状态**: 已实施
- **依赖**: 现有 `sql.js` engine + 现有 `events` / `sessions` 表 + 现有 `/api/statics/summary`

## 一、需求

### 1.1 背景

站点后台只有 UV / PV / 商品点击 / 每日事件总数。站主自己天天在调试站点，
PV 涨了分不清是"我自己在刷"还是"真的有外部访客"。同时完全看不到流量来自
哪些省市——判断不了这是不是只有本地朋友在玩，还是有自然外链/搜索带来的
陌生流量。

### 1.2 核心洞察（产品角度）

"访问量涨了"本身不是信息，**"外部访客涨了"才是信息**。所以本设计的重心
不是加一张省份表，而是给所有存量指标加上一个正交的维度：`is_self`
（这次访问是不是后台登录账号发起的）。

两个信号源，主次分明：

| 信号 | 判定 | 可靠性 | 说明 |
|------|------|--------|------|
| 登录 Cookie | `verifySessionFromRequest(req)` 命中 | 高 | 站主登录后台后浏览前台，一定带 `statics_token` |
| 指纹 IP | `settings.selfFingerprint === ip` | 中 | 站主手动打开"标记我的访问"，此后即使退出登录、换浏览器也认 |

指纹是补充不是替代：移动网络 IP 会漂，所以指纹必然漏判；登录态必然覆盖
"我正在调试"这个主场景。两个都开，漏判率最低。

### 1.3 用户故事

| ID | 故事 | 验收 |
|----|------|------|
| GEO-1 | 每次 `/api/track` 落库时带上省 / 市 | `events` 新增行 `province`/`city` 非空（可归属的公网 IP） |
| GEO-2 | admin 能按时间窗查询来源地分布 | `GET /api/statics/regions?days=30` 返回省级 + 市级聚合 |
| GEO-3 | 省级分布能下钻到城市 | 接口返回 `cities` 明细，前端点省份展开 |
| SELF-1 | 任意指标都能区分"外部访客"和"内部访问" | 所有聚合返回 `*Pv` / `*Uv` 的 self / external 拆分 |
| SELF-2 | 站主能一键把当前自己标成"内部" | 后台开关写入 `settings.selfFingerprint`，即时生效 |
| SELF-3 | 旧库直接升级，不丢历史数据 | 旧 `stats.db` 启动不报错，历史行 `province=NULL` 归入「未知」 |
| COMPAT-1 | 现有接口行为完全不变 | `/api/statics/summary` 响应体一字不改，merchant 视图不受影响 |

### 1.4 范围

**范围内**：`server/geo.ts` 新增；`events`/`sessions` 加列；`/api/track` 写入
归属与 self 标记；`GET /api/statics/regions`（admin only）；后台统计页新增
「来源地」板块（方块地图 + 排行 + 下钻）；`selfFingerprint` 设置项。

**非目标**：
- ❌ 改造已有 `ip_hash` 语义（当前存的是明文 IP，见 §5 遗留决策）
- ❌ 地图改用 ECharts / 高德 / 真实 GeoJSON 省份多边形（用方块地图代替，见 §4.2）
- ❌ UV 口径变更、事件保留策略、跨天去重
- ❌ merchant 也能看来源地（外部数据，仅 admin）

## 二、方案选型：省市数据从哪来

| 方案 | 成本 | IP 是否出境 | 风险 |
|------|------|------------|------|
| A 后端调第三方 IP 归属 API | 每个新 IP 一次外网 HTTP，有额度/限流 | 是 ❌ | 慢、易挂、拖垮 track 接口 |
| **B 离线 `ip2region`** | npm 包自带 8.7MB db，内存查，2µs/次 | 否 ✅ | db 库不更新，新 IP 段可能查不到 |
| C nginx `geoip2` 注入 header | 要编译 nginx 模块 + 申请 mmdb | 否 ✅ | 生产 nginx 改动风险，本项目单点部署 |

**选 B 为主 + C 为可选覆盖。** `ip2region` 的 npm 包自带 `data/ip2region.db`，
`npm install` 即得，不需要额外下载、不需要 env 配置、不需要改服务器。nginx 那条
通道（`X-Geo-Province` / `X-Geo-City`）只是代码里多 10 行的事，留作口子：哪天
装了 geoip2，配置里加两行 `proxy_set_header` 就自动切到更准的源，不用改代码。

## 三、数据模型

### 3.1 加列（向后兼容）

SQLite 的 `ALTER TABLE ... ADD COLUMN` 是纯追加，老行读出来新列为 `NULL`，
老查询 `SELECT kind, ref, created_at, day, ip_hash` 不受影响。
SQLite 不支持 `ADD COLUMN IF NOT EXISTS`，所以用 `PRAGMA table_info` 判断后再 ALTER：

```sql
ALTER TABLE events   ADD COLUMN province TEXT;
ALTER TABLE events   ADD COLUMN city     TEXT;
ALTER TABLE events   ADD COLUMN is_self  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN province TEXT;
ALTER TABLE sessions ADD COLUMN city     TEXT;
ALTER TABLE sessions ADD COLUMN is_self  INTEGER NOT NULL DEFAULT 0;
```

`NOT NULL DEFAULT 0` 合法（SQLite 要求非空列必须带默认值），老行自动回填 0，
所以「历史数据 = 全部外部访问」这个假设是安全的默认：站主在功能上线前产生的
记录，本来也无法判定来源。

索引：`idx_events_province ON events(province, created_at)`，让省份聚合走索引。

### 3.2 归属归一化

`ip2region` 返回的省名不带后缀的很多（`上海`、`广东`、`内蒙古`），直接存会导致
同一个地区两种写法、聚合出两行。归一化规则：

- `上海`/`北京`/`天津`/`重庆` → 补 `市`
- `广东`/`江苏`… 结尾无「省」且非自治区 → 补 `省`
- `内蒙古`/`广西`/`西藏`/`宁夏`/`新疆`/`香港`/`澳门`/`台湾` → 保持原样
- `内网IP`、空串、`0`、纯 `内网` 开头 → 判为**未知**（`NULL`）
- 非中国大陆（`country !== '中国'`）→ `province = '境外'`，`city` 取原值

城市名同理去掉「市」后缀由前端统一加，避免「深圳市」/「深圳」混排。

### 3.3 `settings` 新增键

| key | 值 | 语义 |
|-----|-----|------|
| `selfFingerprint` | 客户端 IP 字符串，空表示关闭 | 站主点开关时写入当前请求 IP |

走现有 `settings` 表 + 现有 `getSetting` 缓存，零新机制。
注意 `ALLOWED_SETTING_KEYS` 目前是 `Set(['showProducts'])`，需要加进白名单。

## 四、接口设计

### 4.1 `GET /api/statics/regions?days=N`（新增，`requireAuth` + admin）

`/api/statics/summary` 一字不改（COMPAT-1），新增独立端点：

```jsonc
{
  "days": 30,
  "totals": {
    "pv": 128, "uv": 41,
    "selfPv": 96, "selfUv": 3,          // 内部（登录/指纹）
    "externalPv": 32, "externalUv": 38, // 外部（匿名）
    "unknownPv": 0, "unknownUv": 0      // 归属不出来的（境外/内网/库未覆盖）
  },
  "provinces": [                          // 按 externalPv 降序，截断 top 34
    { "province": "广东省", "pv": 20, "uv": 14, "selfPv": 2,
      "externalPv": 18, "externalUv": 14, "share": 0.5625 }
  ],
  "cities": [                             // 按 externalPv 降序，截断 top 200
    { "province": "广东省", "city": "深圳市", "pv": 12, "uv": 9, "selfPv": 0 }
  ],
  "perDay": [ { "day": "2026-10-01", "pv": 4, "selfPv": 3, "externalPv": 1, "externalUv": 1 } ],
  "coverage": { "resolvedPv": 120, "resolvedUv": 39, "totalPv": 128, "totalUv": 41 }
}
```

`unknown` 单独成桶而不是混进「其他」，否则境外流量会伪装成一个省份。
`coverage` 让前端能诚实地说「已识别 94% 的访客 IP」。

### 4.2 后台展示设计（§4 是接口，§5 是设计）

见下一节。

## 五、界面设计

### 5.1 为什么用方块地图（tile grid map）而不是真实地图

真实省份多边形要一份 ~1MB 的 GeoJSON + ECharts 或 d3-geo。个人站的访问量
根本看不出省界形状的差异，用户要的是**排序**而不是**空间**。方块地图：

- 每省一个圆角方块，按地理大致方位排布，视觉上仍是"中国"的形状
- 按值着色（sequential 单色阶，深 = 多），面积相等 → 不会被面积大 mislead
- 零依赖、零额外请求、SVG 直接画，和现有 `DayChart` 手写 SVG 的风格一致
- 34 个方块一屏排完，鼠标悬停出 tooltip，点击下钻

### 5.2 板块结构

```
统计概览
┌──────────┬──────────┬──────────┬──────────┐
│ 外部 UV  │ 内部 UV  │ 外部 PV  │ 内部 PV  │   ← 主视觉：外部在左，一眼看出主体
└──────────┴──────────┴──────────┴──────────┘
  [ 排除我的访问 ✓ ]  ← 开关，默认开；关掉看全量

来源地分布                              [近7天][近30天]
┌──────────────────────────────────┬──────────────┐
│                                  │ 广东省  18    │
│      方 块 地 图（SVG）           │ ███████ 56%  │
│                                  │ 浙江省   6    │
│                                  │ ██     19%   │
└──────────────────────────────────┴──────────────┘
点击「广东省」→ 右侧排行榜换成城市列表（深圳 12 / 广州 4 / 东莞 2）
再次点击 / 点「全国」→ 回到省份视图

趋势   [ 外部 ][ 内部 ][ 全部 ]     ← 堆叠柱状图，外部在下
```

关键决策：
1. **概览卡片把「外部 / 内部」直接并列**，不藏在二级面板。这是本次需求的
   正面回答，排序上外部在前（外部才是要判断的主体），内部用弱化的灰调。
2. **方块地图和排行榜左右分栏**：地图给空间直觉，排行榜给精确数字，两者
   互为索引，不用来回看。
3. **下钻只改右栏，不换页**：保持上下文，避免"点进去就忘了自己在看什么"。
4. **趋势图三态切换**，默认「外部」——和概览卡的默认口径一致。
5. 空态明确写「尚未采集到来源地数据」而不是空白，因为历史数据永远补不回来。

### 5.3 配色

复用全局 token。主色阶用项目橙 `--color-accent`（`#e07856`）做单色渐变：
`rgba(224,120,86, 0.12) → 1.0` 五档；"内部访问"系列用中性灰 `--color-text-muted`，
视觉上就不会被误当成外部增长。

## 六、遗留决策（本次不做，留档）

1. **`ip_hash` 实际存的是明文 IP**（`server/index.ts` 直接传 `clientIp`，
   字段名和内容不符）。改成 sha256 可以让 UV 口径不变（一一映射）同时去掉
   明文，但要付出「迁移当天同 IP 被算成两个 UV」的代价，属于数据口径变更，
   应作为独立提案。
2. **`ip2region` 的 db 有更新滞后**，新分配的小段 IP 可能查不到 → 落到
   「未知」桶。想提高覆盖率可切到 nginx geoip2 + 完整 GeoLite2 mmdb。
3. **指纹 IP 会被移动网络漂移打脸**，只作为兜底信号。
4. 没有来源地数据的事件占比可能很高（老数据 + 库未覆盖），`coverage` 字段
   的存在就是为了让这个事实可见，而不是被 `unknown` 桶悄悄吞掉。
