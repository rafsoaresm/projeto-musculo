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
  coverageFor, finalize, generate, itemFor, phaseSummaries, planWorkout, prepare, prepareWorkout, unknownRules,
  type EngineContext, type SlotPlan,
} from "./generate";
import { blueprintSupplyIssue, fixedWorkoutFrom, laneKey, type FixedWorkout, type GenerateOptions, type ReservedSubstitution } from "./microcycle";
import { existingFor, metadataOf, nameKeyOf, parseSlotKey, rankAlternatives, selectExercises, slotKeyOf } from "./select";
import { doseUncertaintyIssues } from "./dose-profile";
import { DOSE_UNCERTAIN_CODE, uniqueIssues } from "./trace";
import type {
  Alternative, AlternativeTarget, EngineInput, EngineOutcome, EngineResult, Issue, ItemOut, OccurrenceOut,
  RegenerationScope, StructureOccurrence, StructurePhase, StructureWorkout, SubstitutionTarget,
} from "./types";

const fail = (code: string, message: string): EngineOutcome => ({ ok: false, code, message });

function isLocked(ctx: EngineContext, phaseIndex: number, slotKey: string): boolean {
  return ctx.input.locked.some((l) => l.phaseIndex === phaseIndex && l.slotKey === slotKey);
}

function locate(ctx: EngineContext, phaseIndex: number, label: string): { phase: StructurePhase; workout: StructureWorkout } | null {
  const phase = ctx.input.structure.phases.find((p) => p.index === phaseIndex);
  const workout = phase?.workouts.find((w) => w.label === label);
  return phase && workout ? { phase, workout } : null;
}

/** Seleção por microciclo (2026.11.4+) nesta proposta: muda só o que a seleção recebe e o que uma regeneração refaz. */
const microcycle = (ctx: EngineContext) => ctx.log.optional("MICROCYCLE_SELECTION") !== undefined;

/**
 * O que as operações sem seleção usam de um treino (biblioteca elegível, modalidades, cobertura). No microciclo, só a
 * preparação (nenhuma seleção é feita para isso); na seleção antiga, o plano inteiro, como antes (reprodução byte a byte).
 */
function poolOf(ctx: EngineContext, phase: StructurePhase, workout: StructureWorkout) {
  if (microcycle(ctx)) {
    const d = prepareWorkout(ctx, phase, workout);
    return { phase, workout, pool: d.pool, modalities: d.modalities, coverage: d.coverage };
  }
  const p = planWorkout(ctx, phase, workout, new Set(), new Set());
  return { phase, workout, pool: p.pool, modalities: p.modalities, coverage: p.summary.coverage };
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
  const plan = poolOf(ctx, where.phase, where.workout);
  const reason = ineligibleReason(next, ctx.elig, plan.modalities ? new Set(plan.modalities.value) : null, new Set(where.workout.focus.excludedExerciseIds ?? []), { ignoreMetadata: true });
  if (reason) return fail("REPLACEMENT_INELIGIBLE", `${next.name} não é elegível para este treino: ${INELIGIBLE_TEXT[reason]}.`);
  const affected = (o: OccurrenceOut) =>
    o.phaseIndex === target.phaseIndex && o.label === parsed.label &&
    (target.applies.kind === "PHASE" || (target.applies.kind === "FROM_WEEK" ? o.week >= target.applies.week : o.week === target.applies.week && o.slot === target.applies.slot)) &&
    o.items.some((i) => i.slotKey === target.slotKey);
  const hits = previous.occurrences.filter(affected);
  if (!hits.length) return fail("TARGET_NOT_FOUND", "Nenhuma sessão do escopo tem este item.");
  if (isLocked(ctx, target.phaseIndex, target.slotKey) || hits.some((o) => o.items.some((i) => i.slotKey === target.slotKey && i.origin === "LOCKED")))
    return fail("TARGET_LOCKED", "Este item está travado; destrave antes de trocar o exercício.");
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
    // a chave substituída é sempre a da linha original (troca de uma troca continua apontando para ela)
    const root = old.substitutesSlotKey ?? target.slotKey;
    return { ...o, items: o.items.map((i) => (i.slotKey === target.slotKey ? { ...item, origin: by === "PROFESSIONAL" ? ("SUBSTITUTED" as const) : ("ENGINE" as const), substitutesSlotKey: root } : i)) };
  });
  // O aviso de oferta fora do foco descreve os itens do treino: depois da troca é refeito (o antigo sai) para não ficar velho.
  const coverage = coverageFor(ctx, where.phase, where.workout);
  const offCounts = occurrences.filter((o) => o.phaseIndex === target.phaseIndex && o.label === parsed.label).map((o) =>
    blueprintSupplyIssue(coverage, target.phaseIndex, parsed.label, o.items.filter((i) => i.origin === "ENGINE" && i.exerciseId)
      .map((i) => ctx.byId.get(i.exerciseId as string)).filter((e): e is NonNullable<typeof e> => Boolean(e))));
  const supply = offCounts.reduce<Issue | null>((a, b) => ((b?.count ?? 0) > (a?.count ?? 0) ? b : a), null);
  const kept = previous.issues.filter((i) => !(i.code === "BLUEPRINT_FOCUS_SUPPLY_LOW" && i.phaseIndex === target.phaseIndex && i.label === parsed.label));
  return { ok: true, result: finalize(ctx, { ...previous, occurrences, issues: withDoseUncertainty([...kept, ...(supply ? [supply] : []), ...issues], occurrences) }) };
}

