'use strict';
// 利润口径：
//   已结算订单（按订单号与已售订单匹配）→ 结算金额作为收入
//   商品成本 = 订单行 SKU × 购买数量 × 录入的成本（SKU 成本优先，其次商品名成本）
//   广告成本、出库/上架等额外费用：按实际发生金额全额扣除（不受订单是否结算影响）
//   平台费用已包含在结算金额里，只展示不再扣除
//   未结算订单：单独预估，不计入净利润
const round2 = (n) => Math.round(n * 100) / 100;
const CANCELLED = /取消|cancel|关闭|closed/i;

function dayList(from, to) {
  const out = [];
  const d = new Date(from + 'T00:00:00Z');
  const end = new Date(to + 'T00:00:00Z');
  while (d <= end && out.length < 1500) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function buildModel(data) {
  const { settings } = data;
  const fx = settings.fx;
  const missingFx = new Set();
  const toCny = (amount, cur) => {
    const c = (cur || 'CNY').toUpperCase();
    const rate = fx[c];
    if (rate === undefined) { missingFx.add(c); return amount; }
    return amount * rate;
  };

  const skuCost = new Map();
  const productCost = new Map();
  for (const c of data.costs) {
    const v = toCny(c.cost, c.currency);
    (c.kind === 'sku' ? skuCost : productCost).set(c.key, v);
  }
  const unitCost = (sku, name) => {
    if (sku && skuCost.has(sku)) return skuCost.get(sku);
    if (name && productCost.has(name)) return productCost.get(name);
    return null;
  };

  const orderMap = new Map();
  for (const o of data.orders) {
    let e = orderMap.get(o.order_id);
    if (!e) { e = { order_id: o.order_id, order_date: o.order_date, order_time: o.order_time, status: o.status, lines: [], amount: 0 }; orderMap.set(o.order_id, e); }
    const amount = toCny(o.amount, o.currency);
    e.lines.push({ sku: o.sku, name: o.product_name, qty: o.qty, amount });
    e.amount += amount;
    if (o.status && !e.status) e.status = o.status;
  }
  const settleMap = new Map();
  for (const s of data.settlements) settleMap.set(s.order_id, s);

  const rows = [];
  const missingCostSkus = new Map(); // key -> {sku,name,units,orders}
  const ids = new Set([...orderMap.keys(), ...settleMap.keys()]);
  let ratioNum = 0, ratioDen = 0;

  for (const id of ids) {
    const o = orderMap.get(id) || null;
    const s = settleMap.get(id) || null;
    const lines = o ? o.lines : [];
    const r = {
      order_id: id,
      state: s ? (o ? 'settled' : 'unmatched') : 'unsettled',
      order_date: o ? o.order_date : null,
      settle_date: s ? s.settle_date : null,
      status: o ? o.status : '',
      lines: [],
      orderAmount: o ? o.amount : 0,
      units: lines.reduce((a, l) => a + l.qty, 0),
      revenue: 0, refund: 0, zero: false, refunded: false,
      fees: { transaction: 0, commission: 0, affiliate: 0, gmvmax: 0, logistics: 0, other: 0 },
      cost: 0, missingCost: false,
    };
    r.date = s ? s.settle_date : r.order_date;
    if (s) {
      r.revenue = toCny(s.settle_amount, s.currency);
      r.refund = toCny(s.refund_amount, s.currency);
      r.fees = {
        transaction: toCny(s.fee_transaction, s.currency), commission: toCny(s.fee_commission, s.currency),
        affiliate: toCny(s.fee_affiliate, s.currency), gmvmax: toCny(s.fee_gmvmax, s.currency),
        logistics: toCny(s.fee_logistics, s.currency), other: toCny(s.fee_other, s.currency),
      };
      r.zero = s.settle_amount <= 0;
      r.refunded = r.zero || s.refund_amount > 0;
    }
    const countCost = s ? (!r.zero || settings.count_cost_for_refunded) : false;
    const lineTotal = lines.reduce((a, l) => a + l.amount, 0);
    for (const l of lines) {
      const uc = unitCost(l.sku, l.name);
      const lc = uc === null ? 0 : uc * l.qty;
      const share = lineTotal > 0 ? l.amount / lineTotal : 1 / lines.length;
      r.lines.push({ sku: l.sku, name: l.name, qty: l.qty, amount: l.amount, unitCost: uc, lineCost: lc, share });
      if (uc === null) {
        r.missingCost = true;
        if (s || !CANCELLED.test(r.status)) {
          const key = l.sku || l.name || '(无SKU)';
          const m = missingCostSkus.get(key) || { sku: l.sku, name: l.name, units: 0, orders: 0 };
          m.units += l.qty; m.orders += 1;
          missingCostSkus.set(key, m);
        }
      }
      if (countCost) r.cost += lc;
    }
    if (r.state === 'unsettled') r.cancelled = CANCELLED.test(r.status);
    if (s && o && r.revenue > 0 && r.orderAmount > 0) { ratioNum += r.revenue; ratioDen += r.orderAmount; }
    rows.push(r);
  }

  const ratio = ratioDen > 0 ? Math.min(1, ratioNum / ratioDen) : settings.unsettled_ratio_fallback;
  for (const r of rows) {
    if (r.state !== 'unsettled') continue;
    r.estRevenue = r.cancelled ? 0 : r.orderAmount * ratio;
    r.estCost = r.cancelled ? 0 : r.lines.reduce((a, l) => a + l.lineCost, 0);
  }

  const ads = data.ads.map((a) => ({ ...a, spendCny: toCny(a.spend, a.currency), revenueCny: toCny(a.revenue, a.currency) }));
  const expenses = data.expenses.map((e) => ({ ...e, amountCny: toCny(e.amount, e.currency) }));

  const dates = [];
  for (const r of rows) if (r.date) dates.push(r.date);
  for (const r of rows) if (r.order_date) dates.push(r.order_date);
  for (const a of ads) dates.push(a.date);
  for (const e of expenses) dates.push(e.date);
  dates.sort();

  return {
    settings, rows, ads, expenses, ratio, missingFx, missingCostSkus,
    bounds: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null,
  };
}

const inRange = (d, from, to) => !!d && d >= from && d <= to;
const adCounts = (m, a) => !(m.settings.exclude_gmvmax_ads && /gmv\s*max/i.test(a.ad_type + ' ' + a.campaign));

function summary(m, from, to) {
  const settled = m.rows.filter((r) => r.state !== 'unsettled' && inRange(r.settle_date, from, to));
  const ads = m.ads.filter((a) => inRange(a.date, from, to) && adCounts(m, a));
  const exps = m.expenses.filter((e) => inRange(e.date, from, to));

  const t = { revenue: 0, cost: 0, ads: 0, expenses: 0, orders: settled.length, units: 0, refundOrders: 0, refundAmount: 0, zeroOrders: 0 };
  const fees = { transaction: 0, commission: 0, affiliate: 0, gmvmax: 0, logistics: 0, other: 0 };
  const daily = new Map(dayList(from, to).map((d) => [d, { date: d, revenue: 0, cost: 0, ads: 0, expenses: 0 }]));
  const day = (d) => { let e = daily.get(d); if (!e) { e = { date: d, revenue: 0, cost: 0, ads: 0, expenses: 0 }; daily.set(d, e); } return e; };

  for (const r of settled) {
    t.revenue += r.revenue; t.cost += r.cost;
    if (!r.zero) t.units += r.units;
    if (r.refunded) t.refundOrders++;
    if (r.zero) t.zeroOrders++;
    t.refundAmount += r.refund;
    for (const k of Object.keys(fees)) fees[k] += r.fees[k];
    const d = day(r.settle_date); d.revenue += r.revenue; d.cost += r.cost;
  }
  for (const a of ads) { t.ads += a.spendCny; day(a.date).ads += a.spendCny; }
  for (const e of exps) { t.expenses += e.amountCny; day(e.date).expenses += e.amountCny; }
  t.net = t.revenue - t.cost - t.ads - t.expenses;

  const expByCat = {};
  for (const e of exps) expByCat[e.category] = (expByCat[e.category] || 0) + e.amountCny;

  const un = m.rows.filter((r) => r.state === 'unsettled' && !r.cancelled && inRange(r.order_date, from, to));
  const unsettled = {
    orders: un.length, units: un.reduce((a, r) => a + r.units, 0),
    orderAmount: un.reduce((a, r) => a + r.orderAmount, 0),
    estRevenue: un.reduce((a, r) => a + r.estRevenue, 0),
    estCost: un.reduce((a, r) => a + r.estCost, 0),
    ratio: m.ratio,
  };
  unsettled.estGross = unsettled.estRevenue - unsettled.estCost;

  const series = [...daily.values()].sort((a, b) => (a.date < b.date ? -1 : 1)).map((d) => ({
    date: d.date, revenue: round2(d.revenue), cost: round2(d.cost), ads: round2(d.ads), expenses: round2(d.expenses),
    net: round2(d.revenue - d.cost - d.ads - d.expenses),
  }));

  const rd = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, round2(v)]));
  const feeTotal = Object.values(fees).reduce((a, b) => a + b, 0);
  return {
    totals: rd(t), margin: t.revenue > 0 ? t.net / t.revenue : 0,
    avgProfitPerOrder: t.orders ? t.net / t.orders : 0,
    refundRate: t.orders ? t.refundOrders / t.orders : 0,
    fees: rd(fees), feeTotal: round2(feeTotal), expenseByCategory: rd(expByCat),
    unsettled: rd(unsettled), series,
  };
}

