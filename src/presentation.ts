import type { RenderApi } from "@clockwyrks/simple-2d";
import * as C from "./constants";
import { menuItemRect, menuItems } from "./debug";
import type { Body, Direction, ReadState } from "./model";
import { COUNTDOWN_TIME } from "./simulation";
import {
  center,
  distance,
  flood,
  indexOf,
  lineOfSight,
  neighbor,
  options,
  tileAt,
  VECTOR,
} from "./world";

export const BACKGROUND = "#03060c";
const CYAN = "#8cf7e2",
  DIM = "#547b83",
  WHITE = "#dcf8ef",
  AMBER = "#ff9a59";
const FONT = '"SFMono-Regular", Consolas, "Liberation Mono", monospace';
type Ctx = CanvasRenderingContext2D;
function text(
  ctx: Ctx,
  value: string,
  x: number,
  y: number,
  size = 14,
  color = DIM,
  align: CanvasTextAlign = "left",
): void {
  ctx.font = `${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.fillText(value, x, y);
}
function tracked(
  ctx: Ctx,
  value: string,
  x: number,
  y: number,
  size: number,
  tracking: number,
  color: string,
): void {
  ctx.font = `${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = "left";
  for (const char of value) {
    ctx.fillText(char, x, y);
    x += ctx.measureText(char).width + tracking;
  }
}
function line(
  ctx: Ctx,
  x: number,
  y: number,
  xx: number,
  yy: number,
  color = "#193039",
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(xx, yy);
  ctx.stroke();
}
function disc(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
}
function halo(ctx: Ctx, x: number, y: number, r: number, color: string): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, "transparent");
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}
function sprite(
  ctx: Ctx,
  s: ReadState,
  sheet: string,
  frame: number,
  x: number,
  y: number,
  size = C.TILE,
): void {
  const image = s.art[sheet]?.[frame];
  if (image) ctx.drawImage(image, x - size / 2, y - size / 2, size, size);
}
const facing: Record<Direction, number> = { down: 0, up: 2, left: 4, right: 6 };
function swimFrame(s: ReadState, b: Body, moving = true, fps = 8): number {
  return facing[b.dir] + (moving ? Math.floor(s.playTime * fps) % 2 : 0);
}
function amber(ctx: Ctx, x: number, y: number): void {
  halo(ctx, x, y, 20, "#ff874947");
  ctx.fillStyle = AMBER;
  disc(ctx, x, y, 3);
  ctx.fill();
  ctx.fillStyle = "#ffe3ab";
  disc(ctx, x, y, 1.4);
  ctx.fill();
}
function wallFrame(s: ReadState, tx: number, ty: number): number {
  const rock = (x: number, y: number): boolean =>
    x >= 0 &&
    x < C.GRID_COLS &&
    y >= 0 &&
    y < C.GRID_ROWS &&
    tileAt(s, x, y) === "#";
  return (
    (rock(tx, ty - 1) ? 1 : 0) +
    (rock(tx + 1, ty) ? 2 : 0) +
    (rock(tx, ty + 1) ? 4 : 0) +
    (rock(tx - 1, ty) ? 8 : 0)
  );
}
function terrain(ctx: Ctx, s: ReadState, all = false, flare = false): void {
  for (let ty = 0; ty < C.GRID_ROWS; ty++)
    for (let tx = 0; tx < C.GRID_COLS; tx++) {
      const c = center(tx, ty),
        vis = all ? "l" : s.visibility[ty][tx];
      if (!all && !flare && distance(c, s.forager) > s.windowRadius + C.TILE)
        continue;
      const tile = tileAt(s, tx, ty);
      if (vis === "u" && !flare) {
        sprite(ctx, s, "trench-walls", 17, c.x, c.y);
        continue;
      }
      const frame =
        tile === "#" ? wallFrame(s, tx, ty) : tile === "g" ? 18 : 16;
      ctx.globalAlpha = flare || vis === "l" ? 1 : 0.3;
      sprite(ctx, s, "trench-walls", frame, c.x, c.y);
      if (s.plankton[ty][tx] === "*") {
        ctx.fillStyle = vis === "l" || flare ? "#9edbc9" : "#52756b";
        ctx.shadowColor = CYAN;
        ctx.shadowBlur = vis === "l" || flare ? 8 : 0;
        disc(ctx, c.x, c.y, C.PLANKTON_DOT / 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
      ctx.globalAlpha = 1;
    }
}
function maze(ctx: Ctx, s: ReadState): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(
    C.GRID_ORIGIN_X,
    C.GRID_ORIGIN_Y,
    C.GRID_COLS * C.TILE,
    C.GRID_ROWS * C.TILE,
  );
  ctx.clip();
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(
    C.GRID_ORIGIN_X,
    C.GRID_ORIGIN_Y,
    C.GRID_COLS * C.TILE,
    C.GRID_ROWS * C.TILE,
  );
  ctx.save();
  disc(ctx, s.forager.x, s.forager.y, s.windowRadius);
  ctx.clip();
  terrain(ctx, s);
  halo(ctx, s.forager.x, s.forager.y, s.windowRadius, "#59e4cf12");
  ctx.restore();
  for (const p of s.predators)
    if (p.state !== "den" && p.flaring) {
      ctx.save();
      disc(ctx, p.x, p.y, C.FLARE_RADIUS);
      ctx.clip();
      terrain(ctx, s, false, true);
      ctx.restore();
    }
  ctx.save();
  disc(ctx, s.forager.x, s.forager.y, s.windowRadius);
  ctx.clip();
  for (const p of s.predators)
    if (p.state !== "den" && p.kind === "lanternjaw") amber(ctx, p.x, p.y);
  for (const d of s.drifters) amber(ctx, d.x, d.y);
  ctx.restore();
  for (const cloud of s.inkClouds) {
    ctx.save();
    disc(ctx, s.forager.x, s.forager.y, s.windowRadius);
    ctx.clip();
    const g = ctx.createRadialGradient(
      cloud.x,
      cloud.y,
      cloud.radius * 0.65,
      cloud.x,
      cloud.y,
      cloud.radius,
    );
    g.addColorStop(0, "#000106f5");
    g.addColorStop(1, "#00010600");
    ctx.fillStyle = g;
    disc(ctx, cloud.x, cloud.y, cloud.radius);
    ctx.fill();
    ctx.strokeStyle = "#28304b";
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 9]);
    ctx.stroke();
    ctx.restore();
  }
  for (const d of s.drifters)
    if (d.lit)
      sprite(
        ctx,
        s,
        "drifter",
        d.mind && d.travel ? Math.floor(s.playTime * 8) % 8 : 0,
        d.x,
        d.y,
      );
  for (const p of s.predators) {
    if (p.state === "den") continue;
    if (p.lit) {
      const frame =
        p.kind === "lanternjaw" && p.state === "wander"
          ? 8 + (p.mind && p.travel ? Math.floor(s.playTime * 8) % 8 : 0)
          : swimFrame(s, p, p.mind && p.travel);
      const c = center(p.tx, p.ty);
      const live =
        p.alert ||
        (distance(c, s.forager) <= s.visionRadius &&
          lineOfSight(s, s.forager, c, true)) ||
        s.predators.some(
          (flare) => flare.flaring && distance(flare, p) <= C.FLARE_RADIUS,
        );
      ctx.globalAlpha =
        live || p.kind === "lanternjaw"
          ? 1
          : Math.min(1, p.mark / C.SONAR_MARK_TIME);
      sprite(ctx, s, p.kind, frame, p.x, p.y);
      ctx.globalAlpha = 1;
    }
    if (p.alert) {
      const progress = 1 - p.alertLeft / C.ALERT_TIME,
        radius = 18 + progress * 28;
      ctx.save();
      ctx.globalAlpha = 1 - progress;
      ctx.strokeStyle = p.kind === "gloamfin" ? "#bf98ff" : AMBER;
      ctx.lineWidth = 2;
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        ctx.beginPath();
        ctx.moveTo(
          p.x + Math.cos(a) * radius * 0.65,
          p.y + Math.sin(a) * radius * 0.65,
        );
        ctx.lineTo(p.x + Math.cos(a) * radius, p.y + Math.sin(a) * radius);
        ctx.stroke();
      }
      ctx.restore();
    }
    if (p.flareCharging || p.flaring || p.fade > 0) {
      const frame = p.flareCharging
        ? Math.min(2, Math.floor((p.flareAge / C.FLARE_CHARGE) * 3))
        : p.flaring
          ? 3 +
            Math.min(
              2,
              Math.floor(((p.flareAge - C.FLARE_CHARGE) / C.FLARE_BLOOM) * 3),
            )
          : p.fade > 0.175
            ? 6
            : 7;
      sprite(ctx, s, "flare-bloom", frame, p.x, p.y, C.FLARE_RADIUS * 2);
    }
  }
  for (const pulse of s.pulses) {
    const distances = flood(s, { tx: pulse.ox, ty: pulse.oy });
    const color =
      pulse.tint === "cyan"
        ? "#75ffe2"
        : pulse.tint === "violet"
          ? "#b48cff"
          : "#ff9a54";
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.lineWidth = 2;
    for (let y = 0; y < C.GRID_ROWS; y++)
      for (let x = 0; x < C.GRID_COLS; x++) {
        const d = distances[indexOf(x, y)],
          delta = pulse.front - d;
        if (delta < 0 || delta > 1 || d > pulse.range) continue;
        const c = center(x, y);
        for (const dir of options(s, { tx: x, ty: y }, true)) {
          const n = neighbor(s, x, y, dir);
          if (distances[indexOf(n.tx, n.ty)] !== d + 1) continue;
          const v = VECTOR[dir],
            px = c.x + v.x * C.TILE * delta,
            py = c.y + v.y * C.TILE * delta;
          ctx.globalAlpha = 0.2;
          ctx.beginPath();
          ctx.moveTo(c.x, c.y);
          ctx.lineTo(px, py);
          ctx.stroke();
          ctx.globalAlpha = 0.85;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(px - v.y * 10, py + v.x * 10);
          ctx.lineTo(px + v.y * 10, py - v.x * 10);
          ctx.stroke();
          ctx.lineWidth = 2;
        }
      }
    ctx.restore();
  }
  halo(ctx, s.forager.x, s.forager.y, 38 + s.brightness * 12, "#60ffd941");
  sprite(
    ctx,
    s,
    "glimmerfin",
    swimFrame(s, s.forager, s.forager.moving, 9),
    s.forager.x,
    s.forager.y,
  );
  ctx.restore();
  for (const [x, y, sx, sy] of [
    [64, 80, 1, 1],
    [1216, 80, -1, 1],
    [64, 656, 1, -1],
    [1216, 656, -1, -1],
  ]) {
    line(ctx, x, y, x + sx * 12, y, "#294048");
    line(ctx, x, y, x, y + sy * 12, "#294048");
  }
}
function gauge(
  ctx: Ctx,
  x: number,
  label: string,
  key: string,
  cooldown: number,
  total: number,
  color: string,
): void {
  text(ctx, key, x, 688, 12, DIM);
  text(ctx, label, x + 48, 686, 13, cooldown === 0 ? color : DIM);
  for (let i = 0; i < 12; i++) {
    ctx.fillStyle = i / 12 < 1 - cooldown / total ? color : "#183039";
    ctx.fillRect(x + 48 + i * 9, 696, 6, 3);
  }
  text(
    ctx,
    cooldown === 0 ? "READY" : `${cooldown.toFixed(1)}s`,
    x + 172,
    688,
    11,
    cooldown === 0 ? color : DIM,
  );
}
function hud(ctx: Ctx, s: ReadState): void {
  tracked(ctx, C.TITLE_TEXT, 64, 43, 23, 4, WHITE);
  line(ctx, 246, 23, 246, 54);
  text(ctx, C.DIVE_LABEL, 267, 41, 12, DIM);
  text(ctx, "PLANKTON", 480, 29, 10, DIM);
  text(ctx, String(s.planktonRemaining).padStart(3, "0"), 480, 54, 21, CYAN);
  text(ctx, "LIGHT", 625, 29, 10, DIM);
  for (let i = 0; i < 20; i++) {
    ctx.fillStyle = i / 20 < s.brightness ? CYAN : "#173039";
    ctx.fillRect(625 + i * 5, 42, 3, 11);
  }
  text(ctx, "SCORE", 962, 28, 10, DIM);
  text(ctx, String(s.score).padStart(6, "0"), 1216, 61, 48, WHITE, "right");
  line(ctx, 64, 66, 1216, 66);
  text(ctx, `DEPTH ${String(s.depth).padStart(2, "0")}`, 64, 691, 16, WHITE);
  text(ctx, "RESERVE", 228, 689, 10, DIM);
  for (let i = 0; i < s.lives; i++)
    sprite(ctx, s, "glimmerfin", 6, 306 + i * 25, 685, 22);
  gauge(ctx, 470, "SONAR", "SPC", s.sonar.cooldown, C.SONAR_COOLDOWN, CYAN);
  gauge(ctx, 760, "INK", "SHIFT", s.ink.cooldown, C.INK_COOLDOWN, "#b5aceb");
  text(
    ctx,
    s.muted ? "M  SOUND OFF" : "M  SOUND ON",
    1216,
    686,
    11,
    DIM,
    "right",
  );
  text(ctx, "P / ESC  PAUSE", 1216, 704, 10, DIM, "right");
}
function menu(ctx: Ctx, s: ReadState): void {
  menuItems(s.screen).forEach((item, i) => {
    const r = menuItemRect(s, i);
    if (!r) return;
    const selected = s.menuIndex === i;
    ctx.fillStyle = selected ? "#102a2e" : "#071317";
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = selected ? "#548d87" : "#1c3339";
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    if (selected) {
      ctx.fillStyle = CYAN;
      ctx.fillRect(r.x, r.y + 13, 3, r.h - 26);
    }
    text(
      ctx,
      selected ? ">" : "·",
      r.x + 22,
      r.y + 34,
      17,
      selected ? CYAN : DIM,
    );
    tracked(ctx, item, r.x + 55, r.y + 34, 17, 2, selected ? WHITE : DIM);
    if (selected) text(ctx, "↵", r.x + r.w - 25, r.y + 34, 17, CYAN, "right");
  });
}
function title(ctx: Ctx, s: ReadState): void {
  halo(ctx, 936, 345, 390, "#123e452e");
  text(ctx, "F / 01", 108, 72, 12, CYAN);
  text(ctx, "ABYSSAL FIELD NOTES", 211, 72, 11, DIM);
  text(ctx, "A BIOLUMINESCENT MAZE CHASE", 108, 193, 12, DIM);
  ctx.save();
  ctx.shadowColor = "#60f4d844";
  ctx.shadowBlur = 26;
  tracked(ctx, C.TITLE_TEXT, 99, 292, 100, 2, WHITE);
  ctx.restore();
  tracked(ctx, C.TAGLINE_TEXT, 111, 335, 15, 5, CYAN);
  text(ctx, "Eat to see. Go dark to survive.", 108, 383, 15, "#86a9a9");
  menu(ctx, s);
  text(ctx, "↑ ↓  SELECT     ENTER  CONFIRM", 108, 595, 11, DIM);
  const cx = 932,
    cy = 337;
  ctx.save();
  disc(ctx, cx, cy, 233);
  ctx.clip();
  ctx.globalAlpha = 0.68;
  ctx.save();
  ctx.translate(310, -33);
  terrain(ctx, s, true);
  ctx.restore();
  ctx.globalAlpha = 1;
  const shade = ctx.createRadialGradient(cx, cy, 10, cx, cy, 233);
  shade.addColorStop(0, "#03090e22");
  shade.addColorStop(0.7, "#03090e80");
  shade.addColorStop(1, BACKGROUND);
  ctx.fillStyle = shade;
  ctx.fillRect(cx - 233, cy - 233, 466, 466);
  ctx.restore();
  for (const r of [91, 166, 239]) {
    ctx.strokeStyle = "#24504b";
    ctx.globalAlpha = r === 239 ? 0.65 : 0.3;
    ctx.lineWidth = 1;
    disc(ctx, cx, cy, r);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  line(ctx, cx - 254, cy, cx - 226, cy, "#58847a");
  line(ctx, cx + 226, cy, cx + 254, cy, "#58847a");
  line(ctx, cx, cy - 254, cx, cy - 226, "#58847a");
  line(ctx, cx, cy + 226, cx, cy + 254, "#58847a");
  halo(ctx, cx - 13, cy + 15, 82, "#66f9d62c");
  sprite(
    ctx,
    s,
    "glimmerfin",
    6 + (Math.floor(s.simTime * 4) % 2),
    cx - 13,
    cy + 15,
    64,
  );
  amber(ctx, cx + 115, cy - 90);
  text(ctx, "SIGNAL DETECTED", cx - 33, cy + 82, 10, CYAN);
  text(ctx, "06", cx - 252, cy - 190, 10, DIM);
  text(ctx, "36", cx + 239, cy + 205, 10, DIM);
  tracked(ctx, "THE KINDLE DIVE", 814, 623, 11, 2, DIM);
  line(ctx, 64, 650, 1216, 650);
  text(ctx, "NO SUNLIGHT. NO SAFE SIGNAL.", 108, 687, 10, DIM);
  text(
    ctx,
    s.muted ? "M  SOUND OFF" : "M  SOUND ON",
    1174,
    687,
    10,
    DIM,
    "right",
  );
}
function howto(ctx: Ctx, s: ReadState): void {
  text(ctx, "F / 02     DIVE BRIEFING", 108, 76, 12, CYAN);
  tracked(ctx, "READ THE DARK", 108, 146, 39, 3, WHITE);
  text(ctx, "Your light is a lifeline. It is also a trail.", 108, 186, 16, DIM);
  line(ctx, 108, 217, 1172, 217);
  const left = 108;
  text(ctx, "01 / MOVE & GRAZE", left, 259, 13, CYAN);
  text(ctx, "ARROWS / WASD   Swim the corridors", left, 298, 14, WHITE);
  text(ctx, "Eat every plankton mote to descend.", left, 329, 14, DIM);
  text(ctx, "Eating grows your light and your window.", left, 355, 14, DIM);
  text(ctx, "Explored ground fades; beyond your circle", left, 381, 14, DIM);
  text(ctx, "even remembered corridors go dark.", left, 407, 14, DIM);
  text(ctx, "02 / SENSE & ESCAPE", left, 460, 13, CYAN);
  text(ctx, "SPACE   Sonar reveals around corners", left, 497, 14, WHITE);
  text(ctx, "It shows hunters, but Gloamfin hears it.", left, 525, 14, DIM);
  text(ctx, "SHIFT   Ink blinds hunters that see", left, 561, 14, WHITE);
  text(ctx, "P / ESC  Pause     M  Toggle sound", left, 598, 14, DIM);
  line(ctx, 632, 245, 632, 605);
  const hunters = [
    {
      kind: "lanternjaw",
      name: "LANTERNJAW",
      y: 270,
      color: AMBER,
      lines: [
        "Follows your light. Dim down or break sight.",
        "That amber jelly might have jaws.",
      ],
    },
    {
      kind: "gloamfin",
      name: "GLOAMFIN",
      y: 393,
      color: "#bd9aff",
      lines: [
        "Hunts by sound. Listen for the violet ping.",
        "Take corners to shake its faster chase.",
      ],
    },
    {
      kind: "flarefish",
      name: "FLAREFISH",
      y: 516,
      color: "#ffb08c",
      lines: [
        "Hunts light; its flare sees through rock.",
        "A warm charge is your warning to leave.",
      ],
    },
  ];
  for (const p of hunters) {
    sprite(ctx, s, p.kind, 6, 694, p.y - 3, 42);
    text(ctx, p.name, 734, p.y, 17, p.color);
    p.lines.forEach((t, i) => text(ctx, t, 676, p.y + 36 + i * 25, 12, DIM));
  }
  line(ctx, 108, 641, 1172, 641);
  text(
    ctx,
    "ENTER / ESC / TAP ANYWHERE   RETURN TO SURFACE",
    108,
    684,
    12,
    CYAN,
  );
}
export function render(s: ReadState, api: RenderApi): void {
  const ctx = api.ctx;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, C.STAGE_W, C.STAGE_H);
  if (s.screen === "title") {
    title(ctx, s);
    return;
  }
  if (s.screen === "howto") {
    howto(ctx, s);
    return;
  }
  if (s.screen !== "gameover") {
    maze(ctx, s);
    hud(ctx, s);
  }
  if (s.screen === "playing") return;
  if (s.screen === "countdown") {
    text(ctx, "DIVE", 640, 294, 20, CYAN, "center");
    text(
      ctx,
      String(Math.max(1, Math.ceil(COUNTDOWN_TIME - s.screenTime))),
      640,
      362,
      54,
      WHITE,
      "center",
    );
    text(
      ctx,
      "KEEP YOUR LIGHT. WATCH YOUR SIGNAL.",
      640,
      397,
      11,
      DIM,
      "center",
    );
    return;
  }
  if (s.screen === "cleared") {
    ctx.fillStyle = "#03090ed9";
    ctx.fillRect(330, 252, 620, 210);
    text(ctx, `DEPTH ${s.depth} CLEARED`, 640, 321, 32, WHITE, "center");
    text(
      ctx,
      `+${C.SCORE_CLEAR}   /   DESCENDING`,
      640,
      369,
      16,
      CYAN,
      "center",
    );
    text(ctx, "THE WATER GETS QUIETER BELOW.", 640, 411, 11, DIM, "center");
    return;
  }
  if (s.screen === "paused") {
    ctx.fillStyle = "#03090eaf";
    ctx.fillRect(0, 80, C.STAGE_W, 576);
    ctx.fillStyle = "#071216f2";
    ctx.fillRect(392, 190, 496, 414);
    ctx.strokeStyle = "#254344";
    ctx.strokeRect(392.5, 190.5, 495, 413);
    text(ctx, "SIGNAL ON HOLD", 640, 241, 11, CYAN, "center");
    text(ctx, "PAUSED", 640, 306, 40, WHITE, "center");
    menu(ctx, s);
    return;
  }
  halo(ctx, 640, 280, 340, "#163f432a");
  text(ctx, "SIGNAL LOST", 640, 153, 12, AMBER, "center");
  text(ctx, "THE DEEP KEEPS YOU", 640, 224, 38, WHITE, "center");
  text(
    ctx,
    `SCORE ${String(s.score).padStart(6, "0")}   /   DEPTH ${s.depth}`,
    640,
    285,
    19,
    CYAN,
    "center",
  );
  menu(ctx, s);
  text(ctx, "↑ ↓  SELECT     ENTER  CONFIRM", 640, 565, 11, DIM, "center");
  line(ctx, 108, 650, 1172, 650);
  text(ctx, C.TITLE_TEXT, 108, 688, 14, DIM);
  text(ctx, C.DIVE_LABEL, 1172, 688, 11, DIM, "right");
}
