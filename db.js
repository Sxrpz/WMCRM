const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(path.join(DATA_DIR, 'crm.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS customers (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    company    TEXT NOT NULL DEFAULT '',
    nationality TEXT NOT NULL DEFAULT '',
    source     TEXT NOT NULL DEFAULT '',
    type       TEXT NOT NULL DEFAULT '',
    phone      TEXT NOT NULL DEFAULT '',
    email      TEXT NOT NULL DEFAULT '',
    intent     TEXT NOT NULL DEFAULT 'medium',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS followups (
    id          TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    date        TEXT NOT NULL,
    note        TEXT NOT NULL,
    next_date   TEXT NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_followups_customer ON followups(customer_id);

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL
  );
`);

// ---------- sessions ----------

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 天

const stmtCreateSession = db.prepare('INSERT INTO sessions (token, created_at) VALUES (?, ?)');
const stmtGetSession = db.prepare('SELECT created_at FROM sessions WHERE token = ?');
const stmtDeleteSession = db.prepare('DELETE FROM sessions WHERE token = ?');
const stmtPruneSessions = db.prepare('DELETE FROM sessions WHERE created_at < ?');

function createSession(token) {
  stmtCreateSession.run(token, Date.now());
}

function hasSession(token) {
  if (!token) return false;
  const row = stmtGetSession.get(token);
  return !!row && Date.now() - row.created_at < SESSION_TTL_MS;
}

function deleteSession(token) {
  stmtDeleteSession.run(token);
}

function pruneSessions() {
  stmtPruneSessions.run(Date.now() - SESSION_TTL_MS);
}
pruneSessions();

// ---------- customers ----------

function listCustomers() {
  const customers = db.prepare('SELECT * FROM customers ORDER BY created_at DESC').all();
  const followups = db.prepare('SELECT * FROM followups ORDER BY date DESC').all();
  const byCustomer = new Map();
  for (const f of followups) {
    if (!byCustomer.has(f.customer_id)) byCustomer.set(f.customer_id, []);
    byCustomer.get(f.customer_id).push(f);
  }
  return customers.map((c) => ({
    id: c.id,
    name: c.name,
    company: c.company,
    nationality: c.nationality,
    source: c.source,
    type: c.type,
    phone: c.phone,
    email: c.email,
    intent: c.intent,
    createdAt: c.created_at,
    followups: (byCustomer.get(c.id) || []).map((f) => ({
      id: f.id,
      date: f.date,
      note: f.note,
      nextDate: f.next_date,
    })),
  }));
}

const stmtInsertCustomer = db.prepare(`
  INSERT INTO customers (id, name, company, nationality, source, type, phone, email, intent, created_at)
  VALUES (@id, @name, @company, @nationality, @source, @type, @phone, @email, @intent, @created_at)
`);

function createCustomer(c) {
  stmtInsertCustomer.run({
    id: c.id,
    name: c.name,
    company: c.company,
    nationality: c.nationality,
    source: c.source,
    type: c.type,
    phone: c.phone,
    email: c.email,
    intent: c.intent,
    created_at: c.createdAt,
  });
}

const stmtUpdateCustomer = db.prepare(`
  UPDATE customers SET
    name = @name, company = @company, nationality = @nationality,
    source = @source, type = @type, phone = @phone, email = @email, intent = @intent
  WHERE id = @id
`);

function updateCustomer(id, fields) {
  const result = stmtUpdateCustomer.run({ ...fields, id });
  return result.changes === 1;
}

const stmtDeleteCustomer = db.prepare('DELETE FROM customers WHERE id = ?');

function deleteCustomer(id) {
  return stmtDeleteCustomer.run(id).changes === 1;
}

// ---------- followups ----------

const stmtInsertFollowup = db.prepare(`
  INSERT INTO followups (id, customer_id, date, note, next_date, created_at)
  VALUES (?, ?, ?, ?, ?, ?)
`);

function addFollowup(customerId, f) {
  stmtInsertFollowup.run(f.id, customerId, f.date, f.note, f.nextDate, Date.now());
}

const stmtDeleteFollowup = db.prepare('DELETE FROM followups WHERE id = ? AND customer_id = ?');

function deleteFollowup(customerId, followupId) {
  return stmtDeleteFollowup.run(followupId, customerId).changes === 1;
}

module.exports = {
  createSession,
  hasSession,
  deleteSession,
  pruneSessions,
  listCustomers,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  addFollowup,
  deleteFollowup,
};
