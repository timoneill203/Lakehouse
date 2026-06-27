import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import * as CONFIG from "./config.js";

// ───────────────────────── setup ─────────────────────────
const _url = SUPABASE_URL.replace(/\/$/, "");
const CONFIGURED =
  _url && !_url.includes("YOUR-PROJECT-ID") &&
  SUPABASE_ANON_KEY && !SUPABASE_ANON_KEY.includes("YOUR-ANON");

const sb = CONFIGURED ? createClient(_url, SUPABASE_ANON_KEY) : null;

// ───────────────────────── persistent unlock ─────────────────────────
const UNLOCK_KEY = "lh_unlock_ts";
const UNLOCK_TTL = 365 * 24 * 60 * 60 * 1000; // 365 days — effectively never
const PASSWORD = "1crazygrampS";

function isUnlocked() {
  const ts = localStorage.getItem(UNLOCK_KEY);
  return ts && (Date.now() - parseInt(ts, 10)) < UNLOCK_TTL;
}
function setUnlocked() {
  localStorage.setItem(UNLOCK_KEY, Date.now().toString());
}

// ───────────────────────── date helpers ─────────────────────────
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_LONG = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function parts(s) { const [y, m, d] = s.split("-").map(Number); return { y, m: m - 1, d }; }
function dowOf(s) { const p = parts(s); return new Date(p.y, p.m, p.d).getDay(); }
function nightsBetween(a, b) {
  const pa = parts(a), pb = parts(b);
  return Math.round((new Date(pb.y, pb.m, pb.d) - new Date(pa.y, pa.m, pa.d)) / 86400000);
}
function fmtRange(start, end) {
  const a = parts(start), b = parts(end);
  const head = `${DOW[dowOf(start)]} ${MON[a.m]} ${a.d}`;
  if (start === end) return `${head}, ${a.y}`;
  if (a.y === b.y && a.m === b.m) return `${MON[a.m]} ${a.d}\u2013${b.d}, ${a.y}`;
  if (a.y === b.y) return `${MON[a.m]} ${a.d} \u2013 ${MON[b.m]} ${b.d}, ${a.y}`;
  return `${MON[a.m]} ${a.d}, ${a.y} \u2013 ${MON[b.m]} ${b.d}, ${b.y}`;
}
function monthMatrix(year, month) {
  const startDow = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}
function uuid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const PERSON_COLORS = [
  { strong: "#2C4A33", soft: "#DCE6D8" }, { strong: "#A4432A", soft: "#F2DCD3" },
  { strong: "#B07A2E", soft: "#F1E4CB" }, { strong: "#3F6373", soft: "#DCE6EB" },
  { strong: "#6B7A3A", soft: "#E7EAD2" }, { strong: "#7A4E6B", soft: "#EEE0EA" },
  { strong: "#C28A2E", soft: "#F4E8CC" }, { strong: "#2F6360", soft: "#D7E6E4" },
];
function colorFor(name) {
  const key = (name || "").trim().toLowerCase();
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return PERSON_COLORS[h % PERSON_COLORS.length];
}

// ───────────────────────── state ─────────────────────────
const today = new Date();
const todayStr = ymd(today);
let editorName = localStorage.getItem("editorName") || "";

const state = {
  config: { appName: "Family Lake House", capacity: 10 },
  stays: [],
  log: [],
  view: "calendar",
  cur: { y: today.getFullYear(), m: today.getMonth() },
  weather: {}, // { "YYYY-MM-DD": wmoCode } from Open-Meteo
};

function rowToStay(r) {
  return {
    id: r.id,
    names: Array.isArray(r.names) ? r.names : (r.names ? JSON.parse(r.names) : []),
    start: r.start_date, end: r.end_date,
    bringing: r.bringing || "", note: r.note || "", wholeHouse: !!r.whole_house,
  };
}

// ───────────────────────── data layer ─────────────────────────
async function loadAll() {
  if (!sb) { render(); return; }
  try {
    const [{ data: cfg }, { data: stayRows }, { data: logRows }] = await Promise.all([
      sb.from("config").select("*").eq("id", 1).maybeSingle(),
      sb.from("stays").select("*"),
      sb.from("audit_log").select("*").order("ts", { ascending: false }).limit(250),
    ]);
    if (cfg) state.config = { appName: cfg.app_name, capacity: cfg.capacity };
    state.stays = (stayRows || []).map(rowToStay);
    state.log = logRows || [];
  } catch (e) {
    console.error(e);
  }
  render();
}

async function saveConfig() {
  if (!sb) return;
  await sb.from("config").upsert({ id: 1, app_name: state.config.appName });
}

function summarize(prev, next) {
  if (!prev) {
    return { summary: `Added ${next.names.join(", ")} \u00b7 ${fmtRange(next.start, next.end)}`, details: { after: next } };
  }
  const pn = prev.names.map((x) => x.toLowerCase());
  const nn = next.names.map((x) => x.toLowerCase());
  const added = next.names.filter((x) => !pn.includes(x.toLowerCase()));
  const removed = prev.names.filter((x) => !nn.includes(x.toLowerCase()));
  const ch = [];
  if (added.length) ch.push(`added ${added.join(", ")}`);
  if (removed.length) ch.push(`removed ${removed.join(", ")}`);
  if (prev.start !== next.start || prev.end !== next.end)
    ch.push(`dates ${fmtRange(prev.start, prev.end)} \u2192 ${fmtRange(next.start, next.end)}`);
  if (!!prev.wholeHouse !== !!next.wholeHouse) ch.push(next.wholeHouse ? "marked whole house" : "unmarked whole house");
  if ((prev.bringing || "") !== (next.bringing || "")) ch.push("updated bringing");
  if ((prev.note || "") !== (next.note || "")) ch.push("updated note");
  return { summary: ch.length ? ch.join("; ") : "no changes", details: { before: prev, after: next }, empty: !ch.length };
}

