import { requireIdentity } from "../server";
import { accountAccessFor } from "@/db/account-access";
import { formatDateTime } from "@/components/ui";
import { DisconnectDevice } from "./disconnect-device";

/**
 * Where the account is open and the latest sign-ins, for the person of the verified session. Shown in
 * "Minha conta" of the three areas.
 */
export async function AccountAccess() {
  const { db, user, sessionId } = await requireIdentity();
  const access = accountAccessFor(db, user.id, sessionId);
  const [devices, recent] = await Promise.all([access.devices(), access.recentSignIns()]);
  return (
    <section className="panel" aria-labelledby="aparelhos-conta">
      <p className="eyebrow">SEGURANÇA</p>
      <h2 id="aparelhos-conta">Aparelhos conectados</h2>
      <p className="muted">
        Onde a sua conta está aberta agora. Se algum não for seu, desconecte-o e troque a senha.
      </p>
      <ul className="device-list" aria-label="Aparelhos conectados">
        {devices.map((device) => (
          <li key={device.id}>
            <span className="device-name">
              <strong>{device.label}</strong>
              {device.isCurrent && <span className="pill brand">Este aparelho</span>}
              <span className="small muted">
                Entrou em {formatDateTime(device.enteredAt)}. Vale até {formatDateTime(device.expiresAt)}, e a data se
                renova quando o aparelho é usado.
              </span>
            </span>
            {!device.isCurrent && (
              <DisconnectDevice
                sessionId={device.id}
                label={device.label}
                enteredAt={formatDateTime(device.enteredAt)}
              />
            )}
          </li>
        ))}
      </ul>
      <h3>Entradas recentes</h3>
      {recent.length === 0 ? (
        <p className="small muted">A lista começa na primeira entrada feita depois desta atualização.</p>
      ) : (
        <>
          <p className="small muted">As últimas vezes em que a sua conta foi aberta. Só a data e a hora ficam nesta lista.</p>
          <ul className="sign-in-list" aria-label="Entradas recentes">
            {recent.map((entry, index) => (
              <li key={`${entry}-${index}`}>{formatDateTime(entry)}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
