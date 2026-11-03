"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SaveSectionResult } from "./actions";
import {
  AUTOSAVE_STOPPED,
  DRAFT_AUTOSAVE_DELAY_MS,
  SAVE_UNREACHABLE,
  afterSave,
  autosaveArmed,
  decideSave,
  runQueued,
  type SaveOutcome,
  type SaveStand,
  type SaveTrigger,
} from "./autosave";

/**
 * One module of the draft as the screen has it: its content as text (to know what changed), how to read it into the payload the server accepts
 * (or the problem to show), and how to send it against a revision. The revision is the assessment's, shared by its modules.
 */
export interface DraftModule {
  content: string;
  read: () => { payload: unknown } | { problem: string };
  send: (payload: unknown, revision: number) => Promise<SaveSectionResult>;
}

/**
 * The quiet line (read politely by a screen reader): where the draft stands, or a value the pause or the step change found invalid — the person
 * may still be typing it, so it never interrupts.
 */
export type DraftStatus =
  | { kind: "clean" }
  | { kind: "dirty" }
  | { kind: "saving" }
  | { kind: "saved"; at: Date }
  | { kind: "problem"; text: string };

/**
 * `loud`: said as an alert (a conflict, a failure, or a problem found by the button); otherwise on the quiet line. An error belongs to the content
 * it was found in: a change takes it away.
 */
type Answer = { kind: "saved"; at: Date } | { kind: "conflict"; text: string } | { kind: "error"; text: string; content: string; loud: boolean } | null;

const joined = (modules: Record<string, DraftModule>) => JSON.stringify(Object.keys(modules).map((key) => [key, modules[key].content]));

/**
 * The draft that saves itself (rule in autosave.ts): a pause in the typing, leaving a step and the button all go through `request`, which never
 * starts a second save while one is on the way — it waits, and the latest content goes after it. Each module that changed is sent in turn, with the
 * revision the previous answer gave.
 */
export function useDraftAutosave(initialRevision: number, modules: Record<string, DraftModule>) {
  const [saved, setSaved] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(modules).map(([key, part]) => [key, part.content])));
  const [inFlight, setInFlight] = useState(false);
  const [stand, setStand] = useState<SaveStand>({ stopped: false, refused: null });
  const [answer, setAnswer] = useState<Answer>(null);

  const content = joined(modules);
  const dirty = Object.keys(modules).some((key) => modules[key].content !== saved[key]);

  // What the save on the way reads: always the latest, never the closure of the render that started it.
  const latest = useRef({ modules, saved, stand, content });
  const revision = useRef(initialRevision);
  const busy = useRef(false);
  const queued = useRef<SaveTrigger | null>(null);
  const halted = useRef(false);
  useEffect(() => {
    latest.current = { modules, saved, stand, content };
  });

  const request = useCallback(async function request(trigger: SaveTrigger, only?: string): Promise<void> {
    if (halted.current) return;
    const now = latest.current;
    const changed = Object.keys(now.modules).filter((key) => now.modules[key].content !== now.saved[key]);
    const decision = decideSave({ dirty: changed.length > 0, inFlight: busy.current, stopped: now.stand.stopped, refused: now.stand.refused, content: now.content }, trigger);
    if (decision === "skip") return;
    if (decision === "queue") {
      // The button wins over a pause: what waits keeps the strongest reason.
      if (queued.current !== "button") queued.current = trigger;
      return;
    }
    // The button with nothing changed still sends the step on screen, as before the draft saved itself.
    const keys = changed.length > 0 ? changed : only ? [only] : [];
    if (keys.length === 0) return;
    busy.current = true;
    setInFlight(true);
    const sentContent = now.content;
    let outcome: SaveOutcome = "saved";
    const stored: Record<string, string> = {};
    for (const key of keys) {
      const part = now.modules[key];
      const read = part.read();
      if ("problem" in read) {
        outcome = "invalid";
        setAnswer({ kind: "error", text: read.problem, content: sentContent, loud: trigger === "button" });
        break;
      }
      let result: SaveSectionResult;
      try {
        result = await part.send(read.payload, revision.current);
      } catch {
        result = { error: SAVE_UNREACHABLE };
      }
      if ("saved" in result) {
        revision.current = result.revision;
        stored[key] = part.content;
        continue;
      }
      if ("conflict" in result) {
        outcome = "conflict";
        setAnswer({ kind: "conflict", text: `${result.conflict} ${AUTOSAVE_STOPPED}` });
      } else {
        outcome = "error";
        setAnswer({ kind: "error", text: result.error, content: sentContent, loud: true });
      }
      break;
    }
    const nextSaved = { ...latest.current.saved, ...stored };
    setSaved(nextSaved);
    latest.current = { ...latest.current, saved: nextSaved };
    const next = afterSave(outcome, sentContent);
    setStand(next);
    latest.current.stand = next;
    if (outcome === "saved") setAnswer({ kind: "saved", at: new Date() });
    busy.current = false;
    setInFlight(false);
    const waiting = queued.current;
    queued.current = null;
    const stillDirty = Object.keys(latest.current.modules).some((key) => latest.current.modules[key].content !== nextSaved[key]);
    if (waiting && runQueued(true, next, stillDirty)) void request(waiting === "button" ? "pause" : waiting);
  }, []);

  // The pause: the timer starts again with every change, and runs only while a pause would do something.
  const armed = autosaveArmed({ dirty, inFlight, stopped: stand.stopped, refused: stand.refused, content });
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => void request("pause"), DRAFT_AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [armed, content, request]);

  const currentError = answer?.kind === "error" && answer.content === content ? answer : null;
  let status: DraftStatus;
  if (inFlight) status = { kind: "saving" };
  else if (currentError && !currentError.loud) status = { kind: "problem", text: currentError.text };
  else if (dirty) status = { kind: "dirty" };
  else if (answer?.kind === "saved") status = answer;
  else status = { kind: "clean" };

  const alert = answer?.kind === "conflict" ? answer.text : currentError?.loud ? currentError.text : null;

  return {
    status,
    /** What must be said at once: the conflict (it stays until the page is reloaded), or a failure or problem of the current content. */
    alert,
    /** Something on the screen is not stored yet (or is on the way). */
    unsaved: dirty || inFlight,
    inFlight,
    stopped: stand.stopped,
    request,
    /** No more saves from this screen (the draft is being discarded). */
    halt: () => {
      halted.current = true;
    },
    resume: () => {
      halted.current = false;
    },
  };
}
