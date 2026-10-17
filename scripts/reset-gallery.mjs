#!/usr/bin/env node
/**
 * 一次性清空作品库（2026-10-17 作品来源从「后台上传」切换到「用户投稿」时用）。
 *
 * ## 会永久删除什么
 *   1. stats.db 里 works 表的全部行；
 *   2. <DATA_DIR>/media/works/ 下的全部文件（原图 + 缩略图）。
 * 其它表（users / products / events / sessions / auth_tokens / settings）一行不动。
 *
 * ## 为什么敢做（也请先读完这段再执行）
 *
 * ### ⚠️ 第一条前提：**必须先停服，再跑这个脚本**
 * 服务在跑着的时候跑本脚本，**脚本会报「完成」但结果是你最不想要的那个**：
 *   server/db.ts:293-299 的 flushNow() 用 db.export() **整库重写** stats.db，
 *   而它手里那份内存库是在本脚本开跑之前加载的、works 仍带 5 行。任何一次登录、
 *   一次 events 写入都会 markDirty()，500ms（SAVE_DEBOUNCE_MS）后就把那份**旧库**
 *   整个写回磁盘 —— 作品行复活，图片却已经被本脚本删光了：
 *
 *     works = 5 行（回来了）   media/works/ = 0 个文件（回不来）
 *
 * 而且**这种情况连备份也救不回来**：回滚 stats.db 之后，运行中的服务下一次 flush
 * 又会用它内存里那份旧库把 5 行 works 再写回去。
 * 所以：先 systemctl stop（或 whatever your supervisor is），确认进程退出，再跑本脚本。
 * 脚本里有三道兜底检查（见下面的「三道兜底」），但它们只负责**发现**，
 * 不负责替代停服。
 *
 * ### 第二条前提：备份只覆盖数据库，不覆盖图片
 * 备份**只覆盖 stats.db，不覆盖 media 下的图片**。所以「先备份再删」并不等于
 * 「可以回滚」：数据库能靠 .bak 还原，图片删了就是永久没了。本脚本只承诺前者。
 *
 * ### 把风险压住的是执行顺序
 * 落盘成功之前，一个字节的图片都不会被删：
 *
 *   备份 stats.db → 开库/统计/DELETE（全部只在内存里）→ db.export()
 *   → 兜底 1a：**写回之前**确认 stats.db 还是「我读进来的那一份」
 *   → 落盘（先写临时文件再 rename）→ **重新打开落盘的库，确认 works 确实是 0 行**
 *   → 兜底 1b：删文件前再确认一次 → 才删 media/works/ 下的文件
 *   → 兜底 2a：删完立刻复核 works 行数 → 等 600ms（> SAVE_DEBOUNCE_MS）
 *     → 兜底 2b：再复核一次 → 全部通过才打印「完成」
 *
 * 注意兜底 1a 在**落盘之前**：它问的是「我读进来之后有没有人动过这个库」，
 * 真被动过还往下走的话，这次 rename 会把对方的写入悄悄吃掉。
 *
 * 任何一步抛错，脚本都在「库还是满的、图片还在」的原始状态退出（除落盘那一步
 * 之后：那时库里已经空了，但图片全都还在，只是多了几个没人引用的孤儿文件 ——
 * 孤儿文件不构成不一致，重新跑一次本脚本即可清掉）。
 * 反过来「文件没了但库还在」这种更糟的状态，本脚本的顺序保证不会产生 ——
 * **前提是服务已停**（见上面第一条前提：服务在跑时它自己就能造出这个状态）。
 *
 * ### 三道兜底（防的是「忘记停服」，不是防一切并发）
 *   1a. 写回之前：比对 stats.db 与「我读进来的那一份」是否还是同一个。变了就说明
 *       读完之后有人写过，不中止的话这次 rename 会把对方的写入悄悄吃掉。
 *   1b. 删文件**之前**重新 stat stats.db，比对 inode / size / mtime 与脚本自己刚
 *       写下的那份是否一致；不一致 = 有别的进程在写库 → 中止并提示先停服。
 *       放在删文件之前是因为那时还来得及：文件一张都没删。
 *   2. 删完文件后再复核 works 行数，分两次：2a 删完立刻查（抓「删文件过程中撞上
 *      写库」）；2b 等 600ms（> server/db.ts 的 SAVE_DEBOUNCE_MS=500）之后再查一次
 *      —— 因为脚本端到端只有 ~190ms，必然赶在服务的防抖窗口关闭**之前**就退出，
 *      服务那份 flush 落在脚本退出之后，2a 看不见。不为 0 就大声告警、退出码非 0，
 *      而且**在打印「完成」之前**。这时图片已经没了，它只能告诉你出了事。
 *   这三道都只是启发式检查（同一毫秒内、同样大小的写入理论上能骗过去），
 *   它们的价值是覆盖「运维压根没想起来停服」这个最常见的人为失误。
 *
 * ## 用法
 *   systemctl stop <服务名>          # ← 先停服，见上面的「第一条前提」
 *   node scripts/reset-gallery.mjs
 *   PINGDOU_DATA_DIR=/var/lib/pingdou node scripts/reset-gallery.mjs
 *   systemctl start <服务名>
 *
 * 正常跑完会比「纯删除」多花约 0.6 秒（兜底 2b 要等一个防抖窗口）。
 * 这是有意付的代价：省这 0.6 秒换来的就是服务没停时那份静悄悄的坏图库。
 *
 * ## 路径怎么来的（怕删错库，所以逐条说明）
 *   PINGDOU_DATA_DIR 未设置时默认 /var/lib/pingdou，stats.db 与 media/works/ 都从
 *   它派生 —— 这三条与 server/paths.ts:6,17 和 server/index.ts:699 完全一致，
 *   所以脚本操作的就是服务进程自己在用的那份数据和那个目录，不会打偏。
 *   （注：README.md 里 "生产环境位于 /var/lib/pingdou/db/stats.db" 的说法与代码不符，
 *     以 paths.ts 为准：stats.db 直接落在数据根目录，不在 db/ 子目录下。）
 *   PINGDOU_DATA_DIR 写错时，脚本第一步就会因为找不到 stats.db 而中止，
 *   不会对任何别的目录动手。
 *
 * ## 依赖
 * 只用已在 dependencies 里的 sql.js，不新增任何包 —— 这是一次性运维脚本，
 * 不值得为它往生产依赖里塞东西。
 *
 * 退出码：0 = 全部做完；1 = 中止或部分失败（失败信息里会写清当前到底处于什么状态）。
 */

