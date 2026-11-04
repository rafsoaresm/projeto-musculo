import { describe, expect, it } from "vitest";
import { canPrescribe } from "@/modules/planos/access";
import { foldName, matchesName } from "@/modules/planos/student-search";

describe("Novo plano: student picker (0.93)", () => {
  it("finds a name ignoring case, accents and extra spaces", () => {
    expect(foldName("  João   da SILVA ")).toBe("joao da silva");
    expect(matchesName("João da Silva", "joao")).toBe(true);
    expect(matchesName("João da Silva", "DA  sil")).toBe(true);
    expect(matchesName("Ana Souza", "joão")).toBe(false);
    expect(matchesName("Ana Souza", "")).toBe(true);
    expect(matchesName("Ana Souza", "   ")).toBe(true);
  });
  it("offers Novo plano only to the roles that prescribe", () => {
    for (const role of ["OWNER", "MANAGER", "TECHNICAL"]) expect(canPrescribe(role)).toBe(true);
    for (const role of ["COMMERCIAL", "FINANCE", "", null, undefined]) expect(canPrescribe(role)).toBe(false);
  });
});
