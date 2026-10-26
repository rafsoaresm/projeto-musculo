import type { D1Database } from "@cloudflare/workers-types";
import type { EmailSettings } from "./config";
import { passwordResetMessage } from "./messages";
import { EmailError, sendWithSes } from "./ses";

/** What the authentication needs from the e-mail: send the link that sets a new password. */
export interface PasswordResetSender {
  sendPasswordReset(input: { to: string; link: string }): Promise<void>;
}

/** At most this many reset e-mails to one address in an hour, so the form cannot flood a person. */
export const MAX_PER_ADDRESS_PER_HOUR = 3;
/** And this many in all, so a flood of addresses cannot ruin the sender's reputation or the quota. */
export const MAX_PER_HOUR = 200;
const HOUR_MS = 60 * 60 * 1000;

interface Dependencies {
  fetcher?: typeof fetch;
  now?: () => Date;
}

/**
 * Sends the reset e-mail and records what happened, never the link. The limit is reserved inside one
 * statement before anything is sent, so two requests at the same time cannot both pass it. A failure
 * is recorded and swallowed: the person asking sees the same answer whether the address exists, was
 * limited or the provider failed, which is what keeps the form from revealing who has an account.
 */
export function createEmailService(db: D1Database, settings: EmailSettings, deps: Dependencies = {}): PasswordResetSender {
  const now = deps.now ?? (() => new Date());
  return {
    async sendPasswordReset({ to, link }) {
      const recipient = to.trim().toLowerCase();
      if (recipient.length < 3 || recipient.length > 254) return;
      const stamp = now().toISOString();
      const since = new Date(now().getTime() - HOUR_MS).toISOString();
      const id = crypto.randomUUID();
      const reserved = await db
        .prepare(
          `INSERT INTO email_messages (id, kind, recipient, status, provider, error_code, created_at)
           SELECT ?1, 'PASSWORD_RESET', ?2, 'FAILED', ?3, 'NOT_SENT_YET', ?4
           WHERE (SELECT COUNT(*) FROM email_messages WHERE kind = 'PASSWORD_RESET' AND recipient = ?2
                    AND status IN ('SENT', 'FAILED') AND created_at > ?5) < ?6
             AND (SELECT COUNT(*) FROM email_messages WHERE kind = 'PASSWORD_RESET'
                    AND status IN ('SENT', 'FAILED') AND created_at > ?5) < ?7`,
        )
        .bind(id, recipient, settings.transport, stamp, since, MAX_PER_ADDRESS_PER_HOUR, MAX_PER_HOUR)
        .run();
      if (reserved.meta.changes === 0) {
        await db
          .prepare(
            `INSERT INTO email_messages (id, kind, recipient, status, provider, created_at)
             VALUES (?1, 'PASSWORD_RESET', ?2, 'THROTTLED', ?3, ?4)`,
          )
          .bind(crypto.randomUUID(), recipient, settings.transport, stamp)
          .run();
        return;
      }
      const message = passwordResetMessage(recipient, link);
      try {
        if (settings.transport === "capture") {
          await db
            .prepare("UPDATE email_messages SET status = 'SENT', error_code = NULL, captured_text = ?2 WHERE id = ?1")
            .bind(id, message.text)
            .run();
          return;
        }
        const sent = await sendWithSes(settings, message, deps.fetcher, now());
        await db
          .prepare("UPDATE email_messages SET status = 'SENT', error_code = NULL, provider_message_id = ?2 WHERE id = ?1")
          .bind(id, sent.messageId)
          .run();
      } catch (error) {
        const code = error instanceof EmailError ? error.code : "EMAIL_UNEXPECTED";
        console.error("EMAIL_SEND_FAILED", code);
        await db.prepare("UPDATE email_messages SET error_code = ?2 WHERE id = ?1").bind(id, code.slice(0, 120)).run().catch(() => undefined);
      }
    },
  };
}
