import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, fmt, getUser } from '../lib/api';
import { useToast } from '../components/Toast';
import { takeScanned } from '../lib/scanStore';
import I from '../components/icons';

const RECEIPT_STYLE = `
  #receipt { font-family: monospace; font-size: 12px; width: 80mm; padding: 10px 8px; color: #000; background: #fff; }
  #receipt .rlogo { display: block; margin: 0 auto 7px; max-width: 40mm; max-height: 15mm; object-fit: contain; }
  #receipt .center { text-align: center; }
  #receipt h2 { font-size: 16px; margin: 0 0 3px; letter-spacing: .06em; text-transform: uppercase; }
  #receipt .sub { text-align: center; font-size: 11px; line-height: 1.5; color: #222; }
  #receipt .sep { border-top: 1px solid #000; margin: 7px 0; }
  #receipt .sep2 { border-top: 1px solid #000; margin: 6px 0; }
  #receipt table { width: 100%; border-collapse: collapse; }
  #receipt th { text-align: left; font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; border-bottom: 1px solid #000; padding: 3px 0; }
  #receipt th.r, #receipt td.r { text-align: right; white-space: nowrap; }
  #receipt td { padding: 3.5px 0; font-size: 12px; vertical-align: top; }
  #receipt td .nm { font-weight: bold; display: block; }
  #receipt td .un { font-size: 10.5px; color: #333; }
  #receipt .kv { display: flex; justify-content: space-between; padding: 2px 0; font-size: 11.5px; }
  #receipt .total { display: flex; justify-content: space-between; font-size: 17px; font-weight: bold; padding: 4px 0 2px; }
  #receipt .foot { text-align: center; font-size: 11px; line-height: 1.6; margin-top: 8px; }
  #receipt .foot b { letter-spacing: .04em; }
  @media print {
    body * { visibility: hidden; }
    #receipt, #receipt * { visibility: visible; }
    #receipt { position: absolute; left: 0; top: 0; width: 80mm; }
  }
`;

function beep(ok = true) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = ok ? 1046 : 300;
    g.gain.value = 0.06;
    o.start();
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + (ok ? 0.12 : 0.25));
    o.stop(ctx.currentTime + (ok ? 0.15 : 0.3));
  } catch (e) { /* ignore */ }
}

