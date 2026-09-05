import { useEffect, useState } from 'react';
import { api, fmt, getUser } from '../lib/api';
import { canRole } from '../lib/roles';
import { useToast } from '../components/Toast';
import Modal from '../components/Modal';
import Barcode from '../components/Barcode';
import I from '../components/icons';

const EMPTY = {
  sku: '', barcode: '', name: '', category_id: '', brand_id: '', unit: 'piece',
  purchase_price: 0, selling_price: 0, tax_rate: 0, discount_rate: 0,
  reorder_level: 0, status: 'active', description: '', specifications: '',
  unit_prices: {},
};

export default function Products() {
  const isAdmin = canRole(getUser(), 'admin');
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [brands, setBrands] = useState([]);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [tab, setTab] = useState('products');
  const [modal, setModal] = useState(null);
  const [gallery, setGallery] = useState(null);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const toast = useToast();

  const genBarcode = async () => {
    if (!modal) return;
    setGenerating(true);
    try {
      const r = await api(`/products/barcode/generate${modal.category_id ? `?category_id=${encodeURIComponent(modal.category_id)}` : ''}`);
      setModal({ ...modal, barcode: r.barcode });
      toast(r.shared ? 'Shared category barcode' : 'Unique barcode generated');
    } catch (err) { toast(err.message, 'error'); }
    finally { setGenerating(false); }
  };

  const load = async () => {
    const [p, c, b] = await Promise.all([
      api(`/products${q ? `?q=${encodeURIComponent(q)}` : ''}`),
      api('/products/cats/all'),
      api('/products/brands/all'),
    ]);
    setProducts(p); setCategories(c); setBrands(b);
  };

  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [q, cat]);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { variants, ...base } = modal;
      const body = { ...base, category_id: modal.category_id || null, brand_id: modal.brand_id || null, parent_id: modal.parent_id || null };
      if (variants && variants.length) {
        body.variants = variants.map((v) => ({
          ...v,
          parent_id: null, // admin frontend sends top-level variant rows; backend links them
          selling_price: Number(v.selling_price) || 0,
          current_stock: Number(v.current_stock) || 0,
          purchase_price: Number(v.purchase_price) || 0,
        }));
      }
      if (modal.id) {
        await api(`/products/${modal.id}`, { method: 'PUT', body });
      } else {
        await api('/products', { method: 'POST', body });
      }
      toast(modal.id ? 'Product updated' : 'Product created');
      setModal(null);
      load();
    } catch (err) { toast(err.message, 'error'); }
    finally { setSaving(false); }
  };

  const remove = async (p) => {
    if (!confirm(`Delete product "${p.name}"? (products with history are deactivated)`)) return;
    try {
      await api(`/products/${p.id}`, { method: 'DELETE' });
      toast('Product deleted/deactivated');
      load();
    } catch (err) { toast(err.message, 'error'); }
  };

  const uploadImage = async (p, file) => {
    const fd = new FormData();
    fd.append('image', file);
    try {
      const r = await api(`/products/${p.id}/image`, { method: 'POST', body: fd });
      toast('Image uploaded');
      load();
    } catch (err) { toast(err.message, 'error'); }
  };

  const uploadImages = async (p, files) => {
    if (!files || !files.length) return;
    const fd = new FormData();
    for (const f of files) fd.append('images', f);
    try {
      await api(`/products/${p.id}/images`, { method: 'POST', body: fd });
      toast(`${files.length} photo${files.length > 1 ? 's' : ''} added`);
      load();
      if (gallery && gallery.id === p.id) openGallery(gallery);
    } catch (err) { toast(err.message, 'error'); }
  };

  const openGallery = async (p) => {
    try {
      const full = await api(`/products/${p.id}`);
      setGallery({ id: p.id, name: p.name, images: full.images || [] });
    } catch (err) { toast(err.message, 'error'); }
  };

  const removeImage = async (p, imgId) => {
    try {
      const r = await api(`/products/${p.id}/images/${imgId}`, { method: 'DELETE' });
      setGallery({ ...p, images: r.images || [] });
      load();
    } catch (err) { toast(err.message, 'error'); }
  };

  const addCat = async () => {
    const name = prompt('Category name:');
    if (!name) return;
    try { await api('/products/cats', { method: 'POST', body: { name } }); load(); toast('Category added'); }
    catch (err) { toast(err.message, 'error'); }
  };
  const addBrand = async () => {
    const name = prompt('Brand name:');
    if (!name) return;
    try { await api('/products/brands', { method: 'POST', body: { name } }); load(); toast('Brand added'); }
    catch (err) { toast(err.message, 'error'); }
  };

  const filtered = cat ? products.filter((p) => p.category_id == cat) : products;

  return (
    <div>
      <div className="page-header">
        <h1>Products</h1>
        {isAdmin && tab === 'products' && <button className="btn primary" onClick={() => setModal({ ...EMPTY })}>+ Add product</button>}
        {isAdmin && tab === 'categories' && <button className="btn primary" onClick={addCat}>+ Add category</button>}
        {isAdmin && tab === 'brands' && <button className="btn primary" onClick={addBrand}>+ Add brand</button>}
      </div>

      <div className="toolbar">
        <div className="btn-group">
          {(isAdmin ? ['products', 'categories', 'brands'] : ['products']).map((t) => (
            <button key={t} className={`btn${tab === t ? ' primary' : ''}`} style={{ borderRadius: 0, border: 'none' }} onClick={() => setTab(t)}>
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        {tab === 'products' && (
          <>
            <div className="spacer" />
            <input className="search-input" placeholder="Search by name, SKU or barcode..." value={q} onChange={(e) => setQ(e.target.value)} />
            <select style={{ maxWidth: 220 }} value={cat} onChange={(e) => setCat(e.target.value)}>
              <option value="">All categories</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </>
        )}
      </div>

      {tab === 'products' && (
        <div className="alibaba-grid">
          {filtered.map((p) => (
            <div key={p.id} className="alibaba-card" style={{ cursor: 'default' }}>
              <div className="alibaba-img">
                {p.image ? <img src={p.image} alt={p.name} loading="lazy" /> : <span style={{ display: 'grid', placeItems: 'center', width: '100%', height: '100%', background: 'var(--panel-2)', color: 'var(--muted)', fontWeight: 600 }}>{p.name?.[0] || 'P'}</span>}
              </div>
              <div className="alibaba-card-body">
                <div className="alibaba-name">{p.name}</div>
                <div className="alibaba-brand">{p.category_name || 'No category'} · {p.sku}</div>
                <div className="alibaba-price">
                  <span className="alibaba-price-cur">{fmt(p.selling_price)}</span>
                  <span className="muted small" style={{ fontSize: 11, fontWeight: 700 }}> /{p.unit || 'piece'}</span>
                </div>
                <div className="alibaba-meta">
                  <span>Cost: {fmt(p.purchase_price)}</span>
                  <span style={{ fontWeight: 750, color: p.current_stock <= p.reorder_level ? 'var(--danger)' : 'var(--primary)' }}>
                    Stock: {fmt(p.current_stock)}
                  </span>
                </div>
                {isAdmin && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                    <button className="btn sm primary" style={{ flex: 1 }} onClick={async () => {
                      try {
                        const full = await api(`/products/${p.id}`);
                        setModal({ ...full, unit_prices: full.unit_prices || {}, variants: full.variants || [] });
                      } catch (err) { toast(err.message, 'error'); }
                    }}>Edit</button>
                    <label className="btn sm" style={{ cursor: 'pointer' }} title="Add photos"><I name="camera" size={14} />
                      <input type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={(e) => { uploadImages(p, e.target.files); e.target.value = ''; }} />
                    </label>
                    <button className="btn sm" onClick={() => openGallery(p)} title="Manage photo gallery"><I name="image" size={14} /></button>
                    <button className="btn sm danger" onClick={() => remove(p)} title="Delete product"><I name="x" size={14} /></button>
                  </div>
                )}
              </div>
            </div>
          ))}
          {!filtered.length && <p className="muted" style={{ gridColumn: '1 / -1', textAlign: 'center', padding: 30 }}>No products match your search.</p>}
        </div>
      )}

      {tab === 'categories' && (
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead><tr><th>Name</th><th>Description</th><th></th></tr></thead>
              <tbody>
                {categories.map((c) => (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 600 }}>{c.name}</td>
                    <td className="muted">{c.description || ':'}</td>
                    <td><button className="btn sm danger" onClick={async () => { try { await api(`/products/cats/${c.id}`, { method: 'DELETE' }); load(); } catch (e) { toast(e.message, 'error'); } }}>Delete</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'brands' && (
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead><tr><th>Name</th><th></th></tr></thead>
              <tbody>
                {brands.map((b) => (
                  <tr key={b.id}>
                    <td style={{ fontWeight: 600 }}>{b.name}</td>
                    <td><button className="btn sm danger" onClick={async () => { try { await api(`/products/brands/${b.id}`, { method: 'DELETE' }); load(); } catch (e) { toast(e.message, 'error'); } }}>Delete</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal open={!!modal} onClose={() => setModal(null)} title={modal?.id ? 'Edit product' : 'Add product'} wide>
        <form onSubmit={save}>
          <div className="form-row">
            <div className="field"><label>Name *</label><input required value={modal?.name || ''} onChange={(e) => setModal({ ...modal, name: e.target.value })} /></div>
            <div className="field"><label>Unit</label>
              <select value={modal?.unit || 'piece'} onChange={(e) => setModal({ ...modal, unit: e.target.value })}>
                {['piece', 'box', 'pack', 'dozen', 'set', 'roll', 'kg', 'litre'].map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="field"><label>SKU</label><input value={modal?.sku || ''} onChange={(e) => setModal({ ...modal, sku: e.target.value })} /></div>
            <div className="field">
              <label>Barcode</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input value={modal?.barcode || ''} onChange={(e) => setModal({ ...modal, barcode: e.target.value })} placeholder="Generate or type a barcode" />
                <button type="button" className="btn sm" onClick={genBarcode} disabled={generating}>{generating ? '…' : 'Generate'}</button>
              </div>
            </div>
          </div>
          {/^\d{13}$/.test(modal?.barcode || '') && (
            <div style={{ margin: '4px 0 12px', textAlign: 'center' }}>
              <Barcode code={modal.barcode} />
            </div>
          )}
          <div className="form-row">
            <div className="field"><label>Category</label>
              <select value={modal?.category_id || ''} onChange={(e) => setModal({ ...modal, category_id: e.target.value })}>
                <option value="">None</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="field"><label>Brand</label>
              <select value={modal?.brand_id || ''} onChange={(e) => setModal({ ...modal, brand_id: e.target.value })}>
                <option value="">None</option>
                {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="field"><label>Purchase cost</label><input type="number" step="0.01" value={modal?.purchase_price ?? 0} onChange={(e) => setModal({ ...modal, purchase_price: +e.target.value })} /></div>
            <div className="field"><label>Selling price</label><input type="number" step="0.01" value={modal?.selling_price ?? 0} onChange={(e) => setModal({ ...modal, selling_price: +e.target.value })} /></div>
          </div>
          <div className="form-row">
            <div className="field" style={{ width: '100%' }}>
              <label>Per-unit prices (override, leave blank to auto-calculate)</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                {(modal?.units && modal.units.length ? modal.units : [{ id: 'piece', label: 'Piece', pieces: 1 }, { id: 'dozen', label: 'Dozen', pieces: 12 }]).map((un) => {
                  const ov = (modal?.unit_prices || {})[un.id];
                  return (
                    <div key={un.id} style={{ flex: '1 1 130px', minWidth: 130 }}>
                      <label className="muted small">{un.label} {un.pieces > 1 ? `(${un.pieces} pc)` : ''}</label>
                      <input type="number" step="0.01" placeholder={un.price ? `auto: ${fmt(un.price)}` : ''}
                        value={ov ?? ''} onChange={(e) => {
                          const v = e.target.value;
                          setModal({ ...modal, unit_prices: { ...(modal?.unit_prices || {}), [un.id]: v === '' ? null : +v } });
                        }} />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="form-row">
            <div className="field"><label>Tax rate %</label><input type="number" step="0.01" value={modal?.tax_rate ?? 0} onChange={(e) => setModal({ ...modal, tax_rate: +e.target.value })} /></div>
            <div className="field"><label>Reorder level</label><input type="number" step="0.01" value={modal?.reorder_level ?? 0} onChange={(e) => setModal({ ...modal, reorder_level: +e.target.value })} /></div>
          </div>
          <div className="form-row">
            <div className="field"><label>Initial stock</label><input type="number" step="0.01" value={modal?.current_stock ?? 0} onChange={(e) => setModal({ ...modal, current_stock: +e.target.value })} /></div>
            <div className="field"><label>Status</label>
              <select value={modal?.status || 'active'} onChange={(e) => setModal({ ...modal, status: e.target.value })}>
                <option value="active">Active</option><option value="inactive">Inactive</option>
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="field"><label>Description</label><textarea rows="3" value={modal?.description || ''} onChange={(e) => setModal({ ...modal, description: e.target.value })} placeholder="Product overview shown on the shop" /></div>
          </div>
          <div className="form-row">
            <div className="field"><label>Specifications</label><textarea rows="4" value={modal?.specifications || ''} onChange={(e) => setModal({ ...modal, specifications: e.target.value })} placeholder="One per line, e.g.:&#10;Size: A4&#10;Pages: 100&#10;Material: Paper" /></div>
          </div>
          <div className="form-row">
            <div className="field" style={{ width: '100%' }}>
              <label>Mini options / variants (optional) <span className="muted small"> : e.g. A4, A3, A5, Gloss for a ream. Each has its own price & stock.</span></label>
              {(modal?.variants || []).length === 0 && (
                <div className="muted small" style={{ margin: '4px 0 10px' }}>No variants yet. Add options like sizes (A4/A3/A5) or types (Gloss/Matte).</div>
              )}
              {(modal?.variants || []).map((v, idx) => (
                <div key={v._k ?? idx} style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: 8 }}>
                  <input style={{ flex: '2 1 160px', minWidth: 120 }} placeholder="Name (e.g. A4 70gsm)" value={v.name || ''} onChange={(e) => setModal({ ...modal, variants: (modal.variants || []).map((x, i) => i === idx ? { ...x, name: e.target.value } : x) })} />
                  <input style={{ flex: '1 1 100px', minWidth: 80 }} type="number" step="0.01" placeholder="Price" value={v.selling_price ?? ''} onChange={(e) => setModal({ ...modal, variants: (modal.variants || []).map((x, i) => i === idx ? { ...x, selling_price: e.target.value } : x) })} />
                  <input style={{ flex: '1 1 90px', minWidth: 70 }} type="number" step="0.01" placeholder="Cost" value={v.purchase_price ?? ''} onChange={(e) => setModal({ ...modal, variants: (modal.variants || []).map((x, i) => i === idx ? { ...x, purchase_price: e.target.value } : x) })} />
                  <input style={{ flex: '1 1 80px', minWidth: 60 }} type="number" step="0.01" placeholder="Stock" value={v.current_stock ?? ''} onChange={(e) => setModal({ ...modal, variants: (modal.variants || []).map((x, i) => i === idx ? { ...x, current_stock: e.target.value } : x) })} />
                  <select style={{ flex: '1 1 80px', minWidth: 70 }} value={v.unit || 'pack'} onChange={(e) => setModal({ ...modal, variants: (modal.variants || []).map((x, i) => i === idx ? { ...x, unit: e.target.value } : x) })}>
                    {['piece', 'box', 'pack', 'dozen', 'set', 'roll', 'kg', 'litre'].map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                  <input style={{ flex: '1 1 110px', minWidth: 90 }} placeholder="SKU" value={v.sku || ''} onChange={(e) => setModal({ ...modal, variants: (modal.variants || []).map((x, i) => i === idx ? { ...x, sku: e.target.value } : x) })} />
                  <button type="button" className="btn sm danger" onClick={() => setModal({ ...modal, variants: (modal.variants || []).filter((_, i) => i !== idx) })}>Remove</button>
                </div>
              ))}
              <button type="button" className="btn sm" onClick={() => setModal({ ...modal, variants: [...(modal.variants || []), { name: '', selling_price: '', purchase_price: '', current_stock: '', unit: modal?.unit || 'pack', sku: '' }] })}>+ Add variant</button>
            </div>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn" onClick={() => setModal(null)}>Cancel</button>
            <button type="submit" className="btn primary" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!gallery} onClose={() => setGallery(null)} title={`Photos : ${gallery?.name || ''}`}>
        {gallery && (
          <div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {(gallery.images || []).map((im) => (
                <div key={im.id} style={{ position: 'relative' }}>
                  <img src={im.path} style={{ width: 110, height: 110, objectFit: 'cover', borderRadius: 10, border: '1px solid var(--border)' }} />
                  <button
                    className="btn sm danger"
                    style={{ position: 'absolute', top: 4, right: 4, padding: '2px 7px', borderRadius: '50%' }}
                    onClick={() => removeImage(gallery, im.id)}
                    title="Remove photo"
                  >×</button>
                </div>
              ))}
              {!gallery.images || !gallery.images.length ? <p className="muted">No photos yet.</p> : null}
            </div>
            <div className="sep" style={{ borderTop: '1px solid var(--border)', margin: '14px 0' }} />
            <label className="btn primary" style={{ cursor: 'pointer' }}>
              + Add photos (select several)
              <input type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={(e) => { uploadImages(gallery, e.target.files); e.target.value = ''; }} />
            </label>
            <p className="muted small" style={{ marginTop: 8 }}>First photo is used as the main image on the storefront.</p>
          </div>
        )}
      </Modal>
    </div>
  );
}