/* ============================================================
   traffic.js — Arterias principales con congestión por hora
   Colorea las vías según la demanda horaria y anima el flujo de autos.
   ============================================================ */
(function () {
  "use strict";
  const FREE = { expressway: 70, arterial: 40 };          // km/h a flujo libre
  const COL  = { free: "#2f9e6e", mod: "#e0a300", heavy: "#e34948" };
  const MAX_CARS = 520;
  const T = { lines: [], layer: null, twin: null, visible: true, bucket: -1, level: null };
  const hav = (a, b) => GLT.haversine(a, b);
  const rnd = (s) => { const x = Math.sin(s) * 10000; return x - Math.floor(x); };
  const speedFactor = (d) => 1 - 0.55 * d;               // d = índice de demanda 0..1

  function atDist(l, d) {
    d = Math.max(0, Math.min(l.total, d));
    let i = 1; while (i < l.cum.length && l.cum[i] < d) i++;
    if (i >= l.ll.length) return l.ll[l.ll.length - 1];
    const a = l.ll[i-1], b = l.ll[i], seg = l.cum[i] - l.cum[i-1] || 1, f = (d - l.cum[i-1]) / seg;
    return [a[0] + (b[0]-a[0]) * f, a[1] + (b[1]-a[1]) * f];
  }

  function init(twin, data) {
    const fc = data.arteries; if (!fc || !fc.features || !fc.features.length) return false;
    const L = window.L; T.twin = twin; T.layer = L.layerGroup();
    fc.features.forEach((f, i) => {
      const ll = f.geometry.coordinates.map((c) => [c[1], c[0]]);
      const cum = [0]; let tot = 0;
      for (let k = 1; k < ll.length; k++) { tot += hav(ll[k-1], ll[k]); cum.push(tot); }
      const cls = f.properties.class === "expressway" ? "expressway" : "arterial";
      const poly = L.polyline(ll, { color: COL.free, weight: cls === "expressway" ? 3.4 : 2.4, opacity: 0.5, lineCap: "round", lineJoin: "round", interactive: true });
      poly.bindTooltip(`<b>${f.properties.name}</b><span class="tt-traf"></span>`, { sticky: true, className: "twin-tt" });
      poly.addTo(T.layer);
      T.lines.push({ id: f.properties.id, name: f.properties.name, cls, ll, cum, total: tot, poly, seed: (i+1) * 7919, cars: [] });
    });
    T.layer.addTo(twin.map);
    // reparto de autos proporcional a la longitud
    const totKm = T.lines.reduce((a, l) => a + l.total, 0) / 1000 || 1;
    T.lines.forEach((l) => { const n = Math.max(4, Math.round(MAX_CARS * (l.total/1000) / totKm));
      for (let i = 0; i < n; i++) l.cars.push({ off: rnd(l.seed + i) * l.total, dir: i % 2 ? 1 : -1 }); });
    twin.addOverlay(drawCars);
    recolor(twin.t, true);
    twin.onHourChange((t) => recolor(t, false));
    return true;
  }

  function recolor(t, force) {
    const b = Math.floor(t / 10); if (!force && b === T.bucket) return; T.bucket = b;
    const d = T.twin.demandIndex(t), sf = speedFactor(d);
    const col = sf > 0.75 ? COL.free : sf > 0.55 ? COL.mod : COL.heavy;
    const label = sf > 0.75 ? "fluido" : sf > 0.55 ? "lento" : "congestionado";
    T.level = { d, sf, col, label };
    T.lines.forEach((l) => {
      l.poly.setStyle({ color: col, opacity: 0.32 + 0.4 * d });
      const kmh = Math.round(FREE[l.cls] * sf);
      l.poly.setTooltipContent(`<b>${l.name}</b><span>${label} · ~${kmh} km/h</span>`);
    });
  }

  function drawCars(c, W, H, t, map) {
    if (!T.visible) return;
    const d = T.twin.demandIndex(t), sf = speedFactor(d), density = 0.3 + 0.7 * d;
    c.fillStyle = T.twin.isDark() ? "rgba(232,234,230,0.82)" : "rgba(40,40,40,0.7)";
    T.lines.forEach((l) => {
      const v = FREE[l.cls] * sf * 1000 / 60;                 // m por minuto simulado
      const n = Math.round(l.cars.length * density), r = l.cls === "expressway" ? 1.9 : 1.55;
      for (let i = 0; i < n; i++) {
        const car = l.cars[i]; let pos = (car.off + car.dir * v * t) % l.total; if (pos < 0) pos += l.total;
        const pt = map.latLngToContainerPoint(atDist(l, pos));
        if (pt.x < -4 || pt.y < -4 || pt.x > W + 4 || pt.y > H + 4) continue;
        c.beginPath(); c.arc(pt.x, pt.y, r, 0, 6.2832); c.fill();
      }
    });
  }

  function setVisible(v) {
    T.visible = v;
    if (!T.twin) return;
    if (v) T.layer.addTo(T.twin.map); else T.twin.map.removeLayer(T.layer);
    T.twin.draw();
  }

  window.GLT = window.GLT || {};
  window.GLT.traffic = { init, setVisible, speedFactor, FREE, level: () => T.level, isVisible: () => T.visible };
})();
