import { z } from "zod";

/**
 * Exercise library rules shared by the screens and the repository. Categories
 * are the groups of the original master document's seed (section 50); nothing
 * here adds muscles, equipment or progressions that the document does not give.
 */
export const CATEGORIES = [
  "Agachar",
  "Empurrar",
  "Puxar",
  "Quadril",
  "Unilateral",
  "Core",
  "Cardio",
] as const;
export type Category = (typeof CATEGORIES)[number];

/** SEARCH_LINK is a search results page, never a reviewed video. */
export type VideoStatus = "NONE" | "SEARCH_LINK" | "UNVERIFIED" | "VERIFIED";

// Only providers the project names (YouTube and Vimeo). Any other host needs a
// policy decision first, because these links reach students and PDFs.
const VIDEO_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "vimeo.com",
  "player.vimeo.com",
]);
const VIDEO_URL_MAX = 500;

export function parseVideoUrl(
  raw: string,
): { url: string; searchPage: boolean } | null {
  const text = raw.trim();
  if (!text || text.length > VIDEO_URL_MAX) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !VIDEO_HOSTS.has(url.hostname)
  )
    return null;
  const href = url.toString();
  if (href.length > VIDEO_URL_MAX) return null;
  return {
    url: href,
    searchPage: url.hostname.endsWith("youtube.com") && url.pathname === "/results",
  };
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : null));

export const exerciseInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    category: z.enum(CATEGORIES),
    level: optionalText(40),
    videoUrl: z
      .string()
      .trim()
      .optional()
      .transform((value) => (value ? value : null)),
    /** "I reviewed this video." Counts only when the link is unchanged. */
    videoVerified: z.boolean().default(false),
    notes: optionalText(1000),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.videoUrl && !parseVideoUrl(value.videoUrl))
      context.addIssue({
        code: "custom",
        path: ["videoUrl"],
        message: "VIDEO_URL_INVALID",
      });
  });
export type ExerciseInput = z.output<typeof exerciseInputSchema>;

/**
 * The status follows the link. A search page is never verified, and changing
 * the link always clears a verification: the new video has to be reviewed again.
 */
export function videoStatusFor(
  videoUrl: string | null,
  verifiedRequested: boolean,
  unchangedLink: boolean,
): VideoStatus {
  if (!videoUrl) return "NONE";
  if (parseVideoUrl(videoUrl)?.searchPage) return "SEARCH_LINK";
  return verifiedRequested && unchangedLink ? "VERIFIED" : "UNVERIFIED";
}
