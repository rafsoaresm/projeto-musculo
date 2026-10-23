export const capabilities = [
  {
    id: "E0",
    title: "Fundação e Webflow Cloud",
    description:
      "Aplicação Next.js, configuração OpenNext, contratos e documentação de arquitetura.",
    status: "Em construção",
    next: "Validar deploy na conta Webflow e as fronteiras de autenticação, storage, PDF e jobs.",
  },
  {
    id: "E1",
    title: "Identidade e organizações",
    description:
      "Vínculos, profissionais responsáveis, isolamento e acesso aos dados do aluno.",
    status: "Base de dados inicial",
    next: "Implementar login e convites usando as tabelas nativas do Webflow Cloud; validar revogação em homologação.",
  },
  {
    id: "E2",
    title: "Atendimento e prescrição",
    description:
      "Avaliações, ciclos, revisão profissional e versões imutáveis dos treinos.",
    status: "Planejador disponível",
    next: "Persistir avaliações e prescrições; implementar revisão, aprovação, entrega e PDF.",
  },
  {
    id: "E3",
    title: "Site e captação",
    description:
      "Editor de blocos, publicação explícita, serviços e interessados no CRM.",
    status: "Planejado",
    next: "Validar Puck e domínios Webflow; implementar publicação e captura por organização.",
  },
  {
    id: "E4",
    title: "Portal do aluno",
    description:
      "Treino liberado, execução, check-ins e evolução na marca do profissional.",
    status: "Planejado",
    next: "Criar app em origem privada separada e fechar a jornada de acompanhamento.",
  },
  {
    id: "E5",
    title: "Gestão e marketing",
    description:
      "Funil, agenda, contratos, recebimentos e conectores de comunicação.",
    status: "Planejado",
    next: "Integrar fornecedores com consentimento e escopos próprios.",
  },
  {
    id: "E6",
    title: "SaaS e afiliados",
    description:
      "Assinatura da organização e comissões recorrentes por pagamento confirmado.",
    status: "Planejado",
    next: "Implementar fatos financeiros, conciliação e livro de comissões idempotente.",
  },
  {
    id: "E7",
    title: "Evidências e evolução",
    description:
      "RAG com fontes autorizadas, progressão assistida e automações adicionais.",
    status: "Planejado",
    next: "Validar corpus e direitos depois de fechar o núcleo determinístico.",
  },
] as const;
