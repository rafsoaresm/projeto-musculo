import { describe, expect, it } from "vitest";
import {
  AUTOSAVE_DELAY_MS,
  AUTOSAVE_KEY,
  afterFailure,
  readAutosave,
  shouldAutosave,
  storedAutosave,
  type AutosaveState,
} from "@/modules/meu-site/autosave";

const ready: AutosaveState = { enabled: true, canEdit: true, dirty: true, pending: false, stopped: false, refused: null, content: '{"a":1}' };

describe("the draft that saves itself", () => {
  it("saves when the person has changed something, can save and nothing is in the way", () => {
    expect(shouldAutosave(ready)).toBe(true);
  });
  it("does not save when each one of the conditions is missing", () => {
    expect(shouldAutosave({ ...ready, enabled: false }), "turned off").toBe(false);
    expect(shouldAutosave({ ...ready, canEdit: false }), "cannot edit").toBe(false);
    expect(shouldAutosave({ ...ready, dirty: false }), "nothing changed").toBe(false);
    expect(shouldAutosave({ ...ready, pending: true }), "another save is on the way").toBe(false);
    expect(shouldAutosave({ ...ready, stopped: true }), "a conflict was found").toBe(false);
  });
  it("does not send again what the server refused, and sends it when it is not the same any more", () => {
    expect(shouldAutosave({ ...ready, refused: ready.content })).toBe(false);
    expect(shouldAutosave({ ...ready, refused: '{"a":0}' })).toBe(true);
    expect(shouldAutosave({ ...ready, refused: "" })).toBe(true);
  });
  it("waits a few seconds after the last change, not less than two and not more than ten", () => {
    expect(AUTOSAVE_DELAY_MS).toBeGreaterThanOrEqual(2000);
    expect(AUTOSAVE_DELAY_MS).toBeLessThanOrEqual(10_000);
  });
  it("stops for good (until the page is reloaded) after a conflict, and only holds back the same content after any other failure", () => {
    expect(afterFailure("conflict", ready.content)).toEqual({ stopped: true, refused: null });
    expect(afterFailure("error", ready.content)).toEqual({ stopped: false, refused: ready.content });
    // The two together with the rule: an error keeps this content out, a change brings it back; a conflict keeps everything out.
    const error = afterFailure("error", ready.content);
    expect(shouldAutosave({ ...ready, ...error })).toBe(false);
    expect(shouldAutosave({ ...ready, ...error, content: '{"a":2}' })).toBe(true);
    const conflict = afterFailure("conflict", ready.content);
    expect(shouldAutosave({ ...ready, ...conflict, content: '{"a":2}' })).toBe(false);
  });
  it("is on unless the person turned it off, whatever else the browser kept", () => {
    expect(readAutosave(null)).toBe(true);
    expect(readAutosave("on")).toBe(true);
    expect(readAutosave("off")).toBe(false);
    expect(readAutosave("")).toBe(true);
    expect(readAutosave("false")).toBe(true);
    expect(readAutosave(storedAutosave(true))).toBe(true);
    expect(readAutosave(storedAutosave(false))).toBe(false);
    expect(AUTOSAVE_KEY.length).toBeGreaterThan(5);
  });
});
