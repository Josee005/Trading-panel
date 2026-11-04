/* Panel estático: Supabase Auth (email+contraseña) + lectura con RLS. Solo clave publicable. */
const SUPABASE_URL = "https://mhqjnkdvokzrygixkfjb.supabase.co";
const SUPABASE_KEY = "sb_publishable_1i0XytrkfPxzhPZMTp6zZA_x7bu9sNn";
const TZ = "Europe/Madrid";
const STALE_SECONDS = 180;
const POLL_MS = 10000;
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

const fmtUsd = (x, d = 2) => x == null ? "–" : Number(x).toLocaleString("es-ES", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtSigned = (x) => x == null ? "–" : (x > 0 ? "+" : x < 0 ? "−" : "") + fmtUsd(Math.abs(x));
const cls = (x) => x > 0.005 ? "pos" : x < -0.005 ? "neg" : "zero";
const timeFmt = new Intl.DateTimeFormat("es-ES", { timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const dateFmt = new Intl.DateTimeFormat("es-ES", { timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
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
$("logout").addEventListener("click", () => sb.auth.signOut());
sb.auth.onAuthStateChange((_ev, session) => {
  clearInterval(pollTimer);
  if (session) { show("app"); refresh(); pollTimer = setInterval(refresh, POLL_MS); }
  else show("login");
});
sb.auth.getSession().then(({ data }) => { if (!data.session) show("login"); });

/* ---------- data ---------- */
async function refresh() {
  try {
    const [snap, pos, trades, logs, ctl] = await Promise.all([
      sb.from("bot_snapshot").select("*").eq("id", 1).maybeSingle(),
      sb.from("positions").select("*").order("opened_at", { ascending: false }),
      sb.from("trades").select("*").order("ts", { ascending: false }).limit(200),
      sb.from("bot_log").select("*").order("id", { ascending: false }).limit(60),
      sb.from("controls").select("*").eq("id", 1).maybeSingle(),
    ]);
    const err = [snap, pos, trades, logs, ctl].find((r) => r.error);
    if (err) { console.error(err.error); if (err.error.code === "PGRST301" || /JWT/.test(err.error.message)) sb.auth.signOut(); return; }
    controls = ctl.data;
    $("noOwner").classList.toggle("hidden", !!ctl.data);
    renderSnapshot(snap.data);
    renderPositions(pos.data || []);
    renderAgents(snap.data);
    renderLogs(logs.data || []);
    const pairs = pairTrades(trades.data || []);
    renderTrades(pairs);
    renderControls();
    await renderChart(pairs, pos.data || []);
  } catch (e) { console.error(e); }
}

function renderSnapshot(s) {
  if (!s) { $("equity").textContent = "–"; $("pill").textContent = "SIN DATOS"; $("pill").className = "pill"; snapshotTs = null; return; }
  snapshotTs = new Date(s.updated_at).getTime();
  $("equity").textContent = fmtUsd(s.equity) + " $";
  for (const [id, v] of [["totalPnl", s.total_pnl], ["dailyPnl", s.daily_pnl]]) {
    const n = $(id); n.textContent = fmtSigned(v) + " $"; n.className = "num " + cls(v);
  }
  if (s.daily_pnl_pct != null) $("dailyPnl").textContent += " (" + (s.daily_pnl_pct >= 0 ? "+" : "−") + Math.abs(s.daily_pnl_pct).toFixed(2) + "%)";
  const pill = $("pill");
  const map = { running: ["EN MARCHA", "run"], stopped: ["DETENIDO", "stop"], paused_daily_limit: ["PAUSA: LÍMITE DIARIO", "pause"] };
  const [txt, c] = map[s.status] || [String(s.status).toUpperCase(), ""];
  pill.textContent = txt; pill.className = "pill " + c;
  $("riskUsed").textContent = s.risk_level_in_use ?? "–";
  tickFresh();
}
function tickFresh() {
  if (snapshotTs == null) { $("fresh").textContent = "sin datos del bot"; return; }
  const s = (Date.now() - snapshotTs) / 1000;
  $("fresh").textContent = "última actualización hace " + ago(s);
  $("staleWarn").classList.toggle("hidden", s <= STALE_SECONDS);
}
setInterval(tickFresh, 1000);

function renderPositions(rows) {
  const box = $("positions"); box.replaceChildren();
  if (!rows.length) { box.append(el("div", "empty", "Sin operaciones abiertas.")); return; }
  for (const p of rows) {
    const it = el("div", "item");
    const r1 = el("div", "irow");
    r1.append(el("span", "sym", p.symbol + " · LONG"), el("span", "sym " + cls(p.unrealized_pnl), fmtSigned(p.unrealized_pnl) + " $"));
    const r2 = el("div", "small2", `${Number(p.qty)} @ ${fmtUsd(p.entry_price)} · ahora ${fmtUsd(p.current_price)} · coste ${fmtUsd(p.cost)} $`);
    const r3 = el("div", "small2", `SL ${fmtUsd(p.sl_price)} (−${p.sl_pct}%) · TP ${fmtUsd(p.tp_price)} (+${p.tp_pct}%) · riesgo ${p.risk_level} · abierta ${p.opened_at ? dateFmt.format(new Date(p.opened_at)) : "–"}`);
    it.append(r1, r2, r3); box.append(it);
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

const REASONS = { SIGNAL: "cruce EMA", SL: "stop-loss", TP: "take-profit", STOP_BUTTON: "botón PARAR", DAILY_LIMIT: "límite diario" };
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
    const it = el("div", "item"), r1 = el("div", "irow");
    r1.append(el("span", "sym", (t.side === "BUY" ? "COMPRA " : "VENTA ") + t.symbol),
              el("span", "sym " + (t.pnl == null ? "zero" : cls(t.pnl)),
                 t.pnl == null ? "–" : fmtSigned(t.pnl) + " $" + (t.pct != null ? " (" + (t.pct >= 0 ? "+" : "−") + Math.abs(t.pct).toFixed(2) + "%)" : "")));
    it.append(r1, el("div", "small2", `${dateFmt.format(new Date(t.ts))} · ${Number(t.qty)} @ ${fmtUsd(t.price)}${t.reason ? " · " + (REASONS[t.reason] || t.reason) : ""}`));
    if (t.side === "SELL" && t.entry != null) it.append(el("div", "why", `entrada ${fmtUsd(t.entry)} → salida ${fmtUsd(t.exitPrice)}`));
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
    layout: { background: { color: "#000000" }, textColor: "#9fb09f", fontSize: 11 },
    grid: { vertLines: { color: "#101810" }, horzLines: { color: "#101810" } },
    rightPriceScale: { borderColor: "#1b261b" },
    timeScale: { borderColor: "#1b261b", timeVisible: true, secondsVisible: false, rightOffset: 4,
                 tickMarkFormatter: (t) => madridTick.format(new Date(t * 1000)) },
    localization: { timeFormatter: (t) => madridFull.format(new Date(t * 1000)) },
    crosshair: { mode: 0 },
  });
  candleSeries = chart.addCandlestickSeries({ upColor: "#2bff7a", downColor: "#ff3b57", borderUpColor: "#2bff7a", borderDownColor: "#ff3b57", wickUpColor: "#2bff7a", wickDownColor: "#ff3b57" });
  ema20Series = chart.addLineSeries({ color: "#00e5ff", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
  ema50Series = chart.addLineSeries({ color: "#ff9f1c", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
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
  const { data, error } = await sb.from("candles").select("open_time,open,high,low,close,ema20,ema50")
    .eq("symbol", sym).order("open_time", { ascending: true }).limit(400);
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
    if (t.side === "BUY") marks.push({ time: bt, position: "belowBar", shape: "arrowUp", color: "#2bff7a", text: "COMPRA" });
    else {
      const pnl = t.pnl == null ? "" : (t.pnl >= 0 ? "+" : "−") + Math.abs(t.pnl).toFixed(2) + "$";
      const pct = t.pct == null ? "" : " " + (t.pct >= 0 ? "+" : "−") + Math.abs(t.pct).toFixed(2) + "%";
      const why = t.reason ? " " + ({ SIGNAL: "cruce", SL: "SL", TP: "TP", STOP_BUTTON: "parada", DAILY_LIMIT: "límite" }[t.reason] || t.reason) : "";
      marks.push({ time: bt, position: "aboveBar", shape: "arrowDown", color: "#ff3b57", text: (pnl + pct + why).trim() || "VENTA" });
    }
  }
  marks.sort((a, b) => a.time - b.time);
  candleSeries.setMarkers(marks);
  // líneas de la posición abierta: entrada, SL, TP
  for (const l of priceLines) candleSeries.removePriceLine(l);
  priceLines = [];
  for (const p of positions.filter((x) => x.symbol === chartSym)) {
    const add = (price, color, title) => priceLines.push(candleSeries.createPriceLine({ price: +price, color, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title }));
    add(p.entry_price, "#e8f5e8", "ENTRADA");
    if (p.sl_price != null) add(p.sl_price, "#ff3b57", "SL");
    if (p.tp_price != null) add(p.tp_price, "#2bff7a", "TP");
  }
  if (fitNext) { chart.timeScale().fitContent(); fitNext = false; }
  liveAfterRender(cs);
  if (!hovering) showLegend(undefined);
}
document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => {
  chartSym = b.dataset.sym; fitNext = true;
  liveStop(); $("livePrice").textContent = "–";       // el WebSocket se reabre para el nuevo símbolo tras cargar sus velas
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
  if (document.hidden) return;                     // pestaña oculta: no gasto batería ni datos
  wsSym = sym;
  const s = sym.toLowerCase();
  let w;
  try { w = new WebSocket(`${WS_HOST}/stream?streams=${s}@kline_1m/${s}@trade`); } catch (e) { return liveRetry(sym); }
  ws = w;
  w.onopen = () => { wsTry = 0; wsLastMsg = Date.now(); };
  w.onmessage = (ev) => {
    wsLastMsg = Date.now();
    if (ws !== w || sym !== chartSym) return;
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (!liveOn) setLiveUI(true);
    const d = m.data; if (!d) return;
    if (d.e === "kline") onKline(d); else if (d.e === "trade") onTrade(d);
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
  lastPx = live.close;
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
  const { error } = await sb.from("controls").update(patch).eq("id", 1);
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
