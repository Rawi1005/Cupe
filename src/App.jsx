import React, { useState, useEffect, useRef, useCallback } from "react";
import { Crown, Skull, Swords, Coins, Users, Copy, Check, ShieldAlert, Eye, EyeOff, LogOut, Hourglass } from "lucide-react";

/* ---------------------------------------------------------------
   THEME — dark ink & brass with liquid-glass panels
--------------------------------------------------------------- */
const C = {
  bg: "#131118",
  felt: "#1B1822",
  feltDark: "#131118",
  panel: "#221E2A",
  panelLine: "#3B3444",
  gold: "#C9A24B",
  goldDim: "#8A7038",
  parchment: "#EDE7D8",
  muted: "#9C94A8",
  seal: "#8A2A2A",
  sealBright: "#B23A3A",
  steel: "#5B7C8C",
  moss: "#5C7A4E",
  plum: "#6B4E7A",
};

// Copernicus (Anthropic's serif) isn't openly licensed — Source Serif 4 is
// the closest open substitute and is loaded in index.css.
const SERIF = "'Source Serif 4', 'Copernicus', Georgia, serif";
const SANS = "'Inter', sans-serif";

// Soft glow blobs over near-black ink; the glass panels blur into this.
const PAGE_BG = `radial-gradient(50rem 34rem at 12% -8%, rgba(201, 162, 75, 0.10), transparent 60%), radial-gradient(56rem 40rem at 105% 108%, rgba(107, 78, 122, 0.24), transparent 60%), radial-gradient(40rem 30rem at 88% 18%, rgba(91, 124, 140, 0.10), transparent 65%), linear-gradient(180deg, #1A1720, ${C.bg})`;

// Seconds a player gets to act before the table plays for them.
const TURN_SECONDS = 30;

const ROLE_INFO = {
  Duke: { blurb: "Collects Tax (+3 coins). Blocks Foreign Aid.", color: C.gold },
  Assassin: { blurb: "Pay 3 coins to assassinate — target loses an influence.", color: C.seal },
  Captain: { blurb: "Steals 2 coins from another player. Blocks stealing.", color: C.steel },
  Ambassador: { blurb: "Exchanges cards with the deck. Blocks stealing.", color: C.moss },
  Contessa: { blurb: "Blocks assassination.", color: C.plum },
};
const ROLES = Object.keys(ROLE_INFO);

// Card art lives in public/assets (filenames match what was uploaded).
const ROLE_IMG = {
  Duke: "/assets/duke.png",
  Assassin: "/assets/assasin.png",
  Captain: "/assets/captain.png",
  Ambassador: "/assets/ambassdor.png",
  Contessa: "/assets/cortessa.png",
};

const ACTIONS = {
  income: { label: "Income", gain: 1, cost: 0, challengeable: false, blockable: false },
  foreignAid: { label: "Foreign Aid", gain: 2, cost: 0, challengeable: false, blockable: true, blockRoles: ["Duke"] },
  coup: { label: "Coup", gain: 0, cost: 7, challengeable: false, blockable: false, needsTarget: true },
  tax: { label: "Tax", role: "Duke", gain: 3, cost: 0, challengeable: true, blockable: false },
  assassinate: { label: "Assassinate", role: "Assassin", gain: 0, cost: 3, challengeable: true, blockable: true, blockRoles: ["Contessa"], needsTarget: true },
  steal: { label: "Steal", role: "Captain", gain: 0, cost: 0, challengeable: true, blockable: true, blockRoles: ["Captain", "Ambassador"], needsTarget: true },
  exchange: { label: "Exchange", role: "Ambassador", gain: 0, cost: 0, challengeable: true, blockable: false },
};

// Plain-language help shown on the action menu and in prompts.
const ACTION_HELP = {
  income: { tag: "+1", desc: "Always safe." },
  foreignAid: { tag: "+2", desc: "A Duke can block it." },
  tax: { tag: "+3", desc: "Needs the Duke." },
  steal: { tag: "+2", desc: "Take 2 coins from a player." },
  assassinate: { tag: "pay 3", desc: "Destroy a player's card. Contessa blocks." },
  exchange: { tag: "swap", desc: "Draw 2, keep your best." },
  coup: { tag: "pay 7", desc: "Destroy a player's card. Unstoppable." },
};
const ACTION_ORDER = ["income", "foreignAid", "tax", "steal", "assassinate", "exchange", "coup"];

// "<name> …" sentence describing what the actor is attempting, for everyone else.
function describeAttempt(type, targetName) {
  switch (type) {
    case "foreignAid": return "takes Foreign Aid (+2). A Duke can block it.";
    case "tax": return "claims the Duke — Tax (+3).";
    case "steal": return `claims the Captain to steal from ${targetName}.`;
    case "assassinate": return `claims the Assassin — targeting ${targetName}!`;
    case "exchange": return "claims the Ambassador to swap cards.";
    default: return `attempts ${ACTIONS[type]?.label || type}.`;
  }
}

/* ---------------------------------------------------------------
   helpers
--------------------------------------------------------------- */
const uid = () => Math.random().toString(36).slice(2, 10);
// Kahoot-style 6-digit game PIN.
const roomCodeGen = () => String(Math.floor(100000 + Math.random() * 900000));
const isPin = (s) => /^\d{6}$/.test(s);
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const freshDeck = () => shuffle(ROLES.flatMap((r) => [r, r, r]));
const isAlive = (p) => p.hand.some((c) => !c.revealed);
const alivePlayers = (room) => room.players.filter(isAlive);
const otherAlive = (room, id) => alivePlayers(room).filter((p) => p.id !== id);

function log(room, msg) {
  room.log = [...(room.log || []), msg].slice(-60);
}

/* ---------------------------------------------------------------
   room mutation functions (pure-ish: mutate a cloned room)
--------------------------------------------------------------- */
function newRoom(code, hostId, hostName) {
  const deck = freshDeck();
  const hand = [{ role: deck.pop(), revealed: false }, { role: deck.pop(), revealed: false }];
  return {
    code,
    hostId,
    players: [{ id: hostId, name: hostName, coins: 2, hand, connected: true }],
    deck,
    status: "lobby",
    turnIndex: 0,
    turn: { phase: "idle" },
    winner: null,
    log: [`${hostName} opened the room.`],
    updatedAt: Date.now(),
  };
}

function addPlayer(room, id, name) {
  const deck = [...room.deck];
  const hand = [{ role: deck.pop(), revealed: false }, { role: deck.pop(), revealed: false }];
  room.deck = deck;
  room.players = [...room.players, { id, name, coins: 2, hand, connected: true }];
  log(room, `${name} joined the table.`);
}

function startGame(room) {
  room.status = "playing";
  room.turnIndex = 0;
  room.turn = { phase: "idle" };
  log(room, "The game begins. " + room.players[0].name + " is up first.");
}

// Same table, fresh deck and hands.
function resetGame(room) {
  const deck = freshDeck();
  room.players = room.players.map((p) => ({
    ...p,
    coins: 2,
    hand: [{ role: deck.pop(), revealed: false }, { role: deck.pop(), revealed: false }],
  }));
  room.deck = deck;
  room.status = "playing";
  room.turnIndex = 0;
  room.turn = { phase: "idle" };
  room.winner = null;
  room.log = [`New game! ${room.players[0].name} is up first.`];
}

