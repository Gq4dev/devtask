import React, { useEffect, useMemo, useRef, useState } from 'react';

const API = '/api';
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

async function api(path, opts) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts
  });
  return res.json();
}

export default function App() {
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

  useEffect(() => { loadAll(); }, []);

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

  return (
    <div>
      <div className="topbar">
        <div className="brand"><span className="dot" />DevTasks</div>
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
      </div>

      <div className="shell">
        <aside className="sidebar">
          <div className="side-label">Proyectos</div>
          <button
            className={`proj-item all ${selected === 'all' ? 'sel' : ''}`}
            onClick={() => setSelected('all')}
          >
            <span className="swatch" style={{ background: 'var(--text-dim)' }} />
            Todos
            <span className="count">{tasks.filter((t) => t.status !== 'done').length}</span>
          </button>
          {projects.map((p) => (
            <button
              key={p.id}
              className={`proj-item ${selected === p.id ? 'sel' : ''}`}
              onClick={() => setSelected(p.id)}
              onDoubleClick={() => setEditProj(p)}
            >
              <span className="swatch" style={{ background: p.color }} />
              {p.name}
              <span className="count">{countByProject(p.id)}</span>
            </button>
          ))}
          <button className="add-proj" onClick={() => setEditProj('new')}>+ Nuevo proyecto</button>
        </aside>

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
              placeholder="est min"
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
                            <button className="icon-btn del" onClick={() => delTask(t.id)}>×</button>
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
