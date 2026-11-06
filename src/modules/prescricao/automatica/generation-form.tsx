"use client";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Notice } from "@/components/ui";
import { continueProposal, generateProposal } from "./actions";
import type { GenerationQuestion } from "./contracts";
import { StudentCard, BaseStrip } from "./context-summary";
import { Diretrizes } from "./generation-diretrizes";
import { Politicas } from "./generation-politicas";
import { Progressao } from "./generation-progressao";
import {
  commitDraft,
  draftDirty,
  draftFor,
  equipmentSelection,
  formFieldErrors,
  pendingCountText,
  pendingItems,
  pendingPhoneText,
  pendingSummary,
  pendingSummaryShort,
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
import type { GenerationScreen } from "./service";
import { NETWORK_ERROR, useIntent } from "./use-intent";
import { usePhone } from "./use-phone";
import { DOSE_PROFILES_RULES_VERSION, EMPTY_FORM, answersFromForm, formFromAnswers, openRequired, shortDate, type GenerationForm as FormState } from "./view";

/**
 * "Gerar prescrição automática" (design §6.1 `generation-form`, UI items 1 and 2), as the Figma GEN-01..08 draw it: three steps
 * (Diretrizes, Políticas de dose, Progressão) with the stepper and a persistent footer, and on the phone two own screens (the
 * equipment list and the editor of one policy) that are states of this component: nothing leaves the page and no choice is lost.
 *
 * One form state and one submit. The required questions come first (stimulus of each phase, equipment, counts the structure leaves
 * open): nothing is pre-selected and "Gerar prescrição" waits for them. The dose policy is the rule set's, shown as it is and editable
 * (Q1); an untouched policy sends nothing, so the engine version's own values apply. Progression and deload are optional. While the
 * engine runs, the indicator says how many phases are done; a long periodization is generated in parts, one request after the other.
 */
type Step = 0 | 1 | 2;
type Sub = null | "equipment" | "policy";
const STEPS = [
  { long: "Diretrizes", short: "Diretrizes" },
  { long: "Políticas de dose", short: "Doses" },
  { long: "Progressão", short: "Progressão" },
] as const;
const omit = <T,>(record: Record<string, T>, key: string): Record<string, T> => Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));
const NEVER_APPROVES = "A geração não aprova, não aplica e não entrega o plano ao aluno.";

export interface GenerationHeader {
  studentName: string;
  planTitle: string;
  revisionNumber: number;
  /** The revision page ("Voltar ao plano"). */
  backHref: string;
}