async function commitStay(stay) {
  const editor = await ensureEditor();
  if (editor == null) return;
  if (!sb) { alert("Connect Supabase first (see config.js)."); return; }
  const prev = state.stays.find((s) => s.id === stay.id) || null;
  const row = {
    id: stay.id, names: stay.names, start_date: stay.start, end_date: stay.end,
    bringing: stay.bringing, note: stay.note, whole_house: stay.wholeHouse,
    updated_at: new Date().toISOString(),
  };
  const { error } = await sb.from("stays").upsert(row);
  if (error) { alert("Could not save: " + error.message); return; }
  const { summary, details, empty } = summarize(prev, stay);
  if (!(prev && empty)) {
    await sb.from("audit_log").insert({ editor, action: prev ? "edit" : "add", stay_id: stay.id, summary, details });
  }
  await loadAll();
}

async function commitDelete(id) {
  const editor = await ensureEditor();
  if (editor == null) return;
  if (!sb) return;
  const prev = state.stays.find((s) => s.id === id);
  const { error } = await sb.from("stays").delete().eq("id", id);
  if (error) { alert("Could not delete: " + error.message); return; }
  await sb.from("audit_log").insert({
    editor, action: "delete", stay_id: id,
    summary: `Deleted ${prev ? prev.names.join(", ") : "stay"} \u00b7 ${prev ? fmtRange(prev.start, prev.end) : ""}`,
    details: { before: prev },
  });
  await loadAll();
}

