# Gymgital — Handoff técnico de Avaliação Física V2
**Produto:** Gymgital (anteriormente Trainer Prescription / Projeto Músculo)  
**Destino:** coding agent  
**Tipo:** evolução de módulo existente, **não** reconstrução integral  
**Estado:** especificação de implementação, sujeita à revisão de um profissional de Educação Física para tabelas classificatórias e uso clínico  
**Base documental:** `Avaliação Física completa.pdf` (5 páginas), imagem com os 4 protocolos solicitados, e wireframes existentes:  
https://www.figma.com/design/RRHeYHC01jSd0hnrRzzBxP/Trainer-Prescription-%E2%80%94-UX-Redesign-%7C-Wireframes-V1

> **Instrução principal ao agente:** antes de alterar código, inspecionar a implementação atual de Avaliações, suas entidades, rotas, hooks, validações, design system e persistência. Preservar funcionalidades existentes; evoluir fluxos, campos, cálculos e relatórios por migração compatível. Não criar uma segunda avaliação paralela.

---

## 1. Objetivo e escopo

Transformar a Avaliação Física existente em um fluxo digital modular, confiável e comparável ao longo do tempo, incorporando **todos os grupos de informação encontrados nas cinco páginas do PDF** e suportando, na composição corporal, **quatro protocolos distintos de dobras cutâneas**:

1. Faulkner — **4 dobras** (o nome na imagem não traz a quantidade; o protocolo usa quatro sítios).
2. Guedes — **3 dobras**.
3. Jackson & Pollock — **7 dobras**.
4. Jackson & Pollock — **3 dobras**.

O avaliador escolhe o protocolo aplicável, preenche apenas os sítios requeridos, vê o resultado estimado e pode guardar medições adicionais. Os protocolos não são intercambiáveis: o código deve registrar **método, versão da equação, parâmetros, sítios e fórmula de conversão** para garantir reprodutibilidade histórica.

### Princípios

- **Modular:** perguntas e testes opcionais por avaliação, com módulos ativados pelo profissional e campos mínimos estritamente necessários.
- **Anamnese e PAR-Q separados:** flag de atenção documentada, nunca liberação médica automática.
- **Rascunho e retomada:** autosave, saída sem perda, progresso por módulo.
- **Medidas brutas imutáveis após finalização:** retificação versionada e auditável, com justificativa.
- **Resultados derivados reprodutíveis:** cálculos por serviço puro, com testes e metadados da fórmula.
- **Séries históricas comparáveis:** método e referência de classificação visíveis; comparação de percentual de gordura deve advertir sobre mudança de protocolo.
- **Mobile-first:** coleta antropométrica em campo pelo profissional, com input numérico adequado.
- **Privacidade:** dados de saúde são sensíveis (LGPD); acesso por papel, controle de compartilhamento, registro de acesso e exportação.

### Não fazer

Não diagnosticar doença, não automatizar prescrição com base isolada no PAR-Q ou no IMC, não inventar tabelas de classificação ausentes do PDF, não somar resultados de **diferentes protocolos** como se fossem equivalentes, não mostrar massa óssea, muscular ou residual como **calculada** sem equação validada e insumos necessários.

---

## 2. Novo fluxo UX

**Aluno → Avaliações → Nova avaliação / Retomar avaliação → Revisar → Finalizar → Relatório e evolução.**

O fluxo mantém o padrão de **Avaliação guiada** existente, mas detalha o conteúdo:

| Etapa | Módulo | O que registrar |
|---|---|---|
| 0 | Configuração | aluno, avaliador, data, módulos ativos, protocolo de dobras, consentimentos/visibilidade |
| 1 | Perfil e objetivos | cadastro vinculado, objetivos do treinamento |
| 2 | Triagem e segurança | anamnese clínica, exercício atual/passado, PAR-Q |
| 3 | Composição corporal | sinais vitais, peso, altura, dobras, perímetros, diâmetros e resultados |
| 4 | Postura e movimento | observações posturais lateral/posterior/anterior, somatotipo e flexiteste |
| 5 | Testes físicos | resistência abdominal, resistência de membros superiores, Cooper 12 min |
| 6 | Revisão e entrega | pendências, notas profissionais, resultados, assinatura profissional (quando houver), PDF e compartilhamento |

**UX:** exibir navegação lateral por módulos em desktop e stepper compacto no mobile; autosave com feedback discreto; botões **Voltar**, **Salvar rascunho**, **Próximo** e **Finalizar avaliação**; módulos não preenchidos mostram “Não realizado”, não zero. Permitir reordenar ou desativar módulos opcionais por template, sem apagar avaliações anteriores.

