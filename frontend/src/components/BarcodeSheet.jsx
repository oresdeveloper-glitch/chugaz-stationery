import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../lib/api';
import { orderCats, categoryBarcode } from '../lib/cats';
import Barcode from './Barcode';

// Print every barcode on A4 label sheets (3 columns x 8 rows). Two variants:
//   kind="products"   - one label per active product barcode (default)
//   kind="categories" - one label per category (top-level and subcategory)
// Admin-only feature: the buttons that open this live behind the admin role.
// "Print" opens the browser dialog, where "Save as PDF" produces the file.
const SHEET_CSS = `
.bc-overlay { position: fixed; inset: 0; z-index: 70; background: rgba(9,14,28,.55); display: flex; align-items: center; justify-content: center; padding: 16px; }
.bc-panel { background: #fff; color: #111; border: 1px solid #dde3ea; border-radius: 12px; box-shadow: 0 18px 50px rgba(0,0,0,.28); width: min(920px, 100%); max-height: 92vh; display: flex; flex-direction: column; overflow: hidden; }
.bc-toolbar { display: flex; align-items: center; gap: 10px; padding: 14px 18px; border-bottom: 1px solid #e5e9ef; flex-wrap: wrap; }
.bc-toolbar h2 { font-size: 16px; margin: 0; }
.bc-toolbar .bc-grow { flex: 1 1 auto; }
.bc-note { padding: 8px 18px; font-size: 12px; color: #55606b; border-bottom: 1px solid #eef1f5; }
.bc-preview { overflow: auto; padding: 14px; background: #e9eef3; flex: 1 1 auto; }
.bc-sheet { width: 198mm; margin: 0 auto; background: #fff; color: #111; font-family: Arial, Helvetica, sans-serif; box-shadow: 0 4px 18px rgba(0,0,0,.12); padding: 3mm; box-sizing: border-box; }
.bc-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.5mm; }
.bc-label { height: 32mm; box-sizing: border-box; border: .2mm dashed #cfd6dd; border-radius: 1mm; padding: 1mm 1.5mm; display: flex; flex-direction: column; align-items: center; justify-content: center; overflow: hidden; }
.bc-name { font-size: 8.5pt; font-weight: 700; line-height: 1.12; text-align: center; width: 100%; max-height: 2.24em; overflow: hidden; }
.bc-sub { font-size: 6.5pt; color: #55606b; margin-top: .4mm; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bc-bars { margin-top: .8mm; display: flex; justify-content: center; width: 100%; }
.bc-empty { padding: 40px 18px; text-align: center; color: #55606b; }
@page { size: A4 portrait; margin: 6mm; }
@media print {
  html body #root { display: none !important; }
  html body .global-print-footer { display: none !important; }
  html body .bc-overlay { position: static !important; display: block !important; background: #fff !important; padding: 0 !important; }
  html body .bc-panel { box-shadow: none !important; border: 0 !important; border-radius: 0 !important; width: auto !important; max-width: none !important; max-height: none !important; overflow: visible !important; }
  html body .bc-toolbar, html body .bc-note { display: none !important; }
  html body .bc-preview { overflow: visible !important; max-height: none !important; padding: 0 !important; background: #fff !important; }
  html body .bc-sheet { width: 100% !important; box-shadow: none !important; margin: 0 !important; padding: 0 !important; }
  html body .bc-label { break-inside: avoid; page-break-inside: avoid; }
}
`;

const TITLES = {
  products: 'All product barcodes',
  categories: 'All category barcodes',
};

export default function BarcodeSheet({ open, onClose, kind = 'products' }) {
  const isCats = kind === 'categories';
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    setError('');
    (isCats ? api('/products/cats/all') : api('/products'))
      .then((list) => { if (alive) setRows(Array.isArray(list) ? list : []); })
      .catch((e) => { if (alive) setError(e.message || 'Could not load the list'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, isCats]);

  // The print stylesheet hides the app shell, so the sheet must be a sibling of
  // #root. The body class keeps those rules from touching normal printing.
  useEffect(() => {
    if (!open) return;
    const prevTitle = document.title;
    document.body.classList.add('bc-printing');
    document.title = TITLES[kind] || TITLES.products;
    return () => {
      document.body.classList.remove('bc-printing');
      document.title = prevTitle;
    };
  }, [open, kind]);

  const labels = useMemo(() => {
    if (isCats) {
      // Every category has a shared barcode derived from its id, so a category
      // added a second ago (B1, B2, ...) is already printable here.
      return orderCats(rows).map((c) => {
        const parent = c.parent_id ? rows.find((x) => Number(x.id) === Number(c.parent_id)) : null;
        return {
          key: c.id,
          name: c.name || 'Unnamed category',
          sub: parent ? `in ${parent.name}` : 'Category',
          barcode: String(c.barcode || categoryBarcode(c.id) || ''),
        };
      }).filter((r) => r.barcode);
    }
    const active = rows.filter((p) => p.status !== 'inactive');
    return active.filter((p) => String(p.barcode || '').trim()).map((p) => ({
      key: p.id,
      name: p.name || 'Unnamed product',
      sub: p.sku,
      barcode: String(p.barcode),
    }));
  }, [rows, isCats]);

  const missing = useMemo(() => {
    if (isCats) return 0;
    const active = rows.filter((p) => p.status !== 'inactive');
    return active.filter((p) => !String(p.barcode || '').trim()).length;
  }, [rows, isCats]);

  if (!open) return null;

  const title = TITLES[kind] || TITLES.products;

  const sheet = (
    <div className="bc-sheet" id="all-barcode-sheet">
      <div className="bc-grid">
        {labels.map((row) => (
          <div className="bc-label" key={row.key}>
            <div className="bc-name">{row.name}</div>
            {row.sub ? <div className="bc-sub">{row.sub}</div> : null}
            <div className="bc-bars">
              <Barcode code={row.barcode} height={30} module={1.6} maxWidth={180} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return createPortal(
    <>
      <style>{SHEET_CSS}</style>
      <div className="bc-overlay" role="dialog" aria-modal="true" aria-label={title}>
        <div className="bc-panel">
          <div className="bc-toolbar">
            <h2>{title}</h2>
            <span className="bc-grow" />
            <span className="muted small" style={{ color: '#55606b' }}>
              {loading ? 'Loading…' : `${labels.length} label${labels.length === 1 ? '' : 's'} on A4`}
            </span>
            <button type="button" className="btn" onClick={onClose}>Close</button>
            <button type="button" className="btn primary" disabled={loading || !labels.length} onClick={() => window.print()}>
              Print / Save as PDF
            </button>
          </div>
          {!loading && (
            <div className="bc-note">
              {isCats
                ? `One barcode per category, including subcategories and newly added categories (${labels.length} total). `
                : missing > 0
                  ? `${missing} active product${missing === 1 ? '' : 's'} ${missing === 1 ? 'has' : 'have'} no barcode and ${missing === 1 ? 'is' : 'are'} not included. Add a barcode on the product to print it here. `
                  : 'Every active product has a barcode. '}
              Print on A4 and cut along the dashed lines, or choose “Save as PDF” in the print dialog to download the file.
            </div>
          )}
          <div className="bc-preview">
            {error ? <div className="bc-empty">{error}</div>
              : loading ? <div className="bc-empty">Loading…</div>
                : labels.length ? sheet
                  : <div className="bc-empty">{isCats ? 'No categories yet.' : 'No active product has a barcode yet.'}</div>}
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}
