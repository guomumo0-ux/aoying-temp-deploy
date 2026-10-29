'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DEFAULT_SETTINGS = {
  default_currency: 'CNY',
  fx: { CNY: 1, USD: 7.2, MYR: 1.55, THB: 0.2, PHP: 0.125, IDR: 0.00045, VND: 0.00028, SGD: 5.4, GBP: 9.2, EUR: 7.8 },
  count_cost_for_refunded: false, // 结算金额<=0 的订单是否仍计商品成本
  exclude_gmvmax_ads: false, // 广告成本中剔除 GMV Max（已在结算里扣过时开启，避免重复）
  unsettled_ratio_fallback: 0.85, // 没有历史结算数据时，未结算订单预估回款比例
};

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      pass_hash TEXT NOT NULL,
      disabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS orders (
      order_id TEXT NOT NULL,
      sku TEXT NOT NULL DEFAULT '',
      product_name TEXT NOT NULL DEFAULT '',
      qty REAL NOT NULL DEFAULT 1,
      amount REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'CNY',
      order_time TEXT,
      order_date TEXT,
      status TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (order_id, sku)
    );
    CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(order_date);
    CREATE TABLE IF NOT EXISTS settlements (
      order_id TEXT PRIMARY KEY,
      settle_date TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'CNY',
      settle_amount REAL NOT NULL DEFAULT 0,
      fee_transaction REAL NOT NULL DEFAULT 0,
      fee_commission REAL NOT NULL DEFAULT 0,
      fee_affiliate REAL NOT NULL DEFAULT 0,
      fee_gmvmax REAL NOT NULL DEFAULT 0,
      fee_logistics REAL NOT NULL DEFAULT 0,
      fee_other REAL NOT NULL DEFAULT 0,
      refund_amount REAL NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_settle_date ON settlements(settle_date);
    CREATE TABLE IF NOT EXISTS costs (
      kind TEXT NOT NULL,            -- 'sku' | 'product'
      key TEXT NOT NULL,
      cost REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'CNY',
      note TEXT NOT NULL DEFAULT '',
      updated_by TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (kind, key)
    );
    CREATE TABLE IF NOT EXISTS ads (
      date TEXT NOT NULL,
      campaign TEXT NOT NULL DEFAULT '',
      ad_type TEXT NOT NULL DEFAULT '',
      currency TEXT NOT NULL DEFAULT 'CNY',
      spend REAL NOT NULL DEFAULT 0,
      impressions REAL NOT NULL DEFAULT 0,
      clicks REAL NOT NULL DEFAULT 0,
      orders REAL NOT NULL DEFAULT 0,
      revenue REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (date, campaign, ad_type)
    );
    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      category TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'CNY',
      note TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS import_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      filename TEXT NOT NULL DEFAULT '',
      rows_total INTEGER NOT NULL DEFAULT 0,
      rows_ok INTEGER NOT NULL DEFAULT 0,
      rows_skipped INTEGER NOT NULL DEFAULT 0,
      user_name TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function getSettings(db) {
  const out = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  for (const r of db.prepare('SELECT key, value FROM settings').all()) {
    try { out[r.key] = JSON.parse(r.value); } catch { /* ignore */ }
  }
  out.fx = { ...DEFAULT_SETTINGS.fx, ...(out.fx || {}), CNY: 1 };
  return out;
}

function saveSettings(db, patch) {
  const st = db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  tx(db, () => {
    for (const k of Object.keys(DEFAULT_SETTINGS)) {
      if (patch[k] !== undefined) st.run(k, JSON.stringify(patch[k]));
    }
  });
}

module.exports = { openDb, tx, getSettings, saveSettings, DEFAULT_SETTINGS };
