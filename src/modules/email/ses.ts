import { signRequest } from "./sigv4";
import type { SesSettings } from "./config";

/** What goes out: plain text only, to one person. No tracking, no images, no attachments. */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

/** A failure from the provider or the network. The code names the cause and never carries the message. */
export class EmailError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "EmailError";
  }
}

const TIMEOUT_MS = 8000;

/**
 * Sends one message through the Amazon SES v2 API over HTTPS. The request is built here and signed
 * with Signature Version 4 (see sigv4.ts); `fetcher` is only replaced by tests.
 */
export async function sendWithSes(
  settings: SesSettings,
  message: EmailMessage,
  fetcher: typeof fetch = fetch,
  now: Date = new Date(),
): Promise<{ messageId: string | null }> {
  const url = `https://email.${settings.region}.amazonaws.com/v2/email/outbound-emails`;
  const body = JSON.stringify({
    FromEmailAddress: settings.from,
    Destination: { ToAddresses: [message.to] },
    Content: {
      Simple: {
        Subject: { Data: message.subject, Charset: "UTF-8" },
        Body: { Text: { Data: message.text, Charset: "UTF-8" } },
      },
    },
  });
  const headers = await signRequest({
    method: "POST",
    url,
    headers: { "content-type": "application/json" },
    body,
    region: settings.region,
    service: "ses",
    accessKeyId: settings.accessKeyId,
    secretAccessKey: settings.secretAccessKey,
    now,
  });
  let response: Response;
  try {
    response = await fetcher(url, { method: "POST", headers, body, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    throw new EmailError(error instanceof Error && error.name === "TimeoutError" ? "SES_TIMEOUT" : "SES_UNREACHABLE");
  }
  if (!response.ok) {
    // The type of the error is in a header; the body can echo parts of the request, so it is not read.
    const type = (response.headers.get("x-amzn-errortype") ?? "").split(":")[0].replace(/[^A-Za-z0-9]/g, "").slice(0, 80);
    throw new EmailError(`SES_${response.status}${type ? `_${type}` : ""}`);
  }
  try {
    const parsed = (await response.json()) as { MessageId?: unknown };
    return { messageId: typeof parsed.MessageId === "string" ? parsed.MessageId.slice(0, 200) : null };
  } catch {
    return { messageId: null };
  }
}
