/* Panel estático: Supabase Auth (email+contraseña) + lectura con RLS. Solo clave publicable. */
const SUPABASE_URL = "https://mhqjnkdvokzrygixkfjb.supabase.co";
const SUPABASE_KEY = "sb_publishable_1i0XytrkfPxzhPZMTp6zZA_x7bu9sNn";
const TZ = "Europe/Madrid";
const STALE_SECONDS = 180;
const POLL_MS = 10000;
const AGENTS = [
  ["scout", "SCOUT", "Precios y velas 4h"],
  ["filtro", "FILTRO", "Límite diario / parado / posición"],
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
      sb.from("trades").select("*").order("ts", { ascending: false }).limit(50),
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
    renderTrades(trades.data || []);
    renderControls();
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

function renderTrades(rows) {
  const box = $("trades"); box.replaceChildren();
  if (!rows.length) { box.append(el("div", "empty", "Aún no hay operaciones.")); return; }
  for (const t of rows) {
    const it = el("div", "item"), r1 = el("div", "irow");
    r1.append(el("span", "sym", (t.side === "BUY" ? "COMPRA " : "VENTA ") + t.symbol),
              el("span", "sym " + (t.pnl == null ? "zero" : cls(t.pnl)), t.pnl == null ? "–" : fmtSigned(t.pnl) + " $"));
    it.append(r1, el("div", "small2", `${dateFmt.format(new Date(t.ts))} · ${Number(t.qty)} @ ${fmtUsd(t.price)}${t.reason ? " · " + t.reason : ""}`));
    box.append(it);
  }
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
