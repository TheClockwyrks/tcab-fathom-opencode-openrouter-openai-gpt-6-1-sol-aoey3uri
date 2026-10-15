import * as C from "./constants";
import type {
  Direction,
  FathomState,
  Predator,
  Pulse,
  TilePoint,
} from "./model";
import {
  enter,
  freshState,
  newDrifter,
  reconcileMutable,
  resetAttempt,
} from "./state";
import {
  atCenter,
  center,
  DIRECTIONS,
  distance,
  flood,
  gate,
  indexOf,
  lineOfSight,
  move,
  neighbor,
  open,
  OPPOSITE,
  options,
  put,
  random,
  route,
  sameTile,
  segmentDistance,
  tileAt,
  wander,
  VECTOR,
} from "./world";

export const COUNTDOWN_TIME = 2;
export const CLEARED_TIME = 2;
export type Emit = (cue: C.CueName) => void;
const down = (time: number): number =>
  time <= C.TICK_DT + 1e-10 ? 0 : time - C.TICK_DT;

export function acquire(s: FathomState, p: Predator, target: TilePoint): void {
  if (p.state !== "chase") {
    if (p.kind !== "lanternjaw") {
      p.alertLeft = C.ALERT_TIME;
      p.alert = true;
    }
    p.chaseSpeed = C.GLOAMFIN_CHASE_SPEED;
    const dir = route(s, p, target);
    if (dir === OPPOSITE[p.dir]) p.dir = dir;
  }
  p.state = "chase";
  p.fix = { tx: target.tx, ty: target.ty };
  p.linger = C.LINGER_TIME;
  if (p.kind === "flarefish") {
    if (p.flareAge >= 0) p.fade = 0.35;
    p.flareAge = -1;
    p.flareCharging = false;
    p.flaring = false;
    p.flareRadius = 0;
  }
}
function drop(p: Predator): void {
  p.state = "wander";
  p.fix = null;
  p.linger = 0;
  if (p.kind === "flarefish") {
    p.flareIn = C.FLARE_INTERVAL;
    p.flareAge = -1;
    p.flaring = false;
    p.flareCharging = false;
    p.flareRadius = 0;
  }
}
export function cast(
  s: FathomState,
  source: Pulse["source"],
  origin: TilePoint,
  tint: Pulse["tint"],
  owner: number | null = null,
): void {
  s.pulses.push({
    source,
    tint,
    ox: origin.tx,
    oy: origin.ty,
    front: 0,
    range: source === "forager" ? s.sonar.range : C.GLOAMFIN_PING_RANGE,
    owner,
    caught: false,
  });
}
function ping(
  s: FathomState,
  p: Predator,
  i: number,
  orange: boolean,
  emit: Emit,
): void {
  cast(s, "gloamfin", p, orange ? "orange" : "violet", i);
  p.pingIn = C.GLOAMFIN_PING_INTERVAL;
  p.sincePing = 0;
  if (orange) p.searchPing = true;
  emit(C.CUES.predatorPing);
}
function pulseTick(s: FathomState): void {
  for (const pulse of s.pulses) {
    const before = pulse.front;
    pulse.front += C.SONAR_WAVE_SPEED * C.TICK_DT;
    const distances = flood(s, { tx: pulse.ox, ty: pulse.oy });
    const reached = (t: TilePoint): boolean => {
      const d = distances[indexOf(t.tx, t.ty)];
      return (
        ((before === 0 && d === 0) || d > before + 1e-9) &&
        d <= pulse.front + 1e-9 &&
        d <= pulse.range
      );
    };
    if (pulse.source === "forager") {
      for (let y = 0; y < C.GRID_ROWS; y++)
        for (let x = 0; x < C.GRID_COLS; x++)
          if (reached({ tx: x, ty: y })) {
            s.tileMarks[indexOf(x, y)] = C.SONAR_MARK_TIME;
            for (const dir of DIRECTIONS) {
              const n = neighbor(s, x, y, dir);
              if (
                tileAt(s, n.tx, n.ty) === "#" &&
                n.tx >= 0 &&
                n.tx < C.GRID_COLS &&
                n.ty >= 0 &&
                n.ty < C.GRID_ROWS
              )
                s.tileMarks[indexOf(n.tx, n.ty)] = C.SONAR_MARK_TIME;
            }
          }
      for (const p of s.predators)
        if (p.state !== "den" && reached(p)) {
          if (p.kind !== "lanternjaw") p.mark = C.SONAR_MARK_TIME;
          if (p.kind === "gloamfin" && p.mind) acquire(s, p, s.forager);
        }
    } else if (!pulse.caught && reached(s.forager)) {
      pulse.caught = true;
      const p = pulse.owner === null ? undefined : s.predators[pulse.owner];
      if (p?.mind && p.state !== "den") acquire(s, p, s.forager);
    }
  }
  s.pulses = s.pulses.filter((p) => p.front <= p.range);
}
function mind(s: FathomState, p: Predator, i: number, emit: Emit): void {
  p.fade = down(p.fade);
  if (p.state === "den") return;
  const f = s.forager;
  if (p.kind === "gloamfin") {
    const wasLock = p.hearingLock;
    p.hearingLock = distance(p, f) <= C.GLOAMFIN_HEAR;
    p.pingIn = down(p.pingIn);
    p.sincePing += C.TICK_DT;
    if (p.hearingLock) acquire(s, p, f);
    if (wasLock && !p.hearingLock) p.pingIn = 0;
    if (p.state === "chase") {
      p.chaseSpeed = Math.min(
        C.GLOAMFIN_CHASE_SPEED,
        p.chaseSpeed +
          ((C.GLOAMFIN_CHASE_SPEED - C.GLOAMFIN_CORNER_SPEED) * C.TICK_DT) /
            C.GLOAMFIN_RAMP_TIME,
      );
      if (p.fix && sameTile(p, p.fix) && atCenter(p) && !sameTile(p, f)) {
        p.state = "search";
        p.searchTime = 0;
        p.searchPing = false;
      }
    }
    if (p.state === "search") {
      p.searchTime += C.TICK_DT;
      if (p.searchTime >= C.GLOAMFIN_GIVEUP) drop(p);
    }
    if (!p.hearingLock && p.sincePing + 1e-9 >= C.GLOAMFIN_PING_MIN_GAP) {
      const orange =
        p.state === "search" &&
        !p.searchPing &&
        p.searchTime >= C.GLOAMFIN_SEARCH_DELAY;
      if (orange || p.pingIn === 0) ping(s, p, i, orange, emit);
    }
    return;
  }
  const blinded = s.inkClouds.some((c) => segmentDistance(c, p, f) <= c.radius);
  if (blinded) {
    drop(p);
    return;
  }
  const sensed = distance(p, f) <= (p.detectRange ?? 0) && lineOfSight(s, p, f);
  const flareLock =
    p.kind === "flarefish" && p.flaring && distance(p, f) <= C.FLARE_RADIUS;
  if (sensed || flareLock) acquire(s, p, f);
  else if (p.state === "chase") {
    p.linger = down(p.linger);
    if (p.linger === 0) drop(p);
  }
  if (p.kind === "flarefish" && p.state === "wander") {
    if (p.flareAge < 0) {
      p.flareIn = down(p.flareIn);
      if (p.flareIn === 0) p.flareAge = 0;
    } else {
      const previous = p.flareAge;
      p.flareAge += C.TICK_DT;
      if (previous < C.FLARE_CHARGE && p.flareAge + 1e-9 >= C.FLARE_CHARGE)
        emit(C.CUES.flare);
      if (p.flareAge + 1e-9 >= C.FLARE_CHARGE + C.FLARE_BLOOM) {
        p.flareAge = -1;
        p.flareIn = C.FLARE_INTERVAL;
        p.fade = 0.35;
      }
    }
    p.flareCharging = p.flareAge >= 0 && p.flareAge < C.FLARE_CHARGE - 1e-9;
    p.flaring = p.flareAge >= C.FLARE_CHARGE - 1e-9;
    p.flareRadius = p.flaring ? C.FLARE_RADIUS : 0;
    if (p.flaring && distance(p, f) <= C.FLARE_RADIUS) acquire(s, p, f);
  }
}
function predatorTravel(s: FathomState, p: Predator): void {
  if (!p.travel || !p.mind) return;
  if (p.state === "den") {
    if (!p.released) return;
    const door = gate(s);
    if (!door || !s.tiles.some((row) => row.includes("d"))) return;
    const exits = options(s, door, true)
      .map((dir) => neighbor(s, door.tx, door.ty, dir))
      .filter((t) => tileAt(s, t.tx, t.ty) === ".");
    if (!exits.length) return;
    move(s, p, p.speed * C.TICK_DT, () => route(s, p, exits[0], true), true);
    if (tileAt(s, p.tx, p.ty) === ".") p.state = "wander";
    return;
  }
  const choose = (): Direction | null => {
    let dir: Direction | null;
    if (p.state === "chase" && p.fix) dir = route(s, p, p.fix);
    else if (p.state === "search" && p.fix) {
      const distances = flood(s, p.fix, false),
        dirs = options(s, p).filter((d) => {
          const n = neighbor(s, p.tx, p.ty, d);
          return distances[indexOf(n.tx, n.ty)] <= C.GLOAMFIN_SEARCH_ROAM;
        });
      const choices = dirs.filter((d) => d !== OPPOSITE[p.dir]);
      const candidates = choices.length ? choices : dirs;
      dir = candidates.length
        ? candidates[Math.floor(random(s) * candidates.length)]
        : route(s, p, p.fix);
    } else dir = wander(s, p);
    if (
      dir &&
      p.kind === "gloamfin" &&
      p.state === "chase" &&
      VECTOR[dir].x * VECTOR[p.dir].x + VECTOR[dir].y * VECTOR[p.dir].y === 0
    ) {
      p.chaseSpeed = C.GLOAMFIN_CORNER_SPEED;
      p.speed = p.chaseSpeed;
    }
    return dir;
  };
  // Decide at an initial center before measuring the step, so a chase corner
  // uses the slower pace on the very tick the turn is made.
  if (atCenter(p)) {
    const first = choose();
    let used = false;
    move(s, p, p.speed * C.TICK_DT, () => {
      if (!used) {
        used = true;
        return first;
      }
      return choose();
    });
  } else move(s, p, p.speed * C.TICK_DT, choose);
}

