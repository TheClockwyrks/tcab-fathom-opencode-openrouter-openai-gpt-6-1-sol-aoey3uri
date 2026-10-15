/// <reference types="node" />
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { readFile } from "node:fs/promises";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import {
  ConstantClock,
  createEngine,
  SequenceClock,
} from "@clockwyrks/simple-2d";
import type { Clock, Engine } from "@clockwyrks/simple-2d";
import * as C from "./constants";
import { BACKGROUND, game } from "./game";
import type { FathomDebugApi, FathomState, ReadState } from "./game";
import {
  center,
  flood,
  indexOf,
  layer,
  lineOfSight,
  options,
  put,
  tileAt,
} from "./world";

type DiveEngine = Engine<FathomState, FathomDebugApi>;
const engines: DiveEngine[] = [];
beforeAll(() => {
  vi.stubGlobal(
    "fetch",
    async (path: string) =>
      new Response(await readFile(new URL(`../${path}`, import.meta.url))),
  );
  vi.stubGlobal("createImageBitmap", async (blob: Blob) =>
    loadImage(Buffer.from(await blob.arrayBuffer())),
  );
});
afterEach(() => {
  for (const engine of engines.splice(0)) engine.destroy();
});
afterAll(() => vi.unstubAllGlobals());

async function harness(
  render = false,
  clock: Clock = new ConstantClock(C.TICK_DT * 1000),
) {
  const target = new EventTarget();
  const canvas = createCanvas(C.STAGE_W, C.STAGE_H);
  const engine = createEngine({
    canvas: canvas as unknown as HTMLCanvasElement,
    width: C.STAGE_W,
    height: C.STAGE_H,
    background: BACKGROUND,
    layout: C.LAYOUT,
    game: render ? game : { ...game, render() {} },
    clock,
    surface: {
      cssWidth: () => C.STAGE_W,
      cssHeight: () => C.STAGE_H,
      dpr: () => 1,
      events: () => target,
    },
  });
  engines.push(engine);
  await engine.initialize();
  const key = (code: string, down = true) => {
    target.dispatchEvent(
      Object.assign(new Event(down ? "keydown" : "keyup"), {
        code,
        repeat: false,
      }),
    );
  };
  const tap = async (code: string) => {
    key(code);
    await engine.advance(1);
    key(code, false);
    await engine.advance(1);
  };
  const pointer = (type: string, x: number, y: number, pointerType = "mouse") =>
    target.dispatchEvent(
      Object.assign(new Event(type), {
        clientX: x,
        clientY: y,
        pointerId: 1,
        pointerType,
        isPrimary: true,
        button: 0,
        buttons: type === "pointerup" ? 0 : 1,
      }),
    );
  const pose = (fn: (s: ReadState, d: FathomDebugApi) => FathomState) =>
    engine.apply((s) => fn(s, engine.debug));
  const snap = () => engine.debug.snapshot(engine.state);
  return { engine, target, canvas, key, tap, pointer, pose, snap };
}
function corridor(): string[] {
  const rows = layer("#");
  for (let x = 1; x < C.GRID_COLS - 1; x++) put(rows, x, 5, ".");
  return rows;
}
async function fixture(rows = corridor()) {
  const h = await harness();
  h.pose((s, d) => d.setMaze(s, rows));
  h.pose((s, d) => d.clearPlankton(s));
  h.pose((s, d) => d.clearPredators(s));
  h.pose((s, d) => d.setForagerTile(s, 1, 5));
  h.pose((s, d) => d.setScreen(s, "playing"));
  return h;
}

