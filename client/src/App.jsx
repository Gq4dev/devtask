import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Routes, Route, Link, useNavigate, useLocation } from 'react-router-dom';
import { API, TOKEN_KEY, api } from './api';
import Reports from './pages/Reports';

const PROJ_COLORS = ['#6366f1', '#ec4899', '#10b981', '#f59e0b', '#06b6d4', '#a855f7', '#ef4444', '#84cc16'];
const STATUSES = [
  { key: 'todo', label: 'Por hacer', glyph: 'todo' },
  { key: 'doing', label: 'En curso', glyph: 'doing' },
  { key: 'done', label: 'Hecho', glyph: 'done' }
];

function fmt(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
function fmtShort(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || '');
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [confirmDelId, setConfirmDelId] = useState(null);
  const [projects, setProjects] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [stats, setStats] = useState([]);
  const [selected, setSelected] = useState('all'); // 'all' | project_id
  const [now, setNow] = useState(Date.now());
  const [editProj, setEditProj] = useState(null); // project obj | 'new' | null

  // new task form
  const [ntTitle, setNtTitle] = useState('');
  const [ntPrio, setNtPrio] = useState('medium');
  const [ntEst, setNtEst] = useState('');

  const tick = useRef();

  async function loadAll() {
    const [p, t, s] = await Promise.all([
      api('/projects'),
      api('/tasks'),
      api('/stats')
    ]);
    setProjects(p);
    setTasks(t);
    setStats(s);
  }

  useEffect(() => { if (token) loadAll(); }, [token]);

  // si el token expira o es invalido, volvemos al login
  useEffect(() => {
    const onUnauth = () => setToken('');
    window.addEventListener('devtasks-unauthorized', onUnauth);
    return () => window.removeEventListener('devtasks-unauthorized', onUnauth);
  }, []);

  function login(t) {
    localStorage.setItem(TOKEN_KEY, t);
    setToken(t);
  }
  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    setToken('');
  }
  function selectProject(id) {
    setSelected(id);
    setSidebarOpen(false);
    if (location.pathname !== '/') navigate('/');
  }

  // live tick para cronometros corriendo
  useEffect(() => {
    tick.current = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick.current);
  }, []);

  const runningTask = useMemo(() => tasks.find((t) => t.running_entry_id), [tasks]);

  // segundos extra acumulados desde el ultimo load para la tarea corriendo
  const liveBonus = useMemo(() => {
    if (!runningTask) return 0;
    return 0; // se calcula por tarea abajo usando _loadedAt
  }, [runningTask]);

  const loadedAt = useRef(Date.now());
  useEffect(() => { loadedAt.current = Date.now(); }, [tasks]);

  function liveSeconds(task) {
    if (!task.running_entry_id) return task.tracked_seconds;
    const extra = Math.floor((now - loadedAt.current) / 1000);
    return task.tracked_seconds + Math.max(0, extra);
  }

  const projColor = (id) => projects.find((p) => p.id === id)?.color || 'var(--accent)';
  const projName = (id) => projects.find((p) => p.id === id)?.name || '';

  const visibleTasks = useMemo(
    () => (selected === 'all' ? tasks : tasks.filter((t) => t.project_id === selected)),
    [tasks, selected]
  );

  const countByProject = (id) =>
    tasks.filter((t) => t.project_id === id && t.status !== 'done').length;

  async function addTask() {
    const title = ntTitle.trim();
    if (!title) return;
    const project_id = selected === 'all' ? projects[0]?.id : selected;
    if (!project_id) return;
    await api('/tasks', {
      method: 'POST',
      body: JSON.stringify({
        project_id,
        title,
        priority: ntPrio,
        estimate_min: parseInt(ntEst) || 0
      })
    });
    setNtTitle('');
    setNtEst('');
    loadAll();
  }

  async function moveTask(task, status) {
    await api(`/tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
    loadAll();
  }
  async function delTask(id) {
    await api(`/tasks/${id}`, { method: 'DELETE' });
    loadAll();
  }
  async function startTimer(id) {
    await api(`/tasks/${id}/start`, { method: 'POST' });
    loadAll();
  }
  async function stopTimer(id) {
    await api(`/tasks/${id}/stop`, { method: 'POST' });
    loadAll();
  }

  async function saveProject(data) {
    if (editProj === 'new') {
      await api('/projects', { method: 'POST', body: JSON.stringify(data) });
    } else {
      await api(`/projects/${editProj.id}`, { method: 'PATCH', body: JSON.stringify(data) });
    }
    setEditProj(null);
    loadAll();
  }
  async function deleteProject(id) {
    await api(`/projects/${id}`, { method: 'DELETE' });
    setEditProj(null);
    if (selected === id) setSelected('all');
    loadAll();
  }

  const headTitle = selected === 'all' ? 'Todos los proyectos' : projName(selected);
  const openCount = visibleTasks.filter((t) => t.status !== 'done').length;
  const maxStat = Math.max(1, ...stats.map((s) => s.seconds));

  if (!token) return <Login onLogin={login} />;

  return (
    <div>
      <div className="topbar">
        <button className="menu-btn" onClick={() => setSidebarOpen(true)} aria-label="Abrir menú">
          <span /><span /><span />
        </button>
        <div className="brand" onClick={() => navigate('/')} style={{ cursor: 'pointer' }}>
          <span className="dot" />DevTasks
        </div>
        {runningTask ? (
          <div className="active-timer">
            <span className="pulse" />
            <span className="t-time">{fmt(liveSeconds(runningTask))}</span>
            <span className="t-name">{runningTask.title}</span>
            <button className="t-stop" onClick={() => stopTimer(runningTask.id)}>STOP</button>
          </div>
        ) : (
          <div className="active-timer idle">
            <span className="pulse" style={{ background: 'var(--text-faint)', animation: 'none' }} />
            <span className="t-name">Sin cronómetro activo</span>
          </div>
        )}
        <button className="logout-btn" onClick={logout} title="Cerrar sesión">salir</button>
      </div>

      <div className="shell">
        <div
          className={`sidebar-overlay ${sidebarOpen ? 'visible' : ''}`}
          onClick={() => setSidebarOpen(false)}
        />
        <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
          <div className="side-label">Proyectos</div>
          <button
            className={`proj-item all ${selected === 'all' && location.pathname === '/' ? 'sel' : ''}`}
            onClick={() => selectProject('all')}
          >
            <span className="swatch" style={{ background: 'var(--text-dim)' }} />
            Todos
            <span className="count">{tasks.filter((t) => t.status !== 'done').length}</span>
          </button>
          {projects.map((p) => {
            const ps = stats.find((s) => s.project_id === p.id);
            const mins = ps ? Math.round(ps.seconds / 60) : 0;
            return (
              <button
                key={p.id}
                className={`proj-item ${selected === p.id && location.pathname === '/' ? 'sel' : ''}`}
                onClick={() => selectProject(p.id)}
                onDoubleClick={() => setEditProj(p)}
              >
                <span className="swatch" style={{ background: p.color }} />
                {p.name}
                {mins > 0 && (
                  <span className="proj-time-mini">
                    {mins >= 60 ? `${Math.floor(mins / 60)}h${mins % 60 ? `${mins % 60}m` : ''}` : `${mins}m`}
                  </span>
                )}
                <span className="count">{countByProject(p.id)}</span>
              </button>
            );
          })}
          <button className="add-proj" onClick={() => setEditProj('new')}>+ Nuevo proyecto</button>
          <div className="sidebar-divider" />
          <Link
            to="/reports"
            className={`nav-link ${location.pathname === '/reports' ? 'active' : ''}`}
            onClick={() => setSidebarOpen(false)}
          >
            <span className="nav-icon">📊</span>
            Reportes
          </Link>
        </aside>

        <Routes>
          <Route path="/" element={
        <main className="main">
          <div className="main-head">
            <h1>{headTitle}</h1>
            {selected !== 'all' && (
              <button className="edit-proj" onClick={() => setEditProj(projects.find((p) => p.id === selected))}>
                editar
              </button>
            )}
          </div>
          <div className="main-sub">
            {openCount} pendiente{openCount === 1 ? '' : 's'} · {visibleTasks.length} en total
          </div>

          <div className="new-task">
            <input
              className="title-in"
              placeholder="Nueva tarea…  (Enter para agregar)"
              value={ntTitle}
              onChange={(e) => setNtTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addTask()}
            />
            <select value={ntPrio} onChange={(e) => setNtPrio(e.target.value)}>
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
            </select>
            <input
              className="est-in"
              type="number"
              min="1"
              placeholder="min"
              title="Estimación en minutos"
              value={ntEst}
              onChange={(e) => setNtEst(e.target.value.replace(/\D/g, ''))}
            />
            <button className="add-btn" onClick={addTask}>Agregar</button>
          </div>

          <div className="cols">
            {STATUSES.map((st) => {
              const colTasks = visibleTasks.filter((t) => t.status === st.key);
              return (
                <div key={st.key} className="col">
                  <div className="col-head">
                    <span className={`glyph ${st.glyph}`} />
                    {st.label}
                    <span className="cnt">{colTasks.length}</span>
                  </div>
                  <div className="col-body">
                    {colTasks.length === 0 && <div className="empty-col">vacío</div>}
                    {colTasks.map((t) => {
                      const running = !!t.running_entry_id;
                      const secs = liveSeconds(t);
                      return (
                        <div
                          key={t.id}
                          className={`card ${t.status === 'done' ? 'is-done' : ''} ${running ? 'running' : ''}`}
                          style={{ '--proj-color': projColor(t.project_id) }}
                        >
                          <div className="card-top">
                            <div className="card-title">{t.title}</div>
                            <span className={`prio ${t.priority}`}>{t.priority}</span>
                          </div>
                          <div className="card-meta">
                            {selected === 'all' && (
                              <span className="proj-tag">
                                <span className="swatch" style={{ background: projColor(t.project_id) }} />
                                {projName(t.project_id)}
                              </span>
                            )}
                            {(secs > 0 || running) && (
                              <span className={`time ${running ? 'live' : ''}`}>⏱ {fmt(secs)}</span>
                            )}
                            {t.estimate_min > 0 && <span>est {t.estimate_min}m</span>}
                          </div>
                          {t.estimate_min > 0 && t.tracked_seconds > 0 && (
                            <div
                              className="progress-bar"
                              title={`${Math.round(t.tracked_seconds / 60)}m de ${t.estimate_min}m estimados`}
                            >
                              <div
                                className={`progress-fill ${t.tracked_seconds > t.estimate_min * 60 ? 'over' : ''}`}
                                style={{ width: `${Math.min((t.tracked_seconds / (t.estimate_min * 60)) * 100, 100)}%` }}
                              />
                            </div>
                          )}
                          <div className="card-actions">
                            {st.key !== 'done' &&
                              (running ? (
                                <button className="icon-btn stop" onClick={() => stopTimer(t.id)}>■ stop</button>
                              ) : (
                                <button className="icon-btn play" onClick={() => startTimer(t.id)}>▶ track</button>
                              ))}
                            {st.key === 'todo' && (
                              <button className="icon-btn" onClick={() => moveTask(t, 'doing')}>→ curso</button>
                            )}
                            {st.key === 'doing' && (
                              <>
                                <button className="icon-btn" onClick={() => moveTask(t, 'todo')}>← todo</button>
                                <button className="icon-btn" onClick={() => moveTask(t, 'done')}>✓ hecho</button>
                              </>
                            )}
                            {st.key === 'done' && (
                              <button className="icon-btn" onClick={() => moveTask(t, 'doing')}>↺ reabrir</button>
                            )}
                            {confirmDelId === t.id ? (
                              <span className="del-confirm">
                                <button
                                  className="icon-btn danger"
                                  onClick={() => { delTask(t.id); setConfirmDelId(null); }}
                                >
                                  ✓ borrar
                                </button>
                                <button className="icon-btn" onClick={() => setConfirmDelId(null)}>cancel</button>
                              </span>
                            ) : (
                              <button
                                className="icon-btn del"
                                onClick={() => setConfirmDelId(t.id)}
                                title="Eliminar tarea"
                              >
                                ×
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="stats">
            <h2>Tiempo por proyecto</h2>
            <div className="stat-grid">
              {stats.map((s) => {
                const live = runningTask && runningTask.project_id === s.project_id
                  ? s.seconds + Math.max(0, Math.floor((now - loadedAt.current) / 1000))
                  : s.seconds;
                return (
                  <div key={s.project_id} className="stat-card">
                    <div className="s-name">
                      <span className="swatch" style={{ background: s.color }} />
                      {s.name}
                    </div>
                    <div className="s-time">{fmtShort(live)}</div>
                    <div className="s-meta">{s.open} abiertas · {s.done} hechas</div>
                    <div className="bar">
                      <span style={{ width: `${(live / maxStat) * 100}%`, background: s.color }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </main>
          } />
          <Route path="/reports" element={<Reports />} />
        </Routes>
      </div>

      {editProj && (
        <ProjectModal
          project={editProj === 'new' ? null : editProj}
          onSave={saveProject}
          onDelete={editProj !== 'new' ? () => deleteProject(editProj.id) : null}
          onClose={() => setEditProj(null)}
        />
      )}
    </div>
  );
}

function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!username || !password || loading) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(API + '/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'No se pudo iniciar sesión');
        setLoading(false);
        return;
      }
      onLogin(data.token);
    } catch {
      setError('No se pudo conectar con el servidor');
      setLoading(false);
    }
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand"><span className="dot" />DevTasks</div>
        <div className="login-sub">Iniciá sesión para continuar</div>
        <div className="field">
          <label>Usuario</label>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" />
        </div>
        <div className="field">
          <label>Contraseña</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </div>
        {error && <div className="login-error">{error}</div>}
        <button className="btn-primary login-btn" type="submit" disabled={loading}>
          {loading ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}

function ProjectModal({ project, onSave, onDelete, onClose }) {
  const [name, setName] = useState(project?.name || '');
  const [color, setColor] = useState(project?.color || PROJ_COLORS[0]);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{project ? 'Editar proyecto' : 'Nuevo proyecto'}</h3>
        <div className="field">
          <label>Nombre</label>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus
            onKeyDown={(e) => e.key === 'Enter' && name.trim() && onSave({ name: name.trim(), color })} />
        </div>
        <div className="field">
          <label>Color</label>
          <div className="swatches">
            {PROJ_COLORS.map((c) => (
              <button key={c} className={color === c ? 'sel' : ''} style={{ background: c }}
                onClick={() => setColor(c)} />
            ))}
          </div>
        </div>
        <div className="modal-actions">
          {onDelete && <button className="btn-ghost danger" onClick={onDelete}>Eliminar</button>}
          <button className="btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" onClick={() => name.trim() && onSave({ name: name.trim(), color })}>
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}
