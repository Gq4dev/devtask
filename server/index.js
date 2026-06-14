const express = require('express');
const cors = require('cors');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

// --- Basic Auth (opcional, se activa si hay AUTH_USER + AUTH_PASS) ---
const AUTH_USER = process.env.AUTH_USER;
const AUTH_PASS = process.env.AUTH_PASS;

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

if (AUTH_USER && AUTH_PASS) {
  app.use((req, res, next) => {
    const hdr = req.headers.authorization || '';
    const [scheme, encoded] = hdr.split(' ');
    if (scheme === 'Basic' && encoded) {
      const [user, pass] = Buffer.from(encoded, 'base64').toString().split(':');
      if (safeEqual(user || '', AUTH_USER) && safeEqual(pass || '', AUTH_PASS)) {
        return next();
      }
    }
    res.set('WWW-Authenticate', 'Basic realm="DevTasks"');
    return res.status(401).send('Autenticacion requerida');
  });
  console.log('Basic Auth activado');
} else {
  console.log('Basic Auth DESACTIVADO (define AUTH_USER y AUTH_PASS para activarlo)');
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