describe("maze and value state", () => {
  it("lays out a connected, symmetric maze of one-tile loops with the prescribed proportions", async () => {
    const { snap } = await harness();
    const s = snap(),
      cells: { tx: number; ty: number }[] = [];
    const reach = flood(s, s.forager, false);
    let neighbors = 0;
    for (let y = 0; y < C.GRID_ROWS; y++)
      for (let x = 0; x < C.GRID_COLS; x++) {
        const t = tileAt(s, x, y),
          mirror = tileAt(s, C.GRID_COLS - 1 - x, y);
        if (!"dg".includes(t) && !"dg".includes(mirror)) expect(t).toBe(mirror);
        expect(
          [
            t,
            tileAt(s, x + 1, y),
            tileAt(s, x, y + 1),
            tileAt(s, x + 1, y + 1),
          ].join(""),
        ).not.toBe("....");
        if (t !== ".") continue;
        const n = options(s, { tx: x, ty: y }).length;
        expect(n).toBeGreaterThanOrEqual(2);
        expect(reach[indexOf(x, y)]).toBeLessThan(Infinity);
        cells.push({ tx: x, ty: y });
        neighbors += n;
      }
    expect(neighbors / cells.length).toBeGreaterThanOrEqual(
      C.MAZE_OPENNESS_MIN,
    );
    expect(neighbors / cells.length).toBeLessThanOrEqual(C.MAZE_OPENNESS_MAX);
    expect(
      cells.length / ((C.GRID_COLS - 2) * (C.GRID_ROWS - 2)),
    ).toBeGreaterThanOrEqual(C.MAZE_DENSITY_MIN);
    const seen = new Set<number>(),
      runs: number[] = [];
    for (const cell of cells) {
      if (seen.has(indexOf(cell.tx, cell.ty)) || options(s, cell).length !== 2)
        continue;
      const queue = [cell];
      seen.add(indexOf(cell.tx, cell.ty));
      for (let i = 0; i < queue.length; i++)
        for (const v of [
          { tx: 1, ty: 0 },
          { tx: -1, ty: 0 },
          { tx: 0, ty: 1 },
          { tx: 0, ty: -1 },
        ]) {
          const n = { tx: queue[i].tx + v.tx, ty: queue[i].ty + v.ty },
            idx = indexOf(n.tx, n.ty);
          if (
            tileAt(s, n.tx, n.ty) === "." &&
            options(s, n).length === 2 &&
            !seen.has(idx)
          ) {
            seen.add(idx);
            queue.push(n);
          }
        }
      runs.push(queue.length);
    }
    const mean = runs.reduce((a, b) => a + b, 0) / runs.length;
    expect(mean).toBeGreaterThanOrEqual(C.MAZE_MAZING_MIN);
    expect(mean).toBeLessThanOrEqual(C.MAZE_MAZING_MAX);
    expect(s.planktonRemaining).toBe(cells.length);
    expect(s.tiles.join("").match(/g/g)).toHaveLength(1);
    for (let y = 7; y <= 9; y++)
      for (let x = 16; x <= 19; x++) expect(tileAt(s, x, y)).toBe("d");
  });
  it("keeps previous engine states immutable and snapshot reads detached", async () => {
    const h = await fixture(),
      old = h.engine.state,
      before = h.snap();
    h.pose((s, d) => d.setScore(s, 100));
    h.key("ArrowRight");
    await h.engine.advance(60);
    expect(old.score).toBe(0);
    expect(old.forager.x).toBe(center(1, 5).x);
    before.tiles[0] = "changed";
    before.forager.x = 0;
    expect(h.engine.state.tiles[0]).not.toBe("changed");
  });
  it("reconciles derived fields without sensing, revealing, random draws or advancing time", async () => {
    const h = await fixture();
    h.pose((s, d) => d.addPredator(s, "flarefish", 6, 5));
    h.pose((s, d) => d.setBrightness(s, 1));
    h.pose((s, d) => d.clearFog(s));
    const before = h.snap(),
      rng = h.engine.state.rng;
    h.pose((s, d) => d.reconcile(s));
    h.pose((s, d) => d.reconcile(s));
    expect(h.snap()).toEqual(before);
    expect(h.engine.state.rng).toBe(rng);
    expect(h.snap().visionRadius).toBe(C.VISION_MIN + C.VISION_GAIN);
    expect(h.snap().windowRadius).toBe(
      C.KINDLE_VISION_MIN + C.KINDLE_VISION_GAIN,
    );
  });
  it("validates debug domains and accepts unconforming fixture geometry", async () => {
    const h = await fixture();
    expect(() => h.pose((s, d) => d.setBrightness(s, 2))).toThrow();
    expect(() => h.pose((s, d) => d.setMaze(s, ["."]))).toThrow();
    expect(() => h.pose((s, d) => d.setForagerTile(s, 0, 0))).toThrow();
    expect(() => h.pose((s, d) => d.setMenuIndex(s, 0))).toThrow();
    expect(() => h.pose((s, d) => d.setPredatorMind(s, 0, false))).toThrow();
    const wide = layer(".");
    h.pose((s, d) => d.setMaze(s, wide));
    expect(h.snap().tiles).toEqual(wide);
    h.pose((s, d) => d.setSonarCooldown(s, 100));
    expect(h.snap().sonar.cooldown).toBe(100);
    for (let i = 0; i < 3; i++) h.pose((s, d) => d.spawnDrifter(s, 3 + i, 5));
    expect(h.snap().drifters).toHaveLength(3);
  });
});

