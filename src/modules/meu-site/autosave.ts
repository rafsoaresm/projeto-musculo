/**
 * When the draft saves itself. The rule lives here, outside the screen: a pause in the changes, only for someone who can save, never while
 * another save is on the way, and never again with what the server already refused (a change makes it new). A conflict (someone else saved
 * first) stops it until the page is reloaded, because every later attempt would be refused the same way.
 */
export const AUTOSAVE_DELAY_MS = 3000;
/** The choice is the viewer's, kept in their browser (a convenience: nothing depends on it being there). */
export const AUTOSAVE_KEY = "meu-site-salvar-sozinho";

export const AUTOSAVE_SAVED = "Rascunho salvo automaticamente.";
export const AUTOSAVE_STOPPED = "O salvamento automático fica parado até você atualizar a página.";
export const SAVE_UNREACHABLE = "Não foi possível salvar agora. Confira a conexão e use “Salvar rascunho”: o que você escreveu continua na tela.";

/** On unless the person turned it off: an unknown or missing value is "on". */
export const readAutosave = (stored: string | null): boolean => stored !== "off";
export const storedAutosave = (on: boolean): string => (on ? "on" : "off");

export interface AutosaveState {
  /** The person's choice. */
  enabled: boolean;
  canEdit: boolean;
  /** The screen has something the draft does not. */
  dirty: boolean;
  /** A save or a publication is on the way. */
  pending: boolean;
  /** A conflict was found: someone else saved first. */
  stopped: boolean;
  /** What the last failed attempt sent (the whole document, as text), or none. */
  refused: string | null;
  /** What the screen has now (the whole document, as text). */
  content: string;
}

export function shouldAutosave(state: AutosaveState): boolean {
  return state.enabled && state.canEdit && state.dirty && !state.pending && !state.stopped && state.refused !== state.content;
}

export interface Stand {
  stopped: boolean;
  refused: string | null;
}

/** What a failed save means for the next ones: a conflict stops them; anything else is not repeated for the same content. */
export function afterFailure(status: "conflict" | "error", sent: string): Stand {
  return status === "conflict" ? { stopped: true, refused: null } : { stopped: false, refused: sent };
}
