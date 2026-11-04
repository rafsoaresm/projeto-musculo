# Handoff V3 — individualização do motor de prescrição Gymgital

**Data:** 04/11/2026 | **Base:** motor 2.0.0, PR #95 incorporado à main | **Produto:** proposta revisável por profissional, nunca entrega automática

> **Situação em 04/11/2026 (0.95.0, branch `feat/motor-v3-auditoria-microciclo-20261104`, não publicada):** fatia A com testes rodando e verdes no `npm run check`; **fatia B feita** (auditoria do plano, regras `2026.11.3`, motor 2.1.0); **fatia C feita** (seleção por microciclo, alvos sugeridos para aceitar, observação da avaliação, regras `2026.11.4`, motor 2.2.0); **fatia D não iniciada**; **fatia E só com contratos** (desligada, sem provedor). O que foi verificado e o que não foi: `VALIDACAO.md`, seção "Motor V3". Decisões tomadas pela ferramenta: `PENDENCIAS.md` R16 (e R17, T9, B62, C42 item e). Limite conhecido: sem alvos aceitos, a seleção muda pouco em relação à anterior (R17).

## 0. Objetivo e limites

Refinar o motor **existente**, não criar outro gerador. O caso de regressão é o aluno fictício Xintus: objetivo hipertrofia, 2 anos de prática, 4 sessões semanais de 60 minutos, 12 semanas em 3 fases ABAB, academia completa, PAR-Q sem 'Sim', Flexiteste com dorsiflexão nível 2 e demais níveis 3. A saída anterior tinha 6 exercícios por sessão, praticamente todos 8–12 reps, RIR 1–3, 90 s, dois sets por exercício nas semanas 1–2 e três sets nas semanas 3–12. A avaliação é fictícia; nenhuma pontuação de flexibilidade é diagnóstico ou contraindicação.

**Não mexer nas invariantes**: preservação de linhas profissionais e itens travados; aplicação somente após revisão; revisões aprovadas/entregues imutáveis; escopo da organização e autorização sempre no servidor; regras publicadas congeladas; entrada sem dado não recebe número inventado; motor puro, síncrono, reproduzível; suporte às modalidades e métricas além de hipertrofia.

## 1. O que já existe: reaproveitar

- src/modules/prescricao/motor/generate.ts: planAll, planWorkout, occurrenceFor, finalize e revalidate.
- src/modules/prescricao/motor/select.ts: seleção gulosa com pesos, prioridades por alvos, continuidade e alternativas.
- src/modules/prescricao/motor/volume.ts: cálculo por músculo, por fase e semana, séries diretas, indiretas e ponderadas.
- src/modules/prescricao/motor/dose.ts e progress-week.ts: doses com parâmetros substituíveis pelo profissional e progressão de fase por semana.
- src/modules/prescricao/motor/progression.ts: sugestão por histórico, sem escrever carga automática.
- src/modules/prescricao/motor/flags.ts: achados de movimento geram alertas e decisões de um clique; observações isoladas não excluem exercícios.
- src/modules/prescricao/automatica/facts.ts e build-input.ts: adaptador dos registros reais da ficha, avaliação, histórico e periodização.
- src/modules/prescricao/automatica/generation-form.tsx, proposal-view.tsx, service.ts: geração, revisão, persistência e aceite.
- src/modules/biblioteca/metadata/vocabulary.ts: vocabulário de músculos e padrões já contém KNEE_FLEXION, PLANTAR_FLEXION, SHOULDER_ABDUCTION, ELBOW_FLEXION, ABS etc.
- docs/MOTOR-PRESCRICAO.md: regra de rastreabilidade. tests/motor-*.test.ts e tests/helpers/motor-fixtures.ts: suite existente.

## 2. Patch pontual já nesta branch — NÃO reimplementar

