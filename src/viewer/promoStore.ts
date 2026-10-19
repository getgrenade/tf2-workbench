/**
 * Promo boards kept between runs of the app: each board is a folder of the app's config folder (`promos/<id>`), with `board.json`
 * (the pictures, their layers and shots, and the set) and the layers' images as PNG files. A board is written a moment after it
 * changes, images only when they are new (a shot taken again), and read back at startup beside the scenes of the last session.
 */
import { listPromos, readPromoFile, removePromo, savePromoFile } from "../api";
import type { Backdrop, ChartCellRect, ChartSpec, PromoLayer, PromoPicture, ShotSpec, TextSpec } from "./promo";

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

/** Writes a board: its new images, then the JSON. Linked layers share an image, which is written once. */
export async function saveBoard(id: string, board: Omit<SavedBoard, "version" | "pictures"> & { pictures: PromoPicture[] }, written: Written): Promise<void> {
  const pictures: SavedPicture[] = [];
  for (const p of board.pictures) {
    const layers: SavedLayer[] = [];
    for (const l of p.layers) {
      let file = written.get(l.image);
      if (!file) {
        file = `image-${Date.now().toString(36)}-${written.size}.png`;
        await savePromoFile(id, file, await png(l.image));
        written.set(l.image, file);
      }
      layers.push({
        name: l.name, image: file, box: { ...l.box }, alignY: l.alignY, scale: l.scale, dx: l.dx, dy: l.dy, hidden: l.hidden,
        shot: l.shot, chart: l.chart, link: l.link, shared: l.shared, centre: l.centre, content: l.content, opaque: l.opaque, cells: l.cells, text: l.text, rotation: l.rotation,
      });
    }
    pictures.push({ name: p.name, item: p.item, kind: p.kind, w: p.w, h: p.h, strokeAt: p.strokeAt, backdrop: p.backdrop, layers });
  }
  const saved: SavedBoard = { version: 1, name: board.name, title: board.title, set: board.set, cls: board.cls, pictures };
  await savePromoFile(id, "board.json", new TextEncoder().encode(JSON.stringify(saved)));
}

/** A saved image as a canvas. */
async function image(id: string, file: string): Promise<HTMLCanvasElement> {
  const bytes = await readPromoFile(id, file);
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
        img = await image(id, s.image);
        images.set(s.image, img);
        written.set(img, s.image);
      }
      const l: PromoLayer = { ...s, image: img };
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
  return { id, saved, pictures, written };
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