export default function Pos() {
  const [products, setProducts] = useState([]);
  const [q, setQ] = useState('');
  const [cart, setCart] = useState([]);
  const [customerId, setCustomerId] = useState('');
  const [customers, setCustomers] = useState([]);
  const [method, setMethod] = useState('cash');
  const [discount, setDiscount] = useState(0);
  const [paid, setPaid] = useState('');
  const [settings, setSettings] = useState({});
  const [saving, setSaving] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [shift, setShift] = useState({ count: 0, total: 0 });
  const [held, setHeld] = useState([]);
  const searchRef = useRef(null);
  const toast = useToast();
  const navigate = useNavigate();
  const me = getUser();
  const isCashier = (me && me.role) === 'cashier';
  const heldKey = `pos_held_${me?.id || 0}`;

  const loadHeld = () => {
    try { setHeld(JSON.parse(localStorage.getItem(heldKey) || '[]')); } catch { setHeld([]); }
  };
  const saveHeld = (list) => {
    setHeld(list);
    localStorage.setItem(heldKey, JSON.stringify(list));
  };

  const loadShift = async () => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const rows = await api(`/sales?from=${today}&to=${today}&created_by=${me?.id || ''}`);
      setShift({ count: rows.length, total: rows.reduce((s, r) => s + Number(r.total || 0), 0) });
    } catch { /* non-critical */ }
  };

  useEffect(() => { loadHeld(); loadShift(); }, []);

  useEffect(() => {
    const pending = takeScanned();
    if (pending && pending.length) {
      setCart((c) => {
        const next = [...c];
        for (const p of pending) {
          const f = next.find((x) => x.product_id === p.product_id);
          if (f) f.quantity += p.quantity;
          else next.push({ product_id: p.product_id, name: p.name, price: p.price, unit: p.unit, stock: p.stock, quantity: p.quantity });
        }
        return next;
      });
      toast(`${pending.length} item${pending.length === 1 ? '' : 's'} added from the scanner`);
    }
  }, [toast]);

  const loadProducts = async (term) => {
    try {
      const p = await api(`/products${term ? `?q=${encodeURIComponent(term)}` : ''}`);
      setProducts(p.filter((x) => x.status === 'active'));
    } catch (e) { toast(e.message, 'error'); }
  };

  useEffect(() => {
    loadProducts();
    api('/customers').then(setCustomers).catch(() => {});
    api('/system/settings').then(setSettings).catch(() => {});
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    const t = setTimeout(() => loadProducts(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const addToCart = (p) => {
    setCart((c) => {
      const found = c.find((i) => i.product_id === p.id);
      if (found) {
        return c.map((i) => (i.product_id === p.id ? { ...i, quantity: i.quantity + 1 } : i));
      }
      return [...c, { product_id: p.id, name: p.name, price: p.selling_price, unit: p.unit, image: p.image || null, stock: p.in_stock ? 1 : 0, quantity: 1 }];
    });
    setQ('');
    beep(true);
    searchRef.current?.focus();
  };

  const subtotal = cart.reduce((s, i) => s + i.price * i.quantity, 0);
  const discVal = Math.min(Number(discount) || 0, subtotal);
  const total = Math.max(subtotal - discVal, 0);
  const paidVal = paid === '' ? total : Number(paid) || 0;
  const change = paidVal - total;

  const complete = async () => {
    if (cart.length === 0) return toast('Cart is empty', 'error');
    setSaving(true);
    try {
      const body = {
        customer_id: customerId || null,
        items: cart.map((i) => ({ product_id: i.product_id, quantity: i.quantity, unit_price: i.price })),
        discount: discount,
        payment_method: method,
        paid_amount: paidVal,
      };
      const result = await api('/sales', { method: 'POST', body });
      const sale = await api(`/sales/${result.id}`);
      setReceipt(sale);
      setCart([]); setDiscount(0); setPaid(''); setCustomerId('');
      loadProducts();
      loadShift();
    } catch (err) { toast(err.message, 'error'); }
    finally { setSaving(false); }
  };

  const holdSale = () => {
    if (cart.length === 0) return toast('Nothing to hold : cart is empty', 'error');
    if (held.length >= 6) return toast('Held sales full (6) : resume or clear one first', 'error');
    const entry = {
      id: Date.now(),
      at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      customer: customerId,
      discount,
      items: cart,
    };
    saveHeld([entry, ...held]);
    setCart([]); setDiscount(0); setCustomerId(''); setPaid('');
    toast(`Sale held (${entry.items.length} items) : start the next customer`, 'info');
    searchRef.current?.focus();
  };

  const resumeSale = (h) => {
    setCart(h.items);
    setCustomerId(h.customer || '');
    setDiscount(h.discount || 0);
    saveHeld(held.filter((x) => x.id !== h.id));
    toast(`Resumed held sale (${h.items.length} items)`, 'info');
    searchRef.current?.focus();
  };

  const dropHeld = (id) => saveHeld(held.filter((x) => x.id !== id));

  // Keyboard shortcuts: F2 search, F4 complete sale, Esc clear search
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'F2') { e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select(); }
      else if (e.key === 'F4') { e.preventDefault(); if (cart.length) complete(); }
      else if (e.key === 'Escape' && document.activeElement === searchRef.current) setQ('');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const printReceipt = () => window.print();

  const currency = settings.currency || 'TSh';

  return (
    <div className="pos-premium">
      <div className="pos-header">
        <div className="pos-header-left">
          <div className="pos-title-wrap">
            <h1>Point of Sale</h1>
            <span className="pos-subtitle">Fast checkout · Scan · Hold & resume</span>
          </div>
          <div className="pos-shift">
            <span className="pos-shift-dot" />
            <span className="pos-shift-label">Today</span>
            <span className="pos-shift-val"><b>{shift.count}</b> sales</span>
            <span className="pos-shift-sep">·</span>
            <span className="pos-shift-total">{fmt(shift.total)} <small>{currency}</small></span>
          </div>
          {me?.office && (
            <div className="pos-shift">
              <span className="pos-shift-dot" style={{ background: 'var(--accent)', boxShadow: '0 0 0 3px color-mix(in srgb, var(--accent) 24%, transparent)' }} />
              <span className="pos-shift-label">Office</span>
              <span className="pos-shift-val"><b>{me.office}</b></span>
            </div>
          )}
        </div>
        <div className="pos-header-right">
          <span className="pos-hints">{!isCashier && (<><kbd>F2</kbd> search · </>)}<kbd>F4</kbd> complete</span>
          <button className="btn primary pos-scan-btn" onClick={() => navigate('/scan')}><I name="scan" size={15} /> Scan</button>
        </div>
      </div>

      <div className="pos-layout">
        <div className="pos-left">
          {isCashier ? (
            <div className="card pos-scan-prompt">
              <div className="pos-scan-prompt-icon"><I name="scan" size={30} /></div>
              <h3>Scan to add products</h3>
              <p className="muted small">Use the barcode scanner to add items to the sale. Product tapping is disabled for cashiers.</p>
              <button className="btn primary" onClick={() => navigate('/scan')}><I name="scan" size={15} /> Open scanner</button>
            </div>
          ) : (
            <>
              <div className="card pos-scan-card">
                <div className="pos-scan-label">
                  <span className="pos-scan-icon"><I name="search" size={18} /></span>
                  <div>
                    <b>Find products</b>
                    <span className="muted small"> Scan a barcode, or type a name and press Enter</span>
                  </div>
                </div>
                <div className="pos-scan-row">
                  <div className="pos-search-wrap">
                    <I name="search" size={16} />
                    <input
                      ref={searchRef}
                      placeholder="Scan barcode or search by name…"
                      value={q}
                      onChange={(e) => { setQ(e.target.value); }}
                      onKeyDown={(e) => { if (e.key === 'Enter' && products.length > 0) { addToCart(products[0]); } }}
                      autoFocus
                    />
                    {q && <button className="pos-clear" onClick={() => setQ('')}>×</button>}
                  </div>
                  <button className="btn primary pos-cam-btn" onClick={() => navigate('/scan')}><I name="camera" size={14} /> Camera</button>
                </div>
                {q && products.length > 0 && (
                  <div className="pos-hint muted small">Press <kbd>Enter</kbd> to add <b>{products[0].name}</b> · {fmt(products[0].selling_price)}</div>
                )}
              </div>

              <div className="pos-cat-head">
                <span>Products</span>
                <span className="pos-cat-count">{products.length}</span>
              </div>
              <div className="pos-products">
                {products.length === 0 && <div className="muted" style={{ padding: 24, textAlign: 'center' }}>No products found.</div>}
                {products.map((p) => (
                  <button type="button" className="pos-tile" key={p.id} onClick={() => addToCart(p)}>
                    <div className="pimg">{p.image ? <img src={p.image} alt="" /> : <span style={{fontWeight:700,color:"var(--muted)"}}>{p.name?.[0] || "P"}</span>}</div>
                    <div className="pname">{p.name}</div>
                    <div className="pprice">{fmt(p.selling_price)}</div>
                    <div className="pstock">{p.in_stock ? `${fmt(p.in_stock)} ${p.unit || ''} in stock`.trim() : 'Out of stock'}</div>
                  </button>
                ))}
              </div>
            </>
          )}

        </div>

        <div className="card pos-cart">
          <div className="pos-cart-head">
            <h2>Cart <span className="pos-cart-badge">{cart.length}</span></h2>
            {cart.length > 0 && (
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn sm" onClick={holdSale} title="Park this sale and serve the next customer">Hold</button>
                <button className="btn sm danger" onClick={() => { if (confirm('Clear all items from the cart?')) { setCart([]); setDiscount(0); setPaid(''); } }}>Clear</button>
              </div>
            )}
          </div>

          {held.length > 0 && (
            <div style={{ margin: '10px 0 4px', padding: '9px 11px', background: 'var(--panel-2)', borderRadius: 10, border: '1px solid var(--border-strong)' }}>
              <div className="small muted" style={{ fontWeight: 700, marginBottom: 6 }}>Held sales ({held.length})</div>
              {held.map((h) => (
                <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}>
                  <span className="small" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <b>{h.items.length} items</b> · {fmt(h.items.reduce((s, i) => s + i.price * i.quantity, 0))} · {h.at}
                  </span>
                  <button className="btn sm primary" onClick={() => resumeSale(h)}>Resume</button>
                  <button className="btn sm danger" title="Discard" onClick={() => dropHeld(h.id)}>x</button>
                </div>
              ))}
            </div>
          )}

          {cart.length === 0 && <div className="pos-empty"><I name="cart" size={28} /><p>Cart is empty</p><span className="muted small">Scan or search to add items</span></div>}
          {cart.map((i) => (
            <div className="pos-line" key={i.product_id}>
              <div className="pos-line-img">{i.image ? <img src={i.image} alt="" /> : <span style={{fontWeight:700,color:"var(--muted)"}}>{i.name?.[0] || "P"}</span>}</div>
              <div className="pos-line-main">
                <span className="pos-line-name">{i.name}</span>
                <span className="muted small">{fmt(i.price)} · {i.unit || 'piece'}</span>
              </div>
              <div className="pos-qty">
                <button onClick={() => setCart((c) => c.map((x) => x.product_id === i.product_id ? { ...x, quantity: Math.max(1, x.quantity - 1) } : x))}>−</button>
                <input type="number" min="1" value={i.quantity} onChange={(e) => setCart((c) => c.map((x) => x.product_id === i.product_id ? { ...x, quantity: Math.max(1, +e.target.value) } : x))} />
                <button onClick={() => setCart((c) => c.map((x) => x.product_id === i.product_id ? { ...x, quantity: x.quantity + 1 } : x))}>+</button>
              </div>
              <span className="pos-line-total">{fmt(i.price * i.quantity)}</span>
              <button className="pos-del" onClick={() => setCart((c) => c.filter((x) => x.product_id !== i.product_id))}>×</button>
            </div>
          ))}
          <div className="pos-totals">
            <div className="pos-row"><span>Subtotal</span><span>{fmt(subtotal)}</span></div>
            <div className="pos-row">
              <span>Discount</span>
              <div className="pos-disc-wrap">
                <input type="number" min="0" value={discount} onChange={(e) => setDiscount(+e.target.value)} placeholder="0" />
                <small>{currency}</small>
              </div>
            </div>
            <div className="pos-row pos-grand"><span>Total</span><span>{fmt(total)} <small>{currency}</small></span></div>
          </div>

          <div className="pos-fields">
            <div className="field">
              <label>Customer</label>
              <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                <option value="">Walk-in customer</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Payment</label>
              <select value={method} onChange={(e) => setMethod(e.target.value)}>
                {['cash', 'card', 'bank_transfer', 'mobile_money', 'credit'].map((m) => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}
              </select>
            </div>
          </div>
          <div className="field pos-paid-field">
            <label>Amount received</label>
            <input type="number" step="0.01" value={paid} onChange={(e) => setPaid(e.target.value)} placeholder={fmt(total)} />
          </div>

          {method !== 'credit' && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
              <button className="btn sm" onClick={() => setPaid(total.toFixed(2))}>Exact</button>
              {[1000, 2000, 5000, 10000, 20000].filter((v) => v >= total * 0.5).map((v) => (
                <button key={v} className="btn sm" onClick={() => setPaid(v.toFixed(2))}>{fmt(v)}</button>
              ))}
            </div>
          )}

          {method !== 'credit' && change > 0 && (
            <div className="pos-change">
              <span>Change due</span>
              <b>{fmt(change)} <small>{currency}</small></b>
            </div>
          )}
          {method !== 'credit' && change < 0 && (
            <div className="pos-unpaid">Unpaid balance: {fmt(-change)} {currency}</div>
          )}

          <button className="btn primary" style={{ width: '100%', justifyContent: 'center', padding: 13, fontSize: 15 }} disabled={saving || cart.length === 0} onClick={complete}>
            {saving ? 'Processing…' : `Complete sale · ${fmt(total)} ${currency}`} <span className="muted" style={{ fontWeight: 500, marginLeft: 6, color: 'rgba(255,255,255,.75)' }}>F4</span>
          </button>
        </div>
      </div>

      {receipt && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setReceipt(null)}>
          <div className="modal">
            <style>{RECEIPT_STYLE}</style>
            <div id="receipt">
              <img src="/logo-doc.png?v=2" alt="" className="rlogo" />
              <h2>{settings.shop_name || ''}</h2>
              {settings.shop_address && <div className="sub">{settings.shop_address}</div>}
              {settings.shop_phone && <div className="sub">Tel: {settings.shop_phone}</div>}
              <div className="sep" />
              <div className="kv"><span>Receipt</span><span>{receipt.invoice_number}</span></div>
              <div className="kv"><span>Date</span><span>{new Date(receipt.sale_date).toLocaleString()}</span></div>
              <div className="kv"><span>Customer</span><span>{receipt.customer_name || 'Walk-in'}</span></div>
              <div className="sep" />
              <table>
                <thead><tr><th>Item</th><th className="r">Amount</th></tr></thead>
                <tbody>
                  {receipt.items.map((i) => (
                    <tr key={i.id}>
                      <td><span className="nm">{i.product_name}</span><span className="un">{fmt(i.quantity)} × {fmt(i.unit_price)}</span></td>
                      <td className="r">{fmt(i.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="sep" />
              <div className="kv"><span>Subtotal</span><span>{fmt(receipt.subtotal)}</span></div>
              {Number(receipt.discount) > 0 && <div className="kv"><span>Discount</span><span>-{fmt(receipt.discount)}</span></div>}
              {Number(receipt.tax) > 0 && <div className="kv"><span>Tax</span><span>{fmt(receipt.tax)}</span></div>}
              <div className="sep2" />
              <div className="total"><span>TOTAL</span><span>{fmt(receipt.total)} {currency}</span></div>
              <div className="sep2" />
              <div className="kv"><span>Paid ({String(receipt.payment_method).replace(/_/g, ' ')})</span><span>{fmt(receipt.paid_amount)}</span></div>
              {Number(receipt.paid_amount) > Number(receipt.total) && (
                <div className="kv"><span>Change</span><span>{fmt(Number(receipt.paid_amount) - Number(receipt.total))}</span></div>
              )}
              <div className="sep" />
              <div className="foot"><b>{settings.receipt_footer || 'Thank you for your purchase!'}</b><br />Please keep this receipt for your records.</div>
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => { setReceipt(null); searchRef.current?.focus(); }}>New sale (F2)</button>
              <button className="btn primary" onClick={printReceipt}>Print receipt</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}