/* ============================================================
   chat.js — Asistente IA (gateway ai.tunky.net · POST /v1/chat)
   ============================================================ */
(function () {
  "use strict";

  // ---- CONFIG -------------------------------------------------------------
  // El gateway ai.tunky.net exige el header X-Client-Token y valida el Origin
  // (unimauro.github.io ya está en su allowlist). Pega aquí el token del cliente:
  const CHAT = {
    endpoint: "https://ai.tunky.net/v1/chat",
    token: "",                       // <-- X-Client-Token de ai.tunky.net
    system: "Eres el asistente de 'Lima Transporte', un gemelo digital del transporte urbano de Lima y Callao (Metro, Metropolitano y corredores). Responde en español, breve y claro, sobre movilidad y transporte de Lima.",
  };
  // ------------------------------------------------------------------------

  const $ = (id) => document.getElementById(id);
  const history = [];
  let open = false, busy = false, greeted = false;

  function el(cls, html) { const d = document.createElement("div"); d.className = cls; if (html != null) d.innerHTML = html; return d; }
  const esc = (s) => String(s).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));

  function add(role, text) {
    const log = $("chatLog");
    const m = el("msg " + role, esc(text));
    log.appendChild(m); log.scrollTop = log.scrollHeight; return m;
  }
  function typing() {
    const log = $("chatLog");
    const m = el("msg bot", '<span class="typing"><i></i><i></i><i></i></span>');
    log.appendChild(m); log.scrollTop = log.scrollHeight; return m;
  }

  function suggestions() {
    const wrap = el("chat-suggest");
    ["¿Qué es el Metropolitano?", "¿Cuántas estaciones tiene la Línea 1?", "¿Cómo va la Línea 2?"]
      .forEach((q) => { const b = document.createElement("button"); b.textContent = q;
        b.onclick = () => { wrap.remove(); send(q); }; wrap.appendChild(b); });
    $("chatLog").appendChild(wrap);
  }

  function greet() {
    if (greeted) return; greeted = true;
    add("bot", "¡Hola! 👋 Soy el asistente de Lima Transporte. Pregúntame sobre el Metro, el Metropolitano, los corredores o la movilidad de la ciudad.");
    suggestions();
  }

  // extrae el texto de respuesta de formatos variados del gateway
  function pick(data) {
    if (!data) return null;
    if (typeof data === "string") return data;
    return data.reply || data.message || data.answer || data.response || data.text || data.content ||
      (data.choices && data.choices[0] && ((data.choices[0].message && data.choices[0].message.content) || data.choices[0].text)) || null;
  }

  async function send(text) {
    text = (text || "").trim(); if (!text || busy) return;
    add("me", text); history.push({ role: "user", content: text });
    busy = true; $("chatSend").disabled = true;
    const t = typing();
    try {
      const res = await fetch(CHAT.endpoint, {
        method: "POST",
        headers: Object.assign({ "Content-Type": "application/json" }, CHAT.token ? { "X-Client-Token": CHAT.token } : {}),
        body: JSON.stringify({ message: text, messages: history.slice(-12), system: CHAT.system }),
      });
      const raw = await res.text();
      let data; try { data = JSON.parse(raw); } catch (e) { data = raw; }
      t.remove();
      if (!res.ok) {
        const code = res.status;
        const emsg = (data && data.error) ? data.error : ("HTTP " + code);
        if (code === 401 || /autoriz|token|client/i.test(emsg)) {
          add("err", "El asistente aún no está configurado: falta el token de ai.tunky.net (X-Client-Token). Cuando lo tengas, se activa.");
        } else if (code === 403 || /origen/i.test(emsg)) {
          add("err", "Este dominio no está autorizado en el gateway ai.tunky.net todavía.");
        } else {
          add("err", "No pude responder ahora (" + emsg + "). Inténtalo de nuevo en un momento.");
        }
        return;
      }
      const reply = pick(data) || "…";
      add("bot", reply); history.push({ role: "assistant", content: reply });
    } catch (err) {
      t.remove();
      add("err", "Sin conexión con el asistente. Revisa tu red e inténtalo otra vez.");
    } finally {
      busy = false; $("chatSend").disabled = false; $("chatInput").focus();
    }
  }

  function toggle(v) {
    open = v == null ? !open : v;
    $("chatPanel").hidden = !open;
    if (open) { greet(); setTimeout(() => $("chatInput").focus(), 50); }
  }

  function init() {
    // añade id al botón de enviar (submit) para poder deshabilitarlo
    const form = $("chatForm"); form.querySelector("button[type=submit]").id = "chatSend";
    $("chatFab").addEventListener("click", () => toggle());
    $("chatClose").addEventListener("click", () => toggle(false));
    form.addEventListener("submit", (e) => { e.preventDefault(); const i = $("chatInput"); const v = i.value; i.value = ""; send(v); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && open) toggle(false); });
  }

  window.GLT = window.GLT || {};
  window.GLT.chat = { init, send };
})();
