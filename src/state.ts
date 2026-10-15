import * as C from "./constants";
import type {
  Art,
  Drifter,
  FathomState,
  Predator,
  ReadState,
  Screen,
  TilePoint,
} from "./model";
import { center, layer, locate, makeMaze } from "./world";

export function newDrifter(tx: number, ty: number): Drifter {
  return {
    ...center(tx, ty),
    tx,
    ty,
    dir: "up",
    lit: false,
    mind: true,
    travel: true,
  };
}
export function newPredator(
  kind: C.PredatorKind,
  tx: number,
  ty: number,
): Predator {
  return {
    ...newDrifter(tx, ty),
    kind,
    state: "wander",
    released: true,
    speed: C.PREDATOR_SPEED,
    alert: false,
    detectRange: null,
    hearingRange: null,
    hearingLock: kind === "gloamfin" ? false : null,
    flareCharging: kind === "flarefish" ? false : null,
    flaring: kind === "flarefish" ? false : null,
    flareRadius: kind === "flarefish" ? 0 : null,
    fix: null,
    linger: 0,
    alertLeft: 0,
    mark: 0,
    releaseAt: null,
    chaseSpeed: C.GLOAMFIN_CHASE_SPEED,
    pingIn: C.GLOAMFIN_PING_INTERVAL,
    sincePing: C.GLOAMFIN_PING_MIN_GAP,
    searchTime: 0,
    searchPing: false,
    flareIn: C.FLARE_INTERVAL,
    flareAge: -1,
    fade: 0,
  };
}
export function roster(depth: number): Predator[] {
  const kinds = [
    ...C.DEN_ORDER,
    ...C.ROSTER_ADD_ORDER.slice(0, Math.min(depth, C.ROSTER_CAP_DEPTH) - 1),
  ];
  return kinds.map((kind, i) => ({
    ...newPredator(kind, 16 + (i % 4), 8 + Math.floor(i / 4)),
    state: "den",
    released: false,
    releaseAt: i * C.DEN_RELEASE_GAP,
  }));
}
export function freshState(art: Art, muted = false): FathomState {
  const tiles = makeMaze(),
    start: TilePoint = { tx: 17, ty: 11 };
  const state: FathomState = {
    version: C.FATHOM_DEBUG_VERSION,
    screen: "title",
    menuIndex: 0,
    titleIndex: 0,
    depth: 1,
    score: 0,
    lives: C.START_LIVES,
    muted,
    planktonRemaining: 0,
    drifterIn: C.DRIFTER_INTERVAL,
    brightness: 0,
    brightHold: 0,
    visionRadius: 0,
    windowRadius: 0,
    sonar: { ready: true, cooldown: 0, range: C.SONAR_RANGE_BASE },
    ink: { ready: true, cooldown: 0 },
    grid: {
      cols: C.GRID_COLS,
      rows: C.GRID_ROWS,
      tile: C.TILE,
      originX: C.GRID_ORIGIN_X,
      originY: C.GRID_ORIGIN_Y,
    },
    tiles,
    plankton: tiles.map((row) => row.replace(/[^.]/g, "-").replace(/\./g, "*")),
    visibility: layer("u"),
    forager: {
      ...center(start.tx, start.ty),
      ...start,
      dir: "left",
      moving: false,
    },
    drifters: [],
    predators: roster(1),
    pulses: [],
    inkClouds: [],
    simTime: 0,
    art,
    accumulator: 0,
    rng: 0xface1234,
    start,
    desired: "left",
    held: [],
    pending: { sonar: false, ink: false },
    screenTime: 0,
    playTime: 0,
    tileMarks: Array<number>(C.GRID_COLS * C.GRID_ROWS).fill(0),
    pointerDown: null,
  };
  return reconcileMutable(state);
}

/** Copy the value's mutable branches; image resources themselves are immutable. */
export function copyState(s: ReadState): FathomState {
  return {
    ...s,
    art: Object.fromEntries(Object.entries(s.art).map(([k, v]) => [k, [...v]])),
    sonar: { ...s.sonar },
    ink: { ...s.ink },
    grid: { ...s.grid },
    tiles: [...s.tiles],
    plankton: [...s.plankton],
    visibility: [...s.visibility],
    forager: { ...s.forager },
    drifters: s.drifters.map((b) => ({ ...b })),
    predators: s.predators.map((p) => ({
      ...p,
      fix: p.fix ? { ...p.fix } : null,
    })),
    pulses: s.pulses.map((p) => ({ ...p })),
    inkClouds: s.inkClouds.map((c) => ({ ...c })),
    start: { ...s.start },
    held: [...s.held],
    pending: { ...s.pending },
    tileMarks: [...s.tileMarks],
    pointerDown: s.pointerDown ? { ...s.pointerDown } : null,
  };
}
export function reconcileMutable(s: FathomState): FathomState {
  s.visionRadius = C.VISION_MIN + C.VISION_GAIN * s.brightness;
  s.windowRadius = C.KINDLE_VISION_MIN + C.KINDLE_VISION_GAIN * s.brightness;
  s.sonar.range = Math.max(
    C.SONAR_RANGE_MIN,
    C.SONAR_RANGE_BASE - (s.depth - 1),
  );
  s.sonar.ready = s.sonar.cooldown === 0;
  s.ink.ready = s.ink.cooldown === 0;
  s.planktonRemaining = s.plankton.reduce(
    (sum, row) => sum + [...row].filter((t) => t === "*").length,
    0,
  );
  for (const b of [s.forager, ...s.drifters, ...s.predators])
    Object.assign(b, locate(b));
  for (const p of s.predators) {
    p.speed =
      p.kind === "lanternjaw" && p.state !== "chase"
        ? C.DRIFTER_SPEED
        : p.kind === "gloamfin" && p.state === "chase"
          ? p.chaseSpeed
          : C.PREDATOR_SPEED;
    p.detectRange =
      p.kind === "gloamfin"
        ? null
        : C.LANTERN_RANGE_BASE + C.LANTERN_RANGE_GAIN * s.brightness;
    p.hearingRange = p.kind === "gloamfin" ? C.GLOAMFIN_HEAR : null;
  }
  return s;
}
export function enter(s: FathomState, screen: Screen): void {
  const previous = s.screen;
  s.screen = screen;
  s.screenTime = 0;
  s.pointerDown = null;
  s.menuIndex =
    screen === "title"
      ? s.titleIndex
      : screen === "paused" || screen === "gameover"
        ? 0
        : null;
  if (screen === "playing" && previous !== "paused") s.playTime = 0;
}
export function resetAttempt(s: FathomState): void {
  s.forager = {
    ...center(s.start.tx, s.start.ty),
    ...s.start,
    dir: "left",
    moving: false,
  };
  s.desired = "left";
  s.held = [];
  s.pending = { sonar: false, ink: false };
  s.brightness = 0;
  s.brightHold = 0;
  s.predators = roster(s.depth);
  s.drifters = [];
  s.drifterIn = C.DRIFTER_INTERVAL;
  s.pulses = [];
  s.inkClouds = [];
  s.sonar.cooldown = 0;
  s.ink.cooldown = 0;
  s.tileMarks.fill(0);
  s.visibility = s.visibility.map((row) => row.replace(/l/g, "r"));
  enter(s, "countdown");
  reconcileMutable(s);
}
export function newDive(
  s: FathomState,
  screen: Screen = "countdown",
): FathomState {
  const next = freshState(s.art, s.muted);
  next.titleIndex = s.titleIndex;
  next.simTime = s.simTime;
  next.accumulator = s.accumulator;
  enter(next, screen);
  return next;
}
