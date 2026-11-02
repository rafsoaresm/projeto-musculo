/**
 * The bricks of the site models (handoff "Templates de Sites — CMS V1"): plain nodes of the document (boxes, titles, texts, buttons, images)
 * with the typed styles of the page, so a model is an ordinary site that the Editor Guiado and the visual editor edit like any other. Every text
 * of a model is a node of its own (never part of a photo).
 *
 * `say(mode, text, hint)`: what only the person can say (a number, a price, a name, a biography, a testimony) is written only in "Ver o modelo"
 * (mode "preview", the model as the Figma shows it); a site that is created starts with it empty, and the node's name (`hint`) says what goes
 * there. The rest of the copy is generic and starts written in both, for the person to change.
 */
import { emptyBlock, type BlockOf, type BoxNode, type BoxTag, type SiteNode } from "../contracts";
import type { Style } from "../style";
import type { DemoPhoto } from "./demo-photos";
import { DEMO_PREFIX } from "./demo-photos";

export type ModelMode = "preview" | "site";
export interface Sizes {
  tablet?: Style;
  mobile?: Style;
}

/** A fact of the person: written only in the preview of the model; on a created site empty, with its name saying what goes there. */
export const say = (mode: ModelMode, text: string) => (mode === "preview" ? text : "");

const named = (name: string | undefined) => (name ? { name: name.slice(0, 40) } : null);
const sized = (sizes: Sizes | undefined) => ({
  ...(sizes?.tablet ? { styleTablet: sizes.tablet } : null),
  ...(sizes?.mobile ? { styleMobile: sizes.mobile } : null),
});

export const box = (name: string, tag: BoxTag, style: Style, children: SiteNode[], sizes?: Sizes): BoxNode => ({
  ...(emptyBlock("box") as BoxNode),
  ...named(name),
  tag,
  style,
  children,
  ...sized(sizes),
});
export const heading = (text: string, level: 2 | 3 | 4, style: Style, sizes?: Sizes, name?: string): SiteNode =>
  ({ ...emptyBlock("heading"), level, text: text.slice(0, 120), style, ...sized(sizes), ...named(name) }) as SiteNode;
export const paragraph = (text: string, style: Style, sizes?: Sizes, name?: string): SiteNode =>
  ({ ...emptyBlock("paragraph"), text, style, ...sized(sizes), ...named(name) }) as SiteNode;
/** The commercial button of the models: the WhatsApp of the site, green, with its mark (handoff V1.1, component `2:2`). */
export const whatsappButton = (label = "Falar no WhatsApp", style: Style = {}, sizes?: Sizes): SiteNode =>
  ({
    ...emptyBlock("button"),
    label,
    channel: "whatsapp",
    icon: "whatsapp",
    style: {
      background: "whatsapp",
      color: "white",
      radius: "100px",
      padding: { top: "12px", right: "20px", bottom: "12px", left: "20px" },
      fontSize: "15px",
      fontWeight: 600,
      borderWidth: "0px",
      ...style,
    },
    ...sized(sizes),
  }) as SiteNode;
/** A text link to a part of the page (`anchor`), another page (`page`) or a contact (`channel`). */
export const textLink = (label: string, style: Style, to: { anchor?: string; page?: string; channel?: "whatsapp" | "email" | "instagram" } = {}): SiteNode =>
  ({ ...emptyBlock("link"), label, ...to, style }) as SiteNode;
/** A photo: a sample photo of the model while the site is made (never published), until the person chooses one of their own. */
export const photo = (demo: DemoPhoto | undefined, ratio: "16:9" | "4:3" | "3:2" | "4:5" | "3:4" | "1:1" | "auto", style: Style, sizes?: Sizes, name = "Foto"): SiteNode =>
  ({ ...emptyBlock("image"), size: "full", ratio, ...(demo ? { demo } : null), style, ...sized(sizes), ...named(name) }) as SiteNode;
/** A sample photo as a background (`modelo:<key>`): the editors draw it, the published page does not. */
export const demoBackground = (demo: DemoPhoto): Style => ({ bgImage: `${DEMO_PREFIX}${demo}`, bgSize: "cover", bgPosition: "center" });
export const faq = (eyebrow: string, heading: string, questions: string[], answers: string[], style: Style = {}, sizes?: Sizes): SiteNode =>
  ({
    ...(emptyBlock("faq") as BlockOf<"faq">),
    name: "Perguntas frequentes",
    eyebrow,
    heading,
    items: questions.map((question, at) => ({ question, answer: answers[at] ?? "" })),
    style,
    ...sized(sizes),
  }) as SiteNode;
export const sides = (vertical: string, horizontal: string, bottom = vertical, left = horizontal) => ({ top: vertical, right: horizontal, bottom, left });

/**
 * What the WhatsApp buttons of a model do when the site is created (handoff V1.1, `whatsapp`): the handoff's opening message, and the name and
 * the mobile asked first (`requireLeadForm`, on when the site is created; the form only shows where the public forms are open).
 */
export const whatsappCtaOf = () => ({ message: "Olá! Gostaria de conhecer seus treinos.", askFirst: true, askGoal: true });
