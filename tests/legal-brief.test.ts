import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BASELINE, BASELINE_VERSION, termsHash, type Audience } from "@/modules/consentimento/terms";

// The brief quotes the INITIAL text word for word: the one the lawyer approved, which lives in the code.
// If it changes and the brief does not, the brief would say something other than what was approved. The
// text in force can be a later one, published by the manager; the brief says where to read it.
const brief = readFileSync(new URL("../docs/REVISAO-JURIDICA.md", import.meta.url), "utf8");

describe("the legal review brief", () => {
  it.each(["STUDENT", "PROFESSIONAL"] as Audience[])("quotes the %s terms exactly as the code has them", async (audience) => {
    const terms = BASELINE[audience];
    expect(brief).toContain(BASELINE_VERSION);
    expect(brief).toContain(await termsHash(audience, BASELINE_VERSION, terms));
    expect(brief).toContain(terms.title);
    expect(brief).toContain(terms.intro);
    for (const section of terms.sections) {
      expect(brief, section.heading).toContain(`**${section.heading}.** ${section.text}`);
    }
    expect(brief).toContain(terms.confirmation);
    if (terms.photos) {
      expect(brief).toContain(`**${terms.photos.heading}.** ${terms.photos.text}`);
      expect(brief).toContain(terms.photos.label);
    }
  });

  it("says plainly that it is not a legal opinion, that the text is a draft and what is not done", () => {
    expect(brief).toContain("Isto não é parecer nem texto jurídico");
    expect(brief).toContain("O que a ferramenta ainda NÃO faz");
    expect(brief).toContain("Perguntas ao advogado");
    expect(brief).toContain("Para abrir as fotos em produção");
  });
});
