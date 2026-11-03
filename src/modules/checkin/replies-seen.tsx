"use client";
import { useEffect } from "react";
import { markCheckinRepliesSeen } from "./actions";

/**
 * Once the student has the page with the replies open, they count as seen: the "Nova resposta" marker stays on this screen and leaves
 * the next one. Runs after the page is shown, never on the server render. `upTo` is the newest reply this page showed: a reply that
 * arrives after the render is not marked as seen.
 */
export function RepliesSeen({ studentId, upTo }: { studentId: string; upTo: string | null }) {
  useEffect(() => {
    if (upTo) void markCheckinRepliesSeen(studentId, upTo).catch(() => undefined);
  }, [studentId, upTo]);
  return null;
}
