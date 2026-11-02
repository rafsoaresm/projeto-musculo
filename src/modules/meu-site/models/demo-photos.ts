/**
 * The sample photos of the site models (Figma "Templates de Sites — CMS V1", page "00 · Assets fotográficos"): pictures made for the models,
 * of people who are not the professional. They are files of the app (public/site-models), shown while the site is being made (the editor, its
 * preview, "Ver o modelo") so the site starts with the model's look; the published page never shows them (handoff §8: demonstration material,
 * to be replaced), and the publication says which are left. A photo of the person's own library takes their place.
 */
export const DEMO_PHOTOS = {
  "trainix-hero": { file: "trainix-hero.webp", width: 1536, height: 864 },
  "trainix-foto": { file: "trainix-foto.webp", width: 1536, height: 864 },
  "fitnova-hero": { file: "fitnova-hero.webp", width: 1536, height: 864 },
  "fitnova-foto": { file: "fitnova-foto.webp", width: 1536, height: 864 },
  "sisphus-hero": { file: "sisphus-hero.webp", width: 1536, height: 864 },
  "sisphus-foto": { file: "sisphus-foto.webp", width: 1536, height: 864 },
  "race-hero": { file: "race-hero.webp", width: 1536, height: 864 },
  "race-foto": { file: "race-foto.webp", width: 1536, height: 864 },
  "race-coach-1": { file: "race-coach-1.webp", width: 1024, height: 1024 },
  "race-coach-2": { file: "race-coach-2.webp", width: 1024, height: 1024 },
  "race-coach-3": { file: "race-coach-3.webp", width: 1024, height: 1024 },
} as const;
export type DemoPhoto = keyof typeof DEMO_PHOTOS;
export const DEMO_PHOTO_KEYS = Object.keys(DEMO_PHOTOS) as [DemoPhoto, ...DemoPhoto[]];
/** A background image of a style that is a sample photo: `modelo:<key>` in place of an id of the library. */
export const DEMO_PREFIX = "modelo:";
export const demoKeyOf = (value: string): DemoPhoto | null => {
  if (!value.startsWith(DEMO_PREFIX)) return null;
  const key = value.slice(DEMO_PREFIX.length);
  return key in DEMO_PHOTOS ? (key as DemoPhoto) : null;
};
/** Where the photo is, from the folder of the app's files (`<mount>/site-models/`). */
export const demoPhotoUrl = (folder: string, key: DemoPhoto) => `${folder}${DEMO_PHOTOS[key].file}`;
