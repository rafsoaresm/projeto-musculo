"use client";
import { useEffect } from "react";
import { markCheckinRepliesSeen } from "./actions";

/**
 * Once the student has the page with the replies open, they count as seen: the "Nova resposta" marker stays on this screen and leaves
 * the next one. Runs after the page is shown, never on the server render.
 */
export function RepliesSeen({ studentId, pending }: { studentId: string; pending: boolean }) {
  useEffect(() => {
    if (pending) void markCheckinRepliesSeen(studentId).catch(() => undefined);
  }, [studentId, pending]);
  return null;
}
