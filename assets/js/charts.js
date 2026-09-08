/* ============================================================
   charts.js — Tablero de datos (Chart.js 4)
   Paleta categórica validada; re-tematiza en claro/oscuro.
   ============================================================ */
(function () {
  "use strict";
  const CAT = ["--s1", "--s2", "--s3", "--s4", "--s5", "--s6", "--s7", "--s8"];
  const store = {};              // instancias Chart
  let DATA = null, FLEET = null;

  const T = () => ({
    ink: GLT.css("--text-1"), ink2: GLT.css("--text-2"), muted: GLT.css("--muted"),
    grid: GLT.css("--grid"), surface: GLT.css("--surface-1"), accent: GLT.css("--accent"),
    cat: CAT.map(GLT.css),
  });
  const font = { family: "system-ui, -apple-system, 'Segoe UI', sans-serif" };

  function baseOpts(t) {
    return {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: t.ink, titleColor: t.surface, bodyColor: t.surface,
          padding: 10, cornerRadius: 8, displayColors: true, boxPadding: 4,
          titleFont: { ...font, weight: "600" }, bodyFont: font,
        },
      },
      layout: { padding: { top: 6, right: 8 } },
    };
  }
  const axis = (t, opts = {}) => Object.assign({
    grid: { color: t.grid, drawTicks: false, borderColor: t.grid },
    border: { display: false },
    ticks: { color: t.muted, font: { ...font, size: 11 }, padding: 6 },
  }, opts);

  function legendRow(el, items) {
    el.innerHTML = items.map((i) =>
      `<span class="li"><i style="background:${i.color}"></i>${i.label}${i.val != null ? " · <b>" + i.val + "</b>" : ""}</span>`
    ).join("");
  }

  /* --------- construir todos --------- */
  function buildAll(data) {
    DATA = data; const t = T();

    // 1) Reparto modal (barra horizontal ordenada)
    const ms = (data.indicators.modal_share || []).slice().sort((a, b) => b.pct - a.pct);
    store.modal = new Chart(document.getElementById("chModal"), {
      type: "bar",
      data: { labels: ms.map((m) => m.mode),
        datasets: [{ data: ms.map((m) => m.pct), backgroundColor: ms.map((_, i) => t.cat[i % 8]),
          borderRadius: 4, borderSkipped: false, maxBarThickness: 26 }] },
      options: Object.assign(baseOpts(t), {
        indexAxis: "y",
        scales: { x: axis(t, { ticks: { color: t.muted, font: { ...font, size: 11 }, callback: (v) => v + "%" }, suggestedMax: Math.ceil(ms[0].pct / 10) * 10 }),
                  y: axis(t, { grid: { display: false }, ticks: { color: t.ink2, font: { ...font, size: 12 } } }) },
        plugins: Object.assign(baseOpts(t).plugins, {
          tooltip: Object.assign(baseOpts(t).plugins.tooltip, { callbacks: { label: (c) => " " + c.parsed.x + "% de los viajes" } }) }),
      }),
    });
    legendRow(document.getElementById("lgModal"),
      ms.map((m, i) => ({ label: m.mode, color: t.cat[i % 8], val: m.pct + "%" })));

    // 2) Pasajeros por sistema (barra vertical, color por modo)
    const rb = (data.indicators.ridership_by_mode || []).slice().sort((a, b) => b.daily - a.daily);
    store.rider = new Chart(document.getElementById("chRider"), {
      type: "bar",
      data: { labels: rb.map((r) => r.mode),
        datasets: [{ data: rb.map((r) => r.daily / 1000),
          backgroundColor: rb.map((r, i) => r.color || t.cat[i % 8]),
          borderRadius: 4, borderSkipped: false, maxBarThickness: 46 }] },
      options: Object.assign(baseOpts(t), {
        scales: { x: axis(t, { grid: { display: false }, ticks: { color: t.ink2, font: { ...font, size: 11 }, maxRotation: 30, minRotation: 0 } }),
                  y: axis(t, { ticks: { color: t.muted, font: { ...font, size: 11 }, callback: (v) => v + " mil" } }) },
        plugins: Object.assign(baseOpts(t).plugins, {
          tooltip: Object.assign(baseOpts(t).plugins.tooltip, { callbacks: { label: (c) => " " + GLT.fmt.int(c.parsed.y * 1000) + " pax/día" } }) }),
      }),
    });

    // 3) Curva de demanda (línea/área) + marcador de hora
    const dc = data.indicators.demand_curve || [];
    const linePts = dc.map((d) => ({ x: d.hour, y: d.index }));
    store.demand = new Chart(document.getElementById("chDemand"), {
      type: "line",
      data: { datasets: [
        { label: "Demanda", data: linePts, borderColor: t.accent, backgroundColor: t.accent + "22",
          borderWidth: 2, fill: true, tension: 0.4, pointRadius: 0, pointHoverRadius: 4 },
        { label: "Hora simulada", data: [], borderColor: t.accent, backgroundColor: t.surface,
          pointBackgroundColor: t.accent, pointBorderColor: t.surface, pointBorderWidth: 2,
          pointRadius: 6, showLine: false, order: -1 },
      ] },
      options: Object.assign(baseOpts(t), {
        scales: {
          x: axis(t, { type: "linear", min: 0, max: 23, ticks: { color: t.muted, font: { ...font, size: 11 }, stepSize: 3, callback: (v) => String(v).padStart(2, "0") + ":00" } }),
          y: axis(t, { min: 0, max: 1.05, ticks: { display: false }, grid: { color: t.grid } }),
        },
        plugins: Object.assign(baseOpts(t).plugins, {
          tooltip: { enabled: true, backgroundColor: t.ink, titleColor: t.surface, bodyColor: t.surface,
            padding: 10, cornerRadius: 8, filter: (i) => i.datasetIndex === 0,
            callbacks: { title: (c) => String(c[0].parsed.x).padStart(2, "0") + ":00",
              label: (c) => " Demanda relativa: " + Math.round(c.parsed.y * 100) + "%" } },
        }),
      }),
    });

    // 4) Crecimiento de la red (línea escalonada)
    const ng = data.indicators.network_growth || [];
    store.growth = new Chart(document.getElementById("chGrowth"), {
      type: "line",
      data: { labels: ng.map((g) => g.year),
        datasets: [{ data: ng.map((g) => g.km), borderColor: t.cat[2], backgroundColor: t.cat[2] + "20",
          borderWidth: 2.5, fill: true, tension: 0, stepped: true, pointRadius: 3, pointBackgroundColor: t.cat[2] }] },
      options: Object.assign(baseOpts(t), {
        scales: { x: axis(t, { grid: { display: false }, ticks: { color: t.ink2, font: { ...font, size: 11 } } }),
                  y: axis(t, { ticks: { color: t.muted, font: { ...font, size: 11 }, callback: (v) => v + " km" } }) },
        plugins: Object.assign(baseOpts(t).plugins, {
          tooltip: Object.assign(baseOpts(t).plugins.tooltip, { callbacks: { label: (c) => " " + c.parsed.y + " km en operación" } }) }),
      }),
    });

    // 5) Comparación de ciudades (barras agrupadas metro/BRT)
    const cp = (data.indicators.comparisons || []).slice().sort((a, b) => (b.metro_km + b.brt_km) - (a.metro_km + a.brt_km));
    store.compare = new Chart(document.getElementById("chCompare"), {
      type: "bar",
      data: { labels: cp.map((c) => c.city),
        datasets: [
          { label: "Metro (km)", data: cp.map((c) => c.metro_km), backgroundColor: t.cat[0], borderRadius: 4, borderSkipped: false, maxBarThickness: 34 },
          { label: "BRT (km)",   data: cp.map((c) => c.brt_km),   backgroundColor: t.cat[1], borderRadius: 4, borderSkipped: false, maxBarThickness: 34 },
        ] },
      options: Object.assign(baseOpts(t), {
        scales: { x: axis(t, { grid: { display: false }, ticks: { color: t.ink2, font: { ...font, size: 12 } } }),
                  y: axis(t, { ticks: { color: t.muted, font: { ...font, size: 11 }, callback: (v) => v + " km" } }) },
        plugins: Object.assign(baseOpts(t).plugins, {
          tooltip: Object.assign(baseOpts(t).plugins.tooltip, {
            callbacks: { afterBody: (items) => { const c = cp[items[0].dataIndex]; return "Población metro: " + c.pop_m + " M"; } } }) }),
      }),
    });
    legendRow(document.getElementById("lgCompare"),
      [{ label: "Metro (km)", color: t.cat[0] }, { label: "BRT (km)", color: t.cat[1] }]);

    buildFleet(data, t);
    buildSecurity(data, t);
  }

  /* --------- Parque automotor --------- */
  function buildFleet(data, t) {
    const F = data.fleet, cv = document.getElementById("chFleet"); if (!F || !cv) return;
    const hist = (F.history || []).map((h) => ({ x: h.year, y: h.vehicles }));
    const p = F.projection || {}, by = p.base_year, bv = p.base_vehicles, g = (p.annual_growth_pct || 0) / 100;
    const proj = []; for (let k = 0; k <= 20; k++) proj.push({ x: by + k, y: Math.round(bv * Math.pow(1 + g, k)) });
    FLEET = { by, bv, g: p.annual_growth_pct || 0 };
    const yFmt = (v) => GLT.fmt.short(v);
    store.fleet = new Chart(cv, {
      type: "line",
      data: { datasets: [
        { label: "Histórico", data: hist, borderColor: t.cat[0], backgroundColor: t.cat[0] + "22", borderWidth: 2, fill: true, tension: 0.3, pointRadius: 2 },
        { label: "Proyección", data: proj, borderColor: t.cat[1], borderDash: [6, 5], borderWidth: 2, fill: false, tension: 0.2, pointRadius: 0 },
        { label: "Meta", data: [], borderColor: t.cat[1], backgroundColor: t.surface, pointBackgroundColor: t.cat[1], pointBorderColor: t.surface, pointBorderWidth: 2, pointRadius: 6, showLine: false, order: -1 },
      ] },
      options: Object.assign(baseOpts(t), {
        scales: { x: axis(t, { type: "linear", ticks: { color: t.muted, font: { ...font, size: 11 }, stepSize: 3, callback: (v) => v } }),
                  y: axis(t, { ticks: { color: t.muted, font: { ...font, size: 11 }, callback: yFmt } }) },
        plugins: Object.assign(baseOpts(t).plugins, {
          tooltip: Object.assign(baseOpts(t).plugins.tooltip, { callbacks: { title: (c) => "Año " + c[0].parsed.x, label: (c) => " " + GLT.fmt.int(c.parsed.y) + " vehículos" } }) }),
      }),
    });
    const comp = F.composition || [], cc = document.getElementById("chFleetComp");
    if (comp.length && cc) {
      store.fleetComp = new Chart(cc, {
        type: "doughnut",
        data: { labels: comp.map((c) => c.type), datasets: [{ data: comp.map((c) => c.pct), backgroundColor: comp.map((_, i) => t.cat[i % 8]), borderColor: t.surface, borderWidth: 2 }] },
        options: Object.assign(baseOpts(t), { cutout: "60%", plugins: Object.assign(baseOpts(t).plugins, {
          tooltip: Object.assign(baseOpts(t).plugins.tooltip, { callbacks: { label: (c) => " " + c.label + ": " + c.parsed + "%" } }) }) }),
      });
      legendRow(document.getElementById("lgFleetComp"), comp.map((c, i) => ({ label: c.type, color: t.cat[i % 8], val: c.pct + "%" })));
    }
  }
  function fleetProject(off) {
    if (!FLEET || !store.fleet) return null;
    const year = FLEET.by + off, veh = Math.round(FLEET.bv * Math.pow(1 + FLEET.g / 100, off));
    store.fleet.data.datasets[2].data = [{ x: year, y: veh }]; store.fleet.update("none");
    return { year, veh, pct: Math.round((veh / FLEET.bv - 1) * 100) };
  }

  /* --------- Seguridad --------- */
  function buildSecurity(data, t) {
    const S = data.security; if (!S) return;
    const yr = S.yearly || [];
    const mk = (id, key, color, unitLabel) => {
      const cv = document.getElementById(id); if (!cv) return;
      store[id] = new Chart(cv, {
        type: "bar",
        data: { labels: yr.map((y) => y.year), datasets: [{ data: yr.map((y) => y[key]), backgroundColor: color, borderRadius: 4, borderSkipped: false, maxBarThickness: 46 }] },
        options: Object.assign(baseOpts(t), {
          scales: { x: axis(t, { grid: { display: false }, ticks: { color: t.ink2, font: { ...font, size: 11 } } }),
                    y: axis(t, { ticks: { color: t.muted, font: { ...font, size: 11 }, callback: (v) => GLT.fmt.short(v) } }) },
          plugins: Object.assign(baseOpts(t).plugins, {
            tooltip: Object.assign(baseOpts(t).plugins.tooltip, { callbacks: { label: (c) => " " + GLT.fmt.int(c.parsed.y) + " " + unitLabel } }) }),
        }),
      });
    };
    mk("chSecKill", "killings", "#d03b3b", "transportistas");
    mk("chSecExt", "extortion_reports", t.cat[3], "denuncias");
  }

  /* --------- marcador de hora en la curva de demanda --------- */
  function setHour(tmin) {
    const d = store.demand; if (!d || !DATA) return;
    const dc = DATA.indicators.demand_curve || [];
    const hf = (tmin / 60) % 24, i = Math.floor(hf), j = (i + 1) % 24, f = hf - i;
    const a = dc[i] ? dc[i].index : 0, b = dc[j] ? dc[j].index : 0;
    d.data.datasets[1].data = [{ x: hf, y: a + (b - a) * f }];
    d.update("none");
  }

  function retheme() { if (!DATA) return; Object.values(store).forEach((c) => c.destroy()); buildAll(DATA); }

  window.GLT = window.GLT || {};
  window.GLT.charts = { buildAll, setHour, retheme, fleetProject };
})();
