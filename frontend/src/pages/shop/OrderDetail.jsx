import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { shopApi, fmt, fmtDateTime } from '../../lib/api';
import { useShop } from '../../shop/ShopContext';
import RequireShopAuth from '../../shop/RequireShopAuth';
import { useToast } from '../../components/Toast';

export const ORDER_STATUS_FLOW = ['pending', 'confirmed', 'processing', 'ready_for_pickup', 'out_for_delivery', 'completed'];
export const STATUS_LABEL = (s) => String(s || '').replace(/_/g, ' ');
export const STATUS_COLOR = (s) => {
  const map = { pending: 'amber', confirmed: 'blue', processing: 'blue', ready_for_pickup: 'blue', out_for_delivery: 'blue', completed: 'amber', cancelled: 'red', rejected: 'red', returned: 'gray', refunded: 'gray' };
  return map[s] || 'gray';
};

function OrderDetailInner() {
  const { id } = useParams();
  const [order, setOrder] = useState(null);
  const [info, setInfo] = useState(null);
  const [payOpen, setPayOpen] = useState(false);
  const [payRef, setPayRef] = useState('');
  const [returnReason, setReturnReason] = useState('');
  const { refreshCart } = useShop();
  const toast = useToast();
  const navigate = useNavigate();

  const load = async () => {
    try {
      setOrder(await shopApi(`/orders/${id}`));
      setInfo(await shopApi('/info'));
    } catch (e) { toast(e.message, 'error'); }
  };
  useEffect(() => { load(); }, [id]);

  const act = async (fn, msg) => {
    try { await fn(); toast(msg); load(); }
    catch (e) { toast(e.message, 'error'); }
  };

  if (!order) return <div className="card">Loading...</div>;
  const currency = info?.currency || 'TSh';
  const isNew = order.order_status === 'pending' && order.payment_status !== 'paid';
  const flowIndex = ORDER_STATUS_FLOW.indexOf(order.order_status);

  return (
    <div>
      <div className="page-header">
        <div>
          <Link to="/shop/orders" className="muted small">← My orders</Link>
          <h1>Order {order.order_number}</h1>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div><span className={`badge ${STATUS_COLOR(order.order_status)}`}>{STATUS_LABEL(order.order_status)}</span>{' '}
            <span className={`badge ${order.payment_status === 'paid' ? 'amber' : order.payment_status === 'verifying' ? 'amber' : order.payment_status === 'refunded' ? 'gray' : order.payment_status === 'partial_refund' ? 'amber' : 'red'}`}>{String(order.payment_status).replace(/_/g, ' ')}</span></div>
          {order.payment_status === 'verifying' && (
            <div className="small" style={{ color: 'var(--warning, #b8860b)', marginTop: 4 }}>Payment under review</div>
          )}
          <div className="muted small">{fmtDateTime(order.order_date)}</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2>Tracking</h2>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
          {ORDER_STATUS_FLOW.map((s, i) => (
            <span key={s} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span className={`badge ${i <= flowIndex ? 'blue' : 'gray'}`}>{STATUS_LABEL(s)}</span>
              {i < ORDER_STATUS_FLOW.length - 1 && <span className="muted">→</span>}
            </span>
          ))}
        </div>
      </div>

      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <h2>Items</h2>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Product</th><th className="num">Qty</th><th className="num">Price</th><th className="num">Total</th></tr></thead>
                <tbody>
                  {order.items.map((i) => (
                    <tr key={i.id}><td>{i.product_name}</td><td className="num">{fmt(i.quantity)} {i.unit || ''}</td><td className="num">{fmt(i.unit_price)}/{i.unit || 'pc'}</td><td className="num">{fmt(i.total)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <h2>Shipping & payment</h2>
            <div className="small" style={{ lineHeight: 1.8 }}>
              <div><b>Fulfillment:</b> {order.fulfillment_type} {order.shipping_name && `→ ${order.shipping_name} (${order.shipping_phone}) ${order.shipping_address}`}</div>
              <div><b>Payment method:</b> {order.payment_method.replace(/_/g, ' ')}</div>
              {order.notes && <div><b>Notes:</b> {order.notes}</div>}
              {order.payments.length > 0 && (
                <div><b>Payments:</b>
                  {order.payments.map((p) => <div key={p.id} className="muted small">{fmtDateTime(p.paid_at || p.created_at)} : {fmt(p.amount)} ({p.payment_method}) {p.transaction_reference ? `· ${p.transaction_reference}` : ''}</div>)}
                </div>
              )}
              {order.returns.length > 0 && (
                <div><b>Returns:</b>
                  {order.returns.map((r) => <div key={r.id} className="muted small">{r.status} : {r.reason || 'no reason'} {r.refund_amount ? `(refund ${fmt(r.refund_amount)})` : ''}</div>)}
                </div>
              )}
            </div>
          </div>
        </div>

        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <h2>Summary</h2>
            <div className="cart-total-row"><span>Subtotal</span><span>{fmt(order.subtotal)}</span></div>
            <div className="cart-total-row"><span>Tax</span><span>{fmt(order.tax)}</span></div>
            <div className="cart-total-row"><span>Delivery fee</span><span>{fmt(order.delivery_fee)}</span></div>
            <div className="cart-total-row cart-grand"><span>Total</span><span>{fmt(order.total)} {currency}</span></div>
            {order.payment_status !== 'paid' && order.payment_status !== 'refunded' && (
              <button className="btn primary" style={{ width: '100%', justifyContent: 'center', marginTop: 8 }} onClick={() => setPayOpen(true)}>Pay now</button>
            )}
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <h2>Actions</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {isNew && <button className="btn" onClick={() => act(() => shopApi(`/orders/${order.id}/cancel`, { method: 'POST' }), 'Order cancelled, stock released')}>Cancel order</button>}
              <button className="btn" onClick={() => act(() => shopApi(`/orders/${order.id}/reorder`, { method: 'POST' }), 'Items added to your cart').then(() => refreshCart())}>Reorder</button>
              {['completed', 'ready_for_pickup', 'out_for_delivery'].includes(order.order_status) && order.returns.every((r) => r.status !== 'requested') && (
                <>
                  <button className="btn" onClick={async () => { if (!returnReason) return toast('Enter a reason', 'error'); await act(() => shopApi(`/orders/${order.id}/return-request`, { method: 'POST', body: { reason: returnReason } }), 'Return requested'); }}>Request return / refund</button>
                  <input placeholder="Reason for return" value={returnReason} onChange={(e) => setReturnReason(e.target.value)} />
                </>
              )}
              <Link to={`/shop/orders/${order.id}/invoice`} className="btn">View invoice</Link>
            </div>
          </div>
        </div>
      </div>

      {payOpen && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setPayOpen(false)}>
          <div className="modal">
            <h2>Pay for order {order.order_number}</h2>
            <p className="muted">Amount due: <b>{fmt(order.total)} {currency}</b></p>
            <div className="field"><label>Transaction reference (MPESA / card / transfer)</label><input value={payRef} onChange={(e) => setPayRef(e.target.value)} /></div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setPayOpen(false)}>Cancel</button>
              <button className="btn primary" onClick={async () => {
                await act(() => shopApi(`/orders/${order.id}/pay`, { method: 'POST', body: { method: order.payment_method, transaction_reference: payRef || null } }), 'Payment recorded');
                setPayOpen(false);
              }}>Confirm payment</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function OrderDetail() {
  return <RequireShopAuth><OrderDetailInner /></RequireShopAuth>;
}