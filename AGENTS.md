# Orientações de desenvolvimento

- Leia `docs/ARQUITETURA-WEBFLOW-CLOUD.md` e `docs/ROADMAP-IMPLEMENTACAO.md` antes de ampliar módulos. Fontes originais em `docs/referencias/` são histórico; a escolha atual de runtime é Webflow Cloud, não Vercel.
- Cada tarefa cloud já usa ambiente isolado. Trabalhe no checkout existente; não crie worktree sem pedido explícito.
- Use npm com `package-lock.json`, TypeScript estrito e módulos em `src/modules`. Regras de negócio ficam fora dos componentes React.
- Runtime alvo: Workers via OpenNext. Não depender de disco persistente, processo em background, binário nativo ou servidor Node sempre ativo. Node no build não equivale a Node completo em produção.
- Persistência é SQLite nativo do Webflow Cloud, via binding DB e migrations em `migrations/`. Não usar Supabase/PostgreSQL. Após deploy, migrations são imutáveis; novas alterações exigem migrations aditivas.
- Não introduzir credenciais ou dados reais no cliente. Variáveis `NEXT_PUBLIC_*` são públicas. O binding DB só é acessado no servidor; o app ainda não possui login.
- D1 não tem RLS. Tenant e identidade vêm da sessão verificada no servidor; nunca de payload ou cabeçalho livre. Use repositories com filtro de organização, vínculo e revogação em cada consulta. Responsabilidade técnica e origens privadas separadas continuam obrigatórias.
- Prescrição e execução são entidades distintas. Revisão entregue é imutável; IA nunca aprova ou libera treino. Não preencher lacunas com números ou referências inventadas.
- Mantenha SaaS, receita do profissional e comissões SaaS separados. Comissão é recorrente sobre pagamento SaaS confirmado, com idempotência por fato financeiro.
- Novos links internos usam `next/link`. Teste montagem em subcaminho; não fixe `/api` ou `/_next` em chamadas do navegador.
- `npm run check` valida código e regras. `npm run build:cloud` valida o bundle alvo. Testes de fornecedor/conta são distintos de testes locais.
- Atualize `docs/VALIDACAO.md` e a matriz do roadmap ao concluir uma fatia. Não declare épico completo com apenas scaffolding.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
