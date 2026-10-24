import type { Tone } from "@/components/ui";
import type { VideoStatus } from "./contracts";

/** A search page must never read like a reviewed video. */
export function videoLabel(status: VideoStatus): { text: string; tone: Tone } {
  switch (status) {
    case "SEARCH_LINK":
      return { text: "Link de busca, não é vídeo revisado", tone: "warning" };
    case "UNVERIFIED":
      return { text: "Vídeo ainda não revisado", tone: "neutral" };
    case "VERIFIED":
      return { text: "Vídeo revisado", tone: "success" };
    default:
      return { text: "Sem vídeo", tone: "neutral" };
  }
}
