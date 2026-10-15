import * as C from "./constants";
import type {
  Direction,
  FathomDebugApi,
  FathomState,
  ReadState,
  Rect,
  Screen,
  Snapshot,
} from "./model";
import {
  copyState,
  enter,
  freshState,
  newDrifter,
  newPredator,
  reconcileMutable,
  roster,
} from "./state";
import { center, DIRECTIONS, layer, put, tileAt } from "./world";

export function menuItems(screen: Screen): readonly string[] {
  return screen === "title"
    ? C.TITLE_ITEMS
    : screen === "paused"
      ? C.PAUSE_ITEMS
      : screen === "gameover"
        ? C.GAMEOVER_ITEMS
        : [];
}
export function menuItemRect(s: ReadState, index: number): Rect | null {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= menuItems(s.screen).length
  )
    return null;
  return s.screen === "title"
    ? { x: 108, y: 426 + index * 66, w: 330, h: 54 }
    : { x: 440, y: 368 + index * 62, w: 400, h: 50 };
}
function valid(condition: boolean, label: string): asserts condition {
  if (!condition) throw new RangeError(`Fathom: invalid ${label}`);
}
function number(n: number, min: number, max = Infinity, whole = false): void {
  valid(
    Number.isFinite(n) &&
      n >= min &&
      n <= max &&
      (!whole || Number.isInteger(n)),
    "number",
  );
}
function direction(dir: Direction): void {
  valid(DIRECTIONS.includes(dir), "direction");
}
function tile(s: ReadState, tx: number, ty: number, allowed = "."): void {
  number(tx, 0, C.GRID_COLS - 1, true);
  number(ty, 0, C.GRID_ROWS - 1, true);
  valid(allowed.includes(tileAt(s, tx, ty)), "tile");
}
function pose(s: ReadState, change: (next: FathomState) => void): FathomState {
  const next = copyState(s);
  change(next);
  return reconcileMutable(next);
}
function predator(s: ReadState, index: number): void {
  number(index, 0, s.predators.length - 1, true);
}
function drifter(s: ReadState, index: number): void {
  number(index, 0, s.drifters.length - 1, true);
}
function bool(value: boolean): void {
  valid(typeof value === "boolean", "boolean");
}
export function snapshot(s: ReadState): Snapshot {
  return {
    version: C.FATHOM_DEBUG_VERSION,
    screen: s.screen,
    menuIndex: s.menuIndex,
    titleIndex: s.titleIndex,
    depth: s.depth,
    score: s.score,
    lives: s.lives,
    muted: s.muted,
    planktonRemaining: s.planktonRemaining,
    drifterIn: s.drifterIn,
    brightness: s.brightness,
    brightHold: s.brightHold,
    visionRadius: s.visionRadius,
    windowRadius: s.windowRadius,
    sonar: { ...s.sonar },
    ink: { ...s.ink },
    grid: { ...s.grid },
    tiles: [...s.tiles],
    plankton: [...s.plankton],
    visibility: [...s.visibility],
    forager: { ...s.forager },
    drifters: s.drifters.map((d) => ({
      x: d.x,
      y: d.y,
      tx: d.tx,
      ty: d.ty,
      lit: d.lit,
      mind: d.mind,
      travel: d.travel,
    })),
    predators: s.predators.map((p) => ({
      kind: p.kind,
      x: p.x,
      y: p.y,
      tx: p.tx,
      ty: p.ty,
      dir: p.dir,
      state: p.state,
      released: p.released,
      mind: p.mind,
      travel: p.travel,
      speed: p.speed,
      alert: p.alert,
      lit: p.lit,
      detectRange: p.detectRange,
      hearingRange: p.hearingRange,
      hearingLock: p.hearingLock,
      flareCharging: p.flareCharging,
      flaring: p.flaring,
      flareRadius: p.flareRadius,
    })),
    pulses: s.pulses.map((p) => ({
      source: p.source,
      tint: p.tint,
      ox: p.ox,
      oy: p.oy,
      front: p.front,
      range: p.range,
    })),
    inkClouds: s.inkClouds.map((c) => ({ ...c })),
    simTime: s.simTime,
  };
}

