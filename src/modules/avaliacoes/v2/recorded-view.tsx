import Link from "next/link";
import { Notice, formatDateTime } from "@/components/ui";
import type { AssessmentDetail } from "@/db/assessments";
import { formatCalendarDate } from "@/modules/training/format";
import {
  ACTIVITY_CURRENT,
  ACTIVITY_PAST,
  ANAMNESIS,
  ANAMNESIS_ANSWERS,
  BONE_BREADTHS,
  BONE_BREADTH_CODES,
  GOALS,
  GOALS_NOTES_LABEL,
  PARQ,
  PARQ_ANSWERS,
  PARQ_DECISIONS,
  PARQ_INSTRUMENT_LABEL,
  PERIMETERS_SIDED,
  PERIMETERS_SINGLE,
  PERIMETER_SIDED_CODES,
  PERIMETER_SINGLE_CODES,
  HEATH_CARTER_CODES,
  HEATH_CARTER_MEASURES,
  POSTURE_VIEWS,
  POSTURE_VIEW_CODES,
  postureRegionKey,
} from "../catalog";
import { SKINFOLD_SITE_CODES, selectedValue } from "../formulas";
import { ScreeningPill } from "../screening-pill";
import { AGGREGATION_LABEL, CONVERSION_LABEL, EQUATION_LABEL, PROTOCOL_CHIP, SITE_LABEL, requiredSites, type CompositionPayload } from "./composition";
import { ANAMNESIS_CODES, PARQ_CODES, parqAnswer, type ProfilePayload, type ScreeningPayload } from "./screening";
import { ResultsList } from "./results-list";
import { HEATH_CARTER_NOTE, findingsText, postureEmpty, regionsOf, somatotypeText, type PosturePayload } from "./posture";
import { AmendForm } from "./amend-form";

const decimal = (value: number, digits = 2) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: digits }).format(value);
const measured = (value: number | null, unit: string, digits = 2) => (value === null ? "Sem aferição" : `${decimal(value, digits)} ${unit}`);
const yesNo = (value: "yes" | "no" | null) => (value === "yes" ? "Sim" : value === "no" ? "Não" : "Sem resposta");
/** "Pergunta?" stays as it is before its answer; any other label takes a colon. */
const withColon = (label: string) => (/[?:]$/.test(label.trim()) ? label : `${label}:`);
const orDash = (text: string) => (text.trim() === "" ? "—" : text);

/**
 * A recorded Avaliação Física, exactly as it was finalized (read-only: the triggers freeze it): the triagem with the PAR-Q and the professional's
 * decision (who and when), the raw measures, the results with method, formula version and flags, and the modules not done as "Não realizado".
 * An amendment says what it amends and why; an amended one says by what, and stays as it was.
 */
