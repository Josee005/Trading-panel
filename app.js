/* Grok Bot · panel estático: Supabase Auth (email+contraseña) + lectura con RLS. Solo clave publicable.
   Spot, solo long, sin apalancamiento, BTCUSDT y ETHUSDT en Binance TESTNET. Solo datos reales de las tablas
   (el modo ?mock=… solo existe en localhost y carga mock.js, con aviso DEMO). */
const SUPABASE_URL = "https://mhqjnkdvokzrygixkfjb.supabase.co";
const SUPABASE_KEY = "sb_publishable_1i0XytrkfPxzhPZMTp6zZA_x7bu9sNn";
const TZ = "Europe/Madrid";
const STALE_SECONDS = 180;
const POLL_MS = 10000;
const SYMBOLS = ["BTCUSDT", "ETHUSDT"];
const MOCK = typeof window.__MOCK__ !== "undefined" && /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
const AGENTS = [
  ["scout", "SCOUT", "Precios y velas 1m"],
  ["filtro", "FILTRO", "Tendencia · confirmación · volumen · RSI"],
  ["analista", "ANALISTA", "EMA20 / EMA50"],
  ["ejecutor", "EJECUTOR", "Órdenes y tamaño"],
  ["riesgo", "RIESGO", "SL/TP y pérdida diaria"],
  ["logger", "LOGGER", "Último registro"],
];

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});
const $ = (id) => document.getElementById(id);
let snapshotTs = null, pollTimer = null, controls = null;
const S = { snap: null, pos: [], pairs: [], posCandles: {} };   // último estado cargado
const livePx = {};                                              // último precio por WebSocket, por símbolo