// ───────────────────────── derived ─────────────────────────
function staysOnDay(dayStr) {
  return state.stays.filter((s) => s.start <= dayStr && dayStr <= s.end)
    .sort((a, b) => a.start.localeCompare(b.start));
}
function knownNames() {
  const seen = new Map();
  state.stays.forEach((s) => s.names.forEach((n) => {
    const k = n.trim().toLowerCase();
    if (k && !seen.has(k)) seen.set(k, n.trim());
  }));
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

// ───────────────────────── export ─────────────────────────
function icsEscape(s) { return String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n"); }
function compactYmd(s) { return s.replace(/-/g, ""); }
function addDaysYmd(s, n) { const p = parts(s); return ymd(new Date(p.y, p.m, p.d + n)); }
function dtstampUTC() { const d = new Date(), p = (x) => String(x).padStart(2, "0"); return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`; }
function downloadBlob(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
}
function buildIcs() {
  const house = state.config.appName || "Lake House";
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Pleasant Lake//Scheduler//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  const stamp = dtstampUTC();
  state.stays.slice().sort((a, b) => a.start.localeCompare(b.start)).forEach((s) => {
    const names = s.names.join(", ");
    const desc = [s.bringing ? `Bringing: ${s.bringing}` : "", s.note || "", s.wholeHouse ? "Whole house" : ""].filter(Boolean).join("\\n");
    lines.push("BEGIN:VEVENT", `UID:${s.id}@pleasantlake`, `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compactYmd(s.start)}`, `DTEND;VALUE=DATE:${compactYmd(addDaysYmd(s.end, 1))}`,
      `SUMMARY:${icsEscape(house + ": " + names)}`);
    if (desc) lines.push(`DESCRIPTION:${icsEscape(desc)}`);
    lines.push("END:VEVENT");
  });
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}
function exportIcs() {
  downloadBlob("pleasant-lake.ics", new Blob([buildIcs()], { type: "text/calendar;charset=utf-8" }));
}
async function exportXlsx() {
  try {
    const XLSX = await import("https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs");
    const rows = [["Arrive", "Leave", "Nights", "Who", "People", "Whole house", "Bringing", "Note"]];
    state.stays.slice().sort((a, b) => a.start.localeCompare(b.start)).forEach((s) => {
      rows.push([s.start, s.end, nightsBetween(s.start, s.end), s.names.join(", "), s.names.length, s.wholeHouse ? "Yes" : "", s.bringing || "", s.note || ""]);
    });
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 12 }, { wch: 12 }, { wch: 7 }, { wch: 28 }, { wch: 8 }, { wch: 11 }, { wch: 20 }, { wch: 24 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Stays");
    if (state.log && state.log.length) {
      const lr = [["When", "Action", "By", "Details"]];
      state.log.forEach((e) => lr.push([new Date(e.ts).toLocaleString(), e.action, e.editor || "", e.summary || ""]));
      const lws = XLSX.utils.aoa_to_sheet(lr);
      lws["!cols"] = [{ wch: 20 }, { wch: 9 }, { wch: 14 }, { wch: 40 }];
      XLSX.utils.book_append_sheet(wb, lws, "Change log");
    }
    const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    downloadBlob("pleasant-lake.xlsx", new Blob([out], { type: "application/octet-stream" }));
  } catch (e) { alert("Could not build the spreadsheet: " + e.message); }
}

const ICON_GRID = `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2.5" y="3.5" width="15" height="13" rx="2"></rect><path d="M2.5 8h15M2.5 12h15M8 3.5v13M13 3.5v13"></path></svg>`;
const ICON_CAL = `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="2.8" y="4.2" width="14.4" height="12.5" rx="2"></rect><path d="M2.8 8h14.4"></path><path d="M6.5 2.6v3M13.5 2.6v3"></path></svg>`;

function openExportSheet() {
  const wrap = scrim(`
    <button class="sc-x" data-x>\u00d7</button>
    <h3>Export</h3>
    <p class="sub">Take a copy of the whole schedule, or add it to your calendar.</p>
    <button class="sc-exp" data-xlsx>
      <span class="ic x">${ICON_GRID}</span>
      <span class="tx"><b>Excel spreadsheet</b><small>Every stay and the change log, as an .xlsx file.</small></span>
    </button>
    <button class="sc-exp" data-ics>
      <span class="ic c">${ICON_CAL}</span>
      <span class="tx"><b>Add to calendar</b><small>An .ics file for Apple, Google, or Outlook.</small></span>
    </button>`);
  wrap.querySelector("[data-x]").onclick = closeModal;
  wrap.querySelector("[data-xlsx]").onclick = () => { closeModal(); exportXlsx(); };
  wrap.querySelector("[data-ics]").onclick = () => { closeModal(); exportIcs(); };
}

// ───────────────────────── weather (Open-Meteo) ─────────────────────────
const _rawLat = CONFIG.LAKE_LAT, _rawLon = CONFIG.LAKE_LON;
const LAKE_LAT = Number(_rawLat);
const LAKE_LON = Number(_rawLon);
// Weather is off unless BOTH coordinates are real, in-range numbers. This makes the
// documented "set to null to turn weather off" work (Number(null) is 0, which would
// otherwise sneak past a bare isFinite check and fetch weather for the ocean at 0,0),
// and rejects empty strings, garbage, and out-of-range typos (e.g. a missing decimal).
const WEATHER_ENABLED =
  _rawLat != null && _rawLon != null && _rawLat !== "" && _rawLon !== "" &&
  Number.isFinite(LAKE_LAT) && Number.isFinite(LAKE_LON) &&
  Math.abs(LAKE_LAT) <= 90 && Math.abs(LAKE_LON) <= 180;
const WEATHER_CACHE_KEY = "lh_weather_v2";
const WEATHER_TTL = 3 * 60 * 60 * 1000; // refresh at most every 3 hours
// Open-Meteo's daily weather_code reports the *most significant* condition of the
// day, which over-weights brief afternoon showers/storms (a 99%-sunny day with one
// passing storm gets coded "thunderstorm"). So instead of trusting the raw code, we
// derive the icon from how sunny the day actually is (sunshine vs daylight) and only
// show precipitation on genuinely wet days.
const WX_WET_MM = 2;        // >= this much precip → show the rain/storm/snow icon
const WX_SUN_CLEAR = 0.65;  // >= this fraction of daylight sunny → sunny icon
const WX_SUN_PARTLY = 0.35; // >= this → partly sunny; below → cloudy

// Map a WMO weather code to an icon category + human label.
function wmo(code) {
  if (code === 0) return { cat: "clear", label: "Clear" };
  if (code === 1 || code === 2) return { cat: "partly", label: "Partly cloudy" };
  if (code === 3) return { cat: "cloudy", label: "Overcast" };
  if (code === 45 || code === 48) return { cat: "fog", label: "Fog" };
  if (code === 56 || code === 57) return { cat: "sleet", label: "Freezing drizzle" };
  if (code >= 51 && code <= 55) return { cat: "drizzle", label: "Drizzle" };
  if ((code >= 61 && code <= 65) || (code >= 80 && code <= 82)) return { cat: "rain", label: "Rain" };
  if (code === 66 || code === 67) return { cat: "sleet", label: "Freezing rain" };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { cat: "snow", label: "Snow" };
  if (code >= 95) return { cat: "storm", label: "Thunderstorm" };
  return null;
}

// Pick the icon for a day from how sunny it really was + how much it actually rained,
// falling back to the raw code only when sunshine data is missing.
function deriveDay(code, sunshine, daylight, precip) {
  const base = wmo(code);
  const sunPct = (daylight > 0 && sunshine != null) ? sunshine / daylight : null;
  const wet = precip != null && precip >= WX_WET_MM;
  const precipCats = ["drizzle", "rain", "sleet", "snow", "storm"];
  // Genuinely wet day → show the precipitation type from the code.
  if (base && wet && precipCats.includes(base.cat)) return base;
  // Any real snowfall reads as snow even if the melt-equivalent is small.
  if (base && base.cat === "snow" && precip > 0) return base;
  // Otherwise classify by sunshine.
  if (sunPct != null) {
    if (sunPct >= WX_SUN_CLEAR) return { cat: "clear", label: "Sunny" };
    if (sunPct >= WX_SUN_PARTLY) return { cat: "partly", label: "Partly sunny" };
    return { cat: "cloudy", label: "Cloudy" };
  }
  return base; // no sunshine data — fall back to the code's mapping
}

const CLOUD = (fill, dy) => `<g fill="${fill}"><circle cx="9" cy="${11 + dy}" r="3.2"/><circle cx="14" cy="${10 + dy}" r="3.7"/><circle cx="13.3" cy="${12.6 + dy}" r="3.2"/><rect x="7.2" y="${11 + dy}" width="9.8" height="3.6" rx="1.8"/></g>`;
const WEATHER_SVGS = {
  clear: `<g stroke="#E0A23F" stroke-width="1.7" stroke-linecap="round"><line x1="12" y1="2.5" x2="12" y2="4.8"/><line x1="12" y1="19.2" x2="12" y2="21.5"/><line x1="2.5" y1="12" x2="4.8" y2="12"/><line x1="19.2" y1="12" x2="21.5" y2="12"/><line x1="5" y1="5" x2="6.6" y2="6.6"/><line x1="17.4" y1="17.4" x2="19" y2="19"/><line x1="5" y1="19" x2="6.6" y2="17.4"/><line x1="17.4" y1="6.6" x2="19" y2="5"/></g><circle cx="12" cy="12" r="4.4" fill="#E7B45E"/>`,
  partly: `<g stroke="#E0A23F" stroke-width="1.4" stroke-linecap="round"><line x1="15.5" y1="2.6" x2="15.5" y2="4.4"/><line x1="20.6" y1="8" x2="22.2" y2="8"/><line x1="19.1" y1="4.4" x2="20.3" y2="3.2"/><line x1="12.2" y1="4.4" x2="11" y2="3.2"/></g><circle cx="15.5" cy="8" r="3" fill="#E7B45E"/>${CLOUD("#9AA3A8", 3.5)}`,
  cloudy: `${CLOUD("#9AA3A8", 1.5)}`,
  fog: `${CLOUD("#AEB6BA", -0.5)}<g stroke="#9AA3A8" stroke-width="1.6" stroke-linecap="round"><line x1="5.5" y1="17" x2="16" y2="17"/><line x1="7.5" y1="20" x2="18.5" y2="20"/></g>`,
  drizzle: `${CLOUD("#9AA3A8", 0)}<g stroke="#5C8AA6" stroke-width="1.5" stroke-linecap="round"><line x1="10" y1="17" x2="9.3" y2="19.2"/><line x1="14" y1="17" x2="13.3" y2="19.2"/></g>`,
  rain: `${CLOUD("#9AA3A8", 0)}<g stroke="#3F6373" stroke-width="1.7" stroke-linecap="round"><line x1="9" y1="16.6" x2="8" y2="20"/><line x1="12.5" y1="16.6" x2="11.5" y2="20"/><line x1="16" y1="16.6" x2="15" y2="20"/></g>`,
  sleet: `${CLOUD("#9AA3A8", 0)}<g stroke="#5C8AA6" stroke-width="1.6" stroke-linecap="round"><line x1="10" y1="16.6" x2="9.2" y2="19"/></g><circle cx="14.5" cy="18.3" r="1.1" fill="#6F97AD"/>`,
  snow: `${CLOUD("#9AA3A8", 0)}<g fill="#7FB0CC"><circle cx="9.5" cy="18" r="1.1"/><circle cx="13" cy="19" r="1.1"/><circle cx="16" cy="17.6" r="1.1"/></g>`,
  storm: `${CLOUD("#8B939A", -0.5)}<path d="M12.5 13.3l-3 4h2.2l-1 3.6 3.4-4.5h-2.2l1.1-3.1z" fill="#E7B45E"/>`,
};

function weatherIcon(dateStr, variant) {
  if (!WEATHER_ENABLED || !dateStr) return "";
  const w = state.weather[dateStr];
  if (!w || !WEATHER_SVGS[w.cat]) return "";
  const cls = variant === "cal" ? "wx wx-cal" : "wx wx-row";
  return `<span class="${cls}" title="${esc(w.label)}" role="img" aria-label="${esc(w.label)}"><svg viewBox="0 0 24 24">${WEATHER_SVGS[w.cat]}</svg></span>`;
}

function cacheWeather() {
  try { localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify({ at: Date.now(), lat: LAKE_LAT, lon: LAKE_LON, days: state.weather })); } catch (e) {}
}
function loadWeatherCache() {
  if (!WEATHER_ENABLED) return;
  try {
    const c = JSON.parse(localStorage.getItem(WEATHER_CACHE_KEY) || "null");
    if (c && c.lat === LAKE_LAT && c.lon === LAKE_LON && c.days) state.weather = c.days;
  } catch (e) {}
}
async function fetchWeather() {
  if (!WEATHER_ENABLED) return;
  let lastAt = 0;
  try {
    const c = JSON.parse(localStorage.getItem(WEATHER_CACHE_KEY) || "null");
    if (c && c.lat === LAKE_LAT && c.lon === LAKE_LON) lastAt = c.at || 0;
  } catch (e) {}
  if (lastAt && Date.now() - lastAt < WEATHER_TTL) return; // cache still fresh
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${LAKE_LAT}&longitude=${LAKE_LON}&daily=weather_code,sunshine_duration,daylight_duration,precipitation_sum&timezone=auto&past_days=92&forecast_days=16`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("weather HTTP " + res.status);
    const data = await res.json();
    const dy = data.daily || {};
    const times = dy.time || [];
    const map = {};
    for (let i = 0; i < times.length; i++) {
      const w = deriveDay(
        dy.weather_code ? dy.weather_code[i] : null,
        dy.sunshine_duration ? dy.sunshine_duration[i] : null,
        dy.daylight_duration ? dy.daylight_duration[i] : null,
        dy.precipitation_sum ? dy.precipitation_sum[i] : null
      );
      if (w) map[times[i]] = w;
    }
    state.weather = map;
    cacheWeather();
    render();
  } catch (e) {
    console.error("weather fetch failed", e);
  }
}

// ───────────────────────── render ─────────────────────────
const appEl = document.getElementById("app");

function nameTags(names) {
  return names.map((nm) => {
    const c = colorFor(nm);
    return `<span class="sc-nametag" style="background:${c.soft};color:${c.strong};border-left-color:${c.strong}">${esc(nm)}</span>`;
  }).join("");
}

function renderHeader() {
  const editorLine = editorName
    ? `Editing as <b>${esc(editorName)}</b> <button data-action="change-editor">change</button>`
    : `<button data-action="change-editor">Set your name for the change log</button>`;
  return `
    <header class="sc-head">
      <div class="sc-eyebrow">Shared Schedule</div>
      <h1 class="sc-title"><input id="appName" aria-label="House name" value="${esc(state.config.appName)}"></h1>
      <div class="sc-stripe"></div>
      <div class="sc-meta">
        <span class="sc-editor">${editorLine}</span>
      </div>
    </header>`;
}

function renderBar() {
  const t = (v, label) => `<button class="${state.view === v ? "on" : ""}" data-action="view" data-view="${v}">${label}</button>`;
  return `<div class="sc-bar">
    <div class="sc-toggle">${t("calendar", "Calendar")}${t("list", "List")}${t("activity", "Activity")}</div>
    <div class="sc-baractions">
      <button class="sc-ghostbtn" data-action="export">Export</button>
      <button class="sc-add" data-action="add">+ Add a stay</button>
    </div>
  </div>`;
}

function renderCalendar() {
  const { y, m } = state.cur;
  const cells = monthMatrix(y, m);
  const dows = DOW.map((d) => `<span>${d}</span>`).join("");
  const grid = cells.map((d, i) => {
    if (!d) return `<div class="sc-cell blank"></div>`;
    const ds = ymd(d);
    const list = staysOnDay(ds);
    const pills = [];
    list.forEach((s) => s.names.forEach((nm, idx) => pills.push({ nm, star: s.wholeHouse && idx === 0 })));
    const shown = pills.slice(0, 4).map((p) => {
      const c = colorFor(p.nm);
      return `<span class="sc-pill" style="background:${c.soft};color:${c.strong};border-left-color:${c.strong}">${esc(p.nm)}${p.star ? " \u2605" : ""}</span>`;
    }).join("");
    const more = pills.length > 4 ? `<span class="sc-more">+${pills.length - 4} more</span>` : "";
    return `<button class="sc-cell ${ds === todayStr ? "today" : ""}" data-action="day" data-day="${ds}">
      <div class="sc-dhead"><span class="sc-dnum">${d.getDate()}</span>${ds >= todayStr ? weatherIcon(ds, "cal") : ""}</div>${shown}${more}</button>`;
  }).join("");
  return `<div class="sc-cal">
    <div class="sc-navrow">
      <h3>${MONTH_LONG[m]} ${y}</h3>
      <div>
        <button class="sc-nav" data-action="prev" aria-label="Previous month">\u2039</button>
        <button class="sc-nav" data-action="next" aria-label="Next month" style="margin-left:6px">\u203a</button>
        <button class="sc-today" data-action="thismonth">Today</button>
      </div>
    </div>
    <div class="sc-dows">${dows}</div>
    <div class="sc-grid">${grid}</div>
  </div>`;
}

function renderListSection(list, isPast) {
  let lastMonth = null, out = "";
  list.forEach((s) => {
    const p = parts(s.start);
    const label = `${MONTH_LONG[p.m]} ${p.y}`;
    if (label !== lastMonth) { lastMonth = label; out += `<div class="sc-month"><h2>${label}</h2><span class="rule"></span></div>`; }
    const n = nightsBetween(s.start, s.end);
    out += `<div class="sc-row ${isPast ? "past" : ""}">
      <div class="sc-rmain">
        <div class="sc-rwhen">${weatherIcon(s.start, "row")}${fmtRange(s.start, s.end)}</div>
        <div class="sc-rnames">${nameTags(s.names)}</div>
        <div class="sc-rdet">${s.names.length} ${s.names.length === 1 ? "person" : "people"}${n > 0 ? ` \u00b7 ${n} ${n === 1 ? "night" : "nights"}` : " \u00b7 day trip"}${s.bringing ? ` \u00b7 bringing ${esc(s.bringing)}` : ""}</div>
        ${s.note ? `<div class="sc-rdet">${esc(s.note)}</div>` : ""}
        ${s.wholeHouse ? `<span class="sc-tag">Whole house</span>` : ""}
      </div>
      <div class="sc-rowbtns">
        <button class="sc-mini" data-action="edit" data-id="${s.id}">Edit</button>
        <button class="sc-mini del" data-action="delete" data-id="${s.id}">Delete</button>
      </div>
    </div>`;
  });
  return out;
}

function renderList() {
  const upcoming = state.stays.filter((s) => s.end >= todayStr).sort((a, b) => a.start.localeCompare(b.start));
  const past = state.stays.filter((s) => s.end < todayStr).sort((a, b) => b.start.localeCompare(a.start));
  if (!upcoming.length && !past.length)
    return `<div class="sc-list"><div class="sc-empty">No stays booked yet. Tap \u201cAdd a stay\u201d to claim your dates.</div></div>`;
  let html = `<div class="sc-list">${renderListSection(upcoming, false)}`;
  if (past.length) html += `<div class="sc-month"><h2>Past</h2><span class="rule"></span></div>${renderListSection(past, true)}`;
  return html + `</div>`;
}

function renderActivity() {
  if (!state.log.length)
    return `<div class="sc-log"><div class="sc-empty">No changes yet. Every add, edit, and delete will show up here with who made it.</div></div>`;
  const items = state.log.map((e) => {
    const when = new Date(e.ts).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    const action = (e.action || "edit").toLowerCase();
    const label = action === "add" ? "Added" : action === "delete" ? "Deleted" : "Edited";
    return `<div class="sc-logitem">
      <span class="sc-badge ${action}">${label}</span>
      <div class="sc-logmain">
        <div class="sc-logsum">${esc(e.summary || "")}</div>
        <div class="sc-logmeta">by <b>${esc(e.editor || "someone")}</b> \u00b7 ${esc(when)}</div>
      </div>
    </div>`;
  }).join("");
  return `<div class="sc-log">${items}</div>`;
}

function configBanner() {
  if (CONFIGURED) return "";
  return `<div class="sc-banner"><b>Almost there.</b> This app isn't connected to a database yet, so nothing will save or sync. Open <code>config.js</code> and paste your Supabase Project URL and anon key, then reload. Setup steps are in <code>README.md</code>.</div>`;
}

function render() {
  appEl.innerHTML = `<div class="sc-wrap">
    ${renderHeader()}
    ${configBanner()}
    ${renderBar()}
    ${state.view === "calendar" ? renderCalendar() : ""}
    ${state.view === "list" ? renderList() : ""}
    ${state.view === "activity" ? renderActivity() : ""}
    <div class="sc-foot">Shared with everyone who opens this app \u00b7 each name has its own color \u00b7 \u2605 marks a whole-house stay.</div>
  </div>`;
}

// ───────────────────────── events ─────────────────────────
appEl.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const a = btn.dataset.action;
  if (a === "view") { state.view = btn.dataset.view; render(); }
  else if (a === "add") openStayForm(null, todayStr);
  else if (a === "export") openExportSheet();
  else if (a === "prev") { shiftMonth(-1); render(); }
  else if (a === "next") { shiftMonth(1); render(); }
  else if (a === "thismonth") { state.cur = { y: today.getFullYear(), m: today.getMonth() }; render(); }
  else if (a === "day") openDayPanel(btn.dataset.day);
  else if (a === "edit") openStayForm(state.stays.find((s) => s.id === btn.dataset.id), null);
  else if (a === "delete") { if (confirm("Delete this stay?")) commitDelete(btn.dataset.id); }
  else if (a === "change-editor") promptEditor(true);
});
appEl.addEventListener("change", (e) => {
  if (e.target.id === "appName") { state.config.appName = e.target.value.trim() || "Family Lake House"; saveConfig(); }
});
function shiftMonth(delta) {
  let { y, m } = state.cur;
  m += delta;
  if (m < 0) { m = 11; y--; }
  if (m > 11) { m = 0; y++; }
  state.cur = { y, m };
}

