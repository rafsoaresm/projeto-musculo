# Tutorial: ligar o e-mail do app com o Amazon SES

**Para quem:** o responsável pela conta (R1 em `PENDENCIAS.md`).
**Tempo:** cerca de 1 hora de trabalho seu. A AWS leva de algumas horas a 1 dia útil para liberar o envio para qualquer endereço (passo 5).
**Resultado:** a tela de entrada passa a mostrar "Esqueci minha senha". Quem perder a senha recebe um link por e-mail para criar outra. Isso também destrava os próximos recursos que dependem de e-mail: verificação do e-mail no cadastro, avisos, convites de equipe pela tela e mensagens.

O código já está pronto e no ar desde a versão 0.26. Hoje ele está **desligado** porque faltam as credenciais. Nada neste tutorial mexe no código: você cria a conta e as chaves na AWS e coloca quatro variáveis no Webflow.

---

## 0. O que o app espera (resumo técnico)

O app envia um e-mail só de texto (sem imagens, sem rastreamento) pela API v2 do Amazon SES (`https://email.<região>.amazonaws.com/v2/email/outbound-emails`). A requisição é assinada com Signature Version 4.

Ele só liga o envio se **as quatro variáveis** abaixo existirem e estiverem bem formadas. Se faltar qualquer uma, o envio continua desligado e nada quebra.

| Variável | Exemplo | Secreta? | Regra que o app confere |
|---|---|---|---|
| `AWS_REGION` | `sa-east-1` | não | formato de região AWS (`xx-xxxx-N`) |
| `AWS_ACCESS_KEY_ID` | `AKIA…` (20 caracteres) | não | letras maiúsculas e números, 16 a 128 |
| `AWS_SECRET_ACCESS_KEY` | (40 caracteres) | **sim** | 20 a 128 caracteres, sem espaço |
| `EMAIL_FROM` | `Trainer RX <nao-responda@seudominio.com.br>` | não | um endereço só, ou `Nome <endereço>`, em uma linha |

O endereço de `EMAIL_FROM` precisa pertencer a uma identidade **verificada** no SES, na **mesma região** de `AWS_REGION`.

---

## 1. Antes de começar: você precisa de um domínio seu

O app está em `projeto-musculo.webflow.io`. Esse domínio é do Webflow e você não controla o DNS dele, então **não dá para enviar como `@projeto-musculo.webflow.io`**.

- **Recomendado:** um domínio seu (por exemplo `seudominio.com.br`) em que você consiga criar registros DNS (no Registro.br, Cloudflare, GoDaddy, Hostinger etc.). É o mesmo domínio que depois servirá o app e o portal do aluno (R3).
- **Só para testar:** dá para verificar um endereço avulso (por exemplo um Gmail). Funciona, mas e-mails "de" Gmail enviados pela AWS tendem a cair no spam ou ser recusados. Não use em produção.

Se ainda não tem domínio, registre um antes de seguir (no Registro.br, um `.com.br` sai por cerca de R$ 40 por ano).

---

## 2. Criar a conta AWS e protegê-la

1. Acesse https://aws.amazon.com/ e clique em **Criar uma conta da AWS**. Você vai precisar de e-mail, cartão de crédito e telefone. O SES cobra por uso: cerca de US$ 0,10 por 1.000 e-mails. Para recuperação de senha, o custo é praticamente zero.
2. **Ligue a verificação em duas etapas do usuário raiz.** No canto superior direito, clique no nome da conta > **Credenciais de segurança** > **Atribuir dispositivo de MFA**. Use um app autenticador.
3. **Crie um alerta de gasto (opcional, recomendado).** Vá em **Billing and Cost Management > Budgets > Create budget** e escolha o modelo *Zero spend budget* ou *Monthly cost budget* de US$ 5, com aviso no seu e-mail.
4. **Escolha a região.** No seletor de região (canto superior direito), selecione **América do Sul (São Paulo) `sa-east-1`**. Tudo dos passos 3 a 5 deve ser feito **nessa mesma região**. Ela será o valor de `AWS_REGION`.

---

## 3. Verificar o domínio no SES

1. No console, busque **Amazon Simple Email Service** (SES). Confira que a região no topo é **São Paulo**.
2. Menu lateral: **Configuration > Identities > Create identity**.
3. Escolha **Domain** e digite o domínio (ex.: `seudominio.com.br`), sem `www`.
4. Em **Advanced DKIM settings**, deixe **Easy DKIM** com **RSA_2048_BIT** e as duas caixas marcadas (*DKIM signatures* e *Publish DNS records to Route53*). A segunda só vale se o DNS estiver no Route 53; se não estiver, ela é ignorada.
5. (Opcional, recomendado) Em **Custom MAIL FROM domain**, marque **Use a custom MAIL FROM domain** e use `mail.seudominio.com.br`. Isso melhora a entrega.
6. Clique em **Create identity**. O console mostra os registros DNS a publicar.

### 3.1 Registros DNS a criar no seu provedor de domínio

