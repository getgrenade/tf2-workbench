/**
 * The gradients that come with the app (they show in the background picker after the custom one). A gradient made in the picker is
 * saved there for the user; to ship it, "Copy as JSON" in its menu gives the entry to put here (its id is kept, so a scene that used it
 * still finds it).
 */
import type { BackdropPreset } from "./backdropPresets";

/**
 * From grabient.com: each page's swatches reduced to the few colour stops that blend back to them (within 7 of 255 in any channel), so that
 * a gradient is as easy to edit here as it is there. (A radial one is an oval of the picture's shape here, not a circle.)
 */
export const SHIPPED_GRADIENTS: BackdropPreset[] = [
  {
    id: "cool-gray",
    label: "Cool gray",
    backdrop: {
      kind: "gradient", preset: "cool-gray", from: "#48555a", to: "#5c5d6e", angle: 315, glow: "#48555a", glowAmount: 0, vignette: 0, shape: "linear", softness: 0,
      stops: [{ at: 0, color: "#48555a" }, { at: 0.5, color: "#9fb4bb" }, { at: 0.75, color: "#818f9c" }, { at: 1, color: "#5c5d6e" }],
    },
  },
  {
    id: "champagne-wine",
    label: "Champagne and wine",
    backdrop: {
      kind: "gradient", preset: "champagne-wine", from: "#f3eac3", to: "#612f4b", angle: 90, glow: "#f3eac3", glowAmount: 0, vignette: 0, shape: "radial", softness: 0, cx: 0.5, cy: 0.5,
      stops: [{ at: 0, color: "#f3eac3" }, { at: 0.2258, color: "#ebd2a0" }, { at: 0.4194, color: "#d8a883" }, { at: 0.7419, color: "#9d575d" }, { at: 1, color: "#612f4b" }],
    },
  },
  {
    id: "tan-mauve",
    label: "Tan and mauve",
    backdrop: {
      kind: "gradient", preset: "tan-mauve", from: "#a08a7b", to: "#332234", angle: 90, glow: "#a08a7b", glowAmount: 0, vignette: 0, shape: "linear", softness: 0,
      stops: [{ at: 0, color: "#a08a7b" }, { at: 0.4194, color: "#856066" }, { at: 1, color: "#332234" }],
    },
  },
  {
    id: "peach-tan",
    label: "Peach and tan",
    backdrop: {
      kind: "gradient", preset: "peach-tan", from: "#6f645f", to: "#a49884", angle: 225, glow: "#6f645f", glowAmount: 0, vignette: 0, shape: "linear", softness: 0,
      stops: [{ at: 0, color: "#6f645f" }, { at: 0.6129, color: "#dfcbae" }, { at: 0.7419, color: "#d8c8aa" }, { at: 1, color: "#a49884" }],
    },
  },
  {
    id: "black-blue",
    label: "Black and blue",
    backdrop: {
      kind: "gradient", preset: "black-blue", from: "#0b0000", to: "#a9a6b5", angle: 270, glow: "#0b0000", glowAmount: 0, vignette: 0, shape: "linear", softness: 0,
      stops: [{ at: 0, color: "#0b0000" }, { at: 0.1935, color: "#1f010c" }, { at: 0.4516, color: "#413a6d" }, { at: 0.6774, color: "#696ca1" }, { at: 1, color: "#a9a6b5" }],
    },
  },
  {
    id: "black-gray",
    label: "Black to gray",
    backdrop: {
      kind: "gradient", preset: "black-gray", from: "#07080c", to: "#303136", angle: 90, glow: "#07080c", glowAmount: 0, vignette: 0, shape: "linear", softness: 0,
      stops: [{ at: 0, color: "#07080c" }, { at: 1, color: "#303136" }],
    },
  },
];
