"use client";
import { TextAreaField } from "./fields";
import { CONCLUSION_FIELDS, CONCLUSION_LABEL, type ConclusionForm } from "./conclusion";

const NOTE: Record<(typeof CONCLUSION_FIELDS)[number], string | undefined> = {
  considerations: "O que a avaliação mostrou, nas palavras do profissional. Sem caráter de diagnóstico médico.",
  recommendations: undefined,
  limitations: "O que não pôde ser avaliado ou pode ter afetado as medidas.",
  referrals: "Por exemplo, procurar um médico ou outro profissional.",
};

/**
 * The final considerations of the "Revisão" step (handoff 3.5, Figma AV-06): four texts written by the professional, saved with the draft and
 * recorded with the assessment. Nothing is added to them by the system.
 */
export function ConclusionCard({ form, onChange }: { form: ConclusionForm; onChange: (form: ConclusionForm) => void }) {
  return (
    <section className="panel av2-card" aria-labelledby="av2-consideracoes">
      <h3 id="av2-consideracoes">Considerações finais</h3>
      <p className="muted small">Texto do profissional com achados, recomendações, limitações e encaminhamentos. Opcional; fica registrado com a avaliação.</p>
      <div className="av2-grid">
        {CONCLUSION_FIELDS.map((field) => (
          <TextAreaField
            key={field}
            label={CONCLUSION_LABEL[field]}
            value={form[field]}
            rows={field === "considerations" ? 4 : 2}
            note={NOTE[field]}
            onChange={(value) => onChange({ ...form, [field]: value })}
          />
        ))}
      </div>
    </section>
  );
}