function nextTurn(room) {
  const alive = alivePlayers(room);
  if (alive.length <= 1) {
    room.status = "finished";
    room.winner = alive[0]?.id || null;
    room.turn = { phase: "idle" };
    if (alive[0]) log(room, `${alive[0].name} wins the table.`);
    return;
  }
  let idx = room.turnIndex;
  for (let i = 0; i < room.players.length; i++) {
    idx = (idx + 1) % room.players.length;
    if (isAlive(room.players[idx])) break;
  }
  room.turnIndex = idx;
  room.turn = { phase: "idle" };
}

function checkWin(room) {
  const alive = alivePlayers(room);
  if (alive.length <= 1) {
    room.status = "finished";
    room.winner = alive[0]?.id || null;
    room.turn = { phase: "idle" };
    if (alive[0]) log(room, `${alive[0].name} wins the table.`);
    return true;
  }
  return false;
}

function declareAction(room, actorId, type, targetId) {
  const actor = room.players.find((p) => p.id === actorId);
  const def = ACTIONS[type];
  if (!def) return;
  if (def.cost && actor.coins < def.cost) return;

  if (type === "income") {
    actor.coins += 1;
    log(room, `${actor.name} takes Income.`);
    nextTurn(room);
    return;
  }
  if (type === "coup") {
    actor.coins -= 7;
    const target = room.players.find((p) => p.id === targetId);
    log(room, `${actor.name} launches a Coup against ${target.name}!`);
    room.turn = { phase: "lose-influence", pendingLoss: [targetId], afterLoss: "end-turn" };
    return;
  }
  if (type === "assassinate") {
    actor.coins -= 3;
  }
  const label = def.role ? `${def.label} (claiming ${def.role})` : def.label;
  const targetName = targetId ? room.players.find((p) => p.id === targetId)?.name : null;
  log(room, `${actor.name} attempts ${label}${targetName ? ` on ${targetName}` : ""}.`);
  room.turn = {
    phase: "action-pending",
    action: { type, actorId, targetId },
    responses: Object.fromEntries(otherAlive(room, actorId).map((p) => [p.id, "pending"])),
  };
}

function resolveAction(room) {
  const { type, actorId, targetId } = room.turn.action;
  const actor = room.players.find((p) => p.id === actorId);
  const def = ACTIONS[type];
  if (type === "foreignAid") {
    actor.coins += 2;
    log(room, `${actor.name} collects Foreign Aid.`);
    nextTurn(room);
  } else if (type === "tax") {
    actor.coins += 3;
    log(room, `${actor.name} collects Tax as the Duke.`);
    nextTurn(room);
  } else if (type === "steal") {
    const target = room.players.find((p) => p.id === targetId);
    const amt = Math.min(2, target.coins);
    target.coins -= amt;
    actor.coins += amt;
    log(room, `${actor.name} steals ${amt} coin${amt === 1 ? "" : "s"} from ${target.name}.`);
    nextTurn(room);
  } else if (type === "assassinate") {
    log(room, `The assassination lands. ${room.players.find((p) => p.id === targetId).name} must lose an influence.`);
    room.turn = { phase: "lose-influence", pendingLoss: [targetId], afterLoss: "end-turn" };
  } else if (type === "exchange") {
    const draw = [room.deck.pop(), room.deck.pop()].filter(Boolean);
    room.turn = { phase: "exchange", actorId, drawn: draw };
    log(room, `${actor.name} draws from the deck to exchange influence.`);
  }
}

function cancelAction(room, reason) {
  log(room, reason);
  nextTurn(room);
}

function respondToAction(room, playerId, response, blockRole) {
  const t = room.turn;
  if (!t || t.phase !== "action-pending") return;
  const { type, actorId } = t.action;
  const def = ACTIONS[type];

  if (response === "challenge") {
    resolveChallenge(room, playerId, actorId, def.role, "action");
    return;
  }
  if (response === "block") {
    const blocker = room.players.find((p) => p.id === playerId);
    log(room, `${blocker.name} claims ${blockRole} to block.`);
    room.turn = { phase: "block-pending", action: t.action, block: { by: playerId, role: blockRole } };
    return;
  }
  // pass
  t.responses[playerId] = "pass";
  const stillWaiting = Object.values(t.responses).some((v) => v === "pending");
  if (!stillWaiting) resolveAction(room);
}

function respondToBlock(room, actorId, response) {
  const t = room.turn;
  if (!t || t.phase !== "block-pending") return;
  if (response === "accept") {
    const blocker = room.players.find((p) => p.id === t.block.by);
    cancelAction(room, `The block by ${blocker.name} holds. Action stopped.`);
    return;
  }
  if (response === "challenge") {
    resolveChallenge(room, actorId, t.block.by, t.block.role, "block");
  }
}

function resolveChallenge(room, challengerId, accusedId, claimedRole, context) {
  const accused = room.players.find((p) => p.id === accusedId);
  const challenger = room.players.find((p) => p.id === challengerId);
  const t = room.turn;
  const idx = accused.hand.findIndex((c) => c.role === claimedRole && !c.revealed);
  if (idx >= 0) {
    // accused told the truth — challenger loses an influence; accused's card is swapped for a fresh one
    const card = accused.hand[idx];
    room.deck.push(card.role);
    room.deck = shuffle(room.deck);
    card.role = room.deck.pop();
    log(room, `${accused.name} reveals ${claimedRole} — the challenge fails. ${challenger.name} must lose an influence.`);
    room.turn = {
      phase: "lose-influence",
      pendingLoss: [challengerId],
      afterLoss: context === "action" ? "resolve-action" : "block-holds",
      carryAction: t.action,
      carryBlock: t.block || null,
    };
  } else {
    log(room, `${accused.name} did not have ${claimedRole} — the challenge succeeds!`);
    room.turn = {
      phase: "lose-influence",
      pendingLoss: [accusedId],
      afterLoss: context === "action" ? "cancel-action" : "resolve-action",
      carryAction: t.action,
      carryBlock: t.block || null,
    };
  }
}

function pickLoseCard(room, playerId, cardIndex) {
  const t = room.turn;
  if (!t || t.phase !== "lose-influence") return;
  const player = room.players.find((p) => p.id === playerId);
  if (player.hand[cardIndex].revealed) return;
  player.hand[cardIndex].revealed = true;
  log(room, `${player.name} reveals ${player.hand[cardIndex].role}.`);

  if (checkWin(room)) return;

  const remaining = t.pendingLoss.filter((id) => id !== playerId);
  if (remaining.length > 0) {
    room.turn = { ...t, pendingLoss: remaining };
    return;
  }

  const after = t.afterLoss;
  if (after === "end-turn") {
    nextTurn(room);
  } else if (after === "cancel-action") {
    cancelAction(room, "The action is called off.");
  } else if (after === "block-holds") {
    const blocker = room.players.find((p) => p.id === t.carryBlock.by);
    cancelAction(room, `${blocker.name}'s block holds. Action stopped.`);
  } else if (after === "resolve-action") {
    room.turn = { phase: "action-pending", action: t.carryAction, responses: {} };
    resolveAction(room);
  } else {
    nextTurn(room);
  }
}

/* When someone idles past the deadline the table plays the safest move
   for them. Every mutation here is deterministic, so if two clients
   both apply the timeout they converge on the same room state. */
