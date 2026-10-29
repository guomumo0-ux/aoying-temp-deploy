'use strict';
/* ProfitOS 前端：原生 JS 单页应用，所有动态文本都经过 esc() 转义。 */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n, d = 2) => (n < 0 ? '-' : '') + '¥' + Math.abs(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const int = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');
const pct = (n, d = 1) => ((Number(n) || 0) * 100).toFixed(d) + '%';
const sign = (n) => (n >= 0 ? 'pos' : 'neg');

const S = { user: null, meta: null, from: null, to: null, charts: [], auto: true };
try { const r = JSON.parse(localStorage.getItem('profitos.range') || 'null'); if (r) { S.from = r.from; S.to = r.to; S.auto = false; } } catch { /* ignore */ }

function toast(msg, bad) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : '');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hidden'), bad ? 6000 : 3000);
}

async function api(method, url, body) {
  const r = await fetch('/api' + url, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401 && !url.startsWith('/auth/')) { showLogin(); throw new Error('请先登录'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || '请求失败');
  return j;
}
const GET = (u) => api('GET', u);
const qs = (o = {}) => '?' + new URLSearchParams({ from: S.from, to: S.to, ...o }).toString();

/* ---------- 登录 ---------- */
let setupMode = false;
async function showLogin() {
  $('#app').classList.add('hidden'); $('#login').classList.remove('hidden');
  const st = await fetch('/api/auth/status').then((r) => r.json());
  setupMode = st.needsSetup;
  $('#loginTitle').textContent = setupMode ? '创建管理员账号' : '登录';
  $('#loginHint').textContent = setupMode ? '这是第一次使用：请创建管理员账号，之后可在「设置」里添加团队成员。' : '团队共用的利润工作台，请使用管理员给你的账号登录。';
  $('#nameRow').classList.toggle('hidden', !setupMode);
  $('#loginBtn').textContent = setupMode ? '创建并进入' : '登录';
}
$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  $('#loginErr').textContent = '';
  try {
    await api('POST', setupMode ? '/auth/setup' : '/auth/login', Object.fromEntries(f));
    e.target.password.value = '';
    await boot();
  } catch (err) { $('#loginErr').textContent = err.message; }
});
$('#logoutBtn').addEventListener('click', async () => { await api('POST', '/auth/logout'); S.user = null; showLogin(); });

/* ---------- 框架 ---------- */
const NAV = [
  ['overview', '总览', '▦'], ['import', '数据导入', '⇪'], ['costs', '商品成本', '◈'], ['products', '商品利润', '▥'],
  ['orders', '订单明细', '☰'], ['aftersales', '售后分析', '↺'], ['ads', '广告分析', '◉'], ['check', '数据核对', '✓'], ['settings', '设置', '⚙'],
];
const PAGES = {};
window.PAGES = PAGES;

async function boot() {
  try { S.user = await GET('/me'); } catch { return showLogin(); }
  $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
  $('#whoami').textContent = S.user.name + (S.user.role === 'admin' ? '（管理员）' : '');
  await refreshMeta();
  route();
}
async function refreshMeta() {
  S.meta = await GET('/meta');
  const b = S.meta.bounds;
  // 没手动选过范围（或选的范围完全落在数据之外）时，默认显示全部数据
  if (b && (S.auto || !S.from || S.to < b.from || S.from > b.to)) { S.from = b.from; S.to = b.to; S.auto = true; }
  if (!S.from) { S.from = S.to = new Date().toISOString().slice(0, 10); }
}
function setRange(from, to) {
  S.from = from; S.to = to; S.auto = false;
  try { localStorage.setItem('profitos.range', JSON.stringify({ from, to })); } catch { /* ignore */ }
}

