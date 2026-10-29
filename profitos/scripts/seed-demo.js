'use strict';
// 生成演示数据（仅用于试用/截图）。用法：DB_PATH=./data/demo.db node scripts/seed-demo.js [--csv 输出目录]
const fs = require('node:fs');
const path = require('node:path');
const { openDb } = require('../lib/db');
const { importRows } = require('../lib/importer');
const { hashPassword } = require('../lib/auth');

let seed = 42;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const day = (d) => d.toISOString().slice(0, 10);

const SKUS = [['LED-01', '氛围灯 USB', 18, 9], ['CUP-02', '保温杯 500ml', 32, 14], ['BAG-03', '帆布包', 25, 8], ['PHN-04', '手机支架', 12, 4], ['CAB-05', '快充数据线', 9, 2.5], ['TOY-06', '解压玩具', 7, 2]];
const orders = [], settlements = [], ads = [];
const start = new Date('2026-07-21T00:00:00Z');
let n = 0;
for (let i = 0; i < 50; i++) {
  const d = new Date(start); d.setUTCDate(d.getUTCDate() + i);
  const count = 25 + Math.floor(rnd() * 40);
  for (let k = 0; k < count; k++) {
    const id = String(576000000000000000n + BigInt(++n));
    const [sku, name, price] = pick(SKUS);
    const qty = rnd() < 0.2 ? 2 : 1;
    const amount = +(price * qty * (0.9 + rnd() * 0.2)).toFixed(2);
    orders.push({ order_id: id, sku, product_name: name, qty, amount, order_time: `${day(d)} ${String(8 + (k % 14)).padStart(2, '0')}:10:00`, currency: 'CNY', status: '已完成' });
    const settleDay = new Date(d); settleDay.setUTCDate(settleDay.getUTCDate() + 5 + Math.floor(rnd() * 3));
    if (settleDay > new Date('2026-09-09T00:00:00Z')) continue; // 最近的订单还没结算
    const refunded = rnd() < 0.15;
    const net = refunded ? 0 : +(amount * (0.8 + rnd() * 0.08)).toFixed(2);
    settlements.push({
      order_id: id, settle_date: day(settleDay), settle_amount: net,
      fee_transaction: refunded ? 0 : -+(amount * 0.02).toFixed(2), fee_commission: refunded ? 0 : -+(amount * 0.06).toFixed(2),
      fee_affiliate: refunded ? 0 : -+(amount * (rnd() < 0.5 ? 0.08 : 0)).toFixed(2), fee_logistics: refunded ? 0 : -+(3 + rnd() * 3).toFixed(2),
      refund_amount: refunded ? amount : 0,
    });
  }
  ads.push({ date: day(d), campaign: '商品广告-主推', ad_type: '商品广告', spend: +(60 + rnd() * 140).toFixed(2), impressions: 20000 + Math.floor(rnd() * 20000), clicks: 400 + Math.floor(rnd() * 400) });
}

const csvDir = process.argv.includes('--csv') ? process.argv[process.argv.indexOf('--csv') + 1] : null;
if (csvDir) {
  fs.mkdirSync(csvDir, { recursive: true });
  const w = (f, head, rows) => fs.writeFileSync(path.join(csvDir, f), '﻿' + [head.join(','), ...rows.map((r) => r.map((c) => `"${c}"`).join(','))].join('\n'));
  w('已售订单.csv', ['订单号', 'SKU', '商品名称', '购买数量', '订单金额', '下单时间', '订单状态'], orders.map((o) => [o.order_id, o.sku, o.product_name, o.qty, o.amount, o.order_time, o.status]));
  w('结算明细.csv', ['Order/adjustment ID', 'Order settled time', 'Total settlement amount', 'Transaction fee', 'TikTok Shop commission fee', 'Affiliate commission', 'Shipping fee', 'Refund'], settlements.map((s) => [s.order_id, s.settle_date, s.settle_amount, s.fee_transaction, s.fee_commission, s.fee_affiliate, s.fee_logistics, s.refund_amount]));
  w('广告消耗.csv', ['日期', '广告系列', '广告类型', '消耗', '展示', '点击'], ads.map((a) => [a.date, a.campaign, a.ad_type, a.spend, a.impressions, a.clicks]));
  w('商品成本.csv', ['SKU', '单件成本'], SKUS.slice(0, 5).map((s) => [s[0], s[3]])); // 故意缺一个
  console.log('CSV 已生成：' + csvDir);
}
if (!csvDir || process.argv.includes('--db')) {
  const db = openDb(process.env.DB_PATH || path.join(__dirname, '..', 'data', 'demo.db'));
  if (!db.prepare('SELECT COUNT(*) c FROM users').get().c) db.prepare('INSERT INTO users(email,name,role,pass_hash) VALUES(?,?,?,?)').run('demo@example.com', '演示管理员', 'admin', hashPassword('demo12345'));
  importRows(db, 'orders', orders); importRows(db, 'settlements', settlements); importRows(db, 'ads', ads);
  importRows(db, 'costs', SKUS.map((s) => ({ sku: s[0], cost: s[3] })));
  importRows(db, 'expenses', [{ date: '2026-08-10', category: '出库费', amount: 380 }, { date: '2026-08-20', category: '上架费', amount: 120 }]);
  console.log(`演示数据已写入：订单 ${orders.length}、结算 ${settlements.length}（账号 demo@example.com / demo12345）`);
}
