import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BrowserMultiFormatReader, DecodeHintType, BarcodeFormat } from '@zxing/library';
import { api, fmt } from '../lib/api';
import { useToast } from '../components/Toast';
import { pushScanned } from '../lib/scanStore';
import I from '../components/icons';

function beep(ok = true) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = ok ? 1046 : 300;
    g.gain.value = 0.08;
    o.start();
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + (ok ? 0.12 : 0.25));
    o.stop(ctx.currentTime + (ok ? 0.15 : 0.3));
  } catch (e) { /* ignore */ }
}

const FORMATS = [
  BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.CODE_93, BarcodeFormat.ITF,
  BarcodeFormat.CODABAR, BarcodeFormat.QR_CODE, BarcodeFormat.DATA_MATRIX,
];
const NATIVE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'code_93', 'codabar', 'itf', 'qr_code', 'data_matrix'];

const SIZE_RE = /\bA([1-6])\b/;
function pSize(p) {
  const m = (p.name || '').match(SIZE_RE) || String(p.specifications || '').match(/Size:\s*([A-Za-z0-9]+)/i);
  return m ? m[1] : null;
}
const QTY_RE = /\b(\d+)\s*(PCS|PKT|PKTS|BOX|BOXES|DZN|PK|PC|LITRE|GB|G)\b/i;
function pQty(p) {
  const m = (p.name || '').match(QTY_RE) || String(p.specifications || '').match(/Quantity:\s*(\d+)\s*(?:pieces?|pcs|pkts?|box(?:es)?|dzn)?/i);
  if (!m) return null;
  const unit = (m[2] || 'PCS').toUpperCase().replace(/S$/, '');
  return `${m[1]} ${unit}`;
}
function groupByCategory(list) {
  const m = new Map();
  for (const p of list) {
    const cat = (p.category_name || 'Uncategorized').trim() || 'Uncategorized';
    if (!m.has(cat)) m.set(cat, []);
    m.get(cat).push(p);
  }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function tokenize(s) {
  return (s || '').toLowerCase().match(/[a-z0-9]{2,}/g) || [];
}

// Split the category description into required sub-item inputs, and assign each
// matching product to the description item that best describes it (by keyword overlap,
// ignoring words that appear in nearly every product of the category).
function assignDescItems(matches) {
  const desc = matches[0]?.category_description || '';
  const items = desc.split(',').map((s) => s.trim()).filter(Boolean);
  if (!items.length) return { items, rows: matches.map((p) => ({ product: p, itemIdx: -1 })) };

  const names = matches.map((p) => String(p.name || '').toLowerCase());
  const freq = {};
  for (const n of names) {
    for (const t of new Set(tokenize(n))) freq[t] = (freq[t] || 0) + 1;
  }
  const isGeneric = (t) => (freq[t] || 0) / names.length >= 0.7;

  const rows = matches.map((p) => {
    const pTokens = [...new Set(tokenize(p.name || ''))].filter((t) => !isGeneric(t));
    let bestIdx = -1, bestScore = 0;
    items.forEach((item, i) => {
      const iToks = [...new Set(tokenize(item))];
      let s = 0;
      for (const t of iToks) if (pTokens.includes(t)) s++;
      if (s > bestScore) { bestScore = s; bestIdx = i; }
    });
    return { product: p, itemIdx: bestScore > 0 ? bestIdx : -1 };
  });
  return { items, rows };
}

export default function ScanScreen() {
  const [items, setItems] = useState([]);
  const [flash, setFlash] = useState(null);
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [camErr, setCamErr] = useState(null);
  const [picker, setPicker] = useState(null);
  const [stage, setStage] = useState('scan');
  const videoRef = useRef(null);
  const controlsRef = useRef(null);
  const readerRef = useRef(null);
  const streamRef = useRef(null);
  const detectorRef = useRef(null);
  const pollRef = useRef(null);
  const runningRef = useRef(false);
  const flashTimerRef = useRef(null);
  const lastRawRef = useRef(null);
  const lastAtRef = useRef(0);
  const toast = useToast();
  const navigate = useNavigate();

  const flashMessage = (ok, text) => {
    setFlash({ ok, text, key: Date.now() });
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setFlash(null), 1800);
  };

  const add = (p) => {
    const existing = items.find((x) => x.product_id === p.id);
    if (existing) {
      setItems(items.map((x) => (x.product_id === p.id ? { ...x, quantity: x.quantity + 1 } : x)));
      flashMessage(true, ` ×${existing.quantity + 1} ${p.name}`);
    } else {
      setItems([...items, { product_id: p.id, name: p.name, price: p.selling_price, unit: p.unit, stock: p.in_stock ? 1 : 0, quantity: 1 }]);
      flashMessage(true, ` ${p.name}`);
    }
    beep(true);
  };

  const doScan = async (raw) => {
    try {
      const exact = await api(`/products?barcode=${encodeURIComponent(raw)}`);
      const active = exact.filter((p) => p.status === 'active');
      if (active.length === 1) { add(active[0]); return; }
      if (active.length > 1) {
        setPicker({ barcode: raw, matches: active, q: '', size: null, qty: null, item: null, itemIdx: null, step: 1, touched: {} });
        return;
      }
    } catch (e) { /* fall through */ }
    beep(false);
    flashMessage(false, `x No product for ${raw}`);
    setUnknown({ raw, q: raw, results: null, searching: true });
    try {
      const byName = await api(`/products?q=${encodeURIComponent(raw)}`);
      setUnknown({ raw, q: raw, results: byName.filter((p) => p.status === 'active').slice(0, 20), searching: false });
    } catch {
      setUnknown({ raw, q: raw, results: [], searching: false });
    }
  };

  const manualRef = useRef(null);
  const [manual, setManual] = useState('');
  const [unknown, setUnknown] = useState(null);
  const searchUnknown = async () => {
    if (!unknown) return;
    const term = unknown.q.trim();
    if (!term) return;
    setUnknown({ ...unknown, searching: true });
    try {
      const rows = await api(`/products?q=${encodeURIComponent(term)}`);
      setUnknown({ ...unknown, results: rows.filter((p) => p.status === 'active').slice(0, 20), searching: false });
    } catch {
      setUnknown({ ...unknown, results: [], searching: false });
    }
  };

  const descAssign = picker ? assignDescItems(picker.matches) : { items: [], rows: [] };
  const pickedItemRows = picker
    ? descAssign.rows.filter((r) => (picker.itemIdx === null ? true : picker.itemIdx === '__all__' ? true : r.itemIdx === picker.itemIdx))
    : [];

  const filteredMatches = picker
    ? pickedItemRows
        .map((r) => r.product)
        .filter((p) => {
          if (picker.size && pSize(p) !== picker.size) return false;
          if (picker.qty && pQty(p) !== picker.qty) return false;
          if (picker.q.trim()) {
            const hay = `${p.name} ${p.sku || ''} ${p.specifications || ''}`.toLowerCase();
            if (!picker.q.trim().toLowerCase().split(/\s+/).every((t) => hay.includes(t))) return false;
          }
          return true;
        })
    : [];

  const pick = (p) => {
    setPicker(null);
    add(p);
  };

  const pickerSizes = picker && picker.itemIdx !== null
    ? [...new Set(pickedItemRows.map((r) => r.product).map(pSize).filter(Boolean))].sort()
    : [];
  const pickerQtys = picker && picker.itemIdx !== null
    ? [...new Set(pickedItemRows.map((r) => r.product).map(pQty).filter(Boolean))].sort((a, b) => {
        const na = parseInt(a, 10) || 0, nb = parseInt(b, 10) || 0;
        return na - nb || a.localeCompare(b);
      })
    : [];
  const itemCounts = picker
    ? descAssign.items.map((item, i) => ({ item, n: descAssign.rows.filter((r) => r.itemIdx === i).length })).filter((c) => c.n > 0)
    : [];
  const otherCount = picker ? descAssign.rows.filter((r) => r.itemIdx === -1).length : 0;
  const itemOptions = picker
    ? [
        { label: 'All items', idx: '__all__', n: picker.matches.length },
        ...itemCounts.map((c) => ({ label: c.item, idx: descAssign.items.findIndex((x) => x === c.item), n: c.n })),
      ]
    : [];
  const canConfirm = filteredMatches.length === 1;

  const selectItem = (idx, label) => setPicker({ ...picker, itemIdx: idx, item: label, size: null, qty: null, q: '', step: 2, touched: { ...picker.touched, item: true } });

  const onDetected = (raw) => {
    const now = Date.now();
    if (raw !== lastRawRef.current || now - lastAtRef.current > 1200) {
      lastRawRef.current = raw;
      lastAtRef.current = now;
      doScan(raw);
    }
  };

  const start = async () => {
    if (runningRef.current) return;
    setCamErr(null);
    setStarting(true);
    try {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('no-getusermedia');
      }
      if (!window.isSecureContext) {
        throw new Error('insecure-context');
      }
      const video = videoRef.current;
      const useNative = typeof window !== 'undefined' && 'BarcodeDetector' in window;

      if (useNative) {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' } },
        });
        streamRef.current = stream;
        if (video) { video.srcObject = stream; await video.play(); }
        detectorRef.current = new window.BarcodeDetector({ formats: NATIVE_FORMATS });
        runningRef.current = true;
        const tick = async () => {
          if (!runningRef.current) return;
          try {
            const v = videoRef.current;
            if (v && v.readyState >= 2) {
              const codes = await detectorRef.current.detect(v);
              if (codes && codes.length && codes[0].rawValue) onDetected(String(codes[0].rawValue).trim());
            }
          } catch (e) { /* frame failed, keep trying */ }
          pollRef.current = setTimeout(tick, 250);
        };
        tick();
      } else {
        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, FORMATS);
        const reader = new BrowserMultiFormatReader(hints, 300);
        readerRef.current = reader;
        const controls = await reader.decodeFromConstraints(
          { audio: false, video: { facingMode: { ideal: 'environment' } } },
          video,
          (result) => { if (result && result.getText()) onDetected(result.getText().trim()); },
        );
        controlsRef.current = controls;
      }
      setRunning(true);
    } catch (e) {
      const name = (e && e.name) || '';
      let hint;
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        hint = 'Camera permission is blocked. Reload the page and tap "Allow" when the browser asks, then tap Start again.';
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        hint = 'No camera was found on this device. Connect a camera/webcam and try again.';
      } else if (name === 'NotReadableError' || name === 'TrackStartError') {
        hint = 'The camera is already in use by another app. Close it and try again.';
      } else if (name === 'OverconstrainedError') {
        hint = 'The camera could not open. Try again.';
      } else if (e.message === 'insecure-context') {
        hint = 'Camera requires a secure (https) page. Open the app via the https address and try again.';
      } else if (e.message === 'no-getusermedia') {
        hint = 'This browser does not support camera access. Try Chrome, Edge, or Firefox.';
      } else {
        hint = 'Could not open the camera. Make sure it is connected and try again.';
      }
      setCamErr(hint);
    } finally {
      setStarting(false);
    }
  };

  const stop = () => {
    runningRef.current = false;
    if (pollRef.current) { clearTimeout(pollRef.current); pollRef.current = null; }
    controlsRef.current?.stop();
    controlsRef.current = null;
    readerRef.current = null;
    detectorRef.current = null;
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
    if (videoRef.current) videoRef.current.srcObject = null;
    setRunning(false);
  };

  useEffect(() => () => { runningRef.current = false; controlsRef.current?.stop(); if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop()); }, []);

  // Auto-scan when the page is opened with ?barcode=... (keyboard-wedge scanners / testing).
  useEffect(() => {
    const b = new URLSearchParams(window.location.search).get('barcode');
    if (b) { const t = setTimeout(() => doScan(b.trim()), 300); return () => clearTimeout(t); }
  }, []);

  const done = () => {
    stop();
    pushScanned(items);
    navigate('/pos');
  };

  const setQty = (product_id, quantity) =>
    setItems((it) => it.map((x) => (x.product_id === product_id ? { ...x, quantity: Math.max(1, quantity) } : x)));

  const goReview = () => { stop(); setStage('review'); };
  const backToScan = () => { setStage('scan'); if (!runningRef.current) setRunning(false); };

  const total = items.reduce((s, i) => s + i.price * i.quantity, 0);
  const itemCount = items.reduce((s, i) => s + i.quantity, 0);

  return (
    <div className="scan-screen">
      <div className="scan-top">
        <button className="btn" onClick={() => (items.length ? goReview() : navigate('/pos'))}>← POS</button>
        <div className="scan-title-block">
          <h1>Barcode scanner</h1>
          <div className="scan-progress">
            <span className={stage === 'scan' ? 'on' : 'done'}>{stage === 'scan' ? '1' : ''}</span><i>Scan</i>
            <b></b>
            <span className={stage === 'review' ? 'on' : stage === 'scan' && itemCount > 0 ? 'ready' : ''}>{stage === 'review' ? '2' : '2'}</span><i>Review</i>
            <b></b>
            <span>3</span><i>POS</i>
          </div>
        </div>
        <span className={`badge ${running ? 'amber' : 'gray'}`}>{running ? '● Camera on' : '○ Camera off'}</span>
      </div>

      {picker && (
        <div className="scan-picker">
          <div className="scan-picker-card">
            <div className="picker-head">
              <div>
                <h3>{picker.matches[0]?.category_name || 'Product identification'}</h3>
                <p className="muted small">Barcode <strong>{picker.barcode}</strong> · {picker.matches.length} items share this code</p>
              </div>
              <span className="picker-steps">{picker.itemIdx === null ? 'Step 1 of 3 · Item type' : filteredMatches.length === 1 ? 'Step 3 of 3 · Confirm' : 'Step 2 of 3 · Details'}</span>
            </div>

            <div className="picker-form">
              <div className="field">
                <label>Item type <em>*</em></label>
                <select
                  value={picker.itemIdx === null ? '' : String(picker.itemIdx)}
                  onChange={(e) => {
                    const opt = itemOptions.find((o) => String(o.idx) === e.target.value);
                    if (opt) selectItem(opt.idx, opt.label);
                  }}
                >
                  <option value="" disabled> : Select the item type :</option>
                  {itemOptions.map((o) => (
                    <option key={String(o.idx)} value={String(o.idx)}>{o.label} ({o.n})</option>
                  ))}
                </select>
                {picker.touched.item && picker.itemIdx === null && <span className="picker-err">Item type is required.</span>}
              </div>

              {picker.itemIdx !== null && pickerSizes.length > 1 && (
                <div className="field">
                  <label>Size <em>*</em></label>
                  <select
                    value={picker.size === null ? '' : picker.size}
                    onChange={(e) => setPicker({ ...picker, size: e.target.value || null, touched: { ...picker.touched, size: true } })}
                  >
                    <option value="" disabled> : Select size :</option>
                    {pickerSizes.map((s) => (
                      <option key={s} value={s}>Size {s}</option>
                    ))}
                  </select>
                </div>
              )}

              {picker.itemIdx !== null && pickerQtys.length > 1 && (
                <div className="field">
                  <label>Pack size <em>*</em></label>
                  <select
                    value={picker.qty === null ? '' : picker.qty}
                    onChange={(e) => setPicker({ ...picker, qty: e.target.value || null, touched: { ...picker.touched, qty: true } })}
                  >
                    <option value="" disabled> : Select pack size :</option>
                    {pickerQtys.map((q) => (
                      <option key={q} value={q}>{q}</option>
                    ))}
                  </select>
                </div>
              )}

              {picker.itemIdx !== null && (
                <div className="field">
                  <label>Quick search <span className="muted small">(optional)</span></label>
                  <input
                    className="picker-search"
                    placeholder="Brand, model or SKU : e.g. ABE, BLUE, 50PCS…"
                    value={picker.q}
                    onChange={(e) => setPicker({ ...picker, q: e.target.value })}
                  />
                </div>
              )}
            </div>

            <div className={`picker-status ${canConfirm ? 'ok' : ''}`}>
              {picker.itemIdx === null
                ? 'Select an item type to continue.'
                : canConfirm
                  ? ` Identified: ${filteredMatches[0].name}`
                  : filteredMatches.length === 0
                    ? 'No product matches the selected details. Adjust the fields above.'
                    : `${filteredMatches.length} of ${picker.matches.length} products match. Pick the exact product from the list, or narrow down with the details above.`}
            </div>

            {picker.itemIdx !== null && filteredMatches.length > 1 && (
              <div className="picker-list">
                {groupByCategory(filteredMatches).map(([cat, prods]) => (
                  <div key={cat} style={{ marginBottom: 10 }}>
                    <div className="muted small" style={{ fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6, paddingLeft: 2 }}>{cat}</div>
                    {prods.map((p) => (
                      <button key={p.id} className="scan-picker-row" onClick={() => pick(p)}>
                        <span className="s-name">{p.name || '(variant)'}</span>
                        <span className="muted small">{p.sku || ''}{pSize(p) ? ` · ${pSize(p)}` : ''}{pQty(p) ? ` · ${pQty(p)}` : ''}{p.selling_price ? ` · ${fmt(p.selling_price)}` : ''}</span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}

            <div className="picker-actions">
              <button className="btn" onClick={() => setPicker(null)}>Cancel</button>
              {canConfirm ? (
                <button className="btn primary" onClick={() => pick(filteredMatches[0])}>
                   Confirm · {filteredMatches[0].name}
                </button>
              ) : (
                <button className="btn primary" disabled>Confirm</button>
              )}
            </div>
          </div>
        </div>
      )}

      {stage === 'scan' && (
        <>
          <div className="scan-hero">
            <div className="scan-big-label">Point the camera at the barcode</div>
            <div className="scan-camera">
              <video ref={videoRef} className="scan-cam-video" playsInline muted autoPlay />
              {!running && <div className="scan-camera-overlay">{starting ? 'Starting camera…' : (camErr || 'Camera is off : tap Start to begin')}</div>}
              {running && flash && <div className={`scan-flash ${flash.ok ? 'ok' : 'err'}`} key={flash.key}>{flash.text}</div>}
              {running && itemCount > 0 && (
                <div style={{ position: 'absolute', left: 10, bottom: 10, background: 'rgba(8,14,10,.78)', color: '#fff', borderRadius: 10, padding: '6px 12px', fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums', backdropFilter: 'blur(4px)' }}>
                  {itemCount} item{itemCount === 1 ? '' : 's'} · {fmt(total)}
                </div>
              )}
            </div>
            {camErr && (
              <div>
                <div className="scan-cam-err">{camErr}</div>
                <button className="btn sm" onClick={() => { setCamErr(null); setRunning(false); }} style={{ marginTop: 8 }}>Try again</button>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, width: '100%', maxWidth: 460, margin: '10px auto 0' }}>
              <input
                placeholder="…or type a barcode and press Enter"
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && manual.trim()) { doScan(manual.trim()); setManual(''); } }}
                style={{ flex: 1, fontSize: 14 }}
                inputMode="numeric"
              />
              <button className="btn" onClick={() => { if (manual.trim()) { doScan(manual.trim()); setManual(''); } }}>Add</button>
            </div>
            <div className="scan-btn-row">
              {running ? (
                <button className="btn scan-big-btn active-cam" onClick={stop}><I name="stop" size={14} /> Stop camera</button>
              ) : (
                <button className="btn primary scan-big-btn" onClick={start} disabled={starting}>
                  {starting ? 'Starting camera…' : <><I name="camera" size={16} /> Allow camera & start scanning</>}
                </button>
              )}
            </div>
          </div>

          {unknown && (
            <div className="card" style={{ marginBottom: 14, borderColor: 'var(--warning)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <b className="small">No product for barcode {unknown.raw}</b>
                <button className="btn sm" onClick={() => setUnknown(null)}>x</button>
              </div>
              <div style={{ display: 'flex', gap: 8, margin: '10px 0' }}>
                <input
                  value={unknown.q}
                  onChange={(e) => setUnknown({ ...unknown, q: e.target.value })}
                  onKeyDown={(e) => { if (e.key === 'Enter') searchUnknown(); }}
                  placeholder="Search by name or SKU instead…"
                  style={{ flex: 1 }}
                  autoFocus
                />
                <button className="btn sm primary" onClick={searchUnknown} disabled={unknown.searching}>{unknown.searching ? 'Searching…' : 'Search'}</button>
              </div>
              {Array.isArray(unknown.results) && unknown.results.length === 0 && !unknown.searching && (
                <p className="muted small">Nothing found. Check the product exists, or add it in Products first.</p>
              )}
              {groupByCategory(unknown.results || []).map(([cat, prods]) => (
                <div key={cat} style={{ marginBottom: 10 }}>
                  <div className="muted small" style={{ fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6, paddingLeft: 2 }}>{cat}</div>
                  {prods.map((p) => (
                    <button key={p.id} className="scan-picker-row" style={{ width: '100%', textAlign: 'left', marginBottom: 6 }} onClick={() => { add(p); setUnknown(null); }}>
                      <span className="s-name">{p.name}</span>
                      <span className="muted small">{p.sku || ''}{p.selling_price ? ` · ${fmt(p.selling_price)}` : ''}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}

          <div className="card scan-items">
            <div className="scan-items-head">
              <h2>Scanned items</h2>
              <span className="badge blue">{itemCount} item{itemCount === 1 ? '' : 's'}</span>
            </div>
            {items.length === 0 && <p className="muted">Nothing scanned yet : point the camera at a barcode.</p>}
            {items.map((i) => (
              <div className="scan-line" key={i.product_id}>
                <div className="sl-main">
                  <span className="name">{i.name}</span>
                  <span className="muted small">{fmt(i.price)} {i.unit ? `· ${i.unit}` : ''}</span>
                </div>
                <div className="sl-qty">
                  <button className="qty-btn" onClick={() => setQty(i.product_id, i.quantity - 1)}>−</button>
                  <input className="qty-input" type="number" min="1" value={i.quantity}
                    onChange={(e) => setQty(i.product_id, +e.target.value)} />
                  <button className="qty-btn" onClick={() => setQty(i.product_id, i.quantity + 1)}>+</button>
                </div>
                <span className="num sl-total">{fmt(i.price * i.quantity)}</span>
                <button className="btn sm danger sl-del" onClick={() => setItems((it) => it.filter((x) => x.product_id !== i.product_id))}>×</button>
              </div>
            ))}
            <div className="scan-summary">
              <div className="cart-total-row cart-grand"><span>Total ({itemCount} item{itemCount === 1 ? '' : 's'})</span><span>{fmt(total)}</span></div>
              <button className="btn primary" style={{ width: '100%', justifyContent: 'center', padding: 12 }} onClick={goReview} disabled={items.length === 0}>
                Review & finish →
              </button>
            </div>
          </div>
        </>
      )}

      {stage === 'review' && (
        <div className="card scan-review">
          <div className="scan-review-head">
            <h2>Review session</h2>
            <button className="btn sm" onClick={backToScan}>← Back to scanning</button>
          </div>
          <div className="review-stats">
            <div className="review-stat"><span>Items</span><strong>{itemCount}</strong></div>
            <div className="review-stat"><span>Lines</span><strong>{items.length}</strong></div>
            <div className="review-stat"><span>Total</span><strong>{fmt(total)}</strong></div>
          </div>
          <div className="review-lines">
            {items.map((i) => (
              <div className="review-line" key={i.product_id}>
                <span className="name">{i.name}</span>
                <span className="muted small">{i.quantity} × {fmt(i.price)}</span>
                <span className="num">{fmt(i.price * i.quantity)}</span>
              </div>
            ))}
          </div>
          <div className="cart-total-row cart-grand"><span>Grand total</span><span>{fmt(total)}</span></div>
          <button className="btn primary" style={{ width: '100%', justifyContent: 'center', padding: 13, fontSize: 15 }} onClick={done}>
             Finish : send {itemCount} item{itemCount === 1 ? '' : 's'} to POS
          </button>
          <p className="muted small" style={{ textAlign: 'center', marginTop: 10 }}>Items will open in the POS register ready to charge.</p>
        </div>
      )}

      <div className="scan-dock">
        <div className="scan-dock-info">
          <div className="scan-dock-count">{itemCount} item{itemCount === 1 ? '' : 's'}</div>
          <div className="scan-dock-total">{fmt(total)}</div>
        </div>
        {stage === 'scan' ? (
          <button className="btn primary" onClick={goReview} disabled={items.length === 0}>Review & finish</button>
        ) : (
          <>
            <button className="btn" onClick={backToScan}>Back</button>
            <button className="btn primary" onClick={done} disabled={items.length === 0}> Finish → POS</button>
          </>
        )}
      </div>
    </div>
  );
}
