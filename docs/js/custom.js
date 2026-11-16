// Your choices for how Mandarin looks and behaves — synced with your state (settings.custom), unlike the per-device interface.
// Pure: defaults, sanitising and small getters. The Customise sheet in Settings edits it.
export const TABS = [['today', 'Today'], ['calendar', 'Calendar'], ['team', 'Team'], ['nurses', 'Nurses'], ['month', 'Month'], ['career', 'Career']];
export const WORK_SEGS = [];
export const TODAY_CARDS = ['Schedule update', 'Proposals', 'Briefing', 'Shift log', 'Tomorrow’s team', 'Tonight', 'Shift board', 'Nurses', 'Contract dates', 'Licences', 'On call', 'Calendar'];
export const BRIEF_LINES = [['shift', 'Your shift'], ['team', 'Who you work with'], ['nurses', 'Nurses with you'], ['hours', 'Week hours vs 48h'], ['contract', 'Contract and licence dates']];
export const DEFAULTS = {
  start: 'today',                 // tab Mandarin opens on
  tabs: { hidden: [], order: TABS.map(t => t[0]) },
  today: { hidden: [], pinned: [], top: 5 },   // pinned cards always open at the top; `top` = how many ranked cards stay open
  brief: { off: [] },
};
const arr = (v, ok) => Array.isArray(v) ? [...new Set(v.filter(x => ok.includes(x)))] : [];
const num = (v, lo, hi, d) => Number.isFinite(+v) && v !== '' && v !== null ? Math.max(lo, Math.min(hi, Math.round(+v))) : d;
const ids = (l) => l.map(x => Array.isArray(x) ? x[0] : x);
/** Clean, complete settings — never trust what came from storage or another device. */
export function custom(s) {
  const c = s?.settings?.custom || {}, t = c.tabs || {};
  const order = [...arr(t.order, ids(TABS)), ...ids(TABS).filter(x => !(t.order || []).includes(x))];
  const hidden = arr(t.hidden, ids(TABS)).filter(x => x !== 'today');   // Today can't be hidden: it's home
  const out = {
    start: ids(TABS).includes(c.start) && !hidden.includes(c.start) ? c.start : 'today',
    tabs: { hidden, order },
    today: { hidden: arr(c.today?.hidden, TODAY_CARDS), pinned: arr(c.today?.pinned, TODAY_CARDS), top: num(c.today?.top, 1, 12, 5) },
    brief: { off: arr(c.brief?.off, ids(BRIEF_LINES)) },
  };
  return out;
}
/** Change one part: returns the new state (patch is merged one level deep). */
export function setCustom(s, part, patch) { const cur = custom(s); return { ...s, settings: { ...s.settings, custom: { ...cur, [part]: typeof patch === 'object' && !Array.isArray(patch) ? { ...cur[part], ...patch } : patch } } }; }
export const toggleIn = (list, id) => list.includes(id) ? list.filter(x => x !== id) : [...list, id];
export function move(list, id, dir) { const i = list.indexOf(id), j = i + dir; if (i < 0 || j < 0 || j >= list.length) return list; const l = [...list]; [l[i], l[j]] = [l[j], l[i]]; return l; }
export const visibleTabs = (s) => { const c = custom(s); return c.tabs.order.filter(t => !c.tabs.hidden.includes(t)); };
export const briefOn = (s, id) => !custom(s).brief.off.includes(id);