**Estados:** `draft`, `in_progress`, `needs_professional_review`, `finalized`, `amended`, `archived`. Separar `completionState` de `safetyReviewState` (`not_reviewed`, `attention_required`, `reviewed`, `restricted`). Uma avaliação pode estar completa em campos e ainda demandar revisão de segurança.

---

## 3. Mapeamento fiel das cinco páginas do PDF

### 3.1. Página 1 — Cadastro, objetivos, anamnese e PAR-Q

**Dados pessoais**, preferencialmente pré-preenchidos pelo cadastro do aluno:
- Nome completo, data de nascimento, idade calculada **na data da avaliação**, sexo/referência necessária aos cálculos, endereço, bairro, CEP, cidade, e-mail, telefone.
- Data da avaliação, profissional responsável e timezone. O snapshot cadastral usado na avaliação precisa sobreviver às alterações futuras no perfil do aluno.
- Não reproduzir dados pessoais do exemplo do PDF em produção.

**Objetivos do treinamento (múltipla seleção):** enrijecimento, hipertrofia, fortalecimento, definição muscular, saúde/bem-estar, emagrecimento, preparação física. Campo de objetivos adicionais e notas. Corrigir grafia/capitalização sem alterar o significado.

**Anamnese clínica: 10 perguntas do documento**, cada uma com `Sim / Não / Não informado`, descrição contextual e, quando relevante, anexos:
1. Doenças na família nos últimos anos.
2. Doenças pessoais nos últimos anos.
3. Restrição à prática de exercícios físicos.
4. Cirurgias prévias.
5. Alergias.
6. Acidentes ou lesões osteomusculares.
7. Uso de medicamentos.
8. Dores corporais recentes.
9. Hábito atual ou anterior de fumar.
10. Dieta para perder ou ganhar peso.

**Atividade física atual:** pratica?; atividades; frequência (valor + unidade `por_semana`, não texto livre “3x”); duração/tempo de prática, observações.

**Atividade física passada:** praticou?; atividades; tempo total de prática; frequência anterior; observações.

**PAR-Q: 7 perguntas textuais do PDF**, opções `Sim / Não / Não respondido`:
1. Algum médico informou problema cardíaco e recomendou atividade apenas supervisionada?
2. Dor no peito durante atividade física?
3. Dor no peito no último mês ao praticar atividade física?
4. Tontura, desequilíbrio e/ou perda de consciência?
5. Problema ósseo/articular potencialmente agravável por atividade física?
6. Medicação para pressão arterial e/ou problemas cardíacos?
7. Outra razão conhecida para não realizar atividade física?

**Regra de segurança:** qualquer `Sim` gera **sinalização de atenção** e exige registro de decisão humana; não diagnosticar nem declarar aptidão/inaptidão automaticamente. Qualquer item não respondido aparece como pendência, não como “Não”. O profissional pode registrar “avaliação física não realizada/adiada”, motivo, orientação e encaminhamento.

> Observação: o documento usa uma versão de sete perguntas do PAR-Q. Não substituir silenciosamente o instrumento por PAR-Q+; eventual instrumento atualizado será um formulário **versionado** e identificado separadamente.

### 3.2. Página 2 — Composição corporal e antropometria

**Sinais vitais e básicos:** PAS (mmHg), PAD (mmHg), FC em repouso (bpm), peso (kg), altura (m ou cm com normalização), taxa metabólica basal (kcal/dia) se aferida/informada ou se existir equação habilitada e identificada. O documento exibe TMB, mas **não informa sua fórmula**: não calculá-la sem especificar o método.

**Dobras possíveis** (armazenar todas como catálogo, independentemente do método selecionado):
`subscapular`, `triceps`, `biceps`, `chest`, `midaxillary`, `suprailiac`, `abdominal`, `thigh`, `calf_medial`; unidade **mm**. Os nove pontos aparecem no PDF; cada protocolo exige apenas seu subconjunto.

**Perímetros (cm):**
- sem lateralidade: ombro, tórax, cintura, abdômen, quadril;
- lado direito/esquerdo: braço, antebraço, coxa, panturrilha;
- cada lado em campo separado; opcionalmente registrar localização anatômica, condição (relaxado/contraído) e instrumento;
- total por avaliação com datas e unidade persistidas.

**Diâmetros ósseos (cm):** biepicondilar do úmero, biepicondilar do fêmur, biestiloide.