- facts.ts preserva todos os 15 códigos/níveis preenchidos do Flexiteste na observação que chega ao motor, com referência à avaliação, em vez de apenas '15 de 15'. Sem exclusão automática.
- progression.ts usa as N exposições **mais recentes em ordem cronológica** para exigir sucessos consecutivos. Antes, filtrava exposições incompletas e podia sugerir aumento com sucessos antigos; agora incompletude interrompe a sequência.
- Testes de regressão adicionados em tests/motor-input.test.ts e tests/motor-progression.test.ts; ENGINE_VERSION corrigida para 2.0.1.
- ~~Estes testes foram escritos, não executados neste ambiente conectado.~~ Rodam no `npm run check` desde a 0.95.0 (ver `VALIDACAO.md`).

## 3. P0: auditoria de qualidade do PLANO INTEIRO

Adicionar módulo puro de auditoria após o volumeFor em finalize/revalidate, sem alterar a dose manual nem reordenar os exercícios aprovados. A auditoria deve olhar **ocorrências reais por semana**, não contar cada letra de treino apenas uma vez; ABAB = A duas e B duas vezes. A estrutura pode ter rotação irregular, sessões com data nula, sessões por semana variadas e semanas parciais.

Relatar por fase/semana/grupo/padrão: volume direto, indireto e ponderado; frequência de exposição; amplitude e persistência das variações entre semanas; padrões-alvo cobertos/não cobertos; concentração de volume numa região ou padrão; exercícios duplicados, movimentos com exigências similares e sessões potencialmente acima do orçamento de tempo. Não assumir uma 'tabela universal' de mínimo e máximo de séries para toda modalidade, objetivo, experiência ou pessoa. Faixas-alvo são configurações do profissional ou heurísticas versionadas explícitas, sempre com procedência; fora de faixa = sugestão e explicação, não bloqueio clínico.

Qualidade de saída em forma estruturada, legível pela UI: issue.code, severity, phaseIndex/week/muscle/pattern se aplicável, measured/target quando há alvo válido, sourceRefs, rationale, suggestedAction e status. Usar estágio VALIDATION e recomputar após troca, regeneração e rebase, sem persistir avisos obsoletos. Não quebrar schemas persistidos: usar campo opcional / projetor compatível ou migration aditiva conforme necessidade real.

Auditoria deve diferenciar: (a) músculo que tem trabalho indireto, mas nenhum direto; (b) alvo explicitamente prescrito sem atendimento; (c) músculo não-alvo omitido por escolha do profissional. Não recomendar automaticamente panturrilha, bíceps ou abdômen em qualquer programa; para hipertrofia abrangente, sinalizar ausência de estímulo direto como oportunidade de revisão, não como reprovação.

## 4. P0: planejamento por semana, não seleção isolada A/B

Manter função de seleção puramente determinística. Planejar toda a fase com noção do calendário, número de exposições de cada treino por semana e alvos informados no foco por treino/fase. Primeiro respeitar elegibilidade, equipamento, modalidade, quantidade, travas, preservados, exclusões explícitas e limite de duração; depois otimizar cobertura e distribuição semanal dentro do espaço restante. A seleção deve distinguir volume principal e secundário e ponderar repetição em outro treino de acordo com a frequência real; repetir exercícios entre A e B pode ser correto, não criar proibição.

Considerar mecanismo de duas passagens: (1) criar candidatos elegíveis e slots fixos, (2) pontuar escolhas marginais considerando o impacto em cada ocorrência semanal da fase e déficits de alvos já definidos, com desempates estáveis. Fazer iterações limitadas e orçamento previsível (Webflow Cloud/Workers). Se não houver alvos estruturados, apresentar defaults sugeridos na interface para aceite do profissional, mantendo comportamento de pedido de confirmação do projeto; não transformar objetivos livres em restrições silenciosas.

A divisão AB com A e B full body é válida; nomeá-la adequadamente. Não forçar superior/inferior quando a estrutura escolhida é full body. Conferir equilíbrio de padrões SQUAT/HINGE/KNEE_FLEXION e de push/pull apenas quando pertinentes ao objetivo e à estrutura. Guardar as razões do score: contribuição semanal, origem de cada alvo e consequência da seleção.

