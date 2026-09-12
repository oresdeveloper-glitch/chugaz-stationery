import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { shopApi, fmt } from '../../lib/api';
import { useShop } from '../../shop/ShopContext';
import { useToast } from '../../components/Toast';
import I from '../../components/icons';

export default function ProductDetail() {
  const { id } = useParams();
  const [p, setP] = useState(null);
  const [qty, setQty] = useState(1);
  const [unit, setUnit] = useState('piece');
  const [variant, setVariant] = useState(null);
  const [info, setInfo] = useState(null);
  const [imgIdx, setImgIdx] = useState(0);
  const { refreshCart } = useShop();
  const toast = useToast();

  useEffect(() => {
    shopApi(`/products/${id}`).then((prod) => {
      setP(prod);
      setImgIdx(0);
      const first = prod.variants && prod.variants.length ? prod.variants[0] : null;
      setVariant(first);
      const eff = first || prod;
      setUnit((eff.units && eff.units[0]) ? eff.units[0].id : 'piece');
    }).catch((e) => toast(e.message, 'error'));
    shopApi('/info').then(setInfo).catch(() => {});
  }, [id]);

  const eff = variant || p;
  const add = async () => {
    try {
      await shopApi('/cart/items', { method: 'POST', body: { product_id: eff.id, quantity: qty, unit } });
      await refreshCart();
      toast(`${qty} ${unit} × ${eff.name} added to cart`);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  if (!p) return <div className="card">Loading...</div>;
  const currency = info?.currency || 'TSh';
  const units = eff.units && eff.units.length ? eff.units : [{ id: 'piece', label: 'Piece', price: eff.piece_price || eff.selling_price, pieces: 1 }];
  const activeUnit = units.find((x) => x.id === unit) || units[0];
  const lineTotal = activeUnit.price * qty;

  const specRows = (eff.specifications || '')
    .split('\n').map((l) => l.trim()).filter(Boolean)
    .map((l) => {
      const i = l.indexOf(':');
      return i > 0 ? { k: l.slice(0, i).trim(), v: l.slice(i + 1).trim() } : { k: '', v: l };
    });

  const variants = p.variants && p.variants.length ? p.variants : null;
  const gallery = (p.images && p.images.length ? p.images : (eff.image ? [eff.image] : []));
  const mainImg = gallery[Math.min(imgIdx, gallery.length - 1)] || null;

  return (
    <div className="pd">
      <Link to="/shop" className="muted small pd-back">← Back to catalog</Link>

      <div className="card pd-hero">
        <div className="pd-media">
          {mainImg
            ? <img src={mainImg} className="pd-main-img" alt={eff.name} />
            : <div className="pd-main-empty" style={{display:'grid',placeItems:'center',color:'var(--muted)',fontWeight:600}}>{eff.name?.[0] || 'P'}</div>}
          {gallery.length > 1 && (
            <div className="pd-thumbs">
              {gallery.map((g, i) => (
                <img key={i} src={g} onClick={() => setImgIdx(i)} className={`pd-thumb${i === imgIdx ? ' on' : ''}`} alt="" />
              ))}
            </div>
          )}
        </div>

        <div className="pd-info">
          <div className="pd-cat">{p.category_name}</div>
          <h1 className="pd-name">{eff.name}</h1>
          <div className="pd-sub">
            {[p.brand_name, eff.unit ? `Sold per ${eff.unit}` : null, eff.sku || p.sku ? `SKU ${eff.sku || p.sku}` : null].filter(Boolean).join('  ·  ')}
          </div>
          {(eff.barcode || p.barcode) && <div className="pd-sub muted small">Barcode: {eff.barcode || p.barcode}</div>}

          <div className="pd-price-panel">
            <div className="pd-price">{fmt(activeUnit.price)} <span>{currency} / {activeUnit.label}</span></div>
            {Number(eff.tax_rate) > 0 && <div className="pd-tax">incl. {eff.tax_rate}% tax</div>}
          </div>

          {variants && (
            <div className="pd-opt">
              <div className="pd-opt-label">Choose option</div>
              <div className="pd-chips">
                {variants.map((v) => (
                  <button key={v.id} className={`pd-chip${variant && variant.id === v.id ? ' on' : ''}`}
                    onClick={() => { setVariant(v); setUnit(v.units && v.units[0] ? v.units[0].id : 'piece'); setQty(1); }}>
                    {v.name} · {fmt(v.units && v.units[0] ? v.units[0].price : v.selling_price)}
                  </button>
                ))}
              </div>
            </div>
          )}
          {units.length > 1 && (
            <div className="pd-opt">
              <div className="pd-opt-label">Pack size</div>
              <div className="pd-chips">
                {units.map((x) => (
                  <button key={x.id} className={`pd-chip${unit === x.id ? ' on' : ''}`}
                    onClick={() => { setUnit(x.id); setQty(1); }}>
                    {x.label} · {fmt(x.price)}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="pd-buy">
            <div className="pd-qty">
              <button onClick={() => setQty(Math.max(1, qty - 1))}>−</button>
              <input type="number" min="1" value={qty} onChange={(e) => setQty(Math.max(1, +e.target.value || 1))} />
              <button onClick={() => setQty(qty + 1)}>+</button>
            </div>
            <button className="btn primary pd-add" onClick={add}>Add to cart</button>
          </div>
          <div className="pd-line">
            {qty} {activeUnit.label.toLowerCase()} × {fmt(activeUnit.price)} = <b>{fmt(lineTotal)} {currency}</b>
            {qty * activeUnit.pieces !== 1 && ` · ${qty * activeUnit.pieces} pieces`}
          </div>
        </div>
      </div>

      {(p.description || specRows.length > 0) && (
        <div className="card pd-details">
          {p.description && (
            <>
              <h2>Details</h2>
              <p className="pd-desc">{p.description}</p>
            </>
          )}
          {specRows.length > 0 && (
            <>
              <h2 style={{ marginTop: p.description ? 18 : 0 }}>Specifications</h2>
              <table className="spec-table">
                <tbody>
                  {specRows.map((r, i) => (
                    <tr key={i}>
                      <td className="spec-k">{r.k}</td>
                      <td>{r.v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}

      {p.similar.length > 0 && (
        <div className="pd-similar">
          <h2>Related products</h2>
          <div className="pd-similar-grid">
            {p.similar.map((s) => (
              <Link key={s.id} to={`/shop/product/${s.id}`} className="pd-mini">
                <div className="pd-mini-img">{s.image ? <img src={s.image} alt={s.name} loading="lazy" /> : <span style={{display:'grid',placeItems:'center',width:'100%',height:'100%',color:'var(--muted)',fontWeight:600}}>{s.name?.[0] || 'P'}</span>}</div>
                <div className="pd-mini-body">
                  <div className="pd-mini-name">{s.name}</div>
                  <div className="pd-mini-price">{fmt(s.selling_price)} <span>{currency}/{s.unit || 'piece'}</span></div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}