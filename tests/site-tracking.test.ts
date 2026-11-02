import { Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { PUBLIC_CSP } from "@/modules/frappe-site/document";
import {
  EMPTY_TRACKING,
  activeTools,
  readAds,
  readAdsLabel,
  readGa4,
  readLeadValue,
  readMeta,
  readPrivacyUrl,
  readTracking,
  scriptConfig,
  trackingEvents,
  type TrackingSettings,
} from "@/modules/meu-site/tracking";
import { inquiryPageCsp, publicPageCsp, trackingHosts } from "@/modules/meu-site/tracking-csp";
import { SUBMISSION_ID, newSubmissionId, trackingScript } from "@/modules/meu-site/tracking-script";

// The tagging of the public pages (Meu Site 0.71): what the panel accepts, the policy of a page per tool, and the script a site is given.

describe("reading the IDs the owner types or pastes", () => {
  it.each([
    ["G-AB12CD34EF", "G-AB12CD34EF"],
    [" g-ab12 cd34ef ", "G-AB12CD34EF"],
    ['<script async src="https://www.googletagmanager.com/gtag/js?id=G-XYZ98765"></script><script>gtag(\'config\', \'G-XYZ98765\');</script>', "G-XYZ98765"],
    ["", null],
  ])("GA4 %j → %j", (raw, value) => expect(readGa4(raw)).toEqual({ value }));

  it.each([
    ["UA-1234567-1", "Universal Analytics"],
    ["GTM-ABC1234", "Google Tag Manager"],
    ["GT-ABCDEFG", "ID de tag do Google"],
    ["AW-123456789", "campo do Google Ads"],
    ["G-12", "começa com G-"],
    ["Ga4-ABCDEFG", "começa com G-"],
  ])("GA4 refuses %j naming the right place (%s)", (raw, says) => {
    const read = readGa4(raw);
    expect("error" in read && read.error).toContain(says);
  });

  it("reads the Google Ads ID, with the label when it comes pasted, and gives bare digits their prefix", () => {
    expect(readAds("AW-123456789")).toEqual({ value: "AW-123456789" });
    expect(readAds("aw-123456789")).toEqual({ value: "AW-123456789" });
    expect(readAds("AW-123456789/AbC-dEf_123")).toEqual({ value: "AW-123456789", label: "AbC-dEf_123" });
    expect(readAds("gtag('event', 'conversion', {'send_to': 'AW-987654321/XyZ987abc'});")).toEqual({ value: "AW-987654321", label: "XyZ987abc" });
    expect(readAds("123456789")).toEqual({ value: "AW-123456789" });
    for (const [raw, says] of [["G-AB12CD34EF", "campo do Google Analytics"], ["GTM-ABC1234", "Google Tag Manager"], ["AW-12", "AW- seguido"], ["UA-1-1", "Universal"]] as const) {
      const read = readAds(raw);
      expect("error" in read && read.error, raw).toContain(says);
    }
  });

  it("keeps the case of a label, takes it out of a pasted send_to and refuses what cannot be one", () => {
    expect(readAdsLabel("AbCdEf12")).toEqual({ value: "AbCdEf12" });
    expect(readAdsLabel("AW-123456789/AbCdEf12")).toEqual({ value: "AbCdEf12", id: "AW-123456789" });
    expect("error" in readAdsLabel("abc")).toBe(true);
    expect("error" in readAdsLabel("rótulo com acento")).toBe(true);
  });

  it("reads the Meta Pixel ID from the digits or from the base code, warning when the length is unusual", () => {
    expect(readMeta("123456789012345")).toEqual({ value: "123456789012345" });
    expect(readMeta(" 1234 5678 9012 3456 ")).toEqual({ value: "1234567890123456" });
    expect(readMeta("fbq('init', '123456789012345'); fbq('track', 'PageView');")).toEqual({ value: "123456789012345" });
    const short = readMeta("1234567890");
    expect(short).toMatchObject({ value: "1234567890" });
    expect("warning" in short && short.warning).toContain("15 ou 16");
    for (const [raw, says] of [["123", "só números"], ["G-AB12CD34EF", "campo do Google Analytics"], ["AW-123456789", "campo do Google Ads"], ["1234567890123456789012", "só números"]] as const) {
      const read = readMeta(raw);
      expect("error" in read && read.error, raw).toContain(says);
    }
  });

  it.each([
    ["150", 15000],
    ["150,00", 15000],
    ["R$ 80,5", 8050],
    ["1.500,50", 150050],
    ["1.500", 150000],
    ["80.5", 8050],
    ["", null],
  ])("a lead value %j is %j cents", (raw, value) => expect(readLeadValue(raw)).toEqual({ value }));
  it("refuses a value that is not money in reais", () => {
    for (const raw of ["-5", "abc", "1,234", "10000000000", "1000001"]) expect("error" in readLeadValue(raw), raw).toBe(true);
  });

  it("takes only an https privacy notice", () => {
    expect(readPrivacyUrl(" https://marina.com.br/privacidade ")).toEqual({ value: "https://marina.com.br/privacidade" });
    for (const raw of ["http://marina.com.br/privacidade", "javascript:alert(1)", "https://localhost/x", "marina.com.br", "https://user:pw@marina.com.br/", `https://a.com/${"x".repeat(500)}`]) {
      expect("error" in readPrivacyUrl(raw), raw).toBe(true);
    }
  });
});

describe("reading the whole panel", () => {
  const good = { ga4: "g-ab12cd34ef", adsId: "AW-123456789/LeadLabel1", adsLabelContact: "Contato_22", meta: "123456789012345", leadValue: "150", privacyUrl: "https://marina.com.br/privacidade", count_form: "on", count_whatsapp: "on" };
  it("gives the settings to keep, with the label taken from the pasted ID", () => {
    expect(readTracking(good)).toEqual({
      ok: true,
      warnings: {},
      value: {
        ga4Id: "G-AB12CD34EF",
        adsId: "AW-123456789",
        adsLabelLead: "LeadLabel1",
        adsLabelContact: "Contato_22",
        metaPixelId: "123456789012345",
        leadValueCents: 15000,
        count: { whatsapp: true, form: true, email: false, instagram: false },
        privacyUrl: "https://marina.com.br/privacidade",
      },
    });
  });
  it("turns everything off when everything is empty", () => {
    expect(readTracking({})).toEqual({ ok: true, warnings: {}, value: { ...EMPTY_TRACKING, count: { whatsapp: false, form: false, email: false, instagram: false } } });
  });
  it("says each problem next to its field", () => {
    const read = readTracking({ ga4: "GTM-ABC1234", adsId: "AW-123456789", meta: "x", leadValue: "muito", privacyUrl: "http://x.com" });
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(Object.keys(read.errors).sort()).toEqual(["adsLabelLead", "ga4", "leadValue", "meta", "privacyUrl"]);
    expect(read.errors.adsLabelLead).toContain("pelo menos uma conversão");
  });
  it("asks for the Ads ID when there are labels, and for different actions for the two labels", () => {
    expect(readTracking({ adsLabelLead: "LeadLabel1" })).toMatchObject({ ok: false, errors: { adsId: expect.stringContaining("ID do Google Ads") } });
    expect(readTracking({ adsLabelLead: "AW-123456789/LeadLabel1" })).toMatchObject({ ok: true, value: { adsId: "AW-123456789", adsLabelLead: "LeadLabel1" } });
    expect(readTracking({ adsId: "AW-123456789", adsLabelLead: "AW-987654321/LeadLabel1" })).toMatchObject({ ok: false, errors: { adsId: expect.stringContaining("outra conta") } });
    expect(readTracking({ adsId: "AW-123456789", adsLabelLead: "Mesmo_1", adsLabelContact: "Mesmo_1" })).toMatchObject({ ok: false, errors: { adsLabelContact: expect.any(String) } });
  });
  it("never accepts a Tag Manager container anywhere", () => {
    for (const field of ["ga4", "adsId", "meta"]) expect(readTracking({ [field]: "GTM-ABC1234" }).ok, field).toBe(false);
  });
});

const settings = (over: Partial<TrackingSettings> = {}): TrackingSettings => ({ ...EMPTY_TRACKING, ...over });

describe("the policy of a page per tool", () => {
  it("is exactly the strict policy of before for a site without tagging", () => {
    expect(publicPageCsp(null)).toBe(PUBLIC_CSP);
    expect(publicPageCsp({ ga4: false, ads: false, meta: false })).toBe(PUBLIC_CSP);
    expect(PUBLIC_CSP).not.toMatch(/script-src|connect-src/);
  });
  it.each([
    [{ ga4: true, ads: false, meta: false }, ["https://www.googletagmanager.com"], ["connect.facebook.net", "googleadservices"]],
    [{ ga4: false, ads: true, meta: false }, ["https://www.googletagmanager.com", "https://www.googleadservices.com", "https://googleads.g.doubleclick.net"], ["connect.facebook.net", "analytics.google.com"]],
    [{ ga4: false, ads: false, meta: true }, ["https://connect.facebook.net"], ["googletagmanager", "google-analytics"]],
    [{ ga4: true, ads: true, meta: true }, ["https://www.googletagmanager.com", "https://connect.facebook.net", "https://www.googleadservices.com"], []],
  ])("%j adds only the hosts of the tools that are on", (tools, has, hasNot) => {
    const csp = publicPageCsp(tools);
    const directive = (name: string) => csp.split("; ").find((entry) => entry.startsWith(`${name} `)) ?? "";
    expect(directive("script-src").startsWith("script-src 'self'")).toBe(true);
    for (const host of has) expect(directive("script-src"), host).toContain(host);
    for (const host of hasNot) expect(csp, host).not.toContain(host);
    // What the strict policy says stays: no inline script, no eval, no wildcard source, forms to the site only, no <base>, never framed.
    expect(csp).not.toMatch(/'unsafe-eval'|'unsafe-inline'[^;]*script|script-src[^;]*'unsafe-inline'|script-src[^;]* \*[ ;]|https:(?=[ ;])/);
    for (const kept of ["default-src 'none'", "form-action 'self'", "base-uri 'none'", "frame-ancestors 'none'", "style-src 'self' 'unsafe-inline'", "font-src 'self'", "media-src 'self'"]) expect(csp).toContain(kept);
    expect(directive("img-src").startsWith("img-src 'self' data:")).toBe(true);
    expect(directive("frame-src").startsWith("frame-src 'self'")).toBe(true);
  });
  it("names each host once", () => {
    const hosts = trackingHosts({ ga4: true, ads: true, meta: true });
    for (const list of Object.values(hosts)) expect(new Set(list).size).toBe(list.length);
  });
  it("gives the thank-you pages a policy of their own: their inline style, the site's script and the tools' hosts", () => {
    const csp = inquiryPageCsp({ ga4: true, ads: false, meta: true });
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self' https://www.googletagmanager.com https://connect.facebook.net");
    expect(csp).toContain("style-src 'unsafe-inline'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("googleadservices");
  });
});

describe("the script of a site", () => {
  const full = settings({
    ga4Id: "G-AB12CD34EF",
    adsId: "AW-123456789",
    adsLabelLead: "LeadLabel1",
    adsLabelContact: null,
    metaPixelId: "123456789012345",
    leadValueCents: 15050,
    privacyUrl: "https://marina.com.br/privacidade",
  });
  it("is given only the public identifiers and the choices, value in reais", () => {
    expect(scriptConfig("marina-a", full)).toEqual({
      v: 1,
      site: "marina-a",
      ga4: "G-AB12CD34EF",
      ads: { id: "AW-123456789", lead: "LeadLabel1", contact: null },
      meta: "123456789012345",
      value: 150.5,
      count: { whatsapp: true, form: true, email: false, instagram: false },
      privacy: "https://marina.com.br/privacidade",
    });
    expect(scriptConfig("marina-a", settings({ ga4Id: "G-AB12CD34EF" }))).toMatchObject({ ads: null, meta: null, value: null, privacy: null });
  });
  it("compiles, embeds its settings where nothing can end the script, and is the same text for the same settings", () => {
    const hostile = settings({ ga4Id: "G-AB12CD34EF", privacyUrl: "https://a.com/</script><script>alert(1)</script>\u2028" });
    const text = trackingScript(scriptConfig("marina-a", hostile));
    expect(() => new Script(text)).not.toThrow();
    expect(text).not.toContain("</script>");
    expect(text).not.toMatch(/[\u2028\u2029]/);
    expect(trackingScript(scriptConfig("marina-a", full))).toBe(trackingScript(scriptConfig("marina-a", full)));
  });
  it("has no eval, no inline handler, loads only the tools' own addresses and asks consent before any of them", () => {
    const text = trackingScript(scriptConfig("marina-a", full));
    expect(text).not.toMatch(/\beval\(|new Function|setTimeout\(\s*["']|\.innerHTML|insertAdjacentHTML|document\.write|onclick=|setAttribute\(\s*["']on/);
    const loaded = [...text.matchAll(/inject\("([^"]+)"/g)].map((match) => match[1]);
    expect(loaded).toEqual(["https://www.googletagmanager.com/gtag/js?id=", "https://connect.facebook.net/en_US/fbevents.js"]);
    // The default denial comes before anything else of Google; the loader is inside apply(), which runs only with a choice.
    expect(text.indexOf('gtag("consent", "default"')).toBeLessThan(text.indexOf("function apply("));
    for (const storage of ["ad_storage", "analytics_storage", "ad_user_data", "ad_personalization"]) expect(text).toContain(`${storage}: "denied"`);
    expect(text).toContain("wait_for_update: 500");
    expect(text).toContain('w.fbq("consent", "grant")');
    expect(text).toContain('"revoke"');
  });
  it("reads nothing a visitor typed and sends no personal data", () => {
    const text = trackingScript(scriptConfig("marina-a", full));
    // No field of a form is read: no value, no FormData, no list of elements, no advanced matching or enhanced conversions.
    // (`C.value` is the lead value of the settings, `p.value` the parameter of an event built from it.)
    expect(text).not.toMatch(/FormData|\.elements\b|(?<![Cp])\.value\b|querySelectorAll?\(\s*["'](input|textarea|select)|\buser_data|"em"|\bem:|\bph:|enhanced_conversions|allow_enhanced/);
    // The thank-you page's conversion uses only the server's random id; the events name a method and a section, nothing else.
    expect(text).toContain('lead_source: "site_form"');
    expect(text).toContain('lead_source: "whatsapp_form"');
    expect(text).toContain("transaction_id: id");
    expect(text).toContain("{ eventID: id }");
  });
  it("makes one-time ids of submissions that carry nothing", () => {
    const ids = new Set(Array.from({ length: 50 }, newSubmissionId));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(SUBMISSION_ID);
  });
});

describe("what the panel shows", () => {
  it("names the tools that are on", () => {
    expect(activeTools(settings())).toEqual([]);
    expect(activeTools(settings({ ga4Id: "G-AB12CD34EF", metaPixelId: "123456789012345" }))).toEqual(["GA4", "Meta Pixel"]);
  });
  it("says what each tool receives for each event, following what counts as a conversion", () => {
    const rows = trackingEvents(settings({ ga4Id: "G-AB12CD34EF", adsId: "AW-123456789", adsLabelLead: "LeadLabel1", adsLabelContact: "Contato_22", metaPixelId: "123456789012345" }));
    const row = (event: string) => rows.find((entry) => entry.event === event)!;
    expect(row("Mensagem enviada pelo formulário")).toEqual({ event: "Mensagem enviada pelo formulário", ga4: "generate_lead", meta: "Lead", ads: "conversão do formulário" });
    expect(row("Clique no WhatsApp")).toMatchObject({ ga4: "contact (whatsapp)", meta: "Contact", ads: "conversão de contato" });
    // e-mail and Instagram are not counted by default: GA4 only.
    expect(row("Clique no e-mail")).toMatchObject({ ga4: "contact (email)", meta: null, ads: null });
    expect(row("Clique no Instagram")).toMatchObject({ ga4: "contact (instagram)", meta: null, ads: null });
    const none = trackingEvents(settings());
    expect(none.every((entry) => entry.ga4 === null && entry.meta === null && entry.ads === null)).toBe(true);
  });
});
