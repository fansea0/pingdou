/**
 * 离线重置后台账号密码。
 *
 * 为什么需要这个脚本：密码只以 scrypt 哈希存在 users.password_hash，忘记后没有任何
 * 途径「找回」，只能重置。后台的重置接口本身需要登录，所以卡死时只剩这一条路。
 *
 * 用法：
 *   # 密码从环境变量传，绝不进 argv（argv 会进 shell history 和 ps 输出）
 *   NEWPASS='新密码' npx tsx scripts/reset-admin-password.ts --user root
 *
 *   # 或从 stdin 读（适合 ssh 上手动输入）
 *   npx tsx scripts/reset-admin-password.ts --user root --stdin
 *
 * 选项：
 *   --db <path>              默认 /var/lib/pingdou/stats.db（或 $PINGDOU_DATA_DIR）
 *   --user <username>        默认 root
 *   --keep-must-change       不强制登录后改密（默认强制）
 *   --force                  后端正在监听端口时也允许执行（默认拒绝）
 *
 * 重要：必须先停掉后端。sql.js 是把整个库读进内存、变更时整体回写，
 * 运行中的后端下一次 flush 会把这个脚本的修改整个覆盖掉。
 */

import { createConnection } from 'node:net';
import { copyFileSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  return process.argv[i + 1];
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const dbPath = resolve(arg('db') ?? `${process.env.PINGDOU_DATA_DIR ?? '/var/lib/pingdou'}/stats.db`);
const username = arg('user', 'root')!;
const keepMustChange = flag('keep-must-change');
const force = flag('force');

const PORT = Number(process.env.PORT ?? 3000);

/** 探一下后端是不是还活着——活着就写会被覆盖 */
function isPortOpen(port: number, timeoutMs = 800): Promise<boolean> {
  return new Promise(resolve_ => {
    const sock = createConnection({ host: '127.0.0.1', port });
    const done = (v: boolean) => { sock.destroy(); resolve_(v); };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
  });
}

async function readPassword(): Promise<string> {
  if (flag('stdin')) {
    process.stdout.write('新密码（输入不回显，用 stty -echo 包裹更安全）: ');
    const chunks: Buffer[] = [];
    for await (const c of process.stdin) chunks.push(Buffer.from(c));
    const v = Buffer.concat(chunks).toString('utf8').split('\n')[0].trim();
    process.stdout.write('\n');
    if (!v) throw new Error('stdin 里没读到密码');
    return v;
  }
  const v = process.env.NEWPASS ?? '';
  if (!v) throw new Error('请用 NEWPASS=xxx 环境变量传密码，或加 --stdin');
  return v;
}

async function main(): Promise<void> {
  if (!existsSync(dbPath)) {
    throw new Error(`找不到数据库：${dbPath}`);
  }
  if (!force && await isPortOpen(PORT)) {
    throw new Error(
      `端口 ${PORT} 上还有后端在跑。\n` +
      `  sql.js 整体回写，运行中的进程会把这次的修改覆盖掉。\n` +
      `  先停掉它（本地：Ctrl-C 掉 npm run dev:full；线上：systemctl stop pingdou-backend），\n` +
      `  确认要硬来就加 --force。`,
    );
  }

  const newPassword = await readPassword();
  if (newPassword.length < 4) throw new Error('密码至少 4 位');

  // 备份：脚本要直接回写整个文件，出错时这是唯一的退路
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = `${dbPath}.bak-${stamp}`;
  copyFileSync(dbPath, backup);
  console.log(`[reset] 已备份 → ${backup}`);

  process.env.PINGDOU_DATA_DIR = dbPath.slice(0, dbPath.lastIndexOf('/'));
  const db = await import('../server/db.js');
  await db.initDb();
  const users = await import('../server/users.js');
  const auth = await import('../server/auth.js');

  const target = users.getUserByUsername(username);
  if (!target) {
    const all = db.queryAll<{ username: string }>(`SELECT username FROM users ORDER BY id`);
    console.error(`[reset] 没有账号「${username}」。库里的账号：${all.map(r => r.username).join(', ')}`);
    process.exit(1);
  }
  if (target.disabled) console.warn(`[reset] 注意：账号 ${username} 当前是 disabled 状态，重置密码后仍需手动启用`);

  users.setUserPassword(target.id, newPassword);
  if (!keepMustChange) users.setUserMustChangePassword(target.id, true);
  // 密码被重置意味着旧登录态必须失效，否则泄露的 token 还能继续用
  auth.clearSessionForUser(target.id);
  db.flushNow();

  // 回读校验：确认真的写进去了，而不是「以为写成功了」
  const check = users.checkUserPassword(target.id, newPassword);
  console.log(`[reset] ${username} 密码已重置`);
  console.log(`[reset] 写入校验: ${check ? 'OK' : '失败！'}`);
  console.log(`[reset] 登录后${keepMustChange ? '无需' : '会要求你'}改密`);
  console.log(`[reset] 该账号的登录态已全部失效`);
  db.flushNow();
}

main().catch(e => {
  console.error(`[reset] 失败：${(e as Error).message}`);
  process.exit(1);
});
