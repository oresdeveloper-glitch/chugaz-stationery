import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { shopApi, fmt, fmtDateTime } from '../../lib/api';
import RequireShopAuth from '../../shop/RequireShopAuth';
import { useToast } from '../../components/Toast';
import { STATUS_COLOR, STATUS_LABEL } from './OrderDetail';

const FILTERS = ['all', 'pending', 'processing', 'completed', 'cancelled', 'returned'];

function MyOrdersInner() {
  const [orders, setOrders] = useState([]);
  const [filter, setFilter] = useState('all');
  const toast = useToast();

  const load = async () => {
    try {
      const q = filter === 'all' ? '' : `?status=${filter}`;
      setOrders(await shopApi(`/orders${q}`));
    } catch (e) { toast(e.message, 'error'); }
  };
  useEffect(() => { load(); }, [filter]);

  return (
    <div>
      <div className="page-header"><h1>My orders</h1></div>
      <div className="toolbar">
        <div className="filters">
          {FILTERS.map((f) => (
            <button key={f} className={`btn ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>{f}</button>
          ))}
        </div>
      </div>
      {orders.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <p>No orders yet.</p>
          <Link to="/shop" className="btn primary">Start shopping</Link>
        </div>
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead><tr><th>Order</th><th>Date</th><th className="num">Items</th><th className="num">Total</th><th>Status</th><th>Payment</th><th></th></tr></thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td style={{ fontWeight: 600 }}>{o.order_number}</td>
                    <td className="muted">{fmtDateTime(o.order_date)}</td>
                    <td className="num">{o.items}</td>
                    <td className="num">{fmt(o.total)}</td>
                    <td><span className={`badge ${STATUS_COLOR(o.order_status)}`}>{STATUS_LABEL(o.order_status)}</span></td>
                    <td><span className={`badge ${o.payment_status === 'paid' ? 'amber' : o.payment_status === 'refunded' || o.payment_status === 'partial_refund' ? 'gray' : 'red'}`}>{o.payment_status}</span></td>
                    <td><Link className="btn sm" to={`/shop/order/${o.id}`}>Track</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default function MyOrders() {
  return <RequireShopAuth><MyOrdersInner /></RequireShopAuth>;
}