/* ============================================================
   twin.js — Gemelo digital sobre mapa real (Leaflet)
   Tiles de calles + zoom/pan nativo + flota animada en overlay canvas
   ============================================================ */
(function () {
  "use strict";

  const TILES = {
    dark:  { url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",  sub: "abcd" },
    light: { url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", sub: "abcd" },
  };
  const ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';
  const MODE = {
    metro:{line:5,veh:5}, tren_urbano:{line:5,veh:5}, brt:{line:4,veh:4.4},
    corredor:{line:3.5,veh:3.8}, default:{line:3.5,veh:4},
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
      this.reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
      this._model();
      this._initMap();
      this._initVeh();
      setTimeout(() => { this.map.invalidateSize(); this._sizeVeh(); this.fit(); this._draw(); }, 60);
    }

    isDark() { const c = document.documentElement.getAttribute("data-theme");
      return c ? c === "dark" : matchMedia("(prefers-color-scheme: dark)").matches; }

    _model() {
      const feats = (this.data.routes.features || []).filter((f) => !String(f.properties.id).startsWith("_"));
      const byId = {}; feats.forEach((f) => (byId[f.properties.id] = f));
      this.lines = (this.data.network.lines || []).map((ln) => {
        const f = byId[ln.id];
        const ll = (f ? f.geometry.coordinates : (ln.stations||[]).map((s)=>[s.lng,s.lat])).map((c)=>[c[1],c[0]]);
        const cum=[0]; let tot=0;
        for (let i=1;i<ll.length;i++){ tot+=haversine(ll[i-1],ll[i]); cum.push(tot); }
        return { def: ln, ll, cum, total: tot, sty: st(ln.mode),
          travelMin: ((ln.length_km||Math.max(1,tot/1000))/(ln.avg_speed_kmh||25))*60,
          op:{start:toMin(ln.operating_hours&&ln.operating_hours.start), end:toMin((ln.operating_hours&&ln.operating_hours.end)||"23:00")} };
      });
    }

    _initMap() {
      const L = window.L;
      this.map = L.map(this.container, { zoomControl: true, attributionControl: true, preferCanvas: true, zoomSnap: 0.5 });
      this.map.attributionControl.setPrefix(false);
      this._setTiles();

      // rutas + estaciones como capas Leaflet (pan/zoom nativo)
      this.routeLayer = {}; this.stationLayer = {};
      const bounds = [];
      this.lines.forEach((Ln) => {
        const planned = Ln.def.status !== "operational";
        const poly = L.polyline(Ln.ll, { color: Ln.def.color || "#888", weight: Ln.sty.line,
          opacity: planned ? 0.55 : 0.92, dashArray: planned ? "3 8" : null, lineJoin: "round", lineCap: "round" });
        const grp = L.layerGroup();
        (Ln.def.stations || []).forEach((s) => {
          const cm = L.circleMarker([s.lat, s.lng], { radius: Ln.def.mode === "metro" ? 4.5 : 3.5,
            color: Ln.def.color || "#888", weight: 2, fillColor: this.isDark() ? "#111" : "#fff", fillOpacity: 1 });
          cm.bindTooltip(`<b>${s.name}</b><span>${Ln.def.short || Ln.def.name}</span>`, { direction: "top", className: "twin-tt", offset: [0, -4] });
          cm.addTo(grp);
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
      this.tiles = L.tileLayer(cfg.url, { subdomains: cfg.sub, attribution: ATTR, maxZoom: 19, detectRetina: true }).addTo(this.map);
    }
    setTheme() {
      this._setTiles();
      const fill = this.isDark() ? "#111" : "#fff";
      Object.values(this.stationLayer).forEach((g) => g.eachLayer((cm) => cm.setStyle && cm.setStyle({ fillColor: fill })));
      this._draw();
    }

    _initVeh() {
      const cv = document.createElement("canvas"); cv.className = "veh-canvas";
      this.container.parentNode.appendChild(cv); this.vcv = cv; this.vctx = cv.getContext("2d");
      this._sizeVeh(); addEventListener("resize", () => { this._sizeVeh(); this._draw(); });
      this._draw();
    }
    _sizeVeh() {
      const r = this.container.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
      this.vcv.width = Math.round(r.width * dpr); this.vcv.height = Math.round(r.height * dpr);
      this.vcv.style.width = r.width + "px"; this.vcv.style.height = r.height + "px";
      this.vctx.setTransform(dpr, 0, 0, dpr, 0, 0); this._vw = r.width; this._vh = r.height;
    }

    _at(L, p) {
      const d = Math.max(0, Math.min(1, p)) * L.total;
      let i = 1; while (i < L.cum.length && L.cum[i] < d) i++;
      if (i >= L.ll.length) return L.ll[L.ll.length - 1];
      const a = L.ll[i-1], b = L.ll[i], seg = L.cum[i] - L.cum[i-1] || 1, f = (d - L.cum[i-1]) / seg;
      return [a[0] + (b[0]-a[0])*f, a[1] + (b[1]-a[1])*f];
    }

    demandIndex(t) {
      const dc = (this.data.indicators && this.data.indicators.demand_curve) || [];
      if (!dc.length) return 0.6;
      const h=(t/60)%24, i=Math.floor(h), j=(i+1)%24, f=h-i;
      const a=dc[i]?dc[i].index:0.5, b=dc[j]?dc[j].index:0.5; return a+(b-a)*f;
    }
    _headway(L, t) { const hw = L.def.headway_min || {peak:6,offpeak:12}; const d=this.demandIndex(t);
      return hw.offpeak + (hw.peak - hw.offpeak) * d; }
    _vehicles(L, t) {
      if (L.def.status !== "operational") return [];
      const day=((t%1440)+1440)%1440; if (day<L.op.start || day>L.op.end) return [];
      const h=this._headway(L,t), tr=L.travelMin, out=[];
      for (let k=Math.ceil((t-tr)/h); k*h<=t; k++){ const p=(t-k*h)/tr; if (p>=0&&p<=1) out.push(p); }
      for (let m=Math.ceil((t-tr-h/2)/h); m*h+h/2<=t; m++){ const p=(t-(m*h+h/2))/tr; if (p>=0&&p<=1) out.push(1-p); }
      return out;
    }
    liveStats(t) {
      const dc=(this.data.indicators&&this.data.indicators.demand_curve)||[];
      const sum=dc.reduce((a,b)=>a+(b.index||0),0)||1, share=this.demandIndex(t)/sum;
      let veh=0, pax=0;
      this.lines.forEach((L)=>{ if(this.hidden.has(L.def.id))return; veh+=this._vehicles(L,t).length;
        if(L.def.status==="operational") pax+=(L.def.daily_riders||0)*share; });
      return { veh, pax: Math.round(pax) };
    }

    _draw() {
      if (!this.vctx) return;
      const c=this.vctx, W=this._vw, H=this._vh; c.clearRect(0,0,W,H);
      this.lines.forEach((L)=>{
        if (this.hidden.has(L.def.id) || L.def.status!=="operational") return;
        const col=L.def.color||"#888", rad=L.sty.veh;
        this._vehicles(L,this.t).forEach((p)=>{
          const ll=this._at(L,p), pt=this.map.latLngToContainerPoint(ll);
          if (pt.x<-20||pt.y<-20||pt.x>W+20||pt.y>H+20) return;
          c.beginPath(); c.arc(pt.x,pt.y,rad+2.6,0,6.2832); c.fillStyle=col+"33"; c.fill();
          c.beginPath(); c.arc(pt.x,pt.y,rad,0,6.2832); c.fillStyle=col; c.fill();
          c.lineWidth=1.5; c.strokeStyle=this.isDark()?"#0b0e10":"#fff"; c.stroke();
        });
      });
    }
    draw() { this._draw(); }

    _loop(now){ if(!this.playing)return; const dt=Math.min(0.05,(now-this._last)/1000); this._last=now;
      this.t=(this.t+(dt*this.speed)/60+1440)%1440; this._draw(); this.onTick&&this.onTick(this.t);
      this._raf=requestAnimationFrame((n)=>this._loop(n)); }
    play(){ if(this.reduced){this._draw();return;} this.playing=true; this._last=performance.now();
      this._raf=requestAnimationFrame((n)=>this._loop(n)); }
    pause(){ this.playing=false; cancelAnimationFrame(this._raf); }
    setHour(t){ this.t=((t%1440)+1440)%1440; this._draw(); this.onTick&&this.onTick(this.t); }
    setSpeed(s){ this.speed=s; }
    toggleLine(id){
      if (this.hidden.has(id)) { this.hidden.delete(id); this.routeLayer[id]&&this.routeLayer[id].addTo(this.map); this.stationLayer[id]&&this.stationLayer[id].addTo(this.map); }
      else { this.hidden.add(id); this.routeLayer[id]&&this.map.removeLayer(this.routeLayer[id]); this.stationLayer[id]&&this.map.removeLayer(this.stationLayer[id]); }
      this._draw();
    }
    zoomIn(){ this.map.zoomIn(); } zoomOut(){ this.map.zoomOut(); }
    fit(){ const b=[]; this.lines.forEach((L)=>{ if(!this.hidden.has(L.def.id)) L.ll.forEach((p)=>b.push(p)); }); if(b.length) this.map.fitBounds(b,{padding:[40,40]}); }
  }

  window.GLT = window.GLT || {};
  window.GLT.Twin = Twin;
})();
