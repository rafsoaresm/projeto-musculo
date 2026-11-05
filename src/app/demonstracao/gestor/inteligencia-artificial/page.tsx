import { Notice, PageHeading, Pill } from "@/components/ui";
import { requireDemo } from "@/modules/demo/guard";

export const dynamic = "force-dynamic";

/** The demonstration connects nothing and stores no key: it says what the real page lets the manager do. Fictitious values only. */
export default async function DemoArtificialIntelligence() {
  await requireDemo();
  return (
    <>
      <PageHeading
        eyebrow="PLATAFORMA"
        title="Inteligência artificial"
        description="Conecte os provedores, escolha o modelo de cada tarefa, defina quanto cada organização pode usar e acompanhe o consumo."
        aside={<Pill tone="warning">Prévia · sem conexão</Pill>}
      />
      <Notice>
        <p>
          Na demonstração nenhuma chave é guardada e nenhum provedor é chamado. Na área real, o gestor conecta a chave de cada provedor (OpenAI, Anthropic e Google), que é gravada cifrada e nunca mostrada de novo; escolhe o provedor e o modelo de cada tarefa; cria planos de IA com franquia mensal de tokens; habilita a IA organização por organização e acompanha o uso. A IA só recebe um resumo codificado e anonimizado do aluno, e codificar não garante que a reidentificação seja impossível.
        </p>
      </Notice>
      <section className="panel" aria-labelledby="demo-ia-planos">
        <h2 id="demo-ia-planos">Exemplo de plano de IA (valores fictícios)</h2>
        <dl className="detail-list">
          <div>
            <dt>Plano</dt>
            <dd>Exemplo</dd>
          </div>
          <div>
            <dt>Franquia mensal</dt>
            <dd>500.000 tokens por mês</dd>
          </div>
          <div>
            <dt>Custo</dt>
            <dd>Desconhecido até o gestor digitar o preço do modelo</dd>
          </div>
        </dl>
      </section>
    </>
  );
}
