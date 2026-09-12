import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { shopApi, fmt } from '../../lib/api';
import { useShop } from '../../shop/ShopContext';
import { useToast } from '../../components/Toast';
import I from '../../components/icons';

export default function Catalog() {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [info, setInfo] = useState(null);
  const [params, setParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const { refreshCart } = useShop();
  const toast = useToast();
  const navigate = useNavigate();

  const q = params.get('q') || '';
  const cat = params.get('category') || '';
  const sort = params.get('sort') || '';

  useEffect(() => {
    shopApi('/info').then(setInfo).catch(() => {});
    shopApi('/categories').then(setCategories).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    const query = new URLSearchParams();
    if (q) query.set('q', q);
    if (cat) query.set('category_id', cat);
    if (sort) query.set('sort', sort);
    shopApi(`/products?${query.toString()}`)
      .then(setProducts)
      .catch((e) => toast(e.message, 'error'))
      .finally(() => setLoading(false));
  }, [q, cat, sort]);

  const add = async (e, p) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await shopApi('/cart/items', { method: 'POST', body: { product_id: p.id, quantity: 1 } });
      await refreshCart();
      toast(`${p.name} added to cart`);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const currency = info?.currency || 'TSh';
  const setParam = (k, v) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    setParams(next);
  };
  const activeCat = categories.find((c) => c.id == cat);

  const catGrad = (name) => {
    const n = (name || '').toLowerCase();
    if (n.includes('paper') || n.includes('print')) return 'cat-g-blue';
    if (n.includes('notebook') || n.includes('book')) return 'cat-g-violet';
    if (n.includes('writing') || n.includes('draw')) return 'cat-g-amber';
    if (n.includes('file')) return 'cat-g-teal';
    if (n.includes('electronic') || n.includes('ink')) return 'cat-g-indigo';
    if (n.includes('machine') || n.includes('equipment')) return 'cat-g-slate';
    if (n.includes('school') || n.includes('board')) return 'cat-g-rose';
    if (n.includes('fasten')) return 'cat-g-cyan';
    if (n.includes('craft') || n.includes('display')) return 'cat-g-orange';
    if (n.includes('household')) return 'cat-g-green';
    return 'cat-g-navy';
  };

  const allCat = { id: '', name: 'All products', desc: 'Browse everything' };
  const row1 = [allCat, ...categories.slice(0, 5)];
  const row2 = categories.slice(5);

  return (
    <div className="alibaba-layout">
      <div className="alibaba-main">
        <div className="cat-slider-head">
          <div className="cat-slider-title">Categories</div>
          <span className="cat-slider-hint">{categories.length} categories</span>
        </div>
        <div className="cat-rows">
          <div className="cat-row">
            {row1.map((c) => (
              <button key={c.id || 'all'} className={`cat-slide-card ${cat == c.id ? 'active' : ''}`} onClick={() => setParam('category', cat == c.id ? '' : c.id)}>
                <span className={`cat-slide-ico ${c.id === '' ? 'cat-g-navy' : catGrad(c.name)}${c.image ? ' has-img' : ''}`}>
                  {c.id === '' ? <I name="cart" size={24} /> : (c.image ? <img src={c.image} alt={c.name} /> : <span style={{fontWeight:700,color:"var(--muted)"}}>S</span>)}
                </span>
                <span className="cat-slide-txt">
                  <span className="cat-slide-name">{c.name}</span>
                  <span className="cat-slide-cnt">{c.id === '' ? 'Browse everything' : `${c.product_count || 0} items`}</span>
                </span>
              </button>
            ))}
          </div>
          {row2.length > 0 && (
            <div className="cat-row">
              {row2.map((c) => (
                <button key={c.id} className={`cat-slide-card ${cat == c.id ? 'active' : ''}`} onClick={() => setParam('category', cat == c.id ? '' : c.id)}>
                  <span className={`cat-slide-ico ${catGrad(c.name)}${c.image ? ' has-img' : ''}`}>
                    {c.image ? <img src={c.image} alt={c.name} /> : <span style={{fontWeight:700,color:"var(--muted)"}}>S</span>}
                  </span>
                  <span className="cat-slide-txt">
                    <span className="cat-slide-name">{c.name}</span>
                    <span className="cat-slide-cnt">{c.product_count || 0} items</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="alibaba-toolbar">
          <div className="alibaba-title">
            {q ? `Results for "${q}"` : activeCat?.name || 'All products'}
            <span className="alibaba-count">{products.length} items</span>
          </div>
          <select className="alibaba-sort" value={sort} onChange={(e) => setParam('sort', e.target.value)}>
            <option value="">Recommended</option>
            <option value="name">Name A-Z</option>
            <option value="price_low">Price low to high</option>
            <option value="price_high">Price high to low</option>
          </select>
        </div>

        {loading ? <div className="card">Loading...</div> : (
          <div className="alibaba-grid">
            {products.length === 0 && <p className="muted">No products found.</p>}
            {products.map((p) => (
              <Link key={p.id} to={`/shop/product/${p.id}`} className="alibaba-card" style={p.in_stock === false ? { opacity: 0.62 } : {}}>
                <div className="alibaba-img">
                  {p.image ? <img src={p.image} alt={p.name} loading="lazy" /> : <span style={{fontWeight:700,color:"var(--muted)"}}>{p.name?.[0] || "P"}</span>}
                </div>
                <div className="alibaba-card-body">
                  <div className="alibaba-name">
                    {p.name}
                    {p.in_stock === false && <span className="badge red" style={{ marginLeft: 8, verticalAlign: 'middle' }}>Out of stock</span>}
                  </div>
                  <div className="alibaba-brand">{p.brand_name || 'Unbranded'}</div>
                  <div className="alibaba-price">
                    <span className="alibaba-price-cur">{currency}</span>
                    {fmt(p.selling_price)}
                    <span className="muted small" style={{ fontSize: 11, fontWeight: 700 }}> /{p.unit || 'piece'}</span>
                  </div>
                  <div className="alibaba-meta">
                    <span>price per {p.unit || 'piece'}</span>
                  </div>
                  <div className="alibaba-actions">
                    <button
                      className="alibaba-view"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); navigate(`/shop/product/${p.id}`); }}
                    >
                      <I name="search" size={13} /> View details
                    </button>
                    <button className="alibaba-add" disabled={p.in_stock === false} onClick={(e) => add(e, p)}>
                      {p.in_stock === false ? 'Out of stock' : 'Add to cart'}
                    </button>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}