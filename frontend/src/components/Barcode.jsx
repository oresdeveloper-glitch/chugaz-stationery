const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const FIRST = { 0: 'LLLLLL', 1: 'LLGLGG', 2: 'LLGGLG', 3: 'LLGGGL', 4: 'LGLLGG', 5: 'LGGLLG', 6: 'LGGGLL', 7: 'LGLGLG', 8: 'LGLGGL', 9: 'LGGLGL' };
const invert = (s) => s.split('').map((c) => (c === '0' ? '1' : '0')).join('');

export default function Barcode({ code, height = 56, module = 2 }) {
  const isValid = typeof code === 'string' && /^\d{13}$/.test(code);
  if (!isValid) return null;

  const first = code[0];
  let bits = '101';
  for (let i = 1; i <= 6; i++) {
    const pattern = FIRST[first][i - 1] === 'L' ? L[code[i]] : G[code[i]];
    bits += pattern;
  }
  bits += '01010';
  for (let i = 7; i <= 12; i++) bits += invert(L[code[i]]);
  bits += '101';

  const quiet = 11 * module;
  const barH = height;
  const totalW = quiet * 2 + bits.length * module;

  return (
    <svg width={totalW} height={barH + 18} viewBox={`0 0 ${totalW} ${barH + 18}`} style={{ background: '#fff', borderRadius: 6, maxWidth: '100%' }}>
      {bits.split('').map((b, i) =>
        b === '1' ? <rect key={i} x={quiet + i * module} y={0} width={module} height={barH} fill="#111" /> : null
      )}
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <text key={i} x={quiet + (3 + i * 7 + 3.5) * module} y={barH + 14} textAnchor="middle" fontFamily="monospace" fontSize="11">{code[i]}</text>
      ))}
      <text x={quiet + (45 + 3.5) * module} y={barH + 14} textAnchor="middle" fontFamily="monospace" fontSize="11">{code.slice(7)}</text>
    </svg>
  );
}