| Tipo | Nome (host) | Valor | Para quê |
|---|---|---|---|
| CNAME (×3) | `xxxxxxxx._domainkey` | `xxxxxxxx.dkim.amazonses.com` | **DKIM**: prova que o e-mail é seu. Copie os três exatamente como o console mostra. |
| TXT | `@` (o próprio domínio) | `v=spf1 include:amazonses.com ~all` | **SPF**: autoriza a AWS a enviar pelo domínio. Se já existir um SPF, **não crie outro**: acrescente `include:amazonses.com` antes do `~all` do registro existente. |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:seu-email@seudominio.com.br` | **DMARC**: política do domínio. Comece com `p=none`; depois de algumas semanas sem problemas, mude para `p=quarantine`. |
| MX | `mail` | `10 feedback-smtp.sa-east-1.amazonses.com` | Só se fez o MAIL FROM do item 5. |
| TXT | `mail` | `v=spf1 include:amazonses.com ~all` | Só se fez o MAIL FROM do item 5. |

Dicas por provedor:
- **Registro.br:** em "Editar zona", o nome vai **sem** o domínio no final (só `xxxxxxxx._domainkey`).
- **Cloudflare:** deixe os CNAME do DKIM com a nuvem **cinza** ("DNS only"), nunca laranja.

7. Volte em **Identities**. Em minutos a algumas horas, o status deve mudar para **Verified**, e o DKIM para **Successful**. Enquanto estiver *Pending*, confira se copiou os nomes sem espaço e sem o domínio duplicado.

> **Se for só testar com um endereço avulso:** em **Create identity**, escolha **Email address**, digite o endereço e clique no link que a AWS envia para ele. Pule os registros DNS.

---

## 4. Criar o usuário que só pode enviar e-mail (IAM)

Estas chaves vão para o Webflow. Por isso elas devem poder **só enviar e-mail pela sua identidade**, nada mais.

1. No console, busque **IAM** > **Users** > **Create user**.
2. **Nome:** `trainer-rx-ses-envio`. **Não** marque acesso ao console. Clique em **Next**.
3. Em **Permissions options**, escolha **Attach policies directly** > **Create policy**. Abre uma aba nova.
4. Na aba nova, clique em **JSON**, apague o conteúdo e cole o texto abaixo. Troque `123456789012` pelo número da sua conta (canto superior direito, 12 dígitos, sem traços) e `seudominio.com.br` pelo seu domínio:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Sid": "EnviarSoPeloDominio",
         "Effect": "Allow",
         "Action": "ses:SendEmail",
         "Resource": "arn:aws:ses:sa-east-1:123456789012:identity/seudominio.com.br"
       }
     ]
   }
   ```

   Se verificou um endereço avulso em vez de domínio, o `Resource` fica `arn:aws:ses:sa-east-1:123456789012:identity/seu-endereco@gmail.com`.
5. Clique em **Next**, dê o nome `TrainerRxSesSendOnly` e clique em **Create policy**.
6. Volte à aba do usuário, clique no botão de atualizar a lista, marque `TrainerRxSesSendOnly` > **Next** > **Create user**.
7. Abra o usuário criado > aba **Security credentials** > **Create access key**.
   - **Use case:** escolha **Application running outside AWS**.
   - **Next** > **Create access key**.
8. **Copie agora** o *Access key* (vira `AWS_ACCESS_KEY_ID`) e o *Secret access key* (vira `AWS_SECRET_ACCESS_KEY`). A chave secreta **só aparece uma vez**. Guarde num gerenciador de senhas; não envie por chat nem por e-mail. Se perder, apague a chave e crie outra.

---

## 5. Sair do modo de teste ("sandbox")

Conta nova do SES começa no *sandbox*. Nele, a AWS só entrega para endereços que você mesmo verificou, e no máximo 200 por dia. Para os alunos e profissionais receberem, é preciso pedir a saída.

1. **SES > Account dashboard > Request production access** (ou "View Get set up page").
2. Preencha:
   - **Mail type:** *Transactional*.
   - **Website URL:** `https://projeto-musculo.webflow.io/app` (ou o seu domínio, quando ele servir o app).
   - **Use case description:** em inglês, por exemplo:

     > We run a SaaS for personal trainers (Trainer RX). We will only send transactional emails triggered by the user: password-reset links requested by the account owner on our login page, and in the future account notices (email verification, team invitations). No marketing, no purchased lists. Expected volume is under 1,000 emails per month. Recipients are our own users who signed up. Bounces and complaints are monitored in the SES console and addresses that bounce are not retried.
   - **Acknowledge** os termos e **Submit**.
3. A resposta chega por e-mail, geralmente em até 24 horas. Se a AWS pedir mais detalhes, responda no mesmo caso com o mesmo tom: transacional, baixo volume, só para usuários cadastrados.

Enquanto o pedido não sai, você já pode seguir os passos 6 e 7 e testar enviando para um endereço que verificou como identidade (passo 3, "endereço avulso").

---

## 6. Colocar as variáveis no Webflow Cloud

