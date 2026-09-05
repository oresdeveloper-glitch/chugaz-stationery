import { useEffect, useState } from 'react';
import { api, fmt, fmtDate } from '../lib/api';
import { useToast } from '../components/Toast';
import Modal from '../components/Modal';

export default function Expenses() {
  const [expenses, setExpenses] = useState([]);
  const [modal, setModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const load = async () => {
    try { setExpenses(await api('/expenses')); } catch (e) { toast(e.message, 'error'); }
  };
  useEffect(() => { load(); }, []);

  const total = expenses.reduce((s, e) => s + Number(e.amount), 0);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api('/expenses', { method: 'POST', body: modal });
      toast('Expense recorded');
      setModal(null); load();
    } catch (err) { toast(err.message, 'error'); }
    finally { setSaving(false); }
  };

  const remove = async (id) => {
    if (!confirm('Delete this expense?')) return;
    try { await api(`/expenses/${id}`, { method: 'DELETE' }); load(); }
    catch (err) { toast(err.message, 'error'); }
  };

  const byCategory = {};
  expenses.forEach((e) => { byCategory[e.category || 'Other'] = (byCategory[e.category || 'Other'] || 0) + Number(e.amount); });

  return (
    <div>
      <div className="page-header">
        <h1>Expenses</h1>
        <button className="btn primary" onClick={() => setModal({ title: '', category: '', amount: 0, expense_date: new Date().toISOString().slice(0, 10), notes: '' })}>+ Add expense</button>
      </div>
      <div className="grid grid-2">
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead><tr><th>Title</th><th>Category</th><th>Date</th><th className="num">Amount</th><th>By</th><th></th></tr></thead>
              <tbody>
                {expenses.map((e) => (
                  <tr key={e.id}>
                    <td style={{ fontWeight: 600 }}>{e.title}</td>
                    <td>{e.category || ':'}</td>
                    <td className="muted">{fmtDate(e.expense_date)}</td>
                    <td className="num">{fmt(e.amount)}</td>
                    <td className="muted">{e.created_by_name}</td>
                    <td><button className="btn sm danger" onClick={() => remove(e.id)}>Del</button></td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={3} style={{ fontWeight: 700 }}>Total</td><td className="num" style={{ fontWeight: 700 }}>{fmt(total)}</td><td colSpan={2} /></tr></tfoot>
            </table>
          </div>
        </div>
        <div className="card">
          <h2>By category</h2>
          {Object.entries(byCategory).map(([cat, amt]) => (
            <div key={cat} className="cart-line">
              <span>{cat}</span>
              <span style={{ fontWeight: 600 }}>{fmt(amt)}</span>
            </div>
          ))}
        </div>
      </div>

      <Modal open={!!modal} onClose={() => setModal(null)} title="Add expense">
        <form onSubmit={save}>
          <div className="field"><label>Title *</label><input required value={modal?.title || ''} onChange={(e) => setModal({ ...modal, title: e.target.value })} /></div>
          <div className="form-row">
            <div className="field"><label>Category</label><input value={modal?.category || ''} onChange={(e) => setModal({ ...modal, category: e.target.value })} placeholder="Rent, Utilities, Salaries..." /></div>
            <div className="field"><label>Amount *</label><input type="number" step="0.01" required value={modal?.amount ?? 0} onChange={(e) => setModal({ ...modal, amount: +e.target.value })} /></div>
          </div>
          <div className="field"><label>Date</label><input type="date" value={modal?.expense_date || ''} onChange={(e) => setModal({ ...modal, expense_date: e.target.value })} /></div>
          <div className="field"><label>Notes</label><input value={modal?.notes || ''} onChange={(e) => setModal({ ...modal, notes: e.target.value })} /></div>
          <div className="modal-actions">
            <button type="button" className="btn" onClick={() => setModal(null)}>Cancel</button>
            <button type="submit" className="btn primary" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}