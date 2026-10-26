import type { EmailMessage } from "./ses";

/**
 * The e-mails the tool writes. They carry a link and nothing else about the person: no health data,
 * no plan, no student's name. Plain text on purpose.
 */
export const RESET_LINK_HOURS = 1;

export function passwordResetMessage(to: string, link: string): EmailMessage {
  return {
    to,
    subject: "Redefinir a sua senha",
    text: [
      "Olá,",
      "",
      "Recebemos um pedido para redefinir a senha da sua conta na ferramenta de prescrição de treino.",
      `Para escolher uma nova senha, abra o link abaixo. Ele vale por ${RESET_LINK_HOURS} hora e só pode ser usado uma vez:`,
      "",
      link,
      "",
      "Se não foi você quem pediu, ignore esta mensagem: a sua senha continua a mesma e ninguém consegue entrar sem ela.",
      "Nunca compartilhe este link.",
    ].join("\n"),
  };
}
