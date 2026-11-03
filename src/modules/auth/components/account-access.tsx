import { requireIdentity } from "../server";
import { accountAccessFor } from "@/db/account-access";
import { SIGN_IN_FAILURE_LABEL, recentSignInFailures } from "@/db/sign-in-failures";
import { formatDateTime } from "@/components/ui";
import { DevicesList } from "./devices-list";

/**
 * Where the account is open, the latest sign-ins and the latest failed ones (0.88), for the person of the verified session. Shown in
 * "Minha conta" of the three areas.
 */
export async function AccountAccess() {
  const { db, user, sessionId } = await requireIdentity();
  const access = accountAccessFor(db, user.id, sessionId);
  const [devices, recent, failures] = await Promise.all([access.devices(), access.recentSignIns(), recentSignInFailures(db, user.id)]);
  return (
    <section className="panel" aria-labelledby="aparelhos-conta">
      <p className="eyebrow">SEGURANÇA</p>
      <h2 id="aparelhos-conta">Aparelhos conectados</h2>
      <p className="muted">
        Onde a sua conta está aberta agora. Se algum não for seu, desconecte-o e troque a senha.
      </p>
      <DevicesList
        devices={devices.map((device) => ({
          id: device.id,
          label: device.label,
          isCurrent: device.isCurrent,
          enteredAt: formatDateTime(device.enteredAt),
          validUntil: formatDateTime(device.expiresAt),
        }))}
      />
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
      <h3 className="account-subheading">Tentativas de entrada que falharam</h3>
      {failures.length === 0 ? (
        <p className="small muted">Nenhuma tentativa falha registrada. A lista começa nas tentativas feitas depois desta atualização.</p>
      ) : (
        <>
          <p className="small muted">
            As últimas vezes em que alguém errou a senha deste e-mail ou o código da verificação em duas etapas. Se não foi você, troque a
            senha.
          </p>
          <ul className="sign-in-list" aria-label="Tentativas de entrada que falharam">
            {failures.map((failure, index) => (
              <li key={`${failure.at}-${index}`}>
                {formatDateTime(failure.at)} · {SIGN_IN_FAILURE_LABEL[failure.reason]}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
