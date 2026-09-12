import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { shopApi, fmt } from '../../lib/api';
import { useShop } from '../../shop/ShopContext';
import RequireShopAuth from '../../shop/RequireShopAuth';
import { useToast } from '../../components/Toast';
import I from '../../components/icons';

const METHOD_LABELS = {
  cash_on_delivery: ['Cash on delivery', 'Pay in cash when your order arrives'],
  pay_at_shop: ['Pay at shop', 'Collect and pay at our counter'],
  card: ['Card', 'Enter the transaction reference after paying'],
  mobile_money: ['Mobile money', 'M-Pesa, Tigo Pesa or Airtel Money reference'],
  bank_transfer: ['Bank transfer', 'Deposit slip or transfer reference'],
  credit: ['Credit account', 'Added to your credit balance : pay later'],
};

function Section({ n, title, sub, children }) {
  return (
    <div className="card ck-card">
      <div className="ck-head">
        <span className="ck-step">{n}</span>
        <div>
          <h2 className="ck-title">{title}</h2>
          {sub && <div className="muted small">{sub}</div>}
        </div>
      </div>
      {children}
    </div>
  );
}

function CheckoutInner() {
  const [cart, setCart] = useState(null);
  const [info, setInfo] = useState(null);
  const [addresses, setAddresses] = useState([]);
  const [form, setForm] = useState({ fulfillment: 'delivery', address_id: '', method: 'cash_on_delivery', reference: '', notes: '' });
  const [showNewAddr, setShowNewAddr] = useState(false);
  const [newAddr, setNewAddr] = useState({ address_name: '', recipient_name: '', phone: '', address: '', city: '', postal_code: '' });
  const [placing, setPlacing] = useState(false);
  const { refreshCart } = useShop();
  const toast = useToast();
  const navigate = useNavigate();

  const load = async () => {
    try {
      setCart(await shopApi('/cart'));
      setInfo(await shopApi('/info'));
      setAddresses(await shopApi('/addresses'));
    } catch (e) { toast(e.message, 'error'); }
  };
  useEffect(() => { load(); }, []);

  const saveAddress = async () => {
    if (!newAddr.address || !newAddr.city) return toast('Address and city required', 'error');
    try {
      await shopApi('/addresses', { method: 'POST', body: { ...newAddr, is_default: false } });
      setShowNewAddr(false);
      setNewAddr({ address_name: '', recipient_name: '', phone: '', address: '', city: '', postal_code: '' });
      setAddresses(await shopApi('/addresses'));
    } catch (e) { toast(e.message, 'error'); }
  };

  const placeOrder = async () => {
    if (cart.items.length === 0) return toast('Cart is empty', 'error');
    if (form.fulfillment === 'delivery' && !form.address_id) return toast('Choose a delivery address', 'error');
    if (['card', 'mobile_money', 'bank_transfer'].includes(form.method) && (!form.reference || form.reference.trim().length < 4)) {
      return toast('Enter the transaction reference from your payment (min 4 characters)', 'error');
    }
    setPlacing(true);
    try {
      const body = {
        fulfillment_type: form.fulfillment,
        delivery_address_id: form.address_id || null,
        payment_method: form.method,
        transaction_reference: form.reference || null,
        notes: form.notes || null,
      };
      const order = await shopApi('/orders', { method: 'POST', body });
      await refreshCart();
      toast(`Order ${order.order_number} placed`);
      navigate(`/shop/order/${order.id}`);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setPlacing(false);
    }
  };

  if (!cart || !info) return <div className="card">Loading…</div>;
  const currency = info.currency || 'TSh';
  const fee = Number(info.delivery_fee) || 0;
  const freeThreshold = Number(info.free_delivery_threshold) || 0;
  const deliveryCharge = form.fulfillment === 'pickup' ? 0 : (freeThreshold > 0 && cart.subtotal >= freeThreshold ? 0 : fee);
  const total = cart.subtotal + deliveryCharge;
  const methods = Object.keys(METHOD_LABELS);

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
        <h1>Checkout</h1>
        <span className="muted small">{cart.items.length} item{cart.items.length === 1 ? '' : 's'} · {fmt(cart.subtotal)} {currency}</span>
      </div>

      <div className="grid grid-2" style={{ alignItems: 'start', gap: 18 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Section n="1" title="Delivery method" sub="How would you like to receive your order?">
            <div className="ck-choices">
              <button type="button" className={`ck-choice ${form.fulfillment === 'delivery' ? 'on' : ''}`} onClick={() => setForm({ ...form, fulfillment: 'delivery' })}>
                <I name="truck" size={20} />
                <span><b>Delivery</b><small>{fee > 0 ? `${fmt(fee)} ${currency}` : 'Free'}{freeThreshold > 0 ? ` · free over ${fmt(freeThreshold)}` : ''}</small></span>
              </button>
              {info.pickup_available && (
                <button type="button" className={`ck-choice ${form.fulfillment === 'pickup' ? 'on' : ''}`} onClick={() => setForm({ ...form, fulfillment: 'pickup' })}>
                  <I name="store" size={20} />
                  <span><b>Pickup</b><small>No delivery fee</small></span>
                </button>
              )}
            </div>

            {form.fulfillment === 'delivery' && (
              <>
                {addresses.map((a) => (
                  <label key={a.id} className={`ck-addr ${form.address_id == a.id ? 'on' : ''}`}>
                    <input type="radio" checked={form.address_id == a.id} onChange={() => setForm({ ...form, address_id: a.id })} />
                    <span>
                      <b>{a.recipient_name}</b> · {a.phone}
                      <br /><span className="small muted">{a.address}, {a.city} {a.postal_code}</span>
                    </span>
                  </label>
                ))}
                {!addresses.length && <p className="muted small">Add a delivery address to continue.</p>}
                {showNewAddr ? (
                  <div className="card" style={{ marginTop: 10, background: 'var(--panel-2)' }}>
                    <div className="form-row">
                      <div className="field"><label>Address label</label><input value={newAddr.address_name} onChange={(e) => setNewAddr({ ...newAddr, address_name: e.target.value })} placeholder="Home / Office" /></div>
                      <div className="field"><label>Recipient name</label><input value={newAddr.recipient_name} onChange={(e) => setNewAddr({ ...newAddr, recipient_name: e.target.value })} /></div>
                    </div>
                    <div className="form-row">
                      <div className="field"><label>Phone *</label><input value={newAddr.phone} onChange={(e) => setNewAddr({ ...newAddr, phone: e.target.value })} /></div>
                      <div className="field"><label>City *</label><input value={newAddr.city} onChange={(e) => setNewAddr({ ...newAddr, city: e.target.value })} /></div>
                    </div>
                    <div className="field"><label>Street address *</label><input value={newAddr.address} onChange={(e) => setNewAddr({ ...newAddr, address: e.target.value })} /></div>
                    <div className="modal-actions">
                      <button className="btn" onClick={() => setShowNewAddr(false)}>Cancel</button>
                      <button className="btn primary" onClick={saveAddress}>Save address</button>
                    </div>
                  </div>
                ) : (
                  <button className="btn sm" style={{ marginTop: 8 }} onClick={() => setShowNewAddr(true)}><I name="plus" size={13} /> Add new address</button>
                )}
              </>
            )}
            {form.fulfillment === 'pickup' && (
              <p className="muted small" style={{ marginTop: 10 }}>Pick up at <b>{info.shop_name}</b>, {info.shop_address || 'our shop'}. We will call {info.shop_phone} when your order is ready.</p>
            )}
          </Section>

          <Section n="2" title="Payment" sub="Choose how you want to pay.">
            <div className="ck-methods">
              {methods.map((m) => (
                <label key={m} className={`ck-method ${form.method === m ? 'on' : ''}`}>
                  <input type="radio" checked={form.method === m} onChange={() => setForm({ ...form, method: m })} />
                  <span><b>{METHOD_LABELS[m][0]}</b><br /><span className="small muted">{METHOD_LABELS[m][1]}</span></span>
                </label>
              ))}
            </div>
            {['card', 'mobile_money', 'bank_transfer'].includes(form.method) && (
              <div className="field" style={{ marginTop: 12 }}>
                <label>Transaction reference *</label>
                <input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="M-Pesa code / card ref" />
                <p className="small muted" style={{ marginTop: 6 }}>Your payment will be reviewed by our team before the order is processed.</p>
              </div>
            )}
            {info.payment_instructions && (
              <p className="small muted" style={{ marginTop: 10, padding: '8px 12px', borderLeft: '3px solid var(--border-strong)', background: 'var(--panel-2)', borderRadius: 6 }}>
                {info.payment_instructions}
              </p>
            )}
          </Section>

          <Section n="3" title="Notes" sub="Anything we should know?">
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={2}
              placeholder="Delivery instructions, landmark, preferred time…"
              style={{ width: '100%', resize: 'vertical' }}
            />
          </Section>
        </div>

        <div className="card ck-summary">
          <h2 className="ck-title">Order summary</h2>
          {cart.items.map((i) => (
            <div className="cart-line" key={i.id}>
              <span className="name">{i.product_name} <span className="muted small">× {fmt(i.quantity)} {i.unit_label || 'piece'}</span></span>
              <span className="num">{fmt(i.unit_price * i.quantity)}</span>
            </div>
          ))}
          {cart.items.length === 0 && <p className="muted small">Your cart is empty.</p>}
          <div className="sep" style={{ borderTop: '1px solid var(--border)', margin: '12px 0' }} />
          <div className="cart-total-row num-row"><span>Subtotal</span><span className="num">{fmt(cart.subtotal)}</span></div>
          <div className="cart-total-row"><span>Delivery</span><span className="num">{deliveryCharge > 0 ? fmt(deliveryCharge) : 'Free'}</span></div>
          <div className="cart-total-row cart-grand"><span>Total</span><span className="num">{fmt(total)} {currency}</span></div>
          <button className="btn primary" style={{ width: '100%', justifyContent: 'center', padding: 13, marginTop: 14 }} disabled={placing || cart.items.length === 0} onClick={placeOrder}>
            {placing ? 'Placing order…' : `Place order · ${fmt(total)} ${currency}`}
          </button>
          <p className="muted small" style={{ textAlign: 'center', marginTop: 10 }}>
            You will receive an invoice right after placing the order.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function Checkout() {
  return <RequireShopAuth><CheckoutInner /></RequireShopAuth>;
}
