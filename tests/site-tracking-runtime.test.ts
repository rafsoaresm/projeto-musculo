import { createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { scriptConfig, type TrackingSettings } from "@/modules/meu-site/tracking";
import { trackingScript } from "@/modules/meu-site/tracking-script";

/**
 * The script of a site (Meu Site 0.71) run, not only read: a small stand-in of a page (elements, events, the two storages, the address) in a
 * context of its own, one per page load, sharing the storages the way a tab does. It answers what the text of the script cannot: the order of
 * the calls, what each tool is given, and the marks that count a submission once per tool across reloads.
 */

type Listener = (event: { key?: string; target?: unknown; preventDefault: () => void; defaultPrevented?: boolean }) => void;

class FakeElement {
  attrs: Record<string, string> = {};
  children: FakeElement[] = [];
  listeners: Record<string, Listener[]> = {};
  textContent = "";
  hidden = false;
  src = "";
  async = false;
  constructor(public tagName: string) {}
  setAttribute(name: string, value: string) {
    this.attrs[name] = String(value);
    if (name === "hidden") this.hidden = true;
  }
  getAttribute(name: string) {
    return name in this.attrs ? this.attrs[name]! : null;
  }
  appendChild(child: FakeElement) {
    this.children.push(child);
    return child;
  }
  get firstChild() {
    return this.children[0] ?? null;
  }
  addEventListener(type: string, listener: Listener) {
    (this.listeners[type] ??= []).push(listener);
  }
  click() {
    for (const listener of this.listeners.click ?? []) listener({ target: this, preventDefault() {} });
  }
  focus() {}
  closest() {
    return null;
  }
  get text(): string {
    return this.textContent + this.children.map((child) => child.text).join("");
  }
  all(): FakeElement[] {
    return [this, ...this.children.flatMap((child) => child.all())];
  }
}

class Store {
  data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, String(value));
  }
}

interface Tab {
  local: Store;
  session: Store;
  href: string;
}

/** One page load of the script in a tab: what it pushed to Google, queued for Meta and asked the browser to load. */
function load(tab: Tab, config: ReturnType<typeof scriptConfig>, thanks = false) {
  const head = new FakeElement("HEAD");
  const body = new FakeElement("BODY");
  const current = new FakeElement("SCRIPT");
  if (thanks) current.setAttribute("data-pagina", "enviado");
  const document = {
    readyState: "complete",
    baseURI: tab.href,
    currentScript: current,
    head,
    body,
    documentElement: head,
    activeElement: body,
    createElement: (tag: string) => new FakeElement(tag.toUpperCase()),
    createTextNode: (text: string) => Object.assign(new FakeElement("#text"), { textContent: text }),
    addEventListener() {},
    contains: () => true,
  };
  const window: Record<string, unknown> = {
    document,
    localStorage: tab.local,
    sessionStorage: tab.session,
    URL,
    URLSearchParams,
  };
  Object.defineProperty(window, "location", { get: () => ({ href: tab.href, search: new URL(tab.href).search }) });
  window.history = { state: null, replaceState: (_state: unknown, _title: string, url: string) => void (tab.href = new URL(url, tab.href).href) };
  window.window = window;
  const context = createContext(window);
  runInContext(trackingScript(config), context);
  const google = () => ((window.dataLayer as ArrayLike<unknown>[] | undefined) ?? []).map((entry) => Array.from(entry));
  const meta = () => {
    const fbq = window.fbq as { queue: ArrayLike<unknown>[] } | undefined;
    return (fbq?.queue ?? []).map((entry) => Array.from(entry));
  };
  const loaded = () => head.children.filter((child) => child.tagName === "SCRIPT").map((child) => child.src);
  const button = (name: string) => body.all().find((element) => element.tagName === "BUTTON" && element.text === name);
  const events = (name: string) => google().filter((call) => call[0] === "event" && call[1] === name);
  return { google, meta, loaded, button, events };
}

const settings = (patch: Partial<TrackingSettings> = {}): TrackingSettings => ({
  ga4Id: "G-AB12CD34EF",
  adsId: "AW-123456789",
  adsLabelLead: "LeadLabel1",
  adsLabelContact: null,
  metaPixelId: "123456789012345",
  leadValueCents: null,
  count: { whatsapp: true, form: true, email: false, instagram: false },
  privacyUrl: null,
  ...patch,
});
const config = scriptConfig("marina-a", settings());
const newTab = (href: string): Tab => ({ local: new Store(), session: new Store(), href });
const choose = (tab: Tab, a: boolean, m: boolean) =>
  tab.local.setItem("rastreio:marina-a", JSON.stringify({ v: 1, tools: "ga4,ads,meta", a: a ? 1 : 0, m: m ? 1 : 0, at: "2026-11-02T00:00:00.000Z" }));