function products(m, from, to) {
  const map = new Map();
  const get = (l) => {
    const key = l.sku || l.name || '(无SKU)';
    let p = map.get(key);
    if (!p) { p = { key, sku: l.sku, name: l.name, orders: 0, units: 0, revenue: 0, cost: 0, refundOrders: 0, unsettledUnits: 0, unsettledEstGross: 0, missingCost: false }; map.set(key, p); }
    if (!p.name && l.name) p.name = l.name;
    return p;
  };
  for (const r of m.rows) {
    if (r.state === 'settled' && inRange(r.settle_date, from, to)) {
      const countCost = !r.zero || m.settings.count_cost_for_refunded;
      for (const l of r.lines) {
        const p = get(l);
        p.orders++;
        if (!r.zero) p.units += l.qty;
        p.revenue += r.revenue * l.share;
        if (countCost) p.cost += l.lineCost;
        if (r.refunded) p.refundOrders++;
        if (l.unitCost === null) p.missingCost = true;
      }
    } else if (r.state === 'unsettled' && !r.cancelled && inRange(r.order_date, from, to)) {
      for (const l of r.lines) {
        const p = get(l);
        p.unsettledUnits += l.qty;
        p.unsettledEstGross += r.estRevenue * l.share - l.lineCost;
      }
    }
  }
  return [...map.values()].map((p) => ({
    ...p, revenue: round2(p.revenue), cost: round2(p.cost), gross: round2(p.revenue - p.cost),
    margin: p.revenue > 0 ? (p.revenue - p.cost) / p.revenue : 0,
    refundRate: p.orders ? p.refundOrders / p.orders : 0,
    unsettledEstGross: round2(p.unsettledEstGross),
  })).sort((a, b) => b.gross - a.gross);
}

