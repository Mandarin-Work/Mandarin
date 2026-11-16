// Contact cards belong to Clementine (Social & People): phone, WhatsApp, Snapchat, Instagram, birthdays and notes.
// Mandarin links people by rota key only. It keeps a read-only copy of the cards on this device (never synced, never written
// back), taken from Clementine's state when it exists and from Citrus's until then, so Call and WhatsApp keep working.
// The rota's own mobile number is rota data and stays Mandarin's.
import { phoneInUse, dialable } from './people-logic.js';

const KEY = 'mandarin.directory';
let cache = null;
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v, n = 80) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '').slice(0, n);

function load() { if (cache) return cache; try { cache = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { cache = null; } if (!isObj(cache)) cache = { cards: {}, nick: {}, friend: {}, source: '', at: 0 }; return cache; }
/** Take the cards from another app's state (Clementine first, else Citrus): {contacts:{key:{phone,whatsapp,snap,insta,note,birthday}}, friends:{id:{rotaKey,nick,name}}}. */
export function ingest(state, source) {
  if (!isObj(state)) return false;
  const cards = {}, nick = {}, friend = {};
  for (const [k, c] of Object.entries(isObj(state.contacts) ? state.contacts : {})) if (isObj(c)) cards[k] = { phone: str(c.phone, 30), whatsapp: str(c.whatsapp, 30), snap: str(c.snap, 40), insta: str(c.insta, 40), note: str(c.note, 200) };
  for (const f of Object.values(isObj(state.friends) ? state.friends : {})) if (isObj(f) && typeof f.rotaKey === 'string' && f.rotaKey) { friend[f.rotaKey] = true; if (f.nick) nick[f.rotaKey] = str(f.nick, 30); const c = cards[f.rotaKey] || (cards[f.rotaKey] = {}); for (const k of ['phone', 'whatsapp', 'snap', 'insta']) if (!c[k] && f[k]) c[k] = str(f[k], 40); }
  cache = { cards, nick, friend, source, at: Date.now() };
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch {}
  return true;
}
export const source = () => load().source;
export const syncedAt = () => load().at;
/** The card for a rota key: {phone, whatsapp, snap, insta, note, friend, nick} (empty strings when unknown). */
export function contactOf(key) { const d = load(), c = d.cards[key] || {}; return { phone: c.phone || '', whatsapp: c.whatsapp || '', snap: c.snap || '', insta: c.insta || '', note: c.note || '', friend: !!d.friend[key], nick: d.nick[key] || '' }; }
export const hasCard = (key) => { const c = contactOf(key); return !!(c.phone || c.whatsapp || c.snap || c.insta || c.note); };
/** Links for the reach buttons: tel, WhatsApp, Snapchat, Instagram. The saved number when it dials, otherwise the rota's. */
export function reach(key, rotaMobile) {
  const c = contactOf(key), phone = phoneInUse(c.phone, rotaMobile), waNum = dialable(c.whatsapp) || dialable(phone);
  const d = dialable(phone);
  return {
    phone, card: c,
    tel: d ? `tel:+${d}` : '', wa: waNum ? `https://wa.me/${waNum}` : '',
    snap: c.snap ? `https://www.snapchat.com/add/${encodeURIComponent(c.snap.replace(/^@/, ''))}` : '',
    insta: c.insta ? `https://instagram.com/${encodeURIComponent(c.insta.replace(/^@/, ''))}` : '',
  };
}
export function clear() { cache = null; try { localStorage.removeItem(KEY); } catch {} }
