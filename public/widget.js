/**
 * AI Revenue Agent Platform — Embeddable Customer Widget
 *
 * Installed on any website via either:
 *   <script src="https://cdn.platform.com/widget.js" data-agent="PUBLIC_AGENT_ID" async></script>   (legacy — still fully supported)
 *   <script src="https://cdn.platform.com/widget.js" data-widget="PUBLIC_WIDGET_ID" async></script>  (new — multi-agent-routing spec Part A §5)
 *
 * Existing installs using data-agent are NOT required to change anything —
 * they keep resolving to the exact same agent they always have (see
 * ensureLegacyWidgetForAgent in src/modules/widgets/service.ts). data-widget
 * is only for new installs or a tenant deliberately opting into multi-agent
 * routing.
 *
 * Independent of the back-office app (spec section 1): this is a
 * self-contained, framework-free script. It renders inside a Shadow DOM so
 * host-site CSS can never leak in or out. Only the public, restricted
 * `data-agent`/`data-widget` identifier is ever exposed in the page source —
 * no secret credentials are embedded here (spec: "Do not expose secret
 * credentials in browser code. Use only restricted public widget
 * identifiers.").
 */
(function () {
  "use strict";

  var currentScript = document.currentScript || (function () {
    var scripts = document.getElementsByTagName("script");
    return scripts[scripts.length - 1];
  })();

  var AGENT_ID = currentScript.getAttribute("data-agent");
  var WIDGET_ID = currentScript.getAttribute("data-widget");
  if (!AGENT_ID && !WIDGET_ID) {
    console.error("[AI Revenue Agent widget] Missing data-agent or data-widget attribute.");
    return;
  }
  // Storage/session namespace — legacy installs keep their existing
  // AGENT_ID-based keys unchanged (so returning visitors don't lose their
  // in-progress conversation on redeploy); new data-widget installs get
  // their own WIDGET_ID-based namespace.
  var STORAGE_ID = WIDGET_ID || AGENT_ID;
  var API_BASE = (function () {
    try {
      return new URL(currentScript.src).origin;
    } catch (e) {
      return "";
    }
  })();

  function qs(name) {
    var params = new URLSearchParams(window.location.search);
    return params.get(name) || undefined;
  }

  function getOrCreateSessionId() {
    var key = "ara_session_id_" + STORAGE_ID;
    var existing = window.localStorage.getItem(key);
    if (existing) return existing;
    var id = "sess_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    window.localStorage.setItem(key, id);
    return id;
  }

  function getFirstLandingPage() {
    var key = "ara_first_landing_" + STORAGE_ID;
    var existing = window.localStorage.getItem(key);
    if (existing) return existing;
    window.localStorage.setItem(key, window.location.href);
    return window.location.href;
  }

  var sessionId = getOrCreateSessionId();
  var conversationId = null;
  var aiActive = true;
  var pollTimer = null;
  var open = false;
  var config = { name: "Assistant", greeting: "Hi! How can I help you today?", widgetColor: "#4F46E5", launcherPosition: "bottom-right" };

  // ---- Shadow DOM host -----------------------------------------------
  var host = document.createElement("div");
  host.id = "ai-revenue-agent-widget-host";
  document.body.appendChild(host);
  var shadow = host.attachShadow({ mode: "open" });

  var style = document.createElement("style");
  style.textContent = [
    ":host{all:initial}",
    ".ara-root{position:fixed;z-index:2147483000;font-family:system-ui,-apple-system,Segoe UI,sans-serif;bottom:20px;right:20px}",
    ".ara-root.left{right:auto;left:20px}",
    ".ara-launcher{width:56px;height:56px;border-radius:999px;background:var(--ara-color,#4F46E5);box-shadow:0 6px 20px rgba(0,0,0,.2);display:flex;align-items:center;justify-content:center;cursor:pointer;border:none}",
    ".ara-launcher svg{width:26px;height:26px}",
    ".ara-panel{position:absolute;bottom:70px;right:0;width:340px;max-width:92vw;height:480px;max-height:75vh;background:#fff;border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,.25);display:flex;flex-direction:column;overflow:hidden;opacity:0;transform:translateY(12px);pointer-events:none;transition:opacity .15s ease,transform .15s ease}",
    ".ara-root.left .ara-panel{right:auto;left:0}",
    ".ara-panel.open{opacity:1;transform:translateY(0);pointer-events:auto}",
    ".ara-header{background:var(--ara-color,#4F46E5);color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px}",
    ".ara-avatar{width:32px;height:32px;border-radius:999px;background:rgba(255,255,255,.25);display:flex;align-items:center;justify-content:center;font-weight:600;font-size:13px}",
    ".ara-header-text .name{font-size:13.5px;font-weight:600}",
    ".ara-header-text .status{font-size:11px;opacity:.85}",
    ".ara-close{margin-left:auto;background:none;border:none;color:#fff;cursor:pointer;opacity:.85;padding:4px}",
    ".ara-messages{flex:1;overflow-y:auto;padding:12px;background:#f7f7f8;display:flex;flex-direction:column;gap:8px}",
    ".ara-msg{max-width:80%;padding:8px 12px;border-radius:14px;font-size:13px;line-height:1.4;white-space:pre-wrap;word-break:break-word}",
    ".ara-msg.customer{align-self:flex-end;background:var(--ara-color,#4F46E5);color:#fff;border-bottom-right-radius:4px}",
    ".ara-msg.other{align-self:flex-start;background:#fff;color:#18181b;border:1px solid #e5e5e5;border-bottom-left-radius:4px}",
    ".ara-typing{align-self:flex-start;font-size:11px;color:#888;padding-left:4px}",
    ".ara-consent{font-size:10.5px;color:#888;padding:6px 12px;background:#fff;border-top:1px solid #eee}",
    ".ara-inputrow{display:flex;gap:6px;padding:10px;border-top:1px solid #eee;background:#fff}",
    ".ara-input{flex:1;border:1px solid #ddd;border-radius:999px;padding:8px 14px;font-size:13px;outline:none}",
    ".ara-send{background:var(--ara-color,#4F46E5);border:none;color:#fff;width:36px;height:36px;border-radius:999px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0}",
    ".ara-send:disabled{opacity:.5;cursor:default}",
    ".ara-wa{display:block;text-align:center;font-size:11.5px;color:var(--ara-color,#4F46E5);padding:6px;text-decoration:none;border-top:1px solid #eee;background:#fff}",
  ].join("\n");
  shadow.appendChild(style);

  var root = document.createElement("div");
  root.className = "ara-root";
  shadow.appendChild(root);

  var launcher = document.createElement("button");
  launcher.className = "ara-launcher";
  launcher.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>';
  root.appendChild(launcher);

  var panel = document.createElement("div");
  panel.className = "ara-panel";
  root.appendChild(panel);

  var header = document.createElement("div");
  header.className = "ara-header";
  panel.appendChild(header);

  var avatar = document.createElement("div");
  avatar.className = "ara-avatar";
  header.appendChild(avatar);

  var headerText = document.createElement("div");
  headerText.className = "ara-header-text";
  headerText.innerHTML = '<div class="name"></div><div class="status">● Online</div>';
  header.appendChild(headerText);

  var closeBtn = document.createElement("button");
  closeBtn.className = "ara-close";
  closeBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  header.appendChild(closeBtn);

  var messagesEl = document.createElement("div");
  messagesEl.className = "ara-messages";
  panel.appendChild(messagesEl);

  var consentEl = document.createElement("div");
  consentEl.className = "ara-consent";
  consentEl.textContent = "By chatting, you agree we may store your messages to respond to your enquiry.";
  panel.appendChild(consentEl);

  var inputRow = document.createElement("div");
  inputRow.className = "ara-inputrow";
  panel.appendChild(inputRow);

  var input = document.createElement("input");
  input.className = "ara-input";
  input.placeholder = "Type a message…";
  inputRow.appendChild(input);

  var sendBtn = document.createElement("button");
  sendBtn.className = "ara-send";
  sendBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="m22 2-7 20-4-9-9-4Z"/></svg>';
  inputRow.appendChild(sendBtn);

  var renderedIds = {};
  var messageEls = {};

  function renderMessages(messages) {
    for (var i = 0; i < messages.length; i++) {
      var m = messages[i];
      if (renderedIds[m.id]) continue;
      renderedIds[m.id] = true;
      var bubble = document.createElement("div");
      bubble.className = "ara-msg " + (m.sender === "CUSTOMER" ? "customer" : "other");
      bubble.textContent = m.content;
      messagesEl.appendChild(bubble);
      messageEls[m.id] = bubble;
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // Removes a locally-rendered optimistic bubble once the server's
  // authoritative message list (with a real id) is about to be rendered in
  // its place — otherwise the same customer message shows up twice, since
  // the optimistic id never matches the persisted row's id.
  function clearOptimistic(localId) {
    var el = messageEls[localId];
    if (el) el.remove();
    delete messageEls[localId];
    delete renderedIds[localId];
  }

  function setTyping(isTyping) {
    var existing = shadow.querySelector(".ara-typing");
    if (isTyping && !existing) {
      var t = document.createElement("div");
      t.className = "ara-typing";
      t.textContent = config.name + " is typing…";
      messagesEl.appendChild(t);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    } else if (!isTyping && existing) {
      existing.remove();
    }
  }

  async function loadConfig() {
    try {
      var url = WIDGET_ID ? API_BASE + "/api/public/widgets/" + WIDGET_ID : API_BASE + "/api/public/agents/" + AGENT_ID;
      var res = await fetch(url);
      var json = await res.json();
      if (json.data) {
        config = json.data;
        applyConfig();
      }
    } catch (e) {
      /* offline / network error — widget still opens with defaults */
    }
  }

  function applyConfig() {
    root.style.setProperty("--ara-color", config.widgetColor || "#4F46E5");
    if (config.launcherPosition === "bottom-left") root.classList.add("left");
    headerText.querySelector(".name").textContent = config.name || "Assistant";
    avatar.textContent = (config.name || "A").slice(0, 1).toUpperCase();
  }

  async function startConversation() {
    var body = {
      publicAgentId: WIDGET_ID ? undefined : AGENT_ID,
      publicWidgetId: WIDGET_ID || undefined,
      sessionId: sessionId,
      channel: "WEBSITE",
      landingPage: getFirstLandingPage(),
      referringUrl: document.referrer || undefined,
      currentPage: window.location.href,
      utmSource: qs("utm_source"),
      utmMedium: qs("utm_medium"),
      utmCampaign: qs("utm_campaign"),
      utmContent: qs("utm_content"),
      utmTerm: qs("utm_term"),
      gclid: qs("gclid"),
      fbclid: qs("fbclid"),
      consentAcknowledged: true,
    };
    var res = await fetch(API_BASE + "/api/public/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    var json = await res.json();
    if (json.data) {
      conversationId = json.data.conversationId;
      aiActive = json.data.aiActive;
      renderMessages(json.data.messages || []);
      startPolling();
    }
  }

  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(async function () {
      if (!conversationId) return;
      try {
        var res = await fetch(API_BASE + "/api/public/conversations/" + conversationId + "/messages");
        var json = await res.json();
        if (json.data) {
          renderMessages(json.data.messages || []);
          aiActive = json.data.aiActive;
        }
      } catch (e) {}
    }, 3500);
  }

  async function send() {
    var text = input.value.trim();
    if (!text || !conversationId) return;
    input.value = "";
    sendBtn.disabled = true;
    var optimistic = { id: "local_" + Date.now(), sender: "CUSTOMER", content: text };
    renderMessages([optimistic]);
    setTyping(true);
    try {
      var res = await fetch(API_BASE + "/api/public/conversations/" + conversationId + "/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: text }),
      });
      var json = await res.json();
      setTyping(false);
      clearOptimistic(optimistic.id);
      if (json.data) {
        renderMessages(json.data.messages || []);
        aiActive = json.data.aiActive;
      }
    } catch (e) {
      setTyping(false);
      // Request failed — leave the optimistic bubble in place (with the
      // customer's own text) rather than silently discarding what they typed.
    } finally {
      sendBtn.disabled = false;
    }
  }

  sendBtn.addEventListener("click", send);
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") send();
  });

  launcher.addEventListener("click", function () {
    open = !open;
    panel.classList.toggle("open", open);
    if (open && !conversationId) {
      startConversation();
    }
  });
  closeBtn.addEventListener("click", function () {
    open = false;
    panel.classList.remove("open");
  });

  loadConfig();
})();
