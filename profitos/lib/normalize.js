'use strict';
// 服务端入库前的值清洗：日期、数字、币种。

function parseNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).trim();
  if (!s || s === '-' || s === '--') return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/^-/.test(s)) { neg = !neg; s = s.slice(1); }
  s = s.replace(/[,\s ]/g, '').replace(/[^\d.eE+-]/g, '');
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

const pad = (n) => String(n).padStart(2, '0');

// 返回 { date: 'YYYY-MM-DD', time: 'YYYY-MM-DD HH:mm:ss' } 或 null
function parseDateTime(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') {
    if (v > 20000 && v < 80000) { // Excel 序列号
      const ms = Math.round((v - 25569) * 86400 * 1000);
      return fmt(new Date(ms), true);
    }
    return null;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return build(+m[1], +m[2], +m[3], m[4], m[5], m[6]);
  // 兼容 MM/DD/YYYY（TikTok 英文导出常见）
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return build(+m[3], +m[1], +m[2], m[4], m[5], m[6]);
  return null;
}

function fmt(d, utc) {
  return build(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds());
}

function build(y, mo, d, h, mi, s) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  const date = `${y}-${pad(mo)}-${pad(d)}`;
  return { date, time: `${date} ${pad(h || 0)}:${pad(mi || 0)}:${pad(s || 0)}` };
}

const CUR_SYMBOLS = { '¥': 'CNY', '￥': 'CNY', '$': 'USD', '£': 'GBP', '€': 'EUR', RMB: 'CNY', 'US$': 'USD' };
function parseCurrency(v, fallback) {
  const s = String(v ?? '').trim();
  if (!s) return fallback;
  if (CUR_SYMBOLS[s]) return CUR_SYMBOLS[s];
  const m = s.toUpperCase().match(/[A-Z]{3}/);
  return m ? m[0] : fallback;
}

function cleanId(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
  return String(v).replace(/^[\s'"`]+|[\s'"`]+$/g, '').replace(/\.0$/, '');
}

function cleanText(v) {
  return v === null || v === undefined ? '' : String(v).trim();
}

module.exports = { parseNumber, parseDateTime, parseCurrency, cleanId, cleanText };