/**
 * O aviso "perfil de dose sem metadado" descreve os itens do treino (contagem por treino): depois de trocar ou regenerar parte da
 * proposta o gravado fica velho (contagem errada, ou um aviso agregado e outro novo no mesmo treino). Todos saem e são refeitos
 * dos itens finais; sem perfil de dose nas regras da versão não há nada a refazer e a lista segue como está.
 */
function withDoseUncertainty(issues: Issue[], occurrences: readonly OccurrenceOut[]): Issue[] {
  const fresh = doseUncertaintyIssues(occurrences);
  if (!fresh.length && !issues.some((i) => i.code === DOSE_UNCERTAIN_CODE)) return uniqueIssues(issues);
  return uniqueIssues([...issues.filter((i) => i.code !== DOSE_UNCERTAIN_CODE), ...fresh]);
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
  const plan = poolOf(ctx, where.phase, where.workout);
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
    // regenerar mantém preservados e travados: o motor nunca troca sozinho uma linha do profissional
    if (item.origin === "LOCKED" || isLocked(ctx, scope.phaseIndex, scope.slotKey))
      return fail("TARGET_LOCKED", "Este item está travado; destrave antes de pedir outro exercício.");
    if (item.origin === "PRESERVED")
      return fail("TARGET_PRESERVED", "Esta linha já estava na revisão e é mantida; para trocá-la, use a substituição (aplicar exige confirmação).");
    const where = locate(ctx, scope.phaseIndex, occ.label);
    if (!where) return fail("TARGET_NOT_FOUND", "Treino não encontrado na estrutura.");
    const alt = alternativesFor(input, previous, { phaseIndex: scope.phaseIndex, slotKey: scope.slotKey, week: scope.week, slot: scope.slot }, 1)[0];
    let nextId = alt?.exerciseId ?? null;
    if (!nextId) {
      const plan = poolOf(ctx, where.phase, where.workout);
      const inOcc = new Set(occ.items.map((i) => i.exerciseId).filter((id): id is string => Boolean(id)));
      const others = occ.items.filter((i) => i.slotKey !== scope.slotKey).map((i) => (i.exerciseId ? ctx.byId.get(i.exerciseId) : undefined)).filter((e) => e !== undefined);
      nextId = selectExercises(ctx.log, {
        stimulus: occ.stimulus?.value ?? null, pool: plan.pool.filter((e) => !inOcc.has(e.id)), count: others.length + 1, coverage: plan.coverage,
        fixed: others, fixedCount: others.length, preferred: new Set(input.parameters.preferredExerciseIds), experience: ctx.experience,
        history: ctx.history, usedInPhase: new Set(), usedInPreviousPhase: new Set(), avoid: new Set(item.exerciseId ? [item.exerciseId] : []), maxItems: TECHNICAL_LIMITS.MAX_ITEMS_PER_WORKOUT,
      })[0]?.exercise.id ?? null;
    }
    if (!nextId) return fail("NO_REPLACEMENT", "Nenhum outro exercício elegível para esta sessão.");
    return substituteWith(ctx, previous, { phaseIndex: scope.phaseIndex, slotKey: scope.slotKey, applies: { kind: "OCCURRENCE", week: scope.week, slot: scope.slot } }, nextId, "ENGINE");
  }

  const touched = touchedPhases(input, scope);
  // Trava de um item que só existe em parte das sessões (ex.: trocado numa sessão e travado) vale
  // só onde estava; não entra na geração (que trava o treino inteiro) e é recolocada abaixo.
  const partial = new Set<string>();
  for (const l of input.locked) {
    const parsed = parseSlotKey(l.slotKey);
    if (!parsed) continue;
    const occs = previous.occurrences.filter((o) => o.phaseIndex === l.phaseIndex && o.label === parsed.label);
    const holders = occs.filter((o) => o.items.some((i) => i.slotKey === l.slotKey)).length;
    if (holders > 0 && holders < occs.length) partial.add(`${l.phaseIndex}|${l.slotKey}`);
  }
  const micro = microcycle(ctx);
  const options = micro ? microcycleOptions(ctx, previous, scope, touched) : {};
  const fixedKeys = new Set(options.fixedWorkouts?.keys() ?? []);
  const fresh = generate({ ...input, locked: input.locked.filter((l) => !partial.has(`${l.phaseIndex}|${l.slotKey}`)), scope: { kind: "PHASES", phaseIndexes: touched } }, options);
  const locked = new Set(input.locked.map((l) => `${l.phaseIndex}|${l.slotKey}`));
  const prevByKey = new Map(previous.occurrences.map((o) => [`${o.phaseIndex}|${o.week}|${o.slot}`, o]));
  const freshByKey = new Map(fresh.occurrences.map((o) => [`${o.phaseIndex}|${o.week}|${o.slot}`, o]));
  const kept: Issue[] = [];
  const plans = new Map<string, ReturnType<typeof poolOf> | null>();
  const planOf = (p: StructurePhase, label: string) => {
    const k = `${p.index}|${label}`;
    if (!plans.has(k)) {
      const w = p.workouts.find((x) => x.label === label);
      plans.set(k, w ? poolOf(ctx, p, w) : null);
    }
    return plans.get(k) ?? null;
  };
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
      const place = (next: ItemOut, old: ItemOut): boolean => {
        let at = items.findIndex((i) => i.slotKey === old.slotKey);
        if (at < 0 && old.exerciseId) at = items.findIndex((i) => i.exerciseId === old.exerciseId && i.origin !== "LOCKED");
        if (at < 0 && old.substitutesSlotKey) at = items.findIndex((i) => i.slotKey === old.substitutesSlotKey && i.origin !== "LOCKED");
        if (at < 0) return false;
        items = items.map((i, n) => (n === at ? { ...next, position: i.position } : i));
        return true;
      };
      const path = `occurrences.${p.index}.${so.week}.${so.slot}`;
      // travados: mantidos como estavam (dose antiga)
      for (const old of prev?.items ?? []) {
        if (!locked.has(`${p.index}|${old.slotKey}`)) continue;
        const next = { ...old, origin: "LOCKED" as const };
        if (!place(next, old)) items = [...items, next];
      }
      // trocas do profissional: decisão mantida; a dose é recalculada com os parâmetros atuais
      for (const old of prev?.items ?? []) {
        if (old.origin !== "SUBSTITUTED" || locked.has(`${p.index}|${old.slotKey}`)) continue;
        const plan = planOf(p, so.label);
        const exercise = old.exerciseId ? ctx.byId.get(old.exerciseId) : undefined;
        const reason = exercise && plan
          ? ineligibleReason(exercise, ctx.elig, plan.modalities ? new Set(plan.modalities.value) : null, new Set(plan.workout.focus.excludedExerciseIds ?? []), { ignoreMetadata: true })
          : "ARCHIVED";
        const drop = (why: string) => kept.push({
          severity: "WARNING", code: "SUBSTITUTION_DROPPED", path: `${path}.${old.slotKey}`, phaseIndex: p.index, label: so.label, stage: "SELECTION",
          message: `Semana ${so.week}, sessão ${so.slot}: a troca para ${old.exerciseName} não foi mantida (${why}); revise o item.`,
        });
        if (!exercise || !plan || reason) {
          drop(reason ? INELIGIBLE_TEXT[reason] : "exercício fora da biblioteca");
          continue;
        }
        const slot: SlotPlan = { slotKey: old.slotKey, exercise, existing: null, origin: "SUBSTITUTED", selection: old.trace.selection, alternatives: old.alternatives };
        const next = { ...itemFor(ctx, plan, slot, old.position, so, f.stimulus, kept), substitutesSlotKey: old.substitutesSlotKey };
        if (!place(next, old)) drop("o item original não está mais neste treino");
      }
      occurrences.push({ ...f, items: renumber(items) });
    }
  const touchedSet = new Set(touched);
  // Microciclo: um treino mantido inteiro (regeneração de outro treino ou de uma sessão) guarda os avisos e o resumo gravados.
  const isFixed = (i: { phaseIndex?: number; label?: string }) => i.phaseIndex !== undefined && i.label !== undefined && fixedKeys.has(laneKey(i.phaseIndex, i.label));
  const issues = [
    ...fresh.issues.filter((i) => i.stage === "INPUT"),
    ...previous.issues.filter((i) => i.stage === "SELECTION" && (i.phaseIndex === undefined || !touchedSet.has(i.phaseIndex) || isFixed(i))),
    ...fresh.issues.filter((i) => i.stage === "SELECTION" && !isFixed(i)),
    ...kept,
  ];
  const workouts = [
    ...previous.workouts.filter((w) => !touchedSet.has(w.phaseIndex) || isFixed(w)),
    ...fresh.workouts.filter((w) => touchedSet.has(w.phaseIndex) && !isFixed(w)),
  ].sort((a, b) => input.structure.phases.findIndex((p) => p.index === a.phaseIndex) - input.structure.phases.findIndex((p) => p.index === b.phaseIndex));
  const merged: EngineResult = {
    ...fresh, phases: phaseSummaries(input), workouts, occurrences, issues: withDoseUncertainty(issues, occurrences),
    rulesUsed: [...previous.rulesUsed, ...fresh.rulesUsed.filter((r) => !previous.rulesUsed.some((p) => p.ruleId === r.ruleId))],
  };
  return { ok: true, result: finalize(ctx, merged) };
}

