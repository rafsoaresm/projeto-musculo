/**
 * The script of a site with tagging (Meu Site 0.71), served by `/s/<slug>/m/rastreio` with the site's settings embedded. Plain ES2018, no
 * dependency, no eval, no inline handler: it is the only script of a page of the advanced editor and of the thank-you pages, and it runs beside
 * the bundles of the guided ones.
 *
 * What it does, in order:
 * - Consent first. Google's consent mode starts with everything denied; nothing of a tool is loaded before the visitor chooses (basic consent
 *   mode). The choice is kept per site in localStorage (it is the record of a choice, which needs no consent) together with the tools it was
 *   given for, so adding a tool later asks again. The banner has two layers (Aceitar, Recusar and Personalizar, of equal weight; then a
 *   switch per purpose, both off), names the tools, links the site's privacy notice when there is one, and is reopened by "Preferências de
 *   cookies" at the end of the page. Escape closes it as "decide later": nothing is kept and nothing is loaded.
 * - Analytics consent loads GA4 only; marketing consent loads Google Ads (and grants the `ad_*` storages) and the Meta Pixel.
 * - Withdrawing updates the consent to denied, revokes Meta and stops every event (what was loaded stays until the next page; the banner says so).
 * - Events: a click on a WhatsApp, e-mail, Instagram (or phone) link sends GA4 `contact`; for the methods the owner counts, Meta `Contact` and
 *   the Google Ads contact conversion. The form before WhatsApp sends `generate_lead` and `contact` when the browser lets it be sent. The
 *   contact form's conversion (`generate_lead`, Meta `Lead`, the Ads form conversion) fires only on the thank-you page, only with the one-time
 *   `envio` id the server added to an accepted submission, once per id.
 * - Never anything a visitor typed: no field of a form is read, and no event carries a name, e-mail, phone or message. The Meta Pixel's
 *   automatic events are off (`autoConfig`); its automatic advanced matching and Google's automatic user-provided data are account settings,
 *   which the panel tells the owner to leave off.
 * - The sites share the app's address, so Google's cookies are named per site (`cookie_prefix`). Meta's `_fbp` has no such option.
 */
import type { ScriptConfig } from "./tracking";

/** The address of the script below a site (`/s/<slug>/m/rastreio`); "rastreio" is not the form of an image id (a UUID), so it never collides. */
export const TRACKING_SCRIPT_SEGMENT = "rastreio";
/** The attribute that tells the script it is on a thank-you page. */
export const THANKS_ATTRIBUTE = 'data-pagina="enviado"';
/** The one-time id of an accepted submission, in the address of the thank-you page. */
export const SUBMISSION_PARAM = "envio";
export const SUBMISSION_ID = /^[A-Za-z0-9_-]{16,64}$/;

/** A random id for an accepted submission: no personal data, used as the transaction id of Ads and the event id of Meta. */
export const newSubmissionId = () => crypto.randomUUID().replace(/-/g, "");

/** JSON that can sit inside a script: nothing in it can end the element or break a line of JavaScript. */
const embed = (value: unknown) =>
  JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