// ───────────────────────── modals ─────────────────────────
const modalRoot = document.getElementById("modal-root");
function closeModal() { modalRoot.innerHTML = ""; }
function scrim(innerHTML) {
  const wrap = document.createElement("div");
  wrap.className = "sc-scrim";
  wrap.innerHTML = `<div class="sc-sheet">${innerHTML}</div>`;
  wrap.addEventListener("click", (e) => { if (e.target === wrap) closeModal(); });
  modalRoot.innerHTML = "";
  modalRoot.appendChild(wrap);
  return wrap;
}

function ensureEditor() {
  if (editorName) return Promise.resolve(editorName);
  return new Promise((resolve) => promptEditor(false, resolve));
}
function promptEditor(forceChange, resolve) {
  const wrap = scrim(`
    <button class="sc-x" data-x>\u00d7</button>
    <h3>${forceChange ? "Change your name" : "Who's making this change?"}</h3>
    <p class="sub">Your name is attached to every change you make, so the family can see who did what. Saved on this device only.</p>
    <div class="sc-field"><label>Your name</label><input id="ed" type="text" placeholder="e.g. Tim" value="${esc(forceChange ? editorName : "")}"></div>
    <div class="sc-actions"><button class="sc-btn amber" data-save>Save</button></div>`);
  const input = wrap.querySelector("#ed");
  input.focus();
  const finish = (val) => { closeModal(); if (resolve) resolve(val); };
  wrap.querySelector("[data-x]").onclick = () => finish(null);
  wrap.querySelector("[data-save]").onclick = () => {
    const v = input.value.trim();
    if (!v) { input.focus(); return; }
    editorName = v;
    localStorage.setItem("editorName", v);
    if (forceChange) { closeModal(); render(); } else { closeModal(); render(); if (resolve) resolve(v); }
  };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") wrap.querySelector("[data-save]").click(); });
}