describe("continuous fixed-step travel", () => {
  it("moves four tiles per second, and rests immediately on release", async () => {
    const h = await fixture();
    h.key("ArrowRight");
    await h.engine.advance(C.TICK_HZ);
    expect(h.snap().forager.x).toBeCloseTo(center(5, 5).x);
    h.key("ArrowRight", false);
    await h.engine.advance(10);
    expect(h.snap().forager.moving).toBe(false);
    expect(h.snap().forager.x).toBeCloseTo(center(5, 5).x);
  });
  it("buffers a perpendicular turn until a center and reverses immediately mid-tile", async () => {
    const rows = corridor();
    for (let y = 2; y < 5; y++) put(rows, 4, y, ".");
    const h = await fixture(rows);
    h.key("ArrowRight");
    await h.engine.advance(75);
    h.key("ArrowUp");
    await h.engine.advance(30);
    expect(h.snap().forager.x).toBeCloseTo(center(4, 5).x);
    expect(h.snap().forager.y).toBeCloseTo(center(4, 5).y - C.TILE / 2);
    h.key("ArrowDown");
    await h.engine.advance(5);
    expect(h.snap().forager.dir).toBe("down");
    expect(h.snap().forager.y).toBeGreaterThan(center(4, 5).y - C.TILE / 2);
  });
  it("stops at a wall and holds a body a new layout leaves on rock", async () => {
    const h = await fixture();
    h.key("ArrowLeft");
    await h.engine.advance(120);
    expect(h.snap().forager.x).toBe(center(1, 5).x);
    h.pose((s, d) => d.setMaze(s, layer("#")));
    h.key("ArrowRight");
    await h.engine.advance(120);
    expect(h.snap().forager.x).toBe(center(1, 5).x);
  });
  it("crosses the wrap as one continuous ordinary step", async () => {
    const rows = corridor();
    put(rows, 0, 5, ".");
    put(rows, C.GRID_COLS - 1, 5, ".");
    const h = await fixture(rows);
    h.pose((s, d) => d.setForagerTile(s, 0, 5));
    h.key("ArrowLeft");
    await h.engine.advance(20);
    expect(h.snap().forager.x).toBeCloseTo(
      C.GRID_ORIGIN_X +
        C.GRID_COLS * C.TILE -
        (20 * C.FORAGER_SPEED * C.TICK_DT - C.TILE / 2),
    );
    await h.engine.advance(10);
    expect(h.snap().forager.x).toBeCloseTo(center(35, 5).x);
  });
  it("produces identical state under different frame divisions, including sub-tick frames", async () => {
    const a = await fixture(),
      b = await fixture();
    a.engine.setClock(new ConstantClock(1000 / 30));
    b.engine.setClock(new SequenceClock([1, 4, 10, 5]));
    a.key("ArrowRight");
    b.key("ArrowRight");
    await a.engine.advance(30);
    await b.engine.advance(200);
    expect(a.snap()).toEqual(b.snap());
  });
  it("starts held movement on the first live tick even when a frame straddles the countdown", async () => {
    const a = await harness(false, new ConstantClock(27)),
      b = await harness();
    for (const h of [a, b]) {
      h.pose((s, d) => d.clearPredators(s));
      h.pose((s, d) => d.setScreen(s, "countdown"));
      h.key("ArrowRight");
    }
    await a.engine.advance(112);
    await b.engine.advance(362);
    expect(a.snap()).toEqual(b.snap());
    expect(a.snap().forager.x).toBeCloseTo(
      center(17, 11).x + 122 * C.FORAGER_SPEED * C.TICK_DT,
    );
  });
});

