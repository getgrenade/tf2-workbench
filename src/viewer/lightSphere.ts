import { lightColor, lightDirection, rotateLightDirection, type RigLight } from "./lighting";
/** A camera-relative light ball: drag anywhere to orbit the light, including behind the sphere. */
export function createLightSphere(get: () => RigLight | null, ambient: () => number, change: (azimuth: number, elevation: number) => void) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 160;
  canvas.className = "lightSphere";
  canvas.tabIndex = 0;
  canvas.setAttribute("role", "slider");
  canvas.setAttribute("aria-label", "Light direction: drag or use arrow keys");
  canvas.title = "Drag to rotate the light. Arrow keys: 2°; Shift: 10°. A faded marker means the light is behind the sphere.";
  const context = canvas.getContext("2d")!;
  const pixels = context.createImageData(160, 160);
  let drawnKey = "";
  let drag: {
    x: number;
    y: number;
  } | null = null;
  canvas.onpointerdown = e => { const l = get(); if (e.button !== 0 || !l)
    return; e.preventDefault(); canvas.focus(); canvas.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY }; };
  canvas.onpointermove = e => { const l = get(); if (!drag || !l) return;
    const angles = rotateLightDirection(l.azimuth, l.elevation, (e.clientX - drag.x) * 1.2, -(e.clientY - drag.y) * 1.2);
    drag = { x: e.clientX, y: e.clientY }; change(...angles); };
  canvas.onpointerup = canvas.onpointercancel = () => { drag = null; };
  canvas.onkeydown = e => { const l = get(); if (!l || !e.key.startsWith("Arrow"))
    return; e.preventDefault(); const step = e.shiftKey ? 10 : 2; change(...rotateLightDirection(l.azimuth, l.elevation, e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0, e.key === "ArrowUp" ? step : e.key === "ArrowDown" ? -step : 0)); };
  function draw() {
    const light = get();
    if (!light) {
      context.clearRect(0, 0, 160, 160);
      drawnKey = "";
      return;
    }
    // The host reads a cloned lighting state. Read it once, never inside the pixel loop.
    const ambientLevel = ambient();
    const key = [light.azimuth,light.elevation,light.color,light.intensity,light.enabled,ambientLevel].join(",");
    if (key === drawnKey) return;
    drawnKey = key;
    context.clearRect(0, 0, 160, 160);
    const direction = lightDirection(light.azimuth, light.elevation), color = lightColor(light.color, light.enabled ? light.intensity : 0);
    for (let y = 0; y < 160; y++)
      for (let x = 0; x < 160; x++) {
        const nx = (x - 80) / 64, ny = (80 - y) / 64, r = nx * nx + ny * ny;
        if (r > 1)
          continue;
        const nz = Math.sqrt(1 - r), diffuse = Math.pow(Math.max(0, (nx * direction.x + ny * direction.y + nz * direction.z) * .5 + .5), 2);
        const shine = Math.pow(Math.max(0, nx * direction.x + ny * direction.y + nz * direction.z), 28) * .35;
        const i = (y * 160 + x) * 4;
        for (let c = 0; c < 3; c++)
          pixels.data[i + c] = Math.min(255, Math.pow((ambientLevel + (diffuse + shine) * color.getComponent(c)) * .6, 1 / 2.2) * 255);
        pixels.data[i + 3] = 255;
      }
    context.putImageData(pixels, 0, 0);
    context.strokeStyle = "#ffffff60";
    context.lineWidth = 1;
    context.beginPath();
    context.arc(80, 80, 64, 0, Math.PI * 2);
    context.stroke();
    context.save();
    context.globalAlpha = direction.z < 0 ? .35 : 1;
    context.fillStyle = light.color;
    context.strokeStyle = "#15181c";
    context.lineWidth = 2;
    context.beginPath();
    context.arc(80 + direction.x * 68, 80 - direction.y * 68, 10, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.restore();
    canvas.setAttribute("aria-valuetext", `${Math.round(light.azimuth)} degrees azimuth, ${Math.round(light.elevation)} degrees elevation`);
  }
  return { element: canvas, draw };
}
