import { useState, useEffect } from 'react';
import { Bar, Doughnut } from 'react-chartjs-2';
import {
  Chart, BarElement, ArcElement,
  CategoryScale, LinearScale,
  Tooltip, Legend
} from 'chart.js';
import { api } from '../api';

Chart.register(BarElement, ArcElement, CategoryScale, LinearScale, Tooltip, Legend);

// ─── helpers ────────────────────────────────────────────────────────────────

function getRangeDates(range) {
  const now = new Date();
  const to = now.toISOString().split('T')[0];
  if (range === 'week') {
    const d = new Date(now); d.setDate(d.getDate() - 6);
    return { from: d.toISOString().split('T')[0], to };
  }
  if (range === 'month') {
    return {
      from: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`,
      to,
    };
  }
  // 30d
  const d = new Date(now); d.setDate(d.getDate() - 29);
  return { from: d.toISOString().split('T')[0], to };
}

function fmtSeconds(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtDate(str) {
  const d = new Date(str + 'T00:00:00');
  return d.toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric' });
}

const CHART_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { labels: { color: '#8b949e', boxWidth: 12 } } },
  scales: {
    x: { stacked: true, ticks: { color: '#8b949e' }, grid: { color: '#2a313c' } },
    y: {
      stacked: true,
      ticks: { color: '#8b949e', callback: v => v + 'm' },
      grid: { color: '#2a313c' },
    },
  },
};

// ─── componente principal ────────────────────────────────────────────────────

const RANGES = [
  { label: 'Esta semana', value: 'week' },
  { label: 'Este mes', value: 'month' },
  { label: 'Últimos 30 días', value: '30d' },
];

export default function Reports() {
  const [range, setRange] = useState('week');
  const [summary, setSummary] = useState(null);
  const [daily, setDaily] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const { from, to } = getRangeDates(range);
    Promise.all([
      api(`/reports/summary?from=${from}&to=${to}`),
      api(`/reports/daily?from=${from}&to=${to}`),
    ])
      .then(([sum, day]) => { setSummary(sum); setDaily(day); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [range]);

  const handleExportCSV = () => {
    const rows = [
      ['Fecha', 'Proyecto', 'Minutos'],
      ...daily.map(d => [d.date, d.project_name, Math.round(d.seconds / 60)]),
    ];
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `devtasks-${range}-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── KPIs ──
  const totalSeconds = summary?.total_seconds ?? 0;
  const activeProjects = summary?.by_project?.filter(p => p.seconds > 0).length ?? 0;
  const tasksDone = summary?.by_project?.reduce((a, p) => a + (p.tasks_done ?? 0), 0) ?? 0;
  const overEst = summary?.over_estimate_count ?? 0;

  // ── Bar chart data ──
  const dates = [...new Set(daily.map(d => d.date))].sort();
  const projects = [...new Map(daily.map(d => [d.project_id, { id: d.project_id, name: d.project_name, color: d.color }])).values()];
  const barData = {
    labels: dates.map(fmtDate),
    datasets: projects.map(p => ({
      label: p.name,
      backgroundColor: p.color + 'cc',
      borderColor: p.color,
      borderWidth: 1,
      data: dates.map(date => {
        const e = daily.find(d => d.date === date && d.project_id === p.id);
        return e ? Math.round(e.seconds / 60) : 0;
      }),
    })),
  };

  // ── Donut data ──
  const donutFiltered = summary?.by_project?.filter(p => p.seconds > 0) ?? [];
  const donutData = {
    labels: donutFiltered.map(p => p.name),
    datasets: [{
      data: donutFiltered.map(p => Math.round(p.seconds / 60)),
      backgroundColor: donutFiltered.map(p => p.color + 'cc'),
      borderColor: donutFiltered.map(p => p.color),
      borderWidth: 2,
    }],
  };

  if (loading) return <div className="reports-loading">Cargando reportes…</div>;
  if (error) return <div className="reports-error">Error: {error}<br />¿El backend tiene los endpoints <code>/api/reports/*</code>?</div>;

  return (
    <div className="reports-page">

      {/* Header */}
      <div className="reports-header">
        <h1 className="reports-title">Reportes</h1>
        <div className="range-tabs">
          {RANGES.map(r => (
            <button
              key={r.value}
              className={`range-tab ${range === r.value ? 'active' : ''}`}
              onClick={() => setRange(r.value)}
            >
              {r.label}
            </button>
          ))}
        </div>
        <button className="btn-ghost export-btn" onClick={handleExportCSV}>
          ↓ Exportar CSV
        </button>
      </div>

      {/* KPIs */}
      <div className="kpi-row">
        <div className="kpi-card">
          <span className="kpi-label">Total horas</span>
          <span className="kpi-value">{fmtSeconds(totalSeconds)}</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Proyectos activos</span>
          <span className="kpi-value">{activeProjects}</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Tareas completadas</span>
          <span className="kpi-value">{tasksDone}</span>
        </div>
        <div className={`kpi-card ${overEst > 0 ? 'warn' : ''}`}>
          <span className="kpi-label">Sobre estimado</span>
          <span className="kpi-value">{overEst}</span>
        </div>
      </div>

      {/* Charts */}
      <div className="charts-row">
        <div className="chart-card wide">
          <h3 className="chart-title">Horas por día</h3>
          {daily.length > 0
            ? <div style={{ height: 220 }}><Bar data={barData} options={CHART_OPTS} /></div>
            : <p className="chart-empty">Sin datos en este período.</p>
          }
        </div>
        <div className="chart-card">
          <h3 className="chart-title">Por proyecto</h3>
          {donutFiltered.length > 0
            ? <div style={{ height: 220 }}>
                <Doughnut
                  data={donutData}
                  options={{ cutout: '65%', maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: '#8b949e', padding: 10, boxWidth: 12 } } } }}
                />
              </div>
            : <p className="chart-empty">Sin datos en este período.</p>
          }
        </div>
      </div>

      {/* Tabla estimado vs real */}
      {summary?.by_project?.length > 0 && (
        <div className="chart-card">
          <h3 className="chart-title">Estimado vs Real por proyecto</h3>
          <table className="est-table">
            <thead>
              <tr>
                <th>Proyecto</th>
                <th>Estimado</th>
                <th>Real</th>
                <th>Diferencia</th>
                <th>Hechas</th>
                <th>Abiertas</th>
              </tr>
            </thead>
            <tbody>
              {summary.by_project.map(p => {
                const estMin = p.estimate_min ?? 0;
                const realMin = Math.round(p.seconds / 60);
                const diff = realMin - estMin;
                return (
                  <tr key={p.project_id}>
                    <td>
                      <span className="swatch" style={{ background: p.color, display: 'inline-block', width: 10, height: 10, borderRadius: '50%', marginRight: 6 }} />
                      {p.name}
                    </td>
                    <td className="mono">{estMin > 0 ? estMin + 'm' : '—'}</td>
                    <td className="mono">{realMin}m</td>
                    <td className={`mono ${diff > 0 ? 'over' : diff < 0 ? 'under' : ''}`}>
                      {estMin > 0 ? (diff > 0 ? '+' : '') + diff + 'm' : '—'}
                    </td>
                    <td>{p.tasks_done ?? 0}</td>
                    <td>{p.tasks_open ?? 0}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

    </div>
  );
}