## 5. P1: política de dose realmente adaptativa

O código já permite doseOverrides por exercício, fase e treino: **reusar**. Para defaults propostos, permitir camadas de regras por perfil de exercício (multiarticular versus monoarticular, natureza unilateral, métrica, dificuldade, objetivo, tempo e contexto de recuperação), sem impor um único 8–12 / 90s a exercícios distintos. Onde faltarem metadados, manter regra genérica + aviso, nunca supor características não registradas. Prioridade de precedência: edição/aplicação manual > override explícito do profissional > regra específica documentada > heurística genérica. Todas as escolhas com rastreabilidade na proposta.

Publicar QUALQUER mudança de heurística em um novo arquivo imutável versionado (ex.: gymgital-base@2026.11.3) e registrar em rules/index.ts, testes de hash e tabela em docs/MOTOR-PRESCRICAO.md. NÃO editar gymgital-base-2026.11.2.json nem reescrever proposta antiga; regenerar proposta anterior continua com seu ruleset de origem.

Não impor deload em semana específica ou escada de sets sem evidência individual. Quando um incremento de 2→3 séries para todos os exercícios resultar em aumento expressivo, gerar observação de distribuição de volume/fadiga, com dados e comparação. Sugerir revisão de carga e técnica na execução, não prescrever quilagens por suposição.

## 6. P1: integração efetiva da progressão ao acompanhamento

Em proposta/treino: instrução de progressão simples, específica para a métrica (ex.: reps em faixa, técnica, RIR observado, quando reavaliar e como considerar uma variação de carga). Usar histórico recente e comparável e os incrementos reais do equipamento **somente se registrados e com aceite**. Hoje historySuggestions() em generate.ts passa incrementKg:null de propósito; tornar a informação editável e registrada com sua fonte, nunca preencher 2,5/5kg por default. Sessão incompleta, dor, RIR ausente, base de carga diferente, equipamento diferente, metas inconsistentes devem bloquear apenas a sugestão numérica e abrir revisão profissional.

Após treino executado, recalcular uma proposta de ajuste sem reescrever revisão entregue. Implementar interação no fluxo real de execução e revisão. Reutilizar progress-week.ts para planejamento e progression.ts para feedback de execução; não confundir os dois.

## 7. P1: dados da avaliação que geram contexto útil

O Flexiteste individual agora entra como observação. Se houver nível discrepante (ex.: dorsiflexão nível 2) o sistema pode informar 'observar a mecânica de agachamento/tornozelo', SEM inferir restrição física ou substituir agachamento. Não mapear todos os achados a contraindicações, nem associar gordura corporal, IMC ou Cooper diretamente a sobrecarga mecânica. Perímetro igual em ambos os lados não prova ausência de assimetria funcional. Dados sem classificação por idade devem continuar 'sem classificação'.

Se necessário, ampliar FindingFact de forma tipada e opcional para os resultados estruturados, com provenance/ref, sob migração compatível; evitar extrair regras clínicas de texto não estruturado. Para texto livre relevante, propor revisão assistida com IA opcional (seção 8) em vez de extração silenciosa.

## 8. IA opcional, eficiente e de baixo custo — **DESLIGADA por padrão**

Arquitetura: motor determinístico calcula + audita + propõe; apenas depois oferecer botão 'Analisar proposta com IA' na tela do profissional. Um pedido por versão/hash da proposta, não uma chamada por exercício nem por cada uma das 48 sessões. A IA recebe síntese compacta: objetivo, nível, disponibilidade, modalidade, achados estruturados não identificáveis, volumes calculados, warnings, lista curta de alternativas elegíveis com IDs e metadados. Não enviar nome, CPF, fotos, histórico de saúde livre ou identificadores pessoais; em dados de saúde, revisar base legal/consentimentos e política do provedor antes de habilitar.

