import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { shopApi, fmt } from '../../lib/api';
import RequireShopAuth from '../../shop/RequireShopAuth';
import { useToast } from '../../components/Toast';

const INVOICE_STYLE = `
  #invoice {
    max-width: 740px; margin: 0 auto; background: #fff; color: #17191c;
    padding: 0 0 34px; font-family: inherit; border-radius: 10px;
    box-shadow: 0 2px 18px rgba(0,0,0,.09); overflow: hidden;
  }
  .inv-band { height: 6px; background: #0e6ea8; }
  .inv-inner { padding: 30px 42px 0; }
  .inv-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; }
  .inv-brand { display: flex; gap: 15px; align-items: center; }
  .inv-brand img { width: 62px; height: 62px; object-fit: contain; border-radius: 9px; }
  .inv-brand .shop-name { font-size: 21px; font-weight: 700; letter-spacing: .02em; color: #0a4a6b; }
  .inv-brand .shop-meta { font-size: 11.5px; color: #5a7286; line-height: 1.55; margin-top: 3px; }
  .inv-doc { text-align: right; }
  .inv-doc .doc-type { font-size: 25px; font-weight: 700; letter-spacing: .12em; color: #0e6ea8; }
  .inv-doc .chip {
    display: inline-block; margin-top: 8px; padding: 3px 12px; border-radius: 6px;
    font-size: 10.5px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase;
    background: #e0eef7; color: #0e6ea8;
  }
  .inv-doc .chip.green { background: #e5f5ec; color: #157a43; }
  .inv-doc .chip.red   { background: #fdeaea; color: #b3372f; }
  .inv-rule { border: none; border-top: 2px solid #0e6ea8; margin: 20px 0 0; }
  .inv-meta { display: flex; justify-content: space-between; gap: 26px; padding: 14px 0 18px; }
  .inv-meta .lbl { font-size: 10px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: #6a8296; margin-bottom: 5px; }
  .inv-meta .val { font-size: 13px; line-height: 1.65; }
  .inv-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .inv-table thead th {
    text-align: left; font-size: 10.5px; letter-spacing: .11em; text-transform: uppercase;
    color: #fff; background: #0e6ea8; padding: 9px 10px;
  }
  .inv-table tbody td { padding: 10px; border-bottom: 1px solid #b9d6ea; vertical-align: top; }
  .inv-table tbody tr:nth-child(even) td { background: #eef6fb; }
  .inv-table .num, .inv-table th.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .inv-table .qty { color: #5a7286; }
  .inv-totals { display: flex; justify-content: flex-end; margin-top: 6px; }
  .inv-totals .box { min-width: 280px; font-size: 13px; background: #eef6fb; border: 1px solid #b9d6ea; border-radius: 8px; padding: 10px 14px 12px; margin-right: -14px; }
  .inv-totals .row { display: flex; justify-content: space-between; padding: 3.5px 0; color: #3c4045; }
  .inv-totals .grand {
    display: flex; justify-content: space-between; margin-top: 8px; padding: 10px 0 2px;
    border-top: 2px solid #0e6ea8; border-left: 3px solid #0e6ea8; font-weight: 700; font-size: 15.5px; color: #0a4a6b;
    font-variant-numeric: tabular-nums;
  }
  .inv-notes { margin-top: 18px; font-size: 12px; color: #55595e; background: #eef6fb; border-left: 3px solid #0e6ea8; padding: 9px 13px; border-radius: 0 6px 6px 0; }
  .inv-pay { margin-top: 20px; border: 1px solid #b9d6ea; border-radius: 6px; overflow: hidden; break-inside: avoid; }
  .inv-pay-title { background: #0e6ea8; color: #fff; padding: 8px 14px; font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; text-align: center; }
  .inv-pay-lipa { background: #eef6fb; border-bottom: 1px solid #b9d6ea; padding: 8px 14px; text-align: center; font-size: 12px; }
  .inv-pay-lipa b { color: #0a4a6b; font-size: 13px; }
  .inv-pay-lipa .num { display: inline-block; background: #fff; border: 1px solid #b9d6ea; padding: 2px 10px; border-radius: 6px; font-weight: 700; color: #0e6ea8; font-variant-numeric: tabular-nums; margin-left: 6px; }
  .inv-pay-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0; }
  .inv-pay-card { padding: 10px 12px; border-right: 1px solid #d0e6f5; border-bottom: 1px solid #d0e6f5; font-size: 11px; line-height: 1.55; }
  .inv-pay-card:nth-child(2n) { border-right: none; }
  .inv-pay-card:nth-last-child(-n+2) { border-bottom: none; }
  .inv-pay-card h4 { margin: 0 0 5px; font-size: 11.5px; font-weight: 700; color: #0a4a6b; letter-spacing: .02em; }
  .inv-pay-card .ussd { display: inline-block; font-family: ui-monospace, monospace; background: #fff; border: 1px solid #b9d6ea; padding: 1px 6px; border-radius: 4px; font-weight: 700; color: #0e6ea8; font-size: 11px; }
  .inv-pay-card ol { margin: 6px 0 0; padding-left: 16px; }
  .inv-pay-card li { margin: 1.5px 0; }
  .inv-foot { margin-top: 22px; text-align: center; color: #5a7286; font-size: 11.5px; line-height: 1.75; }
  .inv-foot .thanks { font-weight: 700; color: #0e6ea8; font-size: 12.5px; letter-spacing: .02em; }
  .inv-print-footer { display: none; }
  @media print {
    body * { visibility: hidden; }
    #invoice, #invoice * { visibility: visible; }
    #invoice {
      position: static !important;
      transform: none !important;
      top: auto !important; left: auto !important;
      max-width: none !important;
      width: 100% !important;
      margin: 0 !important;
      box-shadow: none !important;
      border-radius: 0 !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      font-size: 11px !important;
    }
    .inv-inner { padding: 0 !important; }
    .no-print { display: none !important; }
    .inv-band { background: #0e6ea8 !important; height: 4px !important; }
    thead th { background: #0e6ea8 !important; color: #fff !important; }
    .inv-pay-title { background: #0e6ea8 !important; color: #fff !important; }
    @page { size: A4 portrait; margin: 10mm 10mm 14mm 10mm; } @bottom-right { content: "Page " counter(page); font-size: 7.5px; color: #5a7286; } }
    #invoice .inv-head { gap: 12px !important; }
    #invoice .inv-brand { gap: 10px !important; }
    #invoice .inv-brand img { width: 48px !important; height: 48px !important; }
    #invoice .inv-brand .shop-name { font-size: 16px !important; }
    #invoice .inv-brand .shop-meta { font-size: 9.5px !important; }
    #invoice .inv-doc .doc-type { font-size: 18px !important; }
    #invoice .inv-rule { margin: 10px 0 0 !important; }
    #invoice .inv-meta { padding: 8px 0 10px !important; gap: 12px !important; }
    #invoice .inv-meta .val { font-size: 11px !important; }
    #invoice .inv-table { font-size: 11px !important; }
    #invoice .inv-table thead th { padding: 5px 8px !important; font-size: 8.5px !important; }
    #invoice .inv-table tbody td { padding: 5px 8px !important; }
    #invoice .inv-totals { margin-top: 4px !important; }
    #invoice .inv-totals .box { padding: 7px 10px !important; font-size: 11px !important; min-width: 240px !important; }
    #invoice .inv-totals .grand { font-size: 13px !important; padding: 6px 0 1px !important; }
    #invoice .inv-notes { margin-top: 8px !important; padding: 6px 10px !important; font-size: 10px !important; }
    #invoice .inv-pay { margin-top: 10px !important; break-inside: avoid !important; }
    #invoice .inv-pay-title { padding: 5px 10px !important; font-size: 9px !important; }
    #invoice .inv-pay-lipa { padding: 5px 10px !important; font-size: 10px !important; }
    #invoice .inv-pay-card { padding: 6px 8px !important; font-size: 9.5px !important; line-height: 1.4 !important; }
    #invoice .inv-pay-card h4 { font-size: 10px !important; margin: 0 0 3px !important; }
    #invoice .inv-pay-card .ussd { font-size: 9px !important; }
    #invoice .inv-pay-card ol { margin: 4px 0 0 !important; }
    #invoice .inv-foot { margin-top: 10px !important; font-size: 9px !important; line-height: 1.5 !important; }
    #invoice .inv-foot .thanks { font-size: 10px !important; }
    .inv-print-footer {
      display: flex !important;
      visibility: visible !important;
      position: fixed !important;
      bottom: 0 !important;
      left: 0 !important;
      right: 0 !important;
      justify-content: space-between !important;
      align-items: center !important;
      font-size: 7.5px !important;
      color: #5a7286 !important;
      padding: 4px 0 !important;
      border-top: 1px solid #b9d6ea !important;
      background: #fff !important;
    }
    .inv-print-footer .page-num::after { content: ""; }
    #invoice { padding-bottom: 10mm !important; }
    table.items { page-break-inside: auto !important; }
    tr { page-break-inside: avoid !important; page-break-after: auto !important; }
    thead { display: table-header-group !important; }
    .inv-pay { page-break-inside: avoid !important; }
  }
`;

