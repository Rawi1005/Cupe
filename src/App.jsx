import React, { useState, useEffect, useRef, useCallback } from "react";
import { Crown, Skull, Swords, Coins, Users, Copy, Check, ShieldAlert, Eye, EyeOff, LogOut } from "lucide-react";

/* ---------------------------------------------------------------
   THEME — a smoky back-room card table: charcoal felt, brass, wax-seal red
--------------------------------------------------------------- */
const C = {
  bg: "#15130F",
  felt: "#1B2620",
  feltDark: "#121B16",
  panel: "#211C16",
  panelLine: "#3A3227",
  gold: "#C9A24B",
  goldDim: "#8A7038",
  parchment: "#E9E0C9",
  muted: "#9A9080",
  seal: "#8A2A2A",
  sealBright: "#B23A3A",
  steel: "#4C6B7A",
  moss: "#5C7A4E",
  plum: "#6B4E7A",
};

const ROLE_INFO = {
  Duke: { blurb: "Collects Tax (+3 coins). Blocks Foreign Aid.", color: C.gold },
  Assassin: { blurb: "Pay 3 coins to assassinate — target loses an influence.", color: C.seal },
  Captain: { blurb: "Steals 2 coins from another player. Blocks stealing.", color: C.steel },
  Ambassador: { blurb: "Exchanges cards with the deck. Blocks stealing.", color: C.moss },
  Contessa: { blurb: "Blocks assassination.", color: C.plum },
};
const ROLES = Object.keys(ROLE_INFO);

const ACTIONS = {
  income: { label: "Income", gain: 1, cost: 0, challengeable: false, blockable: false },
  foreignAid: { label: "Foreign Aid", gain: 2, cost: 0, challengeable: false, blockable: true, blockRoles: ["Duke"] },
  coup: { label: "Coup", gain: 0, cost: 7, challengeable: false, blockable: false, needsTarget: true },
  tax: { label: "Tax", role: "Duke", gain: 3, cost: 0, challengeable: true, blockable: false },
  assassinate: { label: "Assassinate", role: "Assassin", gain: 0, cost: 3, challengeable: true, blockable: true, blockRoles: ["Contessa"], needsTarget: true },
  steal: { label: "Steal", role: "Captain", gain: 0, cost: 0, challengeable: true, blockable: true, blockRoles: ["Captain", "Ambassador"], needsTarget: true },
  exchange: { label: "Exchange", role: "Ambassador", gain: 0, cost: 0, challengeable: true, blockable: false },
};

/* ---------------------------------------------------------------
   helpers
--------------------------------------------------------------- */
const uid = () => Math.random().toString(36).slice(2, 10);
const roomCodeGen = () => Array.from({ length: 4 }, () => "BCDFGHJKLMNPQRSTVWXYZ"[Math.floor(Math.random() * 21)]).join("");
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
function Btn({ children, onClick, tone = "gold", disabled, small }) {
  const tones = {
    gold: { bg: C.gold, fg: "#1B160E", border: C.gold },
    seal: { bg: C.seal, fg: C.parchment, border: C.sealBright },
    ghost: { bg: "transparent", fg: C.parchment, border: C.panelLine },
  };
  const s = tones[tone];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md font-semibold transition-all ${small ? "px-3 py-1.5 text-sm" : "px-4 py-2 text-sm"}`}
      style={{
        background: disabled ? "#3a352c" : s.bg,
        color: disabled ? "#8a8070" : s.fg,
        border: `1px solid ${disabled ? "#3a352c" : s.border}`,
        opacity: disabled ? 0.6 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
        letterSpacing: "0.02em",
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.filter = "brightness(1.12)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.filter = "none"; }}
    >
      {children}
    </button>
  );
}

function CardTile({ role, revealed, faceDown, size = "md" }) {
  const info = ROLE_INFO[role] || { color: C.muted };
  const dims = size === "sm" ? "w-16 h-24 text-[10px]" : "w-24 h-36 text-xs";
  if (faceDown) {
    return (
      <div
        className={`${dims} rounded-lg flex items-center justify-center shrink-0`}
        style={{
          background: `repeating-linear-gradient(135deg, ${C.panel}, ${C.panel} 6px, #2a241b 6px, #2a241b 12px)`,
          border: `1px solid ${C.panelLine}`,
        }}
      >
        <Crown size={size === "sm" ? 14 : 20} color={C.goldDim} />
      </div>
    );
  }
  return (
    <div
      className={`${dims} rounded-lg flex flex-col items-center justify-between p-2 shrink-0 relative`}
      style={{
        background: revealed ? "#211a17" : `linear-gradient(160deg, ${info.color}22, ${C.panel})`,
        border: `1px solid ${revealed ? C.panelLine : info.color}`,
        opacity: revealed ? 0.55 : 1,
      }}
    >
      <div className="w-full text-center font-bold" style={{ color: info.color, fontFamily: "'Playfair Display', serif", fontSize: size === "sm" ? 11 : 14 }}>
        {role}
      </div>
      <Swords size={size === "sm" ? 14 : 20} color={info.color} style={{ opacity: 0.8 }} />
      {revealed && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span style={{ color: C.seal, fontSize: 10, fontWeight: 700, letterSpacing: "0.1em" }}>REVEALED</span>
        </div>
      )}
    </div>
  );
}