function openDayPanel(dayStr) {
  const list = staysOnDay(dayStr);
  const body = list.length
    ? list.map((s) => `<div class="sc-att">
        <div style="flex:1">
          <div class="when">${fmtRange(s.start, s.end)}${s.wholeHouse ? " \u00b7 whole house" : ""}</div>
          <div class="sc-rnames" style="margin-top:0">${nameTags(s.names)}</div>
          ${s.bringing ? `<div class="sc-rdet">Bringing: ${esc(s.bringing)}</div>` : ""}
          ${s.note ? `<div class="sc-rdet">${esc(s.note)}</div>` : ""}
        </div>
        <button class="sc-mini" data-edit="${s.id}">Edit</button>
      </div>`).join("")
    : `<div class="sc-empty">Nobody booked. The house is open.</div>`;
  const wrap = scrim(`
    <button class="sc-x" data-x>\u00d7</button>
    <h3>${fmtRange(dayStr, dayStr)}</h3>
    <p class="sub">Who's at the house this day</p>
    ${body}
    <div class="sc-actions" style="margin-top:16px"><button class="sc-btn amber" data-addhere>+ Add a stay starting here</button></div>`);
  wrap.querySelector("[data-x]").onclick = closeModal;
  wrap.querySelector("[data-addhere]").onclick = () => openStayForm(null, dayStr);
  wrap.querySelectorAll("[data-edit]").forEach((b) =>
    b.addEventListener("click", () => openStayForm(state.stays.find((s) => s.id === b.dataset.edit), null)));
}

