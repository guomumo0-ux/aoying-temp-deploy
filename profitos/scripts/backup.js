'use strict';
// 在线备份 SQLite：DB_PATH=/data/profitos.db node scripts/backup.js /backups/profitos-$(date +%F).db
const { DatabaseSync, backup } = require('node:sqlite');
const src = process.env.DB_PATH || require('node:path').join(__dirname, '..', 'data', 'profitos.db');
const dest = process.argv[2];
if (!dest) { console.error('用法：node scripts/backup.js <目标文件>'); process.exit(1); }
const db = new DatabaseSync(src);
backup(db, dest).then(() => { console.log('已备份到 ' + dest); db.close(); });