Saída estrita via schema validado no servidor: { observations: [{ code, target, message, evidenceRefs, uncertainty }], suggestions: [{ action, exerciseId?, phaseIndex?, workoutLabel?, reason, sourceRefs }] }. Não permitir novos IDs, exercícios inelegíveis, doses fora do contrato nem referências científicas fabricadas. Sugestões não aplicam: profissional escolhe, motor revalida, testa consistência e só então aplica ao rascunho. Jamais aprovar/entregar automaticamente.

Eficiência: usar modelo pequeno e saída estruturada; limite configurável por requisição (ex.: até 3–5 mil tokens de entrada e até 700–1.000 de saída) e orçamento máximo monetário por organização/mês; request single-shot e no máximo 1 retry transitório; timeout, fallback sem IA e circuito de desligamento; hash de entrada normalizada + modelId + promptVersion para cache por proposta; deduplicação/idempotência por organização; registrar número de tokens/custo/latência/falhas sem payload sensível. Sem provedor/credencial configurados, custo real de inferência = zero.

Não usar IA dentro de motor/generate.ts, select.ts, dose.ts, volume.ts ou flags.ts. Integração facultativa apenas no servidor em automatica/, respeitando tenant e acesso, feature flag explícita. Não solicitar chave de API em campo cliente nem criar novas dependências sem necessidade.

## 9. Testes mínimos e critério de aceite

- Xintus: 4x60, 3 fases, 12 semanas, ABAB. Avaliação com dorsiflexão 2 chega à saída com referência, mas NÃO exclui agachamentos. A auditoria considera quatro ocorrências/semana; volume é somado por sessão, não por nome de treino; identifica eventuais déficits diretos por músculo sem impor todo déficit como proibitivo.
- Metadados faltantes: item pendente não entra na seleção e aviso aponta o dado em falta. Alvos do profissional e doses manuais permanecem soberanos.
- Generalidade: 1 a N treinos por semana (dentro dos limites técnicos já medidos); AB, ABC, full body, superior/inferior, força, cardio, mobilidade e divisões livres. Não aplicar alvo de hipertrofia a cardio.
- Regressão: propostas antigas com regras imutáveis reproduzidas bit a bit; locks e substituídos preservados; regen item/fase e rebase revalidam auditoria; limites de tempo, idempotência, tenant e aprovação preservados.
- Histórico: após execuções completas antigas e uma execução recente incompleta não propor incremento; duas novas consecutivas e comparáveis podem permitir sugestão se incremento real fornecido e aceito; sem dado nunca inventar kg.
- Testes de estabilidade: ordem do catálogo não altera resultado, JSON canônico e hash iguais; simular bibliotecas com exercícios insuficientes; tipagem Zod de IA e idempotência do cache; fallbacks quando provedor indisponível.
- Executar npm run check, npm run build:cloud e e2e do fluxo de prescrição nos dois mounts, documentar o que passou e o que NÃO foi verificado no Webflow Cloud/D1. Medir CPU e memória sob catálogo grande antes de expandir limites.

## 10. Fatiamento de execução para Claude

**Fatia A (feita; testes rodando desde a 0.95.0):** Flexiteste detalhado e regressão de exposições recentes.
**Fatia B (feita na 0.95.0):** auditoria semanal post-process, contratos/avisos/UI, testes do Xintus, sem mudar seleção.
**Fatia C (feita na 0.95.0):** seleção com objetivo de cobertura do microciclo real, regras versionadas e compatibilidade das regenerações.
**Fatia D (não iniciada):** política de dose específica + calendário de progressão e revisão, sem inventar incrementos.
**Fatia E (opcional; só contratos desligados na 0.95.0):** revisão sob demanda com IA pequena, cache, orçamento e saída estruturada.

Antes de codar as fatias B–E, descrever os comportamentos de negócio que mudariam e quais são opcionais; perguntar apenas decisões imprescindíveis, sem criar um módulo novo se o contrato existente resolver.

**Critério de sucesso de produto:** o profissional enxerga, para cada recomendação importante, qual dado a motivou, qual heurística foi aplicada, como ela afeta a semana completa e qual ação altera a prescrição após o aluno registrar a execução.
