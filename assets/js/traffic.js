/* ============================================================
   traffic.js — Arterias con congestión por hora + flujo de autos y
   combis, y red de ciclovías con ciclistas.
   ============================================================ */
(function () {
  "use strict";
  const FREE = { expressway: 70, arterial: 40 };          // km/h a flujo libre
  const COL  = { free: "#2f9e6e", mod: "#e0a300", heavy: "#e34948" };
  const MAX_CARS = 520, MAX_BIKES = 170, BIKE_KMH = 15;
  const T = { lines: [], layer: null, cyc: [], cycLayer: null, twin: null, visible: true, cycVisible: true, bucket: -1, level: null };
  const hav = (a, b) => GLT.haversine(a, b);
  const rnd = (s) => { const x = Math.sin(s) * 10000; return x - Math.floor(x); };
  const speedFactor = (d) => 1 - 0.55 * d;

  function prep(f, i) {
    const ll = f.geometry.coordinates.map((c) => [c[1], c[0]]);
    const cum = [0]; let tot = 0;
    for (let k = 1; k < ll.length; k++) { tot += hav(ll[k-1], ll[k]); cum.push(tot); }
    return { id: f.properties.id, name: f.properties.name, ll, cum, total: tot, seed: (i+1) * 7919, cars: [] };
  }
  function atDist(l, d) {
    d = Math.max(0, Math.min(l.total, d));
    let i = 1; while (i < l.cum.length && l.cum[i] < d) i++;
    if (i >= l.ll.length) return l.ll[l.ll.length - 1];
    const a = l.ll[i-1], b = l.ll[i], seg = l.cum[i] - l.cum[i-1] || 1, f = (d - l.cum[i-1]) / seg;
    return [a[0] + (b[0]-a[0]) * f, a[1] + (b[1]-a[1]) * f];
  }

  function init(twin, data) {
    const L = window.L; T.twin = twin;
    const fc = data.arteries; if (!fc || !fc.features || !fc.features.length) return false;
    T.layer = L.layerGroup();
    fc.features.forEach((f, i) => {
      const l = prep(f, i); l.cls = f.properties.class === "expressway" ? "expressway" : "arterial";
      l.poly = L.polyline(l.ll, { color: COL.free, weight: l.cls === "expressway" ? 3.4 : 2.4, opacity: 0.5, lineCap: "round", lineJoin: "round" })
        .bindTooltip(`<b>${l.name}</b>`, { sticky: true, className: "twin-tt" }).addTo(T.layer);
      T.lines.push(l);
    });
    T.layer.addTo(twin.map);
    const totKm = T.lines.reduce((a, l) => a + l.total, 0) / 1000 || 1;
    T.lines.forEach((l) => { const n = Math.max(4, Math.round(MAX_CARS * (l.total/1000) / totKm));
      for (let i = 0; i < n; i++) l.cars.push({ off: rnd(l.seed + i) * l.total, dir: i % 2 ? 1 : -1, combi: (i % 4 === 3) }); });
    // ciclovías
    const cw = data.cycleways;
    if (cw && cw.features && cw.features.length) {
      T.cycLayer = L.layerGroup();
      cw.features.forEach((f, i) => {
        const l = prep(f, i + 5000); l.type = f.properties.type;
        l.poly = L.polyline(l.ll, { color: "#43a047", weight: l.type === "segregada" ? 2.4 : 1.8, opacity: 0.75, dashArray: l.type === "segregada" ? null : "4 5", lineCap: "round" })
          .bindTooltip(`<b>${l.name}</b><span>ciclovía ${l.type}</span>`, { sticky: true, className: "twin-tt" }).addTo(T.cycLayer);
        T.cyc.push(l);
      });
      T.cycLayer.addTo(twin.map);
      const cycKm = T.cyc.reduce((a, l) => a + l.total, 0) / 1000 || 1;
      T.cyc.forEach((l) => { const n = Math.max(1, Math.round(MAX_BIKES * (l.total/1000) / cycKm));
        l.cars = []; for (let i = 0; i < n; i++) l.cars.push({ off: rnd(l.seed + i) * l.total, dir: i % 2 ? 1 : -1 }); });
    }
    twin.addOverlay(draw);
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
      l.poly.setTooltipContent(`<b>${l.name}</b><span>${label} · ~${Math.round(FREE[l.cls] * sf)} km/h</span>`);
    });
  }

  function draw(c, W, H, t, map) {
    const d = T.twin.demandIndex(t), sf = speedFactor(d), dark = T.twin.isDark();
    if (T.visible) {
      const density = 0.3 + 0.7 * d, carCol = dark ? "rgba(232,234,230,0.82)" : "rgba(40,40,40,0.7)", combiCol = "#f2a900";
      T.lines.forEach((l) => {
        const v = FREE[l.cls] * sf * 1000 / 60, n = Math.round(l.cars.length * density);
        for (let i = 0; i < n; i++) {
          const car = l.cars[i]; let pos = (car.off + car.dir * v * (car.combi ? 0.85 : 1) * t) % l.total; if (pos < 0) pos += l.total;
          const pt = map.latLngToContainerPoint(atDist(l, pos));
          if (pt.x < -4 || pt.y < -4 || pt.x > W + 4 || pt.y > H + 4) continue;
          c.fillStyle = car.combi ? combiCol : carCol;
          c.beginPath(); c.arc(pt.x, pt.y, car.combi ? 2.3 : (l.cls === "expressway" ? 1.9 : 1.55), 0, 6.2832); c.fill();
        }
      });
    }
    if (T.cycVisible && T.cyc.length) {
      const day = ((t % 1440) + 1440) % 1440, active = day >= 5*60 && day <= 21*60 ? (0.4 + 0.6 * d) : 0.08;
      c.fillStyle = "#43a047";
      T.cyc.forEach((l) => {
        const v = BIKE_KMH * 1000 / 60, n = Math.round(l.cars.length * active);
        for (let i = 0; i < n; i++) {
          const bk = l.cars[i]; let pos = (bk.off + bk.dir * v * t) % l.total; if (pos < 0) pos += l.total;
          const pt = map.latLngToContainerPoint(atDist(l, pos));
          if (pt.x < -4 || pt.y < -4 || pt.x > W + 4 || pt.y > H + 4) continue;
          c.beginPath(); c.arc(pt.x, pt.y, 1.7, 0, 6.2832); c.fill();
        }
      });
    }
  }

  function setVisible(v) { T.visible = v; if (!T.twin || !T.layer) return; if (v) T.layer.addTo(T.twin.map); else T.twin.map.removeLayer(T.layer); T.twin.draw(); }
  function setCyclewaysVisible(v) { T.cycVisible = v; if (!T.twin || !T.cycLayer) return; if (v) T.cycLayer.addTo(T.twin.map); else T.twin.map.removeLayer(T.cycLayer); T.twin.draw(); }

  window.GLT = window.GLT || {};
  window.GLT.traffic = { init, setVisible, setCyclewaysVisible, speedFactor, FREE, level: () => T.level, isVisible: () => T.visible, hasCycleways: () => T.cyc.length > 0, cyclewaysKm: () => T.cyc.reduce((a, l) => a + l.total, 0) / 1000 };
})();