**Indicadores:**
- RCQ: cintura (cm) / quadril (cm), se ambos válidos;
- IMC: peso kg / [altura m]²;
- soma das dobras **apenas do protocolo selecionado**;
- estimativa de % de gordura, massa gorda kg, massa livre de gordura kg, quando cálculo aplicável;
- comparação bilateral: `direito - esquerdo` em cm (informar convenção), com valor absoluto e observação; **sem “significativa/não significativa”** até referência validada;
- armazenar, se informados ou importados, massa muscular, massa óssea e residual, **marcados como mensurados/importados** e com origem, não derivados automaticamente de % gordura;
- áreas musculares de braço/coxa: **não calcular nesta versão** enquanto não estiverem definidos método, requisitos e pontos anatômicos; permitir campo de resultado importado/manual com fonte e unidade, sem classificação automática.

**Não reproduzir gráfico de pizza do PDF**, pois o documento combina massa livre de gordura com subcomponentes desta, gerando dupla contagem. Usar barras ou cartões separados e semanticamente corretos.

### 3.3. Página 3 — Somatotipo e avaliação postural

**Somatotipo:** o PDF exibe um resultado textual (“endomorfo-mesomorfo”) e descrições genéricas. Implementar:
- seleção/registro profissional manual (`endomorfo`, `mesomorfo`, `ectomorfo`, `misto`, `não classificado`) com observações; sem inferir tipos corporais a partir de foto;
- para automação futura, adotar **Heath-Carter** como protocolo explícito e independente, **não inferir que os dados já colhidos bastam**, pois exige medidas anatômicas específicas (p. ex. dobra supraespinhal, panturrilha medial, braço flexionado). A dobra **supraespinhal** não é sinônimo obrigatório de “supra-ilíaca”; preservar sítios distintos.

**Avaliação postural — Visão lateral:**
- Lordose cervical: fisiológica / aumentada / diminuída;
- Ombros: alinhados / protusos / rotação interna;
- Abdômen: fisiológico / protuso;
- Cifose torácica: fisiológica / aumentada / retificada;
- Lordose lombar: fisiológica / aumentada / retificada;
- Quadril: alinhado / anteversão / retroversão;
- Joelhos: alinhados / recurvatum / flexo;
- Pés: plano / cavo / calcâneo / equino.

**Visão posterior:**
- Ombros: alinhados / esquerdo deprimido / direito deprimido;
- Coluna: alinhada / escoliose lombar / escoliose torácica / em “S” — registrar como **observação postural**, não diagnóstico clínico;
- Escápulas: abduzida / esquerda alada / direita alada / rodada inferior / rodada superior;
- Pés: alinhados / pronados / supinados;
- Tíbia: alinhada / vara / valga;
- Inclinação da cabeça: direita / esquerda (adicionar opção “sem desvio observado”);
- Rotação do quadril: interna / externa (adicionar opção “sem desvio observado”).

**Visão anterior:**
- Joelhos: alinhados / valgo / varo;
- Patelas: alinhadas / lateralizadas / medializadas;
- EIAS: alinhada / esquerda deprimida / direita deprimida;
- EIPS: alinhada / esquerda deprimida / direita deprimida.

**Modelo dos itens posturais:** `view`, `region`, `findings[]`, `laterality?`, `notes?`. Preferir seleção múltipla apenas nos achados que possam coexistir; evitar radio único para opções coexistentes. Permitir anexar fotos opcionais em cada vista, com consentimento e controle de visibilidade.

### 3.4. Página 4 — Flexiteste

O PDF apresenta **15 movimentos**, cada um avaliado em **nível inteiro 1 a 4** (nesta versão do instrumento). Registrar individualmente e somar apenas itens aplicáveis e preenchidos:

1. Abdução horizontal dos ombros
2. Abdução do ombro
3. Flexão do cotovelo
4. Hiperextensão do cotovelo
5. Flexão do punho
6. Extensão do punho
7. Flexão do quadril
8. Hiperextensão do tronco
9. Flexão lateral do tronco
10. Flexão da coxa
11. Extensão da coxa
12. Flexão do joelho
13. Hiperextensão do joelho
14. Dorsiflexão plantar
15. Flexão plantar

**UX:** lista de movimentos, escolha rápida de nível 1/2/3/4, apoio visual por movimento somente com imagens licenciadas/próprias e acessíveis; descrição e observações. Resumo `X/15 preenchidos`, `total de pontos`. No PDF de exemplo os níveis somam **32** e a classificação apresentada é “Médio (-)”. Não inferir os limites dessa classificação: o PDF não fornece tabela. Implementar classificação **manual** até homologação de escala, faixa etária, sexo e versão do Flexiteste.

Não permitir campo vazio valer 0. Não somar um questionário de 15 itens com versões de 20 movimentos sem identificação da variante do teste.

