import { z } from "zod";
import { parseVideoUrl } from "@/modules/biblioteca/contracts";

/**
 * A prescribed exercise is the professional's own record: sets, reps, load,
 * cadence and rest are free short text, so ranges and strategies ("3-4",
 * "8-12", "até a falha técnica") fit without the code deciding what is valid
 * training. Nothing here supplies a default dose or a preset.
 */
export const MAX_PER_WORKOUT = 30;

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));
const whole = (min: number, max: number) =>
  z.number().int().min(min).max(max).nullish().transform((value) => value ?? null);

export const itemFieldsSchema = z
  .object({
    sets: text(20),
    reps: text(40),
    loadInstruction: text(120),
    cadence: text(40),
    restSeconds: whole(0, 3600),
    restText: text(40),
    rirMin: whole(0, 10),
    rirMax: whole(0, 10),
    /** Overrides the video of this prescription only, never the library's. */
    videoUrl: text(500),
    notes: text(500),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.videoUrl && !parseVideoUrl(value.videoUrl))
      context.addIssue({ code: "custom", path: ["videoUrl"], message: "VIDEO_URL_INVALID" });
    if (
      value.rirMin !== null &&
      value.rirMax !== null &&
      value.rirMin > value.rirMax
    )
      context.addIssue({ code: "custom", path: ["rirMin"], message: "RIR_RANGE_INVALID" });
  });
export type ItemFields = z.output<typeof itemFieldsSchema>;

/** A name for an exercise that is not from the library. */
export const customNameSchema = z.string().trim().min(1).max(120);

export const emptyFields: ItemFields = {
  sets: null,
  reps: null,
  loadInstruction: null,
  cadence: null,
  restSeconds: null,
  restText: null,
  rirMin: null,
  rirMax: null,
  videoUrl: null,
  notes: null,
};
