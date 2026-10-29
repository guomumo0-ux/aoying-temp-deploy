'use strict';
/* 导入 / 成本 / 设置页面 */

const TEMPLATES = {
  orders: ['订单号', 'SKU', '商品名称', '购买数量', '订单金额', '下单时间', '订单状态', '币种'],
  settlements: ['订单号', '结算时间', '结算金额', '交易手续费', 'TikTok佣金', '联盟佣金', 'GMV Max', '物流费', '其他费用', '退款金额', '币种'],
  costs: ['SKU', '商品名称', '单件成本', '币种', '备注'],
  ads: ['日期', '广告系列', '广告类型', '消耗', '展示', '点击', '订单数', '成交金额', '币种'],
  expenses: ['日期', '费用类别', '金额', '备注', '币种'],
};
const TYPE_HINT = {
  orders: '平台导出的订单列表：订单号、SKU、数量、金额、下单时间',
  settlements: '平台导出的结算明细：订单号、结算时间、结算金额、各项费用',
  costs: 'SKU 对应的单件成本（也可在「商品成本」页逐个录入）',
  ads: '广告后台导出的每日消耗，含 GMV Max 等',
  expenses: '出库费、上架费、仓储费等不在结算单里的费用',
};

function downloadTemplate(type) {
  const csv = '﻿' + TEMPLATES[type].join(',') + '\n';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `模板-${Mapping.SCHEMAS[type].label}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

async function readSheet(file) {
  const buf = await file.arrayBuffer();
  const isCsv = /\.(csv|txt|tsv)$/i.test(file.name);
  let wb;
  if (isCsv) {
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { text = new TextDecoder('gbk').decode(buf); }
    wb = XLSX.read(text, { type: 'string', raw: true }); // raw: 订单号等长数字保持原样
  } else {
    wb = XLSX.read(buf, { type: 'array', cellDates: false });
  }
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: isCsv, defval: '', dateNF: 'yyyy-mm-dd hh:mm:ss', blankrows: false });
}

PAGES.import = async (main) => {
  const st = { type: 'orders', file: null, rows: null, hIdx: 0, headers: [], mapping: {}, currency: S.meta.defaultCurrency || 'CNY' };
  const logs = await GET('/import-log');
  const exps = await GET('/expenses');
  const isAdmin = S.user.role === 'admin';
  const S2 = Mapping.SCHEMAS;
  main.innerHTML = head('数据导入', '支持 Excel（.xlsx）和 CSV。重复导入同一订单会覆盖，不会叠加。', false) + `
  <div class="types" id="types">${Object.keys(S2).map((k) => `<button data-t="${k}"><b>${S2[k].label}</b><small>${TYPE_HINT[k]}</small></button>`).join('')}</div>
  <div class="card"><div class="head"><h3 id="stepTitle"></h3><a href="#" id="tpl" class="link">下载 CSV 模板</a></div>
    <div id="dz" class="dropzone">把文件拖到这里，或点击选择文件<input type="file" id="file" accept=".xlsx,.xls,.csv,.txt" class="hidden"></div>
    <div id="mapBox"></div></div>
  <div class="card sec-gap"><div class="head"><h3>手动录入额外费用</h3><small>出库费、上架费等不在结算单里的费用，会从净利润中扣除</small></div>
    <form class="form" id="expForm"><input type="date" name="date" required value="${S.to}"><input name="category" placeholder="类别，如 出库费" list="cats" required><datalist id="cats"><option>出库费</option><option>上架费</option><option>仓储费</option><option>退货处理费</option></datalist>
    <input type="number" step="0.01" name="amount" placeholder="金额" required style="width:110px"><select name="currency">${S.meta.currencies.map((c) => `<option ${c === 'CNY' ? 'selected' : ''}>${c}</option>`).join('')}</select><input name="note" placeholder="备注（可选）"><button class="btn primary">添加</button></form>
    <div id="expList" class="sec-gap"></div></div>
  <div class="card sec-gap"><div class="head"><h3>导入记录</h3>${isAdmin ? '<small>管理员可清空某类数据</small>' : ''}</div>
    ${logs.length ? `<div class="tablewrap"><table><thead><tr><th>时间</th><th>类型</th><th>文件</th><th class="n">成功</th><th class="n">跳过</th><th>操作人</th></tr></thead><tbody>${logs.map((l) => `<tr><td>${esc(l.created_at)}</td><td>${esc(S2[l.type]?.label || l.type)}</td><td class="wrap">${esc(l.filename)}</td><td class="n">${int(l.rows_ok)}</td><td class="n">${int(l.rows_skipped)}</td><td>${esc(l.user_name)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">还没有导入记录</div>'}
    ${isAdmin ? `<div class="toolbar sec-gap"><span class="muted">清空数据：</span>${Object.keys(S2).map((k) => `<button class="btn sm danger" data-clear="${k}">${S2[k].label}</button>`).join('')}</div>` : ''}</div>`;

  const renderExp = () => {
    $('#expList').innerHTML = exps.length ? `<div class="tablewrap" style="max-height:260px"><table><thead><tr><th>日期</th><th>类别</th><th class="n">金额</th><th>备注</th><th>录入人</th><th></th></tr></thead><tbody>${exps.map((e) => `<tr><td>${esc(e.date)}</td><td>${esc(e.category)}</td><td class="n">${esc(e.amount)} ${esc(e.currency)}</td><td class="wrap">${esc(e.note)}</td><td>${esc(e.created_by)}</td><td><button class="btn sm danger" data-del="${e.id}">删除</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="muted">暂无额外费用</div>';
    $$('[data-del]').forEach((b) => b.addEventListener('click', async () => { if (!confirm('删除这条费用？')) return; await api('DELETE', '/expenses/' + b.dataset.del); toast('已删除'); route(); }));
  };
  renderExp();
  $('#expForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('POST', '/expenses', Object.fromEntries(new FormData(e.target))); toast('已添加'); route(); } catch (err) { toast(err.message, true); }
  });
  $$('[data-clear]').forEach((b) => b.addEventListener('click', async () => {
    const n = S2[b.dataset.clear].label;
    if (!confirm(`确定清空全部「${n}」数据？此操作不能撤销。`)) return;
    await api('DELETE', '/data/' + b.dataset.clear); toast('已清空'); await refreshMeta(); route();
  }));

  const setType = (t) => {
    st.type = t; st.rows = null; st.file = null;
    $$('#types button').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
    $('#stepTitle').textContent = '导入' + S2[t].label;
    $('#mapBox').innerHTML = ''; $('#dz').classList.remove('hidden');
    const h = $('#dz'); h.firstChild.textContent = '把文件拖到这里，或点击选择文件';
  };
  $$('#types button').forEach((b) => b.addEventListener('click', () => setType(b.dataset.t)));
  $('#tpl').addEventListener('click', (e) => { e.preventDefault(); downloadTemplate(st.type); });
  const dz = $('#dz');
  dz.addEventListener('click', () => $('#file').click());
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('over'); if (e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]); });
  $('#file').addEventListener('click', (e) => e.stopPropagation());
  $('#file').addEventListener('change', (e) => { if (e.target.files[0]) onFile(e.target.files[0]); e.target.value = ''; });

  async function onFile(file) {
    try {
      dz.firstChild.textContent = '正在读取 ' + file.name + ' …';
      st.rows = await readSheet(file); st.file = file;
      if (!st.rows.length) throw new Error('文件是空的');
      // 如果文件内容更像别的类型，提示切换
      const guess = Mapping.detectType((st.rows[Mapping.detectHeaderRow(st.rows, st.type)] || []).map(String));
      if (guess && guess !== st.type && confirm(`这个文件看起来是「${S2[guess].label}」，要切换过去吗？`)) setType(guess), st.rows = await readSheet(file), st.file = file;
      st.hIdx = Mapping.detectHeaderRow(st.rows, st.type);
      remap(); dz.firstChild.textContent = '已读取：' + file.name + '（点击重新选择）';
    } catch (err) { toast('读取失败：' + err.message, true); dz.firstChild.textContent = '把文件拖到这里，或点击选择文件'; }
  }
  function remap() {
    st.headers = (st.rows[st.hIdx] || []).map((h) => String(h ?? '').trim());
    st.mapping = Mapping.autoMap(st.headers, st.type);
    renderMap();
  }
  function colSelect(key, idx, val) {
    return `<select data-k="${key}" data-i="${idx}"><option value="">— 不导入 —</option>${st.headers.map((h, i) => `<option value="${i}" ${val === i ? 'selected' : ''}>${esc(h || '(空列 ' + (i + 1) + ')')}</option>`).join('')}</select>`;
  }
  function renderMap() {
    const fields = S2[st.type].fields;
    const data = st.rows.slice(st.hIdx + 1);
    const missing = Mapping.missingRequired(st.mapping, st.type);
    const sample = Mapping.applyMapping(data.slice(0, 4), st.mapping, st.type);
    const keys = Object.keys(fields).filter((k) => (st.mapping[k] || []).length);
    $('#mapBox').innerHTML = `
    <div class="sec-gap note">共 ${int(data.length)} 行。表头在第 <input type="number" id="hrow" min="1" max="15" value="${st.hIdx + 1}" style="width:60px"> 行，请核对下面的列对应关系（已自动识别）。</div>
    <div class="sec-gap">${Object.entries(fields).map(([k, f]) => {
      const cols = st.mapping[k] && st.mapping[k].length ? st.mapping[k] : [null];
      return `<div class="maprow"><div>${f.label}${f.required ? ' <span class="req">*</span>' : ''}</div><div class="cols">${cols.map((c, i) => colSelect(k, i, c)).join('')}${f.multi ? `<button class="btn sm" data-add="${k}">+ 列求和</button>` : ''}</div></div>`;
    }).join('')}</div>
    <div class="form sec-gap"><label>数据里没有币种列时，按此币种：<select id="cur">${S.meta.currencies.map((c) => `<option ${c === st.currency ? 'selected' : ''}>${c}</option>`).join('')}</select></label></div>
    ${sample.length ? `<div class="sec-gap tablewrap" style="max-height:200px"><table><thead><tr>${keys.map((k) => `<th>${fields[k].label}</th>`).join('')}</tr></thead><tbody>${sample.map((r) => `<tr>${keys.map((k) => `<td>${esc(r[k])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : ''}
    <div class="toolbar sec-gap"><button class="btn primary" id="go" ${missing.length ? 'disabled' : ''}>开始导入 ${int(data.length)} 行</button>${missing.length ? `<span class="err" style="min-height:0">还差必填列：${missing.join('、')}</span>` : ''}<span id="res"></span></div>`;
    $('#hrow').addEventListener('change', (e) => { st.hIdx = Math.max(0, Math.min(14, Number(e.target.value) - 1)); remap(); });
    $('#cur').addEventListener('change', (e) => { st.currency = e.target.value; });
    $$('#mapBox select[data-k]').forEach((s) => s.addEventListener('change', () => {
      const k = s.dataset.k, i = Number(s.dataset.i);
      const arr = (st.mapping[k] || []).slice();
      if (s.value === '') arr.splice(i, 1); else arr[i] = Number(s.value);
      st.mapping[k] = arr.filter((x) => x !== undefined); renderMap();
    }));
    $$('[data-add]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.add;
      const first = st.headers.findIndex((_, i) => !(st.mapping[k] || []).includes(i));
      st.mapping[k] = [...(st.mapping[k] || []), first]; renderMap();
    }));
    $('#go')?.addEventListener('click', doImport);
  }
  async function doImport() {
    const btn = $('#go'); btn.disabled = true; btn.textContent = '导入中，请稍候…';
    try {
      const data = Mapping.applyMapping(st.rows.slice(st.hIdx + 1), st.mapping, st.type);
      const r = await api('POST', '/import/' + st.type, { rows: data, defaultCurrency: st.currency, filename: st.file.name });
      let msg = `导入完成：成功 ${int(r.ok)} 条` + (r.skipped ? `，跳过 ${int(r.skipped)} 行` : '');
      toast(msg);
      $('#res').innerHTML = `<span class="pos">${esc(msg)}</span>` + (r.errors.length ? `<div class="muted">跳过原因示例：${r.errors.slice(0, 5).map((e) => `第${e.row}行 ${esc(e.reason)}`).join('；')}</div>` : '') + ' <a href="#/check">去数据核对看看 →</a>';
      await refreshMeta();
      btn.textContent = '已导入';
    } catch (err) { toast(err.message, true); btn.disabled = false; btn.textContent = '重试导入'; }
  }
  setType('orders');
};

/* ---------- 商品成本 ---------- */
PAGES.costs = async (main, params) => {
  const d = await GET('/costs');
  const st = { tab: params.missing ? 'missing' : 'have', q: '' };
  main.innerHTML = head('商品成本', '成本按 SKU 录入（单件、人民币或其他币种）。SKU 成本优先；没有 SKU 成本时才用商品名默认成本。', false) + `
  <div class="card"><div class="toolbar"><div class="tabs" id="ctabs"><button data-t="missing">待录入 (${d.missing.length})</button><button data-t="have">已录入 (${d.costs.length})</button><button data-t="add">新增</button></div>
    <input id="cq" placeholder="搜索 SKU / 商品名" style="width:220px"><span class="sp"></span><a class="btn" href="#/import">批量导入成本</a></div><div id="cbody"></div></div>`;
  const cur = S.meta.currencies;
  const curSel = (v = 'CNY') => `<select class="cc">${cur.map((c) => `<option ${c === v ? 'selected' : ''}>${c}</option>`).join('')}</select>`;
  const draw = () => {
    $$('#ctabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === st.tab));
    const q = st.q.toLowerCase();
    const box = $('#cbody');
    if (st.tab === 'add') {
      box.innerHTML = `<form class="form" id="addF"><select name="kind"><option value="sku">按 SKU</option><option value="product">按商品名（默认成本）</option></select><input name="key" placeholder="SKU 或商品名" required><input name="cost" type="number" step="0.01" min="0" placeholder="单件成本" required style="width:120px"><select name="currency">${cur.map((c) => `<option>${c}</option>`).join('')}</select><input name="note" placeholder="备注"><button class="btn primary">保存</button></form>`;
      $('#addF').addEventListener('submit', async (e) => { e.preventDefault(); const o = Object.fromEntries(new FormData(e.target)); try { await api('PUT', '/costs', o); toast('已保存'); route(); } catch (er) { toast(er.message, true); } });
      return;
    }
    if (st.tab === 'missing') {
      const rows = d.missing.filter((r) => !q || (r.sku + r.name).toLowerCase().includes(q)).slice(0, 300);
      box.innerHTML = rows.length ? `<div class="note" style="margin-bottom:12px">下面这些 SKU 在订单里出现过，但还没有成本。填完按回车或点保存。</div><div class="tablewrap"><table><thead><tr><th>SKU</th><th>商品名</th><th class="n">销量</th><th>单件成本</th><th>币种</th><th></th></tr></thead><tbody>
      ${rows.map((r, i) => `<tr data-i="${i}"><td>${esc(r.sku || '—')}</td><td class="wrap">${esc(r.name)}</td><td class="n">${int(r.units)}</td><td><input type="number" step="0.01" min="0" class="cv" style="width:110px"></td><td>${curSel()}</td><td><button class="btn sm primary sv">保存</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">🎉 所有 SKU 都已录入成本</div>';
      $$('#cbody tr[data-i]').forEach((tr) => {
        const r = rows[Number(tr.dataset.i)];
        const save = async () => {
          const v = $('.cv', tr).value; if (v === '') return;
          try { await api('PUT', '/costs', { kind: r.sku ? 'sku' : 'product', key: r.sku || r.name, cost: v, currency: $('.cc', tr).value }); toast('已保存'); route(); } catch (er) { toast(er.message, true); }
        };
        $('.sv', tr).addEventListener('click', save);
        $('.cv', tr).addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
      });
      return;
    }
    const rows = d.costs.filter((r) => !q || (r.key + r.note).toLowerCase().includes(q));
    box.innerHTML = rows.length ? `<div class="tablewrap"><table><thead><tr><th>类型</th><th>SKU / 商品名</th><th>单件成本</th><th>币种</th><th>备注</th><th>更新</th><th></th></tr></thead><tbody>
    ${rows.map((r, i) => `<tr data-i="${i}"><td><span class="badge">${r.kind === 'sku' ? 'SKU' : '商品名'}</span></td><td class="wrap">${esc(r.key)}</td><td><input type="number" step="0.01" min="0" class="cv" value="${r.cost}" style="width:110px"></td><td>${curSel(r.currency)}</td><td class="wrap">${esc(r.note)}</td><td class="muted">${esc(r.updated_by)} ${esc(r.updated_at)}</td><td><button class="btn sm sv">保存</button> <button class="btn sm danger dl">删除</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">还没有录入成本</div>';
    $$('#cbody tr[data-i]').forEach((tr) => {
      const r = rows[Number(tr.dataset.i)];
      $('.sv', tr).addEventListener('click', async () => { try { await api('PUT', '/costs', { kind: r.kind, key: r.key, cost: $('.cv', tr).value, currency: $('.cc', tr).value, note: r.note }); toast('已保存'); route(); } catch (er) { toast(er.message, true); } });
      $('.dl', tr).addEventListener('click', async () => { if (!confirm('删除这条成本？')) return; await api('DELETE', `/costs?kind=${r.kind}&key=${encodeURIComponent(r.key)}`); route(); });
    });
  };
  $$('#ctabs button').forEach((b) => b.addEventListener('click', () => { st.tab = b.dataset.t; draw(); }));
  $('#cq').addEventListener('input', (e) => { st.q = e.target.value; draw(); });
  draw();
};

/* ---------- 设置 ---------- */
PAGES.settings = async (main) => {
  const s = await GET('/settings');
  const admin = S.user.role === 'admin';
  const users = admin ? await GET('/users') : [];
  main.innerHTML = head('设置', '汇率、口径开关、团队成员。', false) + `
  <div class="card"><div class="head"><h3>汇率（折算为人民币）</h3>${admin ? '' : '<small>仅管理员可修改</small>'}</div>
    <div class="form" id="fx">${Object.entries(s.fx).map(([k, v]) => `<label>${k} <input type="number" step="any" min="0" data-c="${k}" value="${v}" style="width:100px" ${k === 'CNY' || !admin ? 'disabled' : ''}></label>`).join('')}
    ${admin ? '<input id="newCur" placeholder="新增币种 如 JPY" style="width:130px"><button class="btn sm" id="addCur">添加</button>' : ''}</div></div>
  <div class="card sec-gap"><div class="head"><h3>计算口径</h3></div>
    <label class="form"><input type="checkbox" id="o1" ${s.count_cost_for_refunded ? 'checked' : ''} ${admin ? '' : 'disabled'}> 结算为 0 的订单（秒拍秒退/退款）也计入商品成本 <small class="muted">默认不计：货没发或已退回</small></label>
    <label class="form sec-gap"><input type="checkbox" id="o2" ${s.exclude_gmvmax_ads ? 'checked' : ''} ${admin ? '' : 'disabled'}> 广告成本剔除 GMV Max <small class="muted">仅当结算金额里已经扣过 GMV Max 费用时开启，避免重复扣</small></label>
    <label class="form sec-gap">无历史数据时，未结算订单预估回款比例 <input type="number" step="0.01" min="0" max="1" id="o3" value="${s.unsettled_ratio_fallback}" style="width:90px" ${admin ? '' : 'disabled'}></label>
    <label class="form sec-gap">导入时默认币种 <select id="o4" ${admin ? '' : 'disabled'}>${Object.keys(s.fx).map((c) => `<option ${c === s.default_currency ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
    ${admin ? '<div class="sec-gap"><button class="btn primary" id="saveS">保存设置</button></div>' : ''}</div>
  ${admin ? `<div class="card sec-gap"><div class="head"><h3>团队成员</h3><small>成员可导入数据、录入成本；管理员可管理成员、设置和清空数据</small></div>
    <div class="tablewrap" style="max-height:none"><table><thead><tr><th>姓名</th><th>邮箱</th><th>角色</th><th>状态</th><th></th></tr></thead><tbody>${users.map((u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${u.role === 'admin' ? '管理员' : '成员'}</td><td>${u.disabled ? '<span class="badge err">已停用</span>' : '<span class="badge ok">正常</span>'}</td>
    <td><button class="btn sm" data-role="${u.id}|${u.role === 'admin' ? 'member' : 'admin'}">设为${u.role === 'admin' ? '成员' : '管理员'}</button> <button class="btn sm" data-pw="${u.id}">重置密码</button> <button class="btn sm danger" data-dis="${u.id}|${u.disabled ? 0 : 1}">${u.disabled ? '启用' : '停用'}</button></td></tr>`).join('')}</tbody></table></div>
    <form class="form sec-gap" id="newUser"><input name="name" placeholder="姓名" required><input name="email" type="email" placeholder="邮箱" required><input name="password" type="password" minlength="8" placeholder="初始密码（至少8位）" required><select name="role"><option value="member">成员</option><option value="admin">管理员</option></select><button class="btn primary">添加成员</button></form></div>` : ''}
  <div class="card sec-gap"><div class="head"><h3>修改我的密码</h3></div><form class="form" id="pwForm"><input type="password" name="oldPassword" placeholder="原密码" required><input type="password" name="newPassword" minlength="8" placeholder="新密码（至少8位）" required><button class="btn">修改</button></form></div>`;
  const fail = (e) => toast(e.message, true);
  $('#pwForm').addEventListener('submit', async (e) => { e.preventDefault(); try { await api('POST', '/me/password', Object.fromEntries(new FormData(e.target))); toast('密码已修改'); e.target.reset(); } catch (er) { fail(er); } });
  if (!admin) return;
  $('#addCur').addEventListener('click', () => {
    const c = $('#newCur').value.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(c) || s.fx[c]) return toast('请输入 3 位币种代码', true);
    $('#fx').insertAdjacentHTML('afterbegin', `<label>${c} <input type="number" step="any" min="0" data-c="${c}" value="1" style="width:100px"></label>`);
    $('#newCur').value = '';
  });
  $('#saveS').addEventListener('click', async () => {
    const fx = {}; $$('#fx input[data-c]').forEach((i) => { fx[i.dataset.c] = Number(i.value); });
    try {
      await api('PUT', '/settings', { fx, count_cost_for_refunded: $('#o1').checked, exclude_gmvmax_ads: $('#o2').checked, unsettled_ratio_fallback: Number($('#o3').value), default_currency: $('#o4').value });
      toast('已保存'); await refreshMeta();
    } catch (er) { fail(er); }
  });
  $('#newUser').addEventListener('submit', async (e) => { e.preventDefault(); try { await api('POST', '/users', Object.fromEntries(new FormData(e.target))); toast('已添加'); route(); } catch (er) { fail(er); } });
  const patch = async (id, body) => { try { await api('PATCH', '/users/' + id, body); toast('已更新'); route(); } catch (er) { fail(er); } };
  $$('[data-role]').forEach((b) => b.addEventListener('click', () => { const [id, role] = b.dataset.role.split('|'); patch(id, { role }); }));
  $$('[data-dis]').forEach((b) => b.addEventListener('click', () => { const [id, v] = b.dataset.dis.split('|'); patch(id, { disabled: v === '1' }); }));
  $$('[data-pw]').forEach((b) => b.addEventListener('click', () => { const p = prompt('输入新密码（至少 8 位）'); if (p) patch(b.dataset.pw, { password: p }); }));
};
