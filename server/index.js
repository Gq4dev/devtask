const express = require('express');
const cors = require('cors');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

// --- Auth con token (login propio, sin popup del navegador) ---
const AUTH_USER = process.env.AUTH_USER;
const AUTH_PASS = process.env.AUTH_PASS;
const authEnabled = !!(AUTH_USER && AUTH_PASS);
// Secreto para firmar tokens. Si no se define, se deriva del usuario/pass.
const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  crypto.createHash('sha256').update(`${AUTH_USER || ''}:${AUTH_PASS || ''}:devtasks`).digest('hex');
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30; // sesion de 30 dias

function safeEqual(a, b) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  // longitudes distintas -> comparar contra si mismo para mantener tiempo constante
  if (ba.length !== bb.length) {
    crypto.timingSafeEqual(ba, ba);
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

// Token autocontenido: base64url(payload).hmac  (sin dependencias externas)
function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyToken(token) {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function tokenFromReq(req) {
  return (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
}

// Login: valida credenciales y entrega un token
app.post('/api/login', (req, res) => {
  if (!authEnabled) {
    // sin credenciales configuradas (dev): modo abierto
    return res.json({ token: signToken({ u: 'dev', exp: Date.now() + TOKEN_TTL_MS }), user: 'dev' });
  }
  const { username, password } = req.body || {};
  if (safeEqual(username || '', AUTH_USER) && safeEqual(password || '', AUTH_PASS)) {
    return res.json({ token: signToken({ u: AUTH_USER, exp: Date.now() + TOKEN_TTL_MS }), user: AUTH_USER });
  }
  return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
});

// Protege el resto de /api/* (todo lo definido despues de aca)
if (authEnabled) {
  app.use('/api', (req, res, next) => {
    if (verifyToken(tokenFromReq(req))) return next();
    return res.status(401).json({ error: 'No autorizado' });
  });
  console.log('Auth por token activada');
} else {
  console.log('Auth DESACTIVADA (define AUTH_USER y AUTH_PASS para activarla)');
}

// --- DB setup ---
// DB_PATH permite apuntar la base a un volumen persistente (Docker). Default: junto al server.
const dbPath = process.env.DB_PATH || path.join(__dirname, 'devtasks.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#6366f1',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    notes TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'todo',          -- todo | doing | done
    priority TEXT NOT NULL DEFAULT 'medium',       -- low | medium | high
    estimate_min INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    done_at TEXT,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS time_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,                                  -- null = corriendo
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
  );
`);

// Seed: si no hay proyectos, crear 4 vacios la primera vez
const projCount = db.prepare('SELECT COUNT(*) c FROM projects').get().c;
if (projCount === 0) {
  const colors = ['#6366f1', '#ec4899', '#10b981', '#f59e0b'];
  const ins = db.prepare('INSERT INTO projects (name, color) VALUES (?, ?)');
  ['Proyecto 1', 'Proyecto 2', 'Proyecto 3', 'Proyecto 4'].forEach((n, i) =>
    ins.run(n, colors[i])
  );
}

// --- Helpers ---
function durationSeconds(entry) {
  const start = new Date(entry.started_at + 'Z').getTime();
  const end = entry.ended_at ? new Date(entry.ended_at + 'Z').getTime() : Date.now();
  return Math.max(0, Math.round((end - start) / 1000));
}

function taskWithTime(task) {
  const entries = db
    .prepare('SELECT * FROM time_entries WHERE task_id = ?')
    .all(task.id);
  const tracked = entries.reduce((sum, e) => sum + durationSeconds(e), 0);
  const running = entries.find((e) => e.ended_at === null) || null;
  return { ...task, tracked_seconds: tracked, running_entry_id: running?.id ?? null };
}

// --- Projects ---
app.get('/api/projects', (req, res) => {
  res.json(db.prepare('SELECT * FROM projects ORDER BY id').all());
});

app.post('/api/projects', (req, res) => {
  const { name, color } = req.body;
  const info = db
    .prepare('INSERT INTO projects (name, color) VALUES (?, ?)')
    .run(name || 'Nuevo proyecto', color || '#6366f1');
  res.json(db.prepare('SELECT * FROM projects WHERE id = ?').get(info.lastInsertRowid));
});

app.patch('/api/projects/:id', (req, res) => {
  const { name, color } = req.body;
  const cur = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'No existe el proyecto' });
  db.prepare('UPDATE projects SET name = ?, color = ? WHERE id = ?').run(
    name ?? cur.name,
    color ?? cur.color,
    req.params.id
  );
  res.json(db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id));
});

app.delete('/api/projects/:id', (req, res) => {
  db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// --- Tasks ---
app.get('/api/tasks', (req, res) => {
  const { project_id } = req.query;
  const rows = project_id
    ? db.prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY id DESC').all(project_id)
    : db.prepare('SELECT * FROM tasks ORDER BY id DESC').all();
  res.json(rows.map(taskWithTime));
});

app.post('/api/tasks', (req, res) => {
  const { project_id, title, notes, priority, estimate_min, status } = req.body;
  if (!project_id || !title) return res.status(400).json({ error: 'Falta proyecto o titulo' });
  const info = db
    .prepare(
      `INSERT INTO tasks (project_id, title, notes, priority, estimate_min, status)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(project_id, title, notes || '', priority || 'medium', estimate_min || 0, status || 'todo');
  res.json(taskWithTime(db.prepare('SELECT * FROM tasks WHERE id = ?').get(info.lastInsertRowid)));
});

app.patch('/api/tasks/:id', (req, res) => {
  const cur = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'No existe la tarea' });
  const { title, notes, status, priority, estimate_min } = req.body;
  const done_at =
    status === 'done' && cur.status !== 'done'
      ? "datetime('now')"
      : status && status !== 'done'
      ? 'NULL'
      : null;
  db.prepare(
    `UPDATE tasks SET title=?, notes=?, status=?, priority=?, estimate_min=?
     ${done_at ? `, done_at=${done_at}` : ''} WHERE id=?`
  ).run(
    title ?? cur.title,
    notes ?? cur.notes,
    status ?? cur.status,
    priority ?? cur.priority,
    estimate_min ?? cur.estimate_min,
    req.params.id
  );
  res.json(taskWithTime(db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id)));
});

