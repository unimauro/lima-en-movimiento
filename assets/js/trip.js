/* ============================================================
   trip.js — Simulador de viaje casa → trabajo (todos los modos)
   Grafo multimodal: arterias + ciclovías + red masiva. Ruta de mínimo
   tiempo (Dijkstra) para auto, taxi/app, colectivo, combi, mototaxi,
   transporte masivo (con o sin mototaxi de acercamiento), bicicleta y
   caminar. Los tiempos dependen de la hora (congestión = f(demanda)).
   Parámetros por defecto; se sobreescriben con data/modes.json.
   ============================================================ */
(function () {
  "use strict";
  const CAR_FREE = { expressway: 70, arterial: 40 };
  const COMBI_FREE = { expressway: 38, arterial: 24 };
  const CELL = 0.00040;                                          // ~44 m: unión de nodos
  // Parámetros por defecto (S/, km/h, g CO₂ por pax-km). Ver data/modes.json.
  const P = {
    walk: { speed: 4.5 },
    auto: { per_km: 0.65 },
    taxi: { base: 4.0, per_km: 1.3, per_min: 0.25, min_fare: 6.0, wait_min: 5 },
    colectivo: { fare: 4.0, speed_factor: 0.95 },
    combi: { fare: 2.0 },
    mototaxi: { fare_short: 2.5, per_km: 1.2, speed: 20, max_km: 6, access_km: 2.5 },
    bici: { speed_cycleway: 15, speed_street: 11 },
    co2: { auto: 170, taxi: 170, combi: 70, colectivo: 60, mototaxi: 90, bici: 0, metro: 25, brt: 45, corredor: 60, tren_urbano: 25 },
  };
  const PRESETS = [
    { name: "Comas → Miraflores", a: [-11.9450, -77.0600], b: [-12.1215, -77.0300] },
    { name: "Callao → La Molina", a: [-12.0570, -77.1350], b: [-12.0790, -76.9400] },
    { name: "Ate → San Borja", a: [-12.0300, -76.9000], b: [-12.1000, -77.0000] },
    { name: "SJL → San Isidro", a: [-11.9655, -76.9995], b: [-12.0965, -77.0230], needs: ["proceres_independencia"] },
    { name: "Villa El Salvador → Centro", a: [-12.2130, -76.9380], b: [-12.0510, -77.0360], needs: ["pachacutec"] },
  ];
  const hav = (a, b) => GLT.haversine(a, b);
  const $ = (id) => document.getElementById(id);
  const kmh = (v) => v * 1000 / 60;                              // → m/min

  function applyParams(m) {
    if (!m) return;
    const g = (o, k, d) => (o && o[k] != null && isFinite(o[k])) ? Number(o[k]) : d;
    P.walk.speed = g(m.caminar, "speed_kmh", P.walk.speed);
    P.taxi = { base: g(m.taxi_app, "base_soles", P.taxi.base), per_km: g(m.taxi_app, "per_km_soles", P.taxi.per_km), per_min: g(m.taxi_app, "per_min_soles", P.taxi.per_min), min_fare: g(m.taxi_app, "min_fare_soles", P.taxi.min_fare), wait_min: g(m.taxi_app, "wait_min", P.taxi.wait_min) };
    P.colectivo = { fare: g(m.colectivo, "fare_soles", P.colectivo.fare), speed_factor: g(m.colectivo, "speed_factor_vs_car", P.colectivo.speed_factor) };
    P.combi.fare = g(m.combi_custer, "fare_soles", P.combi.fare);
    P.mototaxi = { fare_short: g(m.mototaxi, "fare_short_soles", P.mototaxi.fare_short), per_km: g(m.mototaxi, "fare_per_km_soles", P.mototaxi.per_km), speed: g(m.mototaxi, "speed_kmh", P.mototaxi.speed), max_km: g(m.mototaxi, "max_trip_km", P.mototaxi.max_km), access_km: P.mototaxi.access_km };
    P.bici = { speed_cycleway: g(m.bicicleta, "speed_kmh_cycleway", P.bici.speed_cycleway), speed_street: g(m.bicicleta, "speed_kmh_street", P.bici.speed_street) };
    if (m.co2_g_per_pax_km) Object.keys(P.co2).forEach((k) => { const kk = k === "bici" ? "bicicleta" : k; P.co2[k] = g(m.co2_g_per_pax_km, kk, P.co2[k]); });
  }

  /* ---------- grafo ---------- */
  const G = { nodes: [], idx: new Map(), ready: false, twin: null, data: null, speedFactor: (d) => 1 - 0.55 * d };
  const key = (lat, lng) => Math.round(lat / CELL) + "," + Math.round(lng / CELL);
  function wnode(lat, lng, src, cls) { const k = key(lat, lng); let id = G.idx.get(k);
    if (id == null) { id = G.nodes.length; G.nodes.push({ lat, lng, adj: [], src, cls }); G.idx.set(k, id); }
    else { const n = G.nodes[id]; if (src && n.src !== src) n.src = "*"; if (cls === "expressway") n.cls = "expressway"; }
    return id; }
  function link(a, b, len, kind, line, extra) {
    if (a === b) return;
    G.nodes[a].adj.push(Object.assign({ to: b, len, kind, line }, extra || {}));
    G.nodes[b].adj.push(Object.assign({ to: a, len, kind, line }, extra || {}));
  }
  const GCELL = 0.0009;                                          // celdas ≈100 m
  const gkey = (lat, lng) => Math.floor(lat / GCELL) + "," + Math.floor(lng / GCELL);
  function neighborsOf(grid, lat, lng, R) {
    const out = [], ci = Math.floor(lat / GCELL), cj = Math.floor(lng / GCELL), span = Math.ceil(R / 95);
    for (let i = ci - span; i <= ci + span; i++) for (let j = cj - span; j <= cj + span; j++) {
      const cell = grid.get(i + "," + j); if (!cell) continue;
      for (const id of cell) { const n = G.nodes[id], d = hav([lat, lng], [n.lat, n.lng]); if (d <= R) out.push([d, id]); }
    }
    return out.sort((x, y) => x[0] - y[0]);
  }
  function addPolyline(coords, src, kind, cls, extra) {
    let prev = null, pll = null, first = null;
    coords.forEach((c) => {
      const lat = c[1], lng = c[0], id = wnode(lat, lng, src, cls);
      if (prev != null && prev !== id) link(prev, id, hav(pll, [lat, lng]), kind, cls, extra);
      if (first == null) first = id; prev = id; pll = [lat, lng];
    });
    return [first, prev];
  }
  function build(twin, data) {
    G.nodes = []; G.idx = new Map(); G.twin = twin; G.data = data;
    applyParams(data.modes);
    if (GLT.traffic && GLT.traffic.speedFactor) G.speedFactor = GLT.traffic.speedFactor;
    const ends = [];
    ((data.arteries && data.arteries.features) || []).forEach((f) => {
      const cls = f.properties.class === "expressway" ? "expressway" : "arterial";
      const [a, b] = addPolyline(f.geometry.coordinates, f.properties.id, "road", cls);
      if (a != null) ends.push(a); if (b != null && b !== a) ends.push(b);
    });
    ((data.cycleways && data.cycleways.features) || []).forEach((f) => {
      addPolyline(f.geometry.coordinates, "cw_" + f.properties.id, "cycle", "cycle", { ctype: f.properties.type });
    });
    // Cruces: vías distintas que se acercan comparten nodo (radio mayor en intercambios de vías expresas).
    const grid = new Map();
    G.nodes.forEach((n, id) => { const k = gkey(n.lat, n.lng); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(id); });
    const linked = new Set();
    const tryLink = (id, v, d) => { const pk = id < v ? id + ":" + v : v + ":" + id; if (linked.has(pk)) return; linked.add(pk); link(id, v, Math.max(d, 1), "road", "arterial"); };
    G.nodes.forEach((n, id) => {
      for (const [d, v] of neighborsOf(grid, n.lat, n.lng, 230)) {
        if (v === id) continue; const m = G.nodes[v];
        if (n.src === m.src && n.src !== "*") continue;
        const R = (n.cls === "expressway" || m.cls === "expressway") ? 230 : 70;
        if (d <= R) tryLink(id, v, d);
      }
    });
    ends.forEach((id) => { const n = G.nodes[id];
      neighborsOf(grid, n.lat, n.lng, 450).filter(([, v]) => v !== id && G.nodes[v].src !== n.src).slice(0, 2).forEach(([d, v]) => tryLink(id, v, d)); });
    // Red masiva: cadena por línea; sube/baja en estación; estación ↔ vías cercanas (≤600 m).
    twin.lines.forEach((L) => {
      if (L.def.status !== "operational" || !L.stops.length) return;
      let prevT = null;
      L.stops.forEach((s, i) => {
        const tid = G.nodes.length; G.nodes.push({ lat: s.lat, lng: s.lng, adj: [], transit: L.def.id, stop: s.name });
        if (prevT != null) link(prevT, tid, Math.abs(s.d - L.stops[i-1].d), "transit", L.def.id, { mode: L.def.mode, spd: L.def.avg_speed_kmh || 25, dwell: L.sty.dwell });
        const wid = wnode(s.lat, s.lng, "station");
        link(wid, tid, 0, "board", L.def.id);
        neighborsOf(grid, s.lat, s.lng, 600).filter(([, v]) => v !== wid && !G.nodes[v].transit).slice(0, 3)
          .forEach(([d, v]) => link(wid, v, Math.max(d, 1), "road", "arterial"));
        prevT = tid;
      });
    });
    G.ready = G.nodes.length > 0;
    return G.nodes.length;
  }

  /* ---------- costo (minutos) de una arista según el modo ---------- */
  const INF = Infinity;
  function edgeCost(e, fromNode, mode, sf, t) {
    const road = e.kind === "road", cyc = e.kind === "cycle";
    switch (mode) {
      case "auto": case "taxi": return road ? e.len / kmh(CAR_FREE[e.line] * sf) : INF;
      case "colectivo": return road ? e.len / kmh(CAR_FREE[e.line] * sf * P.colectivo.speed_factor) + (e.len / 1000) * 0.15 : INF;
      case "combi": return road ? e.len / kmh(COMBI_FREE[e.line] * sf) + (e.len / 500) * 0.35 : INF;
      case "mototaxi": return (road || cyc) ? e.len / kmh(P.mototaxi.speed * (0.7 + 0.3 * sf)) : INF;
      case "bici": return cyc ? e.len / kmh(P.bici.speed_cycleway) : road ? e.len / kmh(P.bici.speed_street) * 1.15 : INF;
      case "caminar": return (road || cyc) ? e.len / kmh(P.walk.speed) : INF;
      default: // transporte masivo: camina por calles/ciclovías, sube en estaciones, viaja en línea
        if (road || cyc) return e.len / kmh(P.walk.speed);
        if (e.kind === "transit") return e.len / kmh(e.spd) + (e.dwell || 0.3);
        if (e.kind === "board") { if (fromNode.transit) return 0;
          const L = G.twin.lines.find((x) => x.def.id === e.line); return (L ? G.twin.headway(L, t) / 2 : 5) + 0.5; }
        return INF;
    }
  }

  /* ---------- Dijkstra con heap binario ---------- */
  class Heap { constructor(){ this.a=[]; } push(x){ const a=this.a; a.push(x); let i=a.length-1; while(i>0){ const p=(i-1)>>1; if(a[p][0]<=a[i][0]) break; [a[p],a[i]]=[a[i],a[p]]; i=p; } }
    pop(){ const a=this.a; const top=a[0], last=a.pop(); if(a.length){ a[0]=last; let i=0; for(;;){ const l=2*i+1,r=l+1; let m=i; if(l<a.length&&a[l][0]<a[m][0]) m=l; if(r<a.length&&a[r][0]<a[m][0]) m=r; if(m===i) break; [a[m],a[i]]=[a[i],a[m]]; i=m; } } return top; }
    get size(){ return this.a.length; } }

  // k nodos más cercanos, máximo 2 por vía, para que un fragmento aislado no monopolice el acceso.
  function nearest(ll, filter, k, maxM) {
    const out = [];
    for (let i = 0; i < G.nodes.length; i++) { const n = G.nodes[i]; if (filter && !filter(n)) continue;
      const d = hav(ll, [n.lat, n.lng]); if (d <= maxM) out.push([d, i]); }
    out.sort((x, y) => x[0] - y[0]);
    const per = {}, pick = [];
    for (const e of out) { const s = G.nodes[e[1]].src || "station"; per[s] = (per[s] || 0) + 1; if (per[s] <= 2) pick.push(e); if (pick.length >= k) break; }
    return pick;
  }

  function route(A, B, mode, t, sfOverride) {
    const sf = sfOverride != null ? sfOverride : G.speedFactor(G.twin.demandIndex(t));
    const N = G.nodes.length, dist = new Float64Array(N).fill(INF), pred = new Int32Array(N).fill(-1), predE = new Array(N);
    // Puntos de acceso según el modo: los vehículos entran por vías, la bici por ciclovía o vía,
    // y a pie/masivo por cualquier nodo peatonal.
    const roadOnly = ["auto", "taxi", "colectivo", "combi"].includes(mode);
    const walkable = (n) => !n.transit && (roadOnly ? (n.cls && n.cls !== "cycle") : mode === "bici" ? !!n.cls : true);
    const starts = nearest(A, walkable, 10, 2500), ends = nearest(B, walkable, 10, 2500);
    if (!starts.length || !ends.length) return null;
    const accSpeed = mode === "bici" ? P.bici.speed_street : P.walk.speed;   // acceso desde el punto exacto
    const H = new Heap();
    starts.forEach(([d, i]) => { const c = d / kmh(accSpeed); if (c < dist[i]) { dist[i] = c; H.push([c, i]); } });
    const endSet = new Map(ends.map(([d, i]) => [i, d]));
    while (H.size) {
      const [c, u] = H.pop(); if (c > dist[u]) continue;
      const nu = G.nodes[u];
      for (const e of nu.adj) {
        const w = edgeCost(e, nu, mode, sf, t); if (!isFinite(w)) continue;
        const nc = c + w; if (nc < dist[e.to]) { dist[e.to] = nc; pred[e.to] = u; predE[e.to] = e; H.push([nc, e.to]); }
      }
    }
    let best = null;
    endSet.forEach((d, i) => { if (isFinite(dist[i])) { const tot = dist[i] + d / kmh(accSpeed); if (!best || tot < best.tot) best = { i, tot, egress: d }; } });
    if (!best) return null;
    const path = []; let u = best.i; while (u !== -1) { path.push(u); u = pred[u]; } path.reverse();
    const accessM = (starts.find(([, i]) => i === path[0]) || [0])[0];
    const segs = []; let walkM = accessM + best.egress, rideM = 0, rideMin = 0, waitMin = 0, co2 = 0, cycM = 0;
    let accessLegM = accessM, egressLegM = best.egress, seenBoard = false, afterLast = 0;
    const linesUsed = new Set(); let boardings = 0;
    for (let k = 1; k < path.length; k++) {
      const e = predE[path[k]], from = G.nodes[path[k-1]];
      const w = edgeCost(e, from, mode, sf, t);
      if (mode === "tp") {
        if (e.kind === "road" || e.kind === "cycle") { walkM += e.len; if (!seenBoard) accessLegM += e.len; afterLast += e.len; }
        else if (e.kind === "transit") { rideM += e.len; rideMin += w; linesUsed.add(e.line); co2 += (e.len/1000) * (P.co2[e.mode] || 50); afterLast = 0; }
        else if (e.kind === "board") { if (!from.transit) { waitMin += w; boardings++; seenBoard = true; } afterLast = 0; }
      } else { rideM += e.len; rideMin += w; if (e.kind === "cycle") cycM += e.len; }
      segs.push({ from: [from.lat, from.lng], to: [G.nodes[path[k]].lat, G.nodes[path[k]].lng], kind: e.kind, line: e.line });
    }
    if (mode === "tp") egressLegM += afterLast;
    const walkMin = walkM / kmh(P.walk.speed), total = best.tot, km = rideM / 1000;
    let cost = 0;
    switch (mode) {
      case "auto": cost = km * P.auto.per_km; co2 = km * P.co2.auto; break;
      case "taxi": cost = Math.max(P.taxi.min_fare, P.taxi.base + km * P.taxi.per_km + rideMin * P.taxi.per_min); co2 = km * P.co2.taxi; break;
      case "colectivo": boardings = km > 15 ? 2 : 1; cost = boardings * P.colectivo.fare; co2 = km * P.co2.colectivo; break;
      case "combi": boardings = km > 12 ? 2 : 1; cost = boardings * P.combi.fare; co2 = km * P.co2.combi; break;
      case "mototaxi": cost = P.mototaxi.fare_short + Math.max(0, km - 2) * P.mototaxi.per_km; co2 = km * P.co2.mototaxi; break;
      case "bici": case "caminar": cost = 0; co2 = 0; break;
      default: { const det = G.data.linesDetail || {}; linesUsed.forEach((id) => { const f = det[id] && det[id].fare_soles; cost += (f != null ? f : 2.0); }); }
    }
    const pts = [A]; segs.forEach((s, i) => { if (i === 0) pts.push(s.from); pts.push(s.to); }); pts.push(B);
    const extra = mode === "taxi" ? P.taxi.wait_min : 0;
    return { mode, total: total + extra, walkMin, rideMin, waitMin: waitMin + extra, distKm: (rideM + walkM)/1000, rideKm: km, cycKm: cycM/1000,
      cost, co2, lines: [...linesUsed], boardings, pts, segs, accessLegM, egressLegM };
  }
  // Masivo + mototaxi de acercamiento: reemplaza tramos a pie largos (acceso/egreso) por mototaxi.
  function withMototaxi(tp) {
    if (!tp) return null;
    const legs = [tp.accessLegM, tp.egressLegM].filter((m) => m > 600 && m / 1000 <= P.mototaxi.max_km);
    if (!legs.length) return null;
    let total = tp.total, cost = tp.cost, co2 = tp.co2, walkMin = tp.walkMin;
    legs.forEach((m) => { const km = m / 1000; total += -(m / kmh(P.walk.speed)) + m / kmh(P.mototaxi.speed) + 2; walkMin -= m / kmh(P.walk.speed);
      cost += P.mototaxi.fare_short + Math.max(0, km - 2) * P.mototaxi.per_km; co2 += km * P.co2.mototaxi; });
    return Object.assign({}, tp, { mode: "tpmoto", total, cost, co2, walkMin: Math.max(0, walkMin), motoLegs: legs.length });
  }

  /* ---------- UI ---------- */
  const S = { A: null, B: null, mk: {}, setMode: null, layers: [], sel: null, last: null };
  const MODES = [
    { id: "auto",     label: "Auto particular",       icon: "🚗", color: "#eb6834" },
    { id: "taxi",     label: "Taxi / app",            icon: "🚕", color: "#f2a900" },
    { id: "colectivo",label: "Colectivo",             icon: "🚙", color: "#d55181" },
    { id: "combi",    label: "Combi / cúster",        icon: "🚌", color: "#9085e9" },
    { id: "tp",       label: "Transporte masivo",     icon: "🚈", color: "#3987e5" },
    { id: "tpmoto",   label: "Masivo + mototaxi",     icon: "🛺", color: "#1baf7a" },
    { id: "mototaxi", label: "Mototaxi",              icon: "🛺", color: "#e34948" },
    { id: "bici",     label: "Bicicleta",             icon: "🚲", color: "#43a047" },
    { id: "caminar",  label: "Caminando",             icon: "🚶", color: "#8f8e86" },
  ];
  const fmtMin = (m) => m >= 60 ? `${Math.floor(m/60)} h ${Math.round(m%60)} min` : `${Math.round(m)} min`;

  function marker(which, ll) {
    const L = window.L; const icon = L.divIcon({ className: "od-mk", html: `<span class="od-${which}">${which === "A" ? "🏠" : "💼"}</span>`, iconSize: [30, 30], iconAnchor: [15, 30] });
    if (S.mk[which]) S.mk[which].setLatLng(ll); else S.mk[which] = L.marker(ll, { icon, draggable: true }).addTo(G.twin.map)
      .on("dragend", (e) => { const p = e.target.getLatLng(); S[which] = [p.lat, p.lng]; compute(); });
  }
  function setPoint(which, ll) { S[which] = ll; marker(which, ll); status(); compute(); }
  function status(msg) {
    const el = $("tripStatus"); if (!el) return;
    if (msg) { el.textContent = msg; return; }
    if (!S.A && !S.B) el.textContent = "Marca tu casa (A) y tu trabajo (B) en el mapa, o elige un ejemplo.";
    else if (!S.B) el.textContent = "Casa marcada ✓ — ahora toca el mapa para poner el trabajo (B).";
    else if (!S.A) el.textContent = "Trabajo marcado ✓ — ahora toca el mapa para poner tu casa (A).";
    else el.textContent = "";
  }
  function clearRoutes() { S.layers.forEach((l) => G.twin.map.removeLayer(l)); S.layers = []; }
  function drawRoutes(res) {
    clearRoutes(); const L = window.L;
    const faint = ["auto", "tp"].filter((m) => m !== S.sel && res[m]);
    [...faint, S.sel].forEach((id) => { const r = res[id], m = MODES.find((x) => x.id === id); if (!r || !m) return;
      const selected = id === S.sel;
      const pl = L.polyline(r.pts, { color: m.color, weight: selected ? 6 : 3, opacity: selected ? 0.95 : 0.3, dashArray: (id === "combi" || id === "colectivo") ? "2 8" : (id === "bici" ? "6 6" : null), lineCap: "round", lineJoin: "round" });
      pl.addTo(G.twin.map); S.layers.push(pl); });
  }
  function compute() {
    if (!G.ready || !S.A || !S.B) return;
    const t = G.twin.t, res = {}, dAB = hav(S.A, S.B) / 1000;
    MODES.forEach((m) => {
      if (m.id === "tpmoto") return;
      if (m.id === "mototaxi" && dAB > P.mototaxi.max_km) return;
      if (m.id === "caminar" && dAB > 6) return;
      res[m.id] = route(S.A, S.B, m.id, t);
    });
    res.tpmoto = withMototaxi(res.tp);
    const auto = res.auto; let peak = null, valle = null, free = null;
    if (auto) { peak = route(S.A, S.B, "auto", 8*60); valle = route(S.A, S.B, "auto", 22*60); free = route(S.A, S.B, "auto", t, 1); }
    S.last = res;
    const ok = MODES.filter((m) => res[m.id]).sort((a, b) => res[a.id].total - res[b.id].total);
    if (!ok.length) { status("No encontré ruta con la red modelada para esos puntos (prueba más cerca de una avenida o estación)."); $("tripResults").hidden = true; $("tripCallout").hidden = true; clearRoutes(); return; }
    const best = ok[0], cheap = ok.reduce((a, m) => res[m.id].cost < res[a.id].cost ? m : a, ok[0]), green = ok.reduce((a, m) => res[m.id].co2 < res[a.id].co2 ? m : a, ok[0]);
    if (!S.sel || !res[S.sel]) S.sel = best.id;
    const box = $("tripResults"); box.hidden = false;
    box.innerHTML = ok.map((m) => { const r = res[m.id];
      const tags = [best.id === m.id ? "más rápido" : "", cheap.id === m.id ? "más barato" : "", green.id === m.id ? "menos CO₂" : ""].filter(Boolean).join(" · ");
      const det = m.id === "tp" ? `${fmtMin(r.walkMin)} a pie · espera ${fmtMin(r.waitMin)} · ${r.lines.length ? r.lines.join(" + ") : "—"}${r.walkMin > 40 ? " · poca cobertura" : ""}`
        : m.id === "tpmoto" ? `${r.motoLegs} tramo${r.motoLegs > 1 ? "s" : ""} en mototaxi · ${fmtMin(r.walkMin)} a pie · ${r.lines.join(" + ")}`
        : m.id === "combi" || m.id === "colectivo" ? `${r.boardings} ${m.id}${r.boardings > 1 ? "s" : ""} · ${fmtMin(r.walkMin)} a pie`
        : m.id === "taxi" ? `${r.rideKm.toFixed(1)} km · espera ${fmtMin(P.taxi.wait_min)}`
        : m.id === "bici" ? `${r.cycKm.toFixed(1)} km por ciclovía de ${r.rideKm.toFixed(1)} km`
        : `${r.rideKm.toFixed(1)} km en vía · ${fmtMin(r.walkMin)} a pie`;
      return `<button class="mode-card${S.sel === m.id ? " sel" : ""}${best.id === m.id ? " best" : ""}" data-mode="${m.id}" style="--mc:${m.color}">
        <div class="mc-h"><span class="mc-ic">${m.icon}</span><b>${m.label}</b>${tags ? `<em>${tags}</em>` : ""}</div>
        <div class="mc-time tnum">${fmtMin(r.total)}</div>
        <div class="mc-det">${det}</div>
        <div class="mc-kv"><span>S/ <b>${r.cost.toFixed(2)}</b></span><span><b>${(r.co2/1000).toFixed(2)}</b> kg CO₂</span><span><b>${r.distKm.toFixed(1)}</b> km</span></div>
      </button>`; }).join("");
    box.querySelectorAll(".mode-card").forEach((b) => b.addEventListener("click", () => { S.sel = b.dataset.mode; drawRoutes(res); box.querySelectorAll(".mode-card").forEach((x) => x.classList.toggle("sel", x.dataset.mode === S.sel)); }));
    const co = $("tripCallout");
    if (auto && peak && valle && free) {
      const lost = Math.max(0, peak.total - free.total), annual = lost * 2 * 250 / 60;
      co.hidden = false;
      co.innerHTML = `En <b>auto</b>: hora punta <b class="tnum">${fmtMin(peak.total)}</b> · valle <b class="tnum">${fmtMin(valle.total)}</b> · sin tráfico <b class="tnum">${fmtMin(free.total)}</b>.
        Si haces este viaje ida y vuelta cada día laboral, pierdes <span class="up">~${Math.round(annual)} h al año</span> en congestión.`;
    } else co.hidden = true;
    drawRoutes(res); status();
    GLT.track && GLT.track("trip_compute", { mode: S.sel });
  }

  function arteryConnected(src) {
    const start = G.nodes.findIndex((n) => n.src === src); if (start < 0) return false;
    const seen = new Uint8Array(G.nodes.length), q = [start]; seen[start] = 1;
    while (q.length) { const u = q.pop(), nu = G.nodes[u];
      if (nu.src === "via_expresa_paseo_republica" || nu.src === "javier_prado") return true;
      for (const e of nu.adj) if (e.kind === "road" && !seen[e.to]) { seen[e.to] = 1; q.push(e.to); } }
    return false;
  }
  function init(twin, data) {
    const n = build(twin, data); if (!n) return false;
    const presets = PRESETS.filter((p) => !p.needs || p.needs.every(arteryConnected));
    const pr = $("tripPresets");
    if (pr) pr.innerHTML = presets.map((p, i) => `<button class="chip-btn" data-i="${i}">${p.name}</button>`).join("");
    pr && pr.querySelectorAll(".chip-btn").forEach((b) => b.addEventListener("click", () => { const p = presets[+b.dataset.i]; S.A = p.a; S.B = p.b; marker("A", p.a); marker("B", p.b); status(); compute(); GLT.track && GLT.track("trip_preset", { name: p.name }); }));
    const setA = $("tripSetA"), setB = $("tripSetB"), clr = $("tripClear");
    const arm = (w) => { S.setMode = w; status(`Toca el mapa para poner ${w === "A" ? "tu casa (A)" : "tu trabajo (B)"}…`); twin.container.style.cursor = "crosshair"; };
    setA && setA.addEventListener("click", () => arm("A"));
    setB && setB.addEventListener("click", () => arm("B"));
    clr && clr.addEventListener("click", () => { S.A = S.B = null; Object.values(S.mk).forEach((m) => twin.map.removeLayer(m)); S.mk = {}; clearRoutes(); $("tripResults").hidden = true; $("tripCallout").hidden = true; S.sel = null; status(); });
    twin.map.on("click", (e) => {
      const which = S.setMode || (!S.A ? "A" : !S.B ? "B" : null);
      if (!which) return;
      const tab = document.querySelector('.tab[data-tab="trip"]'); if (!S.setMode && tab && !tab.classList.contains("active")) return;
      setPoint(which, [e.latlng.lat, e.latlng.lng]); S.setMode = null; twin.container.style.cursor = "";
    });
    twin.onHourChange((t) => { if (S.A && S.B && Math.floor(t/10) !== S._b) { S._b = Math.floor(t/10); compute(); } });
    status();
    return true;
  }

  window.GLT = window.GLT || {};
  window.GLT.trip = { init, compute, route, withMototaxi, PRESETS, MODES, params: P, _debug: { G, nearest, arteryConnected } };
})();