export function RecordedAssessmentView({
  detail,
  profile,
  screening,
  composition,
  posture = null,
  decidedBy,
  amendedAt = null,
  canAmend,
}: {
  detail: AssessmentDetail;
  profile: ProfilePayload | null;
  screening: ScreeningPayload | null;
  composition: CompositionPayload | null;
  /** The "Movimento" step (module "posture"), or null when it was never saved. */
  posture?: PosturePayload | null;
  /** The name of who recorded the PAR-Q decision, when there is one. */
  decidedBy: string | null;
  /** When the amendment that corrects this one was recorded (only for an amended one). */
  amendedAt?: string | null;
  /** No open draft for the student and no recorded amendment of this one. */
  canAmend: boolean;
}) {
  const base = `/profissional/alunos/${detail.studentId}/avaliacoes`;
  const review = screening?.parq.professionalReview;
  const anamnesis = screening ? ANAMNESIS_CODES.filter((code) => screening.anamnesis[code]) : [];
  return (
    <div className="av2-cards">
      <section className="panel av2-card" aria-labelledby="av2-registro">
        <h3 id="av2-registro">Registro</h3>
        <p>
          <ScreeningPill risk={detail.riskStatus} reviewed={detail.reviewed} parq />{" "}
          <span className="small muted">
            Registrada em {detail.recordedAt ? formatDateTime(detail.recordedAt) : "—"}
            {detail.recordedByName ? ` por ${detail.recordedByName}` : ""}. Não muda mais.
          </span>
        </p>
        {detail.amendsAssessmentId && (
          <p>
            Retifica a{" "}
            <Link className="account-link" href={`${base}/${detail.amendsAssessmentId}`}>
              avaliação de {formatCalendarDate(detail.assessedOn)}
            </Link>
            . Motivo: {detail.amendReason}
          </p>
        )}
        {detail.amendedById && (
          <Notice tone="warning">
            <p>
              <strong>Retificada</strong> por{" "}
              <Link className="account-link" href={`${base}/${detail.amendedById}`}>
                {amendedAt ? `retificação registrada em ${formatDateTime(amendedAt)}` : "uma retificação registrada depois"}
              </Link>
              . Os dados abaixo são os originais, como foram registrados.
            </p>
          </Notice>
        )}
      </section>

      <section className="panel av2-card" aria-labelledby="av2-r-triagem">
        <h3 id="av2-r-triagem">Triagem</h3>
        <dl className="av2-facts">
          <div>
            <dt>Objetivos</dt>
            <dd>{profile && profile.goals.length > 0 ? profile.goals.map((code) => GOALS[code]).join(", ") : "Nenhum selecionado"}</dd>
          </div>
          <div>
            <dt>{GOALS_NOTES_LABEL}</dt>
            <dd>{orDash(profile?.goalNotes ?? "")}</dd>
          </div>
        </dl>
        <h4 className="av2-subtitle">Anamnese clínica</h4>
        {anamnesis.length === 0 ? (
          <p className="muted">Nenhuma pergunta respondida.</p>
        ) : (
          <ul className="av2-answer-list" aria-label="Respostas da anamnese">
            {ANAMNESIS_CODES.map((code) => {
              const entry = screening?.anamnesis[code];
              return (
                <li key={code}>
                  {withColon(ANAMNESIS[code])} <strong>{entry?.answer ? ANAMNESIS_ANSWERS[entry.answer] : "Sem resposta"}</strong>
                  {entry?.details ? <span className="small muted"> — {entry.details}</span> : null}
                </li>
              );
            })}
          </ul>
        )}
        {screening && (
          <>
            <h4 className="av2-subtitle">Atividade física</h4>
            <dl className="av2-facts">
              <div>
                <dt>Atual: {ACTIVITY_CURRENT.practices.toLowerCase()}</dt>
                <dd>{yesNo(screening.activity.current.practices)}</dd>
              </div>
              <div>
                <dt>Atual: {ACTIVITY_CURRENT.activities.toLowerCase()}</dt>
                <dd>
                  {orDash(screening.activity.current.activities)}
                  {screening.activity.current.frequency ? ` · ${decimal(screening.activity.current.frequency.value)} por semana` : ""}
                </dd>
              </div>
              <div>
                <dt>Passada: {ACTIVITY_PAST.practiced.toLowerCase()}</dt>
                <dd>{yesNo(screening.activity.past.practiced)}</dd>
              </div>
              <div>
                <dt>Passada: {ACTIVITY_PAST.activities.toLowerCase()}</dt>
                <dd>{orDash(screening.activity.past.activities)}</dd>
              </div>
            </dl>
            <h4 className="av2-subtitle">
              PAR-Q <span className="small muted">({PARQ_INSTRUMENT_LABEL})</span>
            </h4>
            <ul className="av2-answer-list" aria-label="Respostas do PAR-Q">
              {PARQ_CODES.map((code) => (
                <li key={code}>
                  {withColon(PARQ[code])} <strong>{PARQ_ANSWERS[parqAnswer(screening, code)]}</strong>
                </li>
              ))}
            </ul>
            {review?.decision ? (
              <div className="av2-decision-record" role="group" aria-label="Decisão profissional">
                <p>
                  <strong>Decisão profissional:</strong> {PARQ_DECISIONS[review.decision]}
                </p>
                <p>{review.notes}</p>
                <p className="small muted">
                  Registrada {decidedBy ? `por ${decidedBy} ` : ""}
                  {review.reviewedAt ? `em ${formatDateTime(review.reviewedAt)}` : ""}. A decisão é do profissional; o sistema não declara aptidão.
                </p>
              </div>
            ) : (
              <p className="muted small">Sem resposta “Sim” no PAR-Q: nenhuma decisão foi pedida. Isto não é liberação clínica.</p>
            )}
          </>
        )}
      </section>

      <section className="panel av2-card" aria-labelledby="av2-r-medidas">
        <h3 id="av2-r-medidas">Medidas</h3>
        {composition ? (
          <>
            <dl className="av2-facts">
              <div>
                <dt>Peso</dt>
                <dd>{measured(composition.weightKg, "kg")}</dd>
              </div>
              <div>
                <dt>Altura</dt>
                <dd>{composition.heightCm === null ? "Sem aferição" : `${decimal(composition.heightCm / 100, 3)} m`}</dd>
              </div>
              <div>
                <dt>PAS / PAD</dt>
                <dd>
                  {measured(composition.systolicMmHg, "mmHg", 0)} / {measured(composition.diastolicMmHg, "mmHg", 0)}
                </dd>
              </div>
              <div>
                <dt>FC repouso</dt>
                <dd>{measured(composition.restingHeartRateBpm, "bpm", 0)}</dd>
              </div>
              <div>
                <dt>Protocolo de dobras</dt>
                <dd>{composition.protocol ? PROTOCOL_CHIP[composition.protocol] : "Não escolhido"}</dd>
              </div>
              <div>
                <dt>Referência da equação</dt>
                <dd>{EQUATION_LABEL[composition.equation]}</dd>
              </div>
              <div>
                <dt>Leituras por dobra</dt>
                <dd>{AGGREGATION_LABEL[composition.aggregation]}</dd>
              </div>
              <div>
                <dt>Conversão</dt>
                <dd>{CONVERSION_LABEL[composition.conversion]}</dd>
              </div>
            </dl>
            {SKINFOLD_SITE_CODES.some((site) => (composition.skinfolds[site] ?? []).length > 0) ? (
              <div className="table-wrap">
                <table className="data-table stack">
                  <caption className="sr-only">Dobras cutâneas registradas</caption>
                  <thead>
                    <tr>
                      <th scope="col">Dobra</th>
                      <th scope="col">Leituras</th>
                      <th scope="col">Valor usado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {SKINFOLD_SITE_CODES.filter((site) => (composition.skinfolds[site] ?? []).length > 0).map((site) => {
                      const readings = composition.skinfolds[site] ?? [];
                      const value = selectedValue(readings, composition.aggregation);
                      const inProtocol = requiredSites(composition.protocol, composition.equation).includes(site);
                      return (
                        <tr key={site}>
                          <th scope="row" data-label="Dobra">
                            {SITE_LABEL[site]}
                            {!inProtocol && <span className="small muted"> (fora do protocolo)</span>}
                          </th>
                          <td data-label="Leituras">{readings.map((reading) => `${decimal(reading)} mm`).join(" · ")}</td>
                          <td data-label="Valor usado">{value === null ? "—" : `${decimal(value)} mm`}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted">Nenhuma dobra medida.</p>
            )}
            <RecordedPerimeters composition={composition} />
          </>
        ) : (
          <p className="muted">Não realizado.</p>
        )}
      </section>

      <section className="panel av2-card" aria-labelledby="av2-r-resultados">
        <h3 id="av2-r-resultados">Resultados</h3>
        <p className="muted small">Calculados ao finalizar, com o método e a versão da fórmula, sem classificação. Só os marcados como estimativa vêm da equação de um estudo.</p>
        {detail.results.length > 0 ? <ResultsList results={detail.results} labelledBy="av2-r-resultados" /> : <p>Nenhum resultado foi calculado.</p>}
      </section>

      <section className="panel av2-card" aria-labelledby="av2-r-movimento">
        <h3 id="av2-r-movimento">Postura e movimento</h3>
        {posture && !postureEmpty(posture) ? <RecordedPosture posture={posture} /> : <p className="muted">Não realizado.</p>}
      </section>

      {canAmend && (
        <section className="panel av2-card" aria-labelledby="av2-r-retificar">
          <h3 id="av2-r-retificar">Retificar</h3>
          <p className="muted small">
            Uma correção vira uma nova avaliação que aponta para esta, com o motivo escrito. Esta continua registrada como está.
          </p>
          <AmendForm studentId={detail.studentId} assessmentId={detail.id} />
        </section>
      )}
      {!canAmend && !detail.amendedById && (
        <p className="small muted">
          Para retificar esta avaliação, conclua ou descarte primeiro o rascunho aberto deste aluno.
        </p>
      )}
    </div>
  );
}

/**
 * The perimeters and bone breadths as recorded: only what was measured (a side not measured says so), in cm. The waist-hip ratio and the
 * bilateral differences are in "Resultados", with their method and formula version.
 */
function RecordedPerimeters({ composition }: { composition: CompositionPayload }) {
  const single = PERIMETER_SINGLE_CODES.filter((code) => composition.perimetersCm[code] !== undefined);
  const sided = PERIMETER_SIDED_CODES.filter((code) => composition.sidedPerimetersCm[code] !== undefined);
  const breadths = BONE_BREADTH_CODES.filter((code) => composition.boneBreadthsCm[code] !== undefined);
  return (
    <>
      <h4 className="av2-subtitle">Perímetros</h4>
      {single.length + sided.length === 0 ? (
        <p className="muted">Nenhum perímetro medido.</p>
      ) : (
        <dl className="av2-facts" aria-label="Perímetros registrados">
          {single.map((code) => (
            <div key={code}>
              <dt>{PERIMETERS_SINGLE[code]}</dt>
              <dd>{measured(composition.perimetersCm[code] ?? null, "cm")}</dd>
            </div>
          ))}
          {sided.map((code) => {
            const pair = composition.sidedPerimetersCm[code];
            return (
              <div key={code}>
                <dt>{PERIMETERS_SIDED[code]} (D / E)</dt>
                <dd>
                  D {measured(pair?.right ?? null, "cm")} / E {measured(pair?.left ?? null, "cm")}
                </dd>
              </div>
            );
          })}
        </dl>
      )}
      <h4 className="av2-subtitle">Diâmetros ósseos</h4>
      {breadths.length === 0 ? (
        <p className="muted">Nenhum diâmetro medido.</p>
      ) : (
        <dl className="av2-facts" aria-label="Diâmetros ósseos registrados">
          {breadths.map((code) => (
            <div key={code}>
              <dt>{BONE_BREADTHS[code]}</dt>
              <dd>{measured(composition.boneBreadthsCm[code] ?? null, "cm")}</dd>
            </div>
          ))}
        </dl>
      )}
    </>
  );
}

/**
 * The posture and the somatotype as recorded: for each view, the regions observed with their findings, how many were not observed (never shown as
 * "alinhado"), and the view's note; the somatotype as the professional recorded it, and the Heath-Carter measures kept without a computation.
 */
function RecordedPosture({ posture }: { posture: PosturePayload }) {
  const somatotype = somatotypeText(posture.somatotype.labels);
  const measures = HEATH_CARTER_CODES.filter((code) => posture.somatotype.heathCarter[code] !== null);
  return (
    <>
      <p className="muted small">Observações posturais, não diagnóstico clínico.</p>
      {POSTURE_VIEW_CODES.map((view) => {
        const regions = regionsOf(view);
        const observed = regions.filter((region) => findingsText(region, posture.findings[postureRegionKey(region)]) !== null);
        const note = posture.notes[view].trim();
        return (
          <div key={view}>
            <h4 className="av2-subtitle">{POSTURE_VIEWS[view]}</h4>
            {observed.length === 0 ? (
              <p className="muted">Nenhuma região observada.</p>
            ) : (
              <dl className="av2-facts" aria-label={`Achados da ${POSTURE_VIEWS[view].toLowerCase()}`}>
                {observed.map((region) => (
                  <div key={region.region}>
                    <dt>{region.label}</dt>
                    <dd>{findingsText(region, posture.findings[postureRegionKey(region)])}</dd>
                  </div>
                ))}
              </dl>
            )}
            {observed.length > 0 && observed.length < regions.length && (
              <p className="small muted av2-recorded-line">
                Não observadas: {regions.filter((region) => !observed.includes(region)).map((region) => region.label).join(", ")}.
              </p>
            )}
            {note && <p className="av2-recorded-line">Observações: {note}</p>}
          </div>
        );
      })}
      <h4 className="av2-subtitle">Somatotipo</h4>
      <dl className="av2-facts" aria-label="Somatotipo registrado">
        <div>
          <dt>Registro do profissional</dt>
          <dd>{somatotype ?? "Não registrado"}</dd>
        </div>
        <div>
          <dt>Observações</dt>
          <dd>{orDash(posture.somatotype.notes)}</dd>
        </div>
        {measures.map((code) => (
          <div key={code}>
            <dt>{HEATH_CARTER_MEASURES[code].label}</dt>
            <dd>{measured(posture.somatotype.heathCarter[code], HEATH_CARTER_MEASURES[code].unit)}</dd>
          </div>
        ))}
      </dl>
      {measures.length > 0 && <p className="small muted av2-recorded-line">{HEATH_CARTER_NOTE}</p>}
      <p className="small muted av2-recorded-line">Flexiteste: não registrado nesta versão.</p>
    </>
  );
}
