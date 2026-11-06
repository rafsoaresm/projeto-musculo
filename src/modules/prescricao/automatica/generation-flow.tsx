"use client";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Notice } from "@/components/ui";
import type { AcceptanceView } from "@/modules/prescricao/planejador/accept";
import { acceptStrategy, generateFromStrategy } from "@/modules/prescricao/planejador/blueprint-actions";
import type { PlanningAvailability } from "@/modules/prescricao/planejador/actions";
import { getPlanningState, planStrategies } from "@/modules/prescricao/planejador/actions";
import type { StrategyListView } from "@/modules/prescricao/planejador/strategy-view";
import { continueProposal, generateProposal, type ProposalActionResult } from "./actions";
import { BlueprintPreview } from "./blueprint-preview";
import { BaseStrip, StudentOrigin } from "./context-summary";
import type { GenerationQuestion } from "./contracts";
import { Diretrizes } from "./generation-diretrizes";
import { Politicas } from "./generation-politicas";
import { Progressao } from "./generation-progressao";
import {
  commitDraft,
  draftDirty,
  draftFor,
  equipmentSelection,
  equipmentSummary,
  formFieldErrors,
  pendingItems,
  pendingPhoneText,
  pendingSummary,
  policyFieldId,
  policySubtitle,
  policyTabOf,
  policyTabs,
  policyTitle,
  restoreRow,
  validateDraft,
  MINUTES_FIELD_ID,
  type DraftErrors,
  type FieldErrors,
  type PendingItem,
  type PolicyDraft,
  type PolicyTab,
} from "./generation-view";
import {
  acceptanceInput,
  beforeGenerating,
  contextCards,
  crumbText,
  defaultChoice,
  draftFrom,
  draftFromAcceptance,
  draftProblems,
  footerFor,
  headingFor,
  modePanel,
  NO_DOSING,
  parseStep,
  pillOf,
  planningBanner,
  proposalResultOf,
  plainAcceptanceInput,
  STEP_PILLS,
  strategyCards,
  suggestedIntents,
  weekPreview,
  type AcceptanceDraft,
  type Banner,
  type DosingChoice,
  type FlowStep,
  type Mode,
  type PlanningUi,
  type StrategyChoice,
} from "./flow-view";
import { ModePicker } from "./mode-picker";
import { PhaseFocus } from "./phase-focus";
import type { GenerationScreen } from "./service";
import { StrategyList } from "./strategy-list";
import { NETWORK_ERROR, useIntent } from "./use-intent";
import { usePhone } from "./use-phone";
import { DOSE_PROFILES_RULES_VERSION, EMPTY_FORM, answersFromForm, formFromAnswers, openRequired, shortDate, type GenerationForm as FormState } from "./view";

/**
 * "Montar prescrição" (Figma GEN-01..04 and M-01): three steps, no more — 1 Contexto (the four context cards and the mode: AI or rules), 2 Estratégia
 * (compare the suggestions, then the focus per phase) and 3 Revisar e gerar (the week-type preview, then the generation). The step is in the address
 * (`?etapa=`), so Back, Forward and a refresh work at any mount path. Nothing is accepted by choosing a card: the acceptance is written by "Conferir
 * blueprint", the generation by "Gerar proposta", and neither approves, applies or delivers anything.
 *
 * The required answers (stimulus, equipment, counts) sit inside step 1 as "Respostas necessárias"; the dose policy and the weekly progression sit inside
 * step 3 as "Políticas e progressão (opcional)". One form state and one generation, as before; "Sem divisão (geração atual)" generates exactly as the
 * previous build did (no acceptance, no blueprint). When the AI is not available, fails or hits its limit, the way out is always "Continuar por regras".
 */
type Sub = null | "equipment" | "policy";
const omit = <T,>(record: Record<string, T>, key: string): Record<string, T> => Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));
const NEVER_APPROVES = "A geração não aprova, não aplica e não entrega o plano ao aluno.";
const ACCEPT_REPLAN: ReadonlySet<string> = new Set(["revision_changed", "structure_changed", "run_missing", "plan_erased"]);

export interface GenerationHeader {
  studentName: string;
  planTitle: string;
  revisionNumber: number;
  /** The revision page ("Voltar ao plano"). */
  backHref: string;
  /** Where the saved periodization is edited (the student's periodization tab). */
  periodizationHref: string;
}

export interface FlowInitial {
  run: StrategyListView;
  acceptance: AcceptanceView | null;
}