app.delete('/api/tasks/:id', (req, res) => {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// --- Time tracking ---
app.post('/api/tasks/:id/start', (req, res) => {
  const taskId = req.params.id;
  // cerrar cualquier timer corriendo (global, un solo timer activo a la vez)
  db.prepare(
    "UPDATE time_entries SET ended_at = datetime('now') WHERE ended_at IS NULL"
  ).run();
  db.prepare("INSERT INTO time_entries (task_id, started_at) VALUES (?, datetime('now'))").run(
    taskId
  );
  // mover a 'doing' si estaba en todo
  db.prepare("UPDATE tasks SET status='doing' WHERE id=? AND status='todo'").run(taskId);
  res.json(taskWithTime(db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId)));
});

app.post('/api/tasks/:id/stop', (req, res) => {
  db.prepare(
    "UPDATE time_entries SET ended_at = datetime('now') WHERE task_id = ? AND ended_at IS NULL"
  ).run(req.params.id);
  res.json(taskWithTime(db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id)));
});

// --- Stats: tiempo por proyecto ---
app.get('/api/stats', (req, res) => {
  const projects = db.prepare('SELECT * FROM projects ORDER BY id').all();
  const result = projects.map((p) => {
    const tasks = db.prepare('SELECT * FROM tasks WHERE project_id = ?').all(p.id);
    let seconds = 0;
    let open = 0;
    let done = 0;
    for (const t of tasks) {
      const entries = db.prepare('SELECT * FROM time_entries WHERE task_id = ?').all(t.id);
      seconds += entries.reduce((s, e) => s + durationSeconds(e), 0);
      if (t.status === 'done') done++;
      else open++;
    }
    return { project_id: p.id, name: p.name, color: p.color, seconds, open, done };
  });
  res.json(result);
});

// --- Serve client build en produccion ---
const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`API en http://localhost:${PORT}`));
