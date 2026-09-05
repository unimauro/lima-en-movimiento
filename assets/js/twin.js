/* ============================================================
   twin.js — Motor del gemelo digital
   Proyección geográfica + render en <canvas> + simulación de flota
   ============================================================ */
(function () {
  "use strict";

  const MODE_STYLE = {
    metro:        { line: 4.6, veh: 4.6, dash: null },
    tren_urbano:  { line: 4.6, veh: 4.6, dash: null },
    brt:          { line: 3.6, veh: 4.0, dash: null },
    corredor:     { line: 3.0, veh: 3.4, dash: null },
    default:      { line: 3.0, veh: 3.6, dash: null },
  };
  const style = (m) => MODE_STYLE[m] || MODE_STYLE.default;
  const toMin = (hhmm) => { const [h, m] = String(hhmm || "05:00").split(":").map(Number); return h * 60 + (m || 0); };

  class Twin {
    constructor(canvas, data) {
      this.cv = canvas;
      this.ctx = canvas.getContext("2d");
      this.data = data;
      this.t = 420;                 // minuto simulado (07:00)
      this.playing = false;
      this.speed = 120;             // segundos-sim por segundo-real
      this.hidden = new Set();      // ids de líneas ocultas
      this.hoverStation = null;
      this.reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
      this._buildModel();
      this._bindHover();
      this._resize = this._resize.bind(this);
      addEventListener("resize", this._resize);
      this.layout();
    }

    /* --- construir modelo a partir de geojson + network --- */
    _buildModel() {
      const feats = this.data.routes.features || [];
      const byId = {};
      feats.forEach((f) => { byId[f.properties.id] = f; });
      this.baseFeatures = feats.filter((f) => String(f.properties.id).startsWith("_"));

      this.lines = (this.data.network.lines || []).map((ln) => {
        const f = byId[ln.id];
        const coords = f ? f.geometry.coordinates.slice() : (ln.stations || []).map((s) => [s.lng, s.lat]);
        const lengthKm = ln.length_km || 10;
        const speed = ln.avg_speed_kmh || 25;
        return {
          def: ln,
          coords,                                   // [lng,lat] a lo largo de la ruta
          st: style(ln.mode),
          travelMin: (lengthKm / speed) * 60,       // minutos punta a punta
          op: { start: toMin(ln.operating_hours && ln.operating_hours.start),
                end:   toMin((ln.operating_hours && ln.operating_hours.end) || "23:00") },
          px: [], cum: [], total: 0,                // se llena en layout()
          stationsPx: [],
        };
      });

      // bbox global (sobre todas las coords, incluidas base)
      let mnX = 180, mxX = -180, mnY = 90, mxY = -90;
      const scan = (c) => { if (c[0] < mnX) mnX = c[0]; if (c[0] > mxX) mxX = c[0]; if (c[1] < mnY) mnY = c[1]; if (c[1] > mxY) mxY = c[1]; };
      this.lines.forEach((L) => L.coords.forEach(scan));
      this.baseFeatures.forEach((f) => (f.geometry.coordinates || []).forEach(scan));
      // pad
      const padX = (mxX - mnX) * 0.06 || 0.02, padY = (mxY - mnY) * 0.06 || 0.02;
      this.bbox = { mnX: mnX - padX, mxX: mxX + padX, mnY: mnY - padY, mxY: mxY + padY };
      this.midLat = (mnY + mxY) / 2;
    }

    /* --- proyección equirectangular ajustada al lienzo --- */
    _project() {
      const b = this.bbox, cosL = Math.cos((this.midLat * Math.PI) / 180);
      const X = (lng) => (lng - b.mnX) * cosL;
      const spanX = (b.mxX - b.mnX) * cosL, spanY = (b.mxY - b.mnY);
      const w = this.W, h = this.H, m = Math.min(w, h) * 0.045;
      const s = Math.min((w - 2 * m) / spanX, (h - 2 * m) / spanY);
      const ox = (w - spanX * s) / 2, oy = (h - spanY * s) / 2;
      this.proj = (lng, lat) => [ox + X(lng) * s, oy + (b.mxY - lat) * s];
    }

    layout() {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const r = this.cv.getBoundingClientRect();
      this.W = r.width; this.H = r.height;
      this.cv.width = Math.round(r.width * dpr);
      this.cv.height = Math.round(r.height * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this._project();
      // precalcular píxeles + distancias acumuladas
      this.lines.forEach((L) => {
        L.px = L.coords.map((c) => this.proj(c[0], c[1]));
        L.cum = [0]; L.total = 0;
        for (let i = 1; i < L.px.length; i++) {
          const dx = L.px[i][0] - L.px[i - 1][0], dy = L.px[i][1] - L.px[i - 1][1];
          L.total += Math.hypot(dx, dy); L.cum.push(L.total);
        }
        L.stationsPx = (L.def.stations || []).map((s) => ({ s, p: this.proj(s.lng, s.lat) }));
      });
      this.basePx = this.baseFeatures.map((f) => ({
        id: f.properties.id,
        pts: (f.geometry.coordinates || []).map((c) => this.proj(c[0], c[1])),
      }));
    }
    _resize() { this.layout(); if (!this.playing) this.draw(); }

    /* --- posición a lo largo de la ruta según progreso 0..1 --- */
    _at(L, p) {
      const d = Math.max(0, Math.min(1, p)) * L.total;
      let i = 1; while (i < L.cum.length && L.cum[i] < d) i++;
      if (i >= L.px.length) return L.px[L.px.length - 1];
      const a = L.px[i - 1], b = L.px[i], seg = L.cum[i] - L.cum[i - 1] || 1;
      const f = (d - L.cum[i - 1]) / seg;
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    }

    demandIndex(t) {
      const dc = (this.data.indicators && this.data.indicators.demand_curve) || [];
      if (!dc.length) return 0.6;
      const h = (t / 60) % 24, i = Math.floor(h), j = (i + 1) % 24, f = h - i;
      const a = dc[i] ? dc[i].index : 0.5, b = dc[j] ? dc[j].index : 0.5;
      return a + (b - a) * f;
    }

    /* headway efectivo (min) para la línea a la hora t */
    _headway(L, t) {
      const hw = L.def.headway_min || { peak: 6, offpeak: 12 };
      const d = this.demandIndex(t);
      return hw.offpeak + (hw.peak - hw.offpeak) * d; // d=1 → punta
    }

    /* vehículos activos de una línea: progresos 0..1 en ambos sentidos */
    _vehicles(L, t) {
      if (L.def.status !== "operational") return [];
      const day = ((t % 1440) + 1440) % 1440;
      if (day < L.op.start || day > L.op.end) return [];
      const h = this._headway(L, t), travel = L.travelMin;
      const out = [];
      // sentido ida (0→1)
      let k0 = Math.ceil((t - travel) / h);
      for (let k = k0; k * h <= t; k++) {
        const p = (t - k * h) / travel; if (p >= 0 && p <= 1) out.push(p);
      }
      // sentido vuelta (1→0), desfasado h/2
      let m0 = Math.ceil((t - travel - h / 2) / h);
      for (let m = m0; m * h + h / 2 <= t; m++) {
        const p = (t - (m * h + h / 2)) / travel; if (p >= 0 && p <= 1) out.push(1 - p);
      }
      return out;
    }

    /* pax/hora aproximado de la red visible a la hora t */
    liveStats(t) {
      const dc = (this.data.indicators && this.data.indicators.demand_curve) || [];
      const sumIdx = dc.reduce((a, b) => a + (b.index || 0), 0) || 1;
      const share = this.demandIndex(t) / sumIdx; // fracción del día en esta hora
      let veh = 0, pax = 0;
      this.lines.forEach((L) => {
        if (this.hidden.has(L.def.id)) return;
        const vs = this._vehicles(L, t); veh += vs.length;
        if (L.def.status === "operational") pax += (L.def.daily_riders || 0) * share;
      });
      return { veh, pax: Math.round(pax) };
    }

    /* --- dibujo --- */
    draw() {
      const c = this.ctx, css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
      c.clearRect(0, 0, this.W, this.H);
      c.fillStyle = css("--map-bg"); c.fillRect(0, 0, this.W, this.H);

      // base (costa / límite)
      c.lineJoin = "round"; c.lineCap = "round";
      this.basePx.forEach((b) => {
        c.beginPath(); b.pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
        c.strokeStyle = css("--coast"); c.lineWidth = b.id === "_costa" ? 2 : 1;
        c.setLineDash(b.id === "_costa" ? [] : [3, 4]); c.stroke(); c.setLineDash([]);
      });

      // corredores
      this.lines.forEach((L) => {
        if (this.hidden.has(L.def.id) || L.px.length < 2) return;
        const planned = L.def.status !== "operational";
        c.beginPath(); L.px.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
        c.strokeStyle = L.def.color || "#888"; c.lineWidth = L.st.line;
        c.globalAlpha = planned ? 0.5 : 0.9; c.setLineDash(planned ? [7, 6] : []);
        c.stroke(); c.setLineDash([]); c.globalAlpha = 1;
      });

      // estaciones
      this.lines.forEach((L) => {
        if (this.hidden.has(L.def.id)) return;
        const rr = L.def.mode === "metro" ? 3.4 : 2.6;
        L.stationsPx.forEach(({ p }) => {
          c.beginPath(); c.arc(p[0], p[1], rr, 0, 6.2832);
          c.fillStyle = css("--station"); c.fill();
          c.lineWidth = 1.6; c.strokeStyle = L.def.color || css("--station-ring"); c.stroke();
        });
      });

      // vehículos
      this.lines.forEach((L) => {
        if (this.hidden.has(L.def.id)) return;
        const vs = this._vehicles(L, this.t), r = L.st.veh;
        vs.forEach((p) => {
          const xy = this._at(L, p);
          c.beginPath(); c.arc(xy[0], xy[1], r + 2.4, 0, 6.2832);
          c.fillStyle = (L.def.color || "#888") + "33"; c.fill();       // halo
          c.beginPath(); c.arc(xy[0], xy[1], r, 0, 6.2832);
          c.fillStyle = L.def.color || "#888"; c.fill();
          c.lineWidth = 1.4; c.strokeStyle = css("--map-bg"); c.stroke();
        });
      });

      // estación resaltada
      if (this.hoverStation) {
        const p = this.hoverStation.p;
        c.beginPath(); c.arc(p[0], p[1], 6, 0, 6.2832);
        c.strokeStyle = css("--text-1"); c.lineWidth = 2; c.stroke();
      }
    }

    /* --- animación --- */
    _loop(now) {
      if (!this.playing) return;
      const dt = Math.min(0.05, (now - this._last) / 1000); this._last = now;
      this.t = (this.t + (dt * this.speed) / 60 + 1440) % 1440; // speed = seg-sim / seg-real
      this.draw(); this.onTick && this.onTick(this.t);
      this._raf = requestAnimationFrame((n) => this._loop(n));
    }
    play() { if (this.reduced) { this.draw(); return; } this.playing = true; this._last = performance.now();
      this._raf = requestAnimationFrame((n) => this._loop(n)); }
    pause() { this.playing = false; cancelAnimationFrame(this._raf); }
    setHour(t) { this.t = ((t % 1440) + 1440) % 1440; this.draw(); this.onTick && this.onTick(this.t); }
    setSpeed(s) { this.speed = s; }
    toggleLine(id) { if (this.hidden.has(id)) this.hidden.delete(id); else this.hidden.add(id); this.draw(); }

    /* --- hover / tooltip de estaciones --- */
    _bindHover() {
      const tip = document.getElementById("mapTip");
      const hit = (mx, my) => {
        let best = null, bd = 12 * 12;
        this.lines.forEach((L) => {
          if (this.hidden.has(L.def.id)) return;
          L.stationsPx.forEach((st) => {
            const dx = st.p[0] - mx, dy = st.p[1] - my, d = dx * dx + dy * dy;
            if (d < bd) { bd = d; best = { st, L }; }
          });
        });
        return best;
      };
      this.cv.addEventListener("mousemove", (e) => {
        const r = this.cv.getBoundingClientRect();
        const mx = e.clientX - r.left, my = e.clientY - r.top;
        const b = hit(mx, my);
        this.hoverStation = b ? { p: b.st.p } : null;
        if (b) {
          tip.innerHTML = `<b>${b.st.s.name}</b> · ${b.L.def.short || b.L.def.name}`;
          tip.style.left = mx + "px"; tip.style.top = my + "px"; tip.style.opacity = 1;
          this.cv.style.cursor = "pointer";
        } else { tip.style.opacity = 0; this.cv.style.cursor = "default"; }
        if (!this.playing) this.draw();
      });
      this.cv.addEventListener("mouseleave", () => { this.hoverStation = null; tip.style.opacity = 0; if (!this.playing) this.draw(); });
    }
  }

  window.GLT = window.GLT || {};
  window.GLT.Twin = Twin;
})();