export const debug: FathomDebugApi = {
  version: C.FATHOM_DEBUG_VERSION,
  reset: (s) => freshState(copyState(s).art, s.muted),
  snapshot,
  reconcile: (s) => reconcileMutable(copyState(s)),
  setScreen: (s, screen) => {
    valid(
      (
        [
          "title",
          "howto",
          "countdown",
          "playing",
          "paused",
          "cleared",
          "gameover",
        ] as Screen[]
      ).includes(screen),
      "screen",
    );
    return pose(s, (n) => enter(n, screen));
  },
  setMenuIndex: (s, index) => {
    number(index, 0, menuItems(s.screen).length - 1, true);
    return pose(s, (n) => {
      n.menuIndex = index;
    });
  },
  setTitleIndex: (s, index) => {
    number(index, 0, C.TITLE_ITEMS.length - 1, true);
    return pose(s, (n) => {
      n.titleIndex = index;
    });
  },
  menuItemRect,
  setScore: (s, points) => {
    number(points, 0, Infinity, true);
    return pose(s, (n) => {
      n.score = points;
    });
  },
  setLives: (s, lives) => {
    number(lives, 0, Infinity, true);
    return pose(s, (n) => {
      n.lives = lives;
    });
  },
  setDepth: (s, depth) => {
    number(depth, 1, Infinity, true);
    return pose(s, (n) => {
      n.depth = depth;
      n.predators = roster(depth);
      n.playTime = 0;
    });
  },
  setMaze: (s, rows) => {
    valid(
      Array.isArray(rows) &&
        rows.length === C.GRID_ROWS &&
        rows.every(
          (row) =>
            typeof row === "string" &&
            row.length === C.GRID_COLS &&
            /^[#.gd]+$/.test(row),
        ),
      "maze",
    );
    const gates = rows.join("").split("g").length - 1;
    valid(!rows.some((row) => /[dg]/.test(row)) || gates === 1, "den gate");
    return pose(s, (n) => {
      n.tiles = [...rows];
    });
  },
  setPlankton: (s, tx, ty, present) => {
    tile(s, tx, ty);
    bool(present);
    return pose(s, (n) => put(n.plankton, tx, ty, present ? "*" : "-"));
  },
  clearPlankton: (s) =>
    pose(s, (n) => {
      n.plankton = layer("-");
    }),
  clearFog: (s) =>
    pose(s, (n) => {
      n.visibility = layer("u");
      n.tileMarks.fill(0);
    }),
  setForagerTile: (s, tx, ty) => {
    tile(s, tx, ty);
    return pose(s, (n) => {
      Object.assign(n.forager, center(tx, ty), { tx, ty, moving: false });
      n.held = [];
    });
  },
  setForagerDir: (s, dir) => {
    direction(dir);
    return pose(s, (n) => {
      n.forager.dir = dir;
      n.forager.moving = false;
      n.desired = dir;
    });
  },
  setBrightness: (s, g) => {
    number(g, 0, 1);
    return pose(s, (n) => {
      n.brightness = g;
    });
  },
  setBrightHold: (s, seconds) => {
    number(seconds, 0, C.BRIGHT_HOLD);
    return pose(s, (n) => {
      n.brightHold = seconds;
    });
  },
  clearPredators: (s) =>
    pose(s, (n) => {
      n.predators = [];
    }),
  addPredator: (s, kind, tx, ty) => {
    valid(C.DEN_ORDER.includes(kind), "kind");
    tile(s, tx, ty);
    return pose(s, (n) => {
      n.predators.push(newPredator(kind, tx, ty));
    });
  },
  setPredatorTile: (s, i, tx, ty) => {
    predator(s, i);
    tile(s, tx, ty, ".dg");
    return pose(s, (n) =>
      Object.assign(n.predators[i], center(tx, ty), { tx, ty }),
    );
  },
  setPredatorDir: (s, i, dir) => {
    predator(s, i);
    direction(dir);
    return pose(s, (n) => {
      n.predators[i].dir = dir;
    });
  },
  setPredatorState: (s, i, value) => {
    predator(s, i);
    valid(["den", "wander", "chase"].includes(value), "predator state");
    const p = s.predators[i];
    tile(s, p.tx, p.ty, value === "den" ? "dg" : ".");
    return pose(s, (n) => {
      const p = n.predators[i];
      p.state = value;
      p.fix = value === "chase" ? { tx: n.forager.tx, ty: n.forager.ty } : null;
      p.linger = value === "chase" ? C.LINGER_TIME : 0;
      p.chaseSpeed = C.GLOAMFIN_CHASE_SPEED;
      p.alert = false;
      p.alertLeft = 0;
      p.hearingLock = p.kind === "gloamfin" ? false : null;
      if (p.kind === "flarefish") {
        p.flareIn = C.FLARE_INTERVAL;
        p.flareAge = -1;
        p.flareCharging = false;
        p.flaring = false;
        p.flareRadius = 0;
      }
    });
  },
  setPredatorReleased: (s, i, enabled) => {
    predator(s, i);
    bool(enabled);
    return pose(s, (n) => {
      n.predators[i].released = enabled;
    });
  },
  setPredatorMind: (s, i, enabled) => {
    predator(s, i);
    bool(enabled);
    return pose(s, (n) => {
      n.predators[i].mind = enabled;
    });
  },
  setPredatorTravel: (s, i, enabled) => {
    predator(s, i);
    bool(enabled);
    return pose(s, (n) => {
      n.predators[i].travel = enabled;
    });
  },
  spawnDrifter: (s, tx, ty) => {
    tile(s, tx, ty);
    return pose(s, (n) => {
      n.drifters.push(newDrifter(tx, ty));
    });
  },
  clearDrifters: (s) =>
    pose(s, (n) => {
      n.drifters = [];
    }),
  setDrifterMind: (s, i, enabled) => {
    drifter(s, i);
    bool(enabled);
    return pose(s, (n) => {
      n.drifters[i].mind = enabled;
    });
  },
  setDrifterTravel: (s, i, enabled) => {
    drifter(s, i);
    bool(enabled);
    return pose(s, (n) => {
      n.drifters[i].travel = enabled;
    });
  },
  setDrifterIn: (s, seconds) => {
    number(seconds, 0, C.DRIFTER_INTERVAL);
    return pose(s, (n) => {
      n.drifterIn = seconds;
    });
  },
  setSonarCooldown: (s, seconds) => {
    number(seconds, 0);
    return pose(s, (n) => {
      n.sonar.cooldown = seconds;
    });
  },
  setInkCooldown: (s, seconds) => {
    number(seconds, 0);
    return pose(s, (n) => {
      n.ink.cooldown = seconds;
    });
  },
};