function orderList(m, from, to, { state = 'all', q = '', page = 1, pageSize = 50 } = {}) {
  const needle = q.trim().toLowerCase();
  let list = m.rows.filter((r) => inRange(r.date, from, to));
  if (state === 'settled') list = list.filter((r) => r.state === 'settled' && !r.zero);
  else if (state === 'unsettled') list = list.filter((r) => r.state === 'unsettled' && !r.cancelled);
  else if (state === 'zero') list = list.filter((r) => r.state !== 'unsettled' && r.zero);
  else if (state === 'refunded') list = list.filter((r) => r.refunded);
  else if (state === 'unmatched') list = list.filter((r) => r.state === 'unmatched');
  else if (state === 'missingcost') list = list.filter((r) => r.missingCost);
  if (needle) {
    list = list.filter((r) => r.order_id.toLowerCase().includes(needle) || r.lines.some((l) => (l.sku + ' ' + l.name).toLowerCase().includes(needle)));
  }
  list.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.order_id < b.order_id ? 1 : -1));
  const total = list.length;
  const slice = list.slice((page - 1) * pageSize, page * pageSize).map((r) => ({
    order_id: r.order_id, state: r.state, zero: r.zero, refunded: r.refunded, cancelled: !!r.cancelled, date: r.date,
    order_date: r.order_date, settle_date: r.settle_date, status: r.status,
    skus: r.lines.map((l) => (l.sku || l.name || '-') + ' ×' + l.qty).join('，'), units: r.units,
    orderAmount: round2(r.orderAmount), revenue: round2(r.revenue), cost: round2(r.state === 'unsettled' ? r.estCost : r.cost),
    gross: round2(r.state === 'unsettled' ? r.estRevenue - r.estCost : r.revenue - r.cost),
    estRevenue: r.state === 'unsettled' ? round2(r.estRevenue) : null, missingCost: r.missingCost,
  }));
  return { total, page, pageSize, rows: slice, all: list };
}

