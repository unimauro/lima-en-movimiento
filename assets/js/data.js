/* ============================================================
   data.js — carga y utilidades compartidas
   ============================================================ */
window.GLT = window.GLT || {};

GLT.css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// Envía un evento a Google Analytics (si gtag está disponible)
GLT.track = function (name, params) { try { if (window.gtag) window.gtag("event", name, params || {}); } catch (e) {} };

const nf = new Intl.NumberFormat("es-PE");
GLT.fmt = {
  int: (n) => nf.format(Math.round(n || 0)),
  // abrevia: 1.2 M / 340 mil
  short: (n) => {
    n = Number(n) || 0;
    if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(".", ",") + " M";
    if (n >= 1e3) return Math.round(n / 1e3) + " mil";
    return nf.format(n);
  },
  km: (n) => nf.format(Math.round(n || 0)) + " km",
};

GLT.load = async function () {
  if (window.__GLT_INLINE__) { GLT.data = window.__GLT_INLINE__; return GLT.data; }
  const base = "data/";
  const grab = (f) => fetch(base + f, { cache: "no-cache" }).then((r) => {
    if (!r.ok) throw new Error(f + " → " + r.status);
    return r.json();
  });
  const opt = (f) => grab(f).catch(() => null);   // opcionales: no rompen si faltan
  const [network, routes, indicators, context, fleet, security, linesDetail, arteries] = await Promise.all([
    grab("network.json"), grab("routes.geojson"),
    grab("indicators.json"), grab("context.json"),
    opt("fleet.json"), opt("security.json"), opt("lines_detail.json"), opt("arteries.geojson"),
  ]);
  GLT.data = { network, routes, indicators, context, fleet, security, linesDetail, arteries };
  return GLT.data;
};