/**
 * Opções da seleção por microciclo numa regeneração: a fase anterior gravada (variação), os treinos fora do escopo como
 * estado fixo (regenerar um treino ou uma sessão) e as trocas do profissional presentes em todas as sessões do escopo.
 */
function microcycleOptions(ctx: EngineContext, previous: EngineResult, scope: RegenerationScope, touched: number[]): GenerateOptions {
  const order = ctx.input.structure.phases;
  const touchedSet = new Set(touched);
  const previousPhaseExercises = new Map<number, string[]>();
  for (const t of touched) {
    const at = order.findIndex((p) => p.index === t);
    const pred = at > 0 ? order[at - 1] : null;
    if (!pred || touchedSet.has(pred.index)) continue;
    const ids = new Set<string>();
    for (const o of previous.occurrences) if (o.phaseIndex === pred.index) for (const i of o.items) if (i.exerciseId) ids.add(i.exerciseId);
    previousPhaseExercises.set(pred.index, [...ids].sort());
  }
  const fixedWorkouts = new Map<string, FixedWorkout>();
  const reserved = new Map<string, ReservedSubstitution[]>();
  for (const phase of order) {
    if (!touchedSet.has(phase.index)) continue;
    const labelsInScope = new Set(phase.occurrences.filter((o) => inRegenScope(scope, { phaseIndex: phase.index, week: o.week, slot: o.slot, label: o.label }, touched)).map((o) => o.label));
    for (const w of phase.workouts) {
      const key = laneKey(phase.index, w.label);
      if (!labelsInScope.has(w.label)) {
        fixedWorkouts.set(key, fixedWorkoutFrom(ctx, phase, w.label, previous.occurrences));
        continue;
      }
      // Trocas do profissional presentes em TODAS as sessões do escopo deste treino: ocupam a vaga na seleção nova.
      // Uma troca parcial (uma sessão, a partir de uma semana) segue o caminho antigo (recolocada onde estava).
      const occs = previous.occurrences.filter((o) => o.phaseIndex === phase.index && o.label === w.label && inRegenScope(scope, o, touched));
      if (!occs.length) continue;
      const locked = new Set(ctx.input.locked.filter((l) => l.phaseIndex === phase.index).map((l) => l.slotKey));
      const subs = new Map<string, ReservedSubstitution>();
      for (const item of occs[0].items) {
        if (item.origin !== "SUBSTITUTED" || !item.exerciseId || locked.has(item.slotKey)) continue;
        if (!occs.every((o) => o.items.some((i) => i.origin === "SUBSTITUTED" && i.exerciseId === item.exerciseId))) continue;
        const root = item.substitutesSlotKey ? parseSlotKey(item.substitutesSlotKey) : null;
        subs.set(item.exerciseId, { exerciseId: item.exerciseId, replaces: root?.exerciseId ?? null });
      }
      if (subs.size) reserved.set(key, [...subs.values()]);
    }
  }
  return { previousPhaseExercises, fixedWorkouts, reserved };
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
  // linhas novas na revisão podem passar da quantidade pedida: avisa de novo (nada é removido)
  const issues = previous.issues.filter((i) => i.code !== "EXISTING_EXCEEDS_TARGET");
  for (const w of previous.workouts) {
    if (!w.count) continue;
    const most = Math.max(0, ...occurrences.filter((o) => o.phaseIndex === w.phaseIndex && o.label === w.label).map((o) => o.items.length));
    if (most > w.count.value)
      issues.push({ severity: "WARNING", code: "EXISTING_EXCEEDS_TARGET", path: `phases.${w.phaseIndex}.workouts.${w.label}`, phaseIndex: w.phaseIndex, label: w.label, stage: "SELECTION",
        message: `Treino ${w.label}: ${most} itens com as linhas atuais da revisão para uma quantidade de ${w.count.value}; nada foi removido.` });
  }
  return { ok: true, result: finalize(ctx, { ...previous, occurrences, issues }) };
}
