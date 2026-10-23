import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  CalendarRange,
  Check,
  CircleDashed,
  Layers3,
  LockKeyhole,
  Route,
  Users,
} from "lucide-react";

export default function Home() {
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">VISÃO GERAL</p>
          <h1>Um método. Todo o percurso.</h1>
          <p className="muted">
            A base para conectar seu atendimento, seus treinos e seus alunos.
          </p>
        </div>
        <span className="pill neutral">Fundação · versão 0.1</span>
      </div>
      <section className="hero-card">
        <div className="hero-copy">
          <span className="hero-kicker">
            <span /> DO PRIMEIRO CONTATO À EVOLUÇÃO
          </span>
          <h2>
            Mais clareza para planejar.
            <br />
            <em>Mais espaço para cuidar.</em>
          </h2>
          <p>
            Comece organizando os ciclos do treinamento. Uma estrutura que
            respeita o seu método e prepara cada etapa do acompanhamento.
          </p>
          <Link className="button primary" href="/planejamento">
            Explorar planejamento <ArrowUpRight size={18} />
          </Link>
          <span className="hero-caption">
            Ciclos configuráveis · duração real · rotação de treinos
          </span>
        </div>
        <div
          className="cycle-visual"
          aria-label="Planejar, revisar e acompanhar são as três etapas do método"
        >
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="orbit orbit-three" />
          <div className="orbit-center">
            <Layers3 size={34} />
            <strong>Seu método</strong>
            <small>em movimento</small>
          </div>
          <span className="orbit-label label-one">
            <i>01</i> Planejar
          </span>
          <span className="orbit-label label-two">
            <i>02</i> Revisar
          </span>
          <span className="orbit-label label-three">
            <i>03</i> Acompanhar
          </span>
        </div>
      </section>
      <section className="quick-grid" aria-label="Princípios do produto">
        <article className="feature-card">
          <span className="icon-tile orange">
            <CalendarRange size={21} />
          </span>
          <h3>Planejamento por fases</h3>
          <p>
            3, 6 ou 12 mesociclos. Frequência, divisão e duração independentes
            em cada fase.
          </p>
          <Link href="/planejamento">
            Abrir planejador <ArrowRight size={16} />
          </Link>
        </article>
        <article className="feature-card">
          <span className="icon-tile green">
            <Users size={21} />
          </span>
          <h3>Atendimento conectado</h3>
          <p>
            Da avaliação à execução, com responsabilidades definidas e histórico
            por aluno.
          </p>
          <span className="small-state">
            <CircleDashed size={14} /> Próximas etapas
          </span>
        </article>
        <article className="feature-card">
          <span className="icon-tile violet">
            <LockKeyhole size={21} />
          </span>
          <h3>Privacidade por princípio</h3>
          <p>
            Sites públicos e área do aluno em origens distintas. Acesso limitado
            ao vínculo autorizado.
          </p>
          <span className="small-state">
            <CircleDashed size={14} /> Arquitetura definida
          </span>
        </article>
      </section>
      <div className="section-heading">
        <div>
          <p className="eyebrow">JORNADA DO PRODUTO</p>
          <h2>Uma base que cresce com propósito.</h2>
        </div>
        <Link className="text-link" href="/projeto">
          Ver roadmap <ArrowRight size={17} />
        </Link>
      </div>
      <section className="journey-card">
        <div className="journey-step">
          <span className="step-number current">01</span>
          <h3>Estruturar</h3>
          <p>Fundação, contratos e ciclos.</p>
          <span className="pill orange-pill">Em desenvolvimento</span>
        </div>
        <div className="journey-step">
          <span className="step-number">02</span>
          <h3>Atender</h3>
          <p>Alunos, avaliação e revisão.</p>
          <span className="muted small">Próxima entrega</span>
        </div>
        <div className="journey-step">
          <span className="step-number">03</span>
          <h3>Acompanhar</h3>
          <p>Portal, execução e evolução.</p>
          <span className="muted small">Piloto operacional</span>
        </div>
        <div className="journey-step">
          <span className="step-number">04</span>
          <h3>Expandir</h3>
          <p>Gestão, marketing e afiliados.</p>
          <span className="muted small">Lançamento comercial</span>
        </div>
      </section>
      <section className="foundation-note">
        <Route size={25} />
        <div>
          <h3>Você está na primeira etapa.</h3>
          <p>
            O planejador já calcula ciclos e permite exportar um rascunho.
            Cadastro, login e entrega de treinos serão integrados nas próximas
            etapas.
          </p>
        </div>
        <span>
          <Check size={15} /> Escopo documentado
        </span>
      </section>
    </>
  );
}
