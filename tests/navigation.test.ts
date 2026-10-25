import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SURFACE_ORDER,
  SURFACES,
  findPlanned,
  navigationFor,
} from "@/modules/platform/surfaces";
import { areaLinks } from "@/modules/platform/areas";
import { demoNavigation } from "@/modules/demo/navigation";
import {
  demoAudit,
  demoClient,
  demoMesocycles,
  demoOrganizations,
  demoStudents,
} from "@/modules/demo/fixtures";

describe("navigation by area (handoff V2, section 3)", () => {
  it.each(SURFACE_ORDER)("%s has a home and unique, URL-safe slugs", (id) => {
    const items = navigationFor(id).flatMap((group) => group.items);
    const slugs = items.map((item) => item.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(items.find((item) => item.slug === "")?.status).toBe("available");
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9-]*$/);
    // Nothing in the structure may claim to be a fixed server path.
    for (const slug of slugs) expect(["api", "_next"]).not.toContain(slug);
    expect(SURFACES[id].home).toBe(`/${id}`);
  });
  it.each(SURFACE_ORDER)(
    "%s never presents a planned module as working",
    (id) => {
      for (const item of navigationFor(id).flatMap((g) => g.items)) {
        if (item.status === "planned") {
          expect(item.planned?.epic).toMatch(/^E\d/);
          expect(item.planned?.summary.length).toBeGreaterThan(30);
          expect(item.planned?.needs.length).toBeGreaterThan(20);
          expect(findPlanned(id, item.slug)).toBe(item);
        } else {
          expect(findPlanned(id, item.slug)).toBeNull();
        }
      }
    },
  );
  it("lists the V2 menu for the professional area", () => {
    const labels = navigationFor("profissional")
      .flatMap((g) => g.items)
      .map((i) => i.label);
    expect(labels).toEqual(
      expect.arrayContaining([
        "Alunos",
        "Avaliações",
        "Periodização",
        "Prescrição",
        "Biblioteca de exercícios",
        "Fontes técnicas",
        "Meu Site",
        "Leads",
        "Configurações",
      ]),
    );
  });
  it("only offers a switcher to people with more than one area", () => {
    expect(areaLinks(["aluno"], "aluno")).toEqual([]);
    expect(areaLinks(["profissional", "gestor"], "gestor")).toEqual([
      { label: "Gestor", href: "/gestor", current: true },
      { label: "Profissional", href: "/profissional", current: false },
    ]);
  });
  it.each(SURFACE_ORDER)(
    "%s has a real page and a demonstration page for every module it presents as working",
    (id) => {
      const missing: string[] = [];
      for (const item of navigationFor(id).flatMap((g) => g.items)) {
        if (item.status !== "available") continue;
        const tail = item.slug ? `/${item.slug}` : "";
        for (const root of [`src/app/${id}`, `src/app/demonstracao/${id}`]) {
          // The manager's panel lives in a route group, which is not part of the address.
          const found = [`${root}${tail}`, `${root}/(painel)${tail}`].some((dir) => existsSync(`${dir}/page.tsx`));
          if (!found) missing.push(`${root}${tail}`);
        }
      }
      // A menu entry without a page is a 404 for whoever clicks it.
      expect(missing).toEqual([]);
    },
  );
  it("marks only illustrated previews in the demonstration", () => {
    const tagged = SURFACE_ORDER.flatMap((id) =>
      demoNavigation(id)
        .flatMap((g) => g.items)
        .filter((i) => i.tag)
        .map((i) => `${id}/${i.slug}`),
    );
    expect(tagged.sort()).toEqual([
      "aluno/conta",
      "aluno/evolucao",
      "aluno/treino",
      "profissional/conta",
      "profissional/prescricao",
    ]);
  });
});

describe("demonstration fixtures are clearly fictional", () => {
  it("uses only reserved example e-mail domains", () => {
    const emails = [
      ...demoOrganizations.map((o) => o.ownerEmail ?? ""),
      ...demoAudit.flatMap((a) => [a.actorEmail, a.subjectEmail ?? ""]),
    ].filter(Boolean);
    expect(emails.length).toBeGreaterThan(0);
    for (const email of emails) expect(email).toMatch(/@exemplo\.test$/);
  });
  it("takes training parameters from the master document presets, with no invented load", () => {
    const [base, hypertrophy] = demoMesocycles.map((m) => m.preset);
    expect(base).toEqual({
      sets: "2",
      reps: "10–15",
      rest: "60–90 s",
      cadence: "3-1-2-0",
      rir: "3–4",
    });
    expect(hypertrophy).toEqual({
      sets: "3",
      reps: "8–12",
      rest: "60–120 s",
      cadence: "3-0-1-0",
      rir: "1–3",
    });
    expect(JSON.stringify(demoMesocycles)).not.toMatch(/\d+\s?kg/i);
    for (const meso of demoMesocycles)
      for (const workout of meso.workouts)
        expect(workout.exercises).toHaveLength(6);
  });
  it("blocks approval wherever screening needs review", () => {
    for (const student of demoStudents.filter(
      (s) => s.screening === "REVIEW_REQUIRED",
    ))
      expect(["REVIEW_REQUIRED", "DRAFT"]).toContain(student.plan);
    expect(demoClient.studentName).toBe(
      demoStudents.find((s) => s.id === "carlos")?.displayName,
    );
  });
});
