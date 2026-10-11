/** The effects of the post-processing panel: a list in which an effect can be there several times. */

/** The look effects (see look.ts), which the list holds once at most. */
export const LOOK_KINDS = [
  "reflection",
  "dof", "motionBlur", "bloom", "distortion", "aberration",
  "grade", "duotone", "posterise",
  "vignette", "grain", "leaks", "dust",
  "pixelate", "scanlines", "dither",
] as const;
export type LookKind = (typeof LOOK_KINDS)[number];

export type PostKind = "shadow" | "fog" | "rim" | "ao" | LookKind;

/** What the panel offers: a name, and how many of an effect can be in the scene at once (what the renderer can lay over each other). */
export const POST_KINDS: Record<PostKind, { label: string; max: number }> = {
  shadow: { label: "Ground shadows", max: 3 },
  fog: { label: "Fog", max: 3 },
  rim: { label: "Fresnel rim light", max: 4 },
  ao: { label: "Ambient occlusion", max: 1 },
  dof: { label: "Depth of field", max: 1 },
  motionBlur: { label: "Motion blur", max: 1 },
  bloom: { label: "Bloom", max: 1 },
  distortion: { label: "Lens distortion", max: 1 },
  aberration: { label: "Chromatic aberration", max: 1 },
  grade: { label: "Colour grading", max: 1 },
  duotone: { label: "Duotone", max: 1 },
  posterise: { label: "Posterise", max: 1 },
  vignette: { label: "Vignette", max: 1 },
  grain: { label: "Film grain", max: 1 },
  leaks: { label: "Light leaks", max: 1 },
  dust: { label: "Dust", max: 1 },
  reflection: { label: "Floor reflection", max: 1 },
  pixelate: { label: "Pixelate", max: 1 },
  scanlines: { label: "Scanlines", max: 1 },
  dither: { label: "Dithering", max: 1 },
};

/** The groups of the Add menu (a line is drawn between them). */
export const POST_GROUPS: PostKind[][] = [
  ["shadow", "fog", "rim", "ao", "reflection"],
  ["dof", "motionBlur", "bloom", "distortion", "aberration"],
  ["grade", "duotone", "posterise"],
  ["vignette", "grain", "leaks", "dust"],
  ["pixelate", "scanlines", "dither"],
];

export const POST_KIND_ORDER: PostKind[] = POST_GROUPS.flat();

export interface PostItem {
  id: string;
  kind: PostKind;
  /** The settings of the effect (they all have `enabled`). */
  state: { enabled: boolean; [key: string]: unknown };
}

export const countOf = (items: readonly PostItem[], kind: PostKind) => items.filter((i) => i.kind === kind).length;

export const canAdd = (items: readonly PostItem[], kind: PostKind) => countOf(items, kind) < POST_KINDS[kind].max;

/** An id that no item has. */
export function newPostId(items: readonly PostItem[]): string {
  let n = items.length + 1;
  while (items.some((i) => i.id === `post-${n}`)) n++;
  return `post-${n}`;
}

/** The name of an item in the list: "Fog", and "Fog 2" for the second one. */
export function postLabel(items: readonly PostItem[], item: PostItem): string {
  const name = POST_KINDS[item.kind].label;
  if (countOf(items, item.kind) < 2) return name;
  return `${name} ${items.filter((i) => i.kind === item.kind).indexOf(item) + 1}`;
}

/** The settings of the items of a kind that are on, in the order of the list. */
export const statesOf = <S>(items: readonly PostItem[], kind: PostKind) => items.filter((i) => i.kind === kind).map((i) => i.state as unknown as S);
