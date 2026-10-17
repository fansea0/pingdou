import type { AdminWorkDetail } from '../../server/works.js';

type WorksModule = typeof import('../../server/works.js');

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const WEBP = Buffer.from([0x52, 0x49, 0x46, 0x46]);

/**
 * 每造一件作品就换一个「投稿人身份」。
 *
 * 为什么必须换：投稿配额是**每 IP + UA 每天 3 件**（allowSubmission），而像
 * 「默认每页 10 条」那种用例一条就要造 12 件 —— 固定身份会在第 4 件就撞上
 * SubmissionQuotaError，用例变成在测配额而不是在测分页。配额本身由
 * submissions.test.ts 单独钉，这里要的是「额度永远用不完」。
 */
let clientSeq = 0;
function nextClient(): { ip: string; userAgent: string } {
  const n = (clientSeq += 1);
  return { ip: `10.0.${Math.floor(n / 256) % 256}.${n % 256}`, userAgent: `vitest-seed-${n}` };
}

export interface SeedWorkOptions {
  title?: string;
  description?: string;
  /**
   * false = **过审之后再下架**（status='approved' 且 published=0），也就是草稿。
   *
   * 不能反过来做成「未过审 + 下架」：Task 2 之后「已下架」与「未过审」是两件事，
   * 「下架」这个动作本身就以「它上过架」为前提。不变量①（published=1 ⇒ approved）
   * 禁止造出 pending + published=0 这种两边都不沾的含混数据。
   */
  published?: boolean;
  boardW?: number;
  boardH?: number;
  /**
   * false = 挂图时不带缩略图，thumb_key 留空（前台用原图当缩略图）。
   * 生产上前端总会传，所以只在专测「无缩略图」降级路径的用例里关掉。
   */
  thumb?: boolean;
}

/**
 * 造一件「已通过审核」的作品，走真实路径：
 *   createSubmission → attachSubmissionImage → approveWork（→ 可选下架）
 *
 * 为什么不用一条 INSERT 的捷径：投稿是唯一的进货入口，捷径会绕开 status /
 * upload_token 的写入 —— 而那正是这次改动新增的东西。测试必须踩在真实路径上，
 * 否则「投稿建出来的行在公开查询里可不可见」这类断言就是假的。
 *
 * works 从参数拿而不是直接 import：各测试文件用 vi.resetModules() 重置模块注册表，
 * 直接 import 到的是**另一个** server/works.js 实例（另一个 DB 连接），
 * 写进去的记录当前用例根本看不见。
 */
export async function makeApprovedWork(
  works: WorksModule,
  opts: SeedWorkOptions = {},
): Promise<AdminWorkDetail> {
  const { id } = await makePendingWork(works, opts);
  const approved = works.approveWork(id);
  // 下架必须落在「已过审」之后：updateWorkMeta 会对 published=true 且未过审的行抛错，
  // 顺序反了这里直接炸，而炸的原因不是「草稿不该存在」而是「不变量①被绕过」。
  return opts.published === false ? works.updateWorkMeta(id, { published: false }) : approved;
}

/**
 * 造一件停在待审核状态的投稿（图已挂上），供审核 / 未过审可见性相关的测试使用。
 *
 * 返回 uploadToken 是因为「挂错令牌 / 已挂过图」那几条用例要的就是非法路径；
 * detail 则是挂图之后那一刻的后台形状（图已落库、status 仍是 pending）。
 */
export async function makePendingWork(
  works: WorksModule,
  opts: SeedWorkOptions = {},
): Promise<{ id: number; uploadToken: string; detail: AdminWorkDetail }> {
  const created = works.createSubmission(
    {
      title: opts.title ?? '测试作品',
      boardW: opts.boardW ?? 50,
      boardH: opts.boardH ?? 50,
      beanCount: 1234,
      colorCount: 30,
      estimateMinutes: 60,
    },
    nextClient(),
  );
  // 缩略图一并挂上：thumb_key 的降级、删除时清文件那几条用例都要两份文件。
  const attached = await works.attachSubmissionImage(created.id, created.uploadToken, {
    image: { body: PNG, mime: 'image/png' },
    thumb: opts.thumb === false ? undefined : { body: WEBP, mime: 'image/webp' },
    width: 1000,
    height: 1000,
  });
  // 投稿接口不收描述（描述属于审核后的编辑），所以这里补一次 updateWorkMeta ——
  // 走真实编辑路径，而不是在 INSERT 里塞一个 createSubmission 根本不会写的字段。
  const detail = opts.description !== undefined
    ? await works.updateWorkMeta(created.id, { description: opts.description })
    : attached;
  return { id: created.id, uploadToken: created.uploadToken, detail };
}

/** 待审核的投稿被拒绝 —— 审核队列里的最终态，公开路径必须看不见它。 */
export async function makeRejectedWork(
  works: WorksModule,
  opts: SeedWorkOptions = {},
): Promise<AdminWorkDetail> {
  const { id } = await makePendingWork(works, opts);
  return works.rejectWork(id);
}
