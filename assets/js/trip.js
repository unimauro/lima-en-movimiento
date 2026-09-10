/* ============================================================
   trip.js — Simulador de viaje casa → trabajo
   Grafo multimodal (arterias + red masiva) y ruta de mínimo tiempo
   (Dijkstra) para 3 modos: auto, transporte público, combi.
   Los tiempos dependen de la hora (congestión = f(demanda)).
   ============================================================ */
(function () {
  "use strict";
  const WALK = 4.5;                                              // km/h
  const CAR_FREE = { expressway: 70, arterial: 40 };
  const COMBI_FREE = { expressway: 38, arterial: 24 };
  const COST = { car_per_km: 0.65, combi_fare: 2.0, default_fare: 2.0 };   // S/
  const CO2 = { car: 170, combi: 70, brt: 45, metro: 25, corredor: 60, tren_urbano: 25 }; // g por pax-km
  const CELL = 0.00040;                                          // ~44 m: radio de unión de nodos
  // Ejemplos de viaje. Los de SJL y Villa El Salvador se activan cuando el grafo vial
  // incluya sus conectores (Puente Nuevo → Abancay; Pachacútec → Panamericana Sur).
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

  /* ---------- grafo ---------- */
  const G = { nodes: [], idx: new Map(), ready: false, twin: null, data: null, speedFactor: (d) => 1 - 0.55 * d };
  const key = (lat, lng) => Math.round(lat / CELL) + "," + Math.round(lng / CELL);
  function wnode(lat, lng, src) { const k = key(lat, lng); let id = G.idx.get(k);
    if (id == null) { id = G.nodes.length; G.nodes.push({ lat, lng, adj: [], src }); G.idx.set(k, id); }
    else if (src && G.nodes[id].src !== src) G.nodes[id].src = "*";     // nodo compartido por varias vías
    return id; }
  function link(a, b, len, kind, line, extra) {
    if (a === b) return;
    G.nodes[a].adj.push(Object.assign({ to: b, len, kind, line }, extra || {}));
    G.nodes[b].adj.push(Object.assign({ to: a, len, kind, line }, extra || {}));
  }
  // Índice espacial simple (celdas ~100 m) para buscar vecinos
  const GCELL = 0.0009;
  const gkey = (lat, lng) => Math.floor(lat / GCELL) + "," + Math.floor(lng / GCELL);
  function neighborsOf(grid, lat, lng, R) {
    const out = [], ci = Math.floor(lat / GCELL), cj = Math.floor(lng / GCELL), span = Math.ceil(R / 95); // celdas ≈100 m
    for (let i = ci - span; i <= ci + span; i++) for (let j = cj - span; j <= cj + span; j++) {
      const cell = grid.get(i + "," + j); if (!cell) continue;
      for (const id of cell) { const n = G.nodes[id], d = hav([lat, lng], [n.lat, n.lng]); if (d <= R) out.push([d, id]); }
    }
    return out.sort((x, y) => x[0] - y[0]);
  }
  function build(twin, data) {
    G.nodes = []; G.idx = new Map(); G.twin = twin; G.data = data;
    if (GLT.traffic && GLT.traffic.speedFactor) G.speedFactor = GLT.traffic.speedFactor;
    const art = (data.arteries && data.arteries.features) || [];
    const ends = [];                                                     // extremos de cada arteria
    art.forEach((f) => {
      const cls = f.properties.class === "expressway" ? "expressway" : "arterial", src = f.properties.id;
      let prev = null, pll = null, first = null;
      f.geometry.coordinates.forEach((c) => {
        const lat = c[1], lng = c[0], id = wnode(lat, lng, src);
        G.nodes[id].cls = G.nodes[id].cls && G.nodes[id].cls !== cls ? "expressway" : cls;
        if (prev != null && prev !== id) link(prev, id, hav(pll, [lat, lng]), "road", cls);
        if (first == null) first = id; prev = id; pll = [lat, lng];
      });
      if (first != null) ends.push(first); if (prev != null && prev !== first) ends.push(prev);
    });
    // Cruces: dos vías distintas que se acercan comparten nodo. En intercambios con vías
    // expresas los ejes están más separados (ramales), así que el radio es mayor.
    const grid = new Map();
    G.nodes.forEach((n, id) => { const k = gkey(n.lat, n.lng); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(id); });
    const linked = new Set();
    const tryLink = (id, v, d) => { const pk = id < v ? id + ":" + v : v + ":" + id; if (linked.has(pk)) return; linked.add(pk); link(id, v, Math.max(d, 1), "road", "arterial"); };
    G.nodes.forEach((n, id) => {
      for (const [d, v] of neighborsOf(grid, n.lat, n.lng, 230)) {
        if (v === id) continue; const m = G.nodes[v];
        if (n.src === m.src && n.src !== "*") continue;                    // misma vía: ya está encadenada
        const R = (n.cls === "expressway" || m.cls === "expressway") ? 230 : 70;
        if (d <= R) tryLink(id, v, d);
      }
    });
    // Extremos: una avenida que "termina" suele continuar en otra vía cercana (puentes, óvalos).
    ends.forEach((id) => { const n = G.nodes[id];
      neighborsOf(grid, n.lat, n.lng, 450).filter(([, v]) => v !== id && G.nodes[v].src !== n.src).slice(0, 2)
        .forEach(([d, v]) => tryLink(id, v, d)); });
    // Red masiva: cadena propia por línea; se sube/baja en la estación hacia el grafo peatonal,
    // y cada estación se enlaza a las vías cercanas (≤600 m) para transbordos y acceso.
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

  /* ---------- costo por modo ---------- */
  function edgeCost(e, fromNode, mode, sf, t) {
    if (mode === "auto") { return e.kind === "road" ? e.len / kmh(CAR_FREE[e.line] * sf) : Infinity; }
    if (mode === "combi") { return e.kind === "road" ? e.len / kmh(COMBI_FREE[e.line] * sf) + (e.len / 500) * 0.35 : Infinity; }
    // transporte público: camina por calles, sube en estaciones (espera = mitad del intervalo), viaja en línea
    if (e.kind === "road") return e.len / kmh(WALK);
    if (e.kind === "transit") return e.len / kmh(e.spd) + (e.dwell || 0.3);
    if (e.kind === "board") {
      if (fromNode.transit) return 0;                              // bajar
      const L = G.twin.lines.find((x) => x.def.id === e.line);
      return (L ? G.twin.headway(L, t) / 2 : 5) + 0.5;             // subir: espera + acceso
    }
    return Infinity;
  }

  /* ---------- Dijkstra con heap binario ---------- */
  class Heap { constructor(){ this.a=[]; } push(x){ const a=this.a; a.push(x); let i=a.length-1; while(i>0){ const p=(i-1)>>1; if(a[p][0]<=a[i][0]) break; [a[p],a[i]]=[a[i],a[p]]; i=p; } }
    pop(){ const a=this.a; const top=a[0], last=a.pop(); if(a.length){ a[0]=last; let i=0; for(;;){ const l=2*i+1,r=l+1; let m=i; if(l<a.length&&a[l][0]<a[m][0]) m=l; if(r<a.length&&a[r][0]<a[m][0]) m=r; if(m===i) break; [a[m],a[i]]=[a[i],a[m]]; i=m; } } return top; }
    get size(){ return this.a.length; } }

  // k nodos más cercanos, pero como máximo 2 por vía (src) para que un fragmento
  // aislado no monopolice el acceso/egreso del viaje.
  function nearest(ll, filter, k, maxM) {
    const out = [];
    for (let i = 0; i < G.nodes.length; i++) { const n = G.nodes[i]; if (filter && !filter(n)) continue;
      const d = hav(ll, [n.lat, n.lng]); if (d <= maxM) out.push([d, i]); }
    out.sort((x, y) => x[0] - y[0]);
    const per = {}, pick = [];
    for (const e of out) { const s = G.nodes[e[1]].src || "station"; per[s] = (per[s] || 0) + 1;
      if (per[s] <= 2) pick.push(e); if (pick.length >= k) break; }
    return pick;
  }

  function route(A, B, mode, t, sfOverride) {
    const sf = sfOverride != null ? sfOverride : G.speedFactor(G.twin.demandIndex(t));
    const N = G.nodes.length, dist = new Float64Array(N).fill(Infinity), pred = new Int32Array(N).fill(-1), predE = new Array(N);
    const walkable = (n) => !n.transit;
    const starts = nearest(A, walkable, 6, 2500), ends = nearest(B, walkable, 6, 2500);
    if (!starts.length || !ends.length) return null;
    const H = new Heap();
    starts.forEach(([d, i]) => { const c = d / kmh(WALK); if (c < dist[i]) { dist[i] = c; H.push([c, i]); } });
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
    endSet.forEach((d, i) => { if (isFinite(dist[i])) { const tot = dist[i] + d / kmh(WALK); if (!best || tot < best.tot) best = { i, tot, egress: d }; } });
    if (!best) return null;
    // reconstruir
    const path = []; let u = best.i; while (u !== -1) { path.push(u); u = pred[u]; } path.reverse();
    const accessM = starts.find(([, i]) => i === path[0])[0];
    const segs = []; let walkM = accessM + best.egress, rideM = 0, waitMin = 0, rideMin = 0, co2 = 0;
    const linesUsed = new Set(); let boardings = 0;
    for (let k = 1; k < path.length; k++) {
      const e = predE[path[k]], from = G.nodes[path[k-1]];
      const w = edgeCost(e, from, mode, sf, t);
      if (mode === "tp") {
        if (e.kind === "road") walkM += e.len;
        else if (e.kind === "transit") { rideM += e.len; rideMin += w; linesUsed.add(e.line); co2 += (e.len/1000) * (CO2[e.mode] || 50); }
        else if (e.kind === "board" && !from.transit) { waitMin += w; boardings++; }
      } else { rideM += e.len; rideMin += w; }
      segs.push({ from: [from.lat, from.lng], to: [G.nodes[path[k]].lat, G.nodes[path[k]].lng], kind: e.kind, line: e.line });
    }
    const walkMin = walkM / kmh(WALK), total = best.tot;
    let cost = 0;
    if (mode === "auto") { cost = (rideM/1000) * COST.car_per_km; co2 = (rideM/1000) * CO2.car; }
    else if (mode === "combi") { boardings = rideM > 12000 ? 2 : 1; cost = boardings * COST.combi_fare; co2 = (rideM/1000) * CO2.combi; }
    else { const det = G.data.linesDetail || {}; linesUsed.forEach((id) => { const f = det[id] && det[id].fare_soles; cost += (f != null ? f : COST.default_fare); }); }
    const pts = [A]; segs.forEach((s, i) => { if (i === 0) pts.push(s.from); pts.push(s.to); }); pts.push(B);
    return { mode, total, walkMin, rideMin, waitMin, distKm: (rideM + walkM)/1000, rideKm: rideM/1000, cost, co2, lines: [...linesUsed], boardings, pts, segs };
  }

  /* ---------- UI ---------- */
  const S = { A: null, B: null, mk: {}, setMode: null, layers: [], sel: null, last: null };
  const MODES = [
    { id: "auto",  label: "Auto particular", icon: "🚗", color: "#eb6834" },
    { id: "tp",    label: "Transporte masivo", icon: "🚈", color: "#3987e5" },
    { id: "combi", label: "Combi / cúster", icon: "🚌", color: "#9085e9" },
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
    MODES.forEach((m) => { const r = res[m.id]; if (!r) return;
      const selected = S.sel === m.id;
      const pl = L.polyline(r.pts, { color: m.color, weight: selected ? 6 : 3, opacity: selected ? 0.95 : 0.35, dashArray: m.id === "auto" ? null : (m.id === "combi" ? "2 8" : null), lineCap: "round", lineJoin: "round" });
      pl.addTo(G.twin.map); S.layers.push(pl);
    });
  }
  function compute() {
    if (!G.ready || !S.A || !S.B) return;
    const t = G.twin.t, res = {};
    MODES.forEach((m) => { res[m.id] = route(S.A, S.B, m.id, t); });
    const auto = res.auto;
    let peak = null, valle = null, free = null;
    if (auto) { peak = route(S.A, S.B, "auto", 8*60); valle = route(S.A, S.B, "auto", 22*60); free = route(S.A, S.B, "auto", t, 1); }
    S.last = res;
    const okModes = MODES.filter((m) => res[m.id]);
    if (!okModes.length) { status("No encontré ruta con la red modelada para esos puntos (prueba más cerca de una arteria o estación)."); $("tripResults").hidden = true; $("tripCallout").hidden = true; clearRoutes(); return; }
    const best = okModes.reduce((a, m) => (!a || res[m.id].total < res[a.id].total) ? m : a, null);
    if (!S.sel || !res[S.sel]) S.sel = best.id;
    const box = $("tripResults"); box.hidden = false;
    box.innerHTML = okModes.map((m) => { const r = res[m.id];
      const det = m.id === "tp" ? `${fmtMin(r.walkMin)} a pie · ${fmtMin(r.waitMin)} espera · ${r.lines.length ? r.lines.join(" + ") : "—"}` :
                  m.id === "combi" ? `${r.boardings} combi${r.boardings > 1 ? "s" : ""} · ${fmtMin(r.walkMin)} a pie` : `${r.rideKm.toFixed(1)} km en vía · ${fmtMin(r.walkMin)} a pie`;
      return `<button class="mode-card${S.sel === m.id ? " sel" : ""}${best.id === m.id ? " best" : ""}" data-mode="${m.id}" style="--mc:${m.color}">
        <div class="mc-h"><span class="mc-ic">${m.icon}</span><b>${m.label}</b>${best.id === m.id ? '<em>más rápido</em>' : ""}</div>
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

  // ¿La arteria `src` está unida (por vías) al eje central de la ciudad?
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
      const tab = document.querySelector('.tab[data-tab="trip"]'); if (!S.setMode && tab && !tab.classList.contains("active")) return; // solo en pestaña Mi viaje
      setPoint(which, [e.latlng.lat, e.latlng.lng]); S.setMode = null; twin.container.style.cursor = "";
    });
    twin.onHourChange((t) => { if (S.A && S.B && Math.floor(t/10) !== S._b) { S._b = Math.floor(t/10); compute(); } });
    status();
    return true;
  }

  window.GLT = window.GLT || {};
  window.GLT.trip = { init, compute, route, PRESETS, _debug: { G, nearest, arteryConnected } };
})();
