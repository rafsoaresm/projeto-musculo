"use client";
import { useCallback, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import type { PeriodizationInput } from "@/modules/training/contracts";
import { Planner, type PlannerPersistence } from "@/modules/training/components/planner";
import { ApprovalPanel, type ApprovalPanelProps } from "./approval-panel";

/**
 * A draft revision (0.93): the prescription is the main content and comes first; the structure of the cycle is
 * secondary, folded under it, and the strip that approves and delivers comes last (it closes the draft inside that one operation).
 * It waits while the folded structure has changes that are not saved, as the planner did before.
 */
export function DraftWorkspace({
  editor,
  input,
  structureSummary,
  save,
  approval,
}: {
  editor: ReactNode;
  input: PeriodizationInput;
  /** One line about the SAVED structure, shown on the folded header. */
  structureSummary: string;
  save: PlannerPersistence["save"];
  /** The strip that approves and delivers (0.96): the draft is closed inside that one operation. */
  approval: Omit<ApprovalPanelProps, "holdReason" | "state" | "createRevision">;
}) {
  const [dirty, setDirty] = useState(false);
  const [open, setOpen] = useState(false);
  const onDirtyChange = useCallback((value: boolean) => setDirty(value), []);
  return (
    <>
      {editor}
      <details
        className="structure-details"
        open={open}
        onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}
      >
        <summary>
          <span className="structure-summary-text">
            <strong>Estrutura do ciclo</strong>
            <span className="small muted">{structureSummary}</span>
          </span>
          <span className="structure-summary-action">
            {open ? "Recolher" : "Ver e alterar"} <ChevronDown size={18} aria-hidden="true" />
          </span>
        </summary>
        <div className="structure-body">
          <Planner
            initial={input}
            onDirtyChange={onDirtyChange}
            persist={{ saveLabel: "Salvar alterações", save }}
          />
        </div>
      </details>
      <ApprovalPanel
        {...approval}
        state="DRAFT"
        holdReason={dirty ? "Salve as mudanças da estrutura do ciclo antes de aprovar e entregar." : null}
      />
    </>
  );
}