### 3.5. Página 5 — Testes físicos e conclusão

**Resistência abdominal (documento nomeia “potência abdominal”, Pollock e Wilmore, 1993):**
- exercício/protocolo/versão, número de repetições completas (`integer >= 0`), duração da prova se aplicável, observações, classificação manual até tabela homologada.

**Resistência de membros superiores (mesma atribuição):**
- tipo de exercício/variante, repetições completas, duração/condições quando aplicável, observações, classificação manual até tabela homologada.
- Evitar extrapolar critérios de execução da imagem sem documento técnico complementar.

**Teste de Cooper — 12 minutos:**
- distância em metros, tempo fixo = 12 min para esta modalidade;
- velocidade média calculada `distancia_m / 1000 / (12 / 60)` = `distancia_m / 200` em km/h;
- VO₂máx **estimado** `ml/kg/min` pela equação documentada na seção 6;
- classificação somente com tabela de referência homologada e identificada, senão entrada manual;
- condições, local, data, observação e contraindicações.

**Considerações finais:** campo rich-text/textarea, recomendações, limitações observadas, orientações/encaminhamentos. O PDF contém ressalva de que o relatório **não equivale a exame médico**; usar texto institucional revisado por responsável jurídico/técnico, sem replicar erros de português do documento.

---

## 4. Protocolos de dobras: matriz obrigatória

| Protocolo (identificador) | Aplicabilidade da equação | Dobras requeridas (mm) | Resultado direto |
|---|---|---|---|
| `faulkner_4_1968` | utilização relatada para homens/mulheres; exigir validação pelo profissional | Tríceps, subescapular, supra-ilíaca, abdominal | % gordura |
| `guedes_3_1985_male` | referência original: homens jovens universitários (17–27 anos) | Tríceps, supra-ilíaca, abdominal | densidade → % gordura |
| `guedes_3_1985_female` | referência original: mulheres jovens universitárias (17–19 anos) | Coxa, supra-ilíaca, subescapular | densidade → % gordura |
| `jackson_pollock_7_1978_male` | homens 18–61 anos | Peitoral, axilar média, tríceps, subescapular, abdominal, supra-ilíaca, coxa | densidade → % gordura |
| `jackson_pollock_7_1980_female` | mulheres 18–55 anos | Mesmos 7 sítios | densidade → % gordura |
| `jackson_pollock_3_1978_male` | homens 18–61 anos | Peitoral, abdominal, coxa | densidade → % gordura |
| `jackson_pollock_3_1980_female` | mulheres 18–55 anos | Tríceps, supra-ilíaca, coxa | densidade → % gordura |

**Apresentação ao usuário:** só quatro opções (Faulkner, Guedes 3, JP 7, JP 3). A variante da fórmula é resolvida por **referência fisiológica/equação selecionada**, e não por um rótulo genérico de identidade de gênero. Se faltarem parâmetros necessários ou a variante não for aplicável, bloquear **somente o cálculo automático** e registrar medições brutas normalmente.

**Aviso de elegibilidade:** faixa fora da população de validação gera indicação “Fora da faixa original de validação”; exigir revisão/confirmar alternativa, sem falsa precisão. O documento fornecido mostra “Jackson e Pollock 7 (18 a 61 anos)”, mas a faixa feminina nas referências técnicas consultadas difere; aplicar os intervalos por variante acima e expor a fonte.

### 4.1. Dados de entrada

- `skinFoldReadings`: por `siteId`, uma a três aferições em mm, `selectedValueMm` derivado por média/mediana conforme configuração da avaliação; escolher e persistir **uma regra de agregação** por avaliação.
- Valor positivo e plausível, com validação de faixa configurável e alerta para valores discrepantes; não truncar decimais.
- `sumSkinfoldMm`: soma dos `selectedValueMm` requeridos; nunca soma de todos os sítios cadastrados.
- `ageYears`: idade inteira na data da avaliação, não idade atual.
- `sexEquationVariant`: `male` / `female` / `not_selected`, com texto respeitoso e finalidade explícita de cálculo; quando não selecionada, manter cálculo pendente.
- `density_g_cm3` e `bodyFatPercent` podem ser `null` quando inaplicáveis; não substituir `null` por zero.
- `equationVersion`, `conversionFormula` e `validationFlags` persistidos na versão finalizada.

### 4.2. Fórmulas

Definições: `S` = soma das dobras exigidas pelo protocolo em mm; `I` = idade completa na data da avaliação; `D` = densidade corporal em g/cm³; `log10` = logaritmo de base 10. **Calcular com precisão integral e arredondar apenas para apresentação.**