import {
  copyFileSync, existsSync, readdirSync, readFileSync,
  renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { dirname, join, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';

// sql.js 的 wasm 从**脚本自身位置**找，不用 process.cwd()。
// server/db.ts 用 cwd 是因为它只由 npm scripts 启动（cwd 必然是仓库根）；
// 而运维敲的是 `node scripts/reset-gallery.mjs`，cwd 可能是 /、可能是 ~，
// 那时 cwd 版本的 locateFile 会解析到 /node_modules/sql.js/dist 然后报 ENOENT。
// 相对脚本自身定位跟 scripts/gen-qr.mjs 的做法一致：与「从哪儿敲」无关。
const SQLJS_DIST = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', 'sql.js', 'dist');

const DATA_DIR = resolve(process.env.PINGDOU_DATA_DIR?.trim() || '/var/lib/pingdou');
const DB_PATH = join(DATA_DIR, 'stats.db');
const WORKS_DIR = join(DATA_DIR, 'media', 'works');

function fail(msg) {
  console.error(`[reset-gallery] 中止：${msg}`);
  process.exit(1);
}

/** 查 COUNT，兼容 db.exec 返回空结果集的情况 */
function countRows(db, table) {
  const res = db.exec(`SELECT COUNT(*) FROM ${table}`);
  const n = res?.[0]?.values?.[0]?.[0];
  return typeof n === 'number' ? n : NaN;
}

/**
 * stats.db 的「身份」。用来发现「脚本跑着的时候有别的进程在写这个库」——
 * 也就是服务没停就开跑这个场景（见文件头）。
 *
 * 为什么这三个字段够用：服务里的 flushNow() 用的是 writeFileSync **原地**覆盖，
 * inode 不变，但 mtime 和 size 一定会变。反过来本脚本自己写库走的是 rename，
 * 会换掉 inode —— 所以「inode 变了」同样说明有人动过。
 * 注意这是启发式检查，不是锁：同一毫秒内、恰好同样大小的写入理论上能混过去。
 */
function dbIdentity() {
  const s = statSync(DB_PATH);
  return `${s.ino}:${s.size}:${s.mtimeMs}`;
}

function sameDb(a, b) {
  return a === b;
}

// 0. 开跑前的护栏
if (DATA_DIR === parse(DATA_DIR).root) {
  fail(`PINGDOU_DATA_DIR 解析成了文件系统根目录 ${DATA_DIR}，拒绝在根目录上执行删除`);
}
if (!existsSync(DB_PATH)) {
  fail(`找不到 ${DB_PATH}，确认 PINGDOU_DATA_DIR 是否正确（未设置时默认 /var/lib/pingdou）。没有任何东西被删除`);
}

// 1. 先备份 —— 任何删除动作之前必须成功生成非空备份，否则直接退出
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = `${DB_PATH}.bak-${stamp}`;
let backupSize = 0;
try {
  copyFileSync(DB_PATH, backupPath);
  backupSize = statSync(backupPath).size;
  if (backupSize === 0) fail(`备份文件是空的：${backupPath}`);
  console.log(`[reset-gallery] 已备份 ${DB_PATH} → ${backupPath}（${backupSize} 字节）`);
  console.log('[reset-gallery] 注意：备份只含数据库，不含 media/works 下的图片');
} catch (err) {
  fail(`备份失败，已中止，没有任何东西被删除：${err.message}`);
}

// 2. 开库 + 统计 + 清空 —— 到这里为止全部只发生在内存里，磁盘上的库一个字节没动
const SQL = await initSqlJs({ locateFile: (file) => resolve(SQLJS_DIST, file) });

// 记住「我读的是哪一份 stats.db」，后面每一步动手前都要跟磁盘上的比一次。
const identityAtRead = dbIdentity();

let db;
try {
  db = new SQL.Database(new Uint8Array(readFileSync(DB_PATH)));
} catch (err) {
  fail(`无法打开 ${DB_PATH}，文件可能不是有效的 SQLite 库或已损坏：${err.message}`);
}

let rows;
try {
  rows = countRows(db, 'works');
  if (Number.isNaN(rows)) throw new Error('COUNT 查询没有返回行');
} catch (err) {
  fail(`读 works 表失败（表不存在？库里可能还没有作品库功能，无需清理）：${err.message}`);
}

try {
  db.exec('DELETE FROM works');
  // 防御性空操作，**留着的理由和它为什么无害**：
  // work_likes 表早在「点赞模型迁移」（server/db.ts:175-186 的 migrateWorkLikesToCountColumn）
  // 里就被 DROP 了，赞数已改成 works.likes 计数列（server/db.ts:122）。也就是说任何
  // 跑过当前版本 initDb 的库都根本没有这张表，这行对它们是 0 影响的 no-op。
  // 留着只为兜住「从没启动过新版服务的老库」——那种库里 work_likes 可能还在，
  // 而它和已清空的 works 是一对，留在库里只会让后人查 db.ts 时困惑。
  // 反过来说：它绝不是为了恢复赞数，历史赞数在那次迁移时就已并进 works.likes，
  // 而那些 works 行此刻正被本脚本删掉（备份 .bak 里还有）。
  db.exec('DROP TABLE IF EXISTS work_likes');
} catch (err) {
  fail(`清空 works 表失败（仍在内存中，磁盘上的库未改动）：${err.message}`);
}
console.log(`[reset-gallery] 已在内存中删除 works 表 ${rows} 行`);
if (rows === 0) {
  // 重跑场景：这时刚生成的那份 .bak 是「空库」的副本，尺寸和真库可能一模一样，
  // 回滚时很容易挑错。必须把这件事说出来，否则「挑错备份」就从一个失误变成一次数据丢失。
  console.warn(
    `[reset-gallery] 注意：执行前 works 表本来就是空的，所以 ${backupPath} **不含任何作品数据**。` +
    '要回到有作品的版本，请用更早那一份 .bak，别用这份。',
  );
}

// 3. 落盘 —— 先写临时文件再 rename，保证 stats.db 要么是旧的全量库、要么是新的空库，
//    不会出现「写了一半的坏库」。这一步之前图片一个都没删。
const exported = (() => {
  try {
    return Buffer.from(db.export());
  } catch (err) {
    fail(`导出数据库失败，已中止，图片全部保留、stats.db 未改动：${err.message}`);
  }
})();

const tmpDbPath = `${DB_PATH}.reset-tmp-${stamp}`;
// 兜底 1a：在把内存库写回去之前先确认没人动过 stats.db。
// 真的有人动过的话，下面这次 rename 会把对方的写入直接覆盖掉 —— 那就是「悄悄吃掉
// 别人刚写的数据」，比报错糟糕得多，所以宁可停下来。
if (!sameDb(identityAtRead, dbIdentity())) {
  fail(
    'stats.db 在脚本运行期间被改写过，疑似有服务进程还在运行（它的 flushNow 会整库覆盖）。' +
      '请先停服再跑。图片一张都没删，stats.db 是对方刚写下的那份，未被本脚本改动。',
  );
}
try {
  writeFileSync(tmpDbPath, exported);
  renameSync(tmpDbPath, DB_PATH); // 同一目录内 rename 是原子的
} catch (err) {
  try { rmSync(tmpDbPath, { force: true }); } catch { /* 临时文件残留不影响原始库 */ }
  fail(`写回 stats.db 失败，已中止，图片全部保留、stats.db 未改动：${err.message}`);
}

// 本脚本自己刚写下的这一份的「身份」，留给下面的兜底 1b 比对。
const identityAfterWrite = dbIdentity();

// 4. 重新打开落盘的库确认 —— 只有这里验证通过，才允许开始删图片。
//    这一步是「先删库还是先删文件」顺序能成立的全部依据：它把「写回成功」
//    从一个假设变成了一个观察到的结果。
try {
  const verify = new SQL.Database(new Uint8Array(readFileSync(DB_PATH)));
  const after = countRows(verify, 'works');
  verify.close();
  if (after !== 0) fail(`落盘后 works 表仍有 ${after} 行，判定写回未生效，已中止，图片全部保留`);
  console.log(`[reset-gallery] 已落盘并复核：stats.db 中 works 表 0 行（${statSync(DB_PATH).size} 字节）`);
} catch (err) {
  // 这条消息要说清当前到底处于什么状态：写回这一步已经成功了，所以**库已经是空的**，
  // 只是没能复核成功。只说「图片全部保留」的话，运维会以为库根本没动过，
  // 进而以为「什么都没发生、可以放心重跑」——而实际状态是「库空了、图还在」。
  fail(
    `复核落盘结果失败，已中止：stats.db 此刻已是空库（works=0），图片全部保留。` +
      `方向是安全的（不会有坏图），但请确认库能正常打开再决定是否重跑：${err.message}`,
  );
}

db.close();

// 兜底 1b：删文件是本脚本唯一不可逆的一步，所以动手之前再确认一次 stats.db
// 还是「我刚写下的那一份」。变了 = 有服务进程正在用它内存里的旧库覆盖磁盘
// （flushNow 每 500ms 就可能来一次）——那种情况下继续删文件，就是在生产
// 「works 行还在、图没了」这个我们花了一整节顺序去避免的状态。
if (!sameDb(identityAfterWrite, dbIdentity())) {
  fail(
    'stats.db 在删文件之前被别的进程改写过，几乎可以肯定是服务还在跑。' +
      '**图片一张都没有删除**，但 stats.db 已经不是本脚本清空后的那份了，' +
      '请立刻停服后重新检查库和 media/works 的实际状态再决定下一步。',
  );
}

// 5. 库已确认为空，现在才删文件。此时即使中途失败，最坏结果也只是留下几个
//    没有库记录引用的孤儿文件，站点不会对外暴露坏图。
let files = 0;
let bytes = 0;
const failed = [];
if (existsSync(WORKS_DIR)) {
  // readdirSync 本身也可能失败（目录权限不对、竞态删除），不能让它裸崩 ——
  // 崩了的话运维只看到一坨 stack trace，看不出「库已经清空了、图片还在」这个关键状态。
  let names;
  try {
    names = readdirSync(WORKS_DIR);
  } catch (err) {
    names = null;
    failed.push(`整个目录都读不了，无法删除：${WORKS_DIR}（${err.message}）`);
  }
  for (const name of names ?? []) {
    const p = join(WORKS_DIR, name);
    try {
      bytes += statSync(p).size;
      // recursive 只作用于 media/works/ 的直接子项；symlink 删的是链接本身而非目标，
      // 所以即使目录里混进了指向别处的链接也伤不到 DATA_DIR 之外。
      rmSync(p, { force: true, recursive: true });
      files++;
    } catch (err) {
      failed.push(`${name}（${err.message}）`);
    }
  }
} else {
  console.log(`[reset-gallery] ${WORKS_DIR} 不存在，跳过文件清理`);
}

console.log(`[reset-gallery] 已删除 ${files} 个文件，释放 ${(bytes / 1024 / 1024).toFixed(1)} MB`);

// 兜底 2：删完文件之后再复核 works 行数，分两次查。
//
// 2a（删完立刻查）抓的是「服务恰好在我们删文件的这几十毫秒里 flush 了一次」。
// 这一步已经救不回任何东西（文件删了就是删了），它的价值是把事故喊出来。
//
// 2b（再等一个防抖窗口后查）才是真正兜住常见误用的那一步。
// 复审量出来的数：脚本端到端只有 189ms（3 个文件）/ 423ms（4000 个文件），
// 而 server/db.ts:14 的 SAVE_DEBOUNCE_MS = 500 —— 也就是说在小库场景下，
// 脚本**必然在防抖窗口关闭之前就退出了**，8/8 次都是 exit 0 + 打印「完成」，
// 而服务那份 flush 落在脚本退出**之后**，2a 根本来不及看见。
// 服务最典型的时序恰恰就是「脚本刚跑完就 flush」，所以这里多等一个防抖窗口，
// 把「脚本退出前唯一还能观察到的最后机会」用掉。
//
// ⚠️ 这**不是**根治：它只是把风险窗口从「脚本退出前」推迟到「脚本退出那一刻」。
//   服务持续 flush 时，脚本退出之后数据照样会复活。所以必须停服这一条没有变，
//   兜底只是把最常见的结局从「静悄悄的坏图」变成「响亮的坏图」。
let resurrectWarn = '';

/** 从磁盘上重新打开 stats.db 数 works 行数 */
function diskWorksCount() {
  const conn = new SQL.Database(new Uint8Array(readFileSync(DB_PATH)));
  const n = countRows(conn, 'works');
  conn.close();
  return n;
}

function warnAboutResurrection(n, which) {
  return (
    `[reset-gallery] 严重警告（${which}）：works 表又有 ${n} 行，说明有服务进程在运行，` +
    '并且用它内存里的旧库把数据写了回来。**现在站点处于「有作品行、图片却不存在」的状态**。' +
    '请立刻停服，然后从备份恢复数据库（注意：必须在停服之后恢复，否则运行中的服务' +
    '会用它内存里的旧库把旧数据再盖回去）。备份路径见上方输出。'
  );
}

try {
  const n = diskWorksCount();
  if (n !== 0) resurrectWarn = warnAboutResurrection(n, '兜底 2a');
} catch (err) {
  resurrectWarn =
    `[reset-gallery] 严重警告：删完文件后连 stats.db 都读不开了（${err.message}）。` +
    '图片已经删除，无法恢复；请立刻停服并从备份恢复数据库。';
}

if (!resurrectWarn) {
  // 等一个 SAVE_DEBOUNCE_MS(500ms) 之上：服务那边 markDirty 之后 500ms 就会 flush，
  // 所以 600ms 才够覆盖一次完整的防抖窗口。
  await new Promise((r) => setTimeout(r, 600));
  try {
    const n = diskWorksCount();
    if (n !== 0) resurrectWarn = warnAboutResurrection(n, '兜底 2b');
  } catch (err) {
    resurrectWarn =
      `[reset-gallery] 严重警告：等待防抖窗口后 stats.db 读不开了（${err.message}）。` +
      '请立刻停服并从备份恢复数据库。';
  }
}

if (failed.length > 0) {
  // 如实报告，不粉饰：库已经清空（这步不可逆，只有 .bak 能还原），但有文件没删掉。
  // 这些是没人引用的孤儿文件，重新跑一次本脚本即可补删。
  console.error(`[reset-gallery] 部分失败：${failed.length} 项没删干净 ——`);
  for (const f of failed) console.error(`[reset-gallery]   - ${f}`);
  console.error('[reset-gallery] 库已清空（备份在 ' + backupPath + '），图片只是没删干净；修好权限后重跑本脚本即可。');
  if (resurrectWarn) console.error(resurrectWarn);
  process.exit(1);
}

if (resurrectWarn) {
  console.error(resurrectWarn);
  process.exit(1);
}

console.log(`[reset-gallery] 完成。数据库需要回滚时用 ${backupPath}；图片不可回滚，删了就是删了。`);