const RUNTIME = String.raw`(function (C) {
  "use strict";
  var w = window, d = document;
  if (!C || w.__siteRastreio) return;
  w.__siteRastreio = true;
  var KEY = "rastreio:" + C.site;
  var TOOLS = [C.ga4 ? "ga4" : "", C.ads ? "ads" : "", C.meta ? "meta" : ""].filter(Boolean).join(",");
  var HAS = { a: !!C.ga4, m: !!(C.ads || C.meta) };
  var me = d.currentScript;
  var THANKS = !!(me && me.getAttribute("data-pagina") === "enviado");
  var GOOGLE = !!(C.ga4 || C.ads);
  // The sites share the app's address: Google's cookies (_ga, _ga_*, _gcl_au) get a name of their own per site, so one site's tools never
  // read the visitor's id made under another site's consent. (A slug is [a-z0-9-]; anything else is made "_" all the same.)
  var COOKIES = { cookie_prefix: "rst_" + String(C.site).replace(/[^A-Za-z0-9-]/g, "_") };
  var on = { a: false, m: false };
  var done = { g: false, ga4: false, ads: false, meta: false };
  var banner = null, opener = null, back = null;

  function read(store, key) { try { return w[store].getItem(key); } catch (e) { return null; } }
  function write(store, key, value) { try { w[store].setItem(key, value); } catch (e) { /* storage blocked: the choice lasts this page */ } }
  function gtag() { w.dataLayer.push(arguments); }
  function inject(src) { var s = d.createElement("script"); s.async = true; s.src = src; (d.head || d.documentElement).appendChild(s); }
  function fbqStub() {
    if (w.fbq) return;
    var n = w.fbq = function () { if (n.callMethod) n.callMethod.apply(n, arguments); else n.queue.push(arguments); };
    if (!w._fbq) w._fbq = n;
    n.push = n; n.loaded = true; n.version = "2.0"; n.queue = [];
  }
  if (GOOGLE) {
    w.dataLayer = w.dataLayer || [];
    gtag("consent", "default", { ad_storage: "denied", analytics_storage: "denied", ad_user_data: "denied", ad_personalization: "denied", wait_for_update: 500 });
  }

  function apply(choice) {
    on.a = !!(choice.a && HAS.a);
    on.m = !!(choice.m && HAS.m);
    if (GOOGLE) {
      var m = on.m ? "granted" : "denied";
      gtag("consent", "update", { analytics_storage: on.a ? "granted" : "denied", ad_storage: m, ad_user_data: m, ad_personalization: m });
      var ga = on.a && C.ga4 && !done.ga4, ads = on.m && C.ads && !done.ads;
      if ((ga || ads) && !done.g) {
        done.g = true;
        inject("https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(ga ? C.ga4 : C.ads.id));
        gtag("js", new Date());
      }
      if (ga) { done.ga4 = true; gtag("config", C.ga4, merge({}, COOKIES)); }
      if (ads) { done.ads = true; gtag("config", C.ads.id, merge({}, COOKIES)); }
    }
    if (C.meta) {
      if (on.m && !done.meta) {
        done.meta = true;
        fbqStub();
        inject("https://connect.facebook.net/en_US/fbevents.js");
        w.fbq("consent", "grant");
        // No automatic events (the pixel would report buttons and page data on its own) before init; the automatic advanced matching, which
        // would read the fields of a form, is switched off in Events Manager (the panel says so).
        w.fbq("set", "autoConfig", false, C.meta);
        w.fbq("init", C.meta);
        w.fbq("track", "PageView");
      } else if (done.meta) w.fbq("consent", on.m ? "grant" : "revoke");
    }
    thanks();
  }

  function merge(into, from) { for (var k in from) if (Object.prototype.hasOwnProperty.call(from, k)) into[k] = from[k]; return into; }
  function valued(p) { if (typeof C.value === "number") { p.value = C.value; p.currency = "BRL"; } return p; }
  function ga(name, params) {
    if (!on.a || !done.ga4) return false;
    gtag("event", name, merge({ send_to: C.ga4, transport_type: "beacon" }, params));
    return true;
  }
  function adsConversion(label, params) {
    if (!on.m || !done.ads || !label) return false;
    gtag("event", "conversion", merge({ send_to: C.ads.id + "/" + label, transport_type: "beacon" }, params));
    return true;
  }
  function meta(name, data, id) {
    if (!on.m || !done.meta) return false;
    if (id) w.fbq("track", name, data, { eventID: id }); else w.fbq("track", name, data);
    return true;
  }
  function contact(method, where) {
    ga("contact", { method: method, link_location: where });
    if (!C.count[method]) return;
    meta("Contact", valued({ content_name: method }));
    if (C.ads) adsConversion(C.ads.contact, valued({}));
  }

  /** Where on the page: the id or the label of the section (written by the site's owner), or its kind. */
  function place(el) {
    var s = el.closest ? el.closest("section,header,footer,nav,aside,main") : null;
    var name = s ? (s.id || s.getAttribute("aria-label") || s.tagName.toLowerCase()) : "page";
    return String(name).slice(0, 100);
  }
  function methodOf(href) {
    var u;
    try { u = new URL(href, d.baseURI); } catch (e) { return null; }
    if (u.protocol === "mailto:") return "email";
    if (u.protocol === "tel:") return "phone";
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    var h = u.hostname.toLowerCase();
    if (h === "wa.me" || h === "api.whatsapp.com") return "whatsapp";
    if (h === "instagram.com" || h === "www.instagram.com") return "instagram";
    return null;
  }
  d.addEventListener("click", function (event) {
    var t = event.target;
    var a = t && t.closest ? t.closest("a[href]") : null;
    if (!a) return;
    var method = methodOf(a.getAttribute("href") || "");
    if (method) contact(method, place(a));
  }, true);
  // The form before WhatsApp: sent to this app, which answers with WhatsApp itself, so the event goes when the browser sends the form (it
  // may still be refused by the server). The submit event comes only after the browser's own checks; checkValidity says it again.
  d.addEventListener("submit", function (event) {
    var f = event.target;
    if (!f || f.tagName !== "FORM" || event.defaultPrevented) return;
    var action = (f.getAttribute("action") || "").split("?")[0];
    if (!/(^|\/)m\/whatsapp$/.test(action)) return;
    if (f.checkValidity && !f.checkValidity()) return;
    ga("generate_lead", valued({ lead_source: "whatsapp_form" }));
    contact("whatsapp", place(f));
  }, true);

  /** The conversion of the contact form, on the thank-you page only, once per accepted submission (and per tool, as consent allows). */
  function thanks() {
    if (!THANKS) return;
    var id = null;
    try { id = new URLSearchParams(w.location.search).get("envio"); } catch (e) { return; }
    if (!id || !/^[A-Za-z0-9_-]{16,64}$/.test(id)) return;
    var key = KEY + ":envio:" + id;
    var sent = read("sessionStorage", key) || "";
    if (sent.indexOf("g") < 0 && ga("generate_lead", valued({ lead_source: "site_form" }))) sent += "g";
    if (C.count.form) {
      if (sent.indexOf("m") < 0 && meta("Lead", valued({ content_name: "site_form" }), id)) sent += "m";
      if (sent.indexOf("a") < 0 && C.ads && adsConversion(C.ads.lead, valued({ transaction_id: id }))) sent += "a";
    }
    if (sent) write("sessionStorage", key, sent);
    var all = (!C.ga4 || sent.indexOf("g") >= 0) && (!C.count.form || ((!C.meta || sent.indexOf("m") >= 0) && (!C.ads || !C.ads.lead || sent.indexOf("a") >= 0)));
    if (all && w.history && w.history.replaceState) {
      try {
        var url = new URL(w.location.href);
        url.searchParams.delete("envio");
        w.history.replaceState(w.history.state, "", url.pathname + url.search + url.hash);
      } catch (e) { /* the address stays; the stored mark still holds */ }
    }
  }

  function stored() {
    var raw = read("localStorage", KEY);
    if (!raw) return null;
    var s = null;
    try { s = JSON.parse(raw); } catch (e) { return null; }
    if (!s || s.v !== 1 || s.tools !== TOOLS) return null;
    return { a: s.a === 1, m: s.m === 1 };
  }
  function decide(choice) {
    write("localStorage", KEY, JSON.stringify({ v: 1, tools: TOOLS, a: choice.a ? 1 : 0, m: choice.m ? 1 : 0, at: new Date().toISOString() }));
    apply(choice);
    close();
  }

  var CSS = ".rst-banner{position:fixed;z-index:2147483000;left:16px;bottom:16px;width:calc(100% - 32px);max-width:440px;max-height:calc(100vh - 32px);overflow:auto;box-sizing:border-box;margin:0;padding:20px;background:#fff;color:#1f2933;border:1px solid #9aa5b1;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.2);font:15px/1.5 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;text-align:left;letter-spacing:normal;text-transform:none}" +
    ".rst-banner *{box-sizing:border-box;font:inherit;color:inherit;letter-spacing:inherit}" +
    ".rst-banner:focus{outline:3px solid #0b5cad;outline-offset:2px}" +
    ".rst-banner[hidden],.rst-banner [hidden]{display:none!important}" +
    ".rst-banner .rst-title{margin:0 0 8px;font-size:17px;font-weight:700;line-height:1.3}" +
    ".rst-banner p{margin:0 0 10px}" +
    ".rst-banner a{color:#0b5cad;text-decoration:underline;font-weight:600}" +
    ".rst-banner .rst-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}" +
    ".rst-banner .rst-btn{flex:1 1 0;min-width:88px;min-height:44px;margin:0;padding:10px 12px;border:2px solid #1f2933;border-radius:8px;background:#fff;color:#1f2933;font-weight:700;line-height:1.2;cursor:pointer;text-align:center;appearance:none}" +
    ".rst-banner .rst-btn:hover{background:#eef1f4}" +
    ".rst-banner .rst-btn:focus-visible,.rst-prefs:focus-visible,.rst-banner input:focus-visible{outline:3px solid #0b5cad;outline-offset:2px}" +
    ".rst-banner .rst-option{display:flex;gap:12px;align-items:flex-start;min-height:44px;margin:0 0 10px;padding:8px 0;cursor:pointer;font-weight:400}" +
    ".rst-banner .rst-option input{width:22px;height:22px;min-width:22px;margin:2px 0 0;accent-color:#1f2933}" +
    ".rst-banner .rst-option strong{display:block;font-weight:700}" +
    ".rst-banner .rst-small{font-size:13px;color:#3e4c59}" +
    ".rst-bar{display:flex;justify-content:center;padding:12px 16px 20px;margin:0}" +
    ".rst-prefs{min-height:44px;padding:8px 18px;border:1px solid #9aa5b1;border-radius:999px;background:#fff;color:#1f2933;font:600 14px/1.2 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;cursor:pointer}" +
    "@media (max-width:600px){.rst-banner{left:8px;right:8px;width:auto;max-width:none;bottom:88px;max-height:calc(100vh - 104px);padding:16px}.rst-banner .rst-btn{padding:10px 6px}}";

  function el(tag, attrs, children) {
    var e = d.createElement(tag);
    for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) e.setAttribute(k, attrs[k]);
    for (var i = 0; children && i < children.length; i++) e.appendChild(typeof children[i] === "string" ? d.createTextNode(children[i]) : children[i]);
    return e;
  }
  function names(list) { return list.length < 2 ? list.join("") : list.slice(0, -1).join(", ") + " e " + list[list.length - 1]; }
  function button(text, act) { var b = el("button", { type: "button", "class": "rst-btn" }, [text]); b.addEventListener("click", act); return b; }

  function build() {
    var tools = [], purposes = [], marketing = [];
    if (C.ga4) { tools.push("Google Analytics"); purposes.push("contar as visitas e o que é usado no site"); }
    if (C.ads) { tools.push("Google Ads"); marketing.push("Google Ads"); }
    if (C.meta) { tools.push("Meta Pixel"); marketing.push("Meta"); }
    if (HAS.m) purposes.push("saber se os anúncios trouxeram contatos e mostrar anúncios a quem visitou o site");
    var b = el("div", { "class": "rst-banner", role: "dialog", "aria-labelledby": "rst-title", "aria-describedby": "rst-text", tabindex: "-1", hidden: "" });
    var title = el("h2", { id: "rst-title", "class": "rst-title" }, ["Cookies e medição deste site"]);
    var text = el("p", { id: "rst-text" }, ["Este site quer usar " + names(tools) + " para " + names(purposes) + ". Essas ferramentas guardam cookies e recebem dados da sua visita, como o endereço de internet e as páginas vistas. Elas só são carregadas se você permitir."]);
    var change = el("p", { "class": "rst-small" }, ["Você pode mudar a escolha quando quiser, no botão “Preferências de cookies” no fim da página."]);
    if (C.privacy) {
      change.appendChild(d.createTextNode(" "));
      change.appendChild(el("a", { href: C.privacy, target: "_blank", rel: "noopener noreferrer" }, ["Leia o aviso de privacidade"]));
      change.appendChild(d.createTextNode("."));
    }
    var first = el("div", {}, [text, change]);
    var second = el("div", { hidden: "" }, []);
    var boxes = {};
    function option(key, label, detail) {
      var input = el("input", { type: "checkbox", role: "switch", id: "rst-" + key });
      boxes[key] = input;
      second.appendChild(el("label", { "class": "rst-option", "for": "rst-" + key }, [input, el("span", {}, [el("strong", {}, [label]), detail])]));
    }
    second.appendChild(el("p", {}, ["Escolha o que este site pode usar. Os dois começam desligados."]));
    if (HAS.a) option("a", "Medição (Google Analytics)", "Conta as visitas e o que é usado no site, para o profissional melhorar a página.");
    if (HAS.m) option("m", "Marketing (" + names(marketing) + ")", "Mede se os anúncios trouxeram contatos e permite mostrar anúncios a quem visitou o site.");
    second.appendChild(el("p", { "class": "rst-small" }, ["Se você desligar algo que tinha permitido, vale a partir da próxima página. Também dá para bloquear cookies nas configurações do seu navegador."]));
    var actions = el("div", { "class": "rst-actions" }, [
      button("Aceitar", function () { decide({ a: true, m: true }); }),
      button("Recusar", function () { decide({ a: false, m: false }); }),
      button("Personalizar", function () {
        var now = stored() || { a: false, m: false };
        if (boxes.a) boxes.a.checked = now.a;
        if (boxes.m) boxes.m.checked = now.m;
        first.hidden = true; actions.hidden = true; second.hidden = false; more.hidden = false;
        (boxes.a || boxes.m).focus();
      }),
    ]);
    var more = el("div", { "class": "rst-actions", hidden: "" }, [
      button("Salvar", function () { decide({ a: !!(boxes.a && boxes.a.checked), m: !!(boxes.m && boxes.m.checked) }); }),
      button("Voltar", function () { first.hidden = false; actions.hidden = false; second.hidden = true; more.hidden = true; actions.firstChild.focus(); }),
    ]);
    b.appendChild(title); b.appendChild(first); b.appendChild(actions); b.appendChild(second); b.appendChild(more);
    b.addEventListener("keydown", function (event) { if (event.key === "Escape") { event.preventDefault(); close(); } });
    b._reset = function () { first.hidden = false; actions.hidden = false; second.hidden = true; more.hidden = true; };
    return b;
  }
  function open() {
    if (!banner) { banner = build(); d.body.appendChild(banner); }
    back = d.activeElement && d.activeElement !== d.body ? d.activeElement : null;
    banner._reset();
    banner.hidden = false;
    try { banner.focus({ preventScroll: true }); } catch (e) { banner.focus(); }
  }
  function close() {
    if (!banner || banner.hidden) return;
    banner.hidden = true;
    var to = back && d.contains(back) ? back : opener;
    if (to && to.focus) try { to.focus({ preventScroll: true }); } catch (e) { to.focus(); }
  }
  function start() {
    var style = d.createElement("style");
    style.textContent = CSS;
    (d.head || d.documentElement).appendChild(style);
    opener = el("button", { type: "button", "class": "rst-prefs" }, ["Preferências de cookies"]);
    opener.addEventListener("click", open);
    d.body.appendChild(el("div", { "class": "rst-bar" }, [opener]));
    var choice = stored();
    if (choice) apply(choice); else open();
  }
  if (d.readyState === "loading") d.addEventListener("DOMContentLoaded", start); else start();
})`;

/** The script of one site, with its settings. The same settings always give the same text (an ETag of it works). */
export function trackingScript(config: ScriptConfig): string {
  return `/* Meu Site: consentimento de cookies e medição deste site. */\n${RUNTIME}(${embed(config)});\n`;
}
