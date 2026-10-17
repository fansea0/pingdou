import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { failThumbPut } from '../../helpers/failThumbPut.js';

let tmp = '';

/**
 * 每个用例都重新求值 server/works.js —— 配额是模块级状态，靠 resetModules 清干净。
 *  （与 works-likes.test.ts 对进程内去重 Set 的处理方式一致）
 *
 * 连 paths / db 一起返回：投稿第二步要断言「文件有没有真的落盘」，那只能从
 * mediaDir 里 readdir 出来看；只回 works 模块的话测试就得自己去猜目录布局，
 * 而目录布局恰恰是被测行为之外的、随时可能重构的东西。
 */
async function freshWorks(): Promise<{
  works: typeof import('../../../server/works.js');
  paths: typeof import('../../../server/paths.js');
  db: typeof import('../../../server/db.js');
}> {
  tmp = mkdtempSync(join(tmpdir(), 'sub-quota-'));
  process.env.PINGDOU_DATA_DIR = tmp;
  vi.resetModules();
  const db = await import('../../../server/db.js');
  await db.initDb();
  const paths = await import('../../../server/paths.js');
  const works = await import('../../../server/works.js');
  return { works, paths, db };
}

beforeEach(() => {
  delete process.env.PINGDOU_DATA_DIR;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.PINGDOU_DATA_DIR;
  if (tmp && existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
});

describe('投稿配额', () => {
  it('同一 IP + UA 连投 3 件都放行，第 4 件被拒', async () => {
    const { works } = await freshWorks();
    expect(works.SUBMISSION_DAILY_LIMIT).toBe(3);
    expect(works.allowSubmission('1.2.3.4', 'UA')).toBe(true);
    expect(works.allowSubmission('1.2.3.4', 'UA')).toBe(true);
    expect(works.allowSubmission('1.2.3.4', 'UA')).toBe(true);
    expect(works.allowSubmission('1.2.3.4', 'UA')).toBe(false);
  });

  it('换 UA 算另一个人（沿用点赞已拍板的取向）', async () => {
    const { works } = await freshWorks();
    for (let i = 0; i < 3; i++) works.allowSubmission('1.2.3.4', 'UA-A');
    expect(works.allowSubmission('1.2.3.4', 'UA-A')).toBe(false);
    expect(works.allowSubmission('1.2.3.4', 'UA-B')).toBe(true);
  });

  it('换 IP 算另一个人', async () => {
    const { works } = await freshWorks();
    for (let i = 0; i < 3; i++) works.allowSubmission('1.2.3.4', 'UA');
    expect(works.allowSubmission('5.6.7.8', 'UA')).toBe(true);
  });

  /**
   * 只承诺「跨一整个日历日后额度恢复」——这一条验的是可观测行为。
   *
   * 上一版把它叫「跨天自动重置（配额按 UTC 日历日）」，名字里的「UTC」没有任何
   * 断言支撑：用例只跨 `+24h`，UTC 日与本地日在这个跨度上都判成两天，
   * 整时间戳粒度、24 小时滚动窗口同样分不出来（实测把 `isoDay` 换成本地日历日
   * 仍然全绿）。UTC 那一半已挪到下面「日界钉在 UTC 日界」那条专门负责。
   *
   * 「UTC 日」与「每天清表」是两套独立机制（指纹含日期 / rotateQuotaIfNeeded），
   * 任意一套在就能让本条通过，所以本条也不能替其中任一套作证。
   */
  it('跨一整个日历日后额度恢复', async () => {
    const { works } = await freshWorks();
    const day1 = Date.parse('2026-10-17T10:00:00Z');
    for (let i = 0; i < 3; i++) works.allowSubmission('1.2.3.4', 'UA', day1);
    expect(works.allowSubmission('1.2.3.4', 'UA', day1)).toBe(false);
    // 东八区凌晨 1 点仍是 UTC 前一天，所以要跨足一整个 UTC 日
    const day2 = day1 + 24 * 60 * 60 * 1000;
    expect(works.allowSubmission('1.2.3.4', 'UA', day2)).toBe(true);
  });

  /**
   * 「UTC 日历日」这半个承诺的正式担保。
   *
   * 钉在 UTC 日界（23:59:59Z → 00:00:01Z，只差 2 秒）而不是 `+24h`：
   * 这一对在**本地**日历日上是同一天（东八区 07:59:59 和 08:00:01，都落在 10-18），
   * 在 UTC 日历日上才是两天。所以按本地时区切日的实现（`toLocaleDateString`）
   * 会算成「同一天额度已满」→ 第 4 件被拒 → 本条红。按 UTC 切 → 重置 → 放行。
   *
   * 换句话说：本条的判别力来自「这两个瞬间本地同日、UTC 异日」这个前提，
   * 上面的 `+24h` 用例没有这个前提，所以抓不住时区实现的错。
   *
   * 已知局限（不是漏写断言，是原理上做不到）：判别依赖运行环境时区非 UTC。
   * 开发/CI 机器是 UTC+8（`getTimezoneOffset()` = -480），前提成立；
   * 若在 TZ=UTC 的机器上跑，本地日与 UTC 日恒等，时区实现与正确实现不可区分，
   * 这时本条退化为「跨 2 秒会重置」的弱断言。下面那条 UTC 日的直接断言
   * 与时区无关，两条合起来把契约兜住。
   */
  it('日界钉在 UTC 日界，不是本地日历日也不是 24 小时窗口', async () => {
    const { works } = await freshWorks();
    const lateNight = Date.parse('2026-10-17T23:59:59Z');
    const nextDay = Date.parse('2026-10-18T00:00:01Z');

    // 先钉住这对瞬间确实跨了 UTC 日界（与时区无关），否则「跨 2 秒」会变成空转断言
    expect(new Date(lateNight).toISOString().slice(0, 10))
      .not.toBe(new Date(nextDay).toISOString().slice(0, 10));

    for (let i = 0; i < 3; i++) works.allowSubmission('1.2.3.4', 'UA', lateNight);
    expect(works.allowSubmission('1.2.3.4', 'UA', lateNight)).toBe(false);
    // 只过 2 秒就到下一个 UTC 日：额度必须已经回来
    expect(works.allowSubmission('1.2.3.4', 'UA', nextDay)).toBe(true);
  });

  /**
   * 上一条的另一半：本地午夜**不是**额度边界。
   *
   * 为什么需要它：日界那条只在「两处日期都换成本地日」时才抓得住时区实现。
   * 但日期在实现里出现两次（指纹串里一次、rotateQuotaIfNeeded 里一次），
   * 只坏掉其中一处时，另一样还是 UTC，**用户可感知的额度仍然按 UTC 日重置** ——
   * 唯一的破绽是「本地午夜会给所有人白送一次额度重置」。
   *
   * 这条就钉那个破绽：这对瞬间在**本地**上是两天（东八区 23:59 与次日 00:00:30），
   * 在 UTC 上仍是同一天。所以正确实现必须判「额度已满、拒绝」。
   * 指纹或轮转任何一处改用本地日，用户都会在本地午夜白捡 3 件 → 本条变红。
   *
   * 与日界那条成对：那条钉「该重置时必须重置」，本条钉「不该重置时不许重置」，
   * 两条一起把「UTC 日历日」这个承诺从两头封死。
   */
  it('本地午夜不是额度边界：仍在同一个 UTC 日内，跨本地日界也拒绝', async () => {
    const { works } = await freshWorks();
    // 15:59Z = 东八区 23:59；16:00:30Z = 东八区次日 00:00:30 —— 差 90 秒
    const beforeLocalMidnight = Date.parse('2026-10-17T15:59:00Z');
    const afterLocalMidnight = Date.parse('2026-10-17T16:00:30Z');

    // 先钉住这对瞬间在 UTC 上是同一天（与运行环境时区无关），否则断言会变成空转
    expect(new Date(beforeLocalMidnight).toISOString().slice(0, 10))
      .toBe(new Date(afterLocalMidnight).toISOString().slice(0, 10));

    for (let i = 0; i < 3; i++) works.allowSubmission('1.2.3.4', 'UA', beforeLocalMidnight);
    expect(works.allowSubmission('1.2.3.4', 'UA', beforeLocalMidnight)).toBe(false);
    // UTC 还是 10-17：跨过本地午夜不算新的一天，不该白送额度
    expect(works.allowSubmission('1.2.3.4', 'UA', afterLocalMidnight)).toBe(false);
  });

  it('remainingSubmissions 反映还能再投几件', async () => {
    const { works } = await freshWorks();
    expect(works.remainingSubmissions('1.2.3.4', 'UA')).toBe(3);
    works.allowSubmission('1.2.3.4', 'UA');
    expect(works.remainingSubmissions('1.2.3.4', 'UA')).toBe(2);
  });

  it('指纹含 UA 与日期：同 IP 换 UA、同指纹跨天都不同', async () => {
    const { works } = await freshWorks();
    const day1 = Date.parse('2026-10-17T10:00:00Z');
    const day2 = day1 + 24 * 60 * 60 * 1000;
    expect(works.submissionFingerprint('1.2.3.4', 'UA', day1))
      .not.toBe(works.submissionFingerprint('1.2.3.4', 'UA', day2));
    expect(works.submissionFingerprint('1.2.3.4', 'UA-A', day1))
      .not.toBe(works.submissionFingerprint('1.2.3.4', 'UA-B', day1));
    // 稳定：同输入必得同结果，否则计数会漏
    expect(works.submissionFingerprint('1.2.3.4', 'UA', day1))
      .toBe(works.submissionFingerprint('1.2.3.4', 'UA', day1));
  });

  it('分隔符是 NUL：ip="ab"+ua="c" 与 ip="a"+ua="bc" 必须是两个人', async () => {
    const { works } = await freshWorks();
    const t = Date.parse('2026-10-17T10:00:00Z');
    expect(works.submissionFingerprint('ab', 'c', t))
      .not.toBe(works.submissionFingerprint('a', 'bc', t));
  });

  it('指纹是 16 位 hex（与 likeFingerprint 同规格）', async () => {
    const { works } = await freshWorks();
    expect(works.submissionFingerprint('1.2.3.4', 'UA')).toMatch(/^[0-9a-f]{16}$/);
  });

  /**
   * 这条只管「触顶**之后**新投稿还进得来」（区分 fail-open 与 fail-closed）。
   * 它**抓不到「把上限检查整段删掉」的变异** —— 删掉之后新身份照样放行，断言照样成立。
   * 判别力在下面 describe 的「整份丢弃的代价可观测」那几条。
   */
  it('指纹异常膨胀时整份丢弃（fail-open），而不是拒绝新投稿', async () => {
    const { works } = await freshWorks();
    // 伪造 20_000+ 个不同 UA，把 Map 撑过上限
    for (let i = 0; i < works.SUBMISSION_QUOTA_MAX + 10; i++) {
      works.allowSubmission(`10.0.${Math.floor(i / 256)}.${i % 256}`, `UA-${i}`);
    }
    // 触顶后新投稿仍然放行 —— 一次异常流量不该把当天全站投稿入口变成不可用
    expect(works.allowSubmission('203.0.113.9', 'UA-fresh')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 配额指纹表的上限
// ---------------------------------------------------------------------------

describe('配额指纹表的上限', () => {
  /**
   * 灌 n 个不同身份进配额表。
   *
   * 身份必须**两两不同**：指纹只由 ip+ua+日 决定，撞了就还是同一个 key，
   * Map 的 size 涨不上去（点赞侧踩过同一个坑：用只读接口灌集合，集合里根本没东西，
   * 「上限触发后怎样」自然测不出任何差别）。`from` 是身份序号起点，
   * 换段起点即可保证与先前灌入的身份不重合。
   */
  function fillIdentities(
    works: typeof import('../../../server/works.js'),
    n: number,
    now: number,
    from = 0,
  ): void {
    for (let i = from; i < from + n; i++) {
      works.allowSubmission(`10.${(i >> 8) % 256}.${i % 256}`, `UA-${i}`, now);
    }
  }

  const EARLY_IP = '1.1.1.1';
  const EARLY_UA = 'UA-early';
  const T0 = Date.parse('2026-10-17T10:00:00Z');

  /** 让 early 这个身份把当天 3 件用光，返回它此刻的剩余额度 */
  function exhaustEarly(works: typeof import('../../../server/works.js')): void {
    for (let i = 0; i < works.SUBMISSION_DAILY_LIMIT; i++) {
      works.allowSubmission(EARLY_IP, EARLY_UA, T0);
    }
  }

  /**
   * 触顶策略本身的判别力用例 ★ —— 与点赞侧 works-likes.test.ts 的同名思路一致。
   *
   * 「整份丢弃」这个策略的**代价本身是可观测的**：清空之后，早期登记过的指纹
   * 也一起忘了，那位用户今天还能再投 3 件。上限检查若被整段删掉，
   * 清空永不发生、被忘掉的指纹仍然记得 → 下面两条断言立刻变红。
   *
   * 时序要点：触发清空的是**一条新身份**的写入。若拿 early 那条去调，
   * 它此刻还在表里，会在 `used >= LIMIT` 那一支直接返回 false，根本走不到清空逻辑。
   *
   * 这条同时把一个安全语义落成断言：**攻击者只要把表灌爆，就能把所有人的当日
   * 额度重置**。这是 fail-open 的既定代价（宁可放开也不让全站投不了稿），
   * 写进用例是为了让它以后被人改动时必须有人看见。
   */
  it('触顶时整份丢弃：早期指纹的额度也被一起清零 ★', async () => {
    const { works } = await freshWorks();
    exhaustEarly(works);
    expect(works.remainingSubmissions(EARLY_IP, EARLY_UA, T0)).toBe(0);

    // early 1 条 + MAX 条新身份 → 表里 MAX+1 条，越过上限
    fillIdentities(works, works.SUBMISSION_QUOTA_MAX, T0);
    // 再来一条新身份：此刻 size 已越界 → 整份被丢弃
    expect(works.allowSubmission('203.0.113.9', 'UA-trigger', T0)).toBe(true);

    expect(works.remainingSubmissions(EARLY_IP, EARLY_UA, T0)).toBe(works.SUBMISSION_DAILY_LIMIT);
    expect(works.allowSubmission(EARLY_IP, EARLY_UA, T0)).toBe(true);
  }, 30_000);

  /**
   * 对照：没到上限时**不许**清空。
   *
   * 这条是上面那条的判别力前提 —— 若实现写成「每次写入都清空」，
   * 两条会同时绿（本条在 1000 条时就忘了 early，上条则仍然成立），
   * 所以本条必须保留。
   */
  it('未到上限时额度不失效（对照：清空只在真的越界时发生）', async () => {
    const { works } = await freshWorks();
    exhaustEarly(works);
    fillIdentities(works, 1000, T0);
    expect(works.remainingSubmissions(EARLY_IP, EARLY_UA, T0)).toBe(0);
  });

  /**
   * 把 `>` 与 `>=` 的边界钉死。
   *
   * 实现是 `if (quotaCount.size > SUBMISSION_QUOTA_MAX)`，检查发生在**写入之前**，
   * 所以 size 恰好等于上限时不该清空，要等下一个身份进来（size 变成 MAX+1）才清。
   * 把 `>` 改成 `>=` 会在「恰好等于上限」那一刻提前一刀切 —— 上面的用例仍绿
   * （那时它反而"正常"清掉了），只有本条能分辨。
   *
   * 前半段钉「== MAX 不清」，后半段钉「越界要清」，缺一不可。
   */
  it('恰好等于上限时不清空，越过一个才清空（钉死 > 与 >=）', async () => {
    const { works } = await freshWorks();
    exhaustEarly(works);

    // early 1 条 + MAX-1 条新身份 = 恰好 MAX 条
    fillIdentities(works, works.SUBMISSION_QUOTA_MAX - 1, T0);
    // 下一条写入发生在 size == MAX 的时刻：按现在的实现不该清空
    expect(works.allowSubmission('10.9.9.9', 'UA-boundary', T0)).toBe(true);
    // 早期额度仍在 = 上一步没有清空。把 > 改成 >= 会在这里提前清掉
    expect(works.remainingSubmissions(EARLY_IP, EARLY_UA, T0)).toBe(0);

    // 再来一条全新身份：此刻 size 已是 MAX+1，越界 → 该清了
    fillIdentities(works, 1, T0, 5_000_000);
    expect(works.remainingSubmissions(EARLY_IP, EARLY_UA, T0)).toBe(works.SUBMISSION_DAILY_LIMIT);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// 投稿两步的服务层
// ---------------------------------------------------------------------------

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const WEBP = Buffer.from([0x52, 0x49, 0x46, 0x46]);

const CLIENT = { ip: '1.2.3.4', userAgent: 'UA' };

function goodInput(over: Record<string, unknown> = {}) {
  return {
    title: '粉色小熊',
    boardW: 87,
    boardH: 62,
    beanCount: 3814,
    colorCount: 42,
    estimateMinutes: 190,
    ...over,
  };
}

describe('createSubmission', () => {
  it('写入一行 pending 记录并返回 id 与不可猜的令牌', async () => {
    const { works } = await freshWorks();
    const created = works.createSubmission(goodInput(), CLIENT);
    expect(created.id).toBeGreaterThan(0);
    expect(created.uploadToken).toMatch(/^[0-9a-f]{32}$/);
    const rows = works.listAllWorks();
    expect(rows[0].status).toBe('pending');
    expect(rows[0].published).toBe(false);
    expect(rows[0].title).toBe('粉色小熊');
  });

  it('四个图纸参数原样入库', async () => {
    const { works } = await freshWorks();
    const created = works.createSubmission(goodInput(), CLIENT);
    const row = works.listAllWorks().find(r => r.id === created.id)!;
    expect(row.boardW).toBe(87);
    expect(row.boardH).toBe(62);
    expect(row.beanCount).toBe(3814);
    expect(row.colorCount).toBe(42);
    expect(row.estimateMinutes).toBe(190);
    expect(row.description).toBe('');
  });

  it('标题 trim 后为空则报 400 类错误（投稿必须填名称 unlike 后台上传）', async () => {
    const { works } = await freshWorks();
    expect(() => works.createSubmission(goodInput({ title: '   ' }), CLIENT))
      .toThrow(works.SubmissionInputError);
    expect(() => works.createSubmission(goodInput({ title: 123 }), CLIENT))
      .toThrow(works.SubmissionInputError);
  });

  it('数字字段非法一律抛错，绝不静默转 0', async () => {
    const { works } = await freshWorks();
    for (const bad of ['87', 87.5, true, null, undefined, NaN, 0, -1, 501]) {
      expect(() => works.createSubmission(goodInput({ boardW: bad }), CLIENT))
        .toThrow(works.SubmissionInputError);
    }
  });

  it('estimateMinutes 允许 0（预估时间可以缺），但不允许负数', async () => {
    const { works } = await freshWorks();
    expect(() => works.createSubmission(goodInput({ estimateMinutes: 0 }), CLIENT)).not.toThrow();
    expect(() => works.createSubmission(goodInput({ estimateMinutes: -1 }), CLIENT))
      .toThrow(works.SubmissionInputError);
  });

  it('参数校验失败不消耗配额（名称打错字不该白扣 3 件里的 1 件）', async () => {
    const { works } = await freshWorks();
    expect(() => works.createSubmission(goodInput({ title: '' }), CLIENT)).toThrow();
    expect(works.remainingSubmissions(CLIENT.ip, CLIENT.userAgent)).toBe(3);
  });

  it('配额用尽时抛 SubmissionQuotaError，且不再写库', async () => {
    const { works } = await freshWorks();
    for (let i = 0; i < 3; i++) works.createSubmission(goodInput(), CLIENT);
    expect(() => works.createSubmission(goodInput(), CLIENT))
      .toThrow(works.SubmissionQuotaError);
    expect(works.listAllWorks()).toHaveLength(3);
  });
});

describe('attachSubmissionImage', () => {
  it('写入图片、落盘文件，并清空一次性令牌', async () => {
    const { works, paths } = await freshWorks();
    const created = works.createSubmission(goodInput(), CLIENT);
    const detail = await works.attachSubmissionImage(created.id, created.uploadToken, {
      image: { body: PNG, mime: 'image/png' },
      thumb: { body: WEBP, mime: 'image/webp' },
      width: 1500, height: 2200,
    });
    expect(detail.imageUrl).toMatch(/^\/media\/works\/[0-9a-f]{16}\.png$/);
    expect(detail.bytes).toBe(PNG.byteLength);
    expect(detail.width).toBe(1500);
    expect(detail.height).toBe(2200);
    expect(existsSync(join(paths.PATHS.mediaDir, 'works'))).toBe(true);

    // 令牌用完即失效：同一个令牌不能二次上传
    await expect(works.attachSubmissionImage(created.id, created.uploadToken, {
      image: { body: PNG, mime: 'image/png' },
    })).rejects.toThrow(works.SubmissionInputError);
  });

  it('令牌不匹配就拒（id 是可猜的自增整数，只靠 id 别人就能挂图到你的记录上）', async () => {
    const { works } = await freshWorks();
    const created = works.createSubmission(goodInput(), CLIENT);
    await expect(works.attachSubmissionImage(created.id, 'deadbeef', {
      image: { body: PNG, mime: 'image/png' },
    })).rejects.toThrow(works.SubmissionInputError);
    // 被拒之后原行仍然是「没有图」的状态。
    // 注意不能写 toBe('')：storage.publicUrl('') 拼出来的是 '/media/'，
    // 那是恒假的断言（正确实现也过不了），等于这条只验了 throws。
    // 真正要钉的是「没有被写进任何文件 key」，用「URL 里不出现 works/ 前缀」表达。
    expect(works.listAllWorks()[0].imageUrl).not.toMatch(/\/media\/works\//);
  });

  it('id 不存在抛 SubmissionInputError', async () => {
    const { works } = await freshWorks();
    await expect(works.attachSubmissionImage(9999, 'x', {
      image: { body: PNG, mime: 'image/png' },
    })).rejects.toThrow(works.SubmissionInputError);
  });

  it('缩略图不是 webp 时整次上传被拒（不落半张图）', async () => {
    const { works, paths } = await freshWorks();
    const created = works.createSubmission(goodInput(), CLIENT);
    await expect(works.attachSubmissionImage(created.id, created.uploadToken, {
      image: { body: PNG, mime: 'image/png' },
      thumb: { body: PNG, mime: 'image/png' },
    })).rejects.toThrow(/webp/i);
    // 原图也不该留下：校验发生在落盘之前。
    // 目录压根没被创建是「零文件」的合法形态（readdirSync 直接 ENOENT 抛错，
    // 那报的是「目录不存在」，不是「目录里有几个文件」），所以先判存在性。
    const worksDir = join(paths.PATHS.mediaDir, 'works');
    const landed = existsSync(worksDir) ? readdirSync(worksDir) : [];
    expect(landed).toHaveLength(0);
  });

  it('尺寸缺省或非法时落 0，详情页显示「未知」而不是 NaN', async () => {
    const { works } = await freshWorks();
    const created = works.createSubmission(goodInput(), CLIENT);
    const d = await works.attachSubmissionImage(created.id, created.uploadToken, {
      image: { body: PNG, mime: 'image/png' },
      width: 'abc', height: '',
    });
    expect(d.width).toBe(0);
    expect(d.height).toBe(0);
  });

  /**
   * 审核动作先到时，令牌仍然有效也不许再挂图。
   *
   * 为什么单列一条：正常路径下 `status !== 'pending'` 与「令牌已清空」是两件事，
   * 但在「挂完图就再调一次」的场景里前者**不可观测** —— 上一次成功已经把
   * upload_token 置空，所以把 status 检查整段删掉，上面那条的 throws 断言照样成立
   * （实测：变异后 26 条全绿）。留着这条把 status 检查的职责单独钉住：
   * 站主在投稿还没配图时就把它拒了，用户拿着第一步的令牌再来挂图，必须被拒，
   * 否则审核队列里会冒出一张「已拒绝」状态却带着成品图的记录，语义自相矛盾。
   *
   * 用 SQL 改状态而不是走后台审核接口：那个接口属于后续任务，本文件不该依赖它。
   */
  it('投稿已被审核处理后，即使令牌仍然有效也不许再挂图', async () => {
    const { works, db } = await freshWorks();
    const created = works.createSubmission(goodInput(), CLIENT);
    // 令牌还留在行里（没走过挂图那步），此时把状态改成已处理
    db.runStmt(`UPDATE works SET status = 'rejected' WHERE id = ?`, [created.id]);

    await expect(works.attachSubmissionImage(created.id, created.uploadToken, {
      image: { body: PNG, mime: 'image/png' },
    })).rejects.toThrow(works.SubmissionInputError);
    expect(works.listAllWorks()[0].imageUrl).not.toMatch(/\/media\/works\//);
  });

  /**
   * 令牌校验将来的**唯一兜底**：image_key 非空守卫。
   *
   * 为什么这条值得单独立：在正常路径上它与「令牌已清空」完全等价 —— 挂图成功时
   * upload_token 已经被置空，所以即使把 `if (row.image_key)` 整行删掉，上面那条
   * 「令牌用完即失效」的断言照样成立（实测：删掉后 27 条全绿）。
   *
   * 但它不是冗余：一旦有人给「管理员补发上传令牌」这类路径开口子，令牌就重新可用了，
   * 此时这条守卫是「不许把已经挂好图的投稿换成另一张」的唯一防线，而那时候依然
   * 不会有任何测试变红。所以用 SQL 把令牌补回去，单独把它的职责钉住。
   *
   * 用 SQL 直接改 upload_token 而不是走某个补发接口：那个接口还不存在，
   * 本文件不该依赖后续任务。
   */
  it('已挂过图的投稿，令牌被补发回来也不许再挂（image_key 守卫是唯一兜底）', async () => {
    const { works, db, paths } = await freshWorks();
    const created = works.createSubmission(goodInput(), CLIENT);
    const first = await works.attachSubmissionImage(created.id, created.uploadToken, {
      image: { body: PNG, mime: 'image/png' },
    });

    // 模拟「补发上传令牌」：令牌重新可用，但图已经在行里了
    db.runStmt(`UPDATE works SET upload_token = ? WHERE id = ?`, ['regranted', created.id]);

    await expect(works.attachSubmissionImage(created.id, 'regranted', {
      image: { body: WEBP, mime: 'image/webp' },
    })).rejects.toThrow(works.SubmissionInputError);

    // 原图没被换掉，磁盘上也没多出第二张（守卫失效时这里会变成 2 个文件）
    expect(works.listAllWorks()[0].imageUrl).toBe(first.imageUrl);
    expect(readdirSync(join(paths.PATHS.mediaDir, 'works'))).toEqual([first.imageUrl.split('/').pop()!]);
  });

  /**
   * 缩略图写盘失败 → 降级为无缩略图，且 DB 不记那个从未落盘的 key。
   *
   * 与 createWork / replaceWorkImage 的同名用例同款（共用 failThumbPut 助手），
   * 因为投稿路径的这段代码是独立复制的，不是共用实现，所以也得独立钉一次。
   *
   * 护栏在这一步：把 `thumbKey = candidate` 提到 try 之前（写失败也照记）不会让任何
   * 抛错发生，但会让 DB 声称一个不存在的文件存在 —— /media/...-t.webp 永久 404、
   * 前台破图，而后台「无缩略图」的标记判据恰好是 thumbUrl === imageUrl，永远标不出
   * 这种故障。所以除了降级本身，还要断言磁盘上没有 -t.webp。
   */
  it('缩略图写盘失败时降级为无缩略图，且 DB 不记不存在的 key', async () => {
    const { works, paths } = await freshWorks();
    const created = works.createSubmission(goodInput(), CLIENT);
    const restore = await failThumbPut();
    try {
      const detail = await works.attachSubmissionImage(created.id, created.uploadToken, {
        image: { body: PNG, mime: 'image/png' },
        thumb: { body: WEBP, mime: 'image/webp' },
      });
      expect(detail.thumbUrl).toBe(detail.imageUrl);
      const files = readdirSync(join(paths.PATHS.mediaDir, 'works'));
      expect(files.filter(f => f.endsWith('-t.webp'))).toEqual([]);
      expect(files).toEqual([detail.imageUrl.split('/').pop()!]);
      // 重启后从 DB 读出来同样是「无缩略图」，不是启动时侥幸
      expect(works.listAllWorks()[0].thumbUrl).toBe(detail.imageUrl);
    } finally {
      restore();
    }
  });

  /**
   * DB 更新失败 → 把已经落盘的文件回收掉，不留孤儿。
   *
   * 孤儿文件的代价是可观测的：它没有记录、也没有主键可追溯，只能靠人肉扫盘清理；
   * 而且它占着 media/works/ 下的真实文件名，日后谁扫到都可能当成正常文件留着。
   *
   * 怎么逼出这条分支：给 works 表挂一个 `BEFORE UPDATE` 触发器，当目标行还没图时
   * 直接 RAISE(ABORT)。UPDATE 抛错 → attachSubmissionImage 进入 catch 回收分支。
   * 触发器只认「旧 image_key 为空」，所以只挡第一步那一次 UPDATE，不会波及本文件
   * 其它用例的正常挂图（每个用例都是全新的库）。
   */
  it('DB 更新失败时回收已落盘的文件，不留孤儿', async () => {
    const { works, paths, db } = await freshWorks();
    const created = works.createSubmission(goodInput(), CLIENT);
    db.runStmt(
      `CREATE TRIGGER block_pending_image BEFORE UPDATE ON works
         WHEN OLD.image_key = ''
       BEGIN SELECT RAISE(ABORT, 'simulated DB failure'); END`,
      []
    );

    await expect(works.attachSubmissionImage(created.id, created.uploadToken, {
      image: { body: PNG, mime: 'image/png' },
      thumb: { body: WEBP, mime: 'image/webp' },
    })).rejects.toThrow(/simulated DB failure/);

    // 原图与缩略图都该被回收：目录里空无一物（回收代码被删时会残留两个文件）
    expect(readdirSync(join(paths.PATHS.mediaDir, 'works'))).toEqual([]);
    // DB 也没写进去 —— 触发器拦下的 UPDATE 不该留下半截状态
    expect(works.listAllWorks()[0].imageUrl).not.toMatch(/\/media\/works\//);
  });
});
