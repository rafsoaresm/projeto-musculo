"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { encode } from "uqr";
import { useMountPath } from "@/components/use-mount-path";

/**
 * The second step of the sign-in: an authenticator app. Starting it needs the password; it only counts
 * after the person types one code from the app, so a setup that was not finished changes nothing. The
 * ten recovery codes are shown once, at the start: the server keeps them encrypted and cannot show
 * them again. Turning it off and asking for new recovery codes need the password too, and turning it
 * off also needs a recent sign-in. The secret is drawn here, in the browser, as a QR code and as typed
 * text; it goes nowhere else.
 */
type Step = "idle" | "password" | "setup" | "codes" | "off" | "renew";

interface Setup {
  uri: string;
  key: string;
  recovery: string[];
}

/** The QR as one path: a run of dark modules per row, with the quiet zone the standard asks for. */
function QrCode({ uri }: { uri: string }) {
  const { data: cells, size } = encode(uri, { ecc: "M", border: 0 });
  const margin = 4;
  let path = "";
  cells.forEach((row, y) => {
    let x = 0;
    while (x < size) {
      if (!row[x]) {
        x += 1;
        continue;
      }
      let end = x;
      while (end < size && row[end]) end += 1;
      path += `M${x + margin} ${y + margin}h${end - x}v1h-${end - x}z`;
      x = end;
    }
  });
  const total = size + margin * 2;
  return (
    <svg
      className="qr-code"
      viewBox={`0 0 ${total} ${total}`}
      role="img"
      aria-label="Código QR para ler com o aplicativo autenticador"
      shapeRendering="crispEdges"
    >
      <rect width={total} height={total} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}

const groups = (key: string) => key.replace(/(.{4})/g, "$1 ").trim();

export function TwoFactorPanel({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const mountPath = useMountPath();
  const [on, setOn] = useState(enabled);
  const [step, setStep] = useState<Step>("idle");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState<Setup | null>(null);
  const [fresh, setFresh] = useState<string[] | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);

  const say = (text: string, error = false) => {
    setMessage(text);
    setFailed(error);
  };
  async function post(path: string, body: object) {
    const response = await fetch(`${mountPath()}/api/auth/two-factor/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await response.json().catch(() => ({}))) as {
      code?: string;
      totpURI?: string;
      backupCodes?: string[];
    };
    return { response, data };
  }
  function problem(status: number, errorCode?: string) {
    if (status === 401) {
      router.push("/entrar");
      router.refresh();
      return "";
    }
    if (status === 429) return "Muitas tentativas. Aguarde alguns minutos e tente de novo.";
    if (errorCode === "INVALID_PASSWORD") return "A senha não confere.";
    if (errorCode === "SESSION_NOT_FRESH" || status === 403)
      return "Por segurança, isto pede uma entrada recente. Saia, entre de novo e tente outra vez.";
    return "O serviço de acesso não respondeu como esperado. Tente novamente em instantes.";
  }
  const reset = () => {
    setStep("idle");
    setPassword("");
    setCode("");
    setSetup(null);
    setCopied(false);
  };

  async function start(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    say("");
    try {
      const { response, data } = await post("enable", { password });
      if (!response.ok || !data.totpURI || !data.backupCodes) return say(problem(response.status, data.code), true);
      const key = new URL(data.totpURI).searchParams.get("secret") ?? "";
      setSetup({ uri: data.totpURI, key, recovery: data.backupCodes });
      setPassword("");
      setStep("setup");
    } catch {
      say("Não foi possível conectar. Tente novamente.", true);
    } finally {
      setPending(false);
    }
  }

  async function confirm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    say("");
    try {
      const { response, data } = await post("verify-totp", { code: code.replace(/\s/g, "") });
      if (!response.ok)
        return say(
          response.status === 401 && data.code !== "INVALID_TWO_FACTOR_COOKIE"
            ? "Esse código não confere. Confira o aplicativo e digite o código atual, com 6 dígitos."
            : problem(response.status, data.code),
          true,
        );
      setOn(true);
      reset();
      say("Verificação em duas etapas ativada. Daqui em diante, entrar pede a senha e um código do aplicativo.");
      router.refresh();
    } catch {
      say("Não foi possível conectar. Tente novamente.", true);
    } finally {
      setPending(false);
    }
  }

  async function turnOff(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    say("");
    try {
      const { response, data } = await post("disable", { password });
      if (!response.ok) return say(problem(response.status, data.code), true);
      setOn(false);
      reset();
      say("Verificação em duas etapas desativada. Entrar volta a pedir só a senha.");
      router.refresh();
    } catch {
      say("Não foi possível conectar. Tente novamente.", true);
    } finally {
      setPending(false);
    }
  }

  async function renew(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    say("");
    try {
      const { response, data } = await post("generate-backup-codes", { password });
      if (!response.ok || !data.backupCodes) return say(problem(response.status, data.code), true);
      setFresh(data.backupCodes);
      setPassword("");
      setStep("codes");
      say("Estes são os novos códigos. Os anteriores deixaram de valer.");
    } catch {
      say("Não foi possível conectar. Tente novamente.", true);
    } finally {
      setPending(false);
    }
  }

  async function copy(list: string[]) {
    try {
      await navigator.clipboard.writeText(list.join("\n"));
      setCopied(true);
    } catch {
      setCopied(false);
      say("Não foi possível copiar. Selecione os códigos e copie à mão.", true);
    }
  }

  const feedback = message && (
    <p role={failed ? "alert" : "status"} className={failed ? "form-error" : "small muted"}>
      {message}
    </p>
  );
  const passwordField = (
    <label>
      Sua senha
      <input
        type="password"
        autoComplete="current-password"
        value={password}
        maxLength={128}
        required
        onChange={(event) => setPassword(event.target.value)}
      />
    </label>
  );

  if (step === "setup" && setup)
    return (
      <div className="stack-form" aria-label="Configurar a verificação em duas etapas">
        <ol className="two-factor-steps">
          <li>
            <strong>Instale um aplicativo autenticador</strong> no celular (por exemplo o Google Authenticator, o
            Microsoft Authenticator ou o 2FAS).
          </li>
          <li>
            <strong>Leia este QR</strong> com o aplicativo, ou digite a chave no lugar dele.
            <QrCode uri={setup.uri} />
            <p className="small">
              Chave: <code className="two-factor-key">{groups(setup.key)}</code>
            </p>
          </li>
          <li>
            <strong>Guarde os códigos de recuperação.</strong> Cada um vale uma vez e entra no lugar do aplicativo se
            você perder o celular. <strong>Eles não aparecem de novo.</strong> Sem eles e sem o aplicativo, você perde o
            acesso e só um gestor da plataforma consegue redefinir.
            <ul className="two-factor-codes" aria-label="Códigos de recuperação">
              {setup.recovery.map((item) => (
                <li key={item}>
                  <code>{item}</code>
                </li>
              ))}
            </ul>
            <button type="button" className="button secondary small" onClick={() => copy(setup.recovery)}>
              {copied ? "Copiado" : "Copiar os códigos"}
            </button>
          </li>
          <li>
            <strong>Digite o código de 6 dígitos</strong> que o aplicativo mostra agora. Só então a verificação passa a
            valer.
            <form className="stack-form" onSubmit={confirm} aria-label="Confirmar o código">
              <label>
                Código do aplicativo
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9 ]*"
                  maxLength={7}
                  value={code}
                  required
                  onChange={(event) => setCode(event.target.value)}
                />
              </label>
              {feedback}
              <div className="persist-actions">
                <button className="button primary" disabled={pending}>
                  {pending ? "Aguarde…" : "Ativar a verificação"}
                </button>
                <button type="button" className="button secondary" disabled={pending} onClick={() => (reset(), say(""))}>
                  Cancelar
                </button>
              </div>
            </form>
          </li>
        </ol>
      </div>
    );

  if (step === "codes" && fresh)
    return (
      <div className="stack-form" aria-label="Novos códigos de recuperação">
        {feedback}
        <ul className="two-factor-codes" aria-label="Novos códigos de recuperação">
          {fresh.map((item) => (
            <li key={item}>
              <code>{item}</code>
            </li>
          ))}
        </ul>
        <p className="small muted">Cada código vale uma vez. Eles não aparecem de novo.</p>
        <div className="persist-actions">
          <button type="button" className="button secondary small" onClick={() => copy(fresh)}>
            {copied ? "Copiado" : "Copiar os códigos"}
          </button>
          <button type="button" className="button primary" onClick={() => (setFresh(null), reset(), say(""))}>
            Já guardei os códigos
          </button>
        </div>
      </div>
    );

  const askPassword = (action: (event: React.FormEvent<HTMLFormElement>) => void, label: string, name: string, danger = false) => (
    <form className="stack-form" onSubmit={action} aria-label={name}>
      {passwordField}
      {feedback}
      <div className="persist-actions">
        <button className={`button ${danger ? "danger-outline" : "primary"}`} disabled={pending}>
          {pending ? "Aguarde…" : label}
        </button>
        <button type="button" className="button secondary" disabled={pending} onClick={() => (reset(), say(""))}>
          Cancelar
        </button>
      </div>
    </form>
  );

  if (step === "password") return askPassword(start, "Continuar", "Começar a verificação em duas etapas");
  if (step === "off") return askPassword(turnOff, "Desativar", "Desativar a verificação em duas etapas", true);
  if (step === "renew") return askPassword(renew, "Gerar novos códigos", "Gerar novos códigos de recuperação");

  return (
    <div className="stack-form">
      <p>
        {on ? (
          <>
            <strong>Ativada.</strong> Entrar pede a senha e um código do aplicativo autenticador.
          </>
        ) : (
          <>
            <strong>Desativada.</strong> Entrar pede só a senha. Com a verificação em duas etapas, quem descobrir a
            sua senha ainda precisa do seu celular.
          </>
        )}
      </p>
      {feedback}
      <div className="persist-actions">
        {on ? (
          <>
            <button type="button" className="button secondary" onClick={() => (say(""), setStep("renew"))}>
              Gerar novos códigos de recuperação
            </button>
            <button type="button" className="button danger-outline" onClick={() => (say(""), setStep("off"))}>
              Desativar
            </button>
          </>
        ) : (
          <button type="button" className="button primary" onClick={() => (say(""), setStep("password"))}>
            Ativar a verificação em duas etapas
          </button>
        )}
      </div>
    </div>
  );
}
