import { describe, expect, it } from "vitest";
import { PHOTO_VIEW_KEYS } from "@/modules/avaliacoes/photos";
import { POSTURE_VIEW_CODES } from "@/modules/avaliacoes/catalog";
import { POSTURE_PHOTO_VIEWS, photoName, photoOf, recordedPhotoGroups, storedPhotos, withPhoto, withoutPhoto } from "@/modules/avaliacoes/v2/posture-photos";

describe("the photos of the posture of the Avaliação Física (0.83)", () => {
  it("map the three views of the posture onto the four stored views, each exactly once (the lateral view takes both sides)", () => {
    expect(POSTURE_PHOTO_VIEWS).toEqual({ lateral: ["LATERAL_LEFT", "LATERAL_RIGHT"], posterior: ["POSTERIOR"], anterior: ["ANTERIOR"] });
    const all = POSTURE_VIEW_CODES.flatMap((view) => POSTURE_PHOTO_VIEWS[view]);
    expect([...all].sort()).toEqual([...PHOTO_VIEW_KEYS].sort());
    expect(new Set(all).size).toBe(all.length);
    expect(photoName("LATERAL_LEFT")).toBe("Foto lateral esquerda");
  });

  it("keep one photo per view: a new one replaces the old, a removal takes it away, and an erased one is not a photo any more", () => {
    let photos = storedPhotos([
      { view: "ANTERIOR", createdAt: "a", erasedAt: null },
      { view: "POSTERIOR", createdAt: "b", erasedAt: "2026-11-03T00:00:00.000Z" },
    ]);
    expect(photos).toEqual([{ view: "ANTERIOR", stamp: "a" }]);
    photos = withPhoto(photos, "ANTERIOR", "c");
    expect(photos).toEqual([{ view: "ANTERIOR", stamp: "c" }]);
    photos = withPhoto(photos, "LATERAL_RIGHT", "d");
    expect(photoOf(photos, "LATERAL_RIGHT")?.stamp).toBe("d");
    expect(withoutPhoto(photos, "ANTERIOR")).toEqual([{ view: "LATERAL_RIGHT", stamp: "d" }]);
    expect(photoOf(withoutPhoto(photos, "ANTERIOR"), "ANTERIOR")).toBeUndefined();
  });

  it("group a recorded assessment's photos by view of the posture, in the posture's order, leaving out views with none", () => {
    expect(recordedPhotoGroups([{ view: "ANTERIOR" }, { view: "LATERAL_RIGHT" }])).toEqual([
      { view: "lateral", photos: [{ view: "LATERAL_RIGHT" }] },
      { view: "anterior", photos: [{ view: "ANTERIOR" }] },
    ]);
    expect(recordedPhotoGroups([])).toEqual([]);
  });
});
