/**
 * Operações de revisão sobre uma proposta: regenerar um escopo (item, sessão, semana, treino,
 * fase, desta fase em diante), substituir um exercício, trazer linhas novas da revisão (rebase) e
 * listar alternativas. Fora do escopo nada muda; preservados e travados são mantidos; tudo é
 * revalidado no fim. Nunca lançam: devolvem `{ ok: false, code }`.
 */
import { TECHNICAL_LIMITS } from "./bounds";
import { metricFor } from "./dose";
import { ineligibleReason, INELIGIBLE_TEXT } from "./eligibility";
import {
  finalize, generate, itemFor, phaseSummaries, planWorkout, prepare, unknownRules,
  type EngineContext, type SlotPlan,
} from "./generate";
import { existingFor, metadataOf, nameKeyOf, parseSlotKey, rankAlternatives, selectExercises, slotKeyOf } from "./select";
import { uniqueIssues } from "./trace";
import type {
  Alternative, AlternativeTarget, EngineInput, EngineOutcome, EngineResult, Issue, ItemOut, OccurrenceOut,
  RegenerationScope, StructureOccurrence, StructurePhase, StructureWorkout, SubstitutionTarget,
} from "./types";

const fail = (code: string, message: string): EngineOutcome => ({ ok: false, code, message });

function locate(ctx: EngineContext, phaseIndex: number, label: string): { phase: StructurePhase; workout: StructureWorkout } | null {
  const phase = ctx.input.structure.phases.find((p) => p.index === phaseIndex);
  const workout = phase?.workouts.find((w) => w.label === label);
  return phase && workout ? { phase, workout } : null;
}

function renumber(items: ItemOut[]): ItemOut[] {
  return items.map((item, i) => (item.position === i + 1 ? item : { ...item, position: i + 1 }));
}

function asStructureOcc(o: OccurrenceOut): StructureOccurrence {
  return { week: o.week, slot: o.slot, label: o.label, plannedDate: o.plannedDate, weekStart: o.weekStart };
}

function touchedPhases(input: EngineInput, scope: RegenerationScope): number[] {
  if (scope.kind !== "FROM_PHASE") return [scope.phaseIndex];
  const order = input.structure.phases.map((p) => p.index);
  const start = order.indexOf(scope.phaseIndex);
  return start < 0 ? [] : order.slice(start);
}

function inRegenScope(scope: RegenerationScope, o: { phaseIndex: number; week: number; slot: number; label: string }, touched: number[]): boolean {
  switch (scope.kind) {
    case "OCCURRENCE":
    case "ITEM":
      return o.phaseIndex === scope.phaseIndex && o.week === scope.week && o.slot === scope.slot;
    case "WEEK":
      return o.phaseIndex === scope.phaseIndex && o.week === scope.week;
    case "WORKOUT":
      return o.phaseIndex === scope.phaseIndex && o.label === scope.label && o.week >= (scope.fromWeek ?? 1);
    case "PHASE":
    case "FROM_PHASE":
      return touched.includes(o.phaseIndex);
  }
}

// ---------- substituição ----------