function autoPlay(room) {
  const t = room.turn || {};
  if (room.status !== "playing") return;
  if (t.phase === "idle") {
    const actor = room.players[room.turnIndex];
    if (!actor) return;
    if (actor.coins >= 10) {
      const target = otherAlive(room, actor.id)[0];
      log(room, `${actor.name} ran out of time.`);
      if (target) declareAction(room, actor.id, "coup", target.id);
      else nextTurn(room);
    } else {
      log(room, `${actor.name} ran out of time — Income (+1).`);
      actor.coins += 1;
      nextTurn(room);
    }
  } else if (t.phase === "action-pending") {
    Object.keys(t.responses || {}).forEach((id) => {
      if (t.responses[id] === "pending") t.responses[id] = "pass";
    });
    log(room, "Time's up — the action goes through.");
    resolveAction(room);
  } else if (t.phase === "block-pending") {
    log(room, "Time's up — the block stands.");
    respondToBlock(room, t.action.actorId, "accept");
  } else if (t.phase === "lose-influence") {
    const pid = t.pendingLoss[0];
    const p = room.players.find((x) => x.id === pid);
    const idx = p ? p.hand.findIndex((c) => !c.revealed) : -1;
    if (idx < 0) return;
    log(room, `${p.name} ran out of time.`);
    pickLoseCard(room, pid, idx);
  } else if (t.phase === "exchange") {
    const actor = room.players.find((p) => p.id === t.actorId);
    const keepCount = actor ? actor.hand.filter((c) => !c.revealed).length : 0;
    log(room, "Time's up — cards stay as they were.");
    completeExchange(room, t.actorId, Array.from({ length: keepCount }, (_, i) => i));
  }
}

function completeExchange(room, actorId, keepIndices) {
  const t = room.turn;
  if (!t || t.phase !== "exchange") return;
  const actor = room.players.find((p) => p.id === actorId);
  const unrevealed = actor.hand.filter((c) => !c.revealed);
  const revealedCards = actor.hand.filter((c) => c.revealed);
  const pool = [...unrevealed.map((c) => c.role), ...t.drawn];
  const kept = keepIndices.map((i) => pool[i]);
  const returned = pool.filter((_, i) => !keepIndices.includes(i));
  actor.hand = [...kept.map((role) => ({ role, revealed: false })), ...revealedCards];
  room.deck = shuffle([...room.deck, ...returned]);
  log(room, `${actor.name} completes the exchange.`);
  nextTurn(room);
}

/* ---------------------------------------------------------------
   storage helpers
--------------------------------------------------------------- */
const roomKey = (code) => `coup:room:${code}`;

async function loadRoom(code) {
  try {
    const res = await window.storage.get(roomKey(code), true);
    return res ? JSON.parse(res.value) : null;
  } catch {
    return null;
  }
}
async function saveRoom(room) {
  room.updatedAt = Date.now();
  try {
    await window.storage.set(roomKey(room.code), JSON.stringify(room), true);
  } catch (e) {
    console.error("save failed", e);
  }
}

/* ---------------------------------------------------------------
   UI atoms
--------------------------------------------------------------- */
function Btn({ children, onClick, tone = "gold", disabled, small, full }) {
  const tones = {
    gold: { bg: "linear-gradient(180deg, #DDB863, #BD9542)", fg: "#1B160E", border: "#E4C378" },
    seal: { bg: "linear-gradient(180deg, #9C3535, #7C2424)", fg: C.parchment, border: C.sealBright },
    ghost: { bg: "rgba(255, 255, 255, 0.07)", fg: C.parchment, border: "rgba(255, 255, 255, 0.16)" },
  };
  const s = tones[tone];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg font-semibold transition-all ${small ? "px-3.5 py-2 text-sm" : "px-5 py-2.5 text-base"} ${full ? "w-full" : ""}`}
      style={{
        background: disabled ? "rgba(255, 255, 255, 0.05)" : s.bg,
        color: disabled ? "#7d7588" : s.fg,
        border: `1px solid ${disabled ? "rgba(255, 255, 255, 0.08)" : s.border}`,
        opacity: disabled ? 0.7 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
        letterSpacing: "0.02em",
        minHeight: small ? 42 : 48,
        boxShadow: disabled ? "none" : "0 4px 14px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.25)",
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.filter = "brightness(1.12)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.filter = "none"; }}
    >
      {children}
    </button>
  );
}

/* A simple ring spinner. */
function Spinner({ size = 18, color = C.gold, stroke = 2.5 }) {
  return (
    <span
      className="inline-block shrink-0"
      style={{
        width: size,
        height: size,
        border: `${stroke}px solid ${color}33`,
        borderTopColor: color,
        borderRadius: "50%",
        animation: "coup-spin 0.7s linear infinite",
      }}
    />
  );
}

/* Three bouncing dots — a lightweight "someone is thinking" cue. */
function Dots({ color = C.muted }) {
  return (
    <span className="inline-flex items-end gap-1" style={{ height: 8 }}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: 5,
            height: 5,
            borderRadius: "50%",
            background: color,
            animation: `coup-dot 1.2s ease-in-out ${i * 0.16}s infinite`,
          }}
        />
      ))}
    </span>
  );
}

/* A clear "waiting for someone" panel: spinner + message + dots. */
function Waiting({ children, spectating }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-1 coup-rise">
      {!spectating && <Spinner size={22} />}
      <p className="flex items-center gap-1.5 text-center" style={{ color: C.muted, fontSize: 13.5 }}>
        <span>{children}</span>
        {!spectating && <Dots />}
      </p>
    </div>
  );
}

/* Countdown until the table auto-plays for whoever is stalling. */
function TurnTimer({ deadline, now }) {
  const left = Math.max(0, deadline - now);
  const secs = Math.ceil(left / 1000);
  const frac = Math.min(1, left / (TURN_SECONDS * 1000));
  const urgent = secs <= 10;
  return (
    <div className="flex items-center gap-2 mb-3">
      <Hourglass size={13} color={urgent ? C.sealBright : C.muted} className={urgent ? "coup-urgent" : ""} />
      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255, 255, 255, 0.08)" }}>
        <div
          className="h-full rounded-full"
          style={{
            width: `${frac * 100}%`,
            background: urgent ? C.sealBright : C.gold,
            boxShadow: `0 0 8px ${urgent ? C.sealBright : C.gold}66`,
            transition: "width 0.4s linear, background 0.3s ease",
          }}
        />
      </div>
      <span style={{ color: urgent ? C.sealBright : C.muted, fontSize: 12, fontWeight: 700, minWidth: 28, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
        {secs}s
      </span>
    </div>
  );
}

/* Big game-show style banner that drops in for each new table event so
   nobody misses what just happened. Reads the latest log line. */
function announcementStyle(text) {
  const t = text.toLowerCase();
  if (/wins|rules the table/.test(t)) return { Icon: Crown, color: C.gold, big: true };
  if (/challenge/.test(t)) return { Icon: ShieldAlert, color: C.sealBright, big: true };
  if (/reveals|coup|assassin/.test(t)) return { Icon: Skull, color: C.sealBright, big: false };
  if (/steal/.test(t)) return { Icon: Coins, color: C.steel, big: false };
  if (/tax|foreign aid|income|exchange|draws/.test(t)) return { Icon: Coins, color: C.gold, big: false };
  if (/block/.test(t)) return { Icon: ShieldAlert, color: C.moss, big: false };
  if (/out of time|time's up/.test(t)) return { Icon: Hourglass, color: C.steel, big: false };
  return { Icon: Swords, color: C.gold, big: false };
}

function Announcer({ event }) {
  if (!event) return null;
  const { Icon, color, big } = announcementStyle(event.text);
  return (
    <div className="fixed inset-x-0 z-50 px-4 pointer-events-none flex justify-center" style={{ top: "max(14px, env(safe-area-inset-top))" }}>
      <div
        key={event.id}
        className={`coup-banner relative overflow-hidden flex items-center gap-3.5 rounded-2xl ${big ? "px-5 py-4" : "px-4 py-3"}`}
        style={{
          maxWidth: 620,
          background: "linear-gradient(165deg, rgba(56, 48, 38, 0.78), rgba(22, 18, 16, 0.86))",
          backdropFilter: "blur(16px) saturate(1.3)",
          WebkitBackdropFilter: "blur(16px) saturate(1.3)",
          border: `2px solid ${color}`,
          boxShadow: `0 14px 44px #000000cc, 0 0 26px ${color}${big ? "77" : "44"}, inset 0 1px 0 #ffffff1a`,
          ["--banner-glow"]: color,
        }}
      >
        {/* one-shot shine that sweeps across as the banner lands */}
        <span
          className="coup-banner-shine absolute inset-y-0 pointer-events-none"
          style={{ width: 90, background: "linear-gradient(105deg, transparent, #ffffff2e, transparent)" }}
        />
        <div
          className="coup-banner-icon shrink-0 rounded-full flex items-center justify-center"
          style={{
            width: big ? 46 : 40,
            height: big ? 46 : 40,
            background: `radial-gradient(circle at 35% 30%, ${color}44, ${color}1a)`,
            border: `1.5px solid ${color}`,
            boxShadow: `0 0 16px ${color}66`,
          }}
        >
          <Icon size={big ? 24 : 20} color={color} />
        </div>
        <span
          style={{
            color: C.parchment,
            fontFamily: big ? SERIF : SANS,
            fontSize: big ? 20 : 16,
            fontWeight: big ? 700 : 600,
            lineHeight: 1.3,
            textShadow: "0 1px 2px #000000aa",
          }}
        >
          {event.text}
        </span>
      </div>
    </div>
  );
}

