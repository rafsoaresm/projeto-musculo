import type { Metadata } from "next";
import { ArrowRight, Blocks, ShieldCheck } from "lucide-react";
import { capabilities } from "@/modules/platform/catalog";

export const metadata: Metadata = { title: "Mapa do produto" };

export default function ProjectPage() {
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">VISÃO E ENTREGAS</p>
          <h1>O produto, por inteiro.</h1>
          <p className="muted">
            Cada etapa tem um propósito e um critério real de conclusão.
          </p>
        </div>
        <span className="pill neutral">Roadmap vivo</span>
      </div>
      <section className="project-intro">
        <Blocks size={30} />
        <div>
          <h2>Construído para o Webflow Cloud</h2>
          <p>
            Painel e regras de negócio em uma base modular. Sites públicos e
            portal do aluno terão origens separadas, preservando a marca do
            profissional e a privacidade do atendimento.
          </p>
        </div>
      </section>
      <div className="roadmap-grid">
        {capabilities.map((item) => (
          <article className="roadmap-card" key={item.id}>
            <div className="roadmap-header">
              <span className="epic-id">{item.id}</span>
              <span
                className={`pill ${item.status === "Planejado" ? "neutral" : "orange-pill"}`}
              >
                {item.status}
              </span>
            </div>
            <h2>{item.title}</h2>
            <p>{item.description}</p>
            <div className="next-step">
              <ArrowRight size={16} />
              <p>{item.next}</p>
            </div>
          </article>
        ))}
      </div>
      <section className="foundation-note">
        <ShieldCheck size={25} />
        <div>
          <h3>Prontidão se comprova em cada fronteira.</h3>
          <p>
            Autenticação, persistência remota, pagamentos, PDFs, editor de sites
            e publicação na conta Webflow ainda precisam de implementação ou
            validação específica. O piloto operacional permanece no escopo.
          </p>
        </div>
      </section>
    </>
  );
}