const NUM = "de-DE";                                            // 1.234,56 (con separador de miles siempre)
const fmtUsd = (x, d = 2) => x == null || isNaN(x) ? "–" : Number(x).toLocaleString(NUM, { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtSigned = (x) => x == null ? "–" : (x > 0.005 ? "+" : x < -0.005 ? "−" : "") + fmtUsd(Math.abs(x));
const fmtSignedD = (x) => x == null ? "–" : (x >= 0 ? "+" : "−") + "$" + fmtUsd(Math.abs(x));
const fmtPct = (x, d = 2) => x == null || isNaN(x) ? "–" : (x >= 0 ? "+" : "−") + Math.abs(x).toLocaleString(NUM, { minimumFractionDigits: d, maximumFractionDigits: d }) + "%";
const fmtQty = (x) => x == null || isNaN(x) ? "–" : Number(x).toLocaleString(NUM, { maximumFractionDigits: 6 });
const cls = (x) => x > 0.005 ? "pos" : x < -0.005 ? "neg" : "zero";
const coinOf = (sym) => String(sym || "").replace("USDT", "");
const timeFmt = new Intl.DateTimeFormat("es-ES", { timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const dateFmt = new Intl.DateTimeFormat("es-ES", { timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
const hmFmt = new Intl.DateTimeFormat("es-ES", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
const hmsParts = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
function madridSecOfDay(d) {
  const [h, m, s] = hmsParts.format(d || new Date()).split(":").map(Number);
  return (h % 24) * 3600 + m * 60 + s;
}
const dayStartMs = () => Date.now() - madridSecOfDay() * 1000;   // medianoche (Madrid) de hoy
function ago(s) {
  if (s < 60) return Math.max(0, Math.round(s)) + " s";
  if (s < 3600) return Math.floor(s / 60) + " min";
  if (s < 86400) return Math.floor(s / 3600) + " h";
  return Math.floor(s / 86400) + " d";
}
function tierFor(l) {
  if (l <= 3) return { pos: 5, sl: 1.5, tp: 3, loss: 3 };
  if (l <= 7) return { pos: 10, sl: 2, tp: 4, loss: 5 };
  return { pos: 20, sl: 3, tp: 6, loss: 10 };
}
function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}
function html(tag, className, markup) { const e = el(tag, className); e.innerHTML = markup; return e; }   // markup SOLO estático/numérico

/* ---------- iconos de moneda (SVG propio, sin recursos externos) ---------- */
const COIN_INNER = {
  BTC: '<circle cx="16" cy="16" r="16" fill="#f7931a"/><path fill="#fff" d="M21.2 14.1c.3-2-1.2-3.1-3.3-3.8l.7-2.7-1.6-.4-.7 2.6-1.3-.3.7-2.6-1.6-.4-.7 2.7-1-.2-2.2-.6-.4 1.7s1.2.3 1.2.3c.7.2.8.6.8.9l-.8 3.2h.2l-.2-.1-1.1 4.5c-.1.2-.3.5-.8.4 0 0-1.2-.3-1.2-.3l-.8 1.9 2.1.5 1.1.3-.7 2.8 1.6.4.7-2.7 1.3.3-.7 2.7 1.7.4.7-2.8c2.8.5 4.9.3 5.8-2.2.7-2-.04-3.2-1.5-4 1.1-.2 1.9-1 2.1-2.4zm-3.8 5.3c-.5 2-3.9.9-5 .7l.9-3.6c1.1.3 4.6.8 4.1 2.9zm.5-5.3c-.5 1.8-3.3.9-4.2.7l.8-3.3c.9.2 3.9.6 3.4 2.6z"/>',
  ETH: '<circle cx="16" cy="16" r="16" fill="#627eea"/><path fill="#fff" fill-opacity=".6" d="M16.5 4v8.9l7.5 3.3z"/><path fill="#fff" d="M16.5 4L9 16.2l7.5-3.3z"/><path fill="#fff" fill-opacity=".6" d="M16.5 21.9V28L24 17.5z"/><path fill="#fff" d="M16.5 28v-6.1L9 17.5z"/><path fill="#fff" fill-opacity=".2" d="M16.5 20.6l7.5-4.4-7.5-3.3z"/><path fill="#fff" fill-opacity=".5" d="M9 16.2l7.5 4.4v-7.7z"/>',
};
const coinInner = (sym) => COIN_INNER[coinOf(sym)] || '<circle cx="16" cy="16" r="16" fill="#8a9a92"/>';
const coinSvg = (sym, cl) => `<svg class="${cl || "coin"}" viewBox="0 0 32 32" aria-hidden="true">${coinInner(sym)}</svg>`;

/* ---------- auth ---------- */
function show(which) {
  $("login").classList.toggle("hidden", which !== "login");
  $("app").classList.toggle("hidden", which !== "app");
}
$("loginForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  $("loginErr").textContent = "";
  const { error } = await sb.auth.signInWithPassword({ email: $("email").value.trim(), password: $("password").value });
  if (error) $("loginErr").textContent = "No se pudo entrar: " + (error.message || "credenciales incorrectas");
  $("password").value = "";
});
$("logout").addEventListener("click", () => { if (MOCK) return; sb.auth.signOut(); });
if (MOCK) {
  const b = $("demoBanner"); b.textContent = "DEMO · datos de ejemplo, NO reales · solo en localhost"; b.classList.remove("hidden");
  show("app"); refresh(); pollTimer = setInterval(refresh, POLL_MS);
} else {
  sb.auth.onAuthStateChange((_ev, session) => {
    clearInterval(pollTimer);
    if (session) { show("app"); refresh(); pollTimer = setInterval(refresh, POLL_MS); }
    else show("login");
  });
  sb.auth.getSession().then(({ data }) => { if (!data.session) show("login"); });
}

/* ---------- reloj y anillo de sesión (hoy, Europe/Madrid) ---------- */
function tickClock() {
  const d = new Date(), sec = madridSecOfDay(d);
  $("clock").textContent = hmFmt.format(d);
  $("ringTxt").textContent = Math.floor(sec / 3600) + "h";
  $("ringArc").setAttribute("stroke-dasharray", (113.1 * sec / 86400).toFixed(1) + " 113.1");
}
setInterval(tickClock, 1000); tickClock();

/* ---------- data ---------- */
async function fetchAll() {
  if (MOCK) return window.__MOCK__.fetchAll();
  const [snap, pos, trades, logs, ctl] = await Promise.all([
    sb.from("bot_snapshot").select("*").eq("id", 1).maybeSingle(),
    sb.from("positions").select("*").order("opened_at", { ascending: false }),
    sb.from("trades").select("*").order("ts", { ascending: false }).limit(200),
    sb.from("bot_log").select("*").order("id", { ascending: false }).limit(60),
    sb.from("controls").select("*").eq("id", 1).maybeSingle(),
  ]);
  return { snap, pos, trades, logs, ctl };
}
async function fetchCandles(sym, limit) {      // últimas `limit` velas cerradas, en orden ascendente
  if (MOCK) return window.__MOCK__.candles(sym, limit);
  const r = await sb.from("candles").select("open_time,open,high,low,close,ema20,ema50")
    .eq("symbol", sym).order("open_time", { ascending: false }).limit(limit);
  return { data: r.data ? r.data.reverse() : r.data, error: r.error };
}
async function refresh() {
  try {
    const { snap, pos, trades, logs, ctl } = await fetchAll();
    const err = [snap, pos, trades, logs, ctl].find((r) => r.error);
    if (err) { console.error(err.error); if (err.error.code === "PGRST301" || /JWT/.test(err.error.message)) sb.auth.signOut(); return; }
    controls = ctl.data;
    $("noOwner").classList.toggle("hidden", !!ctl.data);
    S.snap = snap.data; S.pos = pos.data || [];
    const pairs = pairTrades(trades.data || []);
    S.pairs = pairs;
    renderSnapshot(snap.data);
    renderAgents(snap.data);
    renderLogs(logs.data || []);
    renderTrades(pairs);
    renderHero();
    renderCloses(pairs);
    renderBig(pairs);
    renderControls();
    renderPosCards();                                  // ya con lo que haya en caché; las velas se refrescan abajo
    await loadPosCandles(S.pos);
    renderPosCards();
    await renderChart(pairs, S.pos);
  } catch (e) { console.error(e); }
}
async function loadPosCandles(positions) {
  const syms = [...new Set(positions.map((p) => p.symbol))];
  await Promise.all(syms.map(async (sym) => {
    try { const r = await fetchCandles(sym, 60); if (!r.error && r.data) S.posCandles[sym] = r.data.map((c) => ({ o: +c.open, h: +c.high, l: +c.low, c: +c.close })); }
    catch (e) { console.error(e); }
  }));
}

function renderSnapshot(s) {
  if (!s) { $("pill").textContent = "SIN DATOS"; $("pill").className = "pill"; snapshotTs = null; tickFresh(); return; }
  snapshotTs = new Date(s.updated_at).getTime();
  const pill = $("pill");
  const map = { running: ["EN MARCHA", "run"], stopped: ["DETENIDO", "stop"], paused_daily_limit: ["PAUSA: LÍMITE DIARIO", "pause"] };
  const [txt, c] = map[s.status] || [String(s.status).toUpperCase(), ""];
  pill.textContent = txt; pill.className = "pill " + c;
  $("riskUsed").textContent = s.risk_level_in_use ?? "–";
  tickFresh();
}
function tickFresh() {
  if (snapshotTs == null) { $("fresh").textContent = "sin datos del bot"; $("clockDot").classList.remove("ok"); return; }
  const s = (Date.now() - snapshotTs) / 1000;
  $("fresh").textContent = "actualizado hace " + ago(s);
  $("staleWarn").classList.toggle("hidden", s <= STALE_SECONDS);
  $("clockDot").classList.toggle("ok", s <= STALE_SECONDS);
}
setInterval(tickFresh, 1000);

/* ---------- HERO: equity, cambios, sparkline, metas ---------- */
const MILESTONES = [1, 2, 3, 5, 10, 15, 20, 25, 50, 100, 200, 500];
function startBalance(s) { return s && s.total_pnl != null && s.equity != null ? Number(s.equity) - Number(s.total_pnl) : null; }
function equityCurve(pairs, s) {                         // curva real: saldo inicial + P/L acumulado de cada cierre, y el equity actual
  const start = startBalance(s);
  if (start == null) return null;
  const sells = pairs.filter((t) => t.side === "SELL" && t.pnl != null).reverse();
  const pts = [start]; let c = start;
  for (const t of sells) { c += Number(t.pnl); pts.push(c); }
  pts.push(Number(s.equity));
  return pts;
}
let sparkSeq = 0;
function drawSpark(pts) {
  const svg = $("spark"); const W = 150, H = 56, pad = 5;
  const id = "sg" + (++sparkSeq);
  if (!pts) { svg.innerHTML = ""; return; }
  const lo = Math.min(...pts), hi = Math.max(...pts), rng = hi - lo || 1;
  const x = (i) => pad + (W - 2 * pad) * (pts.length === 1 ? 1 : i / (pts.length - 1));
  const y = (v) => hi === lo ? H / 2 : H - pad - (H - 2 * pad) * (v - lo) / rng;
  const d = pts.map((v, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1)).join(" ");
  const ex = x(pts.length - 1), ey = y(pts[pts.length - 1]);
  const flat = pts.length <= 2 && hi - lo < 0.005;
  svg.innerHTML = `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4793b" stop-opacity=".28"/><stop offset="1" stop-color="#f4793b" stop-opacity="0"/></linearGradient></defs>`
    + (flat ? "" : `<path d="${d} L${ex.toFixed(1)} ${H} L${x(0).toFixed(1)} ${H} Z" fill="url(#${id})"/>`)
    + `<path d="${d}" fill="none" stroke="#f4793b" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"${flat ? ' stroke-dasharray="3 4" opacity=".7"' : ""}/>`
    + `<circle cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="7" fill="#f4793b" fill-opacity=".18"/><circle cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="3.4" fill="#fff" stroke="#f4793b" stroke-width="2"/>`;
}
function renderHero() {
  const s = S.snap;
  if (!s) {
    $("eqInt").textContent = "–"; $("eqDec").textContent = "";
    for (const id of ["dayChg", "totChg"]) { $(id).textContent = "–"; $(id).className = "zero"; }
    $("mult").textContent = "–"; $("startBal").textContent = "–"; drawSpark(null);
    $("mileFill").style.width = "0%"; $("limFill").style.width = "0%";
    return;
  }
  const [ip, dp] = fmtUsd(s.equity).split(",");
  $("eqInt").textContent = ip; $("eqDec").textContent = "," + dp;
  const day = Number(s.daily_pnl), dayPct = s.daily_pnl_pct != null ? Number(s.daily_pnl_pct) : (s.day_start_equity ? day / s.day_start_equity * 100 : null);
  const arrow = (v) => v > 0.005 ? "▲ " : v < -0.005 ? "▼ " : "● ";
  const dEl = $("dayChg"); dEl.textContent = arrow(day) + fmtSignedD(day) + (dayPct != null ? " (" + fmtPct(dayPct) + ")" : ""); dEl.className = "chgmain " + cls(day);
  const start = startBalance(s), tot = s.total_pnl != null ? Number(s.total_pnl) : null;
  const totPct = start ? tot / start * 100 : null;
  const tEl = $("totChg"); tEl.textContent = tot == null ? "–" : fmtSignedD(tot) + (totPct != null ? " (" + fmtPct(totPct) + ")" : ""); tEl.className = cls(tot);
  $("mult").textContent = start ? (Number(s.equity) / start).toLocaleString(NUM, { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + "x" : "–";
  $("startBal").textContent = start ? "$" + fmtUsd(start, 0) : "–";
  drawSpark(equityCurve(S.pairs, s));
  // meta: siguiente hito de % sobre el saldo inicial
  const pct = totPct == null ? 0 : totPct;
  const next = MILESTONES.find((m) => m > pct) ?? Math.ceil(pct / 100) * 100 + 100;
  const prev = pct < 0 ? 0 : ([...MILESTONES].reverse().find((m) => m <= pct) ?? 0);
  const prog = pct <= prev ? 0 : Math.min(1, (pct - prev) / (next - prev));
  $("mileL").textContent = (prev > 0 ? "+" : "") + prev + "%"; $("mileR").textContent = "+" + next + "%";
  $("mileFill").style.width = Math.max(prog * 100, prog > 0 ? 3 : 0).toFixed(1) + "%";
  $("mileLbl").textContent = `SIGUIENTE META +${next}% · ${Math.round(prog * 100)}%`;
  // límite de pérdida diaria
  const lim = (s.settings && s.settings.max_daily_loss_pct) ?? tierFor(Number(s.risk_level_in_use || 5)).loss;
  const base = Number(s.day_start_equity) || Number(s.equity);
  const used = day < 0 && base ? Math.min(1, -day / (base * lim / 100)) : 0;
  $("limFill").style.width = Math.max(used * 100, used > 0 ? 3 : 0).toFixed(1) + "%";
  $("limLbl").textContent = `LÍMITE DE PÉRDIDA DIARIA −${lim}% · USADO ${Math.round(used * 100)}%`;
}

/* ---------- tarjetas de posición ---------- */
let posRenderTimer = null;
function schedulePosRender() {                           // los ticks del WebSocket repintan como mucho 1 vez/s
  if (posRenderTimer) return;
  posRenderTimer = setTimeout(() => { posRenderTimer = null; renderPosCards(); }, 1000);
}
const px2 = (x) => fmtUsd(x, 2);
function miniChart(p, cs, px) {
  const W = 300, H = 132, X1 = 214, entry = +p.entry_price, tp = p.tp_price != null ? +p.tp_price : null;
  const bars = (cs || []).slice(-36);
  let lo = Math.min(entry, px, ...bars.map((b) => b.l)), hi = Math.max(entry, px, tp ?? entry, ...bars.map((b) => b.h));
  if (hi === lo) { hi += 1; lo -= 1; }
  const padT = 0.16, padB = 0.16;
  const yPct = (v) => (padT + (1 - padT - padB) * (hi - v) / (hi - lo));       // 0..1 desde arriba
  const y = (v) => yPct(v) * H;
  let g = "";
  const yE = y(entry), yT = tp != null ? y(tp) : null;
  if (yT != null) g += `<rect x="0" y="${Math.min(yE, yT).toFixed(1)}" width="${W}" height="${Math.abs(yE - yT).toFixed(1)}" fill="#1fa85a" fill-opacity=".07"/>`
    + `<line x1="0" x2="${W}" y1="${yT.toFixed(1)}" y2="${yT.toFixed(1)}" stroke="#1fa85a" stroke-opacity=".7" stroke-dasharray="4 3" stroke-width="1"/>`;
  g += `<line x1="0" x2="${W}" y1="${yE.toFixed(1)}" y2="${yE.toFixed(1)}" stroke="#7d8b84" stroke-opacity=".6" stroke-dasharray="4 3" stroke-width="1"/>`;
  const n = Math.max(bars.length, 1), step = Math.min(10, (X1 - 6) / n), bw = Math.max(2, step * 0.6);
  let lastX = 6;
  bars.forEach((b, i) => {
    const cx = 6 + step * i + step / 2, up = b.c >= b.o, col = up ? "#1fa85a" : "#e5455e";
    const yo = y(b.o), yc = y(b.c);
    g += `<line x1="${cx.toFixed(1)}" x2="${cx.toFixed(1)}" y1="${y(b.h).toFixed(1)}" y2="${y(b.l).toFixed(1)}" stroke="${col}" stroke-width="1"/>`
      + `<rect x="${(cx - bw / 2).toFixed(1)}" y="${Math.min(yo, yc).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1.4, Math.abs(yo - yc)).toFixed(1)}" fill="${col}"/>`;
    lastX = cx;
  });
  const yP = y(px), up = px >= entry, pc = up ? "#1fa85a" : "#e5455e";
  g += `<line x1="${lastX.toFixed(1)}" x2="${W}" y1="${yP.toFixed(1)}" y2="${yP.toFixed(1)}" stroke="${pc}" stroke-width="1.2"/><circle cx="${lastX.toFixed(1)}" cy="${yP.toFixed(1)}" r="2.6" fill="${pc}"/>`;
  const box = el("div", "mchart");
  box.append(html("div", "mcsvg", `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${g}</svg>`));
  const tag = (txt, top, cl) => { const t = el("span", "mtag " + cl, txt); t.style.top = (top * 100).toFixed(1) + "%"; box.append(t); };
  if (tp != null) tag("TP " + px2(tp), yPct(tp), "tp up");
  tag("ENTRADA " + px2(entry), yPct(entry), "en dn");
  const pill = el("span", "mpill2 " + (up ? "g" : "r"), px2(px)); pill.style.top = (yPct(px) * 100).toFixed(1) + "%"; box.append(pill);
  return box;
}
function renderPosCards() {
  const box = $("positions"); box.replaceChildren();
  if (!S.snap && !S.pos.length) { return; }
  if (!S.pos.length) { box.append(waitCard()); return; }
  for (const p of S.pos) {
    const px = livePx[p.symbol] ?? Number(p.current_price ?? p.entry_price);
    const entry = Number(p.entry_price), qty = Number(p.qty), cost = Number(p.cost);
    const unreal = qty * px - cost, pct = cost ? unreal / cost * 100 : 0;
    const tp = p.tp_price != null ? Number(p.tp_price) : null;
    const toTP = tp != null && tp !== entry ? Math.max(0, Math.min(1, (px - entry) / (tp - entry))) : 0;
    const card = el("section", "card poscard " + (unreal > 0.005 ? "win" : unreal < -0.005 ? "loss" : ""));
    const head = el("div", "phead");
    head.append(html("span", "pcoin", coinSvg(p.symbol)), el("span", "psym", coinOf(p.symbol)), el("span", "psub mono", "SPOT"));
    const rt = el("span", "pbadges");
    rt.append(el("span", "badge long", "LONG 1x"));
    head.append(rt);
    card.append(head, miniChart(p, S.posCandles[p.symbol], px));
    const prog = el("div", "toTP mono");
    const tr = el("div", "track"); const f = el("div", "fill grad"); f.style.width = (toTP * 100).toFixed(1) + "%"; tr.append(f);
    prog.append(el("span", null, "HACIA TP"), tr, el("b", null, Math.round(toTP * 100) + "%"));
    card.append(prog);
    const pr = el("div", "pnlrow");
    const l = el("div"); l.append(el("div", "mono lbl", "NO REALIZADO"), el("div", "pnlbig " + cls(unreal), fmtSignedD(unreal)));
    const r = el("div", "right"); r.append(el("div", "mono lbl", "TAMAÑO $" + fmtUsd(cost, 0)), el("div", "pnlbig dark", fmtPct(pct)));
    pr.append(l, r); card.append(pr);
    const sl = p.sl_price != null ? `SL ${px2(p.sl_price)} (−${p.sl_pct}%) · ` : "";
    card.append(el("div", "pinfo mono", `${fmtQty(qty)} ${coinOf(p.symbol)} · ${sl}TP ${px2(tp)} (+${p.tp_pct}%) · riesgo ${p.risk_level} · abierta ${p.opened_at ? dateFmt.format(new Date(p.opened_at)) : "–"}`));
    box.append(card);
  }
}
function waitCard() {
  const card = el("section", "card wait");
  card.append(html("div", "radar", '<i></i><i></i><svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="3.2" fill="#f4793b"/></svg>'));
  const t = el("div", "wtext");
  t.append(el("div", "wtitle", "Esperando señal"), el("div", "muted small0", "Sin operaciones abiertas. El bot vigila BTC y ETH y compra en el cruce alcista EMA20/EMA50 de 1m."));
  card.append(t);
  const chips = el("div", "chips");
  const prices = (S.snap && S.snap.prices) || {};
  for (const sym of SYMBOLS) {
    const v = livePx[sym] ?? prices[sym];
    const c = el("div", "chip"); c.append(html("span", "chipc", coinSvg(sym)), el("span", "mono", coinOf(sym)), el("b", "mono", v != null ? "$" + fmtUsd(v) : "–"));
    chips.append(c);
  }
  card.append(chips);
  return card;
}

/* ---------- CADA CIERRE: lollipop ---------- */
const sellsOf = (pairs) => pairs.filter((t) => t.side === "SELL" && t.pnl != null).slice().reverse();   // cronológico
const valOf = (t) => t.pct != null ? t.pct : null;
function renderCloses(pairs) {
  const sells = sellsOf(pairs), box = $("lolli");
  const wins = sells.filter((t) => Number(t.pnl) > 0), losses = sells.filter((t) => Number(t.pnl) <= 0);
  const wr = sells.length ? wins.length / sells.length * 100 : null;
  $("winRate").textContent = wr == null ? "–" : Math.round(wr) + "%";
  $("wrFill").style.width = (wr || 0) + "%";
  $("wlCount").textContent = sells.length ? `${wins.length}G · ${losses.length}P` : "0G · 0P";
  const avg = (a) => { const v = a.map(valOf).filter((x) => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
  $("avgWin").textContent = fmtPct(avg(wins), 1); $("avgLoss").textContent = fmtPct(avg(losses), 1);
  const W = 320, H = 150;
  if (!sells.length) {
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" stroke="#9fb0a8" stroke-opacity=".5" stroke-dasharray="4 4"/></svg><div class="emptyc">Aún no hay cierres<span>Cada venta del bot aparecerá aquí: verde arriba si gana, rojo abajo si pierde.</span></div>`;
    return;
  }
  const last = sells.slice(-40);
  const vals = last.map((t) => valOf(t) ?? 0);
  const up = Math.max(0.2, ...vals), dn = Math.max(0.2, -Math.min(0, ...vals), up * 0.2);
  const top = 26, bot = 12, sc = (H - top - bot) / (up + dn), base = top + up * sc;
  const step = Math.min(16, (W - 20) / last.length);
  const big = [...last].sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl)).slice(0, 2);
  let g = `<line x1="0" x2="${W}" y1="${base.toFixed(1)}" y2="${base.toFixed(1)}" stroke="#9fb0a8" stroke-opacity=".7"/>`, icons = "";
  last.forEach((t, i) => {
    const x = 12 + i * step, v = valOf(t) ?? 0, y = base - v * sc, isBig = big.includes(t), win = Number(t.pnl) > 0;
    const col = win ? "#1fa85a" : "#e5455e";
    g += `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${base.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${isBig ? "#f4793b" : col}" stroke-width="${isBig ? 1.6 : 1.3}"${win ? "" : ' stroke-opacity=".9"'}/>`
      + `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${isBig ? 3 : 3.3}" fill="${col}" fill-opacity="${win ? (isBig ? 1 : .8) : 1}"/>`;
    if (isBig) icons += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="13" fill="#f4793b" fill-opacity=".16"/><svg x="${(x - 9).toFixed(1)}" y="${(y - 9).toFixed(1)}" width="18" height="18" viewBox="0 0 32 32">${coinInner(t.symbol)}</svg>`;
  });
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMinYMid meet">${g}${icons}</svg>`;
}

/* ---------- GRANDES CIERRES: línea de 0–24 h de hoy ---------- */
const REASONS = { SIGNAL: "cruce EMA", SL: "stop-loss", TP: "take-profit", STOP_BUTTON: "botón PARAR", DAILY_LIMIT: "límite diario" };
function renderBig(pairs) {
  const box = $("bigline"); box.replaceChildren();
  const d0 = dayStartMs();
  const today = sellsOf(pairs).filter((t) => new Date(t.ts).getTime() >= d0);
  const tot = today.reduce((s, t) => s + Number(t.pnl), 0);
  const bt = $("bigTotal"); bt.textContent = today.length ? fmtSignedD(tot) : "$0,00"; bt.className = "bigtot mono " + (today.length && tot < -0.005 ? "neg" : "");
  const nowPct = madridSecOfDay() / 864;                           // % del día transcurrido
  const posOf = (t) => Math.max(0, Math.min(100, (new Date(t.ts).getTime() - d0) / 864000));
  const track = el("div", "tl"); const fill = el("div", "tlfill"); fill.style.width = nowPct.toFixed(2) + "%"; track.append(fill);
  box.append(track);
  for (const [h, lab] of [[0, "00h"], [6, "06h"], [12, "12h"], [18, "18h"], [24, "24h"]]) {
    const s = el("span", "tick mono", lab); s.style.left = (h / 24 * 100) + "%"; if (h === 0) s.classList.add("first"); if (h === 24) s.classList.add("lastt"); box.append(s);
    if (h > 0 && h < 24) { const m = el("i", "tk"); m.style.left = (h / 24 * 100) + "%"; box.append(m); }
  }
  const nd = el("i", "nowdot"); nd.style.left = nowPct.toFixed(2) + "%"; box.append(nd);
  if (!today.length) { box.append(el("div", "tlempty", "Aún no hay cierres hoy")); return; }
  const top = [...today].sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl)).slice(0, 4).sort((a, b) => new Date(a.ts) - new Date(b.ts));
  for (const t of today) {
    if (top.includes(t)) continue;
    const dot = el("i", "dot"); dot.style.left = posOf(t).toFixed(2) + "%"; box.append(dot);
  }
  // reparto alterno arriba/abajo; en cada fila separo las etiquetas para que no se pisen
  const items = top.map((t, i) => ({ t, x: posOf(t), above: i % 2 === 0 }));
  const GAP = 25, MIN = 13, MAX = 87;
  for (const above of [true, false]) {
    const row = items.filter((o) => o.above === above);
    row.forEach((o) => { o.cx = Math.max(MIN, Math.min(MAX, o.x)); });
    for (let k = 1; k < row.length; k++) row[k].cx = Math.max(row[k].cx, row[k - 1].cx + GAP);
    for (let k = row.length - 2; k >= 0; k--) row[k].cx = Math.min(row[k].cx, row[k + 1].cx - GAP);
    row.forEach((o) => { o.cx = Math.max(MIN, Math.min(MAX, o.cx)); });
  }
  const lines = items.map((o) => o.above ? `<line x1="${o.cx.toFixed(2)}" y1="50" x2="${o.x.toFixed(2)}" y2="82"/>` : `<line x1="${o.cx.toFixed(2)}" y1="132" x2="${o.x.toFixed(2)}" y2="103"/>`).join("");
  box.append(html("div", "stems", `<svg viewBox="0 0 100 178" preserveAspectRatio="none">${lines}</svg>`));
  for (const o of items) {
    const t = o.t, pnl = Number(t.pnl);
    const pin = html("span", "pin", coinSvg(t.symbol)); pin.style.left = o.x.toFixed(2) + "%"; box.append(pin);
    const co = el("div", "callout " + (o.above ? "a" : "b")); co.style.left = o.cx.toFixed(2) + "%";
    co.append(el("b", cls(pnl), fmtSignedD(pnl)), el("span", "mono", `${coinOf(t.symbol)} · ${hmFmt.format(new Date(t.ts))}`));
    box.append(co);
  }
}

function renderAgents(s) {
  const box = $("agents"); box.replaceChildren();
  const ag = (s && s.agents) || {};
  for (const [key, name, desc] of AGENTS) {
    const a = ag[key];
    const it = el("div", "item agent" + (a && a.level === "warn" ? " warnlvl" : a && a.level === "error" ? " error" : ""));
    const r = el("div", "irow");
    r.append(el("span", "nm", name), el("span", "ago", a ? "hace " + ago(Date.now() / 1000 - a.ts) : desc));
    it.append(r, el("div", "tx", a ? a.text : "Esperando datos del bot…"));
    box.append(it);
  }
}

function renderLogs(rows) {
  const box = $("logs"); box.replaceChildren();
  if (!rows.length) { box.append(el("div", "empty", "Sin registros todavía.")); return; }
  for (const l of rows) {
    const d = el("div");
    d.append(el("span", "t", timeFmt.format(new Date(l.ts)) + " "), el("span", "a", l.agent + ": "),
             el("span", l.level === "warn" ? "warn2" : l.level === "error" ? "error2" : "", l.message));
    box.append(d);
  }
}

/* Empareja COMPRA→VENTA por símbolo (solo long, una posición por símbolo): añade entrada, salida, P/L y % a cada venta. */
function pairTrades(rows) {
  const asc = [...rows].sort((x, y) => new Date(x.ts) - new Date(y.ts) || x.id - y.id);
  const open = {};
  for (const t of asc) {
    if (t.side === "BUY") open[t.symbol] = t;
    else if (t.side === "SELL") {
      const b = open[t.symbol];
      t.entry = b ? Number(b.price) : null;
      t.exitPrice = Number(t.price);
      const cost = b ? Number(b.price) * Number(t.qty) : null;
      t.pct = t.pnl != null && cost ? (Number(t.pnl) / cost) * 100 : null;
      delete open[t.symbol];
    }
  }
  return asc.reverse();            // más recientes primero
}
function renderTrades(rows) {
  const box = $("trades"); box.replaceChildren();
  const sells = rows.filter((t) => t.side === "SELL" && t.pnl != null);
  const tot = sells.reduce((s, t) => s + Number(t.pnl), 0), w = sells.filter((t) => t.pnl > 0).length;
  $("tradeSum").textContent = sells.length ? `· ${sells.length} cierres · ${w} ganadas / ${sells.length - w} perdidas · ${fmtSigned(tot)} $` : "";
  if (!rows.length) { box.append(el("div", "empty", "Aún no hay operaciones.")); return; }
  for (const t of rows.slice(0, 60)) {
    const it = el("div", "item trade"), r1 = el("div", "irow");
    const body = el("div", "tbody");
    r1.append(el("span", "sym", (t.side === "BUY" ? "COMPRA " : "VENTA ") + t.symbol),
              el("span", "sym " + (t.pnl == null ? "zero" : cls(t.pnl)),
                 t.pnl == null ? "–" : fmtSigned(t.pnl) + " $" + (t.pct != null ? " (" + fmtPct(t.pct) + ")" : "")));
    body.append(r1, el("div", "small2", `${dateFmt.format(new Date(t.ts))} · ${fmtQty(t.qty)} @ ${fmtUsd(t.price)}${t.reason ? " · " + (REASONS[t.reason] || t.reason) : ""}`));
    if (t.side === "SELL" && t.entry != null) body.append(el("div", "why", `entrada ${fmtUsd(t.entry)} → salida ${fmtUsd(t.exitPrice)}`));
    it.append(html("span", "tcoin", coinSvg(t.symbol)), body);
    box.append(it);
  }
}

/* ---------- gráfico de velas ---------- */
let chart = null, candleSeries = null, ema20Series = null, ema50Series = null, priceLines = [];
let chartSym = "BTCUSDT", fitNext = true, tradeAtTime = {}, candleAtTime = {}, hovering = false, renderSeq = 0;
const BAR = 60;                                    // 1 min en segundos
const madridTick = new Intl.DateTimeFormat("es-ES", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
const madridFull = new Intl.DateTimeFormat("es-ES", { timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });

function ensureChart() {
  if (chart) return true;
  if (typeof LightweightCharts === "undefined") { $("chartMsg").textContent = "No se pudo cargar la librería del gráfico (CDN)."; return false; }
  chart = LightweightCharts.createChart($("chart"), {
    autoSize: true,
    layout: { background: { color: "rgba(255,255,255,0)" }, textColor: "#5b6b64", fontSize: 11, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" },
    grid: { vertLines: { color: "rgba(60,90,75,0.08)" }, horzLines: { color: "rgba(60,90,75,0.08)" } },
    rightPriceScale: { borderColor: "rgba(60,90,75,0.18)" },
    timeScale: { borderColor: "rgba(60,90,75,0.18)", timeVisible: true, secondsVisible: false, rightOffset: 4,
                 tickMarkFormatter: (t) => madridTick.format(new Date(t * 1000)) },
    localization: { timeFormatter: (t) => madridFull.format(new Date(t * 1000)) },
    crosshair: { mode: 0 },
  });
  candleSeries = chart.addCandlestickSeries({ upColor: "#1fa85a", downColor: "#e5455e", borderUpColor: "#1fa85a", borderDownColor: "#e5455e", wickUpColor: "#1fa85a", wickDownColor: "#e5455e" });
  ema20Series = chart.addLineSeries({ color: "#2f80ed", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
  ema50Series = chart.addLineSeries({ color: "#f59e0b", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
  chart.subscribeCrosshairMove((p) => { hovering = !!p.time; showLegend(p.time); });
  return true;
}
function showLegend(t) {
  const lg = $("legend"); lg.replaceChildren();
  const c = candleAtTime[t] || candleAtTime.last;
  if (!c) { lg.textContent = "–"; return; }
  const d = new Date(c.time * 1000);
  lg.append(document.createTextNode(`${madridFull.format(d)} · A ${fmtUsd(c.open)} M ${fmtUsd(c.high)} m ${fmtUsd(c.low)} C ${fmtUsd(c.close)} · EMA20 ${fmtUsd(c.ema20)} EMA50 ${fmtUsd(c.ema50)}`));
  for (const x of tradeAtTime[c.time] || []) {
    const s = x.side === "BUY" ? `COMPRA @ ${fmtUsd(x.price)}` : `VENTA @ ${fmtUsd(x.price)}${x.entry != null ? " (entrada " + fmtUsd(x.entry) + ")" : ""} P/L ${x.pnl == null ? "–" : fmtSigned(x.pnl) + " $" + (x.pct != null ? " " + x.pct.toFixed(2) + "%" : "")}`;
    lg.append(el("div", "tr", s));
  }
}
async function renderChart(pairs, positions) {
  if (!ensureChart()) return;
  const sym = chartSym, seq = ++renderSeq;
  const { data, error } = await fetchCandles(sym, 400);
  if (seq !== renderSeq || sym !== chartSym) return;   // llegó tarde: el usuario cambió de pestaña o hay otra carga más nueva
  if (error) { $("chartMsg").textContent = "Error cargando velas: " + error.message; return; }
  if (!data.length) { $("chartMsg").textContent = "Aún no hay velas sincronizadas."; return; }
  $("chartMsg").textContent = "";
  const cs = data.map((r) => ({ time: Math.floor(new Date(r.open_time).getTime() / 1000), open: +r.open, high: +r.high, low: +r.low, close: +r.close,
                                ema20: r.ema20 == null ? null : +r.ema20, ema50: r.ema50 == null ? null : +r.ema50 }));
  candleSeries.setData(cs.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
  ema20Series.setData(cs.filter((c) => c.ema20 != null).map((c) => ({ time: c.time, value: c.ema20 })));
  ema50Series.setData(cs.filter((c) => c.ema50 != null).map((c) => ({ time: c.time, value: c.ema50 })));
  candleAtTime = {}; for (const c of cs) candleAtTime[c.time] = c;
  candleAtTime.last = cs[cs.length - 1];
  // marcadores de operaciones (al inicio de la vela de 1m en que ocurrieron)
  const first = cs[0].time, last = cs[cs.length - 1].time;
  tradeAtTime = {}; const marks = [];
  for (const t of [...pairs].reverse()) {
    if (t.symbol !== chartSym) continue;
    let bt = Math.floor(new Date(t.ts).getTime() / 1000 / BAR) * BAR;
    if (bt < first) continue;
    if (bt > last) bt = last;                      // operación en la vela en formación: la pinto en la última cerrada
    (tradeAtTime[bt] = tradeAtTime[bt] || []).push(t);
    if (t.side === "BUY") marks.push({ time: bt, position: "belowBar", shape: "arrowUp", color: "#1fa85a", text: "COMPRA" });
    else {
      const pnl = t.pnl == null ? "" : (t.pnl >= 0 ? "+" : "−") + Math.abs(t.pnl).toFixed(2) + "$";
      const pct = t.pct == null ? "" : " " + (t.pct >= 0 ? "+" : "−") + Math.abs(t.pct).toFixed(2) + "%";
      const why = t.reason ? " " + ({ SIGNAL: "cruce", SL: "SL", TP: "TP", STOP_BUTTON: "parada", DAILY_LIMIT: "límite" }[t.reason] || t.reason) : "";
      marks.push({ time: bt, position: "aboveBar", shape: "arrowDown", color: "#e5455e", text: (pnl + pct + why).trim() || "VENTA" });
    }
  }
  marks.sort((a, b) => a.time - b.time);
  candleSeries.setMarkers(marks);
  // líneas de la posición abierta: entrada, SL, TP
  for (const l of priceLines) candleSeries.removePriceLine(l);
  priceLines = [];
  for (const p of positions.filter((x) => x.symbol === chartSym)) {
    const add = (price, color, title) => priceLines.push(candleSeries.createPriceLine({ price: +price, color, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title }));
    add(p.entry_price, "#5b6b64", "ENTRADA");
    if (p.sl_price != null) add(p.sl_price, "#e5455e", "SL");
    if (p.tp_price != null) add(p.tp_price, "#1fa85a", "TP");
  }
  if (fitNext) { chart.timeScale().fitContent(); fitNext = false; }
  liveAfterRender(cs);
  if (!hovering) showLegend(undefined);
}
document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => {
  chartSym = b.dataset.sym; fitNext = true;
  liveStop(); $("livePrice").textContent = "–"; $("legend").textContent = "–";       // el WebSocket se reabre para el nuevo símbolo tras cargar sus velas
  document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("on", x === b));
  refresh();
}));

/* ---------- tiempo real: WebSocket de Binance Spot TESTNET (kline_1m + trade) ----------
   Si el WS no conecta, no pasa nada: el gráfico sigue con el sondeo a Supabase cada POLL_MS. */
const WS_HOST = "wss://stream.testnet.binance.vision";
const K20 = 2 / 21, K50 = 2 / 51;
let ws = null, wsSym = null, wsTry = 0, wsTimer = null, wsWatch = null, wsLastMsg = 0, liveOn = false;
let live = null;               // { t, open, high, low, close, e20, e50 } vela en formación
let emaBase = null;            // { t, e20, e50 } EMA de la última vela CERRADA anterior a la que se forma
let lastTrade = { T: 0, p: 0 };
let lastPx = null;

function setLiveUI(on) {
  liveOn = on;
  const t = $("liveTag"); t.classList.toggle("on", on);
  t.querySelector("b").textContent = on ? "EN VIVO" : "CADA " + (POLL_MS / 1000) + " s";
}
function liveStop() {
  wsSym = null; live = null; emaBase = null; lastTrade = { T: 0, p: 0 }; lastPx = null;
  clearTimeout(wsTimer); clearInterval(wsWatch); wsTimer = wsWatch = null;
  if (ws) { const w = ws; ws = null; w.onopen = w.onmessage = w.onerror = w.onclose = null; try { w.close(); } catch (e) {} }
  setLiveUI(false);
}
function liveConnect(sym) {
  if (MOCK || document.hidden) return;                     // pestaña oculta: no gasto batería ni datos
  wsSym = sym;
  const s = sym.toLowerCase();
  let w;
  try { w = new WebSocket(`${WS_HOST}/stream?streams=${s}@kline_1m/` + SYMBOLS.map((x) => x.toLowerCase() + "@trade").join("/")); } catch (e) { return liveRetry(sym); }
  ws = w;
  w.onopen = () => { wsTry = 0; wsLastMsg = Date.now(); };
  w.onmessage = (ev) => {
    wsLastMsg = Date.now();
    if (ws !== w || sym !== chartSym) return;
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (!liveOn) setLiveUI(true);
    const d = m.data; if (!d) return;
    if (d.e === "kline") onKline(d);
    else if (d.e === "trade") { livePx[d.s] = +d.p; schedulePosRender(); if (d.s === chartSym) onTrade(d); }
  };
  w.onerror = () => {};
  w.onclose = () => { if (ws === w) { ws = null; setLiveUI(false); liveRetry(sym); } };
  clearInterval(wsWatch);
  wsWatch = setInterval(() => {                    // sin mensajes en 15 s => conexión muerta, reintento
    if (ws === w && Date.now() - wsLastMsg > 15000) { ws = null; w.onclose = null; try { w.close(); } catch (e) {} setLiveUI(false); liveRetry(sym); }
  }, 5000);
}
function liveRetry(sym) {
  clearTimeout(wsTimer);
  const wait = Math.min(30000, 1000 * 2 ** Math.min(wsTry++, 5));     // 1,2,4,8,16,30 s
  wsTimer = setTimeout(() => { wsTimer = null; if (sym === chartSym && !ws) liveConnect(sym); }, wait);
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) liveStop();                 // pestaña oculta: cierro el WS
  else { wsTry = 0; refresh(); }                   // al volver, recargo velas y renderChart reabre el WS
});

// llamado tras cada carga de velas desde Supabase (solo velas cerradas)
function liveAfterRender(cs) {
  const lastCs = cs[cs.length - 1];
  if (!live || lastCs.time < live.t) {             // semilla de EMA: última vela cerrada de Supabase
    if (lastCs.ema20 != null && (!live || !emaBase || lastCs.time >= emaBase.t)) emaBase = { t: lastCs.time, e20: lastCs.ema20, e50: lastCs.ema50 };
  }
  if (live && live.t >= lastCs.time) paintLive();  // la carga borra la vela en formación: la vuelvo a pintar
  if (!ws && !wsTimer && !document.hidden) liveConnect(chartSym);
}
function onTrade(d) {
  if (!live) return;
  const p = +d.p, T = d.T;
  lastTrade = { T, p };
  if (T < live.t * 1000 || T >= (live.t + BAR) * 1000) return;   // trade de otra vela: espero al mensaje kline
  live.close = p; live.high = Math.max(live.high, p); live.low = Math.min(live.low, p);
  computeLiveEma(); paintLive();
}
function onKline(d) {
  const k = d.k, t = Math.floor(k.t / 1000);
  if (live && t < live.t) return;
  if (!live || t > live.t) {                       // nueva vela: la anterior queda cerrada y su EMA pasa a ser la base
    if (live && t - live.t === BAR) emaBase = { t: live.t, e20: live.e20, e50: live.e50 };
    live = { t, open: +k.o, high: +k.h, low: +k.l, close: +k.c, e20: null, e50: null };
  } else { live.open = +k.o; live.high = +k.h; live.low = +k.l; live.close = +k.c; }
  if (lastTrade.T > d.E && lastTrade.T >= t * 1000 && lastTrade.T < (t + BAR) * 1000) {   // un trade más reciente que este kline manda
    live.close = lastTrade.p; live.high = Math.max(live.high, lastTrade.p); live.low = Math.min(live.low, lastTrade.p);
  }
  computeLiveEma(); paintLive();
}
function computeLiveEma() {
  if (!live || !emaBase) return;
  live.e20 = live.close * K20 + emaBase.e20 * (1 - K20);
  live.e50 = live.close * K50 + emaBase.e50 * (1 - K50);
}
function paintLive() {
  if (!live || !candleSeries) return;
  try {
    candleSeries.update({ time: live.t, open: live.open, high: live.high, low: live.low, close: live.close });
    if (live.e20 != null) { ema20Series.update({ time: live.t, value: live.e20 }); ema50Series.update({ time: live.t, value: live.e50 }); }
  } catch (e) { return; }                          // vela más antigua que la última del gráfico: lo corrige la próxima carga
  candleAtTime[live.t] = candleAtTime.last = { time: live.t, open: live.open, high: live.high, low: live.low, close: live.close, ema20: live.e20, ema50: live.e50 };
  const pe = $("livePrice");
  pe.textContent = fmtUsd(live.close) + " $";
  if (lastPx != null && live.close !== lastPx) { pe.classList.remove("up", "dn"); pe.classList.add(live.close > lastPx ? "up" : "dn"); }
  lastPx = live.close; livePx[chartSym] = live.close; schedulePosRender();
  if (!hovering) showLegend(undefined);
}

/* ---------- controls ---------- */
let sliderTouched = false;
function renderTier() {
  const l = Number($("risk").value), t = tierFor(l);
  $("riskVal").textContent = l;
  const tier = $("tier"); tier.replaceChildren();
  for (const [v, k] of [[t.pos + "%", "POR OP."], ["−" + t.sl + "%", "STOP-LOSS"], ["+" + t.tp + "%", "TAKE-PROFIT"], [t.loss + "%", "PÉRD. MÁX/DÍA"]]) {
    const d = el("div"); d.append(el("b", null, v), el("span", null, k)); tier.append(d);
  }
}
$("risk").addEventListener("input", () => { sliderTouched = true; renderTier(); });
function renderControls() {
  if (controls && !sliderTouched) $("risk").value = controls.risk_level;
  renderTier();
  const c = controls;
  $("stopBtn").disabled = !c; $("resumeBtn").disabled = !c; $("saveRisk").disabled = !c;
  $("ctlState").textContent = !c ? "" : c.stop_requested ? "Parada solicitada: esperando al bot (hasta 15 s)…"
    : c.resume_requested ? "Reanudación solicitada: esperando al bot (hasta 15 s)…" : "";
}
async function update(patch, msgEl, okText) {
  msgEl.textContent = "Enviando…";
  const { error } = MOCK ? { error: null } : await sb.from("controls").update(patch).eq("id", 1);
  msgEl.textContent = error ? "Error: " + error.message : okText;
  if (!error) refresh();
  return !error;
}
$("saveRisk").addEventListener("click", async () => {
  const l = Number($("risk").value);
  if (await update({ risk_level: l }, $("riskMsg"), "Guardado: nivel " + l + ". El bot lo aplica en ≤15 s a operaciones nuevas.")) sliderTouched = false;
});
$("stopBtn").addEventListener("click", async () => {
  if (!confirm("¿PARAR BOT?\n\nSe cerrarán todas las posiciones abiertas a mercado y el bot dejará de operar hasta que pulses REANUDAR.")) return;
  await update({ stop_requested: true, resume_requested: false }, $("ctlState"), "Parada solicitada: esperando al bot (hasta 15 s)…");
});
$("resumeBtn").addEventListener("click", async () => {
  if (!confirm("¿Reanudar el bot?")) return;
  await update({ resume_requested: true, stop_requested: false }, $("ctlState"), "Reanudación solicitada: esperando al bot (hasta 15 s)…");
});
renderTier();
