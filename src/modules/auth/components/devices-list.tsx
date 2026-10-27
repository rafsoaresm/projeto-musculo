"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { disconnectDevice } from "../device-actions";

export interface DeviceView {
  id: string;
  label: string;
  isCurrent: boolean;
  /** Already written for the person (Brasília time): the server formats, so the page does not differ on hydration. */
  enteredAt: string;
  validUntil: string;
}

/**
 * The devices of the person. One click disconnects another one: it only has to sign in again, so there is
 * nothing to confirm. The answer is kept here, not in the row, because the row goes away with the device.
 */
export function DevicesList({ devices }: { devices: DeviceView[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  async function disconnect(device: DeviceView) {
    setPendingId(device.id);
    setMessage("");
    try {
      const result = await disconnectDevice(device.id);
      setMessage(result.message);
      setFailed(result.outcome === "error");
    } catch {
      setMessage("Não foi possível desconectar. Tente novamente.");
      setFailed(true);
    } finally {
      setPendingId(null);
      router.refresh();
    }
  }

  return (
    <>
      <ul className="device-list" aria-label="Aparelhos conectados">
        {devices.map((device) => (
          <li key={device.id}>
            <span className="device-name">
              <strong>{device.label}</strong>
              {device.isCurrent && <span className="pill brand">Este aparelho</span>}
              <span className="small muted">
                Entrou em {device.enteredAt}. Vale até {device.validUntil}, e a data se renova quando o aparelho é
                usado.
              </span>
            </span>
            {!device.isCurrent && (
              <button
                type="button"
                className="button small secondary"
                disabled={pendingId !== null}
                onClick={() => disconnect(device)}
                aria-label={`Desconectar ${device.label}, que entrou em ${device.enteredAt}`}
              >
                {pendingId === device.id ? "Aguarde…" : "Desconectar"}
              </button>
            )}
          </li>
        ))}
      </ul>
      {message && (
        <p role={failed ? "alert" : "status"} className={failed ? "form-error" : "small muted"}>
          {message}
        </p>
      )}
    </>
  );
}