export function GenerationForm({ planId, revisionId, screen, header }: { planId: string; revisionId: string; screen: GenerationScreen; header: GenerationHeader }) {
  const router = useRouter();
  const intent = useIntent();
  const phone = usePhone();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<string[]>([]);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [serverQuestions, setServerQuestions] = useState<GenerationQuestion[]>([]);
  const [progress, setProgress] = useState<string>("");
  // Every step stays mounted (hidden): going back and forth keeps every choice, typed or not.
  const [step, setStep] = useState<Step>(0);
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
  const setFocusId = (id: string) => setFocus({ id });
  const trigger = useRef<HTMLElement | null>(null);
  const phoneHead = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);

  const questions = useMemo(
    () => [...screen.questions, ...serverQuestions.filter((q) => !screen.questions.some((s) => s.code === q.code && s.phaseIndex === q.phaseIndex && s.label === q.label))],
    [screen.questions, serverQuestions],
  );
  const open = openRequired(questions, form);
  const info = questions.filter((q) => !q.required);
  const items = pendingItems(open);
  const total = screen.structure.length;
  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));
  const clearError = (id: string) => setFieldErrors((e) => (id in e ? omit(e, id) : e));
  const selected = screen.policy.find((r) => r.key === selectedKey);
  const hasEquipment = equipmentSelection(form.equipment).none || equipmentSelection(form.equipment).codes.length > 0;
  const unsaved = screen.policy.filter((r) => draftDirty(r, form.policy, drafts[r.key]));

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

  function goStep(next: Step) {
    setSub(null);
    setStep(next);
  }
  function closeSub() {
    setSub(null);
    // The control that opened the screen gets the focus back (after the layout is the page's again).
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
    setStep(0);
    setSub(item.code === "EQUIPMENT" && phone ? "equipment" : null);
    setFocusId(item.fieldId);
  }
  function savePolicy() {
    if (!selected) return;
    const draft = drafts[selected.key] ?? draftFor(selected, form.policy);
    const bad = validateDraft(selected, draft);
    if (Object.keys(bad).length) {
      setDraftErrors((e) => ({ ...e, [selected.key]: bad }));
      setPolicyStatus("");
      const firstBad = selected.defaults.find((d) => bad[d.param]);
      if (firstBad) setFocusId(policyFieldId(firstBad.param));
      return;
    }
    setForm((f) => ({ ...f, policy: commitDraft(selected, f.policy, draft) }));
    setDrafts((d) => omit(d, selected.key));
    setDraftErrors((d) => omit(d, selected.key));
    setPolicyStatus("Ajustes salvos nesta geração. Ficam registrados como decisão sua.");
    if (phone) closeSub();
  }
  function restorePolicy() {
    if (!selected) return;
    setForm((f) => ({ ...f, policy: restoreRow(selected, f.policy) }));
    setDrafts((d) => omit(d, selected.key));
    setDraftErrors((d) => omit(d, selected.key));
    setPolicyStatus("Valores padrão da versão do motor restaurados.");
  }

  function submit() {
    if (step !== 2 || sub || open.length > 0) return;
    const found = formFieldErrors(form);
    setFieldErrors(found);
    const stale = unsaved.map((r) => policyTitle(r, screen.policy));
    if (stale.length || Object.keys(found).length) {
      setErrors([
        ...(stale.length ? [`Salve ou restaure os ajustes de dose de ${stale.join(", ")} antes de gerar.`] : []),
        ...(Object.keys(found).length ? ["Corrija os campos indicados."] : []),
      ]);
      const id = Object.keys(found)[0];
      if (id) {
        if (id.startsWith("fig-gen-count")) setStep(0);
        if (id === MINUTES_FIELD_ID) setAdvancedOpen(true);
        setFocusId(id);
      } else if (unsaved[0]) {
        setStep(1);
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
    startTransition(async () => {
      setProgress(`Gerando a proposta (${total} ${total === 1 ? "fase" : "fases"})…`);
      try {
        const rulesVersion = form.doseProfiles ? DOSE_PROFILES_RULES_VERSION : undefined;
        const firstTry = intent.take(`generate:${JSON.stringify(built.answers)}${rulesVersion ? `:${rulesVersion}` : ""}`);
        let result = await generateProposal(planId, revisionId, {
          idempotencyKey: firstTry.key, baseContentVersion: screen.contentVersion, answers: built.answers, ...(rulesVersion ? { rulesVersion } : {}),
        });
        intent.done();
        if (result.data?.questions) setServerQuestions(result.data.questions);
        // A long periodization is generated in parts (technical limit per request): continue until every phase is there.
        while (!result.error && result.data?.complete === false && result.data.proposalId && result.data.version) {
          const done = result.data.progress;
          setProgress(done ? `Geradas ${done.generated} de ${done.total} fases. Gerando as próximas…` : "Gerando as próximas fases…");
          const next = intent.take(`continue:${result.data.proposalId}:${result.data.version}`);
          result = await continueProposal(planId, revisionId, {
            proposalId: result.data.proposalId,
            idempotencyKey: next.key,
            writeId: next.write,
            expectedVersion: result.data.version,
          });
          intent.done();
        }
        if (result.error) {
          setErrors([result.error]);
          setProgress("");
          if (result.data?.reason === "open_exists" || result.data?.reason === "revision_changed") router.refresh();
          return;
        }
        setProgress("Proposta pronta. Abrindo…");
        router.refresh();
      } catch {
        setErrors([NETWORK_ERROR]);
        setProgress("");
      }
    });
  }

  // ----- what the phone's header says on each screen -----
  const phoneTitle = sub === "equipment" ? "Equipamentos" : sub === "policy" ? "Editar dose" : step === 0 ? "Gerar prescrição" : step === 1 ? "Políticas de dose" : "Progressão semanal";
  const phoneSub =
    sub === "equipment"
      ? "Defina o que está disponível"
      : sub === "policy"
        ? selected
          ? `${policyTitle(selected, screen.policy)} · ${policySubtitle(selected).split(" · ")[0].toLowerCase()}`
          : ""
        : step === 0
          ? `${header.studentName} · definir escolhas`
          : step === 1
            ? "Valores padrão editáveis por modalidade"
            : "Opcional por fase · revisar pendências";
  const phoneBack = sub === "equipment" ? "‹ Voltar às diretrizes" : sub === "policy" ? "‹ Voltar às políticas" : null;

  // ----- the persistent footer -----
  const desktop =
    step === 0
      ? { title: open.length ? pendingSummary(items) : "Diretrizes completas", action: "Continuar para doses", disabled: open.length > 0, primary: !open.length }
      : step === 1
        ? { title: "As políticas padrão permanecem disponíveis sem edição", action: "Continuar para progressão", disabled: false, primary: true }
        : { title: open.length ? `${open.length} ${open.length === 1 ? "resposta obrigatória" : "respostas obrigatórias"} antes de gerar` : "Pronto para gerar", action: "Gerar prescrição", disabled: open.length > 0, primary: !open.length };
  const mobile =
    sub === "equipment"
      ? { hint: hasEquipment ? "Equipamentos prontos para salvar." : "Selecione ao menos uma opção para continuar.", action: "Salvar equipamentos", disabled: !hasEquipment, primary: hasEquipment, kind: "close" as const }
      : sub === "policy"
        ? { hint: "Alterações ficam na revisão da geração.", action: "Salvar política", disabled: false, primary: true, kind: "save" as const }
        : step === 0
          ? { hint: open.length ? pendingSummaryShort(items, total) : "Diretrizes completas.", action: "Continuar", disabled: open.length > 0, primary: !open.length, kind: "next" as const }
          : step === 1
            ? { hint: "Usar padrões ou editar apenas o necessário.", action: "Continuar para progressão", disabled: false, primary: true, kind: "next" as const }
            : { hint: open.length ? "A geração ainda não está habilitada." : NEVER_APPROVES, action: "Gerar prescrição", disabled: open.length > 0, primary: !open.length, kind: "generate" as const };
  const generating = pending;
  const status = generating && progress ? progress : "";

  function runMobile() {
    if (mobile.kind === "close") closeSub();
    else if (mobile.kind === "save") savePolicy();
    else if (mobile.kind === "next") goStep((step + 1) as Step);
  }

  return (
    <form
      className="fig-gen"
      data-step={step}
      data-sub={sub ?? ""}
      aria-labelledby="fig-gen-title"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && sub && phone) {
          event.preventDefault();
          closeSub();
        }
      }}
    >
      <header className="fig-gen-dhead fig-gen-d">
        <div>
          <p className="fig-gen-crumb">
            {header.studentName} <span aria-hidden="true">/</span> {header.planTitle} · Revisão {header.revisionNumber} em rascunho
          </p>
          <h1 id="fig-gen-title">Gerar prescrição automática</h1>
          <p className="fig-gen-sub">Defina as escolhas essenciais; o restante pode usar as políticas da ferramenta.</p>
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

      {screen.lastAnswers && (
        <Notice>
          <span>
            Há respostas da geração anterior em {shortDate(screen.lastAnswers.createdAt.slice(0, 10))}.{" "}
            <button type="button" className="link-button" onClick={() => setForm(formFromAnswers(screen.lastAnswers?.answers, screen.structure, screen.policy))}>
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
        <span className={open.length ? "warn" : ""}>{pendingPhoneText(open.length)}</span>
      </section>

      <nav className="fig-gen-steps" aria-label="Etapas da geração">
        <ol>
          {STEPS.map((s, index) => (
            <li key={s.long}>
              <button type="button" aria-current={step === index ? "step" : undefined} data-current={step === index ? "true" : undefined} onClick={() => goStep(index as Step)}>
                {index + 1}{"  "}<span className="fig-gen-d">{s.long}</span>
                <span className="fig-gen-m">{s.short}</span>
              </button>
            </li>
          ))}
        </ol>
        <p className={`fig-gen-pending-count fig-gen-d${open.length ? " warn" : ""}`}>{pendingCountText(open.length)}</p>
      </nav>

      <div className="fig-gen-body">
      <div className="fig-gen-step" hidden={step !== 0}>
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
          onSeePolicies={() => goStep(1)}
          student={<StudentCard summary={screen.summary} considered={screen.considered} freeText={screen.freeText} assumptions={screen.assumptions} />}
        />
      </div>
      <div className="fig-gen-step" hidden={step !== 1}>
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
      <div className="fig-gen-step" hidden={step !== 2}>
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
          <p className="fig-gen-bar-title">{desktop.title}</p>
          <p className="fig-gen-bar-sub" role="status" aria-live="polite">
            {status ? <><span className="spinner" aria-hidden="true" /> {status}</> : NEVER_APPROVES}
          </p>
        </div>
        {step === 2 ? (
          <button key="generate-d" type="submit" className={`fig-gen-btn wide${desktop.primary ? " primary" : ""}`} disabled={pending || desktop.disabled}>
            {pending ? "Gerando…" : desktop.action}
          </button>
        ) : (
          <button key="next-d" type="button" className={`fig-gen-btn wide${desktop.primary ? " primary" : ""}`} disabled={desktop.disabled} onClick={() => goStep((step + 1) as Step)}>
            {desktop.action}
          </button>
        )}
      </div>
      <div className="fig-gen-bar fig-gen-m">
        <p className="fig-gen-bar-hint" role="status" aria-live="polite">
          {status || mobile.hint}
        </p>
        {mobile.kind === "generate" ? (
          <button key="generate-m" type="submit" className={`fig-gen-btn wide${mobile.primary ? " primary" : ""}`} disabled={pending || mobile.disabled}>
            {pending ? "Gerando…" : mobile.action}
          </button>
        ) : (
          <button key="next-m" type="button" className={`fig-gen-btn wide${mobile.primary ? " primary" : ""}`} disabled={mobile.disabled} onClick={runMobile}>
            {mobile.action}
          </button>
        )}
      </div>
    </form>
  );
}
