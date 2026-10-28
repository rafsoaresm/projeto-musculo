import "server-only";
import type { R2Bucket } from "@cloudflare/workers-types";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { photosOpen, photosSwitch } from "@/modules/avaliacoes/photos";

/** Resolve the managed Webflow Cloud binding inside the current request. */
export async function getDatabase() {
  const { env } = await getCloudflareContext({ async: true });
  if (!env.DB) throw new Error("DATABASE_BINDING_UNAVAILABLE");
  return env.DB;
}

const photoStorageOpen = (env: CloudflareEnv) =>
  photosOpen({ PHOTOS: env.PHOTOS, PHOTOS_ENABLED: photosSwitch(env, process.env) });

/** The private photo bucket of this request, or an error when the storage is not provisioned or not opened. */
export async function getPhotoBucket() {
  const { env } = await getCloudflareContext({ async: true });
  if (!env.PHOTOS || !photoStorageOpen(env)) throw new Error("PHOTO_STORAGE_UNAVAILABLE");
  return env.PHOTOS;
}

/** Whether the photo storage is provisioned and opened in this environment. Never throws. */
export async function photoStorageAvailable(): Promise<boolean> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    return photoStorageOpen(env);
  } catch {
    return false;
  }
}

/** The bucket of the images of the public page, or null where it is not provisioned. Never throws. */
export async function getSiteMediaBucket(): Promise<R2Bucket | null> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    return env.SITE_MEDIA ?? null;
  } catch {
    return null;
  }
}

/**
 * The photo bucket binding, whether or not new photos are being accepted. Erasing photos on request
 * has to work even when the photos were closed again. Null when the bucket is not provisioned.
 */
export async function getPhotoBucketBinding() {
  const { env } = await getCloudflareContext({ async: true });
  return env.PHOTOS ?? null;
}