export function GenerationFlow({
  planId, revisionId, screen, header, availability, initial,
}: {
  planId: string;
  revisionId: string;
  screen: GenerationScreen;
  header: GenerationHeader;
  availability: PlanningAvailability | null;
  initial: FlowInitial | null;
}) {
  const router = useRouter();
  const search = useSearchParams();
  const intent = useIntent();
  const phone = usePhone();
  const panel = useMemo(() => modePanel(availability), [availability]);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<string[]>([]);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [serverQuestions, setServerQuestions] = useState<GenerationQuestion[]>([]);
  const [progress, setProgress] = useState<string>("");
  const [sub, setSub] = useState<Sub>(null);
  const [expanded, setExpanded] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [tab, setTab] = useState<PolicyTab["id"]>(() => policyTabs(screen.policy)[0]?.id ?? "RESISTANCE");
  const [selectedKey, setSelectedKey] = useState<string>(() => policyTabs(screen.policy)[0]?.rows[0]?.key ?? "");
  const [drafts, setDrafts] = useState<Record<string, PolicyDraft>>({});
  const [draftErrors, setDraftErrors] = useState<Record<string, DraftErrors>>({});
  const [policyStatus, setPolicyStatus] = useState("");
  const [focus, setFocus] = useState<{ id: string } | null>(null);
  const [requiredOpen, setRequiredOpen] = useState(() => openRequired(screen.questions, EMPTY_FORM).length > 0);
  const [policyOpen, setPolicyOpen] = useState(false);

  // The planning and the acceptance (all restored from the server on a refresh).
  const [mode, setMode] = useState<Mode>(initial ? initial.run.producer : panel.defaultMode);
  const [list, setList] = useState<StrategyListView | null>(initial?.run ?? null);
  const [planning, setPlanning] = useState<PlanningUi>(initial ? { state: "READY", list: initial.run } : { state: "IDLE" });
  const [choice, setChoice] = useState<StrategyChoice>(initial ? (initial.acceptance?.strategyId ?? defaultChoice(initial.run)) : "NONE");
  const [draft, setDraft] = useState<AcceptanceDraft | null>(() => (initial?.acceptance ? draftFromAcceptance(initial.run, initial.acceptance, screen.structure) : null));
  const [accepted, setAccepted] = useState<{ id: string; dosing: string } | null>(initial?.acceptance ? { id: initial.acceptance.acceptanceId, dosing: JSON.stringify(initial.acceptance.dosing) } : null);
  const [dosing, setDosing] = useState<DosingChoice>(initial?.acceptance ? { byClass: initial.acceptance.dosing.byClass, progression: initial.acceptance.dosing.progression } : NO_DOSING);
  const [phase, setPhase] = useState<number>(screen.structure[0]?.index ?? 1);
  const [editing, setEditing] = useState<string | null>(null);
  const [banner, setBanner] = useState<Banner | null>(null);

  // A refresh or a full reload keeps the answers typed so far (a per-tab convenience: nothing else depends on it, and it may be unavailable).
  const storeKey = `fig-gen-form:${planId}:${revisionId}:${screen.contentVersion}`;
  const restored = useRef(false);
  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(storeKey);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read after hydration on purpose: the server renders the empty form
      if (saved) setForm({ ...EMPTY_FORM, ...(JSON.parse(saved) as Partial<FormState>) });
    } catch {
      /* storage unavailable or damaged: the form starts empty */
    }
    restored.current = true;
  }, [storeKey]);
  useEffect(() => {
    // Never write the untouched initial form: a remount right after hydration would read it back and lose what was saved.
    if (!restored.current || form === EMPTY_FORM) return;
    try {
      window.sessionStorage.setItem(storeKey, JSON.stringify(form));
    } catch {
      /* storage unavailable */
    }
  }, [form, storeKey]);

  const trigger = useRef<HTMLElement | null>(null);
  const phoneHead = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);

  const questions = useMemo(
    () => [...screen.questions, ...serverQuestions.filter((q) => !screen.questions.some((s) => s.code === q.code && s.phaseIndex === q.phaseIndex && s.label === q.label))],
    [screen.questions, serverQuestions],
  );
  const open = openRequired(questions, form);
  const info = questions.filter((q) => !q.required);
  const total = screen.structure.length;
  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));
  const clearError = (id: string) => setFieldErrors((e) => (id in e ? omit(e, id) : e));
  const selected = screen.policy.find((r) => r.key === selectedKey);
  const hasEquipment = equipmentSelection(form.equipment).none || equipmentSelection(form.equipment).codes.length > 0;
  const unsaved = screen.policy.filter((r) => draftDirty(r, form.policy, drafts[r.key]));

  // ----- the step: the address says it, what exists decides whether it can be shown -----
  const urlStep = parseStep(search.get("etapa"));
  const readyToPreview = Boolean(list) && (choice === "NONE" || (draft !== null && accepted !== null));
  let step: FlowStep = urlStep;
  if (step !== "contexto" && !list) step = "contexto";
  else if (step === "focos" && !draft) step = "estrategia";
  else if (step === "previa" && !readyToPreview) step = "estrategia";
  const stepperIndex = pillOf(step);

  function go(next: FlowStep) {
    setSub(null);
    setEditing(null);
    window.history.pushState(null, "", `?etapa=${next}`);
  }
  // After a change of step or screen the page starts at its top; on the phone the focus goes to the screen's title.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (sub) phoneHead.current?.focus();
    window.scrollTo({ top: 0 });
  }, [step, sub]);
  // A pending item or an invalid field the professional is sent to: focused once its step and screen are showing.
  useEffect(() => {
    if (!focus) return;
    const el = document.getElementById(focus.id);
    el?.focus();
    el?.scrollIntoView({ block: "center" });
  }, [focus]);

  // "Já existe um planejamento em andamento": look again every 2 s, at most 30 times.
  const inProgress = planning.state === "FAILED" && planning.reason === "in_progress";
  useEffect(() => {
    if (!inProgress) return;
    let tries = 0;
    const timer = setInterval(async () => {
      tries += 1;
      const state = await getPlanningState(planId, revisionId).catch(() => null);
      if (state?.state === "READY") {
        clearInterval(timer);
        showList(state.view);
      } else if (tries >= 30 || state?.state === "FAILED") clearInterval(timer);
    }, 2000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inProgress, planId, revisionId]);

  function setFocusId(id: string) {
    setFocus({ id });
  }
  function closeSub() {
    setSub(null);
    requestAnimationFrame(() => trigger.current?.focus());
  }
  function openEquipment(el: HTMLElement) {
    trigger.current = el;
    setSub("equipment");
  }
  function editPolicy(key: string, el: HTMLElement) {
    setSelectedKey(key);
    setPolicyStatus("");
    if (phone) {
      trigger.current = el;
      setSub("policy");
    } else {
      const firstParam = screen.policy.find((r) => r.key === key)?.defaults[0]?.param;
      if (firstParam) setFocusId(policyFieldId(firstParam));
    }
  }
  function goTo(item: PendingItem) {
    setRequiredOpen(true);
    go("contexto");
    setSub(item.code === "EQUIPMENT" && phone ? "equipment" : null);
    setFocusId(item.fieldId);
  }
  function savePolicy() {
    if (!selected) return;
    const d = drafts[selected.key] ?? draftFor(selected, form.policy);
    const bad = validateDraft(selected, d);
    if (Object.keys(bad).length) {
      setDraftErrors((e) => ({ ...e, [selected.key]: bad }));
      setPolicyStatus("");
      const firstBad = selected.defaults.find((x) => bad[x.param]);
      if (firstBad) setFocusId(policyFieldId(firstBad.param));
      return;
    }
    setForm((f) => ({ ...f, policy: commitDraft(selected, f.policy, d) }));
    setDrafts((x) => omit(x, selected.key));
    setDraftErrors((x) => omit(x, selected.key));
    setPolicyStatus("Ajustes salvos nesta geração. Ficam registrados como decisão sua.");
    if (phone) closeSub();
  }
  function restorePolicy() {
    if (!selected) return;
    setForm((f) => ({ ...f, policy: restoreRow(selected, f.policy) }));
    setDrafts((x) => omit(x, selected.key));
    setDraftErrors((x) => omit(x, selected.key));
    setPolicyStatus("Valores padrão da versão do motor restaurados.");
  }

  // ----- step 1 -> 2: plan (AI or rules) -----
  function showList(view: StrategyListView) {
    setList(view);
    setPlanning({ state: "READY", list: view });
    setMode(view.producer);
    setChoice(defaultChoice(view));
    setDraft(null);
    setAccepted(null);
    setDosing(NO_DOSING);
    setBanner(null);
    setPhase(screen.structure[0]?.index ?? 1);
    go("estrategia");
  }

  function runPlan(planMode: Mode) {
    const built = answersFromForm(form, screen.policy);
    if (!built.ok) {
      setErrors(built.errors);
      return;
    }
    setErrors([]);
    setBanner(null);
    setMode(planMode);
    setPlanning({ state: "RUNNING", mode: planMode });
    startTransition(async () => {
      try {
        const mine = intent.take(`plan:${planMode}:${screen.contentVersion}:${JSON.stringify(built.answers)}`);
        const outcome = await planStrategies(planId, revisionId, { idempotencyKey: mine.key, baseContentVersion: screen.contentVersion, mode: planMode, answers: built.answers });
        intent.done();
        if (outcome.ok) {
          showList(outcome.blueprint);
          return;
        }
        if (outcome.questions) setServerQuestions(outcome.questions);
        setPlanning({ state: "FAILED", reason: outcome.reason, message: outcome.message, canContinueByRules: outcome.canContinueByRules });
        setBanner(planningBanner(outcome, planMode));
      } catch {
        setPlanning({ state: "IDLE" });
        setErrors([NETWORK_ERROR]);
      }
    });
  }
  function continueFromContext() {
    if (open.length > 0) return;
    if (list && planning.state === "READY" && list.producer === mode && list.baseContentVersion === screen.contentVersion) {
      go("estrategia");
      return;
    }
    runPlan(mode);
  }
  function runBannerAction(action: Banner["actions"][number]) {
    if (action === "rules") runPlan("RULES");
    else if (action === "retry") {
      intent.done();
      runPlan(mode);
    } else {
      setList(null);
      setPlanning({ state: "IDLE" });
      setDraft(null);
      setAccepted(null);
      setBanner(null);
      go("contexto");
      router.refresh();
    }
  }

  // ----- step 2 -----
  function choose(next: StrategyChoice) {
    if (next === choice) return;
    setChoice(next);
    setDraft(null);
    setAccepted(null);
    setDosing(NO_DOSING);
  }
  function continueFromStrategy() {
    if (!list) return;
    if (choice === "NONE") {
      setDraft(null);
      setAccepted(null);
      go("previa");
      return;
    }
    const next = draft && draft.choice === choice ? draft : draftFrom(list, choice, screen.structure);
    if (!next) {
      setErrors(["Esta sugestão não traz a tabela de papéis. Planeje de novo ou continue por regras."]);
      return;
    }
    setErrors([]);
    setDraft(next);
    setPhase(next.workouts[0]?.phaseIndex ?? phase);
    go("focos");
  }

  // ----- step 2b -> 3: the acceptance (append-only, idempotent) -----
  async function accept(current: AcceptanceDraft | null, withDosing: DosingChoice): Promise<{ ok: true; id: string } | { ok: false }> {
    if (!list) return { ok: false };
    const base = { runId: list.runId, baseContentVersion: screen.contentVersion, dosing: withDosing };
    const shape = current ? acceptanceInput(current, { ...base, idempotencyKey: "00000000-0000-0000-0000-000000000000" }) : null;
    const mine = intent.take(`accept:${choice}:${screen.contentVersion}:${list.runId}:${JSON.stringify({ ...shape, idempotencyKey: undefined })}`);
    const payload = current ? acceptanceInput(current, { ...base, idempotencyKey: mine.key }) : plainAcceptanceInput(choice as "S1" | "S2" | "S3", { ...base, idempotencyKey: mine.key });
    const outcome = await acceptStrategy(planId, revisionId, payload);
    intent.done();
    if (outcome.ok) return { ok: true, id: outcome.acceptance.acceptanceId };
    setBanner({ tone: "error", text: outcome.message, detail: null, actions: ACCEPT_REPLAN.has(outcome.reason) ? ["replan"] : [], role: "alert" });
    return { ok: false };
  }
  function continueFromFocus() {
    if (!draft || draftProblems(draft).length > 0) return;
    setErrors([]);
    setBanner(null);
    startTransition(async () => {
      try {
        const done = await accept(draft, dosing);
        if (!done.ok) return;
        setAccepted({ id: done.id, dosing: JSON.stringify(dosing) });
        go("previa");
      } catch {
        setErrors([NETWORK_ERROR]);
      }
    });
  }

  // ----- step 3: generate -----
  function generate() {
    if (step !== "previa" || sub || open.length > 0) return;
    const found = formFieldErrors(form);
    setFieldErrors(found);
    const stale = unsaved.map((r) => policyTitle(r, screen.policy));
    if (stale.length || Object.keys(found).length) {
      setErrors([
        ...(stale.length ? [`Salve ou restaure os ajustes de dose de ${stale.join(", ")} antes de gerar.`] : []),
        ...(Object.keys(found).length ? ["Corrija os campos indicados."] : []),
      ]);
      setPolicyOpen(true);
      const id = Object.keys(found)[0];
      if (id) {
        if (id.startsWith("fig-gen-count")) {
          setRequiredOpen(true);
          go("contexto");
        }
        if (id === MINUTES_FIELD_ID) setAdvancedOpen(true);
        setFocusId(id);
      } else if (unsaved[0]) {
        setTab(policyTabOf(unsaved[0].modality));
        setSelectedKey(unsaved[0].key);
      }
      return;
    }
    const built = answersFromForm(form, screen.policy);
    if (!built.ok) {
      setErrors(built.errors);
      return;
    }
    setErrors([]);
    setBanner(null);
    startTransition(async () => {
      setProgress(`Montando prescrição (${total} ${total === 1 ? "fase" : "fases"})…`);
      try {
        const rulesVersion = form.doseProfiles ? DOSE_PROFILES_RULES_VERSION : undefined;
        let acceptanceId = accepted?.id ?? null;
        // The planner's dose and progression suggestions the professional ticked after the acceptance: a new acceptance (append-only) records them.
        if (choice !== "NONE" && accepted && accepted.dosing !== JSON.stringify(dosing)) {
          const again = await accept(draft, dosing);
          if (!again.ok) {
            setProgress("");
            return;
          }
          acceptanceId = again.id;
          setAccepted({ id: again.id, dosing: JSON.stringify(dosing) });
        }
        const what = `generate:${choice}:${acceptanceId ?? "none"}:${JSON.stringify(built.answers)}${rulesVersion ? `:${rulesVersion}` : ""}`;
        const firstTry = intent.take(what);
        const run = (): Promise<ProposalActionResult> =>
          choice === "NONE" || !acceptanceId
            ? generateProposal(planId, revisionId, { idempotencyKey: firstTry.key, baseContentVersion: screen.contentVersion, answers: built.answers, ...(rulesVersion ? { rulesVersion } : {}) })
            : generateFromStrategy(planId, revisionId, { idempotencyKey: firstTry.key, baseContentVersion: screen.contentVersion, acceptanceId, answers: built.answers, ...(rulesVersion ? { rulesVersion } : {}) }).then(proposalResultOf);
        let result = await run();
        intent.done();
        if (result.data?.questions) setServerQuestions(result.data.questions);
        // A long periodization is generated in parts (technical limit per request): continue until every phase is there.
        while (!result.error && result.data?.complete === false && result.data.proposalId && result.data.version) {
          const done = result.data.progress;
          setProgress(done ? `Montando prescrição… ${done.generated} de ${done.total} fases` : "Montando prescrição…");
          const next = intent.take(`continue:${result.data.proposalId}:${result.data.version}`);
          result = await continueProposal(planId, revisionId, { proposalId: result.data.proposalId, idempotencyKey: next.key, writeId: next.write, expectedVersion: result.data.version });
          intent.done();
        }
        if (result.error) {
          setErrors([result.error]);
          setProgress("");
          if (result.data?.reason === "open_exists" || result.data?.reason === "revision_changed") router.refresh();
          if (result.data?.reason === "blueprint_invalid" || result.data?.reason === "structure_changed") setBanner({ tone: "error", text: result.error, detail: null, actions: ["replan"], role: "alert" });
          return;
        }
        setProgress("Auditoria concluída. Abrindo a proposta…");
        // The proposal page is the same address without the step.
        window.history.replaceState(null, "", "?");
        router.refresh();
      } catch {
        setErrors([NETWORK_ERROR]);
        setProgress("");
      }
    });
  }

  // ----- what each screen says -----
  const heading = headingFor(step, mode);
  const cards = useMemo(() => contextCards(screen.summary, screen.structure, screen.considered), [screen]);
  const strategyList = useMemo(() => (list ? strategyCards(list, screen.structure) : []), [list, screen.structure]);
  const chosen = list?.strategies.find((s) => s.strategyId === choice) ?? null;
  const choiceCard = strategyList.find((c) => c.id === choice) ?? null;
  const running = planning.state === "RUNNING";
  const problems = draft ? draftProblems(draft).length : 0;
  const footerBase = footerFor({
    step, openAnswers: open.length, running: running || (pending && step === "contexto"), mode, choice, choiceName: chosen?.displayName ?? null,
    choiceAcceptable: choiceCard ? !choiceCard.disabled : false, problems, generating: pending && step === "previa", phone,
  });
  // On the first step the footer says exactly what is missing ("4 respostas faltam: 3 estímulos e equipamentos"), each also a link on step 3.
  const footer = step === "contexto" && open.length > 0 && !phone ? { ...footerBase, reason: pendingSummary(pendingItems(open)) } : footerBase;
  const producerLabel = list?.label ?? "";
  const status = pending && progress && step === "previa" ? progress : running ? "Gerando estratégia…" : "";
  const phoneTitle =
    sub === "equipment" ? "Equipamentos" : sub === "policy" ? "Editar dose"
      : step === "contexto" ? "Montar prescrição" : step === "estrategia" ? "Escolher estratégia" : step === "focos" ? "Definir focos" : "Revisar e gerar";
  const phoneSub =
    sub === "equipment" ? "Defina o que está disponível"
      : sub === "policy" ? (selected ? `${policyTitle(selected, screen.policy)} · ${policySubtitle(selected).split(" · ")[0].toLowerCase()}` : "")
        : `${header.studentName}${screen.summary.daysPerWeek ? ` · ${screen.summary.daysPerWeek} sessões/semana` : ""}${screen.summary.sessionMinutes ? ` · ${screen.summary.sessionMinutes} min` : ""}`;
  const phoneBack = sub === "equipment" ? "‹ Voltar às respostas" : sub === "policy" ? "‹ Voltar às políticas" : null;
  const phoneState = step === "contexto" ? pendingPhoneText(open.length) : step === "previa" ? (open.length ? pendingPhoneText(open.length) : "Pronto para gerar") : "Estratégia em revisão · aceite pendente";

  function primary() {
    if (sub === "equipment") closeSub();
    else if (sub === "policy") savePolicy();
    else if (step === "contexto") continueFromContext();
    else if (step === "estrategia") continueFromStrategy();
    else if (step === "focos") continueFromFocus();
    else generate();
  }
  const submitStep = step === "previa" && !sub;
  const phaseNumbers = [...new Set((draft?.workouts ?? []).map((w) => w.phaseIndex))].sort((a, b) => a - b);
  const previewPhases = phaseNumbers.length ? phaseNumbers : screen.structure.map((p) => p.index);
  const previewPhase = previewPhases.includes(phase) ? phase : previewPhases[0];

  return (
    <form
      className="fig-gen"
      data-step={step}
      data-sub={sub ?? undefined}
      aria-labelledby="fig-gen-title"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        primary();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        if (sub && phone) {
          event.preventDefault();
          closeSub();
        } else if (editing && phone) {
          event.preventDefault();
          setEditing(null);
        }
      }}
    >
      <header className="fig-gen-dhead fig-gen-d">
        <div>
          <p className="fig-gen-crumb">{crumbText(header.studentName, screen.summary.goal, heading.crumbTail)}</p>
          <h1 id="fig-gen-title">{heading.title}</h1>
          <p className="fig-gen-sub">{heading.sub}</p>
        </div>
        <Link href={header.backHref} className="fig-gen-btn">
          Voltar ao plano
        </Link>
      </header>
      <header className="fig-gen-mhead fig-gen-m">
        {phoneBack ? (
          <button type="button" className="fig-gen-backlink" onClick={closeSub}>
            {phoneBack}
          </button>
        ) : (
          <Link href={header.backHref} className="fig-gen-backlink">
            ‹ Voltar ao plano
          </Link>
        )}
        <h1 ref={phoneHead} tabIndex={-1}>
          {phoneTitle}
        </h1>
        <p className="fig-gen-sub">{phoneSub}</p>
      </header>

      {screen.lastAnswers && step === "contexto" && (
        <Notice>
          <span>
            Há respostas da geração anterior em {shortDate(screen.lastAnswers.createdAt.slice(0, 10))}.{" "}
            <button type="button" className="link-button" onClick={() => setForm((f) => ({ ...formFromAnswers(screen.lastAnswers?.answers, screen.structure, screen.policy), doseProfiles: f.doseProfiles }))}>
              Usar as respostas da geração anterior
            </button>
          </span>
        </Notice>
      )}

      <div className="fig-gen-d">
        <BaseStrip summary={screen.summary} />
      </div>
      <section className="fig-gen-state fig-gen-m" aria-label="Estado da geração">
        <strong>
          {screen.summary.phases} {screen.summary.phases === 1 ? "fase" : "fases"} · {screen.summary.weeks} {screen.summary.weeks === 1 ? "semana" : "semanas"}
        </strong>
        <span className={open.length || step !== "previa" ? "warn" : ""}>{phoneState}</span>
      </section>

      <nav className="fig-gen-steps" aria-label="Etapas da montagem">
        <ol aria-label="Etapas da montagem">
          {STEP_PILLS.map((s, index) => {
            const reachable = index === 0 || (index === 1 && Boolean(list)) || (index === 2 && readyToPreview);
            return (
              <li key={s.id}>
                <button
                  type="button"
                  aria-current={stepperIndex === index ? "step" : undefined}
                  data-current={stepperIndex === index ? "true" : undefined}
                  disabled={!reachable && stepperIndex !== index}
                  onClick={() => go(index === 0 ? "contexto" : index === 1 ? (draft && step === "previa" ? "focos" : "estrategia") : "previa")}
                >
                  {index + 1}{"  "}
                  <span className="fig-gen-d">{s.long}</span>
                  <span className="fig-gen-m">{s.short}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {banner && (
        <div className={`fig-gen-notice ${banner.tone}`} role={banner.role} aria-live={banner.role === "status" ? "polite" : undefined}>
          <p>
            {banner.text}
            {banner.detail ? <span className="fig-gen-hint"> ({banner.detail})</span> : null}
          </p>
          {banner.actions.length > 0 && (
            <div className="fig-gen-notice-actions">
              {banner.actions.includes("retry") && (
                <button type="button" className="fig-gen-btn small" disabled={pending} onClick={() => runBannerAction("retry")}>
                  Tentar de novo
                </button>
              )}
              {banner.actions.includes("rules") && (
                <button type="button" className="fig-gen-btn small primary" disabled={pending} onClick={() => runBannerAction("rules")}>
                  Continuar por regras
                </button>
              )}
              {banner.actions.includes("replan") && (
                <button type="button" className="fig-gen-btn small primary" disabled={pending} onClick={() => runBannerAction("replan")}>
                  Planejar de novo
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <div className="fig-gen-body">
        {step === "contexto" && (
          <div className="fig-gen-ctx">
            <div className="fig-gen-cols">
              <section className="fig-gen-card fig-gen-ctx-cards" aria-labelledby="fig-gen-ctx-title">
                <h2 id="fig-gen-ctx-title" className="fig-gen-card-title">
                  Dados que vão orientar a prescrição
                </h2>
                <p className="fig-gen-sub">Fontes já disponíveis: ficha, avaliação, periodização e execução.</p>
                {cards.map((c) => (
                  <div key={c.id} className="fig-gen-info" role="group" aria-label={c.title}>
                    <h3>{c.title}</h3>
                    <p>{c.line}</p>
                    <p className="fig-gen-info-meta">{c.meta}</p>
                  </div>
                ))}
                <StudentOrigin considered={screen.considered} freeText={screen.freeText} assumptions={screen.assumptions} />
              </section>
              <ModePicker panel={panel} mode={mode} onChange={setMode} />
            </div>
          </div>
        )}
        <details
          className="fig-gen-card fig-gen-adv-card fig-gen-required"
          hidden={step !== "contexto"}
          open={requiredOpen || sub === "equipment"}
          onToggle={(e) => setRequiredOpen(e.currentTarget.open)}
        >
          <summary>
            Respostas necessárias{" "}
            <span className={open.length ? "warn" : ""}>{open.length ? `(${open.length} pendentes)` : "(completas)"}</span>
          </summary>
          <Diretrizes
            screen={screen}
            form={form}
            setForm={setForm}
            questions={questions}
            phone={phone}
            expanded={expanded}
            setExpanded={setExpanded}
            fieldErrors={fieldErrors}
            clearError={clearError}
            onOpenEquipment={openEquipment}
            onSeePolicies={() => {
              setPolicyOpen(true);
              if (list) go("previa");
            }}
            student={null}
          />
        </details>

        {step === "estrategia" && list && (
          <StrategyList list={list} cards={strategyList} choice={choice} onChoose={choose} screen={screen} periodizationHref={header.periodizationHref} />
        )}

        {step === "focos" && draft && (
          <PhaseFocus
            draft={draft}
            onChange={setDraft}
            structure={screen.structure}
            phase={phase}
            onPhase={setPhase}
            editing={editing}
            onEdit={setEditing}
            producerLabel={producerLabel}
            periodizationHref={header.periodizationHref}
            aiMode={list?.producer === "AI"}
          />
        )}

        {step === "previa" && list && (
          <BlueprintPreview
            title={`Semana-tipo • ${draft && choice !== "NONE" ? draft.displayName : "Sem divisão (geração atual)"}`}
            subtitle={
              draft && choice !== "NONE"
                ? `Fase ${previewPhase} ilustrativa · divisão a confirmar · sessões ${screen.structure.find((p) => p.index === previewPhase)?.weekSlots.map((s) => s.label).join("") ?? ""}`
                : "Sem blueprint: o gerador atual escolhe os exercícios como antes."
            }
            phases={draft && choice !== "NONE" ? previewPhases : []}
            phase={previewPhase}
            onPhase={setPhase}
            cards={draft && choice !== "NONE" ? weekPreview(draft, screen.structure, previewPhase) : []}
            open={policyOpen}
            onOpen={setPolicyOpen}
            before={beforeGenerating(screen.summary, equipmentSummary(form.equipment))}
            suggestions={suggestedIntents(list, choice)}
            dosing={dosing}
            onDosing={setDosing}
            strategyLabel={choice === "NONE" ? "Nada será acrescentado ao gerador atual." : producerLabel}
          >
            <div className="fig-gen-step">
              <Politicas
                screen={screen}
                form={form}
                tab={tab}
                setTab={setTab}
                selectedKey={selectedKey}
                drafts={drafts}
                setDrafts={setDrafts}
                errors={draftErrors}
                setErrors={setDraftErrors}
                status={policyStatus}
                onEdit={editPolicy}
                onSave={savePolicy}
                onRestore={restorePolicy}
              />
            </div>
            <div className="fig-gen-step">
              <Progressao
                screen={screen}
                form={form}
                setForm={setForm}
                setField={setField}
                open={open}
                info={info}
                pending={pending}
                fieldErrors={fieldErrors}
                clearError={clearError}
                advancedOpen={advancedOpen}
                setAdvancedOpen={setAdvancedOpen}
                onGoTo={goTo}
              />
            </div>
          </BlueprintPreview>
        )}
      </div>

      {errors.length > 0 && (
        <div className="fig-gen-errors" role="alert">
          {errors.map((e) => (
            <p key={e}>{e}</p>
          ))}
        </div>
      )}

      <div className="fig-gen-bar fig-gen-d">
        <div>
          <p className="fig-gen-bar-title">{footer.guide}</p>
          <p className="fig-gen-bar-sub" role="status" aria-live="polite">
            {status ? (
              <>
                <span className="spinner" aria-hidden="true" /> {status}
              </>
            ) : footer.reason ? (
              footer.reason
            ) : (
              NEVER_APPROVES
            )}
          </p>
        </div>
        <button key="primary-d" type={submitStep ? "submit" : "button"} className={`fig-gen-btn wide${footer.disabled ? "" : " primary"}`} disabled={pending || footer.disabled} onClick={submitStep ? undefined : primary}>
          {footer.primary}
        </button>
      </div>
      <div className="fig-gen-bar fig-gen-m">
        <p className="fig-gen-bar-hint" role="status" aria-live="polite">
          {status || (sub === "equipment" ? (hasEquipment ? "Equipamentos prontos para salvar." : "Selecione ao menos uma opção para continuar.") : sub === "policy" ? "Alterações ficam na revisão da geração." : footerBase.reason || footer.guide)}
        </p>
        <button
          key="primary-m"
          type={submitStep ? "submit" : "button"}
          className={`fig-gen-btn wide${(sub === "equipment" ? !hasEquipment : footer.disabled) ? "" : " primary"}`}
          disabled={pending || (sub === "equipment" ? !hasEquipment : sub === "policy" ? false : footer.disabled)}
          onClick={submitStep ? undefined : primary}
        >
          {sub === "equipment" ? "Salvar equipamentos" : sub === "policy" ? "Salvar política" : footer.primary}
        </button>
      </div>
    </form>
  );
}