function substituteWith(
  ctx: EngineContext,
  previous: EngineResult,
  target: SubstitutionTarget,
  nextExerciseId: string,
  by: "PROFESSIONAL" | "ENGINE",
): EngineOutcome {
  const parsed = parseSlotKey(target.slotKey);
  if (!parsed || parsed.phaseIndex !== target.phaseIndex) return fail("TARGET_NOT_FOUND", "Item não encontrado na proposta.");
  const where = locate(ctx, target.phaseIndex, parsed.label);
  if (!where) return fail("TARGET_NOT_FOUND", "Treino não encontrado na estrutura.");
  const next = ctx.byId.get(nextExerciseId);
  if (!next) return fail("EXERCISE_NOT_IN_CATALOG", "O exercício escolhido não está na biblioteca visível.");
  const plan = planWorkout(ctx, where.phase, where.workout, new Set(), new Set());
  const reason = ineligibleReason(next, ctx.elig, plan.modalities ? new Set(plan.modalities.value) : null, new Set(where.workout.focus.excludedExerciseIds ?? []), { ignoreMetadata: true });
  if (reason) return fail("REPLACEMENT_INELIGIBLE", `${next.name} não é elegível para este treino: ${INELIGIBLE_TEXT[reason]}.`);
  const affected = (o: OccurrenceOut) =>
    o.phaseIndex === target.phaseIndex && o.label === parsed.label &&
    (target.applies.kind === "PHASE" || (target.applies.kind === "FROM_WEEK" ? o.week >= target.applies.week : o.week === target.applies.week && o.slot === target.applies.slot)) &&
    o.items.some((i) => i.slotKey === target.slotKey);
  const hits = previous.occurrences.filter(affected);
  if (!hits.length) return fail("TARGET_NOT_FOUND", "Nenhuma sessão do escopo tem este item.");
  if (hits.some((o) => o.items.some((i) => i.exerciseId === next.id))) return fail("REPLACEMENT_DUPLICATE", `${next.name} já está numa das sessões escolhidas.`);
  const usedKeys = new Set(previous.occurrences.filter((o) => o.phaseIndex === target.phaseIndex && o.label === parsed.label).flatMap((o) => o.items.map((i) => i.slotKey)));
  let k = 0;
  let slotKey = slotKeyOf(target.phaseIndex, parsed.label, next.id, nameKeyOf(next.name, next.nameKey), k);
  while (usedKeys.has(slotKey)) slotKey = slotKeyOf(target.phaseIndex, parsed.label, next.id, nameKeyOf(next.name, next.nameKey), ++k);
  const issues: Issue[] = [];
  const occurrences = previous.occurrences.map((o) => {
    if (!affected(o)) return o;
    const old = o.items.find((i) => i.slotKey === target.slotKey) as ItemOut;
    const inOcc = new Set(o.items.map((i) => i.exerciseId).filter((id): id is string => Boolean(id)));
    const slot: SlotPlan = {
      slotKey, exercise: next, existing: null, origin: by === "PROFESSIONAL" ? "SUBSTITUTED" : "ENGINE",
      selection: [{
        code: by === "PROFESSIONAL" ? "PROFESSIONAL_SUBSTITUTION" : "ENGINE_REPLACEMENT",
        basis: by === "PROFESSIONAL" ? "PROFESSIONAL" : "HEURISTIC", ...(by === "ENGINE" ? { ruleId: "ALTERNATIVE_WEIGHTS" } : {}),
        detail: by === "PROFESSIONAL" ? `Substitui ${old.exerciseName} por decisão do profissional.` : `Troca pedida pelo profissional; o motor escolheu a alternativa mais próxima de ${old.exerciseName}.`,
      }],
      alternatives: rankAlternatives(ctx.log, next, metricFor(next, ctx.input.parameters).metric, plan.pool, inOcc, ctx.log.get("ALTERNATIVES_LIMIT")).map((a) => a.exerciseId),
    };
    const item = itemFor(ctx, where, slot, old.position, asStructureOcc(o), o.stimulus, issues);
    return { ...o, items: o.items.map((i) => (i.slotKey === target.slotKey ? { ...item, origin: by === "PROFESSIONAL" ? ("SUBSTITUTED" as const) : ("ENGINE" as const), substitutesSlotKey: target.slotKey } : i)) };
  });
  return { ok: true, result: finalize(ctx, { ...previous, occurrences, issues: uniqueIssues([...previous.issues, ...issues]) }) };
}

/** Substitui o exercício de um item no escopo pedido; a dose é recalculada para o novo exercício. */
export function substitute(input: EngineInput, previous: EngineResult, target: SubstitutionTarget, nextExerciseId: string): EngineOutcome {
  const ctx = prepare(input);
  if (!ctx) return { ok: true, result: unknownRules(input) };
  return substituteWith(ctx, previous, target, nextExerciseId, "PROFESSIONAL");
}

// ---------- alternativas ----------

export function alternativesFor(input: EngineInput, previous: EngineResult, target: AlternativeTarget, limit: number): Alternative[] {
  const ctx = prepare(input);
  if (!ctx) return [];
  const parsed = parseSlotKey(target.slotKey);
  if (!parsed) return [];
  const where = locate(ctx, target.phaseIndex, parsed.label);
  if (!where) return [];
  const occs = previous.occurrences.filter((o) => o.phaseIndex === target.phaseIndex && o.label === parsed.label && o.items.some((i) => i.slotKey === target.slotKey)
    && (target.week === undefined || (o.week === target.week && (target.slot === undefined || o.slot === target.slot))));
  const item = occs[0]?.items.find((i) => i.slotKey === target.slotKey);
  const exercise = item?.exerciseId ? ctx.byId.get(item.exerciseId) ?? null : null;
  const exclude = new Set(occs.flatMap((o) => o.items.map((i) => i.exerciseId)).filter((id): id is string => Boolean(id)));
  const plan = planWorkout(ctx, where.phase, where.workout, new Set(), new Set());
  return rankAlternatives(ctx.log, exercise, exercise ? metricFor(exercise, input.parameters).metric : null, plan.pool, exclude, Math.min(limit, TECHNICAL_LIMITS.MAX_ALTERNATIVES));
}

