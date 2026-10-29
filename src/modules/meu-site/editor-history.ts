import type { SiteContent } from "./contracts";

/**
 * Undo and redo of the document being edited. Every change is a snapshot of the whole document (it is small,
 * at most 60 KB). Typing in one field is many changes in a row: the ones with the same `key`, close in time,
 * are a single step, so undoing takes back the whole word and not a letter.
 */
export const HISTORY_LIMIT = 75;
export const COALESCE_MS = 1200;
/**
 * A key that starts with this is one gesture (a handle dragged on the page): everything with that key is a single step, however long the pointer
 * rests in the middle of it. Other keys (typing) are a step only while the changes keep coming.
 */
export const GESTURE_PREFIX = "gesture:";

export interface History {
  past: SiteContent[];
  present: SiteContent;
  future: SiteContent[];
  lastKey: string | null;
  lastAt: number;
}

export type HistoryAction =
  | { type: "edit"; content: SiteContent; at: number; key?: string }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "replace"; content: SiteContent };

export const startHistory = (content: SiteContent): History => ({ past: [], present: content, future: [], lastKey: null, lastAt: 0 });

export function historyReducer(state: History, action: HistoryAction): History {
  switch (action.type) {
    case "edit": {
      if (action.content === state.present) return state;
      const joins = action.key !== undefined && action.key === state.lastKey && (action.key.startsWith(GESTURE_PREFIX) || action.at - state.lastAt < COALESCE_MS);
      if (joins) return { ...state, present: action.content, future: [], lastAt: action.at };
      const past = [...state.past, state.present];
      if (past.length > HISTORY_LIMIT) past.shift();
      return { past, present: action.content, future: [], lastKey: action.key ?? null, lastAt: action.at };
    }
    case "undo": {
      if (state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1];
      return { past: state.past.slice(0, -1), present: previous, future: [state.present, ...state.future], lastKey: null, lastAt: 0 };
    }
    case "redo": {
      if (state.future.length === 0) return state;
      const [next, ...rest] = state.future;
      return { past: [...state.past, state.present], present: next, future: rest, lastKey: null, lastAt: 0 };
    }
    case "replace":
      // A version brought back from the server: what came before is not undone into it.
      return startHistory(action.content);
  }
}
