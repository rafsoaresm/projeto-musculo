/**
 * The optional photos of the posture (handoff V2 3.3: "Permitir anexar fotos opcionais em cada vista"; PENDENCIAS B48), on an Avaliação Física.
 * They go through the photo storage of the earlier format, unchanged (migration 0011: `assessment_photos`, the private object storage, the
 * authenticated route): one photo per stored view, JPEG only, no metadata, frozen with the recorded assessment, erasable one by one. No consent,
 * authorization or age gate (user's decision of 03/11/2026, migration 0035).
 *
 * The storage knows four views (anterior, lateral esquerda, lateral direita, posterior); the posture of the Avaliação Física has three (lateral,
 * posterior, anterior). The lateral view takes the two sides, each as its own photo, so nothing changes in the database and a recorded photo of
 * either format keeps its meaning. Pure: no screen and no database here.
 */
import type { PostureView } from "../catalog";
import { photoViewLabel, type PhotoView } from "../photos";

/** The stored views of each view of the posture, in the order they are shown. */
export const POSTURE_PHOTO_VIEWS: Record<PostureView, readonly PhotoView[]> = {
  lateral: ["LATERAL_LEFT", "LATERAL_RIGHT"],
  posterior: ["POSTERIOR"],
  anterior: ["ANTERIOR"],
};

/** The name of the photo of a stored view, as the screen says it ("Foto lateral esquerda"). */
export const photoName = (view: PhotoView) => `Foto ${photoViewLabel(view).toLowerCase()}`;

/** What the screen needs of a photo: when it was stored (it changes the address, so a replaced photo is not shown from memory). */
export interface PhotoStamp {
  view: PhotoView;
  stamp: string;
}

/** The photos still stored, by view: an erased one is not a photo any more (its record stays in a recorded assessment only). */
export function storedPhotos(rows: readonly { view: PhotoView; createdAt: string; erasedAt: string | null }[]): PhotoStamp[] {
  return rows.filter((row) => row.erasedAt === null).map((row) => ({ view: row.view, stamp: row.createdAt }));
}

/** The photo of one stored view, or undefined. */
export const photoOf = (photos: readonly PhotoStamp[], view: PhotoView) => photos.find((photo) => photo.view === view);

/** Puts (or replaces) the photo of a view: one per view, so the previous one, if any, goes. */
export function withPhoto(photos: readonly PhotoStamp[], view: PhotoView, stamp: string): PhotoStamp[] {
  return [...photos.filter((photo) => photo.view !== view), { view, stamp }];
}

/** Takes the photo of a view away. */
export const withoutPhoto = (photos: readonly PhotoStamp[], view: PhotoView): PhotoStamp[] => photos.filter((photo) => photo.view !== view);

/** The recorded photos grouped by view of the posture, only the views that have one (stored or erased), in the posture's order. */
export function recordedPhotoGroups<T extends { view: PhotoView }>(rows: readonly T[]): { view: PostureView; photos: T[] }[] {
  return (Object.keys(POSTURE_PHOTO_VIEWS) as PostureView[])
    .map((view) => ({ view, photos: POSTURE_PHOTO_VIEWS[view].flatMap((item) => rows.filter((row) => row.view === item)) }))
    .filter((group) => group.photos.length > 0);
}