describe("light, sonar and ink", () => {
  it("eats once, holds brightness, then halves it on the specified curve", async () => {
    const h = await fixture();
    h.pose((s, d) => d.setPlankton(s, 1, 5, true));
    h.pose((s, d) => d.setPlankton(s, 30, 5, true));
    await h.engine.advance(1);
    expect(h.snap().score).toBe(C.SCORE_PLANKTON);
    expect(h.snap().brightness).toBe(C.BRIGHT_PER_EAT);
    await h.engine.advance(C.TICK_HZ);
    expect(h.snap().brightness).toBeCloseTo(C.BRIGHT_PER_EAT);
    await h.engine.advance(C.TICK_HZ * C.BRIGHT_HALFLIFE);
    expect(h.snap().brightness).toBeCloseTo(C.BRIGHT_PER_EAT / 2);
  });
  it("lights the first rock face but not the ground behind it; remembers after moving away", async () => {
    const rows = corridor();
    put(rows, 4, 5, "#");
    const h = await fixture(rows);
    h.pose((s, d) => d.setBrightness(s, 1));
    h.pose((s, d) => d.setBrightHold(s, C.BRIGHT_HOLD));
    await h.engine.advance(1);
    expect(h.snap().visibility[5][4]).toBe("l");
    expect(h.snap().visibility[5][5]).toBe("u");
    h.pose((s, d) => d.setForagerTile(s, 30, 5));
    await h.engine.advance(1);
    expect(h.snap().visibility[5][1]).toBe("r");
    expect(lineOfSight(h.engine.state, center(1, 5), center(5, 5))).toBe(false);
  });
  it("propagates sonar around bends with delayed marks and leaves amber bodies unresolved", async () => {
    const h = await fixture();
    h.pose((s, d) => d.addPredator(s, "gloamfin", 6, 5));
    h.pose((s, d) => d.setPredatorTravel(s, 0, false));
    h.pose((s, d) => d.addPredator(s, "lanternjaw", 7, 5));
    h.pose((s, d) => d.setPredatorMind(s, 1, false));
    h.pose((s, d) => d.spawnDrifter(s, 8, 5));
    h.pose((s, d) => d.setDrifterMind(s, 0, false));
    h.key("Space");
    await h.engine.advance(1);
    expect(h.snap().pulses[0].front).toBeLessThan(1);
    expect(h.snap().predators[0].state).toBe("wander");
    await h.engine.advance(44);
    expect(h.snap().predators[0].state).toBe("chase");
    expect(h.snap().predators[0].lit).toBe(true);
    expect(h.snap().predators[1].lit).toBe(false);
    expect(h.snap().drifters[0].lit).toBe(false);
    expect(h.snap().visibility[5][6]).toBe("l");
    expect(h.snap().sonar.ready).toBe(false);
    await h.engine.advance(136);
    expect(h.snap().sonar.ready).toBe(true);
  });
  it("floods around corners but cannot cross sealed rock", async () => {
    const rows = corridor();
    put(rows, 4, 5, "#");
    for (let x = 2; x <= 6; x++) put(rows, x, 4, ".");
    const h = await fixture(rows);
    h.key("Space");
    await h.engine.advance(65);
    expect(h.snap().visibility[5][6]).toBe("l");
    const sealed = corridor();
    put(sealed, 4, 5, "#");
    h.pose((s, d) => d.setMaze(s, sealed));
    h.pose((s, d) => d.clearFog(s));
    h.pose((s, d) => d.setSonarCooldown(s, 0));
    h.key("Space", false);
    await h.engine.advance(1);
    h.key("Space");
    await h.engine.advance(65);
    expect(h.snap().visibility[5][6]).toBe("u");
  });
  it("casts fixed ink, drops a light hunter's fix, and does not affect hearing", async () => {
    const h = await fixture();
    h.pose((s, d) => d.addPredator(s, "lanternjaw", 4, 5));
    h.pose((s, d) => d.setPredatorTravel(s, 0, false));
    await h.engine.advance(1);
    expect(h.snap().predators[0].state).toBe("chase");
    h.key("ShiftLeft");
    await h.engine.advance(1);
    expect(h.snap().predators[0].state).toBe("wander");
    expect(h.snap().inkClouds[0].radius).toBe(C.INK_RADIUS);
    h.pose((s, d) => d.addPredator(s, "gloamfin", 3, 5));
    h.pose((s, d) => d.setPredatorTravel(s, 1, false));
    await h.engine.advance(1);
    expect(h.snap().predators[1].hearingLock).toBe(true);
    expect(h.snap().predators[1].state).toBe("chase");
    const x = h.snap().inkClouds[0].x;
    h.key("ArrowRight");
    await h.engine.advance(20);
    expect(h.snap().inkClouds[0].x).toBe(x);
  });
});