describe("the script of a site, run", () => {
  it("loads every tool the site configured with the page: no banner, no consent call, and a choice stored by an older script changes nothing", () => {
    const tab = newTab("https://app.example/s/marina-a");
    choose(tab, false, false);
    const page = load(tab, config);
    expect(page.loaded()).toEqual(["https://www.googletagmanager.com/gtag/js?id=G-AB12CD34EF", "https://connect.facebook.net/en_US/fbevents.js"]);
    const order = page.google().map((call) => `${String(call[0])}:${typeof call[1] === "string" ? call[1] : ""}`);
    expect(order.filter((entry) => entry.startsWith("consent:"))).toEqual([]);
    expect(order).toContain("config:G-AB12CD34EF");
    expect(order).toContain("config:AW-123456789");
    expect(page.button("Preferências de cookies")).toBeUndefined();
    expect(page.button("Aceitar")).toBeUndefined();
    expect(page.meta().filter((call) => call[0] === "consent")).toEqual([]);
  });

  it("names Google's cookies per site, since the sites share the app's address", () => {
    const tab = newTab("https://app.example/s/marina-a");
    choose(tab, true, true);
    const configs = load(tab, config).google().filter((call) => call[0] === "config");
    expect(configs).toEqual([
      ["config", "G-AB12CD34EF", { cookie_prefix: "rst_marina-a" }],
      ["config", "AW-123456789", { cookie_prefix: "rst_marina-a" }],
    ]);
    const other = newTab("https://app.example/s/marina-b");
    choose(other, true, true);
    other.local.setItem("rastreio:marina-b", other.local.getItem("rastreio:marina-a")!);
    const second = load(other, scriptConfig("marina-b", settings())).google().find((call) => call[0] === "config");
    expect(second![2]).toEqual({ cookie_prefix: "rst_marina-b" });
  });

  it("turns off the Meta Pixel's automatic events before it starts", () => {
    const tab = newTab("https://app.example/s/marina-a");
    choose(tab, true, true);
    const calls = load(tab, config).meta();
    expect(calls).toEqual([
      ["set", "autoConfig", false, "123456789012345"],
      ["init", "123456789012345"],
      ["track", "PageView"],
    ]);
  });

  it("counts a submission once per tool on the thank-you page: every tool at the first load, nothing at a reload", () => {
    const id = "0123456789abcdef0123456789abcdef";
    const tab = newTab(`https://app.example/s/marina-a/m/enviado?envio=${id}`);
    const first = load(tab, config, true);
    expect(first.events("generate_lead")).toHaveLength(1);
    expect(first.events("conversion")).toEqual([["event", "conversion", { send_to: "AW-123456789/LeadLabel1", transport_type: "beacon", transaction_id: id }]]);
    expect(first.meta().filter((call) => call[0] === "track" && call[1] === "Lead")).toEqual([["track", "Lead", { content_name: "site_form" }, { eventID: id }]]);
    // Every tool counted it: the id leaves the address, and one more load counts nothing.
    expect(tab.href).toBe("https://app.example/s/marina-a/m/enviado");
    const again = load(tab, config, true);
    expect(again.events("generate_lead")).toEqual([]);
    expect(again.events("conversion")).toEqual([]);
  });

  it("does not count the same id again from the stored marks, even with the id still in the address", () => {
    const id = "fedcba9876543210fedcba9876543210";
    const tab = newTab(`https://app.example/s/marina-a/m/enviado?envio=${id}`);
    choose(tab, true, true);
    const first = load(tab, config, true);
    expect(first.events("generate_lead")).toHaveLength(1);
    expect(first.events("conversion")).toHaveLength(1);
    // A back button or a copied address brings the id back: the marks of this tab still hold.
    tab.href = `https://app.example/s/marina-a/m/enviado?envio=${id}`;
    const back = load(tab, config, true);
    expect(back.events("generate_lead")).toEqual([]);
    expect(back.events("conversion")).toEqual([]);
    expect(back.meta().filter((call) => call[1] === "Lead")).toEqual([]);
  });
});
