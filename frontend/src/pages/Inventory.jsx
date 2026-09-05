import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, fmt, fmtDateTime } from '../lib/api';
import { useToast } from '../components/Toast';
import Modal from '../components/Modal';

export default function Inventory() {
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState(params.get('tab') === 'low' ? 'low' : 'movements');
  const [movements, setMovements] = useState([]);
  const [low, setLow] = useState([]);
  const [products, setProducts] = useState([]);
  const [filter, setFilter] = useState('');
  const [adj, setAdj] = useState(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const load = async () => {
    try {
      const [m, l, p] = await Promise.all([
        api('/stock/movements'),
        api('/stock/low'),
        api('/products'),
      ]);
      setMovements(m); setLow(l); setProducts(p);
    } catch (e) { toast(e.message, 'error'); }
  };
  useEffect(() => { load(); }, []);

  const typeBadge = (t) =>
    <span className={`badge ${t === 'in' ? 'amber' : 'red'}`}>{t === 'in' ? 'Stock in' : 'Stock out'}</span>;

  const doAdjust = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api('/stock/adjust', { method: 'POST', body: adj });
      toast('Stock adjusted');
      setAdj(null);
      load();
    } catch (err) { toast(err.message, 'error'); }
    finally { setSaving(false); }
  };

  return (
    <div>
      <div className="page-header">
        <h1>Inventory</h1>
        {tab === 'adjust' && <button className="btn primary" onClick={() => setAdj({ product_id: '', new_quantity: 0, reason: '' })}>+ New adjustment</button>}
      </div>

      <div className="toolbar">
        <div className="btn-group">
          {[['movements', 'Movements'], ['low', 'Low stock'], ['adjust', 'Adjust stock']].map(([t, l]) => (
            <button key={t} className={`btn${tab === t ? ' primary' : ''}`} style={{ borderRadius: 0, border: 'none' }} onClick={() => { setTab(t); setParams(t === 'low' ? { tab: 'low' } : {}); }}>{l}</button>
          ))}
        </div>
        {tab === 'movements' && (
          <>
            <div className="spacer" />
            <select style={{ maxWidth: 260 }} value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="">All products</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </>
        )}
      </div>

      {tab === 'movements' && (
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Product</th><th>Type</th><th className="num">Qty</th><th>Reference</th><th>Notes</th><th>By</th></tr></thead>
              <tbody>
                {movements.filter((m) => !filter || m.product_id == filter).map((m) => (
                  <tr key={m.id}>
                    <td className="muted">{fmtDateTime(m.created_at)}</td>
                    <td>{m.product_name}</td>
                    <td>{typeBadge(m.movement_type)}</td>
                    <td className="num">{fmt(m.quantity)}</td>
                    <td className="muted">{m.reference_id ? `#${m.reference_id}` : ':'}</td>
                    <td className="muted small">{m.notes}</td>
                    <td className="muted">{m.created_by_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'low' && (
        <div className="card">
          <p className="muted">Products at or below their reorder level ({low.length} found).</p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Product</th><th>SKU</th><th>Category</th><th className="num">In stock</th><th className="num">Reorder level</th><th>Status</th></tr></thead>
              <tbody>
                {low.map((p) => (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 600 }}>{p.name}</td>
                    <td className="muted">{p.sku}</td>
                    <td>{p.category_name || ':'}</td>
                    <td className="num" style={{ color: p.current_stock <= 0 ? 'var(--danger)' : 'var(--warning)', fontWeight: 700 }}>{fmt(p.current_stock)}</td>
                    <td className="num">{fmt(p.reorder_level)}</td>
                    <td>{p.current_stock <= 0 ? <span className="badge red">Out of stock</span> : <span className="badge amber">Low stock</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'adjust' && (
        <div className="card">
          <p className="muted">Admins can correct stock levels. A stock movement record is created automatically.</p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Product</th><th className="num">Current</th><th className="num">Reorder</th><th></th></tr></thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td className="num">{fmt(p.current_stock)}</td>
                    <td className="num">{fmt(p.reorder_level)}</td>
                    <td><button className="btn sm" onClick={() => setAdj({ product_id: p.id, new_quantity: p.current_stock, reason: '' })}>Adjust</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal open={!!adj} onClose={() => setAdj(null)} title="Stock adjustment">
        {adj && (
          <form onSubmit={doAdjust}>
            <div className="field"><label>Product</label>
              <select value={adj.product_id} onChange={(e) => setAdj({ ...adj, product_id: e.target.value })} required>
                <option value="">Select product</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name} (current: {fmt(p.current_stock)})</option>)}
              </select>
            </div>
            <div className="field"><label>New quantity</label><input type="number" step="0.01" min="0" value={adj.new_quantity} onChange={(e) => setAdj({ ...adj, new_quantity: +e.target.value })} required /></div>
            <div className="field"><label>Reason</label><input value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value })} placeholder="damaged / lost / count correction" /></div>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setAdj(null)}>Cancel</button>
              <button type="submit" className="btn primary" disabled={saving}>{saving ? 'Saving...' : 'Apply'}</button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}