/**
 * Promo boards kept between runs of the app: each board is a folder of the app's config folder (`promos/<id>`), with `board.json`
 * (the pictures, their layers and shots, and the set) and the layers' images as PNG files. A board is written a moment after it
 * changes, images only when they are new (a shot taken again), and read back at startup beside the scenes of the last session.
 */
import { listPromos, readPromoFile, removePromo, savePromoFile } from "../api";
import type { Backdrop, ChartCellRect, ChartSpec, LayerBlend, OverlaySpec, PromoLayer, PromoPicture, ShotSpec, TextSpec } from "./promo";
import { parseMask, partsOf, type LayerMask } from "./promoMask";

export interface SavedLayer {
  name: string;
  /** The image's file in the board's folder. */
  image: string;
  box: { x: number; y: number; w: number; h: number };
  alignY: number;
  scale: number;
  dx: number;
  dy: number;
  hidden: boolean;
  shot?: ShotSpec;
  chart?: ChartSpec;
  link?: string;
  shared?: boolean;
  centre?: boolean;
  content?: { x: number; y: number };
  opaque?: { x0: number; y0: number; x1: number; y1: number };
  cells?: ChartCellRect[];
  text?: TextSpec;
  rotation?: number;
  mask?: LayerMask;
  opacity?: number;
  blend?: LayerBlend;
  overlay?: OverlaySpec;
  /** A shot's own glow choice (see PromoLayer.glow). */
  glow?: boolean;
  /** Made a plain image (see PromoLayer.raster). */
  raster?: boolean;
  /** The file of the image's parts picture (a mask that keeps parts of the character). */
  parts?: string;
}

export interface SavedPicture {
  name: string;
  item?: string;
  kind: string;
  w: number;
  h: number;
  strokeAt?: number;
  backdrop: Backdrop | null;
  layers: SavedLayer[];
}

export interface SavedBoard {
  version: 1;
  /** The tab's name. */
  name: string;
  /** The board's title (the set's items). */
  title: string;
  /** The set: item ids, and the class (a model path). */
  set: number[];
  cls: string;
  pictures: SavedPicture[];
}

/** What a board's images were saved as, so an image already written is not written again. */
export type Written = Map<HTMLCanvasElement, string>;

const png = (canvas: HTMLCanvasElement) =>
  new Promise<Uint8Array>((resolve, reject) =>
    canvas.toBlob((b) => (b ? b.arrayBuffer().then((a) => resolve(new Uint8Array(a))) : reject(new Error("could not encode a layer's image"))), "image/png"));

type BoardToSave = Omit<SavedBoard, "version" | "pictures"> & { pictures: PromoPicture[] };

/** Writes a board: its new images, then the JSON. Linked layers share an image, which is written once. */
export async function saveBoard(id: string, board: BoardToSave, written: Written): Promise<void> {
  const saved = await boardData(board, written, (name, bytes) => savePromoFile(id, name, bytes));
  await savePromoFile(id, "board.json", new TextEncoder().encode(JSON.stringify(saved)));
}

/** A board as its JSON, each image not written yet handed to `put` (as a PNG file of its own). */
async function boardData(board: BoardToSave, written: Written, put: (name: string, bytes: Uint8Array) => Promise<void>): Promise<SavedBoard> {
  const pictures: SavedPicture[] = [];
  for (const p of board.pictures) {
    const layers: SavedLayer[] = [];
    for (const l of p.layers) {
      const write = async (canvas: HTMLCanvasElement) => {
        let name = written.get(canvas);
        if (!name) {
          name = `image-${Date.now().toString(36)}-${written.size}.png`;
          await put(name, await png(canvas));
          written.set(canvas, name);
        }
        return name;
      };
      const file = await write(l.image);
      const partsCanvas = l.mask?.keep.length ? partsOf.get(l.image) : undefined;
      const parts = partsCanvas ? await write(partsCanvas) : undefined;
      layers.push({
        name: l.name, image: file, box: { ...l.box }, alignY: l.alignY, scale: l.scale, dx: l.dx, dy: l.dy, hidden: l.hidden,
        shot: l.shot, chart: l.chart, link: l.link, shared: l.shared, centre: l.centre, content: l.content, opaque: l.opaque, cells: l.cells, text: l.text, rotation: l.rotation, opacity: l.opacity, blend: l.blend, overlay: l.overlay, glow: l.glow, raster: l.raster,
        mask: l.mask, parts,
      });
    }
    pictures.push({ name: p.name, item: p.item, kind: p.kind, w: p.w, h: p.h, strokeAt: p.strokeAt, backdrop: p.backdrop, layers });
  }
  return { version: 1, name: board.name, title: board.title, set: board.set, cls: board.cls, pictures };
}

