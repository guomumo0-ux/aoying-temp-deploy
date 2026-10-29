'use strict';
const { tx } = require('./db');
const { parseNumber, parseDateTime, parseCurrency, cleanId, cleanText } = require('./normalize');

const abs = (n) => (n === null ? 0 : Math.abs(n));
const num = (n, d = 0) => (n === null ? d : n);

// 每种类型：把一行（字段名 → 原始值）清洗成可入库的对象；返回 string 表示跳过原因
const handlers = {
  orders: {
    prepare(db) {
      const st = db.prepare(`INSERT INTO orders(order_id,sku,product_name,qty,amount,currency,order_time,order_date,status)
        VALUES(?,?,?,?,?,?,?,?,?)
        ON CONFLICT(order_id,sku) DO UPDATE SET product_name=excluded.product_name, qty=excluded.qty, amount=excluded.amount,
          currency=excluded.currency, order_time=excluded.order_time, order_date=excluded.order_date, status=excluded.status`);
      return (o) => st.run(o.order_id, o.sku, o.product_name, o.qty, o.amount, o.currency, o.order_time, o.order_date, o.status);
    },
    clean(r, cur) {
      const order_id = cleanId(r.order_id);
      if (!order_id) return '缺少订单号';
      const dt = parseDateTime(r.order_time);
      return {
        order_id, sku: cleanText(r.sku), product_name: cleanText(r.product_name),
        qty: num(parseNumber(r.qty), 1), amount: num(parseNumber(r.amount)),
        currency: parseCurrency(r.currency, cur), order_time: dt ? dt.time : null,
        order_date: dt ? dt.date : null, status: cleanText(r.status),
      };
    },
    key: (o) => `${o.order_id}\u0001${o.sku}`,
    merge: null, // 同一订单同一 SKU 重复行：后者覆盖
  },
  settlements: {
    prepare(db) {
      const st = db.prepare(`INSERT INTO settlements(order_id,settle_date,currency,settle_amount,fee_transaction,fee_commission,fee_affiliate,fee_gmvmax,fee_logistics,fee_other,refund_amount)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(order_id) DO UPDATE SET settle_date=excluded.settle_date, currency=excluded.currency, settle_amount=excluded.settle_amount,
          fee_transaction=excluded.fee_transaction, fee_commission=excluded.fee_commission, fee_affiliate=excluded.fee_affiliate,
          fee_gmvmax=excluded.fee_gmvmax, fee_logistics=excluded.fee_logistics, fee_other=excluded.fee_other, refund_amount=excluded.refund_amount`);
      return (o) => st.run(o.order_id, o.settle_date, o.currency, o.settle_amount, o.fee_transaction, o.fee_commission, o.fee_affiliate, o.fee_gmvmax, o.fee_logistics, o.fee_other, o.refund_amount);
    },
    clean(r, cur) {
      const order_id = cleanId(r.order_id);
      if (!order_id) return '缺少订单号';
      const dt = parseDateTime(r.settle_date);
      if (!dt) return '结算日期无法识别';
      const amount = parseNumber(r.settle_amount);
      if (amount === null) return '缺少结算金额';
      return {
        order_id, settle_date: dt.date, currency: parseCurrency(r.currency, cur), settle_amount: amount,
        fee_transaction: abs(parseNumber(r.fee_transaction)), fee_commission: abs(parseNumber(r.fee_commission)),
        fee_affiliate: abs(parseNumber(r.fee_affiliate)), fee_gmvmax: abs(parseNumber(r.fee_gmvmax)),
        fee_logistics: abs(parseNumber(r.fee_logistics)), fee_other: abs(parseNumber(r.fee_other)),
        refund_amount: abs(parseNumber(r.refund_amount)),
      };
    },
    key: (o) => o.order_id,
    // 同一订单在同一文件里多行（调整项）合并相加
    merge(a, b) {
      for (const k of ['settle_amount', 'fee_transaction', 'fee_commission', 'fee_affiliate', 'fee_gmvmax', 'fee_logistics', 'fee_other', 'refund_amount']) a[k] += b[k];
      if (b.settle_date > a.settle_date) a.settle_date = b.settle_date;
      return a;
    },
  },
  costs: {
    prepare(db, user) {
      const st = db.prepare(`INSERT INTO costs(kind,key,cost,currency,note,updated_by,updated_at) VALUES(?,?,?,?,?,?,datetime('now'))
        ON CONFLICT(kind,key) DO UPDATE SET cost=excluded.cost, currency=excluded.currency, note=excluded.note, updated_by=excluded.updated_by, updated_at=excluded.updated_at`);
      return (o) => st.run(o.kind, o.key, o.cost, o.currency, o.note, user);
    },
    clean(r, cur) {
      const sku = cleanText(r.sku);
      const name = cleanText(r.product_name);
      const cost = parseNumber(r.cost);
      if (cost === null || cost < 0) return '成本无效';
      if (!sku && !name) return '缺少 SKU';
      return sku
        ? { kind: 'sku', key: sku, cost, currency: parseCurrency(r.currency, cur), note: cleanText(r.note) }
        : { kind: 'product', key: name, cost, currency: parseCurrency(r.currency, cur), note: cleanText(r.note) };
    },
    key: (o) => `${o.kind}\u0001${o.key}`,
  },
  ads: {
    prepare(db) {
      const st = db.prepare(`INSERT INTO ads(date,campaign,ad_type,currency,spend,impressions,clicks,orders,revenue) VALUES(?,?,?,?,?,?,?,?,?)
        ON CONFLICT(date,campaign,ad_type) DO UPDATE SET currency=excluded.currency, spend=excluded.spend, impressions=excluded.impressions,
          clicks=excluded.clicks, orders=excluded.orders, revenue=excluded.revenue`);
      return (o) => st.run(o.date, o.campaign, o.ad_type, o.currency, o.spend, o.impressions, o.clicks, o.orders, o.revenue);
    },
    clean(r, cur) {
      const dt = parseDateTime(r.date);
      if (!dt) return '日期无法识别';
      const spend = parseNumber(r.spend);
      if (spend === null) return '缺少消耗金额';
      return {
        date: dt.date, campaign: cleanText(r.campaign), ad_type: cleanText(r.ad_type), currency: parseCurrency(r.currency, cur),
        spend, impressions: num(parseNumber(r.impressions)), clicks: num(parseNumber(r.clicks)),
        orders: num(parseNumber(r.orders)), revenue: num(parseNumber(r.revenue)),
      };
    },
    key: (o) => `${o.date}\u0001${o.campaign}\u0001${o.ad_type}`,
    merge(a, b) {
      for (const k of ['spend', 'impressions', 'clicks', 'orders', 'revenue']) a[k] += b[k];
      return a;
    },
  },
  expenses: {
    prepare(db, user) {
      const st = db.prepare('INSERT INTO expenses(date,category,amount,currency,note,created_by) VALUES(?,?,?,?,?,?)');
      return (o) => st.run(o.date, o.category, o.amount, o.currency, o.note, user);
    },
    clean(r, cur) {
      const dt = parseDateTime(r.date);
      if (!dt) return '日期无法识别';
      const amount = parseNumber(r.amount);
      if (amount === null) return '缺少金额';
      return { date: dt.date, category: cleanText(r.category) || '其他', amount, currency: parseCurrency(r.currency, cur), note: cleanText(r.note) };
    },
    key: null,
  },
};

const TYPES = Object.keys(handlers);

// rows: [{字段: 原始值}]；返回统计
function importRows(db, type, rows, { defaultCurrency = 'CNY', user = '' } = {}) {
  const h = handlers[type];
  if (!h) throw new Error('未知的导入类型');
  const errors = [];
  const merged = new Map();
  const list = [];
  let skipped = 0;
  rows.forEach((r, i) => {
    const o = h.clean(r, defaultCurrency);
    if (typeof o === 'string') {
      skipped++;
      if (errors.length < 20) errors.push({ row: i + 1, reason: o });
      return;
    }
    if (!h.key) { list.push(o); return; }
    const k = h.key(o);
    if (merged.has(k)) {
      if (h.merge) h.merge(merged.get(k), o); else merged.set(k, o);
    } else {
      merged.set(k, o);
    }
  });
  const items = h.key ? [...merged.values()] : list;
  tx(db, () => {
    const write = h.prepare(db, user);
    for (const o of items) write(o);
  });
  return { total: rows.length, ok: items.length, skipped, errors };
}

module.exports = { importRows, TYPES };
