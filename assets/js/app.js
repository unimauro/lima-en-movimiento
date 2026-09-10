/* ============================================================
   app.js — orquestador: carga, UI, controles, estado
   ============================================================ */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const hhmm = (t) => { t = ((t % 1440) + 1440) % 1440; const h = Math.floor(t / 60), m = Math.floor(t % 60);
    return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0"); };
  const demandLabel = (d) => d > 0.72 ? "Hora punta" : d > 0.42 ? "Demanda media" : "Valle";

  /* ---------- tema (oscuro por defecto) ---------- */
  function themeLabel() {
    const cur = document.documentElement.getAttribute("data-theme");
    const isDark = cur ? cur === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    const l = $("themeLbl"); if (l) l.textContent = isDark ? "Modo claro" : "Modo oscuro";
  }
  function initTheme() {
    const saved = localStorage.getItem("glt-theme");
    document.documentElement.setAttribute("data-theme", saved || "dark");
    themeLabel();
    $("themeBtn").addEventListener("click", () => {
      const cur = document.documentElement.getAttribute("data-theme");
      const isDark = cur ? cur === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
      const next = isDark ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem("glt-theme", next);
      document.querySelector('meta[name=theme-color]').setAttribute("content", next === "dark" ? "#0d0d0d" : "#f4f5f3");
      themeLabel();
      if (window.__twin) window.__twin.setTheme();
      if (window.__secMapRetile) window.__secMapRetile();
      if (GLT.charts) GLT.charts.retheme();
    });
  }

  /* ---------- consentimiento de cookies (Consent Mode) ---------- */
  function initConsent() {
    const b = $("cookieBanner"); if (!b) return;
    let choice = null; try { choice = localStorage.getItem("glt-consent"); } catch (e) {}
    if (!choice) b.hidden = false;
    const set = (v) => {
      try { localStorage.setItem("glt-consent", v); } catch (e) {}
      if (window.gtag) window.gtag("consent", "update", { analytics_storage: v === "granted" ? "granted" : "denied" });
      b.hidden = true;
    };
    const acc = $("ckAccept"), rej = $("ckReject");
    if (acc) acc.addEventListener("click", () => { set("granted"); GLT.track("consent_accept"); });
    if (rej) rej.addEventListener("click", () => set("denied"));
  }

  /* ---------- sidebar / nav / apoyo ---------- */
  function initUI() {
    const sb = $("sidebar"), scrim = $("scrim");
    const openSb = (v) => { sb.classList.toggle("open", v); scrim.classList.toggle("show", v); };
    const hb = $("hambBtn"); if (hb) hb.addEventListener("click", () => openSb(!sb.classList.contains("open")));
    if (scrim) scrim.addEventListener("click", () => openSb(false));

    const links = Array.from(document.querySelectorAll(".side-nav a"));
    const map = {}; links.forEach((a) => { const id = a.getAttribute("href").slice(1); if ($(id)) map[id] = a; });
    links.forEach((a) => a.addEventListener("click", () => openSb(false)));
    try {
      const obs = new IntersectionObserver((ents) => ents.forEach((e) => {
        if (e.isIntersecting && map[e.target.id]) { links.forEach((l) => l.classList.remove("active")); map[e.target.id].classList.add("active"); }
      }), { rootMargin: "-45% 0px -50% 0px" });
      Object.keys(map).forEach((id) => obs.observe($(id)));
    } catch (e) {}

    document.querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(b.dataset.copy); const t = b.textContent; b.textContent = "¡Copiado!"; setTimeout(() => (b.textContent = t), 1500); GLT.track("yape_copy"); } catch (e) {}
    }));
    const share = $("shareBtn");
    if (share) share.addEventListener("click", async () => {
      GLT.track("share_click");
      const d = { title: "Lima en Movimiento", text: "Gemelo digital del transporte urbano de Lima", url: location.href };
      try { if (navigator.share) await navigator.share(d); else { await navigator.clipboard.writeText(location.href); share.textContent = "Enlace copiado"; setTimeout(() => (share.textContent = "Compartir"), 1500); } } catch (e) {}
    });
    const coffee = $("coffeeCard");
    if (coffee) { coffee.href = window.__COFFEE_URL__ || "https://www.buymeacoffee.com/";
      coffee.addEventListener("click", () => GLT.track("coffee_click")); }
    document.querySelectorAll('.side-mini, a[href*="github.com/unimauro/lima-en-movimiento"]').forEach((a) =>
      a.addEventListener("click", () => GLT.track("github_click")));
  }

  /* ---------- KPIs ---------- */
  function renderKPIs(ind, net) {
    const el = $("kpiStrip");
    let kpis = (ind.kpis || []).slice(0, 8);
    if (!kpis.length) {  // fallback calculado
      const ops = (net.lines || []).filter((l) => l.status === "operational");
      const km = ops.reduce((a, l) => a + (l.length_km || 0), 0);
      const est = (net.lines || []).reduce((a, l) => a + (l.stations_count || (l.stations || []).length), 0);
      kpis = [{ label: "Red masiva (km)", value: Math.round(km), unit: "km" },
        { label: "Estaciones", value: est, unit: "" }];
    }
    el.innerHTML = kpis.map(kpiCard).join("");
  }

  function kpiCard(k) {
    const n = Number(k.value), big = n >= 100000;
    const v = big ? GLT.fmt.short(n) : Number.isInteger(n) ? GLT.fmt.int(n) : String(k.value).replace(".", ",");
    const u = k.unit && !big ? ` <small>${k.unit}</small>` : "";
    return `<div class="kpi"><div class="v tnum">${v}${u}</div><div class="k">${k.label || ""}</div>${k.note ? `<div class="n">${k.note}</div>` : ""}</div>`;
  }
  function hideNav(sel) { const a = document.querySelector(`.side-nav a[href="${sel}"]`); if (a) a.style.display = "none"; }

  /* ---------- parque automotor ---------- */
  function unhideNew(data) {
    if (data.fleet) $("parque").hidden = false; else hideNav("#parque");
    if (data.security) $("seguridad").hidden = false; else hideNav("#seguridad");
  }
  function renderFleet(data) {
    const F = data.fleet; if (!F) return;
    if (F.scope) $("fleetSub").textContent = `El parque vehicular de ${F.scope} crece más rápido que la red masiva. Proyecta el crecimiento y mira a dónde va la ciudad si nada cambia.`;
    $("fleetKpis").innerHTML = (F.kpis || []).slice(0, 4).map(kpiCard).join("");
    const sl = $("fleetYear"), lbl = $("fleetYearLbl"), out = $("fleetProj");
    if (F.projection) sl.max = 20;
    const upd = () => { const r = GLT.charts.fleetProject(+sl.value); if (!r) return;
      lbl.textContent = r.year;
      out.innerHTML = `En <b>${r.year}</b>: ~<b class="tnum">${GLT.fmt.int(r.veh)}</b> vehículos <span class="up">(+${r.pct}% vs ${F.projection.base_year})</span>`; };
    sl.addEventListener("input", upd); upd();
    const note = $("fleetNote");
    if (note) note.textContent = F.notes_scope || (F.projection && F.projection.note) || "";
    const cg = F.congestion, ts = $("trafficStat");
    if (cg && cg.hours_lost_year && ts) {
      const src = (F.sources || [])[cg.source_ref];
      const link = src && src.url ? ` <a href="${src.url}" target="_blank" rel="noopener">${src.label || "Fuente"} ↗</a>` : "";
      ts.hidden = false;
      ts.innerHTML = `<div class="ts-big tnum">${cg.hours_lost_year}<small>h</small></div>
        <div class="ts-txt"><b>al año perdidas en el tráfico</b><span>${cg.note || ""}${link}</span></div>`;
    }
  }

  /* ---------- seguridad ---------- */
  function renderSecurity(data) {
    const S = data.security; if (!S) return;
    if (S.intro) $("secIntro").innerHTML = String(S.intro).split(/\n\n+/).map((p) => `<p>${p}</p>`).join("");
    $("secKpis").innerHTML = (S.kpis || []).slice(0, 4).map(kpiCard).join("");
    if (S.modes_note) $("secModes").textContent = S.modes_note;
    const src = (S.sources || []).map((s) => s.url ? `<a href="${s.url}" target="_blank" rel="noopener">${s.label}</a>` : s.label).join(" · ");
    $("secMethod").innerHTML = `<h3 style="font-size:14px;margin-bottom:6px">Metodología y fuentes</h3>
      <p style="margin:0 0 8px;color:var(--text-2);font-size:13px">${S.methodology || ""}</p>
      <p style="margin:0;font-size:12px;color:var(--muted)">${src}</p>`;
    buildSecMap(S);
  }
  function buildSecMap(S) {
    const L = window.L, el = $("secMap"); if (!L || !el) return;
    const dark = () => { const c = document.documentElement.getAttribute("data-theme"); return c ? c === "dark" : matchMedia("(prefers-color-scheme: dark)").matches; };
    const map = L.map(el, { zoomControl: true, attributionControl: true, scrollWheelZoom: false });
    map.attributionControl.setPrefix(false);
    let tiles; const setT = () => { if (tiles) map.removeLayer(tiles);
      const u = dark() ? "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}" : "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}";
      tiles = L.tileLayer(u, { maxZoom: 19, maxNativeZoom: 16, attribution: 'Tiles &copy; Esri' }).addTo(map); };
    setT();
    const R = { alta: 17, "media-alta": 14, media: 12, baja: 8 }, b = [];
    (S.affected_zones || []).forEach((z) => {
      L.circleMarker([z.lat, z.lng], { radius: R[z.severity] || 10, color: "#d03b3b", weight: 1.5, fillColor: "#d03b3b", fillOpacity: 0.32 })
        .bindTooltip(`<b>${z.name}</b>${z.note ? `<span>${z.note}</span>` : ""}`, { className: "twin-tt", direction: "top" }).addTo(map);
      b.push([z.lat, z.lng]);
    });
    if (b.length) map.fitBounds(b, { padding: [30, 30] });
    setTimeout(() => map.invalidateSize(), 90);
    window.__secMapRetile = setT;
  }

  /* ---------- buscador de estaciones ---------- */
  function initSearch(twin) {
    const dl = $("stationList"), inp = $("stSearch"); if (!dl || !inp) return;
    dl.innerHTML = twin.stationNames().map((n) => `<option value="${n.replace(/"/g, "&quot;")}"></option>`).join("");
    const go = () => { const v = inp.value.trim(); if (v && twin.flyToStation(v)) GLT.track("station_search", { q: v }); };
    inp.addEventListener("change", go);
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } });
  }

  /* ---------- fotos (Wikimedia Commons, con crédito) ---------- */
  async function renderPhotos() {
    let credits = [];
    try { const r = await fetch("assets/img/credits.json", { cache: "no-cache" }); if (r.ok) credits = await r.json(); } catch (e) {}
    if (!credits.length) return;
    const strip = $("photoStrip"), sec = $("fotos");
    if (strip && sec) {
      strip.innerHTML = credits.slice(0, 4).map((c) =>
        `<figure><img src="assets/img/${c.file}" alt="${(c.alt || "").replace(/"/g, "&quot;")}" loading="lazy">
          <figcaption>${c.alt || ""}<small>Foto: ${c.author || "—"} (${c.license || ""})</small></figcaption></figure>`).join("");
      sec.hidden = false;
    }
    // fondos tenues en secciones donde la foto aporta contexto
    const bg = (id, file) => { const el = $(id); if (!el || !credits.some((c) => c.file === file)) return;
      el.classList.add("has-photo"); el.style.setProperty("--photo", `url(assets/img/${file})`); };
    bg("parque", "lima-panoramica.jpg"); bg("seguridad", "combi.jpg");
    // créditos en FAQ · Fuentes
    const el = $("faqSources");
    if (el) { const lis = credits.map((c) => `<li><a href="${c.source}" target="_blank" rel="noopener">${c.title || c.file}</a> — ${c.author || ""}, ${c.license || ""}</li>`).join("");
      el.insertAdjacentHTML("beforeend", `<div class="src-group" id="src-fotos"><h4>Fotografías</h4><ul>${lis}</ul></div>`); }
  }

  /* ---------- FAQ · fuentes por tema ---------- */
  function renderFaqSources(data) {
    const el = $("faqSources"); if (!el) return;
    const groups = [
      { key: "mapa", title: "Mapa, líneas y estaciones", items: [{ label: "OpenStreetMap (colaboradores) — vía Overpass API", url: "https://www.openstreetmap.org/copyright" }] },
      { key: "indicadores", title: "Indicadores de movilidad", items: (data.indicators && data.indicators.sources) || [] },
      { key: "parque", title: "Parque automotor y tráfico", items: (data.fleet && data.fleet.sources) || [] },
      { key: "seguridad", title: "Seguridad en el transporte", items: (data.security && data.security.sources) || [] },
      { key: "fichas", title: "Fichas por línea", items: (data.linesDetail && data.linesDetail.sources) || [] },
      { key: "contexto", title: "Contexto e historia", items: (data.context && data.context.sources) || [] },
    ];
    el.innerHTML = groups.filter((g) => g.items.length).map((g) => {
      const seen = new Set();
      const lis = g.items.filter((s) => s && s.label && !seen.has(s.label) && seen.add(s.label))
        .map((s) => `<li>${s.url ? `<a href="${s.url}" target="_blank" rel="noopener">${s.label}</a>` : s.label}</li>`).join("");
      return `<div class="src-group" id="src-${g.key}"><h4>${g.title}</h4><ul>${lis}</ul></div>`;
    }).join("");
  }

  /* enlaza cada gráfico/tablero con su grupo de fuentes en el FAQ */
  function attachSources() {
    const chartMap = { chModal: "indicadores", chRider: "indicadores", chDemand: "indicadores", chGrowth: "indicadores", chCompare: "indicadores",
      chFleet: "parque", chFleetComp: "parque", chSecExt: "seguridad", secMap: "seguridad" };
    Object.keys(chartMap).forEach((cid) => {
      const cv = $(cid); if (!cv) return;
      const card = cv.closest(".chartcard"); if (!card || card.querySelector(".chart-src")) return;
      const d = document.createElement("div"); d.className = "chart-src";
      d.innerHTML = `<a href="#src-${chartMap[cid]}">Fuente de los datos ↗</a>`;
      card.appendChild(d);
    });
    [["kpiStrip", "indicadores"], ["fleetKpis", "parque"], ["secKpis", "seguridad"]].forEach(([id, key]) => {
      const el = $(id); if (!el) return;
      const nx = el.nextElementSibling;
      if (nx && nx.classList && nx.classList.contains("kpi-src")) return;
      const d = document.createElement("div"); d.className = "chart-src kpi-src";
      d.innerHTML = `<a href="#src-${key}">Fuente de los datos ↗</a>`;
      el.parentNode.insertBefore(d, el.nextSibling);
    });
  }

  /* ---------- contexto ---------- */
  function renderContext(ctx) {
    if (!ctx) return;
    if (ctx.intro) $("ctxIntro").innerHTML = String(ctx.intro).split(/\n\n+/).map((p) => `<p>${p}</p>`).join("");
    if (ctx.authority) $("ctxAuthority").innerHTML =
      `<h3 style="font-size:15px;margin-bottom:6px">${ctx.authority.name || "Autoridad"}</h3><p style="margin:0;color:var(--text-2);font-size:14px">${ctx.authority.text || ""}</p>`;
    $("ctxTimeline").innerHTML = (ctx.timeline || []).map((i) =>
      `<div class="tl-item"><div class="y tnum">${i.year}</div><h4>${i.title}</h4><p>${i.text}</p></div>`).join("");
    const cards = (arr, eta) => (arr || []).map((c) =>
      `<div class="mini">${eta && c.eta ? `<span class="eta">${c.eta}</span>` : ""}<h4>${c.title}</h4><p>${c.text}</p></div>`).join("");
    $("ctxChallenges").innerHTML = cards(ctx.challenges);
    $("ctxFuture").innerHTML = cards(ctx.future, true);
    if (ctx.methodology) $("ctxMethod").textContent = ctx.methodology;
    const src = [].concat(ctx.sources || [], (GLT.data.indicators && GLT.data.indicators.sources) || []);
    const seen = new Set();
    $("ctxSources").innerHTML = src.filter((s) => s && s.label && !seen.has(s.label) && seen.add(s.label))
      .map((s) => `<li>${s.url ? `<a href="${s.url}" target="_blank" rel="noopener">${s.label}</a>` : s.label}</li>`).join("");
  }

  /* ---------- leyenda del mapa ---------- */
  function renderLegend(net, twin) {
    const el = $("mapLegend");
    el.innerHTML = (net.lines || []).map((l) =>
      `<span class="leg" data-id="${l.id}"><span class="sw" style="background:${l.color}"></span>${l.short || l.name}${l.status !== "operational" ? " ·" + (l.status === "construction" ? "obra" : "plan") : ""}</span>`).join("");
    el.querySelectorAll(".leg").forEach((n) => n.addEventListener("click", () => {
      n.classList.toggle("off"); twin.toggleLine(n.dataset.id); syncStats();
    }));
  }

  /* ---------- estado en vivo ---------- */
  let twin, playing = false;
  function syncStats() {
    const t = twin.t, s = twin.liveStats(t), d = twin.demandIndex(t);
    $("ovVeh").textContent = s.veh; $("stVeh").textContent = s.veh;
    $("ovFreq").textContent = demandLabel(d);
    $("ovClock").textContent = hhmm(t); $("ovPeak").textContent = demandLabel(d);
    $("stPax").textContent = GLT.fmt.short(s.pax);
    const ob = $("stOnboard"), oc = $("stOcc");
    if (ob) ob.textContent = GLT.fmt.short(s.onboard);
    if (oc) oc.textContent = Math.round(s.occ * 100) + "%";
    $("hourVal").textContent = hhmm(t);
    $("hour").value = Math.floor(t);
  }

  /* ---------- pestañas del panel + capa de tráfico ---------- */
  function initTabs() {
    const tabs = Array.from(document.querySelectorAll(".tab"));
    tabs.forEach((b) => b.addEventListener("click", () => {
      tabs.forEach((x) => { const on = x === b; x.classList.toggle("active", on); x.setAttribute("aria-selected", on); });
      document.querySelectorAll(".tabpane").forEach((p) => { p.hidden = p.id !== "tab-" + b.dataset.tab; });
      GLT.track("tab_" + b.dataset.tab);
    }));
  }
  function addTrafficLegend() {
    const el = $("mapLegend"); if (!el) return;
    const n = document.createElement("span"); n.className = "leg"; n.dataset.id = "_traffic";
    n.innerHTML = '<span class="sw traf"></span>Tráfico en arterias';
    n.addEventListener("click", () => { n.classList.toggle("off"); GLT.traffic.setVisible(!n.classList.contains("off")); });
    el.appendChild(n);
  }

  const ICON_PLAY = '<path d="M8 5v14l11-7z"/>', ICON_PAUSE = '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>';
  function setPlaying(v) {
    playing = v;
    $("playIcon").innerHTML = playing ? ICON_PAUSE : ICON_PLAY;
    $("playBtn").setAttribute("aria-label", playing ? "Pausar" : "Reproducir");
    if (playing) twin.play(); else twin.pause();
  }
  function wireControls() {
    $("playBtn").addEventListener("click", () => {
      setPlaying(!playing);
      GLT.track(playing ? "map_play" : "map_pause");
    });
    $("speed").addEventListener("input", (e) => {
      const v = +e.target.value; $("speedVal").textContent = v; twin.setSpeed(v);
    });
    $("hour").addEventListener("input", (e) => {
      twin.setHour(+e.target.value); GLT.charts.setHour(twin.t); syncStats();
    });
    twin.onTick = (t) => { syncStats(); GLT.charts.setHour(t); };
  }

  /* ---------- arranque ---------- */
  async function boot() {
    initTheme();
    initUI();
    initConsent();
    if (GLT.chat) GLT.chat.init();
    $("year").textContent = new Date().getFullYear();
    try {
      const data = await GLT.load();
      renderKPIs(data.indicators, data.network);
      renderContext(data.context);
      unhideNew(data);
      GLT.charts.buildAll(data);
      renderFleet(data);
      renderSecurity(data);
      renderFaqSources(data);
      attachSources();
      renderPhotos();

      twin = new GLT.Twin($("twinMap"), data);
      window.__twin = twin;
      renderLegend(data.network, twin);
      initSearch(twin);
      const fit = $("mapFit"); if (fit) fit.addEventListener("click", () => twin.fit());
      if (GLT.traffic && GLT.traffic.init(twin, data)) { addTrafficLegend(); twin.bringNetworkToFront(); }
      if (GLT.trip) GLT.trip.init(twin, data);
      initTabs();

      const ops = (data.network.lines || []).filter((l) => l.status === "operational");
      $("stLines").textContent = (data.network.lines || []).length;
      $("stKm").textContent = Math.round(ops.reduce((a, l) => a + (l.length_km || 0), 0));

      twin.setHour(420);
      wireControls();
      GLT.charts.setHour(420);
      syncStats();
      twin.draw();
      // El gemelo arranca "en vivo" (salvo que el sistema pida menos movimiento; Play sigue funcionando igual).
      if (!matchMedia("(prefers-reduced-motion: reduce)").matches) setPlaying(true);
    } catch (err) {
      console.error(err);
      $("kpiStrip").innerHTML = `<div class="loading">No se pudieron cargar los datos (${err.message}).<br>
        Sirve el sitio por HTTP (p. ej. <code>python3 -m http.server</code>) o publícalo en GitHub Pages.</div>`;
    }
  }

  if (document.readyState === "loading") addEventListener("DOMContentLoaded", boot);
  else boot();
})();
