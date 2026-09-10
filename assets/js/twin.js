/* ============================================================
   twin.js — Gemelo digital sobre mapa real (Leaflet)
   Modelo mesoscópico simplificado (ABM-lite): despacho por headway,
   paradas con tiempo de dwell, perfil de carga/ocupación por hora.
   ============================================================ */
(function () {
  "use strict";

  const TILES = {
    dark:  { url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}" },
    light: { url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}" },
  };
  const ATTR = 'Tiles &copy; <a href="https://www.esri.com/">Esri</a> — Esri, HERE, Garmin, &copy; OpenStreetMap contributors';
  // dwell = minutos de parada en cada estación intermedia
  const MODE = {
    metro:{line:5,veh:5,dwell:0.45}, tren_urbano:{line:5,veh:5,dwell:0.45}, brt:{line:4,veh:4.4,dwell:0.35},
    corredor:{line:3.5,veh:3.8,dwell:0.3}, default:{line:3.5,veh:4,dwell:0.3},
  };
  const st = (m) => MODE[m] || MODE.default;
  const toMin = (s) => { const [h,m] = String(s||"05:00").split(":").map(Number); return h*60+(m||0); };
  function haversine(a,b){ const R=6371000,r=Math.PI/180;
    const dLa=(b[0]-a[0])*r,dLo=(b[1]-a[1])*r,la1=a[0]*r,la2=b[0]*r;
    const h=Math.sin(dLa/2)**2+Math.cos(la1)*Math.cos(la2)*Math.sin(dLo/2)**2;
    return 2*R*Math.asin(Math.sqrt(h)); }

  class Twin {
    constructor(container, data) {
      this.container = container; this.data = data;
      this.t = 420; this.playing = false; this.speed = 120;
      this.hidden = new Set();
      this.overlays = [];            // capas extra dibujadas en el canvas (p.ej. tráfico)
      this.hourListeners = [];       // callbacks(t) cuando cambia el minuto simulado
      this._vehPts = [];             // posiciones en pantalla del último frame (hover)
      this._lastMinute = -1;
      this.reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
      this._model();
      this._initMap();
      this._initVeh();
      setTimeout(() => { this.map.invalidateSize(); this._sizeVeh(); this.fit(); this._draw(); }, 60);
    }

    isDark() { const c = document.documentElement.getAttribute("data-theme");
      return c ? c === "dark" : matchMedia("(prefers-color-scheme: dark)").matches; }

    /* ---------- modelo de cada línea ---------- */
    _model() {
      const feats = (this.data.routes.features || []).filter((f) => !String(f.properties.id).startsWith("_"));
      const byId = {}; feats.forEach((f) => (byId[f.properties.id] = f));
      this.lines = (this.data.network.lines || []).map((ln) => {
        const f = byId[ln.id];
        const ll = (f ? f.geometry.coordinates : (ln.stations||[]).map((s)=>[s.lng,s.lat])).map((c)=>[c[1],c[0]]);
        const cum=[0]; let tot=0;
        for (let i=1;i<ll.length;i++){ tot+=haversine(ll[i-1],ll[i]); cum.push(tot); }
        const sty = st(ln.mode);
        const travelMin = ((ln.length_km||Math.max(1,tot/1000))/(ln.avg_speed_kmh||25))*60;
        // estaciones proyectadas a distancia acumulada sobre el trazado
        const stops = (ln.stations||[]).map((s)=>{ let bi=0,bd=Infinity;
          for(let i=0;i<ll.length;i++){ const d=haversine(ll[i],[s.lat,s.lng]); if(d<bd){bd=d;bi=i;} }
          return { d: cum[bi], name: s.name, lat: s.lat, lng: s.lng }; }).sort((a,b)=>a.d-b.d);
        const dists = stops.map((s)=>s.d);
        // horario tiempo→distancia con paradas (dwell) en estaciones intermedias
        const sched = (ds, T) => {
          const inner = ds.filter((d)=>d>1 && d<tot-1);
          const run = Math.max(T*0.6, T - sty.dwell*inner.length), v = tot/run;
          const pts=[[0,0]]; let t=0, d0=0;
          inner.forEach((dk)=>{ t += (dk-d0)/v; pts.push([t,dk]); t += sty.dwell; pts.push([t,dk]); d0=dk; });
          t += (tot-d0)/v; pts.push([t,tot]);
          const k = T/t; return pts.map((p)=>[p[0]*k,p[1]]);
        };
        return { def: ln, ll, cum, total: tot, sty, travelMin, stops,
          fwd: sched(dists, travelMin), rev: sched(dists.map((d)=>tot-d).sort((a,b)=>a-b), travelMin),
          cap: (ln.fleet && ln.fleet.capacity_per_vehicle) || 150,
          op:{start:toMin(ln.operating_hours&&ln.operating_hours.start), end:toMin((ln.operating_hours&&ln.operating_hours.end)||"23:00")} };
      });
    }
    _schedDist(pts, e) {
      if (e<=0) return 0; const last=pts[pts.length-1]; if (e>=last[0]) return last[1];
      let i=1; while (i<pts.length && pts[i][0]<e) i++;
      const a=pts[i-1], b=pts[i], f=(b[0]-a[0])>0 ? (e-a[0])/(b[0]-a[0]) : 0; return a[1]+(b[1]-a[1])*f;
    }
    _atDist(L, d) {
      d=Math.max(0,Math.min(L.total,d));
      let i=1; while (i<L.cum.length && L.cum[i]<d) i++;
      if (i>=L.ll.length) return L.ll[L.ll.length-1];
      const a=L.ll[i-1], b=L.ll[i], seg=L.cum[i]-L.cum[i-1]||1, f=(d-L.cum[i-1])/seg;
      return [a[0]+(b[0]-a[0])*f, a[1]+(b[1]-a[1])*f];
    }

    /* ---------- mapa ---------- */
    _initMap() {
      const L = window.L;
      this.map = L.map(this.container, { zoomControl: true, attributionControl: true, preferCanvas: true, zoomSnap: 0.5 });
      this.map.attributionControl.setPrefix(false);
      this._setTiles();
      this.routeLayer = {}; this.stationLayer = {}; this.stationIndex = {};
      const bounds = [];
      this.lines.forEach((Ln) => {
        const planned = Ln.def.status !== "operational";
        const poly = L.polyline(Ln.ll, { color: Ln.def.color || "#888", weight: Ln.sty.line,
          opacity: planned ? 0.55 : 0.92, dashArray: planned ? "3 8" : null, lineJoin: "round", lineCap: "round" });
        poly.on("click", (e) => this._lineDetail(Ln, e.latlng));
        poly.on("mouseover", () => poly.setStyle({ weight: Ln.sty.line + 2 }));
        poly.on("mouseout", () => poly.setStyle({ weight: Ln.sty.line }));
        const grp = L.layerGroup();
        (Ln.def.stations || []).forEach((s) => {
          const cm = L.circleMarker([s.lat, s.lng], { radius: Ln.def.mode === "metro" ? 4.5 : 3.5,
            color: Ln.def.color || "#888", weight: 2, fillColor: this.isDark() ? "#111" : "#fff", fillOpacity: 1 });
          cm.bindTooltip(`<b>${s.name}</b><span>${Ln.def.short || Ln.def.name}</span>`, { direction: "top", className: "twin-tt", offset: [0, -4] });
          cm.on("click", () => this._lineDetail(Ln, [s.lat, s.lng]));
          cm.addTo(grp);
          this.stationIndex[`${s.name} · ${Ln.def.short || Ln.def.id}`] = { ll: [s.lat, s.lng], cm, id: Ln.def.id };
        });
        if (!this.hidden.has(Ln.def.id)) { poly.addTo(this.map); grp.addTo(this.map); }
        this.routeLayer[Ln.def.id] = poly; this.stationLayer[Ln.def.id] = grp;
        Ln.ll.forEach((p) => bounds.push(p));
      });
      if (bounds.length) this.map.fitBounds(bounds, { padding: [40, 40] });
      else this.map.setView([-12.05, -77.03], 11);
      this.map.on("move zoom moveend resize zoomend", () => this._draw());
    }
    _setTiles() {
      const L = window.L, cfg = this.isDark() ? TILES.dark : TILES.light;
      if (this.tiles) this.map.removeLayer(this.tiles);
      this.tiles = L.tileLayer(cfg.url, { attribution: ATTR, maxZoom: 19, maxNativeZoom: 16 }).addTo(this.map);
      this.tiles.bringToBack && this.tiles.bringToBack();
    }
    setTheme() {
      this._setTiles();
      const fill = this.isDark() ? "#111" : "#fff";
      Object.values(this.stationLayer).forEach((g) => g.eachLayer((cm) => cm.setStyle && cm.setStyle({ fillColor: fill })));
      this._draw();
    }

    /* ---------- canvas de vehículos + hover ---------- */
    _initVeh() {
      const cv = document.createElement("canvas"); cv.className = "veh-canvas";
      this.container.parentNode.appendChild(cv); this.vcv = cv; this.vctx = cv.getContext("2d");
      this._sizeVeh(); addEventListener("resize", () => { this._sizeVeh(); this._draw(); });
      const tip = document.getElementById("vehTip");
      if (tip) {
        this.container.parentNode.addEventListener("mousemove", (e) => {
          const r = this.container.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
          let best = null, bd = 100;
          for (const v of this._vehPts) { const dx=v.x-mx, dy=v.y-my, d=dx*dx+dy*dy; if (d<bd) { bd=d; best=v; } }
          if (best) {
            const next = this._nextStop(best.L, best.d, best.dir);
            tip.innerHTML = `<b>${best.L.def.short || best.L.def.name}</b> · ocupación <b>${Math.round(best.occ*100)}%</b>${best.occ>1?' <i>(sobrecarga)</i>':''}${next?`<span>→ ${next}</span>`:''}`;
            tip.style.left = best.x + "px"; tip.style.top = best.y + "px"; tip.hidden = false;
          } else tip.hidden = true;
        });
        this.container.parentNode.addEventListener("mouseleave", () => { tip.hidden = true; });
      }
      this._draw();
    }
    _sizeVeh() {
      const r = this.container.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
      this.vcv.width = Math.round(r.width * dpr); this.vcv.height = Math.round(r.height * dpr);
      this.vcv.style.width = r.width + "px"; this.vcv.style.height = r.height + "px";
      this.vctx.setTransform(dpr, 0, 0, dpr, 0, 0); this._vw = r.width; this._vh = r.height;
    }
    _nextStop(L, d, dir) {
      if (dir === 1) { for (const s of L.stops) if (s.d > d + 5) return s.name; return null; }
      for (let i = L.stops.length - 1; i >= 0; i--) if (L.stops[i].d < d - 5) return L.stops[i].name; return null;
    }

    /* ---------- demanda y despacho ---------- */
    demandIndex(t) {
      const dc = (this.data.indicators && this.data.indicators.demand_curve) || [];
      if (!dc.length) return 0.6;
      const h=(t/60)%24, i=Math.floor(h), j=(i+1)%24, f=h-i;
      const a=dc[i]?dc[i].index:0.5, b=dc[j]?dc[j].index:0.5; return a+(b-a)*f;
    }
    hourShare(t) { const dc=(this.data.indicators&&this.data.indicators.demand_curve)||[];
      const sum=dc.reduce((a,b)=>a+(b.index||0),0)||1; return this.demandIndex(t)/sum; }
    headway(L, t) { const hw = L.def.headway_min || {peak:6,offpeak:12}; const d=this.demandIndex(t);
      return hw.offpeak + (hw.peak - hw.offpeak) * d; }
    _headway(L,t){ return this.headway(L,t); }
    _vehicles(L, t) {
      if (L.def.status !== "operational") return [];
      const day=((t%1440)+1440)%1440; if (day<L.op.start || day>L.op.end) return [];
      const h=this.headway(L,t), tr=L.travelMin, out=[];
      for (let k=Math.ceil((t-tr)/h); k*h<=t; k++){ const e=t-k*h; if (e>=0&&e<=tr) out.push({e,dir:1}); }
      for (let m=Math.ceil((t-tr-h/2)/h); m*h+h/2<=t; m++){ const e=t-(m*h+h/2); if (e>=0&&e<=tr) out.push({e,dir:-1}); }
      return out;
    }
    _vehPos(L, v) {
      const dS = this._schedDist(v.dir===1 ? L.fwd : L.rev, v.e);
      const d = v.dir===1 ? dS : L.total - dS;
      return { d, ll: this._atDist(L, d) };
    }
    // Carga pico por vehículo (pax) a la hora t: demanda horaria repartida entre los vehículos en servicio.
    _loadPeak(L, t) {
      const P = (L.def.daily_riders||0) * this.hourShare(t), vph = 2*60/this.headway(L,t);
      return P*0.3*1.6/Math.max(1,vph);
    }
    // Ocupación 0..1.3 según posición en la línea (perfil de carga tipo campana) y hora.
    occupancy(L, t, d) {
      const x = d/(L.total||1), f = Math.pow(Math.max(0,Math.sin(Math.PI*x)), 0.8);
      return Math.min(1.3, this._loadPeak(L,t)*f/L.cap);
    }
    liveStats(t) {
      let veh=0, pax=0, onboard=0, occSum=0;
      this.lines.forEach((L)=>{ if(this.hidden.has(L.def.id))return;
        const vs=this._vehicles(L,t); veh+=vs.length;
        if(L.def.status==="operational") pax+=(L.def.daily_riders||0)*this.hourShare(t);
        vs.forEach((v)=>{ const {d}=this._vehPos(L,v); const o=this.occupancy(L,t,d); occSum+=Math.min(1,o); onboard+=Math.min(1.3,o)*L.cap; });
      });
      return { veh, pax: Math.round(pax), onboard: Math.round(onboard), occ: veh ? occSum/veh : 0 };
    }

    /* ---------- render ---------- */
    _draw() {
      if (!this.vctx) return;
      const c=this.vctx, W=this._vw, H=this._vh; c.clearRect(0,0,W,H);
      this.overlays.forEach((o)=>{ try { o(c,W,H,this.t,this.map); } catch(e){ console.error("[twin] overlay", e); } });
      const dark=this.isDark(), pts=[];
      this.lines.forEach((L)=>{
        if (this.hidden.has(L.def.id) || L.def.status!=="operational") return;
        const col=L.def.color||"#888", rad=L.sty.veh;
        this._vehicles(L,this.t).forEach((v)=>{
          const {d,ll}=this._vehPos(L,v), pt=this.map.latLngToContainerPoint(ll);
          if (pt.x<-20||pt.y<-20||pt.x>W+20||pt.y>H+20) return;
          const occ=this.occupancy(L,this.t,d);
          c.beginPath(); c.arc(pt.x,pt.y,rad+2.5+occ*3,0,6.2832); c.globalAlpha=0.18+0.32*Math.min(1,occ); c.fillStyle=col; c.fill(); c.globalAlpha=1;
          c.beginPath(); c.arc(pt.x,pt.y,rad,0,6.2832); c.fillStyle=col; c.fill();
          c.lineWidth=1.5; c.strokeStyle= occ>1 ? "#ff5a5a" : (dark?"#0b0e10":"#fff"); c.stroke();
          pts.push({x:pt.x,y:pt.y,L,occ,d,dir:v.dir});
        });
      });
      this._vehPts = pts;
    }
    draw() { this._draw(); }
    addOverlay(fn) { this.overlays.push(fn); this._draw(); }
    onHourChange(fn) { this.hourListeners.push(fn); }
    _emitHour() { const m=Math.floor(this.t); if (m===this._lastMinute) return; this._lastMinute=m;
      this.hourListeners.forEach((f)=>{ try{ f(this.t); }catch(e){ console.error("[twin] hour", e); } }); }

    /* ---------- animación ---------- */
    _loop(now){ if(!this.playing)return;
      const dt=Math.min(0.05,(now-this._last)/1000); this._last=now;
      this.t=(this.t+(dt*this.speed)/60+1440)%1440;
      try { this._draw(); } catch(e){ console.error("[twin] draw", e); }
      try { this.onTick&&this.onTick(this.t); } catch(e){ console.error("[twin] tick", e); }
      this._emitHour();
      this._raf=requestAnimationFrame((n)=>this._loop(n)); }
    play(){ if(this.playing) return; this.playing=true; this._last=performance.now();
      this._raf=requestAnimationFrame((n)=>this._loop(n)); }
    pause(){ this.playing=false; cancelAnimationFrame(this._raf); }
    setHour(t){ this.t=((t%1440)+1440)%1440; this._draw(); this.onTick&&this.onTick(this.t); this._emitHour(); }
    setSpeed(s){ this.speed=s; }
    toggleLine(id){
      if (this.hidden.has(id)) { this.hidden.delete(id); this.routeLayer[id]&&this.routeLayer[id].addTo(this.map); this.stationLayer[id]&&this.stationLayer[id].addTo(this.map); }
      else { this.hidden.add(id); this.routeLayer[id]&&this.map.removeLayer(this.routeLayer[id]); this.stationLayer[id]&&this.map.removeLayer(this.stationLayer[id]); }
      this._draw();
    }

    /* ---------- ficha de línea, búsqueda, encuadre ---------- */
    _lineDetail(Ln, at) {
      const d = (this.data.linesDetail || {})[Ln.def.id] || {};
      const def = Ln.def, esc = (s) => String(s).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
      const STATUS = { operational: "En operación", construction: "En construcción", planned: "En planificación" };
      const rows = [];
      const add = (k, v) => { if (v != null && v !== "") rows.push(`<tr><td>${k}</td><td>${esc(v)}</td></tr>`); };
      add("Estado", STATUS[def.status] || def.status);
      add("Longitud", def.length_km ? def.length_km + " km" : null);
      add("Estaciones", def.stations_count || (def.stations || []).length);
      add("Operador", d.operator);
      add("Tarifa", d.fare_soles != null ? "S/ " + Number(d.fare_soles).toFixed(2) : null);
      add("Material", d.rolling_stock);
      add("Inauguración", d.opened);
      if (d.progress_pct != null) add("Avance", d.progress_pct + "%");
      if (d.eta) add("Operación estimada", d.eta);
      add("Pasajeros/día", def.daily_riders ? GLT.fmt.short(def.daily_riders) : null);
      if (def.status === "operational") add("Intervalo ahora", this.headway(Ln, this.t).toFixed(1) + " min");
      const facts = (d.facts || []).length ? `<ul class="pop-facts">${d.facts.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>` : "";
      const html = `<div class="pop"><div class="pop-h"><span class="pop-sw" style="background:${def.color}"></span><b>${esc(def.name)}</b></div>
        <table class="pop-t">${rows.join("")}</table>${facts}${d.operator || d.fare_soles ? "" : '<div class="pop-note">Ficha detallada en preparación.</div>'}</div>`;
      L.popup({ maxWidth: 300, className: "twin-pop" }).setLatLng(at || Ln.ll[Math.floor(Ln.ll.length / 2)]).setContent(html).openOn(this.map);
    }
    stationNames() { return Object.keys(this.stationIndex); }
    flyToStation(name) {
      const s = this.stationIndex[name]; if (!s) return false;
      if (this.hidden.has(s.id)) this.toggleLine(s.id);
      this.map.flyTo(s.ll, Math.max(this.map.getZoom(), 14), { duration: 0.6 });
      setTimeout(() => { s.cm.openTooltip && s.cm.openTooltip(); this._draw(); }, 650);
      return true;
    }
    // La red masiva siempre por encima de las capas de fondo (arterias, rutas de viaje).
    bringNetworkToFront() {
      Object.values(this.routeLayer).forEach((p) => p.bringToFront && p.bringToFront());
      Object.values(this.stationLayer).forEach((g) => g.eachLayer((m) => m.bringToFront && m.bringToFront()));
    }
    zoomIn(){ this.map.zoomIn(); } zoomOut(){ this.map.zoomOut(); }
    fit(){ const b=[]; this.lines.forEach((L)=>{ if(!this.hidden.has(L.def.id)) L.ll.forEach((p)=>b.push(p)); }); if(b.length) this.map.fitBounds(b,{padding:[40,40]}); }
  }

  window.GLT = window.GLT || {};
  window.GLT.Twin = Twin;
  window.GLT.haversine = haversine;
})();
