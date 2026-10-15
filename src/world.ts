import * as C from "./constants";
import type {
  Body,
  Direction,
  FathomState,
  Point,
  ReadState,
  TilePoint,
} from "./model";

export const DIRECTIONS: Direction[] = ["up", "down", "left", "right"];
export const VECTOR: Record<Direction, Point> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};
export const OPPOSITE: Record<Direction, Direction> = {
  up: "down",
  down: "up",
  left: "right",
  right: "left",
};
export const indexOf = (tx: number, ty: number): number =>
  ty * C.GRID_COLS + tx;
export const center = (tx: number, ty: number): Point => ({
  x: C.GRID_ORIGIN_X + (tx + 0.5) * C.TILE,
  y: C.GRID_ORIGIN_Y + (ty + 0.5) * C.TILE,
});
export function locate(p: Point): TilePoint {
  return {
    tx: Math.max(
      0,
      Math.min(C.GRID_COLS - 1, Math.floor((p.x - C.GRID_ORIGIN_X) / C.TILE)),
    ),
    ty: Math.max(
      0,
      Math.min(C.GRID_ROWS - 1, Math.floor((p.y - C.GRID_ORIGIN_Y) / C.TILE)),
    ),
  };
}
export const tileAt = (
  s: Pick<ReadState, "tiles">,
  tx: number,
  ty: number,
): string => s.tiles[ty]?.[tx] ?? "#";
export function layer(char: string): string[] {
  return Array.from({ length: C.GRID_ROWS }, () => char.repeat(C.GRID_COLS));
}
export function put(
  rows: string[],
  tx: number,
  ty: number,
  char: string,
): void {
  rows[ty] = rows[ty].slice(0, tx) + char + rows[ty].slice(tx + 1);
}

/** A connected, symmetric network of loops; the chamber is its only wide room. */
export function makeMaze(): string[] {
  const rows = layer("#");
  for (const y of [1, 5, 11, 16])
    for (let x = 1; x < C.GRID_COLS - 1; x++) put(rows, x, y, ".");
  for (const x of [1, 5, 9, 13, 22, 26, 30, 34])
    for (let y = 1; y < C.GRID_ROWS - 1; y++) put(rows, x, y, ".");
  for (let x = 0; x < C.GRID_COLS; x++)
    if (x <= 13 || x >= 22) put(rows, x, 8, ".");
  for (const x of [16, 19]) {
    for (let y = 1; y <= 5; y++) put(rows, x, y, ".");
    for (let y = 11; y <= 16; y++) put(rows, x, y, ".");
  }
  for (let y = 7; y <= 9; y++)
    for (let x = 16; x <= 19; x++) put(rows, x, y, "d");
  put(rows, 17, 6, "g");
  return rows;
}
export function wrapRow(s: Pick<ReadState, "tiles">): number {
  return s.tiles.findIndex(
    (row) => row[0] === "." && row[C.GRID_COLS - 1] === ".",
  );
}
export function neighbor(
  s: Pick<ReadState, "tiles">,
  tx: number,
  ty: number,
  dir: Direction,
): TilePoint {
  const v = VECTOR[dir];
  let nx = tx + v.x;
  if (ty === wrapRow(s)) nx = (nx + C.GRID_COLS) % C.GRID_COLS;
  return { tx: nx, ty: ty + v.y };
}
export function open(
  s: Pick<ReadState, "tiles">,
  tx: number,
  ty: number,
  den = false,
): boolean {
  const t = tileAt(s, tx, ty);
  return t === "." || (den && (t === "g" || t === "d"));
}
export function options(
  s: Pick<ReadState, "tiles">,
  b: TilePoint,
  den = false,
): Direction[] {
  return DIRECTIONS.filter((dir) => {
    const n = neighbor(s, b.tx, b.ty, dir);
    return open(s, n.tx, n.ty, den);
  });
}
export function flood(
  s: Pick<ReadState, "tiles">,
  origin: TilePoint,
  den = true,
): number[] {
  const distances = Array<number>(C.GRID_COLS * C.GRID_ROWS).fill(Infinity);
  if (!open(s, origin.tx, origin.ty, den)) return distances;
  distances[indexOf(origin.tx, origin.ty)] = 0;
  const queue = [origin];
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i];
    for (const dir of options(s, p, den)) {
      const n = neighbor(s, p.tx, p.ty, dir),
        idx = indexOf(n.tx, n.ty);
      if (distances[idx] !== Infinity) continue;
      distances[idx] = distances[indexOf(p.tx, p.ty)] + 1;
      queue.push(n);
    }
  }
  return distances;
}
export function route(
  s: Pick<ReadState, "tiles">,
  body: TilePoint,
  target: TilePoint,
  den = false,
): Direction | null {
  const distances = flood(s, target, den);
  let best: Direction | null = null,
    distance = distances[indexOf(body.tx, body.ty)];
  for (const dir of options(s, body, den)) {
    const n = neighbor(s, body.tx, body.ty, dir),
      d = distances[indexOf(n.tx, n.ty)];
    if (d < distance) {
      best = dir;
      distance = d;
    }
  }
  return best;
}
export function random(s: FathomState): number {
  s.rng = (Math.imul(s.rng, 1664525) + 1013904223) >>> 0;
  return s.rng / 4294967296;
}
export function wander(s: FathomState, b: Body, den = false): Direction | null {
  const dirs = options(s, b, den),
    forward = dirs.filter((d) => d !== OPPOSITE[b.dir]);
  const choices = forward.length ? forward : dirs;
  return choices.length
    ? choices[Math.floor(random(s) * choices.length)]
    : null;
}
export function atCenter(b: Body): boolean {
  const c = center(b.tx, b.ty);
  return Math.abs(b.x - c.x) < 1e-6 && Math.abs(b.y - c.y) < 1e-6;
}

