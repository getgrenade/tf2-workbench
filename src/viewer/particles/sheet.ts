/** The sprite sheet data of a texture (the VTF's sheet resource): the frames of each sequence a particle can play. */
export interface SheetFrame { duration: number; uv: number[] }
export interface SheetSequence { clamp: boolean; duration: number; frames: SheetFrame[] }
export function parseSheet(buffer: ArrayBuffer): Map<number, SheetSequence> {
  const v = new DataView(buffer);
  const result = new Map<number, SheetSequence>();
  if (v.byteLength < 16 || v.getUint32(0, true) !== 0x00465456) throw new Error("Not a VTF texture");
  // older or tiny textures (vgui/white) have no resource section, so no sheet
  if (v.getUint32(8, true) < 3 || v.byteLength < 80) return result;
  const count = v.getUint32(68, true);
  if (count > 32 || 80 + count * 8 > v.getUint32(12, true)) throw new Error("Invalid VTF resources");
  for (let i = 0; i < count; i++) {
    if ((v.getUint32(80 + i * 8, true) & 0xffffff) !== 0x10) continue;
    let at = v.getUint32(84 + i * 8, true);
    const size = v.getUint32(at, true); at += 4;
    const end = at + size;
    if (end > v.byteLength) throw new Error("Truncated particle sheet");
    const uint = () => { if (at + 4 > end) throw new Error("Truncated particle sheet"); const n = v.getUint32(at, true); at += 4; return n; };
    const float = () => { if (at + 4 > end) throw new Error("Truncated particle sheet"); const n = v.getFloat32(at, true); at += 4; if (!Number.isFinite(n)) throw new Error("Invalid particle sheet value"); return n; };
    const version = uint(), sequences = uint();
    if (version > 1 || sequences > 4096) throw new Error("Unsupported particle sheet");
    for (let seq = 0; seq < sequences; seq++) {
      const index = uint(), clamp = uint() !== 0, num = uint(), duration = float();
      if (num > 10000) throw new Error("Invalid particle sheet frame count");
      const frames = Array.from({ length: num }, () => {
        const duration = float(), uv = [float(), float(), float(), float()];
        if (version === 1) for (let image = 1; image < 4; image++) for (let c = 0; c < 4; c++) float();
        return { duration, uv };
      });
      result.set(index, { clamp, duration, frames });
    }
  }
  return result;
}
