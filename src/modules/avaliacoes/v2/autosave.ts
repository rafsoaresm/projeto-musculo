/**
 * When the draft of the new-format assessment saves itself. The rule lives here, outside the screen, in the same shape as the site editor's
 * (src/modules/meu-site/autosave.ts): a pause in the typing, or leaving a step, saves what changed; the button always tries. Never two saves at
 * once: what is asked while one is on the way waits, and only the latest content goes after it. Never again with what was refused (an invalid
 * value, a failure): a change makes it new. A conflict (someone else saved first) stops it until the page is reloaded, because every later
 * attempt would be refused the same way.
 */

/** The pause after the last keystroke. */
export const DRAFT_AUTOSAVE_DELAY_MS = 1800;

/** Follows the conflict message of the server ("… Recarregue para ver a versão atual."), so it does not repeat the instruction. */
export const AUTOSAVE_STOPPED = "Até lá, o salvamento automático fica parado.";
export const SAVE_UNREACHABLE = "Não foi possível salvar agora. Confira a conexão e tente “Salvar rascunho”: o que você digitou continua na tela.";

/** What asks for a save: the pause in the typing, leaving a step, or the "Salvar rascunho" button. */
export type SaveTrigger = "pause" | "step" | "button";
/** Send now, wait for the save on the way (and send the latest after it), or nothing. */
export type SaveDecision = "save" | "queue" | "skip";

export interface DraftAutosaveState {
  /** The screen has something the draft does not. */
  dirty: boolean;
  /** A save is on the way. */
  inFlight: boolean;
  /** A conflict was found: someone else saved first. */
  stopped: boolean;
  /** What the last refused attempt had (the whole screen, as text), or none. */
  refused: string | null;
  /** What the screen has now (the whole screen, as text). */
  content: string;
}

export function decideSave(state: DraftAutosaveState, trigger: SaveTrigger): SaveDecision {
  if (state.stopped) return "skip";
  if (trigger === "button") return state.inFlight ? "queue" : "save";
  if (!state.dirty || state.refused === state.content) return "skip";
  return state.inFlight ? "queue" : "save";
}

/** The pause timer runs only while a pause would do something. */
export const autosaveArmed = (state: DraftAutosaveState): boolean => decideSave(state, "pause") !== "skip";

export type SaveOutcome = "saved" | "conflict" | "invalid" | "error";

export interface SaveStand {
  stopped: boolean;
  refused: string | null;
}

/** What an answer means for the next saves: a conflict stops them; an invalid value or a failure is not repeated for the same content. */
export function afterSave(outcome: SaveOutcome, sent: string): SaveStand {
  if (outcome === "saved") return { stopped: false, refused: null };
  if (outcome === "conflict") return { stopped: true, refused: null };
  return { stopped: false, refused: sent };
}

/** After a save comes back: the one that waited goes only when nothing stopped it and the screen still differs from what is stored. */
export function runQueued(queued: boolean, stand: SaveStand, dirty: boolean): boolean {
  return queued && !stand.stopped && dirty;
}

/** "Salvo às 14:05." in the viewer's own clock (the zone is a parameter for the tests). */
export function savedAtLabel(at: Date, timeZone?: string): string {
  const time = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(at);
  return `Salvo às ${time}.`;
}
