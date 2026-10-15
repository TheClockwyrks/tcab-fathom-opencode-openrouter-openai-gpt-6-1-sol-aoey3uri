import type { Game, InitApi, UpdateApi } from "@clockwyrks/simple-2d";
import * as C from "./constants";
import { debug, menuItemRect, menuItems } from "./debug";
import type { Art, FathomDebugApi, FathomState, ReadState } from "./model";
import { render } from "./presentation";
import { tick } from "./simulation";
import { copyState, enter, freshState, newDive } from "./state";
import { DIRECTIONS } from "./world";

export type * from "./model";
export { BACKGROUND } from "./presentation";

async function initialize(
  api: InitApi<FathomState>,
): Promise<[FathomState, FathomDebugApi]> {
  for (const name of C.ACTIONS)
    api.input.register(name, { keys: [...C.BINDINGS[name]] });
  api.audio.define(C.CUES.eat, {
    wave: "sine",
    freq: 760,
    freqTo: 1120,
    gain: 0.08,
    durationMs: 65,
  });
  api.audio.define(C.CUES.sonar, {
    wave: "sine",
    freq: 970,
    freqTo: 240,
    gain: 0.17,
    durationMs: 470,
  });
  api.audio.define(C.CUES.ink, {
    wave: "triangle",
    freq: 130,
    freqTo: 38,
    gain: 0.22,
    durationMs: 360,
  });
  api.audio.define(C.CUES.predatorPing, {
    wave: "sine",
    freq: 380,
    freqTo: 690,
    gain: 0.14,
    durationMs: 310,
  });
  api.audio.define(C.CUES.flare, {
    wave: "sawtooth",
    freq: 85,
    freqTo: 310,
    gain: 0.08,
    durationMs: 520,
  });
  api.audio.define(C.CUES.caught, {
    wave: "triangle",
    freq: 460,
    freqTo: 35,
    gain: 0.25,
    durationMs: 650,
  });
  api.audio.define(C.CUES.descend, {
    wave: "sine",
    freq: 240,
    freqTo: 1180,
    gain: 0.2,
    durationMs: 780,
  });
  for (const name of [
    "screen",
    "depth",
    "score",
    "lives",
    "brightness",
    "visionRadius",
    "windowRadius",
    "planktonRemaining",
  ] as const)
    api.diagnostics.register(name, (s) => s[name]);
  api.diagnostics.register(
    "cooldowns",
    (s) =>
      `sonar ${s.sonar.cooldown.toFixed(2)} / ink ${s.ink.cooldown.toFixed(2)}`,
  );
  api.diagnostics.register(
    "forager",
    (s) => `${s.forager.tx},${s.forager.ty} ${s.forager.dir}`,
  );
  for (let i = 0; i < C.ROSTER_CAP * C.DEN_ORDER.length; i++)
    api.diagnostics.register(`predator ${i}`, (s) => {
      const p = s.predators[i];
      return p
        ? `${p.kind} ${p.state} ${p.tx},${p.ty} ${p.speed.toFixed(1)} alert:${p.alert}`
        : "none";
    });
  const sheets: [string, number][] = [
    ["glimmerfin", 8],
    ["lanternjaw", 16],
    ["gloamfin", 8],
    ["flarefish", 8],
    ["drifter", 8],
    ["flare-bloom", 8],
    ["trench-walls", 19],
  ];
  const art: Art = Object.fromEntries(
    await Promise.all(
      sheets.map(async ([name, count]) => [
        name,
        await Promise.all(
          Array.from({ length: count }, (_, i) =>
            api.assets.loadImage(`${name}/${i}.png`),
          ),
        ),
      ]),
    ),
  );
  return [freshState(art), debug];
}

function confirm(s: FathomState): FathomState {
  const i = s.menuIndex;
  if (s.screen === "title") {
    s.titleIndex = i ?? 0;
    if (i === 0) return newDive(s);
    enter(s, "howto");
  } else if (s.screen === "paused") {
    if (i === 0) enter(s, "playing");
    else return newDive(s, i === 1 ? "countdown" : "title");
  } else if (s.screen === "gameover")
    return newDive(s, i === 0 ? "countdown" : "title");
  return s;
}
function controls(s: FathomState, api: UpdateApi): FathomState {
  const pressed = Object.fromEntries(
    C.ACTIONS.map((name) => [name, api.input.pressed(name)]),
  );
  if (pressed.mute) api.audio.setMuted(!api.audio.muted());
  s.muted = api.audio.muted();
  const samples = api.input.pointerSamples();
  const screen = s.screen;
  if (screen === "playing") {
    if (pressed.pause) {
      enter(s, "paused");
      return s;
    }
    s.pending.sonar ||= pressed.a;
    s.pending.ink ||= pressed.b;
    return s;
  }
  if (screen === "paused" && (pressed.back || pressed.pause)) {
    enter(s, "playing");
    return s;
  }
  if (screen === "howto") {
    let tapped = false;
    for (const sample of samples) {
      if (!sample.primary) continue;
      if (sample.type === "down")
        s.pointerDown = { id: sample.id, item: -1, screen };
      if (sample.type === "up") {
        tapped ||=
          s.pointerDown?.id === sample.id && s.pointerDown.screen === screen;
        s.pointerDown = null;
      }
    }
    return pressed.confirm || pressed.back || tapped ? newDive(s, "title") : s;
  }
  if (!menuItems(screen).length) return s;
  if (pressed.back) return screen === "gameover" ? newDive(s, "title") : s;
  const count = menuItems(screen).length;
  if (pressed.up) s.menuIndex = ((s.menuIndex ?? 0) + count - 1) % count;
  if (pressed.down) s.menuIndex = ((s.menuIndex ?? 0) + 1) % count;
  let clicked = false;
  for (const sample of samples) {
    if (!sample.primary) continue;
    let item = -1;
    for (let i = 0; i < count; i++) {
      const r = menuItemRect(s, i);
      if (
        r &&
        sample.x >= r.x &&
        sample.x <= r.x + r.w &&
        sample.y >= r.y &&
        sample.y <= r.y + r.h
      )
        item = i;
    }
    if (item >= 0) s.menuIndex = item;
    if (sample.type === "down") s.pointerDown = { id: sample.id, item, screen };
    if (sample.type === "up") {
      clicked ||=
        item >= 0 &&
        s.pointerDown?.id === sample.id &&
        s.pointerDown.item === item &&
        s.pointerDown.screen === screen;
      s.pointerDown = null;
    }
  }
  return pressed.confirm || clicked ? confirm(s) : s;
}
function update(state: ReadState, api: UpdateApi, dt: number): FathomState {
  let next = controls(copyState(state), api);
  const held = DIRECTIONS.filter((dir) => api.input.value(dir) > 0);
  next.accumulator += dt;
  while (next.accumulator + 1e-10 >= C.TICK_DT) {
    next.accumulator = Math.max(0, next.accumulator - C.TICK_DT);
    const cues = new Set<C.CueName>();
    next = tick(next, (cue) => cues.add(cue), held);
    for (const cue of cues) api.audio.play(cue);
  }
  return next;
}

export const game: Game<FathomState, FathomDebugApi> = {
  initialize,
  update,
  render,
};
