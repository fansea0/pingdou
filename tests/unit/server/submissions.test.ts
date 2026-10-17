import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmp = '';

/** 每个用例都重新求值 server/works.js —— 配额是模块级状态，靠 resetModules 清干净。
 *  （与 works-likes.test.ts 对进程内去重 Set 的处理方式一致） */
async function freshWorks(): Promise<typeof import('../../../server/works.js')> {
  tmp = mkdtempSync(join(tmpdir(), 'sub-quota-'));
  process.env.PINGDOU_DATA_DIR = tmp;
  vi.resetModules();
  const db = await import('../../../server/db.js');
  await db.initDb();
  return import('../../../server/works.js');
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
    const works = await freshWorks();
    expect(works.SUBMISSION_DAILY_LIMIT).toBe(3);
    expect(works.allowSubmission('1.2.3.4', 'UA')).toBe(true);
    expect(works.allowSubmission('1.2.3.4', 'UA')).toBe(true);
    expect(works.allowSubmission('1.2.3.4', 'UA')).toBe(true);
    expect(works.allowSubmission('1.2.3.4', 'UA')).toBe(false);
  });

  it('换 UA 算另一个人（沿用点赞已拍板的取向）', async () => {
    const works = await freshWorks();
    for (let i = 0; i < 3; i++) works.allowSubmission('1.2.3.4', 'UA-A');
    expect(works.allowSubmission('1.2.3.4', 'UA-A')).toBe(false);
    expect(works.allowSubmission('1.2.3.4', 'UA-B')).toBe(true);
  });

  it('换 IP 算另一个人', async () => {
    const works = await freshWorks();
    for (let i = 0; i < 3; i++) works.allowSubmission('1.2.3.4', 'UA');
    expect(works.allowSubmission('5.6.7.8', 'UA')).toBe(true);
  });

  it('跨天自动重置（配额按 UTC 日历日，与 events/sessions 同一口径）', async () => {
    const works = await freshWorks();
    const day1 = Date.parse('2026-10-17T10:00:00Z');
    for (let i = 0; i < 3; i++) works.allowSubmission('1.2.3.4', 'UA', day1);
    expect(works.allowSubmission('1.2.3.4', 'UA', day1)).toBe(false);
    // 东八区凌晨 1 点仍是 UTC 前一天，所以要跨足一整个 UTC 日
    const day2 = day1 + 24 * 60 * 60 * 1000;
    expect(works.allowSubmission('1.2.3.4', 'UA', day2)).toBe(true);
  });

  it('remainingSubmissions 反映还能再投几件', async () => {
    const works = await freshWorks();
    expect(works.remainingSubmissions('1.2.3.4', 'UA')).toBe(3);
    works.allowSubmission('1.2.3.4', 'UA');
    expect(works.remainingSubmissions('1.2.3.4', 'UA')).toBe(2);
  });

  it('指纹含 UA 与日期：同 IP 换 UA、同指纹跨天都不同', async () => {
    const works = await freshWorks();
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
    const works = await freshWorks();
    const t = Date.parse('2026-10-17T10:00:00Z');
    expect(works.submissionFingerprint('ab', 'c', t))
      .not.toBe(works.submissionFingerprint('a', 'bc', t));
  });

  it('指纹是 16 位 hex（与 likeFingerprint 同规格）', async () => {
    const works = await freshWorks();
    expect(works.submissionFingerprint('1.2.3.4', 'UA')).toMatch(/^[0-9a-f]{16}$/);
  });

  it('指纹异常膨胀时整份丢弃（fail-open），而不是拒绝新投稿', async () => {
    const works = await freshWorks();
    // 伪造 20_000+ 个不同 UA，把 Map 撑过上限
    for (let i = 0; i < works.SUBMISSION_QUOTA_MAX + 10; i++) {
      works.allowSubmission(`10.0.${Math.floor(i / 256)}.${i % 256}`, `UA-${i}`);
    }
    // 触顶后新投稿仍然放行 —— 一次异常流量不该把当天全站投稿入口变成不可用
    expect(works.allowSubmission('203.0.113.9', 'UA-fresh')).toBe(true);
  });
});
