import { z } from "zod";

/**
 * The two names a professional can correct in "Configurações": the name of the workspace and their own
 * display name. Both are shown to students (invitation, student area, PDF), so they are plain text of a
 * sensible length. The same limits as the database (1 to 160) with a floor of 2, as at sign-up.
 */
export const NAME_MIN = 2;
export const NAME_MAX = 160;

const name = z
  .string()
  .transform((value) => value.replace(/\s+/g, " ").trim())
  .pipe(
    z
      .string()
      .min(NAME_MIN)
      .max(NAME_MAX)
      // Control and invisible formatting characters would make two different names look the same.
      .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value)),
  );

const nameInput = z.object({ name }).strict();

/** Throws a ZodError for anything but a plain name of 2 to 160 characters. Inner spaces are collapsed. */
export function parseName(raw: unknown): string {
  return nameInput.parse(raw).name;
}

export const ROLE_PERMISSION_NOTICE =
  "Convidar outras pessoas para o espaço e dar papéis diferentes ainda não está disponível: depende do e-mail verificado, que depende de o e-mail da ferramenta estar configurado.";
