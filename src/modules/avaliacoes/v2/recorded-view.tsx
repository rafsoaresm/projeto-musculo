import Link from "next/link";
import { Download } from "lucide-react";
import { Fragment } from "react";
import { Notice, formatDateTime } from "@/components/ui";
import type { AssessmentDetail, ResultRow } from "@/db/assessments";
import { deliveredByText } from "@/modules/configuracoes/delivered-by";
import { formatCalendarDate } from "@/modules/training/format";
import { PhotoImage } from "../photo-image";
import { PhotoEraseButton } from "../photo-erase-button";
import { photoViewLabel } from "../photos";
import { photoName, recordedPhotoGroups } from "./posture-photos";
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
import { FLEXITEST_CLASSIFICATION_NOTE, FLEXITEST_CODES, FLEXITEST_VARIANT_LABEL, FLEXITEST_LABEL, filledText, flexitestTally, movementEmpty, totalText, type MovementPayload } from "./flexitest";
import {
  COOPER_MINUTES,
  EXERCISE_LABEL,
  REPETITION_TESTS,
  TESTS_CLASSIFICATION_NOTE,
  TEST_TITLE,
  cooperEmpty,
  repetitionTestEmpty,
  testsEmpty,
  type TestsPayload,
} from "./physical-tests";
import { CONCLUSION_FIELDS, CONCLUSION_LABEL, conclusionEmpty, type ConclusionPayload } from "./conclusion";
import { NOT_INCLUDED, PART_LABEL, excludedPartsOf, isPartEnabled, isStepEnabled, templateLine, type EnabledParts, type TemplatePart } from "./template";

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
  movement = null,
  tests = null,
  conclusion = null,
  decidedBy,
  amendedAt = null,
  canAmend,
  template = null,
  enabled = null,
}: {
  detail: AssessmentDetail;
  profile: ProfilePayload | null;
  screening: ScreeningPayload | null;
  composition: CompositionPayload | null;
  /** The "Movimento" step (module "posture"), or null when it was never saved. */
  posture?: PosturePayload | null;
  /** The Flexiteste (module "movement"), or null when it was never saved. */
  movement?: MovementPayload | null;
  /** The "Testes físicos" step (module "tests"), or null when it was never saved. */
  tests?: TestsPayload | null;
  /** The final considerations (module "conclusion"), or null when they were never saved. */
  conclusion?: ConclusionPayload | null;
  /** The name of who recorded the PAR-Q decision, when there is one. */
  decidedBy: string | null;
  /** When the amendment that corrects this one was recorded (only for an amended one). */
  amendedAt?: string | null;
  /** No open draft for the student and no recorded amendment of this one. */
  canAmend: boolean;
  /** The model it was made with (slice 0.85), or null: every part on. */
  template?: { name: string; version: number } | null;
  /** The optional parts that model had on; a part that is off reads "Não incluído neste modelo", never "Não realizado". */
  enabled?: EnabledParts;
}) {
  const on = (part: TemplatePart) => isPartEnabled(enabled, part);
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
            {deliveredByText(detail.recordedByName, detail.recordedOrganizationName)}. Não muda mais.
          </span>
        </p>
        <p className="small muted">{templateLine(template)}</p>
        <div className="av2-report-action">
          <Link className="button secondary small" href={`${base}/${detail.id}/pdf`} download prefetch={false}>
            <Download size={16} /> Baixar relatório em PDF
          </Link>
          <span className="small muted">O mesmo relatório que o aluno baixa na área dele, quando tem acesso ao portal. Sem classificação automática.</span>
        </div>
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
            ) : detail.riskStatus === "REVIEW_REQUIRED" ? (
              <p className="small">PAR-Q com “Sim”, sem decisão profissional registrada. Isto não é liberação clínica.</p>
            ) : (
              <p className="muted small">Sem resposta “Sim” no PAR-Q: nenhuma decisão foi pedida. Isto não é liberação clínica.</p>
            )}
          </>
        )}
      </section>

      <section className="panel av2-card" aria-labelledby="av2-r-medidas">
        <h3 id="av2-r-medidas">Medidas</h3>
        {!isStepEnabled(enabled, "medidas") ? (
          <p className="muted">{NOT_INCLUDED}.</p>
        ) : composition ? (
          <>
            {!on("basics") && <ExcludedPart part="basics" />}
            {(on("basics") || on("skinfolds")) && (
              <dl className="av2-facts">
                {on("basics") && (
                  <>
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
                  </>
                )}
                {on("skinfolds") && (
                  <>
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
                  </>
                )}
              </dl>
            )}
            {!on("skinfolds") ? <ExcludedPart part="skinfolds" /> : SKINFOLD_SITE_CODES.some((site) => (composition.skinfolds[site] ?? []).length > 0) ? (
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
            <RecordedPerimeters composition={composition} perimeters={on("perimeters")} breadths={on("breadths")} />
          </>
        ) : (
          <NotDone excluded={excludedPartsOf(enabled, "medidas")} />
        )}
      </section>

      <section className="panel av2-card" aria-labelledby="av2-r-resultados">
        <h3 id="av2-r-resultados">Resultados</h3>
        <p className="muted small">Calculados ao finalizar, com o método e a versão da fórmula, sem classificação. Só os marcados como estimativa vêm da equação de um estudo.</p>
        {detail.results.length > 0 ? <ResultsList results={detail.results} labelledBy="av2-r-resultados" /> : <p>Nenhum resultado foi calculado.</p>}
      </section>

      <section className="panel av2-card" aria-labelledby="av2-r-movimento">
        <h3 id="av2-r-movimento">Postura e movimento</h3>
        {!isStepEnabled(enabled, "movimento") ? (
          <p className="muted">{NOT_INCLUDED}.</p>
        ) : (posture && !postureEmpty(posture)) || (movement && !movementEmpty(movement)) || detail.photos.length > 0 ? (
          <>
            {posture && !postureEmpty(posture) ? (
              <RecordedPosture posture={posture} views={on("posture")} somatotype={on("somatotype")} />
            ) : on("posture") && on("somatotype") ? (
              <p className="muted">Postura e somatotipo: não realizados.</p>
            ) : (
              (["posture", "somatotype"] as const).map((part) =>
                on(part) ? (
                  <Fragment key={part}>
                    <h4 className="av2-subtitle">{PART_LABEL[part]}</h4>
                    <p className="muted">Não realizado.</p>
                  </Fragment>
                ) : (
                  <ExcludedPart key={part} part={part} />
                ),
              )
            )}
            {posture &&
              !postureEmpty(posture) &&
              (["posture", "somatotype"] as const).filter((part) => !on(part)).map((part) => <ExcludedPart key={part} part={part} />)}
            {detail.photos.length > 0 && <RecordedPhotos detail={detail} />}
            <h4 className="av2-subtitle">Flexiteste</h4>
            {!on("flexitest") ? (
              <p className="muted">{NOT_INCLUDED}.</p>
            ) : movement && !movementEmpty(movement) ? (
              <RecordedFlexitest movement={movement} results={detail.results} />
            ) : (
              <p className="muted">Não realizado.</p>
            )}
          </>
        ) : (
          <NotDone excluded={excludedPartsOf(enabled, "movimento")} />
        )}
      </section>

      <section className="panel av2-card" aria-labelledby="av2-r-testes">
        <h3 id="av2-r-testes">Testes físicos</h3>
        {!isStepEnabled(enabled, "testes") ? (
          <p className="muted">{NOT_INCLUDED}.</p>
        ) : tests && !testsEmpty(tests) ? (
          <RecordedTests tests={tests} on={on} />
        ) : (
          <NotDone excluded={excludedPartsOf(enabled, "testes")} />
        )}
      </section>

      <section className="panel av2-card" aria-labelledby="av2-r-consideracoes">
        <h3 id="av2-r-consideracoes">Considerações finais</h3>
        {!on("conclusion") ? (
          <p className="muted">{NOT_INCLUDED}.</p>
        ) : conclusion && !conclusionEmpty(conclusion) ? (
          <dl className="av2-facts av2-facts-wide" aria-label="Considerações finais registradas">
            {CONCLUSION_FIELDS.filter((field) => conclusion[field].trim() !== "").map((field) => (
              <div key={field}>
                <dt>{CONCLUSION_LABEL[field]}</dt>
                <dd className="av2-prose">{conclusion[field]}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="muted">Não escritas.</p>
        )}
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
function RecordedPerimeters({ composition, perimeters = true, breadths: breadthsOn = true }: { composition: CompositionPayload; perimeters?: boolean; breadths?: boolean }) {
  const single = PERIMETER_SINGLE_CODES.filter((code) => composition.perimetersCm[code] !== undefined);
  const sided = PERIMETER_SIDED_CODES.filter((code) => composition.sidedPerimetersCm[code] !== undefined);
  const breadths = BONE_BREADTH_CODES.filter((code) => composition.boneBreadthsCm[code] !== undefined);
  return (
    <>
      <h4 className="av2-subtitle">Perímetros</h4>
      {!perimeters ? (
        <p className="muted">{NOT_INCLUDED}.</p>
      ) : single.length + sided.length === 0 ? (
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
      {!breadthsOn ? (
        <p className="muted">{NOT_INCLUDED}.</p>
      ) : breadths.length === 0 ? (
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
 * The posture photos of a recorded assessment (handoff 3.3), by view of the posture, as thumbnails read through the private route (only the
 * professional who attends the student reaches it; since 0.86 the student sees them too, through their own route). An erased one says when;
 * each stored one can still be erased ("Excluir foto": the file leaves the storage, the frozen record stays). Since 0.86 they are in the PDF.
 */
function RecordedPhotos({ detail }: { detail: AssessmentDetail }) {
  return (
    <>
      <h4 className="av2-subtitle" id="av2-r-fotos">
        Fotos da postura
      </h4>
      <p className="muted small av2-card-note">Registro visual, não diagnóstico. Quem atende o aluno e o próprio aluno, na área dele, veem as fotos; elas entram no relatório em PDF. Uma foto apagada sai da área do aluno e do PDF.</p>
      <div className="av2-grid av2-photo-grid" role="group" aria-labelledby="av2-r-fotos">
        {recordedPhotoGroups(detail.photos).flatMap((group) =>
          group.photos.map((photo) => (
            <figure key={photo.view} className="av2-field av2-photo-slot">
              <figcaption className="av2-label">{photoViewLabel(photo.view)}</figcaption>
              <PhotoImage
                studentId={detail.studentId}
                assessmentId={detail.id}
                view={photo.view}
                stamp={photo.createdAt}
                erasedAt={photo.erasedAt}
                alt={`${photoName(photo.view)} de ${formatCalendarDate(detail.assessedOn)}`}
              />
              <div className="av2-photo-actions">
                {!photo.erasedAt && <PhotoEraseButton studentId={detail.studentId} assessmentId={detail.id} view={photo.view} />}
              </div>
            </figure>
          )),
        )}
      </div>
    </>
  );
}

/**
 * The posture and the somatotype as recorded: for each view, the regions observed with their findings, how many were not observed (never shown as
 * "alinhado"), and the view's note; the somatotype as the professional recorded it, and the Heath-Carter measures kept without a computation.
 */
function RecordedPosture({ posture, views = true, somatotype: somatotypeOn = true }: { posture: PosturePayload; views?: boolean; somatotype?: boolean }) {
  const somatotype = somatotypeText(posture.somatotype.labels);
  const measures = HEATH_CARTER_CODES.filter((code) => posture.somatotype.heathCarter[code] !== null);
  return (
    <>
      {views && <p className="muted small">Observações posturais, não diagnóstico clínico.</p>}
      {(views ? POSTURE_VIEW_CODES : []).map((view) => {
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
                    <dd>{findingsText(region, posture.findings[postureRegionKey(region)], posture.laterality[postureRegionKey(region)])}</dd>
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
      {somatotypeOn && (
        <>
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
        </>
      )}
    </>
  );
}

/** A part the model left out, drawn like the other parts of a card: its subtitle, then "Não incluído neste modelo." (never "Não realizado"). */
function ExcludedPart({ part }: { part: TemplatePart }) {
  return (
    <>
      <h4 className="av2-subtitle">{PART_LABEL[part]}</h4>
      <p className="muted">{NOT_INCLUDED}.</p>
    </>
  );
}

/** A step with nothing recorded: "Não realizado.", and the parts of it the model left out, so they are never read as not done. */
function NotDone({ excluded }: { excluded: readonly TemplatePart[] }) {
  return (
    <>
      <p className="muted">Não realizado.</p>
      {excluded.map((part) => (
        <ExcludedPart key={part} part={part} />
      ))}
    </>
  );
}

/** The Flexiteste as recorded: the level of each movement assessed, how many, the total (only with all 15: in "Resultados" too), and the professional's text. */
function RecordedFlexitest({ movement, results }: { movement: MovementPayload; results: readonly ResultRow[] }) {
  const filled = flexitestTally(movement).filled;
  // The total is the one recorded at finalize (with its formula version), never recomputed with today's formula.
  const total = results.find((result) => result.code === "flexitest_total")?.value ?? null;
  const assessed = FLEXITEST_CODES.filter((code) => movement.flexitest.levels[code] !== undefined);
  const missing = FLEXITEST_CODES.filter((code) => movement.flexitest.levels[code] === undefined);
  const { classificationManual, notes } = movement.flexitest;
  return (
    <>
      <p className="small muted">
        {filledText(filled)} · total: {totalText(total).toLowerCase()} · {FLEXITEST_VARIANT_LABEL[movement.flexitest.variant]}.
      </p>
      {assessed.length > 0 && (
        <dl className="av2-facts" aria-label="Níveis do Flexiteste">
          {assessed.map((code) => (
            <div key={code}>
              <dt>{FLEXITEST_LABEL[code]}</dt>
              <dd>Nível {movement.flexitest.levels[code]}</dd>
            </div>
          ))}
        </dl>
      )}
      {assessed.length > 0 && missing.length > 0 && (
        <p className="small muted av2-recorded-line">Não avaliados: {missing.map((code) => FLEXITEST_LABEL[code]).join(", ")}.</p>
      )}
      {classificationManual.trim() !== "" && (
        <p className="av2-recorded-line">
          Classificação (manual): {classificationManual} <span className="small muted">— {FLEXITEST_CLASSIFICATION_NOTE}</span>
        </p>
      )}
      {notes.trim() !== "" && <p className="av2-recorded-line">Observações: {notes}</p>}
    </>
  );
}

const count = (value: number | null, one: string, many: string) => (value === null ? "Sem registro" : `${value} ${value === 1 ? one : many}`);

/** The physical tests as recorded: what each one has, as typed; a test not done says so. The Cooper speed and VO₂max are in "Resultados". */
function RecordedTests({ tests, on = () => true }: { tests: TestsPayload; on?: (part: TemplatePart) => boolean }) {
  const cooper = tests.cooper;
  const classified = [...REPETITION_TESTS.map((key) => tests[key].classificationManual), cooper.classificationManual].some((value) => value.trim() !== "");
  return (
    <>
      {REPETITION_TESTS.map((key) => {
        const test = tests[key];
        return (
          <div key={key}>
            <h4 className="av2-subtitle">{TEST_TITLE[key]}</h4>
            {!on(key === "upperLimb" ? "upper_limb" : key) ? (
              <p className="muted">{NOT_INCLUDED}.</p>
            ) : repetitionTestEmpty(test) ? (
              <p className="muted">Não realizado.</p>
            ) : (
              <dl className="av2-facts" aria-label={`${TEST_TITLE[key]} registrada`}>
                <div>
                  <dt>{EXERCISE_LABEL[key]}</dt>
                  <dd>{orDash(test.exercise)}</dd>
                </div>
                <div>
                  <dt>Repetições completas</dt>
                  <dd>{count(test.repetitions, "repetição", "repetições")}</dd>
                </div>
                <div>
                  <dt>Duração</dt>
                  <dd>{test.durationSeconds === null ? "—" : `${test.durationSeconds} s`}</dd>
                </div>
                {(key === "upperLimb" || test.conditions.trim() !== "") && (
                  <div>
                    <dt>Condições</dt>
                    <dd>{orDash(test.conditions)}</dd>
                  </div>
                )}
                {test.classificationManual.trim() !== "" && (
                  <div>
                    <dt>Classificação (manual)</dt>
                    <dd>{test.classificationManual}</dd>
                  </div>
                )}
                {test.notes.trim() !== "" && (
                  <div>
                    <dt>Observações</dt>
                    <dd>{test.notes}</dd>
                  </div>
                )}
              </dl>
            )}
          </div>
        );
      })}
      <h4 className="av2-subtitle">{TEST_TITLE.cooper}</h4>
      {!on("cooper") ? (
        <p className="muted">{NOT_INCLUDED}.</p>
      ) : cooperEmpty(cooper) ? (
        <p className="muted">Não realizado.</p>
      ) : (
        <dl className="av2-facts" aria-label="Teste de Cooper registrado">
          <div>
            <dt>Distância percorrida</dt>
            <dd>{cooper.distanceM === null ? "Sem registro" : `${decimal(cooper.distanceM, 1)} m em ${COOPER_MINUTES} min`}</dd>
          </div>
          <div>
            <dt>Data do teste</dt>
            <dd>{cooper.testedOn ? formatCalendarDate(cooper.testedOn) : "Sem registro"}</dd>
          </div>
          <div>
            <dt>Local</dt>
            <dd>{orDash(cooper.location)}</dd>
          </div>
          <div>
            <dt>Condições</dt>
            <dd>{orDash(cooper.conditions)}</dd>
          </div>
          <div>
            <dt>Contraindicações</dt>
            <dd>{orDash(cooper.contraindications)}</dd>
          </div>
          {cooper.classificationManual.trim() !== "" && (
            <div>
              <dt>Classificação (manual)</dt>
              <dd>{cooper.classificationManual}</dd>
            </div>
          )}
          {cooper.notes.trim() !== "" && (
            <div>
              <dt>Observações</dt>
              <dd>{cooper.notes}</dd>
            </div>
          )}
        </dl>
      )}
      {classified && <p className="small muted av2-recorded-line">{TESTS_CLASSIFICATION_NOTE}</p>}
    </>
  );
}
