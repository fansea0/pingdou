import initSqlJs from 'sql.js';
import { readFileSync } from 'node:fs';
import { verifyPassword } from '/Users/Admin/code/pingdou/server/passwords.js';

const SQL = await initSqlJs({ locateFile: (f: string) => 'node_modules/sql.js/dist/' + f });
const db = new SQL.Database(new Uint8Array(readFileSync('/var/lib/pingdou/stats.db')));
const rows: any[] = [];
const st = db.prepare('SELECT id, username, role, disabled, must_change_password, password_hash FROM users ORDER BY id');
while (st.step()) rows.push(st.getAsObject());
console.log('账号总数:', rows.length);
for (const r of rows) {
  console.log(` - ${r.username} | role=${r.role} | disabled=${r.disabled} | must_change=${r.must_change_password} | 仍是默认密码: ${verifyPassword('12345678', r.password_hash)}`);
}
const cnt = db.prepare('SELECT COUNT(*) n FROM events').get();
console.log('events 行数:', cnt.n);
db.close();
