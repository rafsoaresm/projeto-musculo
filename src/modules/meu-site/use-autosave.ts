"use client";
import { useCallback, useSyncExternalStore } from "react";
import { AUTOSAVE_KEY, readAutosave, storedAutosave } from "./autosave";

const CHANGED = "meu-site-autosave-changed";
/** Where the choice lives when the browser does not keep it (a private window): until the page is closed. */
let memory: boolean | null = null;

function read(): boolean {
  if (memory !== null) return memory;
  try {
    return readAutosave(window.localStorage.getItem(AUTOSAVE_KEY));
  } catch {
    return true;
  }
}
function subscribe(notify: () => void) {
  window.addEventListener("storage", notify);
  window.addEventListener(CHANGED, notify);
  return () => {
    window.removeEventListener("storage", notify);
    window.removeEventListener(CHANGED, notify);
  };
}

/** The person's choice about saving by itself: on unless they turned it off, shared by the tabs of the same browser. */
export function useAutosavePreference(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, read, () => true);
  const set = useCallback((next: boolean) => {
    try {
      window.localStorage.setItem(AUTOSAVE_KEY, storedAutosave(next));
      memory = null;
    } catch {
      memory = next;
    }
    window.dispatchEvent(new Event(CHANGED));
  }, []);
  return [on, set];
}