/** A saved image as a canvas. */
async function image(bytes: BlobPart): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas;
}

export interface LoadedBoard {
  id: string;
  saved: SavedBoard;
  pictures: PromoPicture[];
  written: Written;
}

/** Reads a board back: its pictures with their images; linked layers get one shot and one image again. */
export async function loadBoard(id: string): Promise<LoadedBoard> {
  const saved = JSON.parse(new TextDecoder().decode(await readPromoFile(id, "board.json"))) as SavedBoard;
  return { id, saved, ...(await boardPictures(saved, (name) => readPromoFile(id, name))) };
}

/** A board's pictures from its JSON, its images read with `get`. */
async function boardPictures(saved: SavedBoard, get: (name: string) => Promise<BlobPart>): Promise<{ pictures: PromoPicture[]; written: Written }> {
  if (saved.version !== 1) throw new Error(`a board of version ${String(saved.version)} is not understood`);
  const images = new Map<string, HTMLCanvasElement>();
  const written: Written = new Map();
  const leads = new Map<string, PromoLayer>();
  const pictures: PromoPicture[] = [];
  for (const p of saved.pictures) {
    const layers: PromoLayer[] = [];
    for (const s of p.layers) {
      let img = images.get(s.image);
      if (!img) {
        img = await image(await get(s.image));
        images.set(s.image, img);
        written.set(img, s.image);
      }
      const { parts, mask, ...rest } = s;
      const l: PromoLayer = { ...rest, image: img, mask: parseMask(mask) };
      if (parts && !partsOf.has(img)) {
        try {
          let pc = images.get(parts);
          if (!pc) { pc = await image(await get(parts)); images.set(parts, pc); written.set(pc, parts); }
          partsOf.set(img, pc);
        } catch { /* taken again when it is needed */ }
      }
      // the instances of a shared shot are one shot: the first read is the lead, the others take its spec and image
      if (l.link && l.shared) {
        const lead = leads.get(l.link);
        if (lead) { l.shot = lead.shot; l.chart = lead.chart; l.image = lead.image; }
        else leads.set(l.link, l);
      }
      layers.push(l);
    }
    pictures.push({ name: p.name, item: p.item, kind: p.kind, w: p.w, h: p.h, strokeAt: p.strokeAt, backdrop: p.backdrop, layers, texts: [] });
  }
  return { pictures, written };
}

/**
 * A board as one file to keep or pass on (`.board.json`): its JSON and its images in it (PNG, as base64), so it opens anywhere as it
 * was. Opened, it is a board of its own (kept like any other from then on).
 */
export interface BoardFile {
  app: "tf2-workbench";
  kind: "promo-board";
  version: 1;
  board: SavedBoard;
  images: Record<string, string>;
}

const toBase64 = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

/** A board as the text of a board file. */
export async function boardFileText(board: BoardToSave): Promise<string> {
  const images: Record<string, string> = {};
  const saved = await boardData(board, new Map(), async (name, bytes) => { images[name] = toBase64(bytes); });
  const file: BoardFile = { app: "tf2-workbench", kind: "promo-board", version: 1, board: saved, images };
  return JSON.stringify(file);
}

/** A board read from the text of a board file (its images are not in the app's folder yet: they are written with its first save there). */
export async function readBoardFile(text: string): Promise<{ saved: SavedBoard; pictures: PromoPicture[] }> {
  const file = JSON.parse(text) as Partial<BoardFile>;
  if (file.app !== "tf2-workbench" || file.kind !== "promo-board" || !file.board || !file.images) throw new Error("not a TF2 Workbench promo board");
  if (file.version !== 1) throw new Error(`a board file of version ${String(file.version)} is not understood`);
  const images = file.images;
  const { pictures } = await boardPictures(file.board, async (name) => {
    const data = images[name];
    if (data === undefined) throw new Error(`the board file has no image ${name}`);
    return fromBase64(data);
  });
  return { saved: file.board, pictures };
}

/** Every board kept, oldest first (their ids carry when they were made). */
export async function loadBoards(): Promise<LoadedBoard[]> {
  const ids = (await listPromos()).sort();
  const out: LoadedBoard[] = [];
  for (const id of ids) {
    try {
      out.push(await loadBoard(id));
    } catch (err) {
      console.warn(`could not read the promo board ${id}:`, err);
    }
  }
  return out;
}

export const forgetBoard = (id: string) => removePromo(id);