/** Spend distance up to each center, preserving the remainder across a turn or wrap. */
export function move(
  s: FathomState,
  b: Body,
  distance: number,
  choose: () => Direction | null,
  den = false,
): boolean {
  Object.assign(b, locate(b));
  if (!open(s, b.tx, b.ty, den)) return false;
  let moved = false;
  while (distance > 1e-8) {
    const c = center(b.tx, b.ty);
    if (atCenter(b)) {
      b.x = c.x;
      b.y = c.y;
      const dir = choose();
      if (!dir) break;
      const n = neighbor(s, b.tx, b.ty, dir);
      if (!open(s, n.tx, n.ty, den)) break;
      b.dir = dir;
    }
    const v = VECTOR[b.dir];
    const along = (b.x - c.x) * v.x + (b.y - c.y) * v.y;
    const toCenter = along < -1e-7 ? -along : C.TILE - along;
    const amount = Math.min(distance, toCenter);
    b.x += v.x * amount;
    b.y += v.y * amount;
    if (b.ty === wrapRow(s)) {
      const width = C.GRID_COLS * C.TILE;
      if (b.x < C.GRID_ORIGIN_X) b.x += width;
      if (b.x >= C.GRID_ORIGIN_X + width) b.x -= width;
    }
    Object.assign(b, locate(b));
    distance -= amount;
    moved = true;
  }
  return moved;
}
export const distance = (a: Point, b: Point): number =>
  Math.hypot(a.x - b.x, a.y - b.y);
export const sameTile = (a: TilePoint, b: TilePoint): boolean =>
  a.tx === b.tx && a.ty === b.ty;

/** Grid traversal, with an optional opaque destination (the face light lands on). */
export function lineOfSight(
  s: Pick<ReadState, "tiles">,
  a: Point,
  b: Point,
  lightWall = false,
): boolean {
  const start = locate(a),
    end = locate(b);
  let tx = start.tx,
    ty = start.ty;
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const sx = Math.sign(dx),
    sy = Math.sign(dy);
  const stepX = dx === 0 ? Infinity : C.TILE / Math.abs(dx),
    stepY = dy === 0 ? Infinity : C.TILE / Math.abs(dy);
  let nextX =
    dx === 0
      ? Infinity
      : (C.GRID_ORIGIN_X + (tx + (sx > 0 ? 1 : 0)) * C.TILE - a.x) / dx;
  let nextY =
    dy === 0
      ? Infinity
      : (C.GRID_ORIGIN_Y + (ty + (sy > 0 ? 1 : 0)) * C.TILE - a.y) / dy;
  for (let i = 0; i < C.GRID_COLS + C.GRID_ROWS; i++) {
    if (tx === end.tx && ty === end.ty)
      return lightWall || tileAt(s, tx, ty) !== "#";
    if (tileAt(s, tx, ty) === "#") return false;
    if (Math.abs(nextX - nextY) < 1e-10) {
      tx += sx;
      ty += sy;
      nextX += stepX;
      nextY += stepY;
    } else if (nextX < nextY) {
      tx += sx;
      nextX += stepX;
    } else {
      ty += sy;
      nextY += stepY;
    }
  }
  return false;
}
export function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    length = dx * dx + dy * dy;
  const t =
    length === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length),
        );
  return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
}
export function gate(s: Pick<ReadState, "tiles">): TilePoint | null {
  for (let ty = 0; ty < C.GRID_ROWS; ty++) {
    const tx = s.tiles[ty].indexOf("g");
    if (tx >= 0) return { tx, ty };
  }
  return null;
}
