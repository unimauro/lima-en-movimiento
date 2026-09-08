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
      if (GLT.charts) GLT.charts.retheme();
    });
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
      try { await navigator.clipboard.writeText(b.dataset.copy); const t = b.textContent; b.textContent = "¡Copiado!"; setTimeout(() => (b.textContent = t), 1500); } catch (e) {}
    }));
    const share = $("shareBtn");
    if (share) share.addEventListener("click", async () => {
      const d = { title: "Lima en Movimiento", text: "Gemelo digital del transporte urbano de Lima", url: location.href };
      try { if (navigator.share) await navigator.share(d); else { await navigator.clipboard.writeText(location.href); share.textContent = "Enlace copiado"; setTimeout(() => (share.textContent = "Compartir"), 1500); } } catch (e) {}
    });
    const coffee = $("coffeeCard");
    if (coffee) coffee.href = window.__COFFEE_URL__ || "https://www.buymeacoffee.com/";
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
    el.innerHTML = kpis.map((k) => {
      const big = Number(k.value) >= 100000;
      const v = big ? GLT.fmt.short(k.value) : GLT.fmt.int(k.value);
      const u = k.unit && !big ? ` <small>${k.unit}</small>` : "";
      return `<div class="kpi"><div class="v tnum">${v}${u}</div>
        <div class="k">${k.label || ""}</div>${k.note ? `<div class="n">${k.note}</div>` : ""}</div>`;
    }).join("");
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
    $("hourVal").textContent = hhmm(t);
    $("hour").value = Math.floor(t);
  }

  function wireControls() {
    $("playBtn").addEventListener("click", () => {
      playing = !playing;
      $("playIcon").innerHTML = playing
        ? '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>'
        : '<path d="M8 5v14l11-7z"/>';
      if (playing) twin.play(); else twin.pause();
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
    if (GLT.chat) GLT.chat.init();
    $("year").textContent = new Date().getFullYear();
    try {
      const data = await GLT.load();
      renderKPIs(data.indicators, data.network);
      renderContext(data.context);
      GLT.charts.buildAll(data);

      twin = new GLT.Twin($("twinMap"), data);
      window.__twin = twin;
      renderLegend(data.network, twin);
      const fit = $("mapFit"); if (fit) fit.addEventListener("click", () => twin.fit());

      const ops = (data.network.lines || []).filter((l) => l.status === "operational");
      $("stLines").textContent = (data.network.lines || []).length;
      $("stKm").textContent = Math.round(ops.reduce((a, l) => a + (l.length_km || 0), 0));

      twin.setHour(420);
      wireControls();
      GLT.charts.setHour(420);
      syncStats();
      twin.draw();
    } catch (err) {
      console.error(err);
      $("kpiStrip").innerHTML = `<div class="loading">No se pudieron cargar los datos (${err.message}).<br>
        Sirve el sitio por HTTP (p. ej. <code>python3 -m http.server</code>) o publícalo en GitHub Pages.</div>`;
    }
  }

  if (document.readyState === "loading") addEventListener("DOMContentLoaded", boot);
  else boot();
})();
