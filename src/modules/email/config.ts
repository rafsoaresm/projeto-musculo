/**
 * Where the e-mail goes out from. Nothing here sends anything: it only reads what the operator
 * configured and refuses what is incomplete, so a half-configured environment behaves exactly like
 * an unconfigured one ("not available") instead of failing at the moment someone needs it.
 *
 * Amazon SES is the provider. Its credentials are secrets of the environment (the Webflow Cloud
 * dashboard, or `.dev.vars` locally) and never reach the browser. The local `capture` transport
 * exists only for the browser tests: it is honoured only when the application's own address is
 * localhost or 127.0.0.1, so it cannot be switched on in production by a stray variable.
 */
export interface SesSettings {
  transport: "ses";
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** The verified sender, as "address" or "Name <address>". */
  from: string;
}
export interface CaptureSettings {
  transport: "capture";
  from: string;
}
export type EmailSettings = SesSettings | CaptureSettings;

type Source = Record<string, string | undefined>;

const REGION = /^[a-z]{2}(-[a-z]+)+-\d$/;
const ACCESS_KEY = /^[A-Z0-9]{16,128}$/;
const ADDRESS = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const NAMED = /^([^<>"\r\n]{1,80}) <([^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+)>$/;

/** "address" or "Name <address>", on one line. */
export const validSender = (value: string) => value.length <= 200 && (ADDRESS.test(value) || NAMED.test(value));

/** A Worker variable wins; the one created in the dashboard arrives in process.env. */
const pick = (key: string, env: Source, processEnv: Source) => (env[key] || processEnv[key] || "").trim();

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

export function readEmailSettings(env: Source, processEnv: Source, origin: string): EmailSettings | null {
  const from = pick("EMAIL_FROM", env, processEnv);
  const transport = pick("EMAIL_TRANSPORT", env, processEnv);
  if (transport === "capture") {
    let host = "";
    try {
      host = new URL(origin).hostname;
    } catch {
      return null;
    }
    return LOCAL_HOSTS.has(host) ? { transport: "capture", from: from || "capture@127.0.0.1.invalid" } : null;
  }
  const region = pick("AWS_REGION", env, processEnv);
  const accessKeyId = pick("AWS_ACCESS_KEY_ID", env, processEnv);
  const secretAccessKey = pick("AWS_SECRET_ACCESS_KEY", env, processEnv);
  if (!REGION.test(region) || !ACCESS_KEY.test(accessKeyId)) return null;
  if (secretAccessKey.length < 20 || secretAccessKey.length > 128 || /\s/.test(secretAccessKey)) return null;
  if (!validSender(from)) return null;
  return { transport: "ses", region, accessKeyId, secretAccessKey, from };
}
