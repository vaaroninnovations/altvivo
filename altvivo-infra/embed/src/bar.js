/*!
 * <altvivo-topbar> v1.1.0 - shared AltVivo bar for every *.altvivo.bio app.
 * Zero dependencies. Waffle app switcher with licence status (licensed /
 * locked -> upgrade), live credit balance, account menu, silent session
 * refresh and cross-tab sign-out.
 *
 *   <script src="https://embed.altvivo.bio/bar.js" defer crossorigin="anonymous"></script>
 *   <altvivo-topbar app="xprism"></altvivo-topbar>
 *
 * Attributes: app (current app id), api (default https://api.altvivo.bio),
 *             home (default https://altvivo.bio), theme (auto | light | dark),
 *             sticky (present by default; set sticky="false" to disable)
 * Events (bubble, composed): altvivo:session {detail:{user}}, altvivo:signedout
 * API: el.user, el.apps, el.refresh(), el.signOut()
 */
(() => {
  "use strict";
  if (typeof window === "undefined" || !window.customElements || customElements.get("altvivo-topbar")) return;

  const VERSION = "1.1.0";
  const CHANNEL = "altvivo-session";
  const VIP_ROLES = new Set(["SUPERADMIN", "ADVISORY_BOARD"]);

  // --------------------------------------------------------------- icons ---
  // 24x24 stroke paths (lucide-style), drawn with DOM APIs (no innerHTML).
  const ICONS = {
    grid: ["M4 4h4v4H4z", "M10 4h4v4h-4z", "M16 4h4v4h-4z", "M4 10h4v4H4z", "M10 10h4v4h-4z", "M16 10h4v4h-4z", "M4 16h4v4H4z", "M10 16h4v4h-4z", "M16 16h4v4h-4z"],
    "flask-conical": ["M10 2v7.31L4.5 19.5A1.5 1.5 0 0 0 5.8 22h12.4a1.5 1.5 0 0 0 1.3-2.5L14 9.31V2", "M8.5 2h7", "M7 16h10"],
    "scan-eye": ["M3 7V5a2 2 0 0 1 2-2h2", "M17 3h2a2 2 0 0 1 2 2v2", "M21 17v2a2 2 0 0 1-2 2h-2", "M7 21H5a2 2 0 0 1-2-2v-2", "M5 12s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z", "M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z"],
    pill: ["m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7z", "m8.5 8.5 7 7"],
    sigma: ["M18 7V4H6l6 8-6 8h12v-3"],
    leaf: ["M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z", "M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"],
    "file-search": ["M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h4", "M14 2v6h6", "M20 8v3", "M16.5 18.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z", "m21 22-2.7-2.7"],
    box: ["M21 8 12 3 3 8v8l9 5 9-5z", "M3 8l9 5 9-5", "M12 13v8"],
    zap: ["M13 2 3 14h9l-1 8 10-12h-9l1-8z"],
    lock: ["M5 11h14v10H5z", "M8 11V7a4 4 0 0 1 8 0v4"],
    chevron: ["m6 9 6 6 6-6"],
    external: ["M15 3h6v6", "M10 14 21 3", "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"],
  };

  const SVG_NS = "http://www.w3.org/2000/svg";
  function icon(name, size = 18) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.8");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    for (const d of ICONS[name] || ICONS.box) {
      const p = document.createElementNS(SVG_NS, "path");
      p.setAttribute("d", d);
      svg.appendChild(p);
    }
    return svg;
  }

  function el(tag, attrs = {}, ...children) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else n.setAttribute(k, v === true ? "" : String(v));
    }
    for (const c of children) if (c != null) n.append(c);
    return n;
  }

  // ---------------------------------------------------------------- styles --
  const CSS = `
:host { --av-bg:#ffffff; --av-fg:#0B0F19; --av-muted:#64748B; --av-line:#E2E8F0; --av-soft:#F1F5F9;
  --av-accent:#0EA5E9; --av-accent-ink:#0369A1; --av-live:#10B981; --av-soon:#F59E0B; --av-shadow:0 12px 32px rgba(15,23,42,.14);
  display:block; position:sticky; top:0; z-index:2147483000; font-family:"Plus Jakarta Sans",Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  font-size:14px; line-height:1.3; color:var(--av-fg); -webkit-font-smoothing:antialiased; }
:host([sticky="false"]) { position:relative; }
:host([data-theme="dark"]) { --av-bg:#070B14; --av-fg:#F8FAFC; --av-muted:#94A3B8; --av-line:#1E293B; --av-soft:#111827;
  --av-accent-ink:#7DD3FC; --av-shadow:0 12px 32px rgba(0,0,0,.5); }
*, *::before, *::after { box-sizing:border-box; }
.bar { height:48px; display:flex; align-items:center; gap:8px; padding:0 12px; background:var(--av-bg);
  border-bottom:1px solid var(--av-line); }
a { color:inherit; text-decoration:none; }
button { font:inherit; color:inherit; background:none; border:0; cursor:pointer; }
:focus-visible { outline:2px solid var(--av-accent); outline-offset:2px; border-radius:8px; }
.brand { display:flex; align-items:center; gap:8px; font-weight:700; letter-spacing:-.01em; padding:4px 6px; border-radius:8px; }
.mark { width:22px; height:22px; border-radius:6px; background:linear-gradient(135deg,#0EA5E9,#10B981); display:grid; place-items:center; color:#fff; }
.sep { width:1px; height:20px; background:var(--av-line); margin:0 2px; }
.current { font-weight:600; color:var(--av-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:40vw; }
.spacer { flex:1; }
.iconbtn { width:36px; height:36px; display:grid; place-items:center; border-radius:10px; color:var(--av-muted); }
.iconbtn:hover, .iconbtn[aria-expanded="true"] { background:var(--av-soft); color:var(--av-fg); }
.credits { display:flex; align-items:center; gap:6px; height:30px; padding:0 10px; border:1px solid var(--av-line); border-radius:999px;
  font-family:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12.5px; font-variant-numeric:tabular-nums; }
.credits svg { color:var(--av-accent); }
.credits:hover { border-color:var(--av-accent); }
.avatar { width:32px; height:32px; border-radius:50%; display:grid; place-items:center; font-weight:700; font-size:12px; color:#fff;
  background:linear-gradient(135deg,#0EA5E9,#6366F1); }
.signin { height:32px; padding:0 14px; border-radius:8px; background:var(--av-accent); color:#fff; font-weight:600; display:flex; align-items:center; }
.wrap { position:relative; }
.panel { position:absolute; right:0; top:calc(100% + 8px); background:var(--av-bg); border:1px solid var(--av-line); border-radius:14px;
  box-shadow:var(--av-shadow); padding:12px; animation:av-in .14s ease-out; }
.panel[hidden] { display:none; }
@keyframes av-in { from { opacity:0; transform:translateY(-4px); } to { opacity:1; transform:none; } }
@media (prefers-reduced-motion: reduce) { .panel { animation:none; } }
.waffle { width:min(380px, calc(100vw - 24px)); max-height:min(70vh, 560px); overflow:auto; }
.ptitle { font-size:11px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:var(--av-muted); margin:6px 6px 8px; }
.grid { display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-bottom:8px; }
.tile { display:flex; flex-direction:column; gap:6px; padding:10px; border-radius:10px; border:1px solid transparent; min-height:84px; position:relative; }
.tile:hover { background:var(--av-soft); border-color:var(--av-line); }
.tile[aria-current="page"] { border-color:var(--av-accent); background:color-mix(in srgb, var(--av-accent) 7%, transparent); }
.tile .ic { width:32px; height:32px; border-radius:9px; display:grid; place-items:center; background:var(--av-soft); color:var(--av-accent-ink); }
.tile .nm { font-weight:600; font-size:13.5px; display:flex; align-items:center; gap:6px; }
.tile .tg { font-size:11.5px; color:var(--av-muted); display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
.tile.soon { opacity:.82; }
.pill { font-family:"JetBrains Mono",ui-monospace,monospace; font-size:9.5px; font-weight:700; letter-spacing:.06em; padding:2px 6px; border-radius:999px;
  border:1px solid currentColor; line-height:1.4; text-transform:uppercase; }
.pill.soon { color:var(--av-soon); }
.pill.beta { color:var(--av-accent); }
.pill.live { color:var(--av-live); }
.pill.maint { color:var(--av-muted); }
.pill.lock { color:var(--av-soon); display:inline-flex; align-items:center; gap:3px; }
.pill.vip { color:var(--av-accent); }
.tile.locked .ic { color:var(--av-muted); }
.badge { position:absolute; top:10px; right:10px; }
.foot { display:flex; justify-content:space-between; align-items:center; border-top:1px solid var(--av-line); padding:10px 6px 2px; margin-top:4px;
  font-size:12.5px; color:var(--av-muted); }
.foot a { color:var(--av-accent-ink); font-weight:600; display:inline-flex; gap:4px; align-items:center; }
.menu { width:260px; padding:6px; }
.who { padding:10px 10px 12px; border-bottom:1px solid var(--av-line); margin-bottom:6px; }
.who .n { font-weight:600; }
.who .e { color:var(--av-muted); font-size:12.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.who .t { margin-top:8px; display:inline-block; font-family:"JetBrains Mono",ui-monospace,monospace; font-size:10.5px; color:var(--av-accent-ink);
  background:color-mix(in srgb, var(--av-accent) 12%, transparent); padding:2px 8px; border-radius:999px; }
.mi { display:flex; width:100%; text-align:left; padding:9px 10px; border-radius:8px; font-size:13.5px; }
.mi:hover, .mi:focus-visible { background:var(--av-soft); }
.mi.danger { color:#DC2626; }
.warn { margin:0 0 8px; padding:8px 10px; border-radius:8px; font-size:12px; background:color-mix(in srgb, var(--av-soon) 14%, transparent); }
.sr { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; }
@media (max-width: 560px) {
  .current, .brand .word, .sep { display:none; } .credits .lbl { display:none; }
  /* Pin menus to the viewport so they never run off-screen on phones. */
  .panel { position:fixed; left:12px; right:12px; top:56px; width:auto; max-height:calc(100dvh - 72px); overflow:auto; }
}
`;

  let sheet = null;
  function styleFor(root) {
    try {
      if (!sheet) {
        sheet = new CSSStyleSheet();
        sheet.replaceSync(CSS);
      }
      root.adoptedStyleSheets = [sheet];
    } catch {
      root.append(el("style", { text: CSS }));
    }
  }

  // --------------------------------------------------------------- helpers --
  function readCookie(name) {
    for (const part of document.cookie ? document.cookie.split("; ") : []) {
      const i = part.indexOf("=");
      if (part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
    }
    return null;
  }

  function initials(name, email) {
    const parts = String(name || "").trim().split(/\s+/).filter((p) => /^[\p{L}]/u.test(p) && !/^dr\.?$/i.test(p));
    const s = parts.length ? parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "") : String(email || "?")[0];
    return s.toUpperCase();
  }

  function trustedUrl(raw, homeOrigin) {
    try {
      const u = new URL(raw, homeOrigin);
      const ok = (u.protocol === "https:" && (u.hostname === "altvivo.bio" || u.hostname.endsWith(".altvivo.bio")))
        || u.origin === location.origin || u.origin === homeOrigin;
      return ok ? u.href : null;
    } catch {
      return null;
    }
  }

  const fmt = new Intl.NumberFormat(undefined);

  // ------------------------------------------------------------- element ---
  class AltVivoTopbar extends HTMLElement {
    static get observedAttributes() { return ["app", "theme"]; }

    constructor() {
      super();
      this._root = this.attachShadow({ mode: "open" });
      styleFor(this._root);
      this._user = null;
      this._apps = [];
      this._open = null; // "apps" | "account" | null
      this._timer = 0;
      this._refreshing = null;
      this._channel = "BroadcastChannel" in window ? new BroadcastChannel(CHANNEL) : null;
      this._onDocClick = (e) => { if (this._open && !e.composedPath().includes(this)) this._close(); };
      this._onKey = (e) => this._keydown(e);
      this._onVisible = () => { if (document.visibilityState === "visible" && this._due()) this.refresh(); };
      this._mql = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
      this._onScheme = () => this._applyTheme();
    }

    get api() { return (this.getAttribute("api") || "https://api.altvivo.bio").replace(/\/$/, ""); }
    get home() { return (this.getAttribute("home") || "https://altvivo.bio").replace(/\/$/, ""); }
    get appId() { return (this.getAttribute("app") || "").toLowerCase(); }
    get user() { return this._user; }
    get apps() { return this._apps.slice(); }

    connectedCallback() {
      this._applyTheme();
      this._mql?.addEventListener?.("change", this._onScheme);
      document.addEventListener("click", this._onDocClick, true);
      document.addEventListener("visibilitychange", this._onVisible);
      this.addEventListener("keydown", this._onKey);
      if (this._channel) this._channel.onmessage = (m) => this._onBroadcast(m.data);
      this._render();
      this._load();
    }

    disconnectedCallback() {
      clearTimeout(this._timer);
      this._mql?.removeEventListener?.("change", this._onScheme);
      document.removeEventListener("click", this._onDocClick, true);
      document.removeEventListener("visibilitychange", this._onVisible);
      this.removeEventListener("keydown", this._onKey);
      if (this._channel) this._channel.onmessage = null;
    }

    attributeChangedCallback() {
      if (this.isConnected) { this._applyTheme(); this._render(); }
    }

    _applyTheme() {
      const t = this.getAttribute("theme") || "auto";
      const dark = t === "dark" || (t === "auto" && this._mql?.matches);
      this.setAttribute("data-theme", dark ? "dark" : "light");
    }

    // --------------------------------------------------------------- data --
    async _load() {
      const [apps] = await Promise.allSettled([this._fetchApps(), this._fetchSession()]);
      if (apps.status === "rejected") this._apps = [];
      this._render();
    }

    async _fetchApps() {
      const r = await fetch(`${this.api}/v1/public/apps`, { credentials: "omit", headers: { Accept: "application/json" } });
      if (!r.ok) throw new Error(`apps ${r.status}`);
      const data = await r.json();
      this._apps = Array.isArray(data.apps) ? data.apps : [];
    }

    async _fetchSession() {
      const r = await fetch(`${this.api}/v1/auth/session`, { credentials: "include", headers: { Accept: "application/json" } });
      if (r.ok) return this._setUser((await r.json()).user);
      if (r.status === 401) return this.refresh();
      if (r.status === 403) {
        // Signed in but blocked (e.g. MFA enrolment pending): show as signed out.
        return this._setUser(null);
      }
    }

    async _csrf() {
      const existing = readCookie("altvivo_csrf");
      if (existing) return existing;
      const r = await fetch(`${this.api}/v1/auth/csrf`, { credentials: "include" });
      if (!r.ok) throw new Error("csrf");
      return (await r.json()).csrfToken;
    }

    /** Rotates the session (refresh cookie) and re-reads the profile. */
    refresh() {
      if (this._refreshing) return this._refreshing;
      this._refreshing = (async () => {
        try {
          const r = await fetch(`${this.api}/v1/auth/refresh`, {
            method: "POST",
            credentials: "include",
            headers: { "X-CSRF-Token": await this._csrf(), Accept: "application/json" },
          });
          if (!r.ok) throw new Error(`refresh ${r.status}`);
          this._setUser((await r.json()).user);
          this._channel?.postMessage({ type: "refreshed" });
        } catch {
          this._setUser(null);
        } finally {
          this._refreshing = null;
          this._render();
        }
      })();
      return this._refreshing;
    }

    async signOut() {
      try {
        await fetch(`${this.api}/v1/auth/logout`, {
          method: "POST",
          credentials: "include",
          headers: { "X-CSRF-Token": await this._csrf() },
        });
      } catch {
        /* the redirect below still ends the local view of the session */
      }
      this._channel?.postMessage({ type: "signedout" });
      this._setUser(null);
      location.assign(`${this.home}/`);
    }

    _setUser(user) {
      const was = this._user;
      this._user = user && typeof user === "object" ? user : null;
      clearTimeout(this._timer);
      if (this._user) {
        const exp = Date.parse(this._user.accessTokenExpiresAt || "");
        if (Number.isFinite(exp)) {
          const wait = Math.max(10_000, exp - Date.now() - 60_000);
          this._timer = setTimeout(() => this.refresh(), Math.min(wait, 2_147_000_000));
        }
        this.dispatchEvent(new CustomEvent("altvivo:session", { detail: { user: this._user }, bubbles: true, composed: true }));
      } else if (was) {
        this.dispatchEvent(new CustomEvent("altvivo:signedout", { bubbles: true, composed: true }));
      }
      this._render();
    }

    _due() {
      const exp = Date.parse(this._user?.accessTokenExpiresAt || "");
      return !Number.isFinite(exp) || exp - Date.now() < 60_000;
    }

    _onBroadcast(msg) {
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "signedout") this._setUser(null);
      if (msg.type === "refreshed") this._fetchSession().catch(() => {});
    }

    // ------------------------------------------------------------- render --
    _render() {
      const root = this._root;
      for (const n of [...root.childNodes]) if (n.nodeName !== "STYLE") n.remove();
      const current = this._apps.find((a) => a.appId === this.appId);
      const bar = el("header", { class: "bar", part: "bar", role: "banner", "aria-label": "AltVivo" });

      const brand = el("a", { class: "brand", href: `${this.home}/`, title: "AltVivo home" },
        el("span", { class: "mark" }, icon("zap", 14)), el("span", { class: "word", text: "AltVivo" }));
      bar.append(brand);
      if (current) bar.append(el("span", { class: "sep", "aria-hidden": "true" }), el("span", { class: "current", text: current.name }));
      bar.append(el("span", { class: "spacer" }));

      if (this._user) {
        const credits = el("a", {
          class: "credits", href: `${this.home}/workspace/billing`,
          title: "Compute credits remaining", "aria-label": `${fmt.format(this._user.creditsRemaining ?? 0)} compute credits remaining`,
        }, icon("zap", 14), el("span", { text: fmt.format(this._user.creditsRemaining ?? 0) }), el("span", { class: "lbl", text: "credits" }));
        bar.append(credits);
      }

      // Waffle
      const appsWrap = el("div", { class: "wrap" });
      const appsBtn = el("button", {
        class: "iconbtn", type: "button", "aria-haspopup": "dialog", "aria-expanded": this._open === "apps" ? "true" : "false",
        "aria-controls": "av-apps", title: "AltVivo apps",
      }, icon("grid", 18), el("span", { class: "sr", text: "Switch AltVivo app" }));
      appsBtn.addEventListener("click", () => this._toggle("apps"));
      appsWrap.append(appsBtn, this._appsPanel());
      bar.append(appsWrap);

      if (this._user) {
        const accWrap = el("div", { class: "wrap" });
        const accBtn = el("button", {
          class: "iconbtn", type: "button", "aria-haspopup": "menu", "aria-expanded": this._open === "account" ? "true" : "false",
          "aria-controls": "av-account", title: this._user.name || "Account",
        }, el("span", { class: "avatar", "aria-hidden": "true", text: initials(this._user.name, this._user.email) }),
          el("span", { class: "sr", text: `Account menu for ${this._user.name || this._user.email}` }));
        accBtn.addEventListener("click", () => this._toggle("account"));
        accWrap.append(accBtn, this._accountMenu());
        bar.append(accWrap);
      } else {
        const next = encodeURIComponent(location.href);
        bar.append(el("a", { class: "signin", href: `${this.home}/login?next=${next}`, text: "Sign in" }));
      }
      root.append(bar);
    }

    _appsPanel() {
      const panel = el("div", { class: "panel waffle", id: "av-apps", role: "dialog", "aria-label": "AltVivo apps", hidden: this._open !== "apps" });
      const ents = this._user?.entitlements || {};
      const live = this._apps.filter((a) => a.status === "LIVE" || a.status === "BETA" || a.status === "MAINTENANCE");
      const soon = this._apps.filter((a) => a.status === "COMING_SOON");
      if (!this._apps.length) panel.append(el("p", { class: "warn", text: "Apps are unavailable right now. Please retry shortly." }));

      const section = (title, list, isSoon) => {
        if (!list.length) return;
        panel.append(el("p", { class: "ptitle", text: title }));
        const grid = el("div", { class: "grid", role: "list" });
        for (const a of list) {
          const isCurrent = a.appId === this.appId;
          const licence = this._licence(a.appId, ents);
          const locked = !isSoon && this._user && licence === "locked";
          // Locked apps go straight to the upgrade page instead of bouncing off the paid gate.
          const href = locked ? this._upgradeUrl(a.appId) : trustedUrl(a.url, this.home);
          const tile = el(href ? "a" : "div", {
            class: `tile${isSoon ? " soon" : ""}${locked ? " locked" : ""}`, role: "listitem", href: href || undefined,
            "aria-current": isCurrent ? "page" : undefined,
            "aria-label": `${a.name}${isSoon ? ", coming soon" : ""}${locked ? ", locked, upgrade required" : ""}${isCurrent ? ", current app" : ""}`,
          });
          tile.append(el("span", { class: "ic" }, icon(a.iconKey, 18)));
          const name = el("span", { class: "nm", text: a.name });
          if (a.status === "BETA") name.append(el("span", { class: "pill beta", text: "Beta" }));
          tile.append(name, el("span", { class: "tg", text: a.tagline || "" }));
          let badge = null;
          if (isSoon) badge = el("span", { class: "pill soon", text: "Soon" });
          else if (a.status === "MAINTENANCE") badge = el("span", { class: "pill maint", text: "Maint." });
          else if (this._user && licence === "vip") badge = el("span", { class: "pill vip", text: "VIP" });
          else if (this._user && licence === "licensed") badge = el("span", { class: "pill live", text: "Licensed" });
          else if (this._user) badge = el("span", { class: "pill lock" }, icon("lock", 10), document.createTextNode("Locked"));
          if (badge) tile.append(el("span", { class: "badge" }, badge));
          grid.append(tile);
        }
        panel.append(grid);
      };
      section("Available now", live, false);
      section("Coming soon", soon, true);
      const foot = el("div", { class: "foot" }, el("span", { text: `v${VERSION}` }),
        el("a", { href: `${this.home}/workspace` }, document.createTextNode("Open workspace"), icon("external", 13)));
      panel.append(foot);
      return panel;
    }

    /** "vip" | "licensed" | "locked" from the session's paid entitlements. */
    _licence(appId, ents) {
      if (VIP_ROLES.has(this._user?.role)) return "vip";
      const e = ents[appId];
      if (!e || typeof e !== "object" || e.active !== true) return "locked";
      const exp = e.expiresAt ? Date.parse(e.expiresAt) : NaN;
      return Number.isFinite(exp) && exp <= Date.now() ? "locked" : "licensed";
    }

    _upgradeUrl(appId) {
      return `${this.home}/workspace/upgrade?app=${encodeURIComponent(appId)}&reason=subscription_required`;
    }

    _accountMenu() {
      const u = this._user;
      const menu = el("div", { class: "panel menu", id: "av-account", role: "menu", "aria-label": "Account", hidden: this._open !== "account" });
      const who = el("div", { class: "who", role: "presentation" },
        el("div", { class: "n", text: u.name || "AltVivo user" }), el("div", { class: "e", text: u.email || "" }));
      if (u.tier) who.append(el("span", { class: "t", text: String(u.tier).replace(/_/g, " ") }));
      menu.append(who);
      if (u.emailVerified === false) menu.append(el("p", { class: "warn", text: "Verify your email to unlock trial access." }));
      const item = (label, href) => el("a", { class: "mi", role: "menuitem", href, tabindex: "-1", text: label });
      menu.append(item("Workspace", `${this.home}/workspace`), item("Account & security", `${this.home}/workspace/security`),
        item("Billing & credits", `${this.home}/workspace/billing`));
      const out = el("button", { class: "mi danger", role: "menuitem", type: "button", tabindex: "-1", text: "Sign out" });
      out.addEventListener("click", () => this.signOut());
      menu.append(out);
      return menu;
    }

    // -------------------------------------------------------- interaction --
    _toggle(which) {
      this._open = this._open === which ? null : which;
      this._render();
      if (this._open) {
        const panel = this._root.getElementById(this._open === "apps" ? "av-apps" : "av-account");
        const first = panel?.querySelector("a[href], button");
        first?.focus();
      }
    }

    _close(returnFocus = false) {
      const was = this._open;
      this._open = null;
      this._render();
      if (returnFocus && was) {
        const btn = this._root.querySelector(`[aria-controls="${was === "apps" ? "av-apps" : "av-account"}"]`);
        btn?.focus();
      }
    }

    _keydown(e) {
      if (!this._open) return;
      if (e.key === "Escape") {
        e.preventDefault();
        this._close(true);
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
      const panel = this._root.getElementById(this._open === "apps" ? "av-apps" : "av-account");
      const items = [...(panel?.querySelectorAll("a[href], button") || [])];
      if (!items.length) return;
      e.preventDefault();
      const i = items.indexOf(this._root.activeElement);
      const n = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1
        : (i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items[n].focus();
    }
  }

  customElements.define("altvivo-topbar", AltVivoTopbar);
})();
