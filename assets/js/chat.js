/* ============================================================
   chat.js — Asistente de Lima en Movimiento
   Responde con los datos reales del sitio; usa el gateway
   ai.tunky.net (POST /v1/chat) cuando hay token configurado.
   ============================================================ */
(function () {
  "use strict";

  // ---- CONFIG -------------------------------------------------------------
  // El gateway ai.tunky.net valida el Origin (unimauro.github.io ya permitido)
  // y exige el header X-Client-Token. Pega el token para activar la IA:
  const CHAT = {
    endpoint: "https://ai.tunky.net/v1/chat",
    token: "lima_c20b85a3f03bba0ea183f1d9a5b82a8b",   // X-Client-Token dedicado de ai.tunky.net (público por diseño, revocable por proyecto)
    system: "Eres el asistente de 'Lima en Movimiento', un gemelo digital del transporte urbano de Lima y Callao (Metro, Metropolitano y corredores). Responde en español, breve y claro, sobre movilidad y transporte de Lima.",
  };
  // ------------------------------------------------------------------------

  const $ = (id) => document.getElementById(id);
  const history = [];
  let open = false, busy = false, greeted = false;
  const esc = (s) => String(s).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
  const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const el = (cls, html) => { const d = document.createElement("div"); d.className = cls; if (html != null) d.innerHTML = html; return d; };

  function add(role, text) { const log = $("chatLog"); log.appendChild(el("msg " + role, esc(text))); log.scrollTop = log.scrollHeight; }
  function typing() { const log = $("chatLog"); const m = el("msg bot", '<span class="typing"><i></i><i></i><i></i></span>'); log.appendChild(m); log.scrollTop = log.scrollHeight; return m; }

  function suggestions() {
    const wrap = el("chat-suggest");
    ["¿Qué es el Metropolitano?", "¿Cuántas estaciones tiene la Línea 1?", "Reparto modal", "Pasajeros por día"]
      .forEach((q) => { const b = document.createElement("button"); b.textContent = q; b.onclick = () => { wrap.remove(); handle(q); }; wrap.appendChild(b); });
    $("chatLog").appendChild(wrap);
  }
  function greet() { if (greeted) return; greeted = true;
    add("bot", "¡Hola! 👋 Soy el asistente de Lima en Movimiento. Pregúntame sobre el Metro, el Metropolitano, los corredores o la movilidad de la ciudad.");
    suggestions(); }

  // -------- respondedor local (datos reales del sitio) --------
  const MODEL = { metro: "Metro (tren urbano)", brt: "BRT (bus de tránsito rápido)", corredor: "corredor de buses", tren_urbano: "tren urbano" };
  const STATUSL = { operational: "en operación", construction: "en construcción", planned: "en planificación" };
  function lineByText(t, lines) {
    const map = [["linea 1", "L1"], ["l1", "L1"], ["linea 2", "L2"], ["l2", "L2"], ["linea 3", "L3"], ["l3", "L3"],
      ["linea 4", "L4"], ["l4", "L4"], ["metropolitano", "MET"], ["corredor rojo", "CR"], ["javier prado", "CR"],
      ["corredor azul", "CA"], ["arequipa", "CA"], ["corredor morado", "CM"], ["morado", "CM"], ["rojo", "CR"], ["azul", "CA"]];
    for (const [k, id] of map) if (t.includes(k)) { const l = lines.find((x) => x.id === id); if (l) return l; }
    return null;
  }
  function localAnswer(q) {
    const d = GLT.data || {}, net = d.network || {}, ind = d.indicators || {}, ctx = d.context || {};
    const lines = net.lines || [], t = norm(q);
    const L = lineByText(t, lines);
    const est = (l) => l.stations_count || (l.stations || []).length;

    if (/estacion/.test(t) && /(cuant|numero|tiene)/.test(t)) {
      if (L) return `La ${L.name} tiene ${est(L)} estaciones${L.length_km ? ` a lo largo de ${L.length_km} km` : ""}.`;
      const tot = lines.reduce((a, l) => a + est(l), 0);
      return `La red modelada suma ${tot} estaciones en ${lines.length} líneas (Metro, Metropolitano y corredores).`;
    }
    if (t.includes("modal") || t.includes("reparto") || (t.includes("como") && t.includes("mueve"))) {
      const ms = (ind.modal_share || []).slice().sort((a, b) => b.pct - a.pct).slice(0, 5);
      if (ms.length) return "Reparto modal de los viajes en Lima: " + ms.map((m) => `${m.mode} ${m.pct}%`).join(" · ") + ".";
    }
    if (t.includes("pasajero") || t.includes("demanda") || t.includes("viajes") || t.includes("cuanta gente")) {
      const rb = (ind.ridership_by_mode || []).slice().sort((a, b) => b.daily - a.daily).slice(0, 5);
      if (rb.length) return "Pasajeros por día (aprox.): " + rb.map((r) => `${r.mode} ${GLT.fmt.short(r.daily)}`).join(" · ") + ".";
    }
    if (t.includes("futuro") || t.includes("proyecto") || t.includes("viene")) {
      const f = (ctx.future || []).slice(0, 4).map((x) => x.title);
      if (f.length) return "Proyectos en marcha: " + f.join(", ") + ".";
    }
    if (t.includes("atu") || t.includes("autoridad")) { if (ctx.authority) return ctx.authority.text || ctx.authority.name; }
    if (/(parque|automotor|autos|vehicul|motoriz|congestion|cuantos carros)/.test(t)) {
      const F = d.fleet; if (F) {
        const k = (F.kpis || [])[0]; const p = F.projection || {};
        return `${F.scope ? "En " + F.scope + ", el" : "El"} parque vehicular ${k ? "es de ~" + GLT.fmt.short(k.value) + " vehículos" : "sigue creciendo"}${p.annual_growth_pct ? ` y crece ~${p.annual_growth_pct}% al año` : ""}. Mira la simulación en la sección “Parque automotor”.`;
      }
    }
    if (/(extorsi|cupos?|asesinat|matan|mataron|crimen|seguridad|violencia|choferes)/.test(t)) {
      const S = d.security; if (S) {
        const zonas = (S.affected_zones || []).slice(0, 4).map((z) => z.name).join(", ");
        const k = (S.kpis || [])[0];
        return `La extorsión (“cupos”) y los ataques a transportistas golpean sobre todo al transporte convencional (combis y cústers).${k ? " " + k.label + ": " + GLT.fmt.int(k.value) + "." : ""}${zonas ? " Distritos más afectados: " + zonas + "." : ""} Detalles y fuentes en la sección “Seguridad”. (Datos agregados de fuentes públicas, no por ruta.)`;
      }
    }
    if (L) return `${L.name} — ${MODEL[L.mode] || L.mode}, ${STATUSL[L.status] || L.status}. ${L.length_km ? L.length_km + " km, " : ""}${est(L)} estaciones${L.daily_riders ? `, ~${GLT.fmt.short(L.daily_riders)} pasajeros/día` : ""}.`;
    if ((t.includes("que es") || t.includes("explica")) && lines.length)
      return "Lima en Movimiento modela la red masiva de Lima y Callao: " + lines.map((l) => l.short || l.id).join(", ") + ". Pregúntame por una línea concreta.";
    return 'Puedo contarte sobre la red de Lima: prueba “¿cuántas estaciones tiene la Línea 1?”, “¿qué es el Metropolitano?”, “reparto modal” o “pasajeros por día”.';
  }

  function pick(data) {
    if (!data) return null;
    if (typeof data === "string") return data;
    return data.reply || data.message || data.answer || data.response || data.text || data.content ||
      (data.choices && data.choices[0] && ((data.choices[0].message && data.choices[0].message.content) || data.choices[0].text)) || null;
  }

  async function gateway(text) {
    const res = await fetch(CHAT.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Client-Token": CHAT.token },
      body: JSON.stringify({ messages: [{ role: "system", content: CHAT.system }].concat(history.slice(-12)) }),
    });
    const raw = await res.text(); let data; try { data = JSON.parse(raw); } catch (e) { data = raw; }
    if (!res.ok) throw new Error((data && data.error) || "HTTP " + res.status);
    return pick(data) || "…";
  }

  async function handle(text) {
    text = (text || "").trim(); if (!text || busy) return;
    GLT.track && GLT.track("chat_message");
    add("me", text); history.push({ role: "user", content: text });
    busy = true; $("chatSend").disabled = true;
    const t = typing();
    let reply;
    try {
      if (CHAT.token) { try { reply = await gateway(text); } catch (e) { reply = localAnswer(text); } }
      else reply = localAnswer(text);
    } catch (e) { reply = localAnswer(text); }
    t.remove(); add("bot", reply); history.push({ role: "assistant", content: reply });
    busy = false; $("chatSend").disabled = false; $("chatInput").focus();
  }

  function toggle(v) {
    open = v == null ? !open : v;
    $("chatPanel").hidden = !open;
    $("chatFab").classList.toggle("hide", open);
    if (open) { greet(); GLT.track && GLT.track("chat_open"); setTimeout(() => $("chatInput").focus(), 60); }
  }

  function init() {
    const form = $("chatForm"); form.querySelector("button[type=submit]").id = "chatSend";
    $("chatFab").addEventListener("click", () => toggle());
    $("chatClose").addEventListener("click", () => toggle(false));
    form.addEventListener("submit", (e) => { e.preventDefault(); const i = $("chatInput"), v = i.value; i.value = ""; handle(v); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && open) toggle(false); });
  }

  window.GLT = window.GLT || {};
  window.GLT.chat = { init, handle };
})();
