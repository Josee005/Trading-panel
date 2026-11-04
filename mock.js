/* SOLO DEMO LOCAL. Se carga únicamente desde localhost con ?mock=1 (datos de ejemplo) o ?mock=empty (sin datos).
   Borrar este archivo antes de publicar si se quiere; app.js no hace nada sin él. NO son datos reales. */
(function () {
  const kind = (location.search.match(/[?&]mock=([^&]*)/) || [])[1] || "1";
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const now = Date.now(), iso = (ms) => new Date(ms).toISOString();
  const empty = kind === "empty";
  const base = { BTCUSDT: 67250, ETHUSDT: 3410 };
  function candles(sym, limit) {
    seed = sym === "BTCUSDT" ? 11 : 23;
    const n = 400, t0 = Math.floor(now / 60000) * 60000 - n * 60000, out = [];
    let p = base[sym] * 0.985, e20 = p, e50 = p;
    for (let i = 0; i < n; i++) {
      const drift = i > n - 70 ? 0.00022 : 0.00001, o = p, c = o * (1 + drift + (rnd() - .5) * 0.0016);
      const h = Math.max(o, c) * (1 + rnd() * 0.0006), l = Math.min(o, c) * (1 - rnd() * 0.0006);
      e20 = c * 2 / 21 + e20 * 19 / 21; e50 = c * 2 / 51 + e50 * 49 / 51; p = c;
      out.push({ open_time: iso(t0 + i * 60000), open: o, high: h, low: l, close: c, ema20: e20, ema50: e50 });
    }
    return out.slice(-limit);
  }
  function build() {
    const trades = [], sod = (function () { const d = new Date(); const f = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(d).split(":").map(Number); return (f[0] % 24) * 3600 + f[1] * 60 + f[2]; })();
    const dayStart = now - sod * 1000;
    let id = 1, realized = 0;
    if (!empty) {
      // [horas desde hace, símbolo, % resultado, motivo]
      const todayFrac = [[0.08, "ETHUSDT", 1.9, "TP"], [0.22, "BTCUSDT", -0.8, "SL"], [0.40, "BTCUSDT", 3.0, "TP"], [0.58, "ETHUSDT", 0.7, "SIGNAL"], [0.75, "BTCUSDT", 1.2, "SIGNAL"]];
      const yday = [[8, "BTCUSDT", 3.0, "TP"], [11, "ETHUSDT", -1.5, "SL"], [14, "BTCUSDT", 0.6, "SIGNAL"], [17, "ETHUSDT", 3.0, "TP"], [21, "BTCUSDT", -1.5, "SL"], [23, "ETHUSDT", 1.1, "SIGNAL"]];
      const rows = [];
      for (const [h, s, pc, why] of yday) rows.push([dayStart - (24 - (24 - h)) * 3600e3 - 3600e3 * (h % 5), s, pc, why]);
      for (const [f, s, pc, why] of todayFrac) rows.push([dayStart + Math.max(120, f * (sod - 600)) * 1000, s, pc, why]);
      rows.sort((a, b) => a[0] - b[0]);
      for (const [ts, s, pc, why] of rows) {
        const entry = base[s] * (0.99 + rnd() * 0.01), cost = s === "BTCUSDT" ? 1000 : 700, qty = cost / entry, exit = entry * (1 + pc / 100), pnl = qty * (exit - entry);
        trades.push({ id: id++, ts: iso(ts - 9 * 60000), symbol: s, side: "BUY", price: entry, qty, pnl: null, reason: null, risk_level: 3 });
        trades.push({ id: id++, ts: iso(ts), symbol: s, side: "SELL", price: exit, qty, pnl, reason: why, risk_level: 3 });
        realized += pnl;
      }
    }
    const cs = candles("BTCUSDT", 400), last = cs[cs.length - 1], px = last.close;
    const positions = [];
    let unreal = 0;
    if (!empty && kind !== "wait") {
      const entry = cs[cs.length - 40].close, cost = 1000, qty = cost / entry; unreal = qty * px - cost;
      positions.push({ symbol: "BTCUSDT", qty, entry_price: entry, current_price: px, cost, unrealized_pnl: unreal, sl_price: entry * .985, tp_price: entry * 1.03, sl_pct: 1.5, tp_pct: 3, risk_level: 3, opened_at: iso(now - 40 * 60000), updated_at: iso(now) });
      trades.push({ id: id++, ts: iso(now - 40 * 60000), symbol: "BTCUSDT", side: "BUY", price: entry, qty, pnl: null, reason: null, risk_level: 3 });
    }
    const equity = 10000 + realized + unreal, todayReal = trades.filter((t) => t.side === "SELL" && new Date(t.ts).getTime() >= dayStart).reduce((s, t) => s + t.pnl, 0);
    const dpnl = todayReal + unreal;
    const snap = { id: 1, updated_at: iso(now - 4000), equity, usdt_balance: equity - 1000, holdings_value: positions.length ? 1000 + unreal : 0, total_pnl: realized + unreal, realized_pnl: realized, unrealized_pnl: unreal,
      daily_pnl: dpnl, daily_pnl_pct: dpnl / (equity - dpnl) * 100, day_start_equity: equity - dpnl, status: "running", risk_level_in_use: 3,
      settings: { level: 3, pos_pct: 5, sl_pct: 1.5, tp_pct: 3, max_daily_loss_pct: 3 }, prices: { BTCUSDT: px, ETHUSDT: candles("ETHUSDT", 1)[0].close },
      agents: { scout: { ts: now / 1000 - 5, level: "info", text: "BTC " + px.toFixed(2) + " · ETH ok" }, analista: { ts: now / 1000 - 40, level: "info", text: "EMA20 > EMA50 en BTCUSDT" } }, emas: {}, n_trades: trades.length };
    const logs = empty ? [] : [{ id: 2, ts: iso(now - 60000), agent: "ejecutor", level: "info", message: "(DEMO) COMPRA BTCUSDT" }, { id: 1, ts: iso(now - 600000), agent: "analista", level: "info", message: "(DEMO) cruce alcista EMA20/EMA50" }];
    trades.sort((a, b) => new Date(b.ts) - new Date(a.ts));
    return { snap: { data: snap, error: null }, pos: { data: positions, error: null }, trades: { data: trades, error: null }, logs: { data: logs, error: null }, ctl: { data: { id: 1, risk_level: 3, stop_requested: false, resume_requested: false }, error: null } };
  }
  window.__MOCK__ = {
    kind,
    fetchAll: async () => build(),
    candles: async (sym, limit) => ({ data: empty && false ? [] : candles(sym, limit), error: null }),
  };
})();