let renderChain = Promise.resolve();
function route() {
  // 页面渲染是异步的：串行执行，避免旧页面晚到、覆盖新页面
  renderChain = renderChain.then(renderRoute, renderRoute);
  return renderChain;
}
async function renderRoute() {
  const [path, query] = (location.hash.slice(2) || 'overview').split('?');
  const page = PAGES[path] ? path : 'overview';
  $('#nav').innerHTML = NAV.map(([k, n, ic]) => `<a href="#/${k}" class="${k === page ? 'on' : ''}"><span class="ic">${ic}</span>${n}</a>`).join('');
  S.charts.forEach((c) => c.dispose()); S.charts = [];
  const main = $('#main');
  main.innerHTML = '<div class="empty">加载中…</div>';
  const params = Object.fromEntries(new URLSearchParams(query || ''));
  try { await PAGES[page](main, params); } catch (e) { main.innerHTML = `<div class="card empty">出错了：${esc(e.message)}</div>`; }
  api('GET', '/check' + qs()).then((c) => {
    const bad = c.items.filter((i) => i.level === 'error').length;
    const a = $$('#nav a')[7];
    if (a && bad && !$('.dot', a)) a.insertAdjacentHTML('beforeend', `<span class="dot">${bad}</span>`);
  }).catch(() => {});
}
window.addEventListener('hashchange', route);

function head(title, sub, withRange = true) {
  return `<div class="page-head"><div><h1>${esc(title)}</h1><p>${sub || ''}</p></div>${withRange ? rangeBox() : ''}</div>`;
}
function rangeBox() {
  return `<div class="range"><span>分析范围</span><input type="date" id="rFrom" value="${S.from}"><span>—</span><input type="date" id="rTo" value="${S.to}">
    <button class="q" data-q="7">近7天</button><button class="q" data-q="30">近30天</button><button class="q" data-q="all">全部</button></div>`;
}
function bindRange(root) {
  const apply = () => { const f = $('#rFrom', root).value, t = $('#rTo', root).value; if (f && t) { setRange(f, t); route(); } };
  $('#rFrom', root)?.addEventListener('change', apply);
  $('#rTo', root)?.addEventListener('change', apply);
  $$('.q', root).forEach((b) => b.addEventListener('click', () => {
    const end = S.meta.bounds ? S.meta.bounds.to : S.to;
    if (b.dataset.q === 'all') return S.meta.bounds && (setRange(S.meta.bounds.from, S.meta.bounds.to), route());
    const d = new Date(end + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - (Number(b.dataset.q) - 1));
    setRange(d.toISOString().slice(0, 10), end); route();
  }));
}
function noData(main, title, sub) {
  main.innerHTML = head(title, sub) + `<div class="card empty">还没有数据。先到 <a href="#/import">数据导入</a> 导入已售订单、已结算订单、商品成本和广告消耗。</div>`;
  bindRange(main);
}
const chart = (el, option) => { const c = echarts.init(el); c.setOption(option); S.charts.push(c); return c; };
window.addEventListener('resize', () => S.charts.forEach((c) => c.resize()));
const kpi = (l, v, s, cls = '') => `<div class="card kpi"><div class="l">${l}</div><div class="v ${cls}">${v}</div><div class="s">${s || ''}</div></div>`;

