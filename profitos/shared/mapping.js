/* 导入列映射：浏览器和 Node 共用（UMD）。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Mapping = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // 字段定义：label 给界面显示；required 必填；multi 可映射多列求和（费用类）
  const SCHEMAS = {
    orders: {
      label: '已售订单',
      fields: {
        order_id: { label: '订单号', required: true, aliases: ['订单号', '订单编号', '订单id', 'orderid', 'ordernumber', 'orderno', 'order id', '平台订单号'] },
        sku: { label: 'SKU', aliases: ['sku', 'sku编码', 'sku编号', 'seller sku', 'sellersku', '商家sku', '商家编码', '规格编码', '货号'] },
        product_name: { label: '商品名称', aliases: ['商品名称', '商品名', '产品名称', 'productname', 'product name', '商品标题', '标题', 'item name'] },
        qty: { label: '购买数量', required: true, aliases: ['购买数量', '数量', '商品数量', '件数', 'quantity', 'qty', 'sku quantity'] },
        amount: { label: '订单金额', aliases: ['订单金额', '销售额', '成交金额', '商品金额', '实付金额', 'orderamount', 'order amount', 'sku subtotal after discount', 'subtotal', 'total', '销售金额'] },
        order_time: { label: '下单时间', aliases: ['下单时间', '创建时间', '订单创建时间', '下单日期', 'createdtime', 'created time', 'order time', 'create time', 'ordercreationtime', '日期'] },
        status: { label: '订单状态', aliases: ['订单状态', '状态', 'orderstatus', 'order status', 'status'] },
        currency: { label: '币种', aliases: ['币种', '货币', 'currency'] },
      },
    },
    settlements: {
      label: '已结算订单',
      fields: {
        order_id: { label: '订单号', required: true, aliases: ['订单号', '订单编号', 'order/adjustment id', 'orderid', 'order id', 'order/adjustmentid', '关联订单号', '平台订单号'] },
        settle_date: { label: '结算日期', required: true, aliases: ['结算时间', '结算日期', '到账时间', 'settlement date', 'order settled time', 'settled time', 'settlementtime', 'statement date', '结算完成时间'] },
        settle_amount: { label: '结算金额', required: true, aliases: ['结算金额', '结算总额', '实际结算金额', '净结算金额', 'total settlement amount', 'settlement amount', 'net settlement', 'settlementamount', '回款金额'] },
        fee_transaction: { label: '交易手续费', multi: true, aliases: ['交易手续费', '手续费', 'transaction fee', 'transactionfee', '支付手续费'] },
        fee_commission: { label: 'TikTok佣金', multi: true, aliases: ['tiktok佣金', '平台佣金', '平台服务费', '佣金', 'tiktok shop commission fee', 'commission fee', 'referral fee', 'platform commission'] },
        fee_affiliate: { label: '联盟佣金', multi: true, aliases: ['联盟佣金', '达人佣金', 'affiliate commission', 'affiliate partner commission', 'creator commission', 'affiliate commission fee'] },
        fee_gmvmax: { label: 'GMV Max', multi: true, aliases: ['gmv max', 'gmvmax', 'gmv max费用', 'gmv max广告费', 'gmv max ad fee', 'gmv max fee'] },
        fee_logistics: { label: '物流相关', multi: true, aliases: ['物流相关', '物流费', '运费', '物流费用', '配送费', 'shipping fee', 'shipping cost', 'logistics fee', 'fbt fulfillment fee', 'fulfillment fee', 'actual shipping fee', 'return shipping', '退货运费'] },
        fee_other: { label: '其他费用', multi: true, aliases: ['其他费用', '其他', 'other fee', 'other fees', 'adjustment fee', 'service fee', '服务费'] },
        refund_amount: { label: '退款金额', aliases: ['退款金额', '退款', 'refund', 'refund amount', 'total refund', 'refunds'] },
        currency: { label: '币种', aliases: ['币种', '货币', 'currency'] },
      },
    },
    costs: {
      label: '商品成本',
      fields: {
        sku: { label: 'SKU', aliases: ['sku', 'sku编码', '商家sku', '货号', 'seller sku'] },
        product_name: { label: '商品名称（无SKU时作为默认成本）', aliases: ['商品名称', '商品名', '产品名称', 'product name'] },
        cost: { label: '单件成本', required: true, aliases: ['成本', '单件成本', '商品成本', '采购价', '进货价', '成本价', 'cost', 'unit cost'] },
        currency: { label: '币种', aliases: ['币种', '货币', 'currency'] },
        note: { label: '备注', aliases: ['备注', 'note', 'remark'] },
      },
    },
    ads: {
      label: '广告消耗',
      fields: {
        date: { label: '日期', required: true, aliases: ['日期', '时间', '统计日期', '天', 'date', 'day', 'by day', 'stat time'] },
        spend: { label: '消耗金额', required: true, aliases: ['消耗', '花费', '广告消耗', '推广消耗', '消耗金额', 'cost', 'spend', 'ad spend', 'amount spent'] },
        campaign: { label: '广告系列/计划', aliases: ['广告系列', '广告系列名称', '计划名称', '推广计划', '广告计划', 'campaign', 'campaign name', '计划'] },
        ad_type: { label: '广告类型', aliases: ['广告类型', '推广类型', '渠道', 'ad type', 'type', 'objective'] },
        impressions: { label: '展示', aliases: ['展示', '展示次数', '曝光', 'impressions'] },
        clicks: { label: '点击', aliases: ['点击', '点击次数', 'clicks'] },
        orders: { label: '广告订单数', aliases: ['订单数', '成交订单数', '广告订单', 'orders', 'sku orders', 'conversions'] },
        revenue: { label: '广告成交额', aliases: ['成交金额', '广告成交额', '广告销售额', 'gross revenue', 'revenue', 'gmv'] },
        currency: { label: '币种', aliases: ['币种', '货币', 'currency'] },
      },
    },
    expenses: {
      label: '额外费用（出库/上架等）',
      fields: {
        date: { label: '日期', required: true, aliases: ['日期', '时间', 'date'] },
        category: { label: '费用类别', required: true, aliases: ['类别', '费用类别', '费用类型', '项目', '费用项', 'category', 'type'] },
        amount: { label: '金额', required: true, aliases: ['金额', '费用', '费用金额', 'amount', 'fee'] },
        note: { label: '备注', aliases: ['备注', '说明', 'note', 'remark'] },
        currency: { label: '币种', aliases: ['币种', '货币', 'currency'] },
      },
    },
  };

  const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/[\s_\-()（）\[\]:：/\\.]+/g, '');

  function scoreHeader(h, aliases) {
    const n = norm(h);
    if (!n) return 0;
    let best = 0;
    for (const a of aliases) {
      const an = norm(a);
      if (n === an) return 100;
      if (an.length >= 3 && n.includes(an)) best = Math.max(best, 60 + Math.min(an.length, 20));
    }
    return best;
  }

  // 在前 15 行里找表头行：命中字段别名最多的那一行
  function detectHeaderRow(rows, type) {
    const fields = Object.values(SCHEMAS[type].fields);
    let bestIdx = 0, best = -1;
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      const cells = (rows[i] || []).map((c) => String(c == null ? '' : c));
      let hits = 0;
      for (const f of fields) if (cells.some((c) => scoreHeader(c, f.aliases) >= 60)) hits++;
      if (hits > best) { best = hits; bestIdx = i; }
    }
    return bestIdx;
  }

  // 猜类型：取各类型命中的必填字段数最多者
  function detectType(headers) {
    let bestType = null, best = 0;
    for (const [type, s] of Object.entries(SCHEMAS)) {
      let hits = 0;
      for (const f of Object.values(s.fields)) if (headers.some((h) => scoreHeader(h, f.aliases) >= 60)) hits += f.required ? 2 : 1;
      if (hits > best) { best = hits; bestType = type; }
    }
    return best >= 4 ? bestType : null;
  }

  // 返回 { 字段: [列下标...] }
  function autoMap(headers, type) {
    const out = {};
    const used = new Set();
    for (const [key, f] of Object.entries(SCHEMAS[type].fields)) {
      const cands = headers
        .map((h, i) => ({ i, s: scoreHeader(h, f.aliases) }))
        .filter((x) => x.s >= 60 && !used.has(x.i))
        .sort((a, b) => b.s - a.s || a.i - b.i);
      if (!cands.length) { out[key] = []; continue; }
      const pick = f.multi ? cands.filter((c) => c.s === cands[0].s || c.s >= 60) : [cands[0]];
      out[key] = pick.map((c) => c.i);
      pick.forEach((c) => used.add(c.i));
    }
    return out;
  }

  function missingRequired(mapping, type) {
    return Object.entries(SCHEMAS[type].fields).filter(([k, f]) => f.required && !(mapping[k] || []).length).map(([, f]) => f.label);
  }

  function toNumber(v) {
    if (typeof v === 'number') return v;
    const s = String(v == null ? '' : v).trim();
    if (!s) return 0;
    let neg = /^\(.*\)$/.test(s) || /^-/.test(s);
    const n = Number(s.replace(/[^\d.]/g, ''));
    return Number.isFinite(n) ? (neg ? -n : n) : 0;
  }

  // 按映射把数据行转成 [{字段: 值}]；费用类多列求和
  function applyMapping(dataRows, mapping, type) {
    const fields = SCHEMAS[type].fields;
    const keys = Object.keys(fields).filter((k) => (mapping[k] || []).length);
    const out = [];
    for (const row of dataRows) {
      if (!row || row.every((c) => c === '' || c == null)) continue;
      const o = {};
      for (const k of keys) {
        const cols = mapping[k];
        if (fields[k].multi && cols.length > 1) {
          let sum = 0, any = false;
          for (const c of cols) { const x = row[c]; if (x !== '' && x != null) { any = true; sum += Math.abs(toNumber(x)); } }
          o[k] = any ? sum : '';
        } else o[k] = row[cols[0]];
      }
      out.push(o);
    }
    return out;
  }

  return { SCHEMAS, detectHeaderRow, detectType, autoMap, missingRequired, applyMapping, scoreHeader };
});