1. Entre no Webflow > **Webflow Cloud** > o app **projeto-musculo** > **Environments** > o ambiente **main** (montado em `/app`) > **Variables**.
2. **Add variable** quatro vezes:

   | Nome | Valor | Marcar como secreta |
   |---|---|---|
   | `AWS_REGION` | `sa-east-1` | não |
   | `AWS_ACCESS_KEY_ID` | o *Access key* do passo 4.8 | não |
   | `AWS_SECRET_ACCESS_KEY` | o *Secret access key* do passo 4.8 | **sim** |
   | `EMAIL_FROM` | `Trainer RX <nao-responda@seudominio.com.br>` | não |

   - O endereço de `EMAIL_FROM` precisa ser do domínio verificado.
   - O nome antes do `<` aparece como remetente na caixa de entrada. Pode ser o nome do produto.
   - Sem aspas e sem espaço sobrando no começo ou no fim.
3. **Publique de novo** para as variáveis valerem: em **Deployments**, use **Redeploy** no último deploy. Outra opção é me avisar, e eu disparo pelo Webflow depois de conferir.

> Nunca coloque essas chaves no repositório, num arquivo do projeto ou num campo que vá para o navegador. O app só as lê no servidor.

---

## 7. Conferir que ligou

1. Abra `https://projeto-musculo.webflow.io/app/api/health`. Deve aparecer `"passwordRecovery": "available"`.
   - Se aparecer `"not_configured"`, uma das quatro variáveis está faltando ou mal formada. Confira a região, o tamanho das chaves e se `EMAIL_FROM` tem um endereço só, numa linha.
2. Abra a tela de entrada do app. Deve aparecer **"Esqueci minha senha"**.
3. Faça o teste completo com uma conta de teste:
   - Peça o link. No sandbox, a conta precisa usar um endereço verificado.
   - Confira que o e-mail "Redefinir a sua senha" chega, de preferência na caixa de entrada e não no spam.
   - Abra o link. Ele leva a `/app/redefinir-senha`.
   - Crie uma senha nova e entre com ela.
4. No SES, em **Account dashboard**, os gráficos de *Sends*, *Bounces* e *Complaints* devem mostrar o envio.
5. Me avise o resultado. Eu registro em `VALIDACAO.md` e fecho R1 e C4 em `PENDENCIAS.md`.

---

## 8. Se algo der errado

O app registra o motivo de cada falha no log de execução do Webflow, sem o conteúdo do e-mail, como `EMAIL_SEND_FAILED <código>`. Eu consigo ler esse log. Os códigos mais comuns:

| Código | Causa provável | O que fazer |
|---|---|---|
| `SES_403_AccessDeniedException` | a política IAM não cobre a identidade, ou a região é outra | Confira o `Resource` do passo 4.4 (região, número da conta, domínio) e se `AWS_REGION` é a mesma região da identidade |
| `SES_403_SignatureDoesNotMatch` / `InvalidClientTokenId` | chave copiada errada ou apagada | Crie uma chave nova (passo 4.7) e atualize as duas variáveis |
| `SES_400_MessageRejected` | o endereço de `EMAIL_FROM` não está verificado, ou (no sandbox) o destinatário não está verificado | Confira a identidade e o sandbox (passos 3 e 5) |
| `SES_400_MailFromDomainNotVerifiedException` | o MAIL FROM opcional ainda não verificou | Confira os registros MX e TXT de `mail.` ou desligue o MAIL FROM personalizado |
| `SES_TIMEOUT` / `SES_UNREACHABLE` | instabilidade de rede | Tente de novo; se persistir, me avise |
| E-mail chega no **spam** | DKIM, SPF ou DMARC incompletos | Confira os três no passo 3.1; ferramentas como mail-tester.com dão nota e mostram o que falta |

---

## 9. Manutenção

- **Desligar o e-mail a qualquer momento:** apague qualquer uma das quatro variáveis e publique de novo. "Esqueci minha senha" some da tela.
- **Trocar a chave (recomendado a cada 90 dias, ou se vazar):**
  1. Crie a chave nova no usuário IAM.
  2. Atualize as duas variáveis.
  3. Publique de novo e teste.
  4. Desative e apague a chave antiga.
- **Acompanhar a reputação:** no SES, mantenha *bounces* abaixo de 5% e *complaints* abaixo de 0,1%. Acima disso, a AWS pode suspender o envio.
- **Texto dos termos:** o termo do profissional ainda diz "Ainda não existe recuperação de senha por e-mail" (R2). A correção entra junto com a dos termos que você deixou para o fim (R12).

---

## 10. Checklist

- [ ] Domínio próprio com acesso ao DNS
- [ ] Conta AWS com MFA no usuário raiz e alerta de gasto
- [ ] Região `sa-east-1` selecionada
- [ ] Identidade do domínio **Verified** no SES (DKIM *Successful*, SPF e DMARC publicados)
- [ ] Usuário IAM `trainer-rx-ses-envio` só com `ses:SendEmail` na identidade
- [ ] Chave de acesso criada e guardada
- [ ] Pedido de saída do sandbox enviado e aprovado
- [ ] Quatro variáveis no Webflow (a secreta marcada como secreta) e novo deploy
- [ ] `/app/api/health` com `"passwordRecovery": "available"`
- [ ] Teste completo de "Esqueci minha senha" com o e-mail chegando na caixa de entrada
