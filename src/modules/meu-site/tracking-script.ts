/**
 * The script of a site with tagging (Meu Site 0.71), served by `/s/<slug>/m/rastreio` with the site's settings embedded. Plain ES2018, no
 * dependency, no eval, no inline handler: it is the only script of a page of the advanced editor and of the thank-you pages, and it runs beside
 * the bundles of the guided ones.
 *
 * What it does, in order:
 * - The tools the site configured load with the page: GA4 and Google Ads through gtag, the Meta Pixel through fbevents. There is no consent
 *   banner and no consent call (decision of the product owner, 03/11/2026), so Google's consent mode stays at its default (granted).
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
  var me = d.currentScript;
  var THANKS = !!(me && me.getAttribute("data-pagina") === "enviado");
  // The sites share the app's address: Google's cookies (_ga, _ga_*, _gcl_au) get a name of their own per site, so one site's tools never
  // read the visitor's id made under another site. (A slug is [a-z0-9-]; anything else is made "_" all the same.)
  var COOKIES = { cookie_prefix: "rst_" + String(C.site).replace(/[^A-Za-z0-9-]/g, "_") };
  var done = { ga4: false, ads: false, meta: false };

  function read(store, key) { try { return w[store].getItem(key); } catch (e) { return null; } }
  function write(store, key, value) { try { w[store].setItem(key, value); } catch (e) { /* storage blocked: the mark lasts this page */ } }
  function gtag() { w.dataLayer.push(arguments); }
  function inject(src) { var s = d.createElement("script"); s.async = true; s.src = src; (d.head || d.documentElement).appendChild(s); }
  function fbqStub() {
    if (w.fbq) return;
    var n = w.fbq = function () { if (n.callMethod) n.callMethod.apply(n, arguments); else n.queue.push(arguments); };
    if (!w._fbq) w._fbq = n;
    n.push = n; n.loaded = true; n.version = "2.0"; n.queue = [];
  }

  /** Loads every tool the site configured, once. */
  function load() {
    if (C.ga4 || C.ads) {
      w.dataLayer = w.dataLayer || [];
      inject("https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(C.ga4 ? C.ga4 : C.ads.id));
      gtag("js", new Date());
      if (C.ga4) { done.ga4 = true; gtag("config", C.ga4, merge({}, COOKIES)); }
      if (C.ads) { done.ads = true; gtag("config", C.ads.id, merge({}, COOKIES)); }
    }
    if (C.meta) {
      done.meta = true;
      fbqStub();
      inject("https://connect.facebook.net/en_US/fbevents.js");
      // No automatic events (the pixel would report buttons and page data on its own) before init; the automatic advanced matching, which
      // would read the fields of a form, is switched off in Events Manager (the panel says so).
      w.fbq("set", "autoConfig", false, C.meta);
      w.fbq("init", C.meta);
      w.fbq("track", "PageView");
    }
  }

  function merge(into, from) { for (var k in from) if (Object.prototype.hasOwnProperty.call(from, k)) into[k] = from[k]; return into; }
  function valued(p) { if (typeof C.value === "number") { p.value = C.value; p.currency = "BRL"; } return p; }
  function ga(name, params) {
    if (!done.ga4) return false;
    gtag("event", name, merge({ send_to: C.ga4, transport_type: "beacon" }, params));
    return true;
  }
  function adsConversion(label, params) {
    if (!done.ads || !label) return false;
    gtag("event", "conversion", merge({ send_to: C.ads.id + "/" + label, transport_type: "beacon" }, params));
    return true;
  }
  function meta(name, data, id) {
    if (!done.meta) return false;
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

  /** The conversion of the contact form, on the thank-you page only, once per accepted submission (and per tool). */
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

  load();
  thanks();
})`;

/** The script of one site, with its settings. The same settings always give the same text (an ETag of it works). */
export function trackingScript(config: ScriptConfig): string {
  return `/* Meu Site: medição deste site. */\n${RUNTIME}(${embed(config)});\n`;
}
