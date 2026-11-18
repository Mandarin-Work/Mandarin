// The mood of a day on Today: OFF overgrown with plants, a quiet moon after a night, sun on leave, stars on a night shift.
// Drawings only (aria-hidden): every fact they stand for is also written in words beside them. Original artwork.
const NS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}, ...kids) { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); for (const c of kids.flat()) if (c) e.append(c); return e; }
const leaf = (x, y, r, s = 1, cls = 'leaf') => svg('path', { class: cls, d: 'M0 0C3 -5 10 -7 15 -4C11 1 5 3 0 0Z', transform: `translate(${x} ${y}) rotate(${r}) scale(${s})` });

/** "OFF" with vines climbing through the letters. The vines and leaves sway slowly (not under reduced motion). */
export function offMark(word = 'OFF') {
  const vines = svg('svg', { class: 'off-vines', viewBox: '0 0 220 110', preserveAspectRatio: 'xMinYMid meet', 'aria-hidden': 'true' },
    svg('g', { class: 'sway a' },
      svg('path', { class: 'vine', d: 'M6 108C14 86 4 70 18 56C30 44 22 30 34 18C40 12 46 12 50 6' }),
      leaf(14, 86, -110, 1.05), leaf(18, 68, -20, .9), leaf(26, 46, -130, 1), leaf(32, 30, -30, .85), leaf(46, 10, -70, .8, 'leaf lt')),
    svg('g', { class: 'sway b' },
      svg('path', { class: 'vine', d: 'M92 108C96 92 86 84 94 70C100 60 112 62 116 50C119 42 114 34 120 28' }),
      leaf(94, 92, -150, .9), leaf(98, 74, 10, 1, 'leaf lt'), leaf(112, 56, -40, .85), leaf(118, 34, -120, .8),
      svg('circle', { class: 'bud', cx: '121', cy: '26', r: '3.2' })),
    svg('g', { class: 'sway c' },
      svg('path', { class: 'vine', d: 'M168 108C162 94 176 86 170 72C166 62 178 54 184 46C190 38 186 26 196 20C202 16 208 18 212 12' }),
      leaf(166, 94, 200, .95, 'leaf lt'), leaf(172, 76, -10, .9), leaf(180, 52, -150, 1), leaf(190, 34, -20, .85), leaf(206, 16, -60, .75)),
    svg('path', { class: 'grass', d: 'M0 108q8-10 6-20M10 108q2-12 10-18M58 108q-2-9 5-15M64 108q5-8 3-14M140 108q-3-10 4-16M150 108q6-9 4-15M214 108q-4-8 2-14' }));
  const wrap = document.createElement('div'); wrap.className = 'off-mark'; wrap.setAttribute('role', 'img'); wrap.setAttribute('aria-label', word === 'OFF' ? 'Day off' : word);
  const w = document.createElement('div'); w.className = 'off-word'; w.textContent = word;
  wrap.append(w, vines); return wrap;
}
/** After a night: a sleeping crescent and drifting z's. */
export function restMark() {
  return svg('svg', { class: 'mood-art rest-art', viewBox: '0 0 120 90', 'aria-hidden': 'true' },
    svg('path', { class: 'moon', d: 'M70 14A30 30 0 1 0 98 58A24 24 0 1 1 70 14Z' }),
    svg('text', { class: 'zz z1', x: '20', y: '40' }, 'z'), svg('text', { class: 'zz z2', x: '30', y: '26' }, 'z'), svg('text', { class: 'zz z3', x: '42', y: '14' }, 'z'));
}
/** A night shift: a few stars scattered over the card. */
export function starField() {
  // a few four-point sparkles across the top of the card, where nothing else is drawn
  const pts = [[6, 10, 1], [30, 22, .7], [47, 8, .85], [58, 30, .6], [68, 14, .75], [84, 34, .55], [94, 12, .9]];
  const spark = (x, y, r, i) => svg('path', { class: `st t${i % 3}`, d: `M${x} ${y - 3 * r}Q${x} ${y} ${x + 3 * r} ${y}Q${x} ${y} ${x} ${y + 3 * r}Q${x} ${y} ${x - 3 * r} ${y}Q${x} ${y} ${x} ${y - 3 * r}Z` });
  return svg('svg', { class: 'mood-bg stars', viewBox: '0 0 100 40', preserveAspectRatio: 'xMidYMin slice', 'aria-hidden': 'true' }, pts.map(([x, y, r], i) => spark(x, y, r, i)));
}
/** Leave: a low sun over three soft waves. */
export function leaveMark() {
  return svg('svg', { class: 'mood-art leave-art', viewBox: '0 0 120 90', 'aria-hidden': 'true' },
    svg('circle', { class: 'sun', cx: '60', cy: '46', r: '20' }),
    svg('path', { class: 'wave', d: 'M10 60q12-8 25 0t25 0 25 0 25 0' }), svg('path', { class: 'wave w2', d: 'M18 70q10-6 21 0t21 0 21 0 21 0' }), svg('path', { class: 'wave w3', d: 'M28 80q8-5 16 0t16 0 16 0 16 0' }));
}
/** A small sprout for days off on the calendar and the week strip. */
export function sprout() {
  return svg('svg', { class: 'sprout', viewBox: '0 0 16 16', 'aria-hidden': 'true' }, svg('path', { class: 'vine', d: 'M8 15V8' }), leaf(8, 9, -150, .45), leaf(8, 8, -30, .5, 'leaf lt'));
}