```ts
// Percentual de gordura direta — Faulkner (1968)
fatPercent = 0.153 * S + 5.783;

// Densidade — Guedes (1985)
D_male   = 1.17136 - 0.06706 * Math.log10(S);
D_female = 1.16650 - 0.07063 * Math.log10(S);

// Densidade — Jackson & Pollock 3 dobras
D_male   = 1.10938   - 0.0008267  * S + 0.0000016  * S*S - 0.0002574  * I;
D_female = 1.0994921 - 0.0009929  * S + 0.0000023  * S*S - 0.0001392  * I;

// Densidade — Jackson & Pollock 7 dobras
D_male   = 1.112 - 0.00043499 * S + 0.00000055 * S*S - 0.00028826 * I;
D_female = 1.097 - 0.00046971 * S + 0.00000056 * S*S - 0.00012828 * I;

// Conversão padronizada (Siri, 1961) — só para métodos com D
fatPercent = 495 / D - 450;
// Não aplicar a conversão de Siri ao Faulkner (resultado já é %).

fatMassKg = weightKg * fatPercent / 100;
fatFreeMassKg = weightKg - fatMassKg;
```

**Restrições de cálculo:** `S > 0`, `D > 0`, todos os sítios necessários presentes, dados finitos, idade necessária quando aplicável, percentual plausível. Resultados impossíveis devem exibir erro de validação; nunca limitar silenciosamente a `0..100` com `clamp` para esconder entrada inválida. **Siri** é a conversão padrão; se implementada **Brozek**, deve ser opção explícita, versionada e preservada no histórico, não troca silenciosa.

### 4.3. Comportamento ao trocar o método

- Trocar JP7 → Faulkner **não apaga** valores já digitados nos outros sítios; apenas adapta o conjunto obrigatório e recalcula.
- Sítio ausente → resultado “Aguardando medidas”.
- Protocolo diferente em duas datas → gráfico pode mostrar ambos com marcador e aviso **“Metodologias diferentes; comparação de % de gordura pode não ser equivalente”**; oferecer filtro “mesmo protocolo”.
- Reavaliação sugere método anterior, mas permite alteração consciente com confirmação da comparabilidade.
- Exibir “Protocolo, variante, conversão, população original de validação” no detalhamento do cálculo e no relatório.

---

## 5. Cálculos complementares e limitações

| Indicador | Cálculo/Regra | Origem |
|---|---|---|
| Idade | anos completos na data da avaliação | cadastro+data |
| IMC | peso(kg)/altura(m)² | calculado |
| RCQ | cintura(cm)/quadril(cm) | calculado |
| Velocidade Cooper | `distancia_m / 200` km/h | calculado (12 min) |
| VO₂ estimado Cooper | `(distancia_m - 504.9) / 44.73` ml/kg/min | fórmula de referência; resultado estimado |
| Diferença bilateral | perímetro direito − esquerdo | calculado |
| Massa gorda | peso × % gordura/100 | calculado |
| Massa livre de gordura | peso − massa gorda | calculado |
| Soma do Flexiteste | soma dos 15 níveis preenchidos | calculado, total só quando completo |
| Massa muscular, óssea e residual | **sem cálculo** | manual/importado enquanto não houver método validado |
| TMB | **sem fórmula no documento** | manual/importada ou futura fórmula explícita |
| Áreas musculares braço/coxa | **sem fórmula no documento** | manual/importada |
| Classificação IMC, RCQ, gordura, flexibilidade, Cooper e força | **não fixar faixa a partir do PDF** | somente referência/tabela homologada, sexo/idade quando requeridos |

**Atenção de consistência:** o PDF informa distância Cooper de **2.200 m**, velocidade **11 km/h** e VO₂ de **37,69**, enquanto a equação `(2200 - 504.9)/44.73` produz **~37,90**. Preservar o valor do documento apenas como exemplo legado; o cálculo novo utiliza fórmula declarada e versionada. Registrar discrepância na importação.

---

## 6. Modelo de dados e integração

**Investigar o esquema e entidades atuais primeiro.** Uma proposta relacional/documental flexível, a adaptar:

