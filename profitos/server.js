'use strict';
const path = require('node:path');
const express = require('express');
const { openDb, tx, getSettings, saveSettings } = require('./lib/db');
const auth = require('./lib/auth');
const { importRows, TYPES } = require('./lib/importer');
const P = require('./lib/profit');

function createApp(db, opts = {}) {
  const app = express();
  const secureCookie = opts.secureCookie ?? process.env.COOKIE_SECURE === '1';
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'");
    next();
  });
  app.use(express.json({ limit: '120mb' }));

  // ---- 模型缓存：任何写入后失效 ----
  let version = 0;
  let cache = { version: -1, model: null };
  const bump = () => { version++; };
  const model = () => {
    if (cache.version !== version) {
      const data = {
        settings: getSettings(db),
        orders: db.prepare('SELECT * FROM orders').all(),
        settlements: db.prepare('SELECT * FROM settlements').all(),
        costs: db.prepare('SELECT * FROM costs').all(),
        ads: db.prepare('SELECT * FROM ads').all(),
        expenses: db.prepare('SELECT * FROM expenses').all(),
      };
      cache = { version, model: P.buildModel(data) };
    }
    return cache.model;
  };

  const api = express.Router();
  const wrap = (fn) => (req, res) => {
    try { fn(req, res); } catch (e) {
      console.error(e);
      res.status(500).json({ error: '服务器出错：' + e.message });
    }
  };
  const ymd = /^\d{4}-\d{2}-\d{2}$/;
  const range = (req) => {
    const m = model();
    let from = String(req.query.from || ''), to = String(req.query.to || '');
    if (!ymd.test(from)) from = m.bounds ? m.bounds.from : new Date().toISOString().slice(0, 10);
    if (!ymd.test(to)) to = m.bounds ? m.bounds.to : from;
    if (from > to) [from, to] = [to, from];
    return { m, from, to };
  };

  // ---- 认证 ----
  api.get('/auth/status', wrap((req, res) => {
    const n = db.prepare('SELECT COUNT(*) c FROM users').get().c;
    res.json({ needsSetup: n === 0 });
  }));
  api.post('/auth/setup', wrap((req, res) => {
    if (db.prepare('SELECT COUNT(*) c FROM users').get().c > 0) return res.status(403).json({ error: '已初始化' });
    const { email, name, password } = req.body || {};
    const err = validateUser(email, name, password);
    if (err) return res.status(400).json({ error: err });
    const r = db.prepare('INSERT INTO users(email,name,role,pass_hash) VALUES(?,?,?,?)').run(email.trim().toLowerCase(), name.trim(), 'admin', auth.hashPassword(password));
    auth.setCookie(res, auth.createSession(db, Number(r.lastInsertRowid)), secureCookie || req.secure);
    res.json({ ok: true });
  }));
  api.post('/auth/login', wrap((req, res) => {
    const { email = '', password = '' } = req.body || {};
    const key = req.ip + '|' + String(email).toLowerCase();
    if (auth.tooManyFails(key)) return res.status(429).json({ error: '尝试次数过多，请 15 分钟后再试' });
    const u = db.prepare('SELECT * FROM users WHERE email=? AND disabled=0').get(String(email).trim().toLowerCase());
    if (!u || !auth.verifyPassword(String(password), u.pass_hash)) {
      auth.recordFail(key);
      return res.status(401).json({ error: '邮箱或密码不对' });
    }
    auth.clearFails(key);
    auth.setCookie(res, auth.createSession(db, u.id), secureCookie || req.secure);
    res.json({ ok: true });
  }));
  api.post('/auth/logout', wrap((req, res) => {
    const t = auth.readCookie(req, auth.COOKIE);
    if (t) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(auth.sha(t));
    auth.clearCookie(res);
    res.json({ ok: true });
  }));

  api.use((req, res, next) => {
    const u = auth.userFromRequest(db, req);
    if (!u) return res.status(401).json({ error: '请先登录' });
    req.user = u;
    next();
  });
  const adminOnly = (req, res, next) => (req.user.role === 'admin' ? next() : res.status(403).json({ error: '需要管理员权限' }));

  api.get('/me', wrap((req, res) => res.json(req.user)));
  api.post('/me/password', wrap((req, res) => {
    const { oldPassword = '', newPassword = '' } = req.body || {};
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    if (!auth.verifyPassword(String(oldPassword), u.pass_hash)) return res.status(400).json({ error: '原密码不对' });
    if (String(newPassword).length < 8) return res.status(400).json({ error: '新密码至少 8 位' });
    db.prepare('UPDATE users SET pass_hash=? WHERE id=?').run(auth.hashPassword(newPassword), u.id);
    res.json({ ok: true });
  }));

  // ---- 用户管理 ----
  function validateUser(email, name, password) {
    if (!/^\S+@\S+\.\S+$/.test(String(email || ''))) return '邮箱格式不对';
    if (!String(name || '').trim()) return '请填写姓名';
    if (String(password || '').length < 8) return '密码至少 8 位';
    return null;
  }
  api.get('/users', adminOnly, wrap((req, res) => {
    res.json(db.prepare('SELECT id,email,name,role,disabled,created_at FROM users ORDER BY id').all());
  }));
  api.post('/users', adminOnly, wrap((req, res) => {
    const { email, name, password, role } = req.body || {};
    const err = validateUser(email, name, password);
    if (err) return res.status(400).json({ error: err });
    try {
      db.prepare('INSERT INTO users(email,name,role,pass_hash) VALUES(?,?,?,?)')
        .run(email.trim().toLowerCase(), name.trim(), role === 'admin' ? 'admin' : 'member', auth.hashPassword(password));
    } catch { return res.status(400).json({ error: '这个邮箱已存在' }); }
    res.json({ ok: true });
  }));
  api.patch('/users/:id', adminOnly, wrap((req, res) => {
    const id = Number(req.params.id);
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(id);
    if (!u) return res.status(404).json({ error: '用户不存在' });
    const { role, disabled, password, name } = req.body || {};
    const admins = db.prepare("SELECT COUNT(*) c FROM users WHERE role='admin' AND disabled=0").get().c;
    const losesAdmin = u.role === 'admin' && !u.disabled && ((role && role !== 'admin') || disabled);
    if (losesAdmin && admins <= 1) return res.status(400).json({ error: '至少保留一个可用的管理员' });
    if (role) db.prepare('UPDATE users SET role=? WHERE id=?').run(role === 'admin' ? 'admin' : 'member', id);
    if (name) db.prepare('UPDATE users SET name=? WHERE id=?').run(String(name).trim(), id);
    if (disabled !== undefined) {
      db.prepare('UPDATE users SET disabled=? WHERE id=?').run(disabled ? 1 : 0, id);
      if (disabled) db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
    }
    if (password) {
      if (String(password).length < 8) return res.status(400).json({ error: '密码至少 8 位' });
      db.prepare('UPDATE users SET pass_hash=? WHERE id=?').run(auth.hashPassword(password), id);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
    }
    res.json({ ok: true });
  }));

  // ---- 设置 ----
  api.get('/settings', wrap((req, res) => res.json(getSettings(db))));
  api.put('/settings', adminOnly, wrap((req, res) => {
    const b = req.body || {};
    if (b.fx) {
      const fx = {};
      for (const [k, v] of Object.entries(b.fx)) {
        const n = Number(v);
        if (/^[A-Z]{3}$/.test(k) && n > 0 && Number.isFinite(n)) fx[k] = n;
      }
      b.fx = fx;
    }
    saveSettings(db, b);
    bump();
    res.json(getSettings(db));
  }));

  // ---- 分析 ----
  api.get('/meta', wrap((req, res) => {
    const m = model();
    const count = (t) => db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
    res.json({
      bounds: m.bounds,
      counts: { orders: count('orders'), settlements: count('settlements'), costs: count('costs'), ads: count('ads'), expenses: count('expenses') },
      currencies: Object.keys(m.settings.fx),
      defaultCurrency: m.settings.default_currency,
    });
  }));
  api.get('/overview', wrap((req, res) => { const { m, from, to } = range(req); res.json({ from, to, ...P.summary(m, from, to) }); }));
  api.get('/products', wrap((req, res) => { const { m, from, to } = range(req); res.json({ from, to, rows: P.products(m, from, to) }); }));
  api.get('/aftersales', wrap((req, res) => { const { m, from, to } = range(req); res.json({ from, to, ...P.aftersales(m, from, to) }); }));
  api.get('/ads', wrap((req, res) => { const { m, from, to } = range(req); res.json({ from, to, ...P.adsReport(m, from, to) }); }));
  api.get('/check', wrap((req, res) => { const { m, from, to } = range(req); res.json({ from, to, ...P.check(m, from, to) }); }));
  api.get('/orders', wrap((req, res) => {
    const { m, from, to } = range(req);
    const r = P.orderList(m, from, to, { state: String(req.query.state || 'all'), q: String(req.query.q || ''), page: Math.max(1, Number(req.query.page) || 1) });
    delete r.all;
    res.json({ from, to, ...r });
  }));
  api.get('/orders.csv', wrap((req, res) => {
    const { m, from, to } = range(req);
    const r = P.orderList(m, from, to, { state: String(req.query.state || 'all'), q: String(req.query.q || ''), page: 1, pageSize: 1e9 });
    const stateName = (x) => (x.state === 'unsettled' ? '未结算' : x.state === 'unmatched' ? '结算未匹配' : x.zero ? '结算为0' : '已结算');
    const head = ['订单号', '日期', '状态', 'SKU×数量', '订单金额(CNY)', '结算收入(CNY)', '商品成本(CNY)', '毛利(CNY)'];
    const lines = [head.join(',')];
    for (const o of r.all) {
      const unset = o.state === 'unsettled';
      const cells = [o.order_id, o.date, stateName(o), o.lines.map((l) => `${l.sku || l.name}×${l.qty}`).join('；'),
        o.orderAmount.toFixed(2), unset ? (o.estRevenue || 0).toFixed(2) + '(预估)' : o.revenue.toFixed(2),
        (unset ? o.estCost : o.cost).toFixed(2), (unset ? o.estRevenue - o.estCost : o.revenue - o.cost).toFixed(2)];
      lines.push(cells.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="orders.csv"');
    res.send('﻿' + lines.join('\n'));
  }));
  api.get('/products.csv', wrap((req, res) => {
    const { m, from, to } = range(req);
    const rows = P.products(m, from, to);
    const lines = [['SKU', '商品名', '结算订单', '销量', '结算收入', '商品成本', '毛利', '毛利率', '退款订单', '退款率', '未结算件数'].join(',')];
    for (const p of rows) {
      lines.push([p.sku, p.name, p.orders, p.units, p.revenue, p.cost, p.gross, (p.margin * 100).toFixed(1) + '%', p.refundOrders, (p.refundRate * 100).toFixed(1) + '%', p.unsettledUnits]
        .map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="products.csv"');
    res.send('﻿' + lines.join('\n'));
  }));

  // ---- 成本 ----
  api.get('/costs', wrap((req, res) => {
    const m = model();
    const costs = db.prepare('SELECT * FROM costs ORDER BY kind, key').all();
    const have = new Set(costs.filter((c) => c.kind === 'sku').map((c) => c.key));
    const haveProd = new Set(costs.filter((c) => c.kind === 'product').map((c) => c.key));
    const seen = new Map();
    for (const r of m.rows) {
      for (const l of r.lines) {
        if (!l.sku && !l.name) continue;
        const k = l.sku || l.name;
        const e = seen.get(k) || { sku: l.sku, name: l.name, units: 0 };
        e.units += l.qty; seen.set(k, e);
      }
    }
    const missing = [...seen.values()].filter((e) => !(e.sku && have.has(e.sku)) && !(e.name && haveProd.has(e.name))).sort((a, b) => b.units - a.units);
    res.json({ costs, missing, knownSkus: [...seen.values()].length });
  }));
  api.put('/costs', wrap((req, res) => {
    const { kind, key, cost, currency, note } = req.body || {};
    const c = Number(cost);
    if (!['sku', 'product'].includes(kind) || !String(key || '').trim() || !(c >= 0)) return res.status(400).json({ error: '参数无效' });
    db.prepare(`INSERT INTO costs(kind,key,cost,currency,note,updated_by,updated_at) VALUES(?,?,?,?,?,?,datetime('now'))
      ON CONFLICT(kind,key) DO UPDATE SET cost=excluded.cost, currency=excluded.currency, note=excluded.note, updated_by=excluded.updated_by, updated_at=excluded.updated_at`)
      .run(kind, String(key).trim(), c, /^[A-Z]{3}$/.test(currency) ? currency : 'CNY', String(note || ''), req.user.name);
    bump();
    res.json({ ok: true });
  }));
  api.delete('/costs', wrap((req, res) => {
    db.prepare('DELETE FROM costs WHERE kind=? AND key=?').run(String(req.query.kind), String(req.query.key));
    bump();
    res.json({ ok: true });
  }));

  // ---- 额外费用（出库费 / 上架费 …）----
  api.get('/expenses', wrap((req, res) => {
    res.json(db.prepare('SELECT * FROM expenses ORDER BY date DESC, id DESC LIMIT 1000').all());
  }));
  api.post('/expenses', wrap((req, res) => {
    const { date, category, amount, currency, note } = req.body || {};
    const a = Number(amount);
    if (!ymd.test(String(date || '')) || !String(category || '').trim() || !Number.isFinite(a)) return res.status(400).json({ error: '日期、类别、金额必填' });
    db.prepare('INSERT INTO expenses(date,category,amount,currency,note,created_by) VALUES(?,?,?,?,?,?)')
      .run(date, String(category).trim(), a, /^[A-Z]{3}$/.test(currency) ? currency : 'CNY', String(note || ''), req.user.name);
    bump();
    res.json({ ok: true });
  }));
  api.delete('/expenses/:id', wrap((req, res) => {
    db.prepare('DELETE FROM expenses WHERE id=?').run(Number(req.params.id));
    bump();
    res.json({ ok: true });
  }));

  // ---- 导入 ----
  api.post('/import/:type', wrap((req, res) => {
    const type = req.params.type;
    if (!TYPES.includes(type)) return res.status(400).json({ error: '未知类型' });
    const { rows, defaultCurrency, filename } = req.body || {};
    if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: '没有数据行' });
    const cur = /^[A-Z]{3}$/.test(defaultCurrency) ? defaultCurrency : 'CNY';
    const r = importRows(db, type, rows, { defaultCurrency: cur, user: req.user.name });
    db.prepare('INSERT INTO import_log(type,filename,rows_total,rows_ok,rows_skipped,user_name) VALUES(?,?,?,?,?,?)')
      .run(type, String(filename || '').slice(0, 200), r.total, r.ok, r.skipped, req.user.name);
    bump();
    res.json(r);
  }));
  api.get('/import-log', wrap((req, res) => {
    res.json(db.prepare('SELECT * FROM import_log ORDER BY id DESC LIMIT 50').all());
  }));
  api.delete('/data/:type', adminOnly, wrap((req, res) => {
    const t = req.params.type;
    if (!TYPES.includes(t)) return res.status(400).json({ error: '未知类型' });
    db.prepare(`DELETE FROM ${t}`).run();
    bump();
    res.json({ ok: true });
  }));

  api.use((req, res) => res.status(404).json({ error: '接口不存在' }));
  app.use('/api', api);

  // ---- 静态资源 ----
  const pub = path.join(__dirname, 'public');
  app.get('/vendor/echarts.js', (req, res) => res.sendFile(require.resolve('echarts/dist/echarts.min.js')));
  app.get('/vendor/xlsx.js', (req, res) => res.sendFile(require.resolve('xlsx/dist/xlsx.full.min.js')));
  app.get('/shared/mapping.js', (req, res) => res.sendFile(path.join(__dirname, 'shared', 'mapping.js')));
  app.use(express.static(pub, { maxAge: '5m', extensions: ['html'] }));
  app.get('/healthz', (req, res) => res.json({ ok: true }));
  return app;
}

function bootstrapAdmin(db) {
  const email = process.env.ADMIN_EMAIL, pw = process.env.ADMIN_PASSWORD;
  if (!email || !pw || db.prepare('SELECT COUNT(*) c FROM users').get().c > 0) return;
  db.prepare('INSERT INTO users(email,name,role,pass_hash) VALUES(?,?,?,?)')
    .run(email.trim().toLowerCase(), process.env.ADMIN_NAME || '管理员', 'admin', auth.hashPassword(pw));
  console.log('已创建管理员账号：' + email);
}

if (require.main === module) {
  const file = process.env.DB_PATH || path.join(__dirname, 'data', 'profitos.db');
  const db = openDb(file);
  bootstrapAdmin(db);
  const port = Number(process.env.PORT) || 3000;
  createApp(db).listen(port, process.env.HOST || '0.0.0.0', () => console.log(`ProfitOS 已启动：http://localhost:${port}  数据库：${file}`));
}

module.exports = { createApp, bootstrapAdmin };
