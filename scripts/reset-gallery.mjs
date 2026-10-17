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
 * 备份**只覆盖 stats.db，不覆盖 media 下的图片**。所以「先备份再删」并不等于
 * 「可以回滚」：数据库能靠 .bak 还原，图片删了就是永久没了。本脚本只承诺前者。
 *
 * 真正把风险压住的是**执行顺序**——落盘成功之前，一个字节的图片都不会被删：
 *
 *   备份 stats.db → 开库/统计/DELETE（全部只在内存里）→ db.export() → 落盘
 *   （先写临时文件再 rename）→ **重新打开落盘的库，确认 works 确实是 0 行**
 *   → 才删 media/works/ 下的文件
 *
 * 任何一步抛错，脚本都在「库还是满的、图片还在」的原始状态退出（除落盘那一步
 * 之后：那时库里已经空了，但图片全都还在，只是多了几个没人引用的孤儿文件 ——
 * 孤儿文件不构成不一致，重新跑一次本脚本即可清掉）。
 * 反过来「文件没了但库还在」这种更糟的状态，本脚本的顺序保证不会产生。
 *
 * ## 用法
 *   node scripts/reset-gallery.mjs
 *   PINGDOU_DATA_DIR=/var/lib/pingdou node scripts/reset-gallery.mjs
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
try {
  writeFileSync(tmpDbPath, exported);
  renameSync(tmpDbPath, DB_PATH); // 同一目录内 rename 是原子的
} catch (err) {
  try { rmSync(tmpDbPath, { force: true }); } catch { /* 临时文件残留不影响原始库 */ }
  fail(`写回 stats.db 失败，已中止，图片全部保留、stats.db 未改动：${err.message}`);
}

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
  fail(`复核落盘结果失败，已中止，图片全部保留：${err.message}`);
}

db.close();

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

if (failed.length > 0) {
  // 如实报告，不粉饰：库已经清空（这步不可逆，只有 .bak 能还原），但有文件没删掉。
  // 这些是没人引用的孤儿文件，重新跑一次本脚本即可补删。
  console.error(`[reset-gallery] 部分失败：${failed.length} 项没删干净 ——`);
  for (const f of failed) console.error(`[reset-gallery]   - ${f}`);
  console.error('[reset-gallery] 库已清空（备份在 ' + backupPath + '），图片只是没删干净；修好权限后重跑本脚本即可。');
  process.exit(1);
}

console.log(`[reset-gallery] 完成。数据库需要回滚时用 ${backupPath}；图片不可回滚，删了就是删了。`);