// ---------- regeneração ----------

export function regenerate(input: EngineInput, previous: EngineResult, scope: RegenerationScope): EngineOutcome {
  const ctx = prepare(input);
  if (!ctx) return { ok: true, result: unknownRules(input) };
  const phase = input.structure.phases.find((p) => p.index === scope.phaseIndex);
  if (!phase) return fail("SCOPE_NOT_FOUND", `Fase ${scope.phaseIndex} não existe.`);
  if ((scope.kind === "OCCURRENCE" || scope.kind === "ITEM") && !phase.occurrences.some((o) => o.week === scope.week && o.slot === scope.slot))
    return fail("SCOPE_NOT_FOUND", `Semana ${scope.week}, sessão ${scope.slot} não existe na fase ${scope.phaseIndex}.`);
  if (scope.kind === "WEEK" && (scope.week < 1 || scope.week > phase.weeks)) return fail("SCOPE_NOT_FOUND", `Semana ${scope.week} não existe.`);
  if (scope.kind === "WORKOUT" && !phase.workouts.some((w) => w.label === scope.label)) return fail("SCOPE_NOT_FOUND", `Treino ${scope.label} não existe.`);

  if (scope.kind === "ITEM") {
    const occ = previous.occurrences.find((o) => o.phaseIndex === scope.phaseIndex && o.week === scope.week && o.slot === scope.slot);
    const item = occ?.items.find((i) => i.slotKey === scope.slotKey);
    if (!occ || !item) return fail("TARGET_NOT_FOUND", "Item não encontrado na sessão.");
    const where = locate(ctx, scope.phaseIndex, occ.label);
    if (!where) return fail("TARGET_NOT_FOUND", "Treino não encontrado na estrutura.");
    const alt = alternativesFor(input, previous, { phaseIndex: scope.phaseIndex, slotKey: scope.slotKey, week: scope.week, slot: scope.slot }, 1)[0];
    let nextId = alt?.exerciseId ?? null;
    if (!nextId) {
      const plan = planWorkout(ctx, where.phase, where.workout, new Set(), new Set());
      const inOcc = new Set(occ.items.map((i) => i.exerciseId).filter((id): id is string => Boolean(id)));
      const others = occ.items.filter((i) => i.slotKey !== scope.slotKey).map((i) => (i.exerciseId ? ctx.byId.get(i.exerciseId) : undefined)).filter((e) => e !== undefined);
      nextId = selectExercises(ctx.log, {
        stimulus: occ.stimulus?.value ?? null, pool: plan.pool.filter((e) => !inOcc.has(e.id)), count: others.length + 1, coverage: plan.summary.coverage,
        fixed: others, fixedCount: others.length, preferred: new Set(input.parameters.preferredExerciseIds), experience: ctx.experience,
        history: ctx.history, usedInPhase: new Set(), usedInPreviousPhase: new Set(), avoid: new Set(item.exerciseId ? [item.exerciseId] : []), maxItems: TECHNICAL_LIMITS.MAX_ITEMS_PER_WORKOUT,
      })[0]?.exercise.id ?? null;
    }
    if (!nextId) return fail("NO_REPLACEMENT", "Nenhum outro exercício elegível para esta sessão.");
    return substituteWith(ctx, previous, { phaseIndex: scope.phaseIndex, slotKey: scope.slotKey, applies: { kind: "OCCURRENCE", week: scope.week, slot: scope.slot } }, nextId, "ENGINE");
  }

  const touched = touchedPhases(input, scope);
  const fresh = generate({ ...input, scope: { kind: "PHASES", phaseIndexes: touched } });
  const locked = new Set(input.locked.map((l) => `${l.phaseIndex}|${l.slotKey}`));
  const prevByKey = new Map(previous.occurrences.map((o) => [`${o.phaseIndex}|${o.week}|${o.slot}`, o]));
  const freshByKey = new Map(fresh.occurrences.map((o) => [`${o.phaseIndex}|${o.week}|${o.slot}`, o]));
  const occurrences: OccurrenceOut[] = [];
  for (const p of input.structure.phases)
    for (const so of [...p.occurrences].sort((a, b) => a.week - b.week || a.slot - b.slot)) {
      const key = `${p.index}|${so.week}|${so.slot}`;
      const prev = prevByKey.get(key);
      if (!inRegenScope(scope, { phaseIndex: p.index, week: so.week, slot: so.slot, label: so.label }, touched)) {
        if (prev) occurrences.push(prev);
        continue;
      }
      const f = freshByKey.get(key);
      if (!f) continue;
      let items = f.items;
      for (const old of prev?.items ?? []) {
        if (!locked.has(`${p.index}|${old.slotKey}`)) continue;
        const at = items.findIndex((i) => i.slotKey === old.slotKey);
        items = at >= 0 ? items.map((i, n) => (n === at ? { ...old, position: i.position, origin: "LOCKED" as const } : i)) : [...items, { ...old, origin: "LOCKED" as const }];
      }
      occurrences.push({ ...f, items: renumber(items) });
    }
  const touchedSet = new Set(touched);
  const issues = [
    ...fresh.issues.filter((i) => i.stage === "INPUT"),
    ...previous.issues.filter((i) => i.stage === "SELECTION" && (i.phaseIndex === undefined || !touchedSet.has(i.phaseIndex))),
    ...fresh.issues.filter((i) => i.stage === "SELECTION"),
  ];
  const workouts = [
    ...previous.workouts.filter((w) => !touchedSet.has(w.phaseIndex)),
    ...fresh.workouts.filter((w) => touchedSet.has(w.phaseIndex)),
  ].sort((a, b) => input.structure.phases.findIndex((p) => p.index === a.phaseIndex) - input.structure.phases.findIndex((p) => p.index === b.phaseIndex));
  const merged: EngineResult = {
    ...fresh, phases: phaseSummaries(input), workouts, occurrences, issues: uniqueIssues(issues),
    rulesUsed: [...previous.rulesUsed, ...fresh.rulesUsed.filter((r) => !previous.rulesUsed.some((p) => p.ruleId === r.ruleId))],
  };
  return { ok: true, result: finalize(ctx, merged) };
}

