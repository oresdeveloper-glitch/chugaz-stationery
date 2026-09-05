import { fmt } from '../lib/api';

const PALETTE = ['#92400e', '#78350f', '#d97706', '#b91c1c', '#6d2810', '#a16207', '#c2410c', '#44403c', '#713f12', '#9f1239'];

export function niceMax(v) {
  if (v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return m * pow;
}

// Dual-series line/area chart with gridlines and hover tooltips.
export function LineChart({ data, xKey, series, height = 240, currency = 'TSh', labelEvery }) {
  const W = 720;
  const H = height;
  const padL = 52;
  const padR = 12;
  const padT = 14;
  const padB = 26;

  const xs = data.map((d) => d[xKey]);
  const maxRaw = Math.max(...series.map((s) => Math.max(...data.map((d) => Number(d[s.key]) || 0))), 1);
  const maxY = niceMax(maxRaw);

  if (data.length === 0) return <div className="muted small" style={{ padding: 12 }}>No data for this period</div>;

  const xAt = (i) => padL + (i * (W - padL - padR)) / Math.max(data.length - 1, 1);
  const yAt = (v) => padT + (1 - v / maxY) * (H - padT - padB);

  const every = labelEvery || Math.ceil(data.length / 6);
  const gridVals = [0, maxY / 2, maxY];

  const buildPath = (key) => data.map((d, i) => `${i === 0 ? 'M' : 'L'}${xAt(i)},${yAt(Number(d[key]) || 0)}`).join(' ');
  const areaPath = (key) => `${buildPath(key)} L${xAt(data.length - 1)},${yAt(0)} L${xAt(0)},${yAt(0)} Z`;

  return (
    <div className="chart">
      <div className="chart-legend">
        {series.map((s) => (
          <span key={s.key} className="chart-legend-item"><i style={{ background: s.color }} />{s.label}</span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg">
        {gridVals.map((v) => (
          <g key={v}>
            <line x1={padL} y1={yAt(v)} x2={W - padR} y2={yAt(v)} style={{ stroke: 'var(--border-strong)' }} strokeDasharray="3 3" />
            <text x={padL - 6} y={yAt(v) + 4} textAnchor="end" className="chart-axis">{fmt(v)}</text>
          </g>
        ))}
        {xs.map((d, i) =>
          i % every === 0 ? (
            <text key={i} x={xAt(i)} y={H - 8} textAnchor="middle" className="chart-axis">{String(d).slice(5)}</text>
          ) : null
        )}
        {series.map((s) => (
          <g key={s.key}>
            <path d={areaPath(s.key)} fill={s.color} opacity={s.fillOpacity ?? 0.08} />
            <path d={buildPath(s.key)} fill="none" stroke={s.color} strokeWidth={s.strokeWidth ?? 2.5} strokeLinejoin="round" strokeLinecap="round" />
            {data.map((d, i) => (
              <circle key={i} cx={xAt(i)} cy={yAt(Number(d[s.key]) || 0)} r={3} fill="var(--panel)" stroke={s.color} strokeWidth={1.5}>
                <title>{`${String(d[xKey])}\n${s.label}: ${fmt(d[s.key])} ${currency}`}</title>
              </circle>
            ))}
          </g>
        ))}
      </svg>
    </div>
  );
}

// Donut chart with legend.
export function Donut({ data, valueKey, labelKey, size = 190, currency = 'TSh', colors = PALETTE }) {
  const total = data.reduce((s, d) => s + (Number(d[valueKey]) || 0), 0);
  if (total <= 0) return <div className="muted small" style={{ padding: 12 }}>No data for this period</div>;
  const r = 42;
  const C = 2 * Math.PI * r;
  let cum = 0;

  return (
    <div className="donut">
      <div className="donut-canvas">
        <svg viewBox="0 0 110 110" style={{ width: size, height: size }}>
          <circle cx="55" cy="55" r={r} fill="none" style={{ stroke: 'var(--donut-track)' }} strokeWidth="16" />
          {data.map((d, i) => {
            const frac = (Number(d[valueKey]) || 0) / total;
            const el = (
              <circle
                key={i}
                cx="55" cy="55" r={r} fill="none"
                stroke={colors[i % colors.length]} strokeWidth="16"
                strokeDasharray={`${Math.max(frac * C - 1.5, 0)} ${C}`}
                strokeDashoffset={-cum * C}
                transform="rotate(-90 55 55)"
                strokeLinecap="round"
              >
                <title>{`${d[labelKey]}: ${fmt(d[valueKey])} ${currency} (${Math.round(frac * 100)}%)`}</title>
              </circle>
            );
            cum += frac;
            return el;
          })}
          <text x="55" y="52" textAnchor="middle" className="donut-total">{fmt(total)}</text>
          <text x="55" y="67" textAnchor="middle" className="donut-label">{currency}</text>
        </svg>
      </div>
      <div className="donut-legend">
        {data.map((d, i) => (
          <div key={i} className="donut-legend-item">
            <i style={{ background: colors[i % colors.length] }} />
            <span className="donut-name">{d[labelKey]}</span>
            <span className="donut-amt">{fmt(d[valueKey])}</span>
            <span className="donut-pct">{Math.round(((Number(d[valueKey]) || 0) / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Simple stacked bar showing two values (e.g. POS vs Online).
export function SplitBar({ items, currency = 'TSh' }) {
  const total = items.reduce((s, i) => s + Number(i.revenue), 0) || 1;
  return (
    <div>
      <div className="splitbar">
        {items.map((i, idx) => (
          <div key={i.channel} className="splitbar-seg" style={{ width: `${(Number(i.revenue) / total) * 100}%`, background: PALETTE[idx % PALETTE.length] }} title={`${i.channel}: ${fmt(i.revenue)}`} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 16, marginTop: 10, flexWrap: 'wrap' }}>
        {items.map((i, idx) => (
          <div key={i.channel} className="small">
            <i className="dot" style={{ background: PALETTE[idx % PALETTE.length] }} />
            <b style={{ textTransform: 'capitalize' }}> {i.channel}</b>
            <span className="muted"> â€” {fmt(i.revenue)} {currency} Â· {i.count} txns ({Math.round((Number(i.revenue) / total) * 100)}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Tiny inline sparkline for KPI cards.
export function Spark({ data, key = 'sales', color = 'var(--primary)', width = 120, height = 34 }) {
  const vals = data.map((d) => Number(d[key]) || 0);
  if (vals.length < 2) return <div className="spark empty" style={{ width, height }} />;
  const min = Math.min(...vals, 0);
  const max = Math.max(...vals, 1);
  const step = (max - min) || 1;
  const xAt = (i) => (i * (width - 4)) / (vals.length - 1) + 2;
  const yAt = (v) => height - 4 - ((v - min) / step) * (height - 8);
  const path = vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`).join(' ');
  const area = `${path} L${xAt(vals.length - 1)},${height - 4} L${xAt(0)},${height - 4} Z`;
  return (
    <svg className="spark" viewBox={`0 0 ${width} ${height}`} style={{ width, height }} preserveAspectRatio="none">
      <path d={area} fill={color} opacity={0.12} />
      <path d={path} fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// Grouped bar chart (e.g. cash inflow vs outflow per day).
export function BarChart({ data, xKey, series, height = 220, currency = 'TSh', labelEvery }) {
  const W = 720;
  const H = height;
  const padL = 52;
  const padR = 12;
  const padT = 14;
  const padB = 26;

  if (data.length === 0) return <div className="muted small" style={{ padding: 12 }}>No data for this period</div>;

  const maxRaw = Math.max(...series.map((s) => Math.max(...data.map((d) => Number(d[s.key]) || 0))), 1);
  const maxY = niceMax(maxRaw);
  const groupW = (W - padL - padR) / data.length;
  const barW = Math.min(28, (groupW / series.length) * 0.7);
  const yAt = (v) => padT + (1 - v / maxY) * (H - padT - padB);
  const every = labelEvery || Math.ceil(data.length / 6);
  const gridVals = [0, maxY / 2, maxY];

  return (
    <div className="chart">
      <div className="chart-legend">
        {series.map((s) => (
          <span key={s.key} className="chart-legend-item"><i style={{ background: s.color }} />{s.label}</span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg">
        {gridVals.map((v) => (
          <g key={v}>
            <line x1={padL} y1={yAt(v)} x2={W - padR} y2={yAt(v)} style={{ stroke: 'var(--border-strong)' }} strokeDasharray="3 3" />
            <text x={padL - 6} y={yAt(v) + 4} textAnchor="end" className="chart-axis">{fmt(v)}</text>
          </g>
        ))}
        {data.map((d, i) => (
          <g key={i}>
            {i % every === 0 && (
              <text x={padL + groupW * i + groupW / 2} y={H - 8} textAnchor="middle" className="chart-axis">{String(d[xKey]).slice(5)}</text>
            )}
            {series.map((s, si) => {
              const v = Number(d[s.key]) || 0;
              const cx = padL + groupW * i + groupW / 2 + (si - (series.length - 1) / 2) * barW;
              return (
                <rect key={si} x={cx - barW / 2} y={yAt(v)} width={barW} height={Math.max(H - padT - padB - yAt(v), 0)} rx={2} fill={s.color} opacity={0.9}>
                  <title>{`${String(d[xKey])}\n${s.label}: ${fmt(v)} ${currency}`}</title>
                </rect>
              );
            })}
          </g>
        ))}
      </svg>
    </div>
  );
}

// Horizontal bar rows (e.g. revenue by category).
export function HBarList({ data, valueKey, labelKey, currency = 'TSh', max }) {
  const peak = max || Math.max(...data.map((d) => Number(d[valueKey]) || 0), 1);
  return (
    <div className="hbar-list">
      {data.map((d, i) => (
        <div key={i} className="hbar-row">
          <div className="hbar-label">{d[labelKey]}</div>
          <div className="hbar-track"><div className="hbar-fill" style={{ width: `${(Number(d[valueKey]) / peak) * 100}%`, background: PALETTE[i % PALETTE.length] }} /></div>
          <div className="hbar-value">{fmt(d[valueKey])} <span className="muted small">{currency}</span></div>
        </div>
      ))}
    </div>
  );
}
