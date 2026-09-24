const crypto = require('crypto');
const express = require('express');
const db = require('./db');

const PORT = process.env.PORT || 3000;
const PASSWORD = process.env.CRM_PASSWORD;
const SESSION_MS = 30 * 24 * 60 * 60 * 1000; // 30 天
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';
const COOKIE_NAME = 'wmcrm_session';

if (!PASSWORD) {
  console.error('启动失败：请通过环境变量 CRM_PASSWORD 设置登录密码');
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: '1mb' }));

// ---------- helpers ----------

function parseCookies(req) {
  const header = req.headers.cookie;
  const cookies = {};
  if (header) {
    header.split(';').forEach((part) => {
      const idx = part.indexOf('=');
      if (idx > -1) {
        cookies[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
      }
    });
  }
  return cookies;
}

function getSessionToken(req) {
  return parseCookies(req)[COOKIE_NAME] || '';
}

function setSessionCookie(res, token) {
  const attrs = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${SESSION_MS / 1000}`,
  ];
  if (COOKIE_SECURE) attrs.push('Secure');
  res.append('Set-Cookie', attrs.join('; '));
}

function clearSessionCookie(res) {
  res.append('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
}

function requireAuth(req, res, next) {
  if (db.hasSession(getSessionToken(req))) {
    next();
  } else {
    res.status(401).json({ error: '未登录或登录已过期' });
  }
}

function uid() {
  return crypto.randomBytes(9).toString('hex') + Date.now().toString(36);
}

function cleanStr(value, max = 1000) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function readCustomerBody(body) {
  const intent = ['high', 'medium', 'low'].includes(body.intent) ? body.intent : 'medium';
  return {
    name: cleanStr(body.name, 200),
    company: cleanStr(body.company, 200),
    nationality: cleanStr(body.nationality, 100),
    source: cleanStr(body.source, 100),
    type: cleanStr(body.type, 100),
    phone: cleanStr(body.phone, 100),
    email: cleanStr(body.email, 200),
    intent,
  };
}

// ---------- auth routes ----------

app.post('/api/login', (req, res) => {
  const password = cleanStr(req.body && req.body.password, 200);
  if (!password || password !== PASSWORD) {
    res.status(401).json({ error: '密码错误' });
    return;
  }
  const token = crypto.randomBytes(32).toString('hex');
  db.createSession(token);
  setSessionCookie(res, token);
  res.json({ ok: true });
});

app.post('/api/logout', requireAuth, (req, res) => {
  db.deleteSession(getSessionToken(req));
  clearSessionCookie(res);
  res.json({ ok: true });
});

// ---------- business routes ----------

app.get('/api/customers', requireAuth, (req, res) => {
  res.json(db.listCustomers());
});

app.post('/api/customers', requireAuth, (req, res) => {
  const data = readCustomerBody(req.body || {});
  if (!data.name) {
    res.status(400).json({ error: '请填写客户姓名' });
    return;
  }
  const customer = { id: uid(), ...data, createdAt: Date.now() };
  db.createCustomer(customer);
  res.status(201).json(customer);
});

app.put('/api/customers/:id', requireAuth, (req, res) => {
  const data = readCustomerBody(req.body || {});
  if (!data.name) {
    res.status(400).json({ error: '请填写客户姓名' });
    return;
  }
  const ok = db.updateCustomer(req.params.id, data);
  if (!ok) {
    res.status(404).json({ error: '客户不存在' });
    return;
  }
  res.json({ ok: true });
});

app.delete('/api/customers/:id', requireAuth, (req, res) => {
  const ok = db.deleteCustomer(req.params.id);
  if (!ok) {
    res.status(404).json({ error: '客户不存在' });
    return;
  }
  res.json({ ok: true });
});

app.post('/api/customers/:id/followups', requireAuth, (req, res) => {
  const body = req.body || {};
  const note = cleanStr(body.note, 5000);
  if (!note) {
    res.status(400).json({ error: '请填写跟进内容' });
    return;
  }
  let date = cleanStr(body.date, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) date = new Date().toISOString().slice(0, 10);
  let nextDate = cleanStr(body.nextDate, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(nextDate)) nextDate = '';

  const followup = { id: uid(), date, note, nextDate };
  db.addFollowup(req.params.id, followup);
  res.status(201).json(followup);
});

app.delete('/api/customers/:id/followups/:fid', requireAuth, (req, res) => {
  const ok = db.deleteFollowup(req.params.id, req.params.fid);
  if (!ok) {
    res.status(404).json({ error: '跟进记录不存在' });
    return;
  }
  res.json({ ok: true });
});

// ---------- pages & static ----------

// 已登录用户访问登录页直接跳首页
app.get('/login.html', (req, res, next) => {
  if (db.hasSession(getSessionToken(req))) {
    res.redirect('/');
    return;
  }
  next();
});

// 未登录访问首页跳转登录页
app.get('/', (req, res, next) => {
  if (!db.hasSession(getSessionToken(req))) {
    res.redirect('/login.html');
    return;
  }
  next();
});

app.use(express.static('public'));

app.listen(PORT, () => {
  console.log(`WMCRM 已启动: http://localhost:${PORT}`);
});

// 每小时清理一次过期会话
setInterval(db.pruneSessions, 60 * 60 * 1000).unref();