describe("hunters and progression", () => {
  it("stagger-releases by schedule while disabled travel keeps the den swimmer in place", async () => {
    const h = await harness();
    h.pose((s, d) => d.clearPlankton(s));
    h.pose((s, d) => d.setScreen(s, "playing"));
    for (let i = 0; i < 3; i++)
      h.pose((s, d) => d.setPredatorTravel(s, i, false));
    await h.engine.advance(1);
    expect(h.snap().predators.map((p) => p.released)).toEqual([
      true,
      false,
      false,
    ]);
    await h.engine.advance(C.DEN_RELEASE_GAP * C.TICK_HZ - 1);
    expect(h.snap().predators.map((p) => p.released)).toEqual([
      true,
      true,
      false,
    ]);
    expect(h.snap().predators[0].state).toBe("den");
  });
  it("swims out through the den gate without walking through rock", async () => {
    const h = await harness();
    h.pose((s, d) => d.clearPlankton(s));
    h.pose((s, d) => d.setScreen(s, "playing"));
    for (let i = 0; i < 600; i++) {
      await h.engine.advance(1);
      for (const p of h.snap().predators)
        expect(tileAt(h.engine.state, p.tx, p.ty)).not.toBe("#");
    }
    expect(h.snap().predators[0].state).not.toBe("den");
  });
  it("rebuilds the ordered depth roster and shrinks sonar to its floor", async () => {
    const h = await harness();
    for (let depth = 1; depth <= 7; depth++) {
      h.pose((s, d) => d.setDepth(s, depth));
      expect(h.snap().predators).toHaveLength(
        Math.min(depth + 2, C.ROSTER_CAP * C.DEN_ORDER.length),
      );
      expect(h.snap().predators.map((p) => p.kind)).toEqual([
        ...C.DEN_ORDER,
        ...C.ROSTER_ADD_ORDER.slice(0, Math.min(depth - 1, 3)),
      ]);
      expect(h.snap().sonar.range).toBe(
        Math.max(C.SONAR_RANGE_MIN, C.SONAR_RANGE_BASE - depth + 1),
      );
    }
  });
  it("lets Lanternjaw linger after losing sight, while mind-off holds an exact pose", async () => {
    const h = await fixture();
    h.pose((s, d) => d.addPredator(s, "lanternjaw", 4, 5));
    h.pose((s, d) => d.setPredatorTravel(s, 0, false));
    await h.engine.advance(1);
    expect(h.snap().predators[0].speed).toBe(C.PREDATOR_SPEED);
    expect(h.snap().predators[0].alert).toBe(false);
    h.pose((s, d) => d.setForagerTile(s, 20, 5));
    await h.engine.advance(120);
    expect(h.snap().predators[0].state).toBe("chase");
    await h.engine.advance(120);
    expect(h.snap().predators[0].state).toBe("wander");
    expect(h.snap().predators[0].speed).toBe(C.DRIFTER_SPEED);
    h.pose((s, d) => d.setPredatorMind(s, 0, false));
    h.pose((s, d) => d.setPredatorTravel(s, 0, true));
    const p = h.snap().predators[0];
    await h.engine.advance(240);
    expect(h.snap().predators[0]).toEqual(p);
  });
  it("routes a fixed chase around rock and makes a Gloamfin pay for a corner before ramping", async () => {
    const rows = corridor();
    for (let y = 2; y < 5; y++) put(rows, 4, y, ".");
    const h = await fixture(rows);
    h.pose((s, d) => d.setForagerTile(s, 4, 2));
    h.pose((s, d) => d.addPredator(s, "gloamfin", 1, 5));
    h.pose((s, d) => d.setPredatorDir(s, 0, "right"));
    h.pose((s, d) => d.setPredatorState(s, 0, "chase"));
    h.pose((s, d) => d.setForagerTile(s, 20, 5));
    for (let i = 0; i < 120 && h.snap().predators[0].dir !== "up"; i++) {
      await h.engine.advance(1);
      const p = h.snap().predators[0];
      expect(tileAt(h.engine.state, p.tx, p.ty)).toBe(".");
    }
    expect(h.snap().predators[0].dir).toBe("up");
    expect(h.snap().predators[0].speed).toBe(C.GLOAMFIN_CORNER_SPEED);
    await h.engine.advance(60);
    expect(h.snap().predators[0].speed).toBeCloseTo(
      C.GLOAMFIN_CORNER_SPEED +
        ((C.GLOAMFIN_CHASE_SPEED - C.GLOAMFIN_CORNER_SPEED) * 0.5) /
          C.GLOAMFIN_RAMP_TIME,
    );
  });
  it("Gloamfin pings without revealing terrain and searches a fixed sound tile", async () => {
    const h = await fixture();
    h.pose((s, d) => d.setForagerTile(s, 20, 5));
    h.pose((s, d) => d.addPredator(s, "gloamfin", 1, 5));
    h.pose((s, d) => d.setPredatorTravel(s, 0, false));
    await h.engine.advance(C.GLOAMFIN_PING_INTERVAL * C.TICK_HZ);
    expect(h.snap().pulses.some((p) => p.tint === "violet")).toBe(true);
    expect(h.snap().pulses.find((p) => p.tint === "violet")?.front).toBe(0);
    expect(h.snap().visibility[5][1]).toBe("u");
    h.pose((s, d) => d.setForagerTile(s, 5, 5));
    h.pose((s, d) => d.setPredatorState(s, 0, "chase"));
    h.pose((s, d) => d.setForagerTile(s, 20, 5));
    h.pose((s, d) => d.setPredatorTile(s, 0, 5, 5));
    await h.engine.advance(1);
    expect(h.snap().predators[0].state).toBe("search");
    await h.engine.advance(C.GLOAMFIN_PING_MIN_GAP * C.TICK_HZ);
    expect(h.snap().pulses.some((p) => p.tint === "orange")).toBe(true);
    await h.engine.advance(C.GLOAMFIN_GIVEUP * C.TICK_HZ);
    expect(h.snap().predators[0].state).toBe("wander");
  });
  it("Flarefish charges, blooms through rock, then fades without continuing to light", async () => {
    const rows = corridor();
    put(rows, 5, 5, "#");
    const h = await fixture(rows);
    h.pose((s, d) => d.setForagerTile(s, 30, 5));
    h.pose((s, d) => d.addPredator(s, "flarefish", 1, 5));
    h.pose((s, d) => d.setPredatorTravel(s, 0, false));
    await h.engine.advance(C.FLARE_INTERVAL * C.TICK_HZ);
    expect(h.snap().predators[0].flareCharging).toBe(true);
    await h.engine.advance(C.FLARE_CHARGE * C.TICK_HZ);
    expect(h.snap().predators[0].flaring).toBe(true);
    expect(h.snap().visibility[5][6]).toBe("l");
    await h.engine.advance(C.FLARE_BLOOM * C.TICK_HZ);
    expect(h.snap().predators[0].flaring).toBe(false);
    expect(h.snap().visibility[5][6]).toBe("r");
  });
  it("Flarefish locks through rock during its bloom, fires an alert and extinguishes", async () => {
    const rows = corridor();
    put(rows, 3, 5, "#");
    const h = await fixture(rows);
    h.pose((s, d) => d.setForagerTile(s, 6, 5));
    h.pose((s, d) => d.addPredator(s, "flarefish", 1, 5));
    h.pose((s, d) => d.setPredatorTravel(s, 0, false));
    await h.engine.advance((C.FLARE_INTERVAL + C.FLARE_CHARGE) * C.TICK_HZ + 1);
    expect(h.snap().predators[0].state).toBe("chase");
    expect(h.snap().predators[0].alert).toBe(true);
    expect(h.snap().predators[0].flaring).toBe(false);
  });
  it("drifter cadence admits at the gate, respects its ceiling and awards a tile-contact bonus", async () => {
    const h = await harness();
    h.pose((s, d) => d.clearPredators(s));
    h.pose((s, d) => d.setScreen(s, "playing"));
    h.pose((s, d) => d.setDrifterIn(s, 0));
    await h.engine.advance(1);
    expect(h.snap().drifters).toHaveLength(1);
    expect(h.snap().drifterIn).toBe(C.DRIFTER_INTERVAL);
    h.pose((s, d) => d.setDrifterIn(s, 0));
    await h.engine.advance(1);
    expect(h.snap().drifters).toHaveLength(C.DRIFTER_MAX);
    h.pose((s, d) => d.setDrifterIn(s, 0));
    await h.engine.advance(1);
    expect(h.snap().drifters).toHaveLength(C.DRIFTER_MAX);
    h.pose((s, d) => d.spawnDrifter(s, s.forager.tx, s.forager.ty));
    const score = h.snap().score;
    await h.engine.advance(1);
    expect(h.snap().score).toBe(score + C.SCORE_DRIFTER);
  });
  it("keeps eaten plankton, score and fog after a catch, and ends only after reserves are exhausted", async () => {
    const h = await fixture();
    h.pose((s, d) => d.setScore(s, 90));
    h.pose((s, d) => d.setLives(s, 1));
    h.pose((s, d) => d.addPredator(s, "lanternjaw", 1, 5));
    h.pose((s, d) => d.setPredatorMind(s, 0, false));
    await h.engine.advance(1);
    expect(h.snap().screen).toBe("countdown");
    expect(h.snap().lives).toBe(0);
    expect(h.snap().score).toBe(90);
    expect(h.snap().planktonRemaining).toBe(0);
    expect(h.snap().visibility[5][1]).toBe("r");
    h.pose((s, d) => d.setForagerTile(s, 1, 5));
    h.pose((s, d) => d.clearPredators(s));
    h.pose((s, d) => d.addPredator(s, "flarefish", 1, 5));
    h.pose((s, d) => d.setPredatorMind(s, 0, false));
    h.pose((s, d) => d.setScreen(s, "playing"));
    await h.engine.advance(1);
    expect(h.snap().screen).toBe("gameover");
    expect(h.snap().lives).toBe(0);
  });
  it("only eating the last mote clears, awards the exact bonus, then descends fresh", async () => {
    const h = await fixture();
    await h.engine.advance(30);
    expect(h.snap().screen).toBe("playing");
    h.pose((s, d) => d.setPlankton(s, 1, 5, true));
    await h.engine.advance(1);
    expect(h.snap().screen).toBe("cleared");
    expect(h.snap().score).toBe(C.SCORE_PLANKTON + C.SCORE_CLEAR);
    await h.engine.advance(240);
    expect(h.snap().depth).toBe(2);
    expect(h.snap().screen).toBe("countdown");
    expect(h.snap().visibility.every((row) => !/[lr]/.test(row))).toBe(true);
    expect(h.snap().lives).toBe(C.START_LIVES);
    expect(h.snap().predators).toHaveLength(4);
  });
});