/* ---------- 总览 ---------- */
PAGES.overview = async (main) => {
  if (!S.meta.bounds) return noData(main, '利润总览', '结算收入、商品成本与广告消耗统一折算为人民币。');
  const d = await GET('/overview' + qs());
  const t = d.totals;
  const fee = d.fees, maxFee = Math.max(1, ...Object.values(fee));
  const feeRows = [['交易手续费', 'transaction'], ['TikTok佣金', 'commission'], ['联盟佣金', 'affiliate'], ['GMV Max', 'gmvmax'], ['物流相关', 'logistics'], ['其他费用', 'other']];
  const u = d.unsettled;
  main.innerHTML = head('利润总览', '净利润 = 已结算收入 − 商品成本 − 广告成本 − 出库/上架等额外费用。未结算订单不当作已赚到的钱。') + `
  <div class="grid g4">
    ${kpi('净利润', money(t.net), `净利润率 ${pct(d.margin)}`, sign(t.net))}
    ${kpi('结算收入', money(t.revenue), `${int(t.orders)} 笔已结算订单`)}
    ${kpi('商品成本', money(t.cost), 'SKU 成本 × 购买数量')}
    ${kpi('广告成本', money(t.ads), '按实际消耗全额扣除')}
  </div>
  <div class="grid g4 sec-gap">
    ${kpi('结算销售订单', int(t.orders), '按订单号与已售订单匹配')}
    ${kpi('销量', int(t.units), '不含结算为 0 的订单')}
    ${kpi('平均每单利润', money(d.avgProfitPerOrder), '净利润 ÷ 结算订单')}
    ${kpi('退款率', pct(d.refundRate), `${int(t.refundOrders)} 个退款/零结算订单`)}
  </div>
  <div class="card sec-gap"><div class="head"><h3>利润结构</h3><small>平台费用已包含在结算金额中，不会重复扣除</small></div>
    <div class="equation">
      <div class="it"><div class="l">结算收入</div><div class="v">${money(t.revenue)}</div></div><div class="op">−</div>
      <div class="it"><div class="l">商品成本</div><div class="v">${money(t.cost)}</div></div><div class="op">−</div>
      <div class="it"><div class="l">广告成本</div><div class="v">${money(t.ads)}</div></div><div class="op">−</div>
      <div class="it"><div class="l">额外费用（出库/上架…）</div><div class="v">${money(t.expenses)}</div></div><div class="op">=</div>
      <div class="it"><div class="l">净利润</div><div class="v ${sign(t.net)}">${money(t.net)}</div></div>
    </div></div>
  <div class="card unsettled sec-gap"><div class="head"><h3>未结算订单预估 <span class="badge warn">不计入净利润</span></h3><small>回款比例按已结算订单历史 ${pct(u.ratio)} 估算</small></div>
    <div class="equation">
      <div class="it"><div class="l">未结算订单</div><div class="v">${int(u.orders)}</div></div>
      <div class="it"><div class="l">订单金额</div><div class="v">${money(u.orderAmount)}</div></div>
      <div class="it"><div class="l">预估回款</div><div class="v">${money(u.estRevenue)}</div></div>
      <div class="it"><div class="l">预估商品成本</div><div class="v">${money(u.estCost)}</div></div>
      <div class="it"><div class="l">预估毛利（未扣广告）</div><div class="v">${money(u.estGross)}</div></div>
      <a class="btn sm" href="#/orders?state=unsettled">查看明细</a>
    </div></div>
  <div class="grid g2 sec-gap">
    <div class="card"><div class="head"><h3>每日利润趋势</h3><small>点击图例可开关</small></div><div id="trend" class="chart"></div></div>
    <div class="card"><div class="head"><h3>平台费用</h3><small>已含在结算金额中</small></div>
      <div class="bars">${feeRows.map(([n, k]) => `<div class="row"><span>${n}</span><span class="bar"><i style="width:${(fee[k] / maxFee) * 100}%"></i></span><span class="amt">${money(fee[k])}</span></div>`).join('')}
      <div class="tot"><span>总费用</span><span>${money(d.feeTotal)}</span></div></div>
      ${Object.keys(d.expenseByCategory).length ? `<h3 style="margin-top:22px">额外费用</h3><div class="bars">${Object.entries(d.expenseByCategory).map(([k, v]) => `<div class="row"><span>${esc(k)}</span><span></span><span class="amt">${money(v)}</span></div>`).join('')}</div>` : ''}
    </div>
  </div>`;
  bindRange(main);
  const dates = d.series.map((x) => x.date);
  chart($('#trend'), {
    color: ['#5f9d86', '#c98a5e', '#264a40'], tooltip: { trigger: 'axis' },
    legend: { bottom: 0 }, grid: { left: 56, right: 20, top: 20, bottom: 50 },
    xAxis: { type: 'category', data: dates, axisLabel: { hideOverlap: true } }, yAxis: { type: 'value', splitLine: { lineStyle: { color: '#eef2f0' } } },
    series: [
      { name: '净利润', type: 'line', smooth: true, showSymbol: false, data: d.series.map((x) => x.net) },
      { name: '广告成本', type: 'line', smooth: true, showSymbol: false, data: d.series.map((x) => x.ads) },
      { name: '结算收入', type: 'line', smooth: true, showSymbol: false, data: d.series.map((x) => x.revenue) },
    ],
  });
};