function aftersales(m, from, to) {
  const settled = m.rows.filter((r) => r.state !== 'unsettled' && inRange(r.settle_date, from, to));
  const refunded = settled.filter((r) => r.refunded);
  const zero = settled.filter((r) => r.zero);
  const bySku = new Map();
  for (const r of settled) {
    for (const l of r.lines) {
      const key = l.sku || l.name || '(无SKU)';
      const p = bySku.get(key) || { key, name: l.name, orders: 0, refundOrders: 0, zeroOrders: 0, refundAmount: 0, lostAmount: 0 };
      p.orders++;
      if (r.refunded) { p.refundOrders++; p.refundAmount += r.refund * l.share; }
      if (r.zero) { p.zeroOrders++; p.lostAmount += r.orderAmount * l.share; }
      bySku.set(key, p);
    }
  }
  const byDay = new Map(dayList(from, to).map((d) => [d, { date: d, orders: 0, refundOrders: 0, zeroOrders: 0 }]));
  for (const r of settled) {
    const d = byDay.get(r.settle_date);
    if (!d) continue;
    d.orders++; if (r.refunded) d.refundOrders++; if (r.zero) d.zeroOrders++;
  }
  return {
    totals: {
      orders: settled.length, refundOrders: refunded.length, refundRate: settled.length ? refunded.length / settled.length : 0,
      zeroOrders: zero.length, zeroOrderAmount: round2(zero.reduce((a, r) => a + r.orderAmount, 0)),
      refundAmount: round2(settled.reduce((a, r) => a + r.refund, 0)),
    },
    bySku: [...bySku.values()].map((p) => ({ ...p, refundRate: p.orders ? p.refundOrders / p.orders : 0, refundAmount: round2(p.refundAmount), lostAmount: round2(p.lostAmount) }))
      .filter((p) => p.refundOrders > 0).sort((a, b) => b.refundOrders - a.refundOrders).slice(0, 200),
    daily: [...byDay.values()],
  };
}

function adsReport(m, from, to) {
  const ads = m.ads.filter((a) => inRange(a.date, from, to) && adCounts(m, a));
  const sum = summary(m, from, to);
  const daily = new Map(dayList(from, to).map((d) => [d, { date: d, spend: 0, revenue: 0, settledRevenue: 0 }]));
  const camp = new Map();
  const types = new Map();
  let spend = 0, adRevenue = 0, impressions = 0, clicks = 0, orders = 0;
  for (const a of ads) {
    spend += a.spendCny; adRevenue += a.revenueCny; impressions += a.impressions; clicks += a.clicks; orders += a.orders;
    const d = daily.get(a.date); if (d) { d.spend += a.spendCny; d.revenue += a.revenueCny; }
    const ck = (a.campaign || '(未命名)') + '\u0001' + a.ad_type;
    const c = camp.get(ck) || { campaign: a.campaign || '(未命名)', ad_type: a.ad_type, spend: 0, revenue: 0, impressions: 0, clicks: 0, orders: 0 };
    c.spend += a.spendCny; c.revenue += a.revenueCny; c.impressions += a.impressions; c.clicks += a.clicks; c.orders += a.orders;
    camp.set(ck, c);
    const tk = a.ad_type || '(未分类)';
    types.set(tk, (types.get(tk) || 0) + a.spendCny);
  }
  for (const s of sum.series) { const d = daily.get(s.date); if (d) d.settledRevenue = s.revenue; }
  const zeroRows = m.rows.filter((r) => r.state !== 'unsettled' && r.zero && inRange(r.settle_date, from, to));
  return {
    totals: {
      spend: round2(spend), revenue: round2(adRevenue), impressions, clicks, orders,
      roas: spend > 0 ? sum.totals.revenue / spend : 0, adShare: sum.totals.revenue > 0 ? spend / sum.totals.revenue : 0,
      ctr: impressions ? clicks / impressions : 0, cpc: clicks ? spend / clicks : 0,
      settledRevenue: sum.totals.revenue, zeroOrders: zeroRows.length,
      zeroOrderAmount: round2(zeroRows.reduce((a, r) => a + r.orderAmount, 0)),
    },
    daily: [...daily.values()].map((d) => ({ ...d, spend: round2(d.spend), revenue: round2(d.revenue) })),
    campaigns: [...camp.values()].map((c) => ({ ...c, spend: round2(c.spend), revenue: round2(c.revenue), roas: c.spend > 0 ? c.revenue / c.spend : 0 })).sort((a, b) => b.spend - a.spend).slice(0, 200),
    types: [...types.entries()].map(([name, v]) => ({ name, spend: round2(v) })).sort((a, b) => b.spend - a.spend),
  };
}

