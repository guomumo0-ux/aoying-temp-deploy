'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb, getSettings } = require('../lib/db');
const { importRows } = require('../lib/importer');
const P = require('../lib/profit');
const Mapping = require('../shared/mapping');
const { parseNumber, parseDateTime } = require('../lib/normalize');

function load(db) {
  return P.buildModel({
    settings: getSettings(db),
    orders: db.prepare('SELECT * FROM orders').all(),
    settlements: db.prepare('SELECT * FROM settlements').all(),
    costs: db.prepare('SELECT * FROM costs').all(),
    ads: db.prepare('SELECT * FROM ads').all(),
    expenses: db.prepare('SELECT * FROM expenses').all(),
  });
}

function fixture() {
  const db = openDb(':memory:');
  importRows(db, 'orders', [
    { order_id: 'A1', sku: 'S1', qty: 2, amount: 100, order_time: '2026-07-01 10:00:00' },
    { order_id: 'A2', sku: 'S1', qty: 1, amount: 50, order_time: '2026-07-01 11:00:00' },
    { order_id: 'A3', sku: 'S2', qty: 1, amount: 80, order_time: '2026-07-02 09:00:00' }, // 秒拍秒退，结算 0
    { order_id: 'A4', sku: 'S1', qty: 1, amount: 50, order_time: '2026-07-03 09:00:00' }, // 未结算
    { order_id: 'A5', sku: 'S1', qty: 1, amount: 50, order_time: '2026-07-03 09:00:00', status: '已取消' },
    { order_id: 'A6', sku: 'S1', qty: 1, amount: 60, order_time: '2026-07-01 12:00:00' }, // 多 SKU 订单
    { order_id: 'A6', sku: 'S3', qty: 1, amount: 40, order_time: '2026-07-01 12:00:00' },
  ]);
  importRows(db, 'settlements', [
    { order_id: 'A1', settle_date: '2026-07-05', settle_amount: 90, fee_commission: -10 },
    { order_id: 'A2', settle_date: '2026-07-05', settle_amount: 45, fee_commission: -5 },
    { order_id: 'A3', settle_date: '2026-07-05', settle_amount: 0 },
    { order_id: 'A6', settle_date: '2026-07-06', settle_amount: 90 },
    { order_id: 'X9', settle_date: '2026-07-06', settle_amount: 30 }, // 没有对应已售订单
  ]);
  importRows(db, 'costs', [{ sku: 'S1', cost: 20 }, { sku: 'S2', cost: 30 }]); // S3 无成本
  importRows(db, 'ads', [
    { date: '2026-07-05', spend: 25, campaign: 'c1' },
    { date: '2026-07-06', spend: 5, campaign: 'c1', ad_type: 'GMV Max' },
  ]);
  importRows(db, 'expenses', [{ date: '2026-07-05', category: '出库费', amount: 8 }]);
  return db;
}

test('按订单号匹配结算；商品成本 = SKU × 数量 × 成本；广告与额外费用全额扣除', () => {
  const m = load(fixture());
  const s = P.summary(m, '2026-07-01', '2026-07-10');
  assert.equal(s.totals.revenue, 90 + 45 + 0 + 90 + 30);
  // A1: 2×20  A2: 1×20  A3 结算为0不计成本  A6: S1 20 + S3 无成本=0
  assert.equal(s.totals.cost, 40 + 20 + 20);
  assert.equal(s.totals.ads, 30);
  assert.equal(s.totals.expenses, 8);
  assert.equal(s.totals.net, 255 - 80 - 30 - 8);
  assert.equal(s.totals.orders, 5);
  assert.equal(s.totals.refundOrders, 1);
  assert.equal(s.totals.zeroOrders, 1);
  assert.equal(s.totals.units, 2 + 1 + 2); // A1 2件 A2 1件 A6 2件，A3 不算
});

test('秒拍秒退订单结算为0，但广告消耗仍然扣除', () => {
  const m = load(fixture());
  const a = P.adsReport(m, '2026-07-01', '2026-07-10');
  assert.equal(a.totals.zeroOrders, 1);
  assert.equal(P.summary(m, '2026-07-05', '2026-07-05').totals.ads, 25);
});