function openStayForm(editing, prefillStart) {
  let names = editing ? [...editing.names] : [];

  const wrap = scrim(`
    <button class="sc-x" data-x>\u00d7</button>
    <h3>${editing ? "Edit stay" : "Add a stay"}</h3>
    <p class="sub">Add everyone coming, then set the dates.</p>
    <div class="sc-warn-msg" data-err style="display:none"></div>
    <div class="sc-field">
      <label>Who's coming</label>
      <div class="sc-nameadd">
        <input type="text" id="nm" placeholder="Type a name">
        <button class="sc-addbtn" data-addname>Add</button>
      </div>
      <div class="sc-namechips" data-chips></div>
    </div>
    <div class="sc-quick" data-quickwrap style="display:none">
      <div class="qlab">Quick add</div><div class="qrow" data-quick></div>
    </div>
    <div class="sc-field">
      <label>Dates</label>
      <div class="rp" data-rp></div>
      <div class="rp-summary" data-rpsum></div>
    </div>
    <div class="sc-field"><label>Bringing (optional)</label><input type="text" id="bringing" placeholder="boat, the dog, groceries\u2026" value="${esc(editing ? editing.bringing : "")}"></div>
    <div class="sc-field"><label>Note (optional)</label><input type="text" id="note" placeholder="Arriving late Friday" value="${esc(editing ? editing.note : "")}"></div>
    <label class="sc-check"><input type="checkbox" id="whole" ${editing && editing.wholeHouse ? "checked" : ""}> We're taking the whole house</label>
    <div class="sc-actions">
      <button class="sc-btn amber" data-save>${editing ? "Save changes" : "Add stay"}</button>
      ${editing ? `<button class="sc-btn danger" data-del>Delete</button>` : ""}
    </div>`);

  const chipsEl = wrap.querySelector("[data-chips]");
  const quickWrap = wrap.querySelector("[data-quickwrap]");
  const quickEl = wrap.querySelector("[data-quick]");
  const nmEl = wrap.querySelector("#nm");
  const rpEl = wrap.querySelector("[data-rp]");
  const rpSum = wrap.querySelector("[data-rpsum]");
  const errEl = wrap.querySelector("[data-err]");

  let selStart = editing ? editing.start : null;
  let selEnd = editing ? editing.end : null;
  const seedP = parts(selStart || prefillStart || todayStr);
  let viewM = { y: seedP.y, m: seedP.m };

  function pickDate(ds) {
    if (!selStart || (selStart && selEnd)) { selStart = ds; selEnd = null; }
    else if (ds < selStart) { selStart = ds; }
    else { selEnd = ds; }
    drawPicker();
  }
  function shiftView(d) { let nm = viewM.m + d, ny = viewM.y; if (nm < 0) { nm = 11; ny--; } if (nm > 11) { nm = 0; ny++; } viewM = { y: ny, m: nm }; drawPicker(); }
  function drawPicker() {
    const cells = monthMatrix(viewM.y, viewM.m);
    const dows = ["S", "M", "T", "W", "T", "F", "S"].map((d) => `<span>${d}</span>`).join("");
    const grid = cells.map((d) => {
      if (!d) return `<div class="rp-cell"></div>`;
      const ds = ymd(d);
      const isStart = selStart && ds === selStart, isEnd = selEnd && ds === selEnd;
      const inRange = selStart && selEnd && ds > selStart && ds < selEnd;
      let cls = "rp-cell";
      if (isStart || isEnd) cls += " ep";
      if (inRange) cls += " inrange";
      if (isStart && selEnd && selStart !== selEnd) cls += " bandr";
      if (isEnd && selStart !== selEnd) cls += " bandl";
      return `<div class="${cls}"><button type="button" class="rp-day ${ds === todayStr ? "today" : ""}" data-d="${ds}">${d.getDate()}</button></div>`;
    }).join("");
    rpEl.innerHTML = `
      <div class="rp-head">
        <button type="button" class="sc-nav" data-pm="-1" aria-label="Previous month">\u2039</button>
        <span>${MONTH_LONG[viewM.m]} ${viewM.y}</span>
        <button type="button" class="sc-nav" data-pm="1" aria-label="Next month">\u203a</button>
      </div>
      <div class="rp-dow">${dows}</div>
      <div class="rp-grid">${grid}</div>`;
    rpEl.querySelectorAll("[data-pm]").forEach((b) => b.addEventListener("click", () => shiftView(Number(b.dataset.pm))));
    rpEl.querySelectorAll("[data-d]").forEach((b) => b.addEventListener("click", () => pickDate(b.dataset.d)));
    if (!selStart) rpSum.textContent = "Tap your arrival date";
    else if (!selEnd) rpSum.textContent = "Now tap your departure date";
    else { const n = nightsBetween(selStart, selEnd); rpSum.textContent = `${fmtRange(selStart, selEnd)} \u00b7 ${n === 0 ? "day trip" : n + (n === 1 ? " night" : " nights")}`; }
  }

  function drawChips() {
    chipsEl.innerHTML = names.map((nm, i) => {
      const c = colorFor(nm);
      return `<span class="sc-namechip" style="background:${c.soft};color:${c.strong};border-left-color:${c.strong}">${esc(nm)}<button data-rm="${i}" aria-label="Remove">\u00d7</button></span>`;
    }).join("");
    chipsEl.querySelectorAll("[data-rm]").forEach((b) =>
      b.addEventListener("click", () => { names.splice(Number(b.dataset.rm), 1); drawChips(); drawQuick(); }));
  }
  function drawQuick() {
    const sugg = knownNames().filter((n) => !names.some((x) => x.toLowerCase() === n.toLowerCase()));
    if (!sugg.length) { quickWrap.style.display = "none"; return; }
    quickWrap.style.display = "";
    quickEl.innerHTML = sugg.map((n) => `<button class="sc-qchip" data-q="${esc(n)}">+ ${esc(n)}</button>`).join("");
    quickEl.querySelectorAll("[data-q]").forEach((b) =>
      b.addEventListener("click", () => { addName(b.dataset.q); }));
  }
  function addName(raw) {
    const v = (raw ?? nmEl.value).trim();
    if (!v) return;
    if (!names.some((n) => n.toLowerCase() === v.toLowerCase())) names.push(v);
    nmEl.value = "";
    drawChips(); drawQuick();
  }

  drawChips(); drawQuick(); drawPicker();
  wrap.querySelector("[data-x]").onclick = closeModal;
  wrap.querySelector("[data-addname]").onclick = () => addName();
  nmEl.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addName(); } });
  if (editing) wrap.querySelector("[data-del]").onclick = () => { if (confirm("Delete this stay?")) { closeModal(); commitDelete(editing.id); } };

  wrap.querySelector("[data-save]").onclick = () => {
    const fail = (msg) => { errEl.textContent = msg; errEl.style.display = ""; };
    if (!names.length) return fail("Add at least one name.");
    if (!selStart) return fail("Tap your arrival date on the calendar.");
    const start = selStart, end = selEnd || selStart;
    const stay = {
      id: editing ? editing.id : uuid(),
      names, start, end,
      bringing: wrap.querySelector("#bringing").value.trim(),
      note: wrap.querySelector("#note").value.trim(),
      wholeHouse: wrap.querySelector("#whole").checked,
    };
    closeModal();
    commitStay(stay);
  };
}