const STATUS_CHIP = (s) => {
  if (['completed', 'ready_for_pickup', 'out_for_delivery'].includes(s)) return 'amber';
  if (['cancelled', 'rejected'].includes(s)) return 'red';
  return '';
};

function InvoiceInner() {
  const { id } = useParams();
  const [order, setOrder] = useState(null);
  const [info, setInfo] = useState(null);
  const toast = useToast();

  useEffect(() => {
    shopApi(`/orders/${id}`).then(setOrder).catch((e) => toast(e.message, 'error'));
    shopApi('/info').then(setInfo).catch(() => {});
  }, [id]);

  if (!order || !info) return <div className="card">Loading…</div>;
  const currency = info.currency || 'TSh';
  const method = String(order.payment_method || '').replace(/_/g, ' ');

  return (
    <div>
      <div className="no-print" style={{ maxWidth: 740, margin: '0 auto 16px', display: 'flex', justifyContent: 'space-between' }}>
        <Link to={`/shop/order/${order.id}`} className="muted small">← Back to order</Link>
        <button className="btn primary" onClick={() => window.print()}>Print / Save PDF</button>
      </div>
      <style>{INVOICE_STYLE}</style>
      <div id="invoice">
        <div className="inv-band" />
        <div className="inv-inner">
          <div className="inv-head">
            <div className="inv-brand">
              <img src="/logo-doc.png?v=3" alt="" />
              <div>
                <div className="shop-name">{info.shop_name}</div>
                <div className="shop-meta">
                  {info.shop_address}<br />
                  {info.shop_phone}{info.shop_email ? ` · ${info.shop_email}` : ''}
                </div>
              </div>
            </div>
            <div className="inv-doc">
              <div className="doc-type">INVOICE</div>
              <span className={`chip ${STATUS_CHIP(order.order_status)}`}>{String(order.order_status || '').replace(/_/g, ' ')}</span>
              <div className="doc-no" style={{ fontSize: 11.5, color: '#5a7286', marginTop: 8 }}>
                No. {order.order_number}
              </div>
            </div>
          </div>
          <hr className="inv-rule" />
          <div className="inv-meta">
            <div>
              <div className="lbl">Billed to</div>
              <div className="val"><b>{order.user_name}</b></div>
            </div>
            <div>
              <div className="lbl">Deliver to</div>
              <div className="val">
                {order.fulfillment_type === 'pickup'
                  ? <>Pickup at shop</>
                  : <>{order.shipping_name}<br />{order.shipping_address}</>}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="lbl">Invoice date</div>
              <div className="val">{new Date(order.order_date).toLocaleDateString()}<br />{new Date(order.order_date).toLocaleTimeString()}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="lbl">Payment</div>
              <div className="val" style={{ textTransform: 'capitalize' }}>{method}</div>
            </div>
          </div>

          <table className="inv-table">
            <thead><tr><th>#</th><th>Product</th><th className="num">Qty</th><th className="num">Unit price</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {order.items.map((i, ix) => (
                <tr key={i.id}>
                  <td className="qty">{ix + 1}</td>
                  <td>{i.product_name}</td>
                  <td className="num qty">{fmt(i.quantity)}{i.unit ? ` ${i.unit}` : ''}</td>
                  <td className="num">{fmt(i.unit_price)}</td>
                  <td className="num"><b>{fmt(i.total)}</b></td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="inv-totals">
            <div className="box">
              <div className="row"><span>Subtotal</span><span>{fmt(order.subtotal)} {currency}</span></div>
              <div className="row"><span>Tax</span><span>{fmt(order.tax)} {currency}</span></div>
              <div className="row"><span>Delivery</span><span>{Number(order.delivery_fee) > 0 ? `${fmt(order.delivery_fee)} ${currency}` : 'Free'}</span></div>
              <div className="grand"><span>TOTAL</span><span>{fmt(order.total)} {currency}</span></div>
            </div>
          </div>

          {order.notes && <div className="inv-notes"><b>Notes:</b> {order.notes}</div>}

          {order.order_status === 'pending' && (
          <div className="inv-pay">
            <div className="inv-pay-title">Jinsi ya kufanya malipo — Lipa kwa simu</div>
            <div className="inv-pay-lipa">
              Lipa Namba ya Vodacom (M-Pesa): <span className="num">{info.payment_instructions && info.payment_instructions.trim() ? info.payment_instructions : (info.shop_phone || '— Uliza dukani')}</span>
              <span style={{marginLeft:8, color:'#5a7286'}}>Malipo yote yanaenda Vodacom M-Pesa</span>
            </div>
            <div className="inv-pay-grid">
              <div className="inv-pay-card">
                <h4>1. Vodacom — M-Pesa</h4>
                <div>Piga: <span className="ussd">*150*00#</span></div>
                <ol>
                  <li>Chagua 4 — Lipa kwa M-Pesa</li>
                  <li>Chagua Lipa Namba</li>
                  <li>Weka Lipa Namba ya Vodacom</li>
                  <li>Weka kiasi: <b>{fmt(order.total)} {currency}</b></li>
                  <li>Hakikisha taarifa za mpokeaji ni sahihi</li>
                  <li>Weka PIN ya M-Pesa</li>
                  <li>Thibitisha malipo</li>
                </ol>
              </div>
              <div className="inv-pay-card">
                <h4>2. Yas — Mixx by Yas</h4>
                <div>Piga: <span className="ussd">*150*01#</span></div>
                <ol>
                  <li>Chagua Lipa kwa Simu</li>
                  <li>Chagua mitandao mingine</li>
                  <li>Chagua M-Pesa</li>
                  <li>Weka Lipa Namba ya Vodacom</li>
                  <li>Weka kiasi: <b>{fmt(order.total)} {currency}</b></li>
                  <li>Hakikisha jina la biashara</li>
                  <li>Weka PIN ya Mixx</li>
                  <li>Thibitisha</li>
                </ol>
              </div>
              <div className="inv-pay-card">
                <h4>3. Airtel — Airtel Money</h4>
                <div>Piga: <span className="ussd">*150*60#</span></div>
                <ol>
                  <li>Chagua 5 — Lipa Bili</li>
                  <li>Chagua Lipa kwa Simu — Mitandao yote</li>
                  <li>Chagua M-Pesa</li>
                  <li>Weka Lipa Namba ya Vodacom</li>
                  <li>Weka kiasi: <b>{fmt(order.total)} {currency}</b></li>
                  <li>Hakikisha taarifa za mfanyabiashara</li>
                  <li>Weka PIN ya Airtel Money</li>
                  <li>Thibitisha</li>
                </ol>
              </div>
              <div className="inv-pay-card">
                <h4>4. Halotel — HaloPesa</h4>
                <div>Piga: <span className="ussd">*150*88#</span></div>
                <ol>
                  <li>Chagua Lipa</li>
                  <li>Chagua Lipa kwa Simu</li>
                  <li>Chagua M-Pesa</li>
                  <li>Weka Lipa Namba ya Vodacom</li>
                  <li>Weka kiasi: <b>{fmt(order.total)} {currency}</b></li>
                  <li>Hakikisha jina la M-Pesa</li>
                  <li>Weka PIN ya HaloPesa</li>
                  <li>Thibitisha</li>
                </ol>
              </div>
            </div>
          </div>
          )}

          <div className="inv-foot">
            <div className="thanks">{info.receipt_footer || 'Thank you for your business!'}</div>
            {info.shop_phone && <div>Questions about this invoice? Call {info.shop_phone}</div>}
            <div>This invoice was generated automatically : no signature required.</div>
          </div>
          <div className="inv-print-footer"><span>Designed by CHUGAZ ICT SERVICES</span><span className="page-num"></span></div>
        </div>
      </div>
    </div>
  );
}

export default function Invoice() {
  return <RequireShopAuth><InvoiceInner /></RequireShopAuth>;
}
