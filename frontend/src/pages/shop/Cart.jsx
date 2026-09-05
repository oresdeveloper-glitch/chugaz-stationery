import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { shopApi, fmt } from '../../lib/api';
import { useShop } from '../../shop/ShopContext';
import RequireShopAuth from '../../shop/RequireShopAuth';
import { useToast } from '../../components/Toast';
import I from '../../components/icons';

function CartInner() {
  const [cart, setCart] = useState(null);
  const [info, setInfo] = useState(null);
  const { refreshCart } = useShop();
  const toast = useToast();
  const navigate = useNavigate();

  const load = async () => {
    try {
      setCart(await shopApi('/cart'));
      setInfo(await shopApi('/info'));
    } catch (e) { toast(e.message, 'error'); }
  };
  useEffect(() => { load(); }, []);

  const setQty = async (item, qty) => {
    try {
      setCart(await shopApi(`/cart/items/${item.id}`, { method: 'PUT', body: { quantity: qty } }));
      refreshCart();
    } catch (e) { toast(e.message, 'error'); }
  };
  const remove = async (item) => {
    setCart(await shopApi(`/cart/items/${item.id}`, { method: 'DELETE' }));
    refreshCart();
  };
  const clear = async () => {
    setCart(await shopApi('/cart', { method: 'DELETE' }));
    refreshCart();
  };

  if (!cart) return <div className="card">Loading...</div>;
  const currency = info?.currency || 'TSh';
  const threshold = Number(info?.free_delivery_threshold) || 0;
  const fee = Number(info?.delivery_fee) || 0;
  const freeDelivery = threshold > 0 && cart.subtotal >= threshold;

  return (
    <div>
      <div className="page-header"><h1>Shopping cart</h1>{cart.count > 0 && <button className="btn sm danger" onClick={clear}>Clear cart</button>}</div>
      {cart.items.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <p>Your cart is empty.</p>
          <Link to="/shop" className="btn primary">Browse products</Link>
        </div>
      ) : (
        <div className="grid grid-2" style={{ alignItems: 'start', gap: 18 }}>
          <div className="card" style={{ padding: '6px 18px' }}>
            {cart.items.map((i) => (
              <div className="cart-line" key={i.id} style={{ alignItems: 'center', gap: 14 }}>
                <Link to={`/shop/product/${i.product_id}`} style={{ flexShrink: 0 }}>
                  {i.image
                    ? <img src={i.image} alt="" style={{ width: 56, height: 56, borderRadius: 10, objectFit: 'cover', border: '1px solid var(--border)', display: 'block' }} />
                    : <span style={{ width: 56, height: 56, borderRadius: 10, border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)' }}><I name="box" size={24} /></span>}
                </Link>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Link to={`/shop/product/${i.product_id}`} className="name" style={{ fontWeight: 650 }}>{i.product_name}</Link>
                  <div className="small muted">{fmt(i.unit_price)} /{i.unit_label || 'piece'} · {fmt(i.pieces)} pieces</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                    <button className="btn sm" onClick={() => setQty(i, Math.max(1, i.quantity - 1))}>−</button>
                    <input className="qty-input" type="number" min="1" value={i.quantity}
                      onChange={(e) => setQty(i, Math.max(1, +e.target.value || 1))} />
                    <span className="muted small">{i.unit_label}</span>
                    <button className="btn sm" onClick={() => setQty(i, i.quantity + 1)}>+</button>
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div className="num" style={{ fontWeight: 700 }}>{fmt(i.unit_price * i.quantity)}</div>
                  <button className="btn sm danger" style={{ marginTop: 6 }} title="Remove item" onClick={() => remove(i)}><I name="x" size={13} /></button>
                </div>
              </div>
            ))}
          </div>
          <div className="card" style={{ position: 'sticky', top: 16 }}>
            <h2>Order summary</h2>
            <div className="cart-total-row"><span>Subtotal</span><span>{fmt(cart.subtotal)} {currency}</span></div>
            <div className="cart-total-row">
              <span>Delivery</span>
              <span>{freeDelivery ? <span style={{ color: 'var(--primary)' }}>Free</span> : fee > 0 ? fmt(fee) : ':'}</span>
            </div>
            {threshold > 0 && !freeDelivery && <div className="small muted">Free delivery on orders over {fmt(threshold)}</div>}
            <div className="cart-total-row cart-grand"><span>Total</span><span>{fmt(cart.subtotal + (freeDelivery ? 0 : fee))} {currency}</span></div>
            <button className="btn primary" style={{ width: '100%', justifyContent: 'center', padding: 12 }} onClick={() => navigate('/shop/checkout')}>
              Proceed to checkout
            </button>
            <Link to="/shop" className="muted small" style={{ display: 'block', textAlign: 'center', marginTop: 10 }}>Continue shopping</Link>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Cart() {
  return <RequireShopAuth><CartInner /></RequireShopAuth>;
}