/* A tall option button with a title and an explanation underneath —
   used for challenge / block / allow choices and target picking. */
function ChoiceBtn({ title, sub, tone = "ghost", disabled, onClick, right }) {
  const styles = {
    gold: { bg: "rgba(201, 162, 75, 0.13)", border: `${C.gold}AA`, title: C.gold },
    seal: { bg: "rgba(178, 58, 58, 0.14)", border: C.sealBright, title: "#E8A9A9" },
    ghost: { bg: "rgba(255, 255, 255, 0.05)", border: "rgba(255, 255, 255, 0.13)", title: C.parchment },
  };
  const s = styles[tone];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full text-left rounded-xl px-4 py-3"
      style={{
        background: disabled ? "rgba(255, 255, 255, 0.03)" : s.bg,
        border: `1px solid ${disabled ? "rgba(255, 255, 255, 0.07)" : s.border}`,
        boxShadow: disabled ? "none" : "inset 0 1px 0 rgba(255, 255, 255, 0.07)",
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
        minHeight: 52,
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span style={{ color: s.title, fontSize: 15, fontWeight: 700 }}>{title}</span>
        {right && <span style={{ color: C.gold, fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}>{right}</span>}
      </div>
      {sub && <div style={{ color: C.muted, fontSize: 12.5, marginTop: 2, lineHeight: 1.4 }}>{sub}</div>}
    </button>
  );
}

function CardTile({ role, revealed, faceDown, size = "md" }) {
  const info = ROLE_INFO[role] || { color: C.muted, blurb: "" };
  const d = size === "sm"
    ? { w: 92, h: 134, name: 12.5, blurb: false, radius: 10, icon: 18 }
    : { w: 128, h: 188, name: 16, blurb: true, radius: 14, icon: 26 };
  const frame = {
    width: d.w,
    height: d.h,
    borderRadius: d.radius,
    boxShadow: "0 8px 18px #00000073, 0 2px 5px #00000059",
  };
  if (faceDown) {
    return (
      <div
        className="coup-card relative flex items-center justify-center shrink-0 overflow-hidden"
        style={{
          ...frame,
          background: `radial-gradient(circle at 50% 42%, #2b2418, #191510 70%), repeating-linear-gradient(135deg, ${C.panel}, ${C.panel} 6px, #2a241b 6px, #2a241b 12px)`,
          border: `1px solid #40382c`,
        }}
      >
        <div className="absolute pointer-events-none" style={{ inset: 4, borderRadius: d.radius - 5, border: `1px solid ${C.goldDim}66` }} />
        <div className="rounded-full flex items-center justify-center" style={{ width: d.icon * 2, height: d.icon * 2, border: `1px solid ${C.goldDim}88` }}>
          <Crown size={d.icon} color={C.goldDim} />
        </div>
      </div>
    );
  }
  return (
    <div
      className="coup-card relative shrink-0 overflow-hidden"
      style={{
        ...frame,
        background: C.panel,
        border: `1.5px solid ${revealed ? "#3a332a" : info.color}`,
      }}
    >
      <img
        src={ROLE_IMG[role]}
        alt={role}
        draggable={false}
        className="absolute inset-0 w-full h-full object-cover select-none"
        style={{ filter: revealed ? "grayscale(0.9) brightness(0.45)" : "saturate(1.05)" }}
      />
      {/* inner gilt trim */}
      <div
        className="absolute pointer-events-none"
        style={{
          inset: 3,
          borderRadius: d.radius - 4,
          border: `1px solid ${revealed ? "#ffffff14" : `${info.color}99`}`,
          boxShadow: "inset 0 0 14px #00000099",
        }}
      />
      {/* name plate over a bottom fade so the art stays visible */}
      <div
        className="absolute left-0 right-0 bottom-0 px-2 pb-1.5 pt-7 text-center"
        style={{ background: "linear-gradient(180deg, transparent, #0b0906d9 52%, #0b0906f2)" }}
      >
        <div
          style={{
            color: revealed ? C.muted : info.color,
            fontFamily: SERIF,
            fontWeight: 700,
            fontSize: d.name,
            lineHeight: 1.15,
            letterSpacing: "0.03em",
            textShadow: "0 1px 3px #000000cc",
          }}
        >
          {role}
        </div>
        {d.blurb && !revealed && (
          <p style={{ color: C.parchment, fontSize: 9.5, lineHeight: 1.3, opacity: 0.92, marginTop: 1 }}>{info.blurb}</p>
        )}
      </div>
      {!revealed && <div className="coup-card-sheen absolute inset-0 pointer-events-none" />}
      {revealed && (
        <div className="absolute inset-0 flex items-center justify-center" style={{ background: "#15130F80" }}>
          <span
            className="coup-stamp"
            style={{
              color: C.sealBright,
              fontSize: 13,
              fontWeight: 800,
              letterSpacing: "0.12em",
              border: `2px solid ${C.sealBright}`,
              borderRadius: 6,
              padding: "3px 10px",
              background: "#15130Fcc",
            }}
          >
            OUT
          </span>
        </div>
      )}
    </div>
  );
}

function PlayerBadge({ p, isMe, isTurn, isTarget }) {
  const alive = isAlive(p);
  return (
    <div
      className={`rounded-lg px-3 py-2 flex items-center gap-2 ${isTurn && alive ? "coup-turn-glow" : ""} ${isTarget ? "coup-pop" : ""}`}
      style={{
        background: isTurn ? "rgba(201, 162, 75, 0.11)" : "rgba(255, 255, 255, 0.055)",
        border: `1px solid ${isTurn ? C.gold : isTarget ? C.seal : "rgba(255, 255, 255, 0.11)"}`,
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.06)",
        opacity: alive ? 1 : 0.45,
      }}
    >
      <div className="flex flex-col min-w-0">
        <span className="flex items-center gap-1 truncate" style={{ color: C.parchment, fontWeight: 600, fontSize: 14 }}>
          {isTurn && <Crown size={13} color={C.gold} className="shrink-0" />}
          <span className="truncate">{p.name}{isMe ? " (you)" : ""}{!alive ? " · out" : ""}</span>
        </span>
        <span className="flex items-center gap-1" style={{ color: C.gold, fontSize: 13 }}>
          <Coins size={12} /> {p.coins}
          <span style={{ color: C.muted, fontSize: 12 }} className="ml-1.5">
            {p.hand.filter((c) => !c.revealed).length} card{p.hand.filter((c) => !c.revealed).length === 1 ? "" : "s"}
          </span>
        </span>
      </div>
      <div className="flex gap-1 ml-auto">
        {p.hand.map((c, i) => (
          <div key={i} className="w-3 h-5 rounded-sm" style={{ background: c.revealed ? "#4a4436" : C.gold, opacity: c.revealed ? 0.4 : 1 }} />
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   MAIN APP
--------------------------------------------------------------- */
export default function App() {
  const [screen, setScreen] = useState("home"); // home | lobby | game
  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [myId, setMyId] = useState(null);
  const [room, setRoom] = useState(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState(null);
  const [pendingAction, setPendingAction] = useState(null);
  const [exchangeKeep, setExchangeKeep] = useState([]);
  const [busy, setBusy] = useState(false);
  const [announce, setAnnounce] = useState(null); // { text, id }
  const [homeStep, setHomeStep] = useState("pin"); // pin | name
  const [homeMode, setHomeMode] = useState("join"); // join | host
  const [now, setNow] = useState(Date.now());
  const pollRef = useRef(null);
  const codeRef = useRef(null);
  const lastLogRef = useRef(null);

  // Announce each new log line as a big banner. The first line we see for
  // a room just primes the ref (no banner for history when you join).
  useEffect(() => {
    if (!room || (room.status !== "playing" && room.status !== "finished")) return;
    const lines = room.log || [];
    const last = lines.length ? lines[lines.length - 1] : null;
    if (last == null) return;
    if (lastLogRef.current === null) { lastLogRef.current = last; return; }
    if (last !== lastLogRef.current) {
      lastLogRef.current = last;
      setAnnounce({ text: last, id: Date.now() + Math.random() });
    }
  }, [room?.log, room?.status]);

  // Auto-dismiss the banner after its animation finishes.
  useEffect(() => {
    if (!announce) return;
    const timer = setTimeout(() => setAnnounce((a) => (a && a.id === announce.id ? null : a)), 3600);
    return () => clearTimeout(timer);
  }, [announce?.id]);

  // Tick while a game runs so the countdown bar re-renders.
  useEffect(() => {
    if (room?.status !== "playing") return;
    const iv = setInterval(() => setNow(Date.now()), 400);
    return () => clearInterval(iv);
  }, [room?.status]);

  // AFK guard: once the deadline passes, any client applies the default
  // move. autoPlay is deterministic, so concurrent writers converge.
  useEffect(() => {
    if (room?.status !== "playing" || !room?.turn?.deadline) return;
    const wait = room.turn.deadline - Date.now() + 500 + Math.random() * 800;
    const timer = setTimeout(() => {
      refresh((r) => {
        if (r.status !== "playing" || !r.turn?.deadline) return;
        if (Date.now() < r.turn.deadline) return; // someone acted meanwhile
        autoPlay(r);
      });
    }, Math.max(400, wait));
    return () => clearTimeout(timer);
  }, [room?.turn?.deadline, room?.status]);

  // restore identity for a room on load
  useEffect(() => {
    const hash = window.location.hash.replace("#", "");
    if (isPin(hash)) setJoinCode(hash);
  }, []);

  const startPolling = useCallback((code) => {
    codeRef.current = code;
    clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const r = await loadRoom(codeRef.current);
      if (r) setRoom(r);
    }, 1200);
  }, []);

  useEffect(() => () => clearInterval(pollRef.current), []);

  async function handleCreate() {
    if (!name.trim()) return setError("Enter your name first.");
    setBusy(true);
    const id = uid();
    const code = roomCodeGen();
    const r = newRoom(code, id, name.trim());
    await saveRoom(r);
    await window.storage.set(`coup:my-id:${code}`, id, false).catch(() => {});
    setMyId(id);
    setRoom(r);
    setScreen("lobby");
    startPolling(code);
    setBusy(false);
  }

  // Step 1 of joining: check the PIN before asking for a name.
  async function checkPin() {
    const code = joinCode.trim();
    if (!isPin(code)) return setError("Game PINs are 6 digits.");
    setBusy(true);
    setError("");
    const existing = await loadRoom(code);
    setBusy(false);
    if (!existing) return setError("No game with that PIN.");
    if (existing.status !== "lobby") return setError("That game already started.");
    setHomeMode("join");
    setHomeStep("name");
  }

  async function handleJoin() {
    if (!name.trim()) return setError("Enter your name first.");
    const code = joinCode.trim();
    setBusy(true);
    setError("");
    const existing = await loadRoom(code);
    if (!existing) { setBusy(false); return setError("No game with that PIN."); }
    if (existing.status !== "lobby") { setBusy(false); return setError("That game already started."); }
    if (existing.players.some((p) => p.name.toLowerCase() === name.trim().toLowerCase())) {
      setBusy(false); return setError("That name is taken.");
    }
    const id = uid();
    addPlayer(existing, id, name.trim());
    await saveRoom(existing);
    await window.storage.set(`coup:my-id:${code}`, id, false).catch(() => {});
    setMyId(id);
    setRoom(existing);
    setScreen("lobby");
    startPolling(code);
    setBusy(false);
  }

  async function refresh(mutator) {
    const r = await loadRoom(codeRef.current);
    if (!r) return;
    const before = JSON.stringify([r.turn, r.turnIndex, r.status]);
    mutator(r);
    // Whenever the turn state changes, whoever must act next gets a
    // fresh AFK deadline.
    if (r.status === "playing" && JSON.stringify([r.turn, r.turnIndex, r.status]) !== before) {
      r.turn.deadline = Date.now() + TURN_SECONDS * 1000;
    }
    await saveRoom(r);
    setRoom(r);
  }

  async function handleStart() {
    await refresh((r) => startGame(r));
    setScreen("game");
  }

  useEffect(() => {
    if (room?.status === "playing" || room?.status === "finished") setScreen("game");
  }, [room?.status]);

  function copyCode() {
    navigator.clipboard?.writeText(room.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function leaveRoom() {
    clearInterval(pollRef.current);
    lastLogRef.current = null;
    setAnnounce(null);
    setScreen("home");
    setRoom(null);
    setMyId(null);
    setName("");
    setJoinCode("");
    setHomeStep("pin");
    setHomeMode("join");
    setError("");
  }

  /* ---------------- render: HOME ---------------- */
  if (screen === "home") {
    return (
      <div className="min-h-screen w-full flex items-center justify-center p-6" style={{ background: PAGE_BG, fontFamily: SANS }}>
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="flex items-center justify-center gap-2 mb-2">
              <Crown color={C.gold} size={28} />
              <h1 style={{ fontFamily: SERIF, color: C.parchment, fontSize: 34, letterSpacing: "0.02em" }}>COUP</h1>
            </div>
            <p style={{ color: C.muted, fontSize: 13 }}>You think your friends is trustworthy enough ?</p>
          </div>

          {homeStep === "pin" ? (
            <div key="pin" className="glass rounded-2xl p-5 mb-4 coup-rise">
              <input
                value={joinCode}
                onChange={(e) => { setJoinCode(e.target.value.replace(/\D/g, "").slice(0, 6)); setError(""); }}
                onKeyDown={(e) => { if (e.key === "Enter" && isPin(joinCode)) checkPin(); }}
                placeholder="Game PIN"
                inputMode="numeric"
                autoComplete="off"
                className="glass-deep w-full rounded-xl px-3 py-3 mb-3 outline-none text-center font-bold"
                style={{
                  color: C.gold,
                  fontSize: 26,
                  letterSpacing: joinCode ? "0.3em" : "0.02em",
                }}
              />
              <Btn onClick={checkPin} disabled={busy || !isPin(joinCode)} full>
                {busy ? <span className="flex items-center justify-center gap-2"><Spinner size={16} color="#1B160E" /> Checking…</span> : "Enter"}
              </Btn>

              <div className="flex items-center gap-2 my-4">
                <div className="h-px flex-1" style={{ background: C.panelLine }} />
                <span style={{ color: C.muted, fontSize: 11 }}>OR</span>
                <div className="h-px flex-1" style={{ background: C.panelLine }} />
              </div>

              <Btn onClick={() => { setHomeMode("host"); setHomeStep("name"); setError(""); }} tone="ghost" disabled={busy} full>
                Host a new game
              </Btn>
            </div>
          ) : (
            <div key="name" className="glass rounded-2xl p-5 mb-4 coup-rise">
              <p className="text-center mb-3" style={{ color: C.muted, fontSize: 13 }}>
                {homeMode === "host" ? "Hosting a new game" : <>Joining game <b style={{ color: C.gold }}>{joinCode}</b></>}
              </p>
              <input
                value={name}
                onChange={(e) => { setName(e.target.value); setError(""); }}
                onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) (homeMode === "host" ? handleCreate : handleJoin)(); }}
                placeholder="Your name"
                maxLength={18}
                autoFocus
                className="glass-deep w-full rounded-xl px-3 py-3 mb-3 outline-none text-center font-semibold"
                style={{ color: C.parchment, fontSize: 20 }}
              />
              <Btn onClick={homeMode === "host" ? handleCreate : handleJoin} disabled={busy || !name.trim()} full>
                {busy
                  ? <span className="flex items-center justify-center gap-2"><Spinner size={16} color="#1B160E" /> {homeMode === "host" ? "Creating…" : "Joining…"}</span>
                  : "Go!"}
              </Btn>
              <div className="text-center mt-3">
                <button onClick={() => { setHomeStep("pin"); setError(""); }} style={{ color: C.muted, fontSize: 13, cursor: "pointer" }}>
                  ← Back
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="text-center rounded-md py-2 px-3 mb-4 coup-pop" style={{ background: "#3a1c1c", color: "#e0a0a0", fontSize: 13 }}>{error}</div>
          )}

          <details className="glass rounded-2xl px-4 py-3">
            <summary style={{ color: C.gold, fontSize: 14, cursor: "pointer", fontWeight: 600 }}>How to play</summary>
            <ul className="mt-2 flex flex-col gap-2" style={{ color: C.muted, fontSize: 13.5, lineHeight: 1.5, paddingLeft: 18, listStyle: "disc" }}>
              <li><b style={{ color: C.parchment }}>2 secret cards</b>, 2 coins. Lose both cards — you're out.</li>
              <li>One action per turn. <b style={{ color: C.parchment }}>Bluffing is allowed.</b></li>
              <li>Smell a bluff? <b style={{ color: C.parchment }}>Challenge.</b> Whoever's wrong loses a card.</li>
              <li>7 coins = <b style={{ color: C.parchment }}>Coup</b>. Unstoppable.</li>
              <li><b style={{ color: C.parchment }}>Last player standing wins.</b></li>
            </ul>
          </details>
        </div>
      </div>
    );
  }

  if (!room) return null;
  const me = room.players.find((p) => p.id === myId);

  /* ---------------- render: LOBBY ---------------- */
  if (screen === "lobby" || (room.status === "lobby")) {
    const isHost = room.hostId === myId;
    return (
      <div className="min-h-screen w-full flex items-center justify-center p-6" style={{ background: PAGE_BG, fontFamily: SANS }}>
        <div className="w-full max-w-md">
          <div className="text-center mb-6">
            <p style={{ color: C.muted, fontSize: 12, letterSpacing: "0.14em" }}>GAME PIN</p>
            <button onClick={copyCode} className="glass mx-auto flex items-center gap-2.5 justify-center mt-2 rounded-2xl px-5 py-2">
              <span style={{ fontFamily: SERIF, color: C.gold, fontSize: 40, letterSpacing: "0.12em", fontWeight: 700 }}>{room.code}</span>
              {copied ? <Check size={20} color={C.moss} /> : <Copy size={18} color={C.muted} />}
            </button>
            <p style={{ color: C.muted, fontSize: 12 }} className="mt-2">Friends enter this PIN to join</p>
          </div>

          <div className="glass rounded-2xl p-4 mb-4">
            <div className="flex items-center gap-2 mb-3" style={{ color: C.muted, fontSize: 12 }}>
              <Users size={14} /> {room.players.length} at the table
            </div>
            <div className="flex flex-col gap-2">
              {room.players.map((p) => (
                <div key={p.id} className="flex items-center justify-between rounded-lg px-3 py-2 coup-rise" style={{ background: "rgba(255, 255, 255, 0.05)", border: "1px solid rgba(255, 255, 255, 0.08)" }}>
                  <span style={{ color: C.parchment, fontSize: 14 }}>{p.name}{p.id === room.hostId ? " · host" : ""}{p.id === myId ? " (you)" : ""}</span>
                </div>
              ))}
            </div>
          </div>

          {isHost ? (
            <Btn onClick={handleStart} disabled={room.players.length < 2} full>
              {room.players.length < 2 ? "Waiting for more players…" : "Start game"}
            </Btn>
          ) : (
            <Waiting>Waiting for the host to start</Waiting>
          )}
          <div className="mt-3 text-center">
            <button onClick={leaveRoom} className="inline-flex items-center gap-1" style={{ color: C.muted, fontSize: 12 }}>
              <LogOut size={12} /> Leave
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ---------------- render: GAME ---------------- */
  const t = room.turn || { phase: "idle" };
  const currentPlayer = room.players[room.turnIndex];
  const myTurn = currentPlayer?.id === myId;
  const finished = room.status === "finished";
  const winner = finished ? room.players.find((p) => p.id === room.winner) : null;

  async function doAction(type) {
    const def = ACTIONS[type];
    if (def.needsTarget && !selectedTarget) { setPendingAction(type); return; }
    await refresh((r) => declareAction(r, myId, type, def.needsTarget ? (selectedTarget || pendingAction?.target) : undefined));
    setSelectedTarget(null);
    setPendingAction(null);
  }

  async function chooseTarget(targetId) {
    if (pendingAction) {
      await refresh((r) => declareAction(r, myId, pendingAction, targetId));
      setPendingAction(null);
      setSelectedTarget(null);
    }
  }

  const myResponse = t.phase === "action-pending" ? t.responses?.[myId] : null;
  const iAmActor = t.action?.actorId === myId;
  const iAmBlocker = t.block?.by === myId;

  return (
    <div className="min-h-screen w-full p-4 md:p-6" style={{ background: PAGE_BG, fontFamily: SANS }}>
      <Announcer event={announce} />

      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Crown color={C.gold} size={20} />
            <span style={{ fontFamily: SERIF, color: C.parchment, fontSize: 20 }}>COUP</span>
            <span style={{ color: C.muted, fontSize: 12 }}>· PIN {room.code}</span>
          </div>
          <button onClick={leaveRoom} className="flex items-center gap-1" style={{ color: C.muted, fontSize: 12 }}>
            <LogOut size={12} /> Leave
          </button>
        </div>

        {finished ? (
          <div className="glass rounded-2xl p-8 text-center coup-pop" style={{ border: `1px solid ${C.gold}88`, boxShadow: `0 12px 40px rgba(0, 0, 0, 0.5), 0 0 30px ${C.gold}22` }}>
            <Crown size={32} color={C.gold} className="mx-auto mb-2" />
            <h2 style={{ fontFamily: SERIF, color: C.gold, fontSize: 26 }}>{winner ? `${winner.name} rules the table` : "Game over"}</h2>
            <div className="mt-5 flex flex-col gap-2 max-w-xs mx-auto">
              <Btn onClick={() => refresh((r) => resetGame(r))} full>Play again</Btn>
              <Btn onClick={leaveRoom} tone="ghost" full>Leave</Btn>
            </div>
          </div>
        ) : (
          <>
            {/* other players */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
              {room.players.filter((p) => p.id !== myId).map((p) => (
                <div key={p.id} onClick={() => pendingAction && isAlive(p) && chooseTarget(p.id)} className={pendingAction && isAlive(p) ? "cursor-pointer" : ""}>
                  <PlayerBadge p={p} isTurn={p.id === currentPlayer?.id} isTarget={pendingAction && isAlive(p)} />
                </div>
              ))}
            </div>

            {/* table log */}
            <div className="glass-deep rounded-2xl p-3 mb-4 h-28 overflow-y-auto">
              {(room.log || []).slice(-8).map((l, i, arr) => (
                <p key={i} style={{ color: i === arr.length - 1 ? C.parchment : C.muted, fontSize: 13 }} className="mb-1">{l}</p>
              ))}
            </div>

            {/* status / prompts — keyed so content animates in on each phase change */}
            <div key={`${t.phase}:${t.action?.type || ""}:${t.block?.by || ""}:${pendingAction || ""}`} className="glass rounded-2xl p-4 mb-4 coup-rise">
              {t.deadline && <TurnTimer deadline={t.deadline} now={now} />}
              {t.phase === "idle" && !pendingAction && (
                myTurn ? (
                  <p className="text-center" style={{ color: C.gold, fontSize: 16, fontWeight: 700 }}>
                    Your turn — pick an action.
                  </p>
                ) : (
                  <Waiting>Waiting for {currentPlayer?.name} to move</Waiting>
                )
              )}

              {pendingAction && (
                <div>
                  <p className="text-center mb-3" style={{ color: C.gold, fontSize: 15, fontWeight: 700 }}>
                    {ACTIONS[pendingAction].label} — pick a target
                  </p>
                  <div className="flex flex-col gap-2 mb-2">
                    {otherAlive(room, myId).map((p) => (
                      <ChoiceBtn
                        key={p.id}
                        tone="seal"
                        title={p.name}
                        right={`${p.coins} coins`}
                        sub={`${p.hand.filter((c) => !c.revealed).length} card${p.hand.filter((c) => !c.revealed).length === 1 ? "" : "s"} left`}
                        onClick={() => chooseTarget(p.id)}
                      />
                    ))}
                  </div>
                  <div className="flex justify-center">
                    <button onClick={() => setPendingAction(null)} className="px-4 py-2" style={{ color: C.muted, fontSize: 14, cursor: "pointer" }}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {t.phase === "action-pending" && (() => {
                const actorName = room.players.find((p) => p.id === t.action.actorId)?.name;
                const targetName = t.action.targetId ? room.players.find((p) => p.id === t.action.targetId)?.name : null;
                const claimedRole = ACTIONS[t.action.type].role;
                const waitingNames = Object.entries(t.responses || {})
                  .filter(([, v]) => v === "pending")
                  .map(([id]) => room.players.find((p) => p.id === id)?.name)
                  .filter(Boolean);
                return (
                  <div>
                    <p className="text-center mb-3" style={{ color: C.parchment, fontSize: 14.5, lineHeight: 1.5 }}>
                      <b style={{ color: C.gold }}>{actorName}</b> {describeAttempt(t.action.type, targetName)}
                    </p>
                    {!iAmActor && myResponse === "pending" && isAlive(me) ? (
                      <div className="flex flex-col gap-2 max-w-md mx-auto">
                        {ACTIONS[t.action.type].challengeable && (
                          <ChoiceBtn
                            tone="seal"
                            title="Challenge"
                            sub={`No ${claimedRole}? They lose a card. Got it? You do.`}
                            onClick={() => refresh((r) => respondToAction(r, myId, "challenge"))}
                          />
                        )}
                        {ACTIONS[t.action.type].blockable && ACTIONS[t.action.type].blockRoles.map((role) => (
                          <ChoiceBtn
                            key={role}
                            tone="ghost"
                            title={`Block as ${role}`}
                            sub="Bluffing allowed — but you can be challenged."
                            onClick={() => refresh((r) => respondToAction(r, myId, "block", role))}
                          />
                        ))}
                        <ChoiceBtn
                          tone="gold"
                          title="Allow"
                          sub="Let it happen."
                          onClick={() => refresh((r) => respondToAction(r, myId, "pass"))}
                        />
                      </div>
                    ) : !isAlive(me) ? (
                      <Waiting spectating>You're out of the game — spectating.</Waiting>
                    ) : iAmActor ? (
                      <Waiting>
                        Anyone challenge or block? Waiting for {waitingNames.join(", ") || "others"}
                      </Waiting>
                    ) : (
                      <Waiting>Waiting for {waitingNames.join(", ") || "others"}</Waiting>
                    )}
                  </div>
                );
              })()}

              {t.phase === "block-pending" && (() => {
                const blockerName = room.players.find((p) => p.id === t.block.by)?.name;
                return (
                  <div>
                    <p className="text-center mb-3" style={{ color: C.parchment, fontSize: 14.5, lineHeight: 1.5 }}>
                      <b style={{ color: C.gold }}>{blockerName}</b> claims the <b style={{ color: C.gold }}>{t.block.role}</b> to block. Believe them?
                    </p>
                    {iAmActor ? (
                      <div className="flex flex-col gap-2 max-w-md mx-auto">
                        <ChoiceBtn
                          tone="seal"
                          title="Challenge the block"
                          sub={`No ${t.block.role}? They lose a card, your action goes through.`}
                          onClick={() => refresh((r) => respondToBlock(r, myId, "challenge"))}
                        />
                        <ChoiceBtn
                          tone="gold"
                          title="Accept"
                          sub="Back down — action stopped."
                          onClick={() => refresh((r) => respondToBlock(r, myId, "accept"))}
                        />
                      </div>
                    ) : (
                      <Waiting>
                        Waiting for {room.players.find((p) => p.id === t.action.actorId)?.name} to accept or challenge the block
                      </Waiting>
                    )}
                  </div>
                );
              })()}

              {t.phase === "lose-influence" && (
                <div>
                  {t.pendingLoss.includes(myId) ? (
                    <div>
                      <p className="text-center mb-1" style={{ color: C.sealBright, fontSize: 15, fontWeight: 700 }}>You lose a card!</p>
                      <p className="text-center mb-3" style={{ color: C.muted, fontSize: 13 }}>
                        Tap one to give it up.
                      </p>
                      <div className="flex gap-3 justify-center flex-wrap">
                        {me.hand.map((c, i) => !c.revealed && (
                          <div key={i} onClick={() => refresh((r) => pickLoseCard(r, myId, i))} className="cursor-pointer active:scale-95 transition-transform">
                            <CardTile role={c.role} revealed={false} />
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <Waiting>
                      Waiting for {room.players.find((p) => t.pendingLoss.includes(p.id))?.name} to give up a card
                    </Waiting>
                  )}
                </div>
              )}

              {t.phase === "exchange" && (
                <div>
                  {t.actorId === myId ? (
                    <ExchangePicker
                      hand={me.hand.filter((c) => !c.revealed)}
                      drawn={t.drawn}
                      onConfirm={(keep) => refresh((r) => completeExchange(r, myId, keep))}
                    />
                  ) : (
                    <Waiting>
                      {room.players.find((p) => p.id === t.actorId)?.name} is choosing new cards
                    </Waiting>
                  )}
                </div>
              )}
            </div>

            {/* my hand + actions */}
            <div className="glass rounded-2xl p-4">
              <div className="flex items-center justify-between mb-2 flex-wrap gap-1">
                <span className="flex items-center gap-1.5" style={{ color: C.parchment, fontSize: 14, fontWeight: 700 }}>
                  <Eye size={14} color={C.muted} /> Your secret cards
                </span>
                <span className="flex items-center gap-1" style={{ color: C.gold, fontSize: 16, fontWeight: 700 }}>
                  <Coins size={16} /> {me?.coins ?? 0} coins
                </span>
              </div>
              <p className="mb-3" style={{ color: C.muted, fontSize: 12.5 }}>
                {isAlive(me) ? "Only you can see these." : "You're out — spectating."}
              </p>
              <div className="flex gap-3 mb-4 flex-wrap justify-center sm:justify-start">
                {me?.hand.map((c, i) => (
                  <div key={i} className="coup-deal" style={{ animationDelay: `${i * 0.12}s` }}>
                    <CardTile role={c.role} revealed={c.revealed} />
                  </div>
                ))}
              </div>

              {myTurn && t.phase === "idle" && isAlive(me) && !pendingAction && (
                <div>
                  {me.coins >= 10 ? (
                    <p className="mb-2 text-center" style={{ color: C.sealBright, fontSize: 13, fontWeight: 600 }}>
                      10+ coins — you must Coup.
                    </p>
                  ) : (
                    <p className="mb-2" style={{ color: C.muted, fontSize: 12.5 }}>
                      Role actions need that card — <b style={{ color: C.parchment }}>bluffing is allowed</b>.
                    </p>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {ACTION_ORDER.map((type) => {
                      const def = ACTIONS[type];
                      const help = ACTION_HELP[type];
                      const mustCoup = me.coins >= 10;
                      const disabled = mustCoup ? type !== "coup" : def.cost > me.coins;
                      const aggressive = type === "coup" || type === "assassinate";
                      return (
                        <ChoiceBtn
                          key={type}
                          tone={aggressive ? "seal" : def.role ? "ghost" : "gold"}
                          title={def.role ? `${def.label} · ${def.role}` : def.label}
                          right={help.tag}
                          sub={help.desc}
                          disabled={disabled}
                          onClick={() => doAction(type)}
                        />
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* role reference */}
            <details className="mt-4">
              <summary style={{ color: C.muted, fontSize: 12, cursor: "pointer" }}>Role reference</summary>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                {ROLES.map((r) => (
                  <div key={r} className="rounded-lg px-3 py-2 flex items-center gap-2.5" style={{ background: "rgba(255, 255, 255, 0.04)", border: "1px solid rgba(255, 255, 255, 0.09)" }}>
                    <img
                      src={ROLE_IMG[r]}
                      alt={r}
                      className="shrink-0 object-cover"
                      style={{ width: 30, height: 42, borderRadius: 5, border: `1px solid ${ROLE_INFO[r].color}88` }}
                    />
                    <div className="min-w-0">
                      <span style={{ color: ROLE_INFO[r].color, fontWeight: 700, fontSize: 12 }}>{r}</span>
                      <p style={{ color: C.muted, fontSize: 11.5 }}>{ROLE_INFO[r].blurb}</p>
                    </div>
                  </div>
                ))}
              </div>
            </details>
          </>
        )}
      </div>
    </div>
  );
}

function ExchangePicker({ hand, drawn, onConfirm }) {
  const pool = [...hand.map((c) => c.role), ...drawn];
  const keepCount = hand.length;
  const [sel, setSel] = useState([]);
  function toggle(i) {
    setSel((s) => (s.includes(i) ? s.filter((x) => x !== i) : s.length < keepCount ? [...s, i] : s));
  }
  return (
    <div>
      <p className="text-center mb-1" style={{ color: C.gold, fontSize: 15, fontWeight: 700 }}>
        Pick {keepCount} card{keepCount > 1 ? "s" : ""} to keep
      </p>
      <p className="text-center mb-3" style={{ color: C.muted, fontSize: 13 }}>
        The rest go back in the deck.
      </p>
      <div className="flex gap-2 justify-center flex-wrap mb-3">
        {pool.map((role, i) => (
          <div key={i} onClick={() => toggle(i)} className="cursor-pointer relative">
            <CardTile role={role} revealed={false} />
            {sel.includes(i) && (
              <div className="absolute -top-1 -right-1 rounded-full w-5 h-5 flex items-center justify-center" style={{ background: C.gold }}>
                <Check size={12} color="#1B160E" />
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="flex justify-center">
        <Btn onClick={() => onConfirm(sel)} disabled={sel.length !== keepCount}>Confirm</Btn>
      </div>
    </div>
  );
}
