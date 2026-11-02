import { describe, expect, it } from "vitest";
import { SITE_TABS, siteTabFrom } from "@/modules/meu-site/site-tab-names";

describe("the tab an address opens in the management of the site", () => {
  it("is the one named, and Páginas for anything else", () => {
    for (const tab of SITE_TABS) expect(siteTabFrom(tab)).toBe(tab);
    expect(siteTabFrom(undefined)).toBe("paginas");
    expect(siteTabFrom("")).toBe("paginas");
    expect(siteTabFrom("PUBLICACAO")).toBe("paginas");
    expect(siteTabFrom("../configuracoes")).toBe("paginas");
  });
});