// ---------- rebase ----------

/** Traz as linhas atuais da revisão (`input.existing`) para a proposta e revalida. */
export function rebase(input: EngineInput, previous: EngineResult): EngineOutcome {
  const ctx = prepare(input);
  if (!ctx) return { ok: true, result: unknownRules(input) };
  const occurrences = previous.occurrences.map((o) => {
    const rows = existingFor(input.existing, o.phaseIndex, o.label);
    const counts = new Map<string, number>();
    const preserved: ItemOut[] = rows.map((x) => {
      const nameKey = nameKeyOf(x.name, x.nameKey);
      const ref = x.exerciseId ?? `custom:${nameKey}`;
      const k = counts.get(ref) ?? 0;
      counts.set(ref, k + 1);
      const exercise = x.exerciseId ? ctx.byId.get(x.exerciseId) ?? null : null;
      return {
        slotKey: slotKeyOf(o.phaseIndex, o.label, x.exerciseId, nameKey, k), position: 0, exerciseId: x.exerciseId, exerciseName: x.name,
        modality: exercise?.modality ?? null, dose: x.dose, display: x.display, origin: "PRESERVED", existingPrescribedExerciseId: x.prescribedExerciseId,
        substitutesSlotKey: null, alternatives: [], metadata: metadataOf(exercise),
        trace: { selection: [{ code: "PRESERVED", basis: "PROFESSIONAL", detail: "Linha que já estava na revisão em rascunho: preservada como está." }], params: [] },
      };
    });
    const ids = new Set(rows.map((x) => x.exerciseId).filter((id): id is string => Boolean(id)));
    const keys = new Set(preserved.map((p) => p.slotKey));
    const rest = o.items.filter((i) => i.origin !== "PRESERVED" && !(i.exerciseId && ids.has(i.exerciseId)) && !keys.has(i.slotKey));
    return { ...o, items: renumber([...preserved, ...rest]) };
  });
  return { ok: true, result: finalize(ctx, { ...previous, occurrences }) };
}