// ───────────────────────── password gate + boot ─────────────────────────
function boot() {
  loadWeatherCache();
  render();
  loadAll();
  fetchWeather();
  // If we were offline at launch (or the fetch failed), recover when connectivity
  // returns. fetchWeather is TTL-guarded, so this is a no-op once weather is fresh.
  window.addEventListener("online", fetchWeather);
  if (sb) {
    sb.channel("rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "stays" }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "audit_log" }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "config" }, loadAll)
      .subscribe();
  }
}

function renderLock() {
  appEl.innerHTML = `
    <div class="lock"><div class="lock-card">
      <svg width="80" height="80" viewBox="0 0 76 76" aria-hidden="true">
        <rect width="76" height="76" rx="18" fill="#24402E"></rect>
        <circle cx="55" cy="19" r="7.5" fill="#E7B45E"></circle>
        <polygon points="-2,47 16,27 33,47" fill="#3C5A40"></polygon>
        <polygon points="20,47 42,23 64,47" fill="#46694B"></polygon>
        <rect y="46" width="76" height="30" fill="#2C4A4A"></rect>
        <polygon points="14,52 20,39 26,52" fill="#15281A"></polygon>
        <polygon points="14,58 20,46 26,58" fill="#15281A"></polygon>
        <rect x="18.7" y="56" width="2.6" height="6" fill="#15281A"></rect>
        <polygon points="48,52 54,39 60,52" fill="#15281A"></polygon>
        <polygon points="48,58 54,46 60,58" fill="#15281A"></polygon>
        <rect x="52.7" y="56" width="2.6" height="6" fill="#15281A"></rect>
        <rect x="50" y="55" width="10" height="2" rx="1" fill="#E7B45E" opacity="0.45"></rect>
      </svg>
      <h1>Pleasant Lake</h1>
      <div class="lock-stripe"></div>
      <p>Enter the house password</p>
      <form id="lockform" autocomplete="on">
        <input type="text" name="username" autocomplete="username" value="Pleasant Lake House" readonly aria-hidden="true" class="lock-hidden" tabindex="-1">
        <input type="password" id="lockpw" name="password" autocomplete="current-password" placeholder="Password" autofocus>
        <label class="lock-showrow"><input type="checkbox" id="lockshow"> Show password</label>
        <div class="lock-err" id="lockerr"></div>
        <button type="submit">Unlock</button>
      </form>
    </div></div>`;
  const form = document.getElementById("lockform");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const pw = document.getElementById("lockpw").value;
    if (pw === PASSWORD) {
      setUnlocked();
      boot();
    } else {
      document.getElementById("lockerr").textContent = "That's not the house password.";
    }
  });
  const pwEl = document.getElementById("lockpw");
  if (pwEl) pwEl.focus();
  const showBox = document.getElementById("lockshow");
  if (showBox) showBox.addEventListener("change", () => {
    pwEl.type = showBox.checked ? "text" : "password";
  });
}

if (isUnlocked()) boot();
else renderLock();