export function lighting(s: FathomState): void {
  const f = s.forager;
  const flares = s.predators.filter((p) => p.state !== "den" && p.flaring);
  const passive = (tx: number, ty: number): boolean => {
    const c = center(tx, ty);
    return distance(f, c) <= s.visionRadius && lineOfSight(s, f, c, true);
  };
  const flared = (p: { x: number; y: number }): boolean =>
    flares.some((flare) => distance(flare, p) <= C.FLARE_RADIUS);
  s.visibility = s.visibility.map((row, ty) =>
    [...row]
      .map((v, tx) =>
        passive(tx, ty) ||
        s.tileMarks[indexOf(tx, ty)] > 0 ||
        flared(center(tx, ty))
          ? "l"
          : v === "u"
            ? "u"
            : "r",
      )
      .join(""),
  );
  for (const p of s.predators)
    p.lit =
      p.state !== "den" &&
      (passive(p.tx, p.ty) ||
        flared(p) ||
        (p.kind !== "lanternjaw" && (p.mark > 0 || p.alert)));
  for (const d of s.drifters) d.lit = passive(d.tx, d.ty) || flared(d);
}

/** One whole simulation tick. Rendering and host time never enter this module. */
export function tick(
  s: FathomState,
  emit: Emit,
  held: readonly Direction[] = s.held,
): FathomState {
  s.simTime += C.TICK_DT;
  s.screenTime += C.TICK_DT;
  if (s.screen === "countdown") {
    lighting(s);
    if (s.screenTime + 1e-9 >= COUNTDOWN_TIME) {
      enter(s, "playing");
      for (const p of s.predators) if (p.releaseAt === 0) p.released = true;
    }
    return s;
  }
  if (s.screen === "cleared") {
    if (s.screenTime + 1e-9 >= CLEARED_TIME) {
      const next = freshState(s.art, s.muted);
      next.depth = s.depth + 1;
      next.score = s.score;
      next.lives = s.lives;
      next.titleIndex = s.titleIndex;
      next.simTime = s.simTime;
      next.accumulator = s.accumulator;
      resetAttempt(next);
      return next;
    }
    return s;
  }
  if (s.screen !== "playing") return s;
  const newDirection = held.filter((dir) => !s.held.includes(dir)).pop();
  if (newDirection) s.desired = newDirection;
  s.held = [...held];
  s.sonar.cooldown = down(s.sonar.cooldown);
  s.ink.cooldown = down(s.ink.cooldown);
  if (s.brightHold > 0) {
    const elapsed = Math.min(s.brightHold, C.TICK_DT);
    s.brightHold = down(s.brightHold);
    s.brightness *= 0.5 ** ((C.TICK_DT - elapsed) / C.BRIGHT_HALFLIFE);
  } else s.brightness *= 0.5 ** (C.TICK_DT / C.BRIGHT_HALFLIFE);
  for (let i = 0; i < s.tileMarks.length; i++)
    s.tileMarks[i] = down(s.tileMarks[i]);
  for (const p of s.predators) {
    p.mark = down(p.mark);
    if (p.mind) {
      p.alertLeft = down(p.alertLeft);
      p.alert = p.kind !== "lanternjaw" && p.alertLeft > 0;
    }
  }
  s.inkClouds = s.inkClouds
    .map((c) => ({ ...c, remaining: down(c.remaining) }))
    .filter((c) => c.remaining > 0);
  reconcileMutable(s);
  if (s.pending.sonar && s.sonar.ready) {
    cast(s, "forager", s.forager, "cyan");
    s.sonar.cooldown = C.SONAR_COOLDOWN;
    emit(C.CUES.sonar);
  }
  if (s.pending.ink && s.ink.ready) {
    s.inkClouds.push({
      x: s.forager.x,
      y: s.forager.y,
      radius: C.INK_RADIUS,
      remaining: C.INK_LIFE,
    });
    s.ink.cooldown = C.INK_COOLDOWN;
    emit(C.CUES.ink);
  }
  s.pending = { sonar: false, ink: false };
  const f = s.forager;
  if (s.held.length) {
    if (s.desired === OPPOSITE[f.dir]) f.dir = s.desired;
    f.moving = move(s, f, C.FORAGER_SPEED * C.TICK_DT, () => {
      const dirs = options(s, f);
      return dirs.includes(s.desired)
        ? s.desired
        : dirs.includes(f.dir)
          ? f.dir
          : null;
    });
  } else f.moving = false;
  let ateLast = false;
  if (tileAt(s, f.tx, f.ty) === "." && s.plankton[f.ty][f.tx] === "*") {
    put(s.plankton, f.tx, f.ty, "-");
    s.planktonRemaining--;
    s.score += C.SCORE_PLANKTON;
    s.brightness = Math.min(1, s.brightness + C.BRIGHT_PER_EAT);
    s.brightHold = C.BRIGHT_HOLD;
    emit(C.CUES.eat);
    ateLast = s.planktonRemaining === 0;
  }
  reconcileMutable(s);
  for (const p of s.predators)
    if (p.releaseAt !== null && s.playTime + C.TICK_DT + 1e-9 >= p.releaseAt)
      p.released = true;
  pulseTick(s);
  s.predators.forEach((p, i) => {
    if (p.mind) mind(s, p, i, emit);
  });
  reconcileMutable(s);
  for (const p of s.predators) predatorTravel(s, p);
  for (const d of s.drifters)
    if (d.mind && d.travel)
      move(s, d, C.DRIFTER_SPEED * C.TICK_DT, () => wander(s, d));
  s.drifters = s.drifters.filter((d) => {
    if (sameTile(d, f)) {
      s.score += C.SCORE_DRIFTER;
      return false;
    }
    return true;
  });
  s.drifterIn = down(s.drifterIn);
  if (
    s.drifterIn === 0 &&
    s.planktonRemaining > 0 &&
    s.drifters.length < C.DRIFTER_MAX
  ) {
    const door = gate(s);
    if (door) {
      const entry = options(s, door, true)
        .map((d) => neighbor(s, door.tx, door.ty, d))
        .find((t) => open(s, t.tx, t.ty));
      if (entry) {
        s.drifters.push(newDrifter(entry.tx, entry.ty));
        s.drifterIn = C.DRIFTER_INTERVAL;
      }
    }
  }
  s.playTime += C.TICK_DT;
  reconcileMutable(s);
  lighting(s);
  if (s.predators.some((p) => p.state !== "den" && sameTile(p, f))) {
    emit(C.CUES.caught);
    if (s.lives === 0) enter(s, "gameover");
    else {
      s.lives--;
      resetAttempt(s);
    }
  } else if (ateLast) {
    s.score += C.SCORE_CLEAR;
    emit(C.CUES.descend);
    enter(s, "cleared");
  }
  return reconcileMutable(s);
}