```ts
type Assessment = {
  id: string;
  tenantId: string;
  studentId: string;
  professionalId: string;
  assessedAt: string; // ISO8601 + timezone
  status: "draft"|"in_progress"|"needs_professional_review"|"finalized"|"amended"|"archived";
  version: number;
  templateId?: string;
  templateVersion?: string;
  enabledModules: string[];
  studentSnapshot: Record<string, unknown>;
  goals: string[];
  anamnesis: Record<string, { answer: "yes"|"no"|"unknown"; details?: string }>;
  activityHistory: Record<string, unknown>;
  parq: {
    instrument: "parq_7_legacy";
    version: "pdf_2026_11";
    answers: Record<string, "yes"|"no"|"unanswered">;
    riskFlag: boolean;
    professionalReview?: { decision: string; notes: string; reviewedAt: string; reviewerId: string };
  };
  vitals?: { systolicMmHg?: number; diastolicMmHg?: number; restingHeartRateBpm?: number };
  anthropometry: {
    weightKg?: number; heightCm?: number;
    circumferencesCm: Record<string, { left?: number; right?: number; value?: number }>;
    boneBreadthsCm: Record<string, number>;
    skinfoldsMm: Record<string, { readings: number[]; selectedValueMm?: number }>;
    skinfoldProtocol?: string;
    equationVariant?: "male"|"female"|"not_selected";
    aggregationRule?: "mean"|"median"|"single";
    conversionFormula?: "siri_1961"|"brozek_1963";
    importedMeasurements?: Record<string, { value:number; unit:string; source:string }>;
  };
  postural: Record<string, unknown>;
  somatotype?: { method:"manual"|"heath_carter"; labels:string[]; notes?:string };
  flexitest?: { variant:"pdf_15_movements_1_to_4"; levels:Record<string,1|2|3|4>; classificationManual?:string };
  physicalTests?: Record<string, unknown>;
  conclusions?: string;
  attachments?: string[];
  computed?: { formulaVersion: string; density?: number; bodyFatPercent?: number; fatMassKg?: number; fatFreeMassKg?:number; bmi?:number; waistHipRatio?:number; vo2Estimate?:number };
  flags?: Array<{code:string; severity:"info"|"attention"|"blocker"; details?:string}>;
  audit?: { createdAt:string; updatedAt:string; finalizedAt?:string; amendedFrom?:string };
};
```

**Requisitos técnicos:**
- Banco por `tenantId` e `studentId`, checks de autorização em **todas** as leituras e escritas, validação server-side.
- Criar `assessment_form_templates`, `assessment_module_definitions`, `assessment_protocol_definitions`, `assessment_results` ou equivalentes conforme stack.
- Códigos estáveis para questões/sítios/movimentos; labels exibíveis separados de IDs.
- Versionar questionário, tabela classificatória, regras de cálculo, conversão, idade e referência sexual da equação.
- Não recalcular avaliações finalizadas retroativamente após atualização de versão; somente via recálculo explícito rastreável e resultado comparável.
- Operações `create / autosave patch / resume / finalize / amend / list / details / export`.
- Conflito de edição otimista por `version`, debounce de autosave, feedback “Salvo”/“Não salvo”.
- Relatório PDF server-side ou mecanismo existente; possibilidade de ocultar notas clínicas internas no relatório compartilhável.
- Fotos e anexos com URL assinada, escopo do tenant, consentimento específico e política de retenção.
- Observabilidade de falha de cálculo e validação sem expor dados sensíveis em logs.

---

## 7. Design e especificação de telas

**Utilizar o sistema visual do wireframe existente**, não impor nova identidade: tipografia Figtree (corpo) e Roboto (títulos), fundo #F7F8F8, superfície branca, texto #2E3438, borda #D8DCDF, azul de ação #0078B8, azul claro #F1F9FD, cinza auxiliar #66737A. Preferir tokens/componentes reais do projeto, não os valores literais acima quando houver variáveis.

**Telas a criar/complementar no Figma existente:**

| ID visual | Tela | Conteúdo |
|---|---|---|
| `GYM / AV-01` | Avaliações do aluno | histórico, novo/retomar, status, método anterior, evolução |
| `GYM / AV-02` | Triagem e PAR-Q | objetivos, anamnese, perguntas, atenção clínica e revisão humana |
| `GYM / AV-03` | Dobras e protocolos | seletor dos quatro métodos, inputs dinâmicos por sítio, resultados calculados e método |
| `GYM / AV-04` | Medidas, perímetros | vital, peso/altura, cintura/quadril, bilateral, diâmetros |
| `GYM / AV-05` | Postura e flexiteste | abas lateral/posterior/anterior, flexiteste 15 itens, progresso |
| `GYM / AV-06` | Testes e relatório | Cooper, repetições, considerações, checagem, gerar PDF |

**Desktop:** 1280px no mesmo grid lateral profissional do wireframe; **mobile:** colapsar sidebar, 1 coluna, controles de nível com touch targets ≥44px, input `decimal`, unidade fixa junto ao campo, ação de salvar persistente no rodapé. Componentes de formulário com largura coerente, texto centralizado nos botões e estados de erro legíveis. Não replicar o layout tabular do PDF.