function PlayerBadge({ p, isMe, isTurn, isTarget }) {
  const alive = isAlive(p);
  return (
    <div
      className="rounded-lg px-3 py-2 flex items-center gap-2"
      style={{
        background: isTurn ? "#2a2416" : C.panel,
        border: `1px solid ${isTurn ? C.gold : isTarget ? C.seal : C.panelLine}`,
        opacity: alive ? 1 : 0.45,
      }}
    >
      <div className="flex flex-col">
        <span style={{ color: C.parchment, fontWeight: 600, fontSize: 13 }}>
          {p.name}{isMe ? " (you)" : ""}{!alive ? " · out" : ""}
        </span>
        <span className="flex items-center gap-1" style={{ color: C.gold, fontSize: 12 }}>
          <Coins size={11} /> {p.coins}
        </span>
      </div>
      <div className="flex gap-1 ml-1">
        {p.hand.map((c, i) => (
          <div key={i} className="w-2.5 h-4 rounded-sm" style={{ background: c.revealed ? "#4a4436" : C.gold, opacity: c.revealed ? 0.4 : 1 }} />
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
  const pollRef = useRef(null);
  const codeRef = useRef(null);

  // restore identity for a room on load
  useEffect(() => {
    const hash = window.location.hash.replace("#", "");
    if (hash && hash.length === 4) setJoinCode(hash.toUpperCase());
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

  async function handleJoin() {
    if (!name.trim()) return setError("Enter your name first.");
    const code = joinCode.trim().toUpperCase();
    if (code.length !== 4) return setError("Room codes are 4 letters.");
    setBusy(true);
    setError("");
    const existing = await loadRoom(code);
    if (!existing) { setBusy(false); return setError("No room with that code."); }
    if (existing.status !== "lobby") { setBusy(false); return setError("That game has already started."); }
    if (existing.players.some((p) => p.name.toLowerCase() === name.trim().toLowerCase())) {
      setBusy(false); return setError("That name is taken at this table.");
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
    mutator(r);
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
    setScreen("home");
    setRoom(null);
    setMyId(null);
    setName("");
    setJoinCode("");
  }

  /* ---------------- render: HOME ---------------- */
  if (screen === "home") {
    return (
      <div className="min-h-screen w-full flex items-center justify-center p-6" style={{ background: `radial-gradient(ellipse at top, #241f16, ${C.bg})`, fontFamily: "'Inter', sans-serif" }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=Inter:wght@400;500;600;700&display=swap');`}</style>
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="flex items-center justify-center gap-2 mb-2">
              <Crown color={C.gold} size={28} />
              <h1 style={{ fontFamily: "'Playfair Display', serif", color: C.parchment, fontSize: 34, letterSpacing: "0.02em" }}>COUP</h1>
            </div>
            <p style={{ color: C.muted, fontSize: 13 }}>Bluff, block, and betray your way to the throne.</p>
          </div>

          <div className="rounded-xl p-5 mb-4" style={{ background: C.panel, border: `1px solid ${C.panelLine}` }}>
            <label className="block mb-1.5" style={{ color: C.muted, fontSize: 12 }}>Your name</label>
            <input
              value={name}
              onChange={(e) => { setName(e.target.value); setError(""); }}
              placeholder="e.g. Duchess Marlowe"
              maxLength={18}
              className="w-full rounded-md px-3 py-2 mb-4 outline-none"
              style={{ background: C.feltDark, color: C.parchment, border: `1px solid ${C.panelLine}` }}
            />

            <Btn onClick={handleCreate} disabled={busy}>Create a room</Btn>

            <div className="flex items-center gap-2 my-4">
              <div className="h-px flex-1" style={{ background: C.panelLine }} />
              <span style={{ color: C.muted, fontSize: 11 }}>OR</span>
              <div className="h-px flex-1" style={{ background: C.panelLine }} />
            </div>

            <label className="block mb-1.5" style={{ color: C.muted, fontSize: 12 }}>Room code</label>
            <input
              value={joinCode}
              onChange={(e) => { setJoinCode(e.target.value.toUpperCase()); setError(""); }}
              placeholder="ABCD"
              maxLength={4}
              className="w-full rounded-md px-3 py-2 mb-3 outline-none tracking-[0.3em] text-center font-bold"
              style={{ background: C.feltDark, color: C.gold, border: `1px solid ${C.panelLine}` }}
            />
            <Btn onClick={handleJoin} tone="ghost" disabled={busy}>Join room</Btn>
          </div>

          {error && (
            <div className="text-center rounded-md py-2 px-3" style={{ background: "#3a1c1c", color: "#e0a0a0", fontSize: 13 }}>{error}</div>
          )}
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
      <div className="min-h-screen w-full flex items-center justify-center p-6" style={{ background: `radial-gradient(ellipse at top, #241f16, ${C.bg})`, fontFamily: "'Inter', sans-serif" }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=Inter:wght@400;500;600;700&display=swap');`}</style>
        <div className="w-full max-w-md">
          <div className="text-center mb-6">
            <p style={{ color: C.muted, fontSize: 12 }}>ROOM CODE</p>
            <button onClick={copyCode} className="mx-auto flex items-center gap-2 justify-center mt-1">
              <span style={{ fontFamily: "'Playfair Display', serif", color: C.gold, fontSize: 40, letterSpacing: "0.15em" }}>{room.code}</span>
              {copied ? <Check size={20} color={C.moss} /> : <Copy size={18} color={C.muted} />}
            </button>
            <p style={{ color: C.muted, fontSize: 12 }} className="mt-1">Share this code with your friends</p>
          </div>

          <div className="rounded-xl p-4 mb-4" style={{ background: C.panel, border: `1px solid ${C.panelLine}` }}>
            <div className="flex items-center gap-2 mb-3" style={{ color: C.muted, fontSize: 12 }}>
              <Users size={14} /> {room.players.length} at the table
            </div>
            <div className="flex flex-col gap-2">
              {room.players.map((p) => (
                <div key={p.id} className="flex items-center justify-between rounded-md px-3 py-2" style={{ background: C.feltDark }}>
                  <span style={{ color: C.parchment, fontSize: 14 }}>{p.name}{p.id === room.hostId ? " · host" : ""}{p.id === myId ? " (you)" : ""}</span>
                </div>
              ))}
            </div>
          </div>

          {isHost ? (
            <Btn onClick={handleStart} disabled={room.players.length < 2}>
              {room.players.length < 2 ? "Waiting for more players…" : "Start the game"}
            </Btn>
          ) : (
            <p className="text-center" style={{ color: C.muted, fontSize: 13 }}>Waiting for the host to start…</p>
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
    <div className="min-h-screen w-full p-4 md:p-6" style={{ background: `radial-gradient(ellipse at top, ${C.felt}, ${C.feltDark})`, fontFamily: "'Inter', sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=Inter:wght@400;500;600;700&display=swap');`}</style>

      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Crown color={C.gold} size={20} />
            <span style={{ fontFamily: "'Playfair Display', serif", color: C.parchment, fontSize: 20 }}>COUP</span>
            <span style={{ color: C.muted, fontSize: 12 }}>· room {room.code}</span>
          </div>
          <button onClick={leaveRoom} className="flex items-center gap-1" style={{ color: C.muted, fontSize: 12 }}>
            <LogOut size={12} /> Leave
          </button>
        </div>

        {finished ? (
          <div className="rounded-xl p-8 text-center" style={{ background: C.panel, border: `1px solid ${C.gold}` }}>
            <Crown size={32} color={C.gold} className="mx-auto mb-2" />
            <h2 style={{ fontFamily: "'Playfair Display', serif", color: C.gold, fontSize: 26 }}>{winner ? `${winner.name} rules the table` : "Game over"}</h2>
            <p style={{ color: C.muted, fontSize: 13 }} className="mt-2">Every other influence has fallen.</p>
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
            <div className="rounded-xl p-3 mb-4 h-28 overflow-y-auto" style={{ background: "#0f0d0a", border: `1px solid ${C.panelLine}` }}>
              {(room.log || []).slice(-8).map((l, i) => (
                <p key={i} style={{ color: C.muted, fontSize: 12.5 }} className="mb-1">{l}</p>
              ))}
            </div>

            {/* status / prompts */}
            <div className="rounded-xl p-4 mb-4" style={{ background: C.panel, border: `1px solid ${C.panelLine}` }}>
              {t.phase === "idle" && (
                <p className="text-center" style={{ color: myTurn ? C.gold : C.muted, fontSize: 14, fontWeight: 600 }}>
                  {myTurn ? "Your move." : `Waiting on ${currentPlayer?.name}…`}
                </p>
              )}

              {pendingAction && (
                <p className="text-center mb-2" style={{ color: C.gold, fontSize: 13 }}>Choose a target for {ACTIONS[pendingAction].label}</p>
              )}

              {t.phase === "action-pending" && (
                <div>
                  <p className="text-center mb-3" style={{ color: C.parchment, fontSize: 13 }}>
                    {room.players.find((p) => p.id === t.action.actorId)?.name} is attempting <b style={{ color: C.gold }}>{ACTIONS[t.action.type].label}</b>
                    {t.action.targetId ? ` on ${room.players.find((p) => p.id === t.action.targetId)?.name}` : ""}.
                  </p>
                  {!iAmActor && myResponse === "pending" && isAlive(me) ? (
                    <div className="flex flex-wrap gap-2 justify-center">
                      {ACTIONS[t.action.type].challengeable && (
                        <Btn tone="seal" small onClick={() => refresh((r) => respondToAction(r, myId, "challenge"))}>
                          <span className="flex items-center gap-1"><ShieldAlert size={13} /> Challenge</span>
                        </Btn>
                      )}
                      {ACTIONS[t.action.type].blockable && ACTIONS[t.action.type].blockRoles
                        .filter((role) => t.action.type !== "steal" || true)
                        .map((role) => (
                        <Btn key={role} tone="ghost" small onClick={() => refresh((r) => respondToAction(r, myId, "block", role))}>
                          Block ({role})
                        </Btn>
                      ))}
                      <Btn tone="gold" small onClick={() => refresh((r) => respondToAction(r, myId, "pass"))}>Allow</Btn>
                    </div>
                  ) : (
                    <p className="text-center" style={{ color: C.muted, fontSize: 12 }}>
                      {isAlive(me) ? "Waiting on other players…" : "You're out of the game."}
                    </p>
                  )}
                </div>
              )}

              {t.phase === "block-pending" && (
                <div>
                  <p className="text-center mb-3" style={{ color: C.parchment, fontSize: 13 }}>
                    {room.players.find((p) => p.id === t.block.by)?.name} claims <b style={{ color: C.gold }}>{t.block.role}</b> to block.
                  </p>
                  {iAmActor ? (
                    <div className="flex gap-2 justify-center">
                      <Btn tone="seal" small onClick={() => refresh((r) => respondToBlock(r, myId, "challenge"))}>
                        <span className="flex items-center gap-1"><ShieldAlert size={13} /> Challenge block</span>
                      </Btn>
                      <Btn tone="gold" small onClick={() => refresh((r) => respondToBlock(r, myId, "accept"))}>Accept block</Btn>
                    </div>
                  ) : (
                    <p className="text-center" style={{ color: C.muted, fontSize: 12 }}>Waiting on {room.players.find(p=>p.id===t.action.actorId)?.name}…</p>
                  )}
                </div>
              )}

              {t.phase === "lose-influence" && (
                <div>
                  {t.pendingLoss.includes(myId) ? (
                    <div>
                      <p className="text-center mb-3" style={{ color: C.seal, fontSize: 13, fontWeight: 600 }}>Choose an influence to reveal and lose.</p>
                      <div className="flex gap-3 justify-center">
                        {me.hand.map((c, i) => !c.revealed && (
                          <div key={i} onClick={() => refresh((r) => pickLoseCard(r, myId, i))} className="cursor-pointer">
                            <CardTile role={c.role} revealed={false} />
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="text-center" style={{ color: C.muted, fontSize: 12 }}>
                      Waiting on {room.players.find((p) => t.pendingLoss.includes(p.id))?.name} to lose an influence…
                    </p>
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
                    <p className="text-center" style={{ color: C.muted, fontSize: 12 }}>
                      {room.players.find((p) => p.id === t.actorId)?.name} is choosing new influence…
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* my hand + actions */}
            <div className="rounded-xl p-4" style={{ background: C.panel, border: `1px solid ${C.panelLine}` }}>
              <div className="flex items-center justify-between mb-3">
                <span className="flex items-center gap-1" style={{ color: C.gold, fontSize: 15, fontWeight: 700 }}><Coins size={15} /> {me?.coins ?? 0} coins</span>
                <span style={{ color: C.muted, fontSize: 12 }}>{isAlive(me) ? "" : "You're out — spectating"}</span>
              </div>
              <div className="flex gap-2 mb-4">
                {me?.hand.map((c, i) => <CardTile key={i} role={c.role} revealed={c.revealed} size="sm" />)}
              </div>

              {myTurn && t.phase === "idle" && isAlive(me) && (
                <div>
                  {me.coins >= 10 ? (
                    <p className="mb-2 text-center" style={{ color: C.seal, fontSize: 12 }}>10+ coins — you must Coup.</p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <Btn small onClick={() => doAction("income")} disabled={me.coins >= 10}>Income (+1)</Btn>
                    <Btn small tone="ghost" onClick={() => doAction("foreignAid")} disabled={me.coins >= 10}>Foreign Aid (+2)</Btn>
                    <Btn small tone="seal" onClick={() => setPendingAction("coup")} disabled={me.coins < 7}>Coup (-7)</Btn>
                    <Btn small tone="ghost" onClick={() => doAction("tax")} disabled={me.coins >= 10}>Tax · Duke (+3)</Btn>
                    <Btn small tone="seal" onClick={() => setPendingAction("assassinate")} disabled={me.coins < 3 || me.coins >= 10}>Assassinate · 3</Btn>
                    <Btn small tone="ghost" onClick={() => setPendingAction("steal")} disabled={me.coins >= 10}>Steal · Captain</Btn>
                    <Btn small tone="ghost" onClick={() => doAction("exchange")} disabled={me.coins >= 10}>Exchange · Ambassador</Btn>
                  </div>
                  {pendingAction && (
                    <p className="mt-2 text-center" style={{ color: C.gold, fontSize: 12 }}>Tap a player above to target them.</p>
                  )}
                </div>
              )}
            </div>

            {/* role reference */}
            <details className="mt-4">
              <summary style={{ color: C.muted, fontSize: 12, cursor: "pointer" }}>Role reference</summary>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                {ROLES.map((r) => (
                  <div key={r} className="rounded-md px-3 py-2" style={{ background: C.feltDark, border: `1px solid ${C.panelLine}` }}>
                    <span style={{ color: ROLE_INFO[r].color, fontWeight: 700, fontSize: 12 }}>{r}</span>
                    <p style={{ color: C.muted, fontSize: 11.5 }}>{ROLE_INFO[r].blurb}</p>
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
      <p className="text-center mb-3" style={{ color: C.parchment, fontSize: 13 }}>Pick {keepCount} card{keepCount > 1 ? "s" : ""} to keep.</p>
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