test('未结算订单单独预估，不计入净利润，取消单排除', () => {
  const m = load(fixture());
  const s = P.summary(m, '2026-07-01', '2026-07-10');
  assert.equal(s.unsettled.orders, 1); // 只有 A4
  assert.equal(s.unsettled.orderAmount, 50);
  assert.equal(s.unsettled.estCost, 20);
  assert.ok(s.unsettled.estRevenue > 0 && s.unsettled.estRevenue <= 50);
  const list = P.orderList(m, '2026-07-01', '2026-07-10', { state: 'unsettled' });
  assert.deepEqual(list.rows.map((r) => r.order_id), ['A4']);
});

test('缺成本的 SKU 和未匹配的结算会在数据核对里提示', () => {
  const m = load(fixture());
  const c = P.check(m, '2026-07-01', '2026-07-10');
  assert.equal(c.counts.unmatched, 1);
  assert.equal(c.counts.missingCostSkus, 1);
  assert.ok(c.items.some((i) => i.level === 'error' && /SKU/.test(i.title)));
});

test('商品利润按订单行金额分摊结算收入', () => {
  const m = load(fixture());
  const rows = P.products(m, '2026-07-01', '2026-07-10');
  const s1 = rows.find((r) => r.sku === 'S1');
  // A1 90 + A2 45 + A6 的 90×60%
  assert.equal(s1.revenue, 90 + 45 + 54);
  assert.equal(s1.units, 4);
  const s3 = rows.find((r) => r.sku === 'S3');
  assert.equal(s3.missingCost, true);
});

test('SKU 成本优先于商品名成本；外币按汇率折算', () => {
  const db = openDb(':memory:');
  importRows(db, 'orders', [{ order_id: 'B1', sku: 'K1', product_name: 'Cup', qty: 1, amount: 10, order_time: '2026-08-01' }]);
  importRows(db, 'settlements', [{ order_id: 'B1', settle_date: '2026-08-02', settle_amount: 10 }], { defaultCurrency: 'USD' });
  importRows(db, 'costs', [{ product_name: 'Cup', cost: 5 }, { sku: 'K1', cost: 12 }]);
  const s = P.summary(load(db), '2026-08-01', '2026-08-31');
  assert.equal(s.totals.revenue, 72);
  assert.equal(s.totals.cost, 12);
});

test('同一文件中同订单的多行结算会合并，重复导入是覆盖而不是叠加', () => {
  const db = openDb(':memory:');
  const rows = [
    { order_id: 'C1', settle_date: '2026-08-02', settle_amount: 100, fee_commission: 10 },
    { order_id: 'C1', settle_date: '2026-08-03', settle_amount: -20 },
  ];
  importRows(db, 'settlements', rows);
  importRows(db, 'settlements', rows);
  const r = db.prepare('SELECT * FROM settlements').all();
  assert.equal(r.length, 1);
  assert.equal(r[0].settle_amount, 80);
});

test('广告成本可剔除 GMV Max（避免与结算重复）', () => {
  const db = fixture();
  db.prepare("INSERT INTO settings(key,value) VALUES('exclude_gmvmax_ads','true')").run();
  const s = P.summary(load(db), '2026-07-01', '2026-07-10');
  assert.equal(s.totals.ads, 25);
});

test('列映射：中英文表头自动识别、费用多列求和', () => {
  const headers = ['Order/adjustment ID', 'Order settled time', 'Total settlement amount', 'Transaction fee', 'TikTok Shop commission fee', 'Affiliate commission', 'Shipping fee', 'Return shipping'];
  assert.equal(Mapping.detectType(headers), 'settlements');
  const map = Mapping.autoMap(headers, 'settlements');
  assert.deepEqual(map.fee_logistics, [6, 7]);
  assert.deepEqual(Mapping.missingRequired(map, 'settlements'), []);
  const out = Mapping.applyMapping([['1', '2026-07-01', '90', '-1', '-2', '-3', '-4', '-1.5']], map, 'settlements');
  assert.equal(out[0].fee_logistics, 5.5);
  const cn = ['订单号', '购买数量', 'SKU', '下单时间', '订单金额'];
  assert.equal(Mapping.detectType(cn), 'orders');
});

test('数字与日期清洗', () => {
  assert.equal(parseNumber('¥1,234.50'), 1234.5);
  assert.equal(parseNumber('(12.5)'), -12.5);
  assert.equal(parseNumber('-3'), -3);
  assert.equal(parseDateTime('2026/7/5 08:09:10').time, '2026-07-05 08:09:10');
  assert.equal(parseDateTime('07/21/2026').date, '2026-07-21');
  assert.equal(parseDateTime(46000).date.length, 10);
  assert.equal(parseDateTime('abc'), null);
});