**Interações:**
- Troca de protocolo: campos obrigatórios surgem/somem sem descarte dos valores já digitados.
- Resultado: “Prévia calculada”; nota metodológica expansível; cartões com `% gordura`, `massa gorda`, `massa livre`, `soma das dobras`.
- PAR-Q `Sim`: faixa de atenção visível, profissional registra avaliação/revisão antes da finalização.
- “Sem aferição”: diferenciar de número zero.
- Revisão: checklist por módulo + avisos de segurança + possibilidade de finalizar com módulos opcionais não realizados, desde que sinalizados.

---

## 8. Exemplos e testes de regressão (obrigatórios)

Usar **o PDF como fixture de teste**, mas com dados pessoais anonimizados. Contexto das medidas da página 2: homem, **27 anos na data da avaliação**, 69,1 kg, altura 1,71 m, dobras relevantes:
- subescapular=11; tríceps=24; bíceps=11; peitoral=12; axilar média=9;
- supra-ilíaca=15; abdominal=16; coxa=35; panturrilha=17 (todas mm).
- cintura 69,5 cm, quadril 108 cm.

| Caso | Verificação | Esperado |
|---|---|---|
| JP7 homem | `12+9+24+11+16+15+35` | **122 mm** |
| JP7 homem | Siri sobre D (idade 27) | **~17,27%** (~17,3% na tela) |
| JP7 homem | massa gorda, 69,1 kg | **~11,94 kg** |
| JP3 homem | `12+16+35` | **63 mm**, **~18,44%** |
| Guedes3 homem | `24+15+16` | **55 mm**, **~19,35%** |
| Faulkner4 | `24+11+15+16` | **66 mm**, **15,88%** |
| IMC | `69,1 / 1,71²` | **~23,63** |
| RCQ | `69,5 / 108` | **~0,644** |
| Flexiteste | `[2,3,2,2,1,1,2,3,3,2,2,3,2,2,2]` | **32 pontos** |
| Cooper 12 min | 2200 m | **11,0 km/h; VO₂ ~37,90 estimado** |

**Casos de borda:** campo nulo; zero indevido; número negativo; vírgula decimal brasileira; 3 medidas por sítio com agregação; sites extra não incluídos na soma; mudança de método antes de salvar; mudança de método após avaliação concluída; mulher com JP3 e Guedes3 (sítios próprios); sexo/referência da equação ausente; idade fora do intervalo; aniversário no mesmo dia; comparação entre métodos; conflito de autosave; falta de autorização por tenant; relatório sem conteúdo clínico não autorizado; avaliação PAR-Q com resposta `Sim`; dobras com valores fora de faixa plausível; troca de unidade cm/m.

---

## 9. Critérios de aceite

- [ ] As cinco páginas do PDF estão representadas em campos/módulos, inclusive os 15 itens do Flexiteste e as três vistas posturais.
- [ ] Os quatro protocolos constam no seletor e exigem os sítios específicos corretos para cada variante.
- [ ] Fórmulas isoladas e testadas; exemplos numéricos batem com as tolerâncias; versão do algoritmo persistida.
- [ ] Alterar protocolo **preserva valores brutos** e atualiza os campos obrigatórios/resultados.
- [ ] PAR-Q sinaliza riscos e exige revisão humana; não decide aptidão automaticamente.
- [ ] Dados não aferidos não viram zero nem “normal”; classificações não homologadas não são inventadas.
- [ ] Rascunho e histórico funcionam; avaliação finalizada é versionada; logs de auditoria são consultáveis.
- [ ] Usuário visualiza método e limitações de comparabilidade nos gráficos e PDF.
- [ ] PDF final e histórico por aluno respeitam RBAC, tenant e privacidade.
- [ ] Layout consistente com o Figma atual e responsivo em 320, 375, 768 e 1280px.
- [ ] Inputs numéricos brasileiros funcionam; botões alinhados; estados vazios, loading, erro e revisão contemplados.
- [ ] Testes unitários, integração e E2E cobrem salvar/retomar/finalizar/alterar protocolo/exportar.
- [ ] Migração preserva avaliações legadas e as marca com `legacy_formula_unknown` se a metodologia não for verificável.

---

## 10. Ordem sugerida de entrega

**P0 — núcleo funcional:** inventário do código atual; modelo/migração; seleção de protocolo; fórmulas versionadas; entradas e validações; rascunho; PAR-Q e anamnese; histórico básico; testes de regressão.

**P1 — cobertura completa do PDF:** perímetros, diâmetros, postura, flexiteste, testes, conclusão, exportação e evolução comparável.