/* ---------- 商品利润 ---------- */
PAGES.products = async (main) => {
  if (!S.meta.bounds) return noData(main, '商品利润', '');
  const d = await GET('/products' + qs());
  main.innerHTML = head('商品利润', '按 SKU 汇总：结算收入按订单行金额分摊，成本 = 购买数量 × 录入成本。广告与额外费用在总览整体扣除。') + `
  <div class="card"><div class="toolbar"><input id="pq" placeholder="搜索 SKU / 商品名" style="width:240px"><span class="sp"></span>
    <a class="btn" href="/api/products.csv${qs()}">导出 CSV</a></div><div id="ptable"></div></div>`;
  bindRange(main);
  const draw = () => {
    const q = $('#pq').value.trim().toLowerCase();
    const rows = d.rows.filter((r) => !q || (r.sku + ' ' + r.name + ' ' + r.key).toLowerCase().includes(q));
    $('#ptable').innerHTML = rows.length ? `<div class="tablewrap"><table><thead><tr><th>SKU</th><th>商品名</th><th class="n">结算订单</th><th class="n">销量</th><th class="n">结算收入</th><th class="n">商品成本</th><th class="n">毛利</th><th class="n">毛利率</th><th class="n">退款率</th><th class="n">未结算件数</th><th class="n">未结算预估毛利</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${esc(r.sku || r.key)} ${r.missingCost ? '<span class="badge err">缺成本</span>' : ''}</td><td class="wrap">${esc(r.name)}</td><td class="n">${int(r.orders)}</td><td class="n">${int(r.units)}</td><td class="n">${money(r.revenue)}</td><td class="n">${money(r.cost)}</td><td class="n ${sign(r.gross)}">${money(r.gross)}</td><td class="n">${pct(r.margin)}</td><td class="n">${pct(r.refundRate)}</td><td class="n">${int(r.unsettledUnits)}</td><td class="n muted">${money(r.unsettledEstGross)}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">没有匹配的商品</div>';
  };
  $('#pq').addEventListener('input', draw); draw();
};

/* ---------- 订单明细 ---------- */
PAGES.orders = async (main, params) => {
  if (!S.meta.bounds) return noData(main, '订单明细', '');
  const st = { state: params.state || 'all', q: '', page: 1 };
  const tabs = [['all', '全部'], ['settled', '已结算'], ['unsettled', '未结算'], ['zero', '结算为0'], ['refunded', '退款'], ['unmatched', '结算未匹配'], ['missingcost', '缺成本']];
  main.innerHTML = head('订单明细', '已结算订单显示结算收入与成本；未结算订单为预估，不计入净利润。') + `
  <div class="card"><div class="toolbar"><div class="tabs" id="otabs">${tabs.map(([k, n]) => `<button data-s="${k}" class="${k === st.state ? 'on' : ''}">${n}</button>`).join('')}</div>
    <input id="oq" placeholder="订单号 / SKU" style="width:220px"><span class="sp"></span><a class="btn" id="ocsv" href="#">导出 CSV</a></div><div id="otable"></div></div>`;
  bindRange(main);
  const label = (r) => r.state === 'unsettled' ? (r.cancelled ? '<span class="badge">已取消</span>' : '<span class="badge warn">未结算·预估</span>')
    : r.state === 'unmatched' ? '<span class="badge err">结算未匹配</span>' : r.zero ? '<span class="badge info">结算为0</span>' : '<span class="badge ok">已结算</span>';
  const load = async () => {
    const p = { state: st.state, q: st.q, page: st.page };
    $('#ocsv').href = '/api/orders.csv' + qs({ state: st.state, q: st.q });
    const d = await GET('/orders' + qs(p));
    const pages = Math.max(1, Math.ceil(d.total / d.pageSize));
    $('#otable').innerHTML = d.rows.length ? `<div class="tablewrap"><table><thead><tr><th>订单号</th><th>日期</th><th>状态</th><th>SKU × 数量</th><th class="n">订单金额</th><th class="n">结算/预估收入</th><th class="n">商品成本</th><th class="n">毛利</th></tr></thead><tbody>
      ${d.rows.map((r) => `<tr><td>${esc(r.order_id)}</td><td>${esc(r.date)}</td><td>${label(r)}${r.missingCost ? ' <span class="badge err">缺成本</span>' : ''}</td><td class="wrap">${esc(r.skus)}</td><td class="n">${money(r.orderAmount)}</td><td class="n ${r.state === 'unsettled' ? 'muted' : ''}">${money(r.state === 'unsettled' ? r.estRevenue : r.revenue)}</td><td class="n">${money(r.cost)}</td><td class="n ${r.state === 'unsettled' ? 'muted' : sign(r.gross)}">${money(r.gross)}</td></tr>`).join('')}
      </tbody></table></div><div class="pager"><span>共 ${int(d.total)} 笔</span><button class="btn sm" id="pp" ${st.page <= 1 ? 'disabled' : ''}>上一页</button><span>${st.page} / ${pages}</span><button class="btn sm" id="pn" ${st.page >= pages ? 'disabled' : ''}>下一页</button></div>` : '<div class="empty">没有符合条件的订单</div>';
    $('#pp')?.addEventListener('click', () => { st.page--; load(); });
    $('#pn')?.addEventListener('click', () => { st.page++; load(); });
  };
  $$('#otabs button').forEach((b) => b.addEventListener('click', () => { st.state = b.dataset.s; st.page = 1; $$('#otabs button').forEach((x) => x.classList.toggle('on', x === b)); load(); }));
  let tm; $('#oq').addEventListener('input', (e) => { clearTimeout(tm); tm = setTimeout(() => { st.q = e.target.value; st.page = 1; load(); }, 300); });
  load();
};

/* ---------- 售后分析 ---------- */
PAGES.aftersales = async (main) => {
  if (!S.meta.bounds) return noData(main, '售后分析', '');
  const d = await GET('/aftersales' + qs());
  const t = d.totals;
  main.innerHTML = head('售后分析', '退款订单 = 结算金额为 0 或有退款金额的已结算订单（含秒拍秒退）。') + `
  <div class="grid g4">
    ${kpi('退款率', pct(t.refundRate), `${int(t.refundOrders)} / ${int(t.orders)} 笔`)}
    ${kpi('结算为 0 的订单', int(t.zeroOrders), '多为秒拍秒退，广告消耗仍已扣除')}
    ${kpi('零结算订单金额', money(t.zeroOrderAmount), '下单金额，未形成收入')}
    ${kpi('退款金额', money(t.refundAmount), '结算单中的退款')}
  </div>
  <div class="card sec-gap"><div class="head"><h3>每日退款订单</h3></div><div id="rchart" class="chart" style="height:280px"></div></div>
  <div class="card sec-gap"><div class="head"><h3>退款最多的 SKU</h3><a class="btn sm" href="#/orders?state=refunded">查看退款订单</a></div>
    ${d.bySku.length ? `<div class="tablewrap"><table><thead><tr><th>SKU</th><th>商品名</th><th class="n">订单</th><th class="n">退款订单</th><th class="n">退款率</th><th class="n">零结算</th><th class="n">退款金额</th><th class="n">零结算订单金额</th></tr></thead><tbody>
    ${d.bySku.map((r) => `<tr><td>${esc(r.key)}</td><td class="wrap">${esc(r.name)}</td><td class="n">${int(r.orders)}</td><td class="n">${int(r.refundOrders)}</td><td class="n">${pct(r.refundRate)}</td><td class="n">${int(r.zeroOrders)}</td><td class="n">${money(r.refundAmount)}</td><td class="n">${money(r.lostAmount)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">这个范围内没有退款订单</div>'}</div>`;
  bindRange(main);
  chart($('#rchart'), {
    color: ['#c9855a', '#6aa593'], tooltip: { trigger: 'axis' }, legend: { bottom: 0 }, grid: { left: 50, right: 20, top: 16, bottom: 46 },
    xAxis: { type: 'category', data: d.daily.map((x) => x.date), axisLabel: { hideOverlap: true } }, yAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { color: '#eef2f0' } } },
    series: [{ name: '退款订单', type: 'bar', data: d.daily.map((x) => x.refundOrders) }, { name: '结算订单', type: 'line', showSymbol: false, data: d.daily.map((x) => x.orders) }],
  });
};

/* ---------- 广告分析 ---------- */
PAGES.ads = async (main) => {
  if (!S.meta.bounds) return noData(main, '广告分析', '');
  const d = await GET('/ads' + qs());
  const t = d.totals;
  main.innerHTML = head('广告分析', '广告消耗按实际发生金额全额扣除，包括秒拍秒退（结算为 0）订单产生的消耗。') + `
  <div class="grid g4">
    ${kpi('广告消耗', money(t.spend), `占结算收入 ${pct(t.adShare)}`)}
    ${kpi('整体 ROAS', t.roas.toFixed(2), '结算收入 ÷ 广告消耗')}
    ${kpi('点击 / 展示', int(t.clicks) + ' / ' + int(t.impressions), `CTR ${pct(t.ctr, 2)} · CPC ${money(t.cpc)}`)}
    ${kpi('结算为 0 订单', int(t.zeroOrders), `订单金额 ${money(t.zeroOrderAmount)}，推广消耗已计入`)}
  </div>
  <div class="card sec-gap"><div class="head"><h3>每日广告消耗 vs 结算收入</h3></div><div id="achart" class="chart" style="height:300px"></div></div>
  <div class="card sec-gap"><div class="head"><h3>广告计划</h3><small>平台口径成交额仅供参考</small></div>
    ${d.campaigns.length ? `<div class="tablewrap"><table><thead><tr><th>计划</th><th>类型</th><th class="n">消耗</th><th class="n">展示</th><th class="n">点击</th><th class="n">订单</th><th class="n">平台成交额</th><th class="n">平台 ROAS</th></tr></thead><tbody>
    ${d.campaigns.map((c) => `<tr><td class="wrap">${esc(c.campaign)}</td><td>${esc(c.ad_type)}</td><td class="n">${money(c.spend)}</td><td class="n">${int(c.impressions)}</td><td class="n">${int(c.clicks)}</td><td class="n">${int(c.orders)}</td><td class="n">${money(c.revenue)}</td><td class="n">${c.roas ? c.roas.toFixed(2) : '-'}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">这个范围内没有广告数据</div>'}</div>`;
  bindRange(main);
  chart($('#achart'), {
    color: ['#c98a5e', '#264a40'], tooltip: { trigger: 'axis' }, legend: { bottom: 0 }, grid: { left: 56, right: 20, top: 16, bottom: 46 },
    xAxis: { type: 'category', data: d.daily.map((x) => x.date), axisLabel: { hideOverlap: true } }, yAxis: { type: 'value', splitLine: { lineStyle: { color: '#eef2f0' } } },
    series: [{ name: '广告消耗', type: 'bar', data: d.daily.map((x) => x.spend) }, { name: '结算收入', type: 'line', showSymbol: false, smooth: true, data: d.daily.map((x) => x.settledRevenue) }],
  });
};

/* ---------- 数据核对 ---------- */
PAGES.check = async (main) => {
  const d = await GET('/check' + qs());
  const c = d.counts;
  const badge = { error: ['err', '必须处理'], warn: ['warn', '建议处理'], info: ['info', '说明'], ok: ['ok', '正常'] };
  main.innerHTML = head('数据核对', '导入后先看这里：成本是否齐全、订单是否匹配、有没有重复扣除。') + `
  <div class="grid g4">
    ${kpi('已售订单', int(c.soldOrders), '范围内按下单日期')}
    ${kpi('已结算订单', int(c.settledOrders), `匹配成功 ${int(c.matched)}`)}
    ${kpi('未结算订单', int(c.unsettled), '只预估，不计入利润')}
    ${kpi('缺成本 SKU', int(c.missingCostSkus), '按 0 成本计算，利润会偏高', c.missingCostSkus ? 'neg' : '')}
  </div>
  <div class="sec-gap">${d.items.map((i) => `<div class="chk"><span class="badge ${badge[i.level][0]}" style="height:fit-content">${badge[i.level][1]}</span><div style="flex:1"><div class="t">${esc(i.title)}</div>${i.detail ? `<div class="d">${esc(i.detail)}</div>` : ''}
    ${i.list ? `<ul>${i.list.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</div>${i.link ? `<a class="btn sm" href="${esc(i.link)}" style="height:fit-content">去处理</a>` : ''}</div>`).join('')}</div>
  ${d.unmatchedSample.length ? `<div class="card sec-gap"><div class="head"><h3>未匹配的结算订单（前 30 笔）</h3></div><div class="tablewrap"><table><thead><tr><th>订单号</th><th>结算日期</th><th class="n">结算金额</th></tr></thead><tbody>${d.unmatchedSample.map((r) => `<tr><td>${esc(r.order_id)}</td><td>${esc(r.settle_date)}</td><td class="n">${money(r.revenue)}</td></tr>`).join('')}</tbody></table></div></div>` : ''}`;
  bindRange(main);
};

window.addEventListener('load', boot);
