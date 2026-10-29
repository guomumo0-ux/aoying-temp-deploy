'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../lib/db');
const { createApp } = require('../server');

async function start() {
  const db = openDb(':memory:');
  const server = createApp(db).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const call = async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, body: ct.includes('json') ? await r.json() : await r.text() };
  };
  return { call, close: () => server.close(), setCookie: (c) => { cookie = c; } };
}

test('未登录不能访问数据；首个用户成为管理员；成员不能管理用户', async () => {
  const t = await start();
  try {
    assert.equal((await t.call('GET', '/api/overview')).status, 401);
    assert.equal((await t.call('GET', '/api/auth/status')).body.needsSetup, true);
    assert.equal((await t.call('POST', '/api/auth/setup', { email: 'a@x.com', name: 'A', password: 'short' })).status, 400);
    assert.equal((await t.call('POST', '/api/auth/setup', { email: 'a@x.com', name: 'A', password: 'password123' })).status, 200);
    assert.equal((await t.call('POST', '/api/auth/setup', { email: 'b@x.com', name: 'B', password: 'password123' })).status, 403);
    assert.equal((await t.call('GET', '/api/me')).body.role, 'admin');
    assert.equal((await t.call('POST', '/api/users', { email: 'm@x.com', name: 'M', password: 'password123' })).status, 200);
    await t.call('POST', '/api/auth/logout');
    assert.equal((await t.call('POST', '/api/auth/login', { email: 'm@x.com', password: 'wrongwrong' })).status, 401);
    assert.equal((await t.call('POST', '/api/auth/login', { email: 'm@x.com', password: 'password123' })).status, 200);
    assert.equal((await t.call('GET', '/api/users')).status, 403);
    assert.equal((await t.call('PUT', '/api/settings', { fx: { USD: 7 } })).status, 403);
    assert.equal((await t.call('DELETE', '/api/data/orders')).status, 403);
  } finally { t.close(); }
});

test('导入 → 总览 → 订单明细 → CSV', async () => {
  const t = await start();
  try {
    await t.call('POST', '/api/auth/setup', { email: 'a@x.com', name: 'A', password: 'password123' });
    const o = await t.call('POST', '/api/import/orders', { rows: [
      { order_id: '1', sku: 'S', qty: 2, amount: 100, order_time: '2026-07-01' },
      { order_id: '2', sku: 'S', qty: 1, amount: 50, order_time: '2026-07-02' },
      { order_id: '', sku: 'S', qty: 1 },
    ] });
    assert.deepEqual([o.body.ok, o.body.skipped], [2, 1]);
    await t.call('POST', '/api/import/settlements', { rows: [{ order_id: '1', settle_date: '2026-07-04', settle_amount: 80 }] });
    await t.call('PUT', '/api/costs', { kind: 'sku', key: 'S', cost: 10 });
    await t.call('POST', '/api/import/ads', { rows: [{ date: '2026-07-04', spend: 5 }] });
    const ov = (await t.call('GET', '/api/overview')).body;
    assert.equal(ov.totals.net, 80 - 20 - 5);
    assert.equal(ov.unsettled.orders, 1);
    const ol = (await t.call('GET', '/api/orders?state=unsettled')).body;
    assert.equal(ol.total, 1);
    const csv = await t.call('GET', '/api/orders.csv');
    assert.match(csv.body, /订单号/);
    assert.equal((await t.call('GET', '/api/check')).body.counts.settledOrders, 1);
  } finally { t.close(); }
});