**P2 — aprimoramento:** fichas e templates configuráveis; fotos anatômicas consentidas; biblioteca de referências de testes; tabelas classificatórias homologadas; método completo Heath-Carter com pontos adicionais e protocolo próprio.

---

## 11. Fontes, divergências e decisões ainda não homologadas

**Materiais fornecidos:**
- PDF **“Avaliação Física completa”**, páginas 1 a 5: base dos módulos e campos; exemplo de Jackson & Pollock 7, resultados, posturas, Flexiteste e testes.
- Captura dos quatro nomes do seletor: “Faulkner”, “Guedes 3 dobras”, “Jackson e Pollock 7 dobras”, “Jackson e Pollock 3 dobras”.

**Referências complementares verificadas (fórmulas não explicitadas no PDF):**
- *Avaliação Morfofuncional*, SESES/Estácio, 2017, pp. 106–108, equações de JP3/JP7, Guedes, Faulkner e Siri: https://unigra.com.br/arquivos/avaliacao-morfofuncional-.pdf
- *Jackson-Pollock Body Density*, Topend Sports (variantes sexuais, faixas e equações): https://www.topendsports.com/testing/density-jackson-pollock.htm
- Guedes e Sampedro (1985), estudo de densidade e dobras: https://doi.org/10.5433/1679-0359.1985v6n3p160
- Cooper, teste de 12 minutos, equação de estimativa de VO₂: https://rdu.unicesumar.edu.br/bitstream/123456789/517/1/MARIO%20MOREIRA%20CASTILHO.pdf
- Heath-Carter, referência do somatotipo antropométrico: https://pmc.ncbi.nlm.nih.gov/articles/PMC4155226/

**Lacunas deliberadamente abertas — não deduzir valores:**
- Tabelas de classificação de % gordura, IMC, RCQ, Flexiteste, resistência muscular e Cooper **não estão descritas integralmente no PDF**; solicitar tabela/licença/versão e homologação antes de gerar rótulos automáticos.
- Método da taxa metabólica basal, massa muscular, massa óssea, massa residual e áreas musculares **não indicado** no PDF.
- Critério de significância bilateral, avaliação de postura e classificação do somatotipo **não especificados** em termos operacionais.
- O texto apresentado no PDF possui um exemplo numérico com ligeira divergência em VO₂; conservar proveniência e **não forçar a fórmula a produzir 37,69**.
- A descrição “potência” dos testes de repetição deve ser exibida conforme fonte, mas o agente não deve afirmar que há medição de potência mecânica sem parâmetro de tempo/trabalho.

**Definição de pronto:** o coding agent entrega código integrado à base existente, migrations, testes, screenshots mobile/desktop, changelog, guia de fórmula/protocolo e evidência de aceite para os fluxos.

---

## 12. Wireframes produzidos no Figma (entrega visual)

As seis telas abaixo foram adicionadas **ao arquivo original**, na página `Page 1`, como **frames editáveis** (não capturas de tela). A referência visual foi a tela original `TP / 04 Avaliação guiada`, preservando layout lateral, Figtree/Roboto, cores e tratamento dos componentes. Os exemplos são **representações de interface**; ainda não estão conectados à lógica da aplicação.

| Tela | Frame Figma |
|---|---|
| AV-01 — Histórico de avaliações | https://www.figma.com/design/RRHeYHC01jSd0hnrRzzBxP/?node-id=49-536 |
| AV-02 — Anamnese e PAR-Q | https://www.figma.com/design/RRHeYHC01jSd0hnrRzzBxP/?node-id=49-660 |
| AV-03 — Protocolos de dobras | https://www.figma.com/design/RRHeYHC01jSd0hnrRzzBxP/?node-id=49-760 |
| AV-04 — Antropometria e perímetros | https://www.figma.com/design/RRHeYHC01jSd0hnrRzzBxP/?node-id=52-635 |
| AV-05 — Postura e Flexiteste | https://www.figma.com/design/RRHeYHC01jSd0hnrRzzBxP/?node-id=52-862 |
| AV-06 — Testes e relatório | https://www.figma.com/design/RRHeYHC01jSd0hnrRzzBxP/?node-id=52-1094 |

**Nota de implementação:** os wireframes detalham os módulos e estados centrais, mas parte dos questionários longos está representada de forma resumida na viewport. A **lista completa e os IDs de cada campo** encontram-se nas seções 3 e 4 deste documento; implementá-los mesmo quando nem todas as perguntas forem visíveis simultaneamente no frame. Os gráficos, anexos e fluxos mobile devem ser completados pelo coding agent a partir das regras deste handoff e do design system vigente.
