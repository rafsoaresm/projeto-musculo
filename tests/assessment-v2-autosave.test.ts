import { describe, expect, it } from "vitest";
import {
  AUTOSAVE_STOPPED,
  DRAFT_AUTOSAVE_DELAY_MS,
  afterSave,
  autosaveArmed,
  decideSave,
  runQueued,
  savedAtLabel,
  type DraftAutosaveState,
} from "@/modules/avaliacoes/v2/autosave";

const ready: DraftAutosaveState = { dirty: true, inFlight: false, stopped: false, refused: null, content: '{"weight":"69,1"}' };

describe("the assessment draft that saves itself", () => {
  it("saves after a pause and when leaving a step, when something changed and nothing is in the way", () => {
    expect(decideSave(ready, "pause")).toBe("save");
    expect(decideSave(ready, "step")).toBe("save");
    expect(autosaveArmed(ready)).toBe(true);
  });

  it("does nothing by itself when nothing changed, but the button still sends", () => {
    const clean = { ...ready, dirty: false };
    expect(decideSave(clean, "pause")).toBe("skip");
    expect(decideSave(clean, "step")).toBe("skip");
    expect(autosaveArmed(clean)).toBe(false);
    expect(decideSave(clean, "button")).toBe("save");
  });

  it("never starts a second save while one is on the way: it waits, for the pause, the step and the button", () => {
    const busy = { ...ready, inFlight: true };
    expect(decideSave(busy, "pause")).toBe("queue");
    expect(decideSave(busy, "step")).toBe("queue");
    expect(decideSave(busy, "button")).toBe("queue");
    // Nothing changed since: a pause does not even wait.
    expect(decideSave({ ...busy, dirty: false }, "pause")).toBe("skip");
  });

  it("the one that waited goes after the answer only if the screen still differs and nothing stopped it", () => {
    const saved = afterSave("saved", ready.content);
    expect(runQueued(true, saved, true)).toBe(true);
    expect(runQueued(true, saved, false)).toBe(false);
    expect(runQueued(false, saved, true)).toBe(false);
    expect(runQueued(true, afterSave("conflict", ready.content), true)).toBe(false);
  });

  it("does not send again by itself what was refused (an invalid value, a failure); a change makes it new, the button tries again", () => {
    for (const outcome of ["invalid", "error"] as const) {
      const stand = afterSave(outcome, ready.content);
      expect(stand).toEqual({ stopped: false, refused: ready.content });
      expect(decideSave({ ...ready, ...stand }, "pause"), outcome).toBe("skip");
      expect(decideSave({ ...ready, ...stand }, "step"), outcome).toBe("skip");
      expect(decideSave({ ...ready, ...stand }, "button"), outcome).toBe("save");
      expect(decideSave({ ...ready, ...stand, content: '{"weight":"69,2"}' }, "pause"), outcome).toBe("save");
    }
  });

  it("stops for good after a conflict (until the page is reloaded), whatever asks, and says so", () => {
    const stand = afterSave("conflict", ready.content);
    expect(stand).toEqual({ stopped: true, refused: null });
    for (const trigger of ["pause", "step", "button"] as const) {
      expect(decideSave({ ...ready, ...stand, content: '{"weight":"70"}' }, trigger), trigger).toBe("skip");
    }
    expect(autosaveArmed({ ...ready, ...stand })).toBe(false);
    expect(AUTOSAVE_STOPPED).toBe("Até lá, o salvamento automático fica parado.");
  });

  it("a save clears what was refused", () => {
    expect(afterSave("saved", ready.content)).toEqual({ stopped: false, refused: null });
  });

  it("waits a short pause: between one and a half and two seconds", () => {
    expect(DRAFT_AUTOSAVE_DELAY_MS).toBeGreaterThanOrEqual(1500);
    expect(DRAFT_AUTOSAVE_DELAY_MS).toBeLessThanOrEqual(2000);
  });

  it("says the time of the last save in hours and minutes of the viewer's clock", () => {
    const at = new Date("2026-11-03T17:05:09Z");
    expect(savedAtLabel(at, "America/Sao_Paulo")).toBe("Salvo às 14:05.");
    expect(savedAtLabel(at, "UTC")).toBe("Salvo às 17:05.");
    expect(savedAtLabel(new Date("2026-11-03T03:00:00Z"), "UTC")).toBe("Salvo às 03:00.");
  });
});
