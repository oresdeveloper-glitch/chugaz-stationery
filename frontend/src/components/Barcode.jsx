const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const FIRST = { 0: 'LLLLLL', 1: 'LLGLGG', 2: 'LLGGLG', 3: 'LLGGGL', 4: 'LGLLGG', 5: 'LGGLLG', 6: 'LGGGLL', 7: 'LGLGLG', 8: 'LGLGGL', 9: 'LGGLGL' };
const invert = (s) => s.split('').map((c) => (c === '0' ? '1' : '0')).join('');

// Code 128 (set B) element widths. Every symbol is 11 modules, the stop is 13.
// Values 0-102 are data, 103-105 are start codes, 106 is stop.
const C128 = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

function ean13Bits(code) {
  let bits = '101';
  for (let i = 1; i <= 6; i++) {
    bits += FIRST[code[0]][i - 1] === 'L' ? L[code[i]] : G[code[i]];
  }
  bits += '01010';
  for (let i = 7; i <= 12; i++) bits += invert(L[code[i]]);
  return bits + '101';
}

// A 13-digit value with a broken check digit is not a scannable EAN: print it
// as Code 128 instead so the digits still scan.
function ean13Valid(code) {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(code[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10 === Number(code[12]);
}

// Printable ASCII only; anything else returns null (the label still prints its
// text, just without bars).
function code128Bits(text) {
  const values = [104];
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    if (c < 32 || c > 126) return null;
    values.push(c - 32);
  }
  let sum = 104;
  for (let i = 1; i < values.length; i++) sum += values[i] * i;
  values.push(sum % 103, 106);
  let bits = '';
  for (const v of values) {
    const pattern = C128[v];
    for (let i = 0; i < pattern.length; i++) {
      bits += (i % 2 === 0 ? '1' : '0').repeat(Number(pattern[i]));
    }
  }
  return bits;
}

export default function Barcode({ code, height = 56, module = 2, maxWidth = 0 }) {
  const value = typeof code === 'string' ? code.trim() : '';
  if (!value) return null;

  const ean = /^\d{13}$/.test(value) && ean13Valid(value);
  const bits = ean ? ean13Bits(value) : code128Bits(value);
  if (!bits) return null;

  // Shrink the module instead of overflowing a label column.
  const mod = maxWidth ? Math.min(module, maxWidth / bits.length) : module;
  const quiet = (ean ? 11 : 10) * mod;
  const barH = height;
  const totalW = quiet * 2 + bits.length * mod;

  return (
    <svg width={totalW} height={barH + 18} viewBox={`0 0 ${totalW} ${barH + 18}`} style={{ background: '#fff', maxWidth: '100%' }} role="img" aria-label={`Barcode ${value}`}>
      {bits.split('').map((b, i) =>
        b === '1' ? <rect key={i} x={quiet + i * mod} y={0} width={mod} height={barH} fill="#111" /> : null
      )}
      {ean ? (
        <>
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <text key={i} x={quiet + (3 + i * 7 + 3.5) * mod} y={barH + 14} textAnchor="middle" fontFamily="monospace" fontSize="11">{value[i]}</text>
          ))}
          <text x={quiet + (45 + 3.5) * mod} y={barH + 14} textAnchor="middle" fontFamily="monospace" fontSize="11">{value.slice(7)}</text>
        </>
      ) : (
        <text x={totalW / 2} y={barH + 14} textAnchor="middle" fontFamily="monospace" fontSize="11">{value}</text>
      )}
    </svg>
  );
}
