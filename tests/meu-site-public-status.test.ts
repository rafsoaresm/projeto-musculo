import { describe, expect, it } from "vitest";
import { publicStatus } from "@/modules/meu-site/public-status";

describe("what a visitor can see of a site (one rule for every screen)", () => {
  it("is a draft only when no address answers", () => {
    expect(publicStatus({ engine: "native", guidedLive: false, advancedPublished: 0 })).toMatchObject({ live: false, label: "Site em rascunho" });
    expect(publicStatus({ engine: "frappe", guidedLive: false, advancedPublished: 0 })).toMatchObject({ live: false, label: "Site em rascunho" });
  });

  it("is on the air when a page of the advanced editor is published, even if the main address shows the guided one, taken offline", () => {
    const status = publicStatus({ engine: "native", guidedLive: false, advancedPublished: 1 });
    expect(status).toMatchObject({ live: true, label: "Publicado" });
    expect(status.detail).toContain("endereço principal está fora do ar");
    expect(status.detail).toContain("1 página do Editor Avançado continua publicada");
  });

  it("says each case of a site on the air", () => {
    expect(publicStatus({ engine: "frappe", guidedLive: false, advancedPublished: 2 }).detail).toBe("2 páginas publicadas no Editor Avançado.");
    expect(publicStatus({ engine: "frappe", guidedLive: true, advancedPublished: 1 }).detail).toBe("1 página publicada no Editor Avançado.");
    expect(publicStatus({ engine: "native", guidedLive: true, advancedPublished: 0 }).detail).toBe("A versão do Editor Guiado está no ar.");
    expect(publicStatus({ engine: "native", guidedLive: true, advancedPublished: 3 }).detail).toContain("3 páginas do Editor Avançado também estão publicadas");
  });
});