function check(m, from, to) {
  const items = [];
  const add = (level, title, detail, extra) => items.push({ level, title, detail, ...(extra || {}) });
  const settled = m.rows.filter((r) => r.state !== 'unsettled' && inRange(r.settle_date, from, to));
  const unmatched = settled.filter((r) => r.state === 'unmatched');
  const soldInRange = m.rows.filter((r) => r.order_date && inRange(r.order_date, from, to));
  const unsettled = soldInRange.filter((r) => r.state === 'unsettled' && !r.cancelled);

  if (!m.rows.length) add('warn', '还没有订单数据', '请先在「数据导入」导入已售订单和已结算订单。');
  if (unmatched.length) {
    add('warn', `${unmatched.length} 笔结算订单找不到对应的已售订单`,
      '这些订单的结算金额已计入收入，但无法计算商品成本（成本记为 0），利润会偏高。请补导入对应日期的已售订单。',
      { link: '#/orders?state=unmatched' });
  } else if (settled.length) add('ok', '所有结算订单都匹配到了已售订单', `${settled.length} 笔结算订单均可按订单号匹配。`);

  const miss = [...m.missingCostSkus.values()].sort((a, b) => b.units - a.units);
  if (miss.length) {
    add('error', `${miss.length} 个 SKU 还没有录入成本`, '没有成本的 SKU 按 0 计算，利润会虚高。请在「商品成本」补录。',
      { link: '#/costs?missing=1', list: miss.slice(0, 30).map((x) => `${x.sku || x.name}（${x.units} 件）`) });
  } else if (m.rows.length) add('ok', '所有 SKU 都已录入成本', '');

  if (m.missingFx.size) add('error', `缺少汇率：${[...m.missingFx].join('、')}`, '这些币种暂按 1:1 计入人民币，请到「设置」补充汇率。', { link: '#/settings' });

  if (unsettled.length) {
    add('info', `${unsettled.length} 笔订单尚未结算`,
      `订单金额 ¥${round2(unsettled.reduce((a, r) => a + r.orderAmount, 0)).toLocaleString('en-US')}，只做预估，没有计入净利润。`, { link: '#/orders?state=unsettled' });
  }

  const zero = settled.filter((r) => r.zero);
  if (zero.length) {
    add('info', `${zero.length} 笔结算金额为 0 的订单（含秒拍秒退）`,
      '这类订单结算为 0，但推广仍可能产生消耗。广告成本按实际消耗全额扣除，不会因订单为 0 而漏掉。', { link: '#/orders?state=zero' });
  }

  const daysWithSettle = new Set(settled.map((r) => r.settle_date));
  const daysWithAds = new Set(m.ads.filter((a) => inRange(a.date, from, to)).map((a) => a.date));
  const noAds = [...daysWithSettle].filter((d) => !daysWithAds.has(d)).sort();
  if (!m.ads.length) add('warn', '没有广告消耗数据', '净利润未扣除广告成本。请到「数据导入」导入广告消耗。');
  else if (noAds.length) add('warn', `${noAds.length} 天有结算订单但没有广告消耗记录`, '如果这些天确实投放过，请补导入广告数据：' + noAds.slice(0, 12).join('、') + (noAds.length > 12 ? '…' : ''));

  const gmvInSettle = settled.reduce((a, r) => a + r.fees.gmvmax, 0);
  const gmvInAds = m.ads.filter((a) => inRange(a.date, from, to) && /gmv\s*max/i.test(a.ad_type + ' ' + a.campaign)).reduce((a, x) => a + x.spendCny, 0);
  if (gmvInSettle > 0 && gmvInAds > 0 && !m.settings.exclude_gmvmax_ads) {
    add('warn', 'GMV Max 费用可能重复扣除',
      `结算单里有 GMV Max 费用 ¥${round2(gmvInSettle)}，广告导入里也有 GMV Max 消耗 ¥${round2(gmvInAds)}。若结算金额已扣除 GMV Max，请在「设置」开启「广告成本剔除 GMV Max」。`, { link: '#/settings' });
  }

  const noDate = m.rows.filter((r) => r.state === 'unsettled' && !r.order_date).length;
  if (noDate) add('warn', `${noDate} 笔已售订单缺少下单日期`, '这些订单不会出现在按日期筛选的结果里。');

  return {
    items,
    counts: {
      soldOrders: soldInRange.length, settledOrders: settled.length, matched: settled.length - unmatched.length,
      unmatched: unmatched.length, unsettled: unsettled.length, zero: zero.length, missingCostSkus: miss.length,
    },
    unmatchedSample: unmatched.slice(0, 30).map((r) => ({ order_id: r.order_id, settle_date: r.settle_date, revenue: round2(r.revenue) })),
  };
}

module.exports = { buildModel, summary, products, orderList, aftersales, adsReport, check, round2 };