describe("screens and engine integration", () => {
  it("navigates all menus, remembers the title choice and reads Escape once", async () => {
    const h = await harness();
    await h.tap("ArrowUp");
    expect(h.snap().menuIndex).toBe(1);
    await h.tap("Enter");
    expect(h.snap().screen).toBe("howto");
    await h.tap("Escape");
    expect(h.snap().menuIndex).toBe(1);
    await h.tap("ArrowDown");
    await h.tap("Enter");
    expect(h.snap().screen).toBe("countdown");
    await h.engine.advance(240);
    expect(h.snap().screen).toBe("playing");
    await h.tap("Escape");
    expect(h.snap().screen).toBe("paused");
    const p = h.snap().forager;
    await h.engine.advance(100);
    expect(h.snap().forager).toEqual(p);
    await h.tap("Escape");
    expect(h.snap().screen).toBe("playing");
    await h.tap("KeyP");
    await h.tap("ArrowUp");
    await h.tap("Enter");
    expect(h.snap().screen).toBe("title");
    expect(h.snap().score).toBe(0);
  });
  it("requires both pointer edges in one region, supports touch and how-to tap return", async () => {
    const h = await harness();
    const r = h.engine.debug.menuItemRect(h.engine.state, 1)!;
    h.pointer("pointerdown", r.x + 20, r.y + 20);
    h.pointer("pointerup", 1, 1);
    await h.engine.advance(1);
    expect(h.snap().screen).toBe("title");
    h.pointer("pointerdown", r.x + 20, r.y + 20, "touch");
    await h.engine.advance(1);
    h.pointer("pointerup", r.x + 20, r.y + 20, "touch");
    await h.engine.advance(1);
    expect(h.snap().screen).toBe("howto");
    expect(h.snap().titleIndex).toBe(1);
    expect(h.engine.debug.menuItemRect(h.engine.state, 0)).toBeNull();
    h.pointer("pointerdown", 100, 100);
    h.pointer("pointerup", 100, 100);
    await h.engine.advance(1);
    expect(h.snap().screen).toBe("title");
    expect(h.snap().menuIndex).toBe(1);
  });
  it("restarts a fresh dive and returns game-over menus to their remembered title entry", async () => {
    const h = await harness();
    h.pose((s, d) => d.setTitleIndex(s, 1));
    h.pose((s, d) => d.setScore(s, 999));
    h.pose((s, d) => d.setDepth(s, 4));
    h.pose((s, d) => d.setScreen(s, "paused"));
    h.pose((s, d) => d.setMenuIndex(s, 1));
    await h.tap("Enter");
    expect(h.snap().screen).toBe("countdown");
    expect(h.snap().score).toBe(0);
    expect(h.snap().depth).toBe(1);
    h.pose((s, d) => d.setScreen(s, "gameover"));
    await h.tap("Enter");
    expect(h.snap().screen).toBe("countdown");
    h.pose((s, d) => d.setScreen(s, "gameover"));
    h.pose((s, d) => d.setMenuIndex(s, 1));
    await h.tap("Enter");
    expect(h.snap().screen).toBe("title");
    expect(h.snap().menuIndex).toBe(1);
  });
  it("mirrors runtime mute, emits real cue events, and exposes pure diagnostics", async () => {
    const h = await fixture(),
      cues: { cue: string; gain: number }[] = [];
    h.engine.events.on("cue:played", (c) => cues.push(c));
    await h.tap("KeyM");
    expect(h.snap().muted).toBe(true);
    await h.tap("Space");
    await h.tap("ShiftLeft");
    expect(cues.map((c) => c.cue)).toEqual([C.CUES.sonar, C.CUES.ink]);
    expect(cues.every((c) => c.gain === 0)).toBe(true);
    const before = h.snap();
    expect(h.engine.diagnostics().every((d) => d.error === undefined)).toBe(
      true,
    );
    expect(h.snap()).toEqual(before);
    h.pose((s, d) => d.reset(s));
    expect(h.snap().muted).toBe(true);
    expect(h.snap().simTime).toBe(0);
    expect(h.snap().menuIndex).toBe(0);
  });
  it("renders all seven screens through the engine and records actual sprite drawing", async () => {
    const h = await harness(true);
    h.engine.startRecording();
    for (const screen of [
      "title",
      "howto",
      "countdown",
      "playing",
      "paused",
      "cleared",
      "gameover",
    ] as const) {
      h.pose((s, d) => d.setScreen(s, screen));
      await h.engine.advance(1);
    }
    const recording = h.engine.stopRecording();
    expect(recording.frames).toHaveLength(7);
    expect(
      recording.ops.some((op) => op.op === "call" && op.method === "drawImage"),
    ).toBe(true);
    expect(
      recording.frames.every(
        (frame) => !frame.truncated && frame.stack.length === 0,
      ),
    ).toBe(true);
  });
  it("freezes the paused picture, including swim animation, and resumes using current held input", async () => {
    const h = await harness(true);
    h.pose((s, d) => d.clearPredators(s));
    h.pose((s, d) => d.setScreen(s, "playing"));
    h.key("ArrowRight");
    await h.engine.advance(12);
    await h.tap("KeyP");
    h.key("ArrowRight", false);
    const before = h.canvas.toBuffer("image/png"),
      x = h.snap().forager.x;
    await h.engine.advance(50);
    expect(h.canvas.toBuffer("image/png")).toEqual(before);
    await h.tap("KeyP");
    expect(h.snap().forager.x).toBe(x);
    expect(h.snap().forager.moving).toBe(false);
  });
  it("blacks out revealed terrain beyond the true Kindle circle while leaving a sonar-marked hunter visible", async () => {
    const h = await harness(true);
    h.pose((s, d) => d.setMaze(s, corridor()));
    h.pose((s, d) => d.clearPlankton(s));
    h.pose((s, d) => d.clearPredators(s));
    h.pose((s, d) => d.setForagerTile(s, 1, 5));
    h.pose((s, d) => d.addPredator(s, "gloamfin", 9, 5));
    h.pose((s, d) => d.setPredatorTravel(s, 0, false));
    h.pose((s, d) => d.setPlankton(s, 8, 5, true));
    h.pose((s, d) => d.setPlankton(s, 5, 5, true));
    h.pose((s, d) => d.setScreen(s, "playing"));
    h.key("Space");
    await h.engine.advance(72);
    const ctx = h.canvas.getContext("2d"),
      pixel = (tx: number, ty: number) => {
        const c = center(tx, ty);
        return [...ctx.getImageData(c.x, c.y, 1, 1).data];
      };
    expect(h.snap().visibility[5][8]).toBe("l");
    expect(pixel(8, 5)).toEqual([3, 6, 12, 255]);
    expect(pixel(5, 5)).not.toEqual([3, 6, 12, 255]);
    expect(h.snap().predators[0].lit).toBe(true);
    const c = center(9, 5),
      bodyPixels = ctx.getImageData(c.x - 12, c.y - 12, 24, 24).data;
    expect([...bodyPixels].some((v, i) => i % 4 < 3 && v > 60)).toBe(true);
  });
});
