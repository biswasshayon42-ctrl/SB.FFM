import React, { useRef, useState } from 'react';
import {
  Camera,
  Crosshair,
  Eye,
  Film,
  Heart,
  Mic,
  MicOff,
  Orbit,
  Pause,
  Play,
  RotateCcw,
  Send,
  Shield,
  SkipBack,
  SkipForward,
  Smartphone,
  Trophy,
  Video,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { COLLECTION_ITEMS, GAME_MODES, MAPS, WEAPONS } from '../shared/catalog';
import type {
  MatchReplayRecord,
  MatchResultPayload,
  MatchSettings,
  ReplayCameraPerspective,
  UserLoadout,
} from '../shared/types';
import { soundEngine } from '../game/soundEngine';
import { getLatestMatchReplay, loadStoredReplays } from '../lib/replayStorage';
import {
  BattleArenaCanvas,
  type HudSnapshot,
  type PeerStatePacket,
  type VirtualInputState,
} from './BattleArenaCanvas';
import { ReplayTheaterCanvas, type ReplayTelemetryHud } from './ReplayTheaterCanvas';

interface ChatMessage {
  username: string;
  text: string;
  ts: number;
}

interface Props {
  settings: MatchSettings;
  loadout: UserLoadout;
  username: string;
  onExitMatch: (result?: MatchResultPayload) => void;
  onReplayMatch: () => void;
  sendWsMessage?: (payload: Record<string, unknown>) => void;
  peerStatesRef: React.MutableRefObject<Map<string, PeerStatePacket>>;
  chatMessages: ChatMessage[];
}

const INITIAL_HUD: HudSnapshot = {
  hp: 100,
  maxHp: 100,
  shield: 50,
  maxShield: 50,
  ammo: 32,
  magSize: 32,
  reloading: false,
  medkits: 3,
  weaponIndex: 0,
  weaponName: 'SF-47 Vanguard',
  kills: 0,
  aliveCount: 12,
  wave: 1,
  teamScore: 0,
  enemyScore: 0,
  zoneRadius: 82,
  inStorm: false,
  isParachuting: false,
  inVehicle: false,
  nearInteract: null,
  adsActive: false,
  damageFlash: 0,
  hitmarker: 'none',
  killFeed: [],
  minimapEntities: [],
  playerPos: { x: 0, z: 32, yaw: 0 },
};

export const MatchView: React.FC<Props> = ({
  settings,
  loadout,
  username,
  onExitMatch,
  onReplayMatch,
  sendWsMessage,
  peerStatesRef,
  chatMessages,
}) => {
  const [hud, setHud] = useState<HudSnapshot>(INITIAL_HUD);
  const [paused, setPaused] = useState(false);
  const [matchResult, setMatchResult] = useState<MatchResultPayload | null>(null);
  const [latestReplay, setLatestReplay] = useState<MatchReplayRecord | null>(() =>
    getLatestMatchReplay()
  );
  const [storedReplays, setStoredReplays] = useState<MatchReplayRecord[]>(() =>
    loadStoredReplays()
  );
  const [activeReplay, setActiveReplay] = useState<MatchReplayRecord | null>(null);
  const [replayPerspective, setReplayPerspective] = useState<ReplayCameraPerspective>('chase');
  const [replayPlaying, setReplayPlaying] = useState(true);
  const [replaySpeed, setReplaySpeed] = useState<number>(1);
  const [replayTime, setReplayTime] = useState<number>(0);
  const [replayHud, setReplayHud] = useState<ReplayTelemetryHud>({
    hp: 100,
    shield: 50,
    weaponName: 'SF-47 Vanguard',
    zoneRadius: 82,
    aliveCount: 1,
    inVehicle: false,
    isParachuting: false,
  });
  const [mutedAudio, setMutedAudio] = useState(soundEngine.muted);
  const [micMuted, setMicMuted] = useState(true);
  const [touchHud, setTouchHud] = useState(() =>
    typeof window !== 'undefined' && ('ontouchstart' in window || window.innerWidth < 900)
  );
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');

  const replayFlushRef = useRef<(() => MatchReplayRecord | null) | null>(null);

  const virtualInputRef = useRef<VirtualInputState>({
    moveX: 0,
    moveY: 0,
    lookDeltaX: 0,
    lookDeltaY: 0,
    firing: false,
    ads: false,
    sprint: false,
  });

  const actionTriggerRef = useRef<{
    jump: boolean;
    reload: boolean;
    interact: boolean;
    medkit: boolean;
    emote: boolean;
    switchSlot: number | null;
  }>({
    jump: false,
    reload: false,
    interact: false,
    medkit: false,
    emote: false,
    switchSlot: null,
  });

  const joyOriginRef = useRef<{ x: number; y: number } | null>(null);
  const lookTouchRef = useRef<{ x: number; y: number } | null>(null);

  const modeDef = GAME_MODES.find((m) => m.id === settings.mode);
  const mapDef = MAPS.find((m) => m.id === settings.mapId);
  const victoryAnim = COLLECTION_ITEMS.find((i) => i.id === loadout.victoryAnimId);

  const slots = [
    WEAPONS.find((w) => w.id === loadout.primaryWeaponId) || WEAPONS[0],
    WEAPONS.find((w) => w.id === loadout.secondaryWeaponId) || WEAPONS[5],
    WEAPONS.find((w) => w.id === loadout.meleeWeaponId) || WEAPONS[7],
  ];

  const handleToggleAudio = () => {
    const next = !mutedAudio;
    soundEngine.setMuted(next);
    setMutedAudio(next);
  };

  const handleToggleMic = () => {
    const next = !micMuted;
    setMicMuted(next);
    sendWsMessage?.({ type: 'voice:status', muted: next, channel: 'squad' });
  };

  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    sendWsMessage?.({ type: 'match:chat', text: chatInput.trim() });
    setChatInput('');
  };

  const openReplayTheater = (record: MatchReplayRecord | null) => {
    if (!record || record.frames.length === 0) return;
    if (document.pointerLockElement) document.exitPointerLock();
    setPaused(false);
    setActiveReplay(record);
    setReplayPerspective('chase');
    setReplayTime(0);
    setReplaySpeed(1);
    setReplayPlaying(true);
  };

  if (activeReplay) {
    const rFrames = activeReplay.frames;
    const rStart = rFrames[0]?.t ?? 0;
    const rEnd = rFrames[rFrames.length - 1]?.t ?? rStart;
    const rDuration = Math.max(0.1, rEnd - rStart);
    const rModeDef = GAME_MODES.find((m) => m.id === activeReplay.mode);
    const rMapDef = MAPS.find((m) => m.id === activeReplay.mapId);

    const perspectives: {
      id: ReplayCameraPerspective;
      label: string;
      icon: React.ReactNode;
    }[] = [
      { id: 'chase', label: 'Chase Cam', icon: <Video className="w-3.5 h-3.5" /> },
      { id: 'orbit', label: 'Cinematic Orbit', icon: <Orbit className="w-3.5 h-3.5" /> },
      { id: 'overhead', label: 'Tactical Drone', icon: <Camera className="w-3.5 h-3.5" /> },
      { id: 'first_person', label: 'First-Person', icon: <Eye className="w-3.5 h-3.5" /> },
    ];

    const togglePlay = () => {
      if (!replayPlaying && replayTime >= rDuration - 0.05) {
        setReplayTime(0);
      }
      setReplayPlaying((p) => !p);
    };

    const seekBy = (delta: number) => {
      setReplayTime((prev) => Math.max(0, Math.min(rDuration, prev + delta)));
    };

    const jumpToHighlight = (absT: number) => {
      const target = Math.max(0, Math.min(rDuration, absT - rStart - 1.2));
      setReplayTime(target);
      setReplayPlaying(true);
    };

    return (
      <div className="relative w-full h-full bg-[#070a10] overflow-hidden select-none">
        <ReplayTheaterCanvas
          replay={activeReplay}
          perspective={replayPerspective}
          playing={replayPlaying}
          speed={replaySpeed}
          currentTime={replayTime}
          onTimeChange={setReplayTime}
          onPlayingChange={setReplayPlaying}
          onTelemetryUpdate={setReplayHud}
        />

        {/* Replay Theater HUD */}
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-3 sm:p-4">
          {/* Top Bar: Telemetry + Perspective Switcher + Exit */}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="pointer-events-auto flex flex-col gap-1.5">
              <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg bg-[#0b101b]/95 border border-amber-500/50 text-xs">
                <Film className="w-4 h-4 text-amber-400" />
                <span className="font-bold text-amber-300 uppercase tracking-wide">
                  60s Replay Theater
                </span>
                <span className="text-slate-600">·</span>
                <span className="text-white font-semibold">{rMapDef?.name}</span>
                <span className="text-slate-500 hidden sm:inline">({rModeDef?.name})</span>
              </div>

              <div className="flex items-center gap-3 px-3 py-1.5 rounded-lg bg-[#0b101b]/90 border border-slate-700/80 text-xs">
                <span className="font-mono-num text-emerald-400 font-semibold">
                  HP {replayHud.hp}
                </span>
                <span className="font-mono-num text-sky-400 font-semibold">
                  Armor {replayHud.shield}
                </span>
                <span className="text-slate-300 hidden sm:inline">{replayHud.weaponName}</span>
                <span className="font-mono-num text-slate-400">Zone {replayHud.zoneRadius}m</span>
                <span className="font-mono-num text-amber-300">Alive {replayHud.aliveCount}</span>
              </div>
            </div>

            {/* Perspective Selector */}
            <div className="pointer-events-auto flex flex-col items-end gap-2">
              <div className="flex flex-wrap items-center gap-1.5 bg-[#0b101b]/95 border border-slate-700/80 rounded-lg p-1">
                {perspectives.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setReplayPerspective(p.id)}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-semibold transition-colors ${
                      replayPerspective === p.id
                        ? 'bg-amber-500 text-slate-950'
                        : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                    }`}
                  >
                    {p.icon}
                    <span className="hidden sm:inline">{p.label}</span>
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                {storedReplays.length > 1 && (
                  <select
                    value={activeReplay.id}
                    onChange={(e) => {
                      const found = storedReplays.find((r) => r.id === e.target.value);
                      if (found) openReplayTheater(found);
                    }}
                    className="px-2.5 py-1.5 rounded-lg bg-[#0b101b]/95 border border-slate-700 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                  >
                    {storedReplays.map((r, idx) => {
                      const mName = MAPS.find((m) => m.id === r.mapId)?.name || r.mapId;
                      return (
                        <option key={r.id} value={r.id}>
                          {idx === 0 ? 'Latest' : `Highlight #${idx + 1}`} · {mName} ({r.kills}K)
                        </option>
                      );
                    })}
                  </select>
                )}

                {matchResult ? (
                  <button
                    onClick={() => setActiveReplay(null)}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-600 text-xs font-semibold text-white hover:bg-slate-700"
                  >
                    Back to Summary
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => {
                        setActiveReplay(null);
                        onReplayMatch();
                      }}
                      className="px-3 py-1.5 rounded-lg bg-amber-500 text-slate-950 text-xs font-bold hover:bg-amber-400"
                    >
                      Play New Match
                    </button>
                    <button
                      onClick={() => onExitMatch()}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-600 text-xs font-semibold text-white hover:bg-slate-700"
                    >
                      Return to Lobby
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Bottom Timeline & Playback Controls */}
          <div className="pointer-events-auto mx-auto w-full max-w-4xl rounded-xl bg-[#0b101b]/95 border border-slate-700/90 p-3 space-y-2.5">
            {/* Highlight Event Jump Chips */}
            {activeReplay.highlights.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-semibold text-slate-400 mr-1">
                  Highlights:
                </span>
                {activeReplay.highlights.slice(0, 6).map((h, idx) => {
                  const relT = Math.max(0, h.t - rStart);
                  const chipColor =
                    h.kind === 'headshot'
                      ? 'border-amber-400/60 bg-amber-500/15 text-amber-300'
                      : h.kind === 'kill'
                        ? 'border-red-400/60 bg-red-500/15 text-red-300'
                        : h.kind === 'victory'
                          ? 'border-emerald-400/60 bg-emerald-500/15 text-emerald-300'
                          : 'border-sky-400/50 bg-sky-500/15 text-sky-300';
                  return (
                    <button
                      key={idx}
                      onClick={() => jumpToHighlight(h.t)}
                      className={`px-2 py-0.5 rounded border text-[11px] font-medium hover:brightness-125 font-mono-num ${chipColor}`}
                    >
                      {h.label} · {relT.toFixed(1)}s
                    </button>
                  );
                })}
                {replayPerspective === 'orbit' && (
                  <span className="ml-auto text-[11px] text-slate-400">
                    Drag to orbit · Scroll to zoom
                  </span>
                )}
              </div>
            )}

            {/* Scrubber Bar with Highlight Markers */}
            <div className="relative flex items-center">
              <div className="relative w-full h-6 flex items-center">
                <input
                  type="range"
                  min={0}
                  max={rDuration}
                  step={0.05}
                  value={replayTime}
                  onChange={(e) => {
                    setReplayPlaying(false);
                    setReplayTime(parseFloat(e.target.value));
                  }}
                  className="w-full accent-amber-500 cursor-pointer relative z-10"
                />
                {activeReplay.highlights.map((h, idx) => {
                  const pct = Math.max(
                    0,
                    Math.min(100, ((h.t - rStart) / rDuration) * 100)
                  );
                  const dotColor =
                    h.kind === 'headshot'
                      ? 'bg-amber-400'
                      : h.kind === 'kill'
                        ? 'bg-red-500'
                        : h.kind === 'victory'
                          ? 'bg-emerald-400'
                          : 'bg-sky-400';
                  return (
                    <button
                      key={idx}
                      title={`${h.label} (${(h.t - rStart).toFixed(1)}s)`}
                      onClick={() => jumpToHighlight(h.t)}
                      className={`absolute top-0 w-2 h-2 rounded-full ${dotColor} -translate-x-1/2 z-20`}
                      style={{ left: `${pct}%` }}
                    />
                  );
                })}
              </div>
            </div>

            {/* Playback Transport & Speed */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => seekBy(-5)}
                  title="Rewind 5s"
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs font-semibold text-slate-200 hover:text-white"
                >
                  <SkipBack className="w-3.5 h-3.5" /> -5s
                </button>
                <button
                  onClick={togglePlay}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-amber-500 text-slate-950 text-xs font-bold hover:bg-amber-400"
                >
                  {replayPlaying ? (
                    <>
                      <Pause className="w-3.5 h-3.5" /> Pause
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5" /> Play
                    </>
                  )}
                </button>
                <button
                  onClick={() => seekBy(5)}
                  title="Forward 5s"
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs font-semibold text-slate-200 hover:text-white"
                >
                  +5s <SkipForward className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="font-mono-num text-xs font-semibold text-slate-300">
                {replayTime.toFixed(1)}s / {rDuration.toFixed(1)}s
              </div>

              <div className="flex items-center gap-1">
                {[0.25, 0.5, 1, 2].map((spd) => (
                  <button
                    key={spd}
                    onClick={() => setReplaySpeed(spd)}
                    className={`px-2 py-1 rounded text-xs font-mono-num font-bold border ${
                      replaySpeed === spd
                        ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                        : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-white'
                    }`}
                  >
                    {spd}x
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full bg-[#070a10] overflow-hidden select-none">
      {/* Isolated 3D WebGL Viewport */}
      <BattleArenaCanvas
        settings={settings}
        loadout={loadout}
        username={username}
        paused={paused || Boolean(matchResult)}
        onHudUpdate={setHud}
        onMatchEnd={(res, savedReplay) => {
          setMatchResult(res);
          const nextReplay = savedReplay || getLatestMatchReplay();
          if (nextReplay) {
            setLatestReplay(nextReplay);
            setStoredReplays(loadStoredReplays());
          }
        }}
        onPauseRequest={() => setPaused((p) => !p)}
        replayFlushRef={replayFlushRef}
        virtualInputRef={virtualInputRef}
        actionTriggerRef={actionTriggerRef}
        sendWsMessage={sendWsMessage}
        peerStatesRef={peerStatesRef}
      />

      {/* Damage Vignette */}
      {hud.damageFlash > 0.02 && (
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            boxShadow: `inset 0 0 110px rgba(239, 68, 68, ${Math.min(0.75, hud.damageFlash)})`,
          }}
        />
      )}

      {/* Storm Warning */}
      {hud.inStorm && !matchResult && (
        <div className="pointer-events-none absolute top-16 left-1/2 -translate-x-1/2 px-4 py-1.5 bg-sky-950/90 border border-sky-400/50 rounded text-xs font-semibold text-sky-200">
          Outside Safe Zone — Move Toward Center
        </div>
      )}

      {/* Center Crosshair & Hitmarker */}
      {!paused && !matchResult && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="relative flex items-center justify-center">
            {hud.adsActive ? (
              <div className="w-28 h-28 rounded-full border border-amber-400/60 flex items-center justify-center">
                <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              </div>
            ) : (
              <div className="w-6 h-6 flex items-center justify-center">
                <div className="w-1 h-1 rounded-full bg-white/90" />
                <div className="absolute top-0 w-0.5 h-1.5 bg-white/75" />
                <div className="absolute bottom-0 w-0.5 h-1.5 bg-white/75" />
                <div className="absolute left-0 h-0.5 w-1.5 bg-white/75" />
                <div className="absolute right-0 h-0.5 w-1.5 bg-white/75" />
              </div>
            )}
            {hud.hitmarker !== 'none' && (
              <Crosshair
                className={`absolute w-7 h-7 ${
                  hud.hitmarker === 'head' ? 'text-amber-400' : 'text-red-500'
                }`}
              />
            )}
          </div>
        </div>
      )}

      {/* Perimeter Low-Occlusion HUD */}
      <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-3 sm:p-4">
        {/* Top Row */}
        <div className="flex items-start justify-between gap-4">
          {/* Top-Left: Tactical Minimap */}
          <div className="flex items-start gap-3">
            <div className="relative w-28 h-28 sm:w-32 sm:h-32 rounded-lg bg-[#0b101b]/90 border border-slate-700/80 overflow-hidden">
              {/* Safe Zone Circle */}
              <div
                className="absolute rounded-full border border-sky-400/70"
                style={{
                  width: `${(hud.zoneRadius / 92) * 100}%`,
                  height: `${(hud.zoneRadius / 92) * 100}%`,
                  left: '50%',
                  top: '50%',
                  transform: 'translate(-50%, -50%)',
                }}
              />
              {/* Entities */}
              {hud.minimapEntities.map((e, idx) => {
                const mx = 50 + (e.x / 92) * 48;
                const mz = 50 + (e.z / 92) * 48;
                const color =
                  e.kind === 'enemy'
                    ? 'bg-red-500'
                    : e.kind === 'ally'
                      ? 'bg-emerald-400'
                      : e.kind === 'vehicle'
                        ? 'bg-sky-400'
                        : 'bg-amber-400';
                return (
                  <div
                    key={idx}
                    className={`absolute w-1.5 h-1.5 rounded-full ${color}`}
                    style={{
                      left: `${Math.max(4, Math.min(96, mx))}%`,
                      top: `${Math.max(4, Math.min(96, mz))}%`,
                      transform: 'translate(-50%, -50%)',
                    }}
                  />
                );
              })}
              {/* Player Dot */}
              <div
                className="absolute w-2.5 h-2.5 rounded-full bg-white border border-amber-500"
                style={{
                  left: `${Math.max(5, Math.min(95, 50 + (hud.playerPos.x / 92) * 48))}%`,
                  top: `${Math.max(5, Math.min(95, 50 + (hud.playerPos.z / 92) * 48))}%`,
                  transform: 'translate(-50%, -50%)',
                }}
              />
              <div className="absolute bottom-1 left-1.5 text-[10px] font-mono-num text-slate-300">
                {mapDef?.name} · {hud.zoneRadius}m
              </div>
            </div>

            {/* Kill Feed */}
            <div className="hidden sm:flex flex-col gap-1">
              {hud.killFeed.map((k) => (
                <div
                  key={k.id}
                  className={`px-2.5 py-1 rounded text-xs font-medium ${
                    k.isPlayer
                      ? 'bg-amber-500/20 border border-amber-500/40 text-amber-200'
                      : 'bg-[#0b101b]/85 border border-slate-700/60 text-slate-200'
                  }`}
                >
                  {k.text}
                </div>
              ))}
            </div>
          </div>

          {/* Top-Right: Match Counters + Audio/Pause Controls */}
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-2 pointer-events-auto">
              <div className="flex items-center gap-3 px-3 py-1.5 rounded-lg bg-[#0b101b]/90 border border-slate-700/80 text-xs">
                <span className="text-slate-400">{modeDef?.name}</span>
                <span className="text-slate-600">·</span>
                <span className="font-mono-num font-bold text-white">
                  {settings.mode === 'zombie_survival' ? `Wave ${hud.wave}` : `Alive ${hud.aliveCount}`}
                </span>
                <span className="text-slate-600">·</span>
                <span className="font-mono-num font-bold text-amber-400">Kills {hud.kills}</span>
              </div>

              <button
                onClick={handleToggleMic}
                title={micMuted ? 'Unmute Squad Voice' : 'Mute Squad Voice'}
                className={`p-2 rounded-lg border transition-colors ${
                  micMuted
                    ? 'bg-[#0b101b]/90 border-slate-700 text-slate-400 hover:text-white'
                    : 'bg-emerald-600/90 border-emerald-400 text-white'
                }`}
              >
                {micMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>

              <button
                onClick={handleToggleAudio}
                title="Toggle Sound Effects"
                className="p-2 rounded-lg bg-[#0b101b]/90 border border-slate-700 text-slate-200 hover:text-amber-400"
              >
                {mutedAudio ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>

              <button
                onClick={() => setChatOpen((c) => !c)}
                title="Squad Chat"
                className="px-2.5 py-2 rounded-lg bg-[#0b101b]/90 border border-slate-700 text-xs font-medium text-slate-200 hover:border-amber-500/60"
              >
                Chat
              </button>

              <button
                onClick={() => {
                  if (document.pointerLockElement) document.exitPointerLock();
                  setPaused(true);
                }}
                title="Pause Match"
                className="p-2 rounded-lg bg-[#0b101b]/90 border border-slate-700 text-slate-200 hover:border-amber-500"
              >
                <Pause className="w-4 h-4" />
              </button>
            </div>

            {/* Collapsible Squad Chat */}
            {chatOpen && (
              <div className="pointer-events-auto w-72 rounded-lg bg-[#0b101b]/95 border border-slate-700 p-2.5 flex flex-col gap-2">
                <div className="max-h-32 overflow-y-auto space-y-1 text-xs">
                  {chatMessages.length === 0 ? (
                    <div className="text-slate-500">Safe-filtered squad chat active.</div>
                  ) : (
                    chatMessages.map((m, idx) => (
                      <div key={idx} className="text-slate-200">
                        <span className="font-semibold text-amber-400">{m.username}: </span>
                        <span>{m.text}</span>
                      </div>
                    ))
                  )}
                </div>
                <form onSubmit={handleSendChat} className="flex gap-1.5">
                  <input
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Squad message..."
                    className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-amber-500"
                  />
                  <button
                    type="submit"
                    className="px-2.5 py-1 rounded bg-amber-500 text-slate-950 font-semibold text-xs"
                  >
                    <Send className="w-3.5 h-3.5" />
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>

        {/* Center-Bottom Prompts */}
        <div className="flex flex-col items-center gap-2">
          {hud.isParachuting && (
            <div className="px-3.5 py-1.5 rounded bg-[#0b101b]/90 border border-amber-500/60 text-xs font-medium text-amber-300">
              Parachute Drop Active · Steer with WASD · Press Space near ground to cut chute
            </div>
          )}
          {hud.nearInteract && (
            <button
              onClick={() => {
                actionTriggerRef.current.interact = true;
              }}
              className="pointer-events-auto px-4 py-2 rounded-lg bg-amber-500 text-slate-950 font-bold text-xs shadow-lg"
            >
              {hud.nearInteract}
            </button>
          )}
        </div>

        {/* Bottom Status & Weapon Cluster */}
        <div className="flex items-end justify-between gap-4">
          {/* Health, Shield & Medkits */}
          <div className="pointer-events-auto flex flex-col gap-1.5 bg-[#0b101b]/90 border border-slate-700/80 rounded-lg p-3 min-w-[230px]">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-sky-300 font-mono-num font-semibold">
                <Shield className="w-3.5 h-3.5" /> Armor {hud.shield}
              </span>
              <button
                onClick={() => {
                  actionTriggerRef.current.medkit = true;
                }}
                className="px-2 py-0.5 rounded bg-emerald-600/30 border border-emerald-500/50 text-emerald-300 hover:bg-emerald-600/50 font-mono-num"
              >
                Medkit [H] ×{hud.medkits}
              </button>
            </div>
            <div className="w-full h-1.5 bg-slate-800 rounded overflow-hidden">
              <div
                className="h-full bg-sky-400 transition-all duration-100"
                style={{ width: `${(hud.shield / Math.max(1, hud.maxShield)) * 100}%` }}
              />
            </div>

            <div className="flex items-center justify-between text-xs mt-1">
              <span className="flex items-center gap-1.5 text-white font-mono-num font-bold">
                <Heart className="w-3.5 h-3.5 text-red-400" /> HP {hud.hp}/{hud.maxHp}
              </span>
              <button
                onClick={() => {
                  actionTriggerRef.current.emote = true;
                }}
                className="text-[11px] text-amber-400 hover:underline"
              >
                Emote [E]
              </button>
            </div>
            <div className="w-full h-2.5 bg-slate-800 rounded overflow-hidden">
              <div
                className={`h-full transition-all duration-100 ${
                  hud.hp > 35 ? 'bg-emerald-500' : 'bg-red-500'
                }`}
                style={{ width: `${(hud.hp / hud.maxHp) * 100}%` }}
              />
            </div>
          </div>

          {/* Control Hints (Desktop) */}
          <div className="hidden lg:block px-3 py-1.5 rounded bg-[#0b101b]/80 border border-slate-800 text-[11px] text-slate-400">
            Click Arena to Lock Aim · WASD Move · Shift Sprint · LMB Fire · RMB ADS · R Reload · F Drive/Loot · Esc Pause
          </div>

          {/* Weapon Slots & Ammo */}
          <div className="pointer-events-auto flex items-center gap-2 bg-[#0b101b]/90 border border-slate-700/80 rounded-lg p-2.5">
            <div className="flex gap-1.5">
              {slots.map((w, idx) => (
                <button
                  key={w.id}
                  onClick={() => {
                    actionTriggerRef.current.switchSlot = idx;
                  }}
                  className={`px-2.5 py-1.5 rounded text-left border transition-colors ${
                    hud.weaponIndex === idx
                      ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                      : 'bg-slate-900/80 border-slate-700 text-slate-400 hover:text-white'
                  }`}
                >
                  <div className="text-[10px] font-mono-num">[{idx + 1}]</div>
                  <div className="text-xs font-semibold whitespace-nowrap">{w.name}</div>
                </button>
              ))}
            </div>
            <div className="pl-2 border-l border-slate-700 text-right min-w-[74px]">
              <div className="font-mono-num text-lg font-bold text-white">
                {hud.reloading ? 'RLD...' : settings.mode === 'training' ? '∞' : `${hud.ammo}/${hud.magSize}`}
              </div>
              <div className="text-[10px] text-slate-400">Ammo [R]</div>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile / Android Virtual Dual-Touch Controls */}
      {touchHud && !paused && !matchResult && (
        <div className="pointer-events-none absolute inset-0">
          {/* Left Virtual Joystick */}
          <div
            className="pointer-events-auto absolute bottom-28 left-6 w-28 h-28 rounded-full bg-slate-900/45 border border-white/20 flex items-center justify-center touch-none"
            onTouchStart={(e) => {
              const t = e.touches[0];
              joyOriginRef.current = { x: t.clientX, y: t.clientY };
            }}
            onTouchMove={(e) => {
              if (!joyOriginRef.current) return;
              const t = e.touches[0];
              const dx = Math.max(-44, Math.min(44, t.clientX - joyOriginRef.current.x));
              const dy = Math.max(-44, Math.min(44, t.clientY - joyOriginRef.current.y));
              virtualInputRef.current.moveX = dx / 44;
              virtualInputRef.current.moveY = -dy / 44;
              virtualInputRef.current.sprint = Math.hypot(dx, dy) > 36;
            }}
            onTouchEnd={() => {
              joyOriginRef.current = null;
              virtualInputRef.current.moveX = 0;
              virtualInputRef.current.moveY = 0;
              virtualInputRef.current.sprint = false;
            }}
          >
            <div className="w-10 h-10 rounded-full bg-amber-400/70 border border-white/60" />
          </div>

          {/* Right Look Pad */}
          <div
            className="pointer-events-auto absolute top-20 right-4 w-56 h-48 touch-none"
            onTouchStart={(e) => {
              const t = e.touches[0];
              lookTouchRef.current = { x: t.clientX, y: t.clientY };
            }}
            onTouchMove={(e) => {
              if (!lookTouchRef.current) return;
              const t = e.touches[0];
              virtualInputRef.current.lookDeltaX += t.clientX - lookTouchRef.current.x;
              virtualInputRef.current.lookDeltaY += t.clientY - lookTouchRef.current.y;
              lookTouchRef.current = { x: t.clientX, y: t.clientY };
            }}
            onTouchEnd={() => {
              lookTouchRef.current = null;
            }}
          />

          {/* Right Touch Action Buttons */}
          <div className="pointer-events-auto absolute bottom-28 right-6 flex items-end gap-3">
            <div className="flex flex-col gap-2">
              <button
                onTouchStart={() => {
                  actionTriggerRef.current.reload = true;
                }}
                className="w-12 h-12 rounded-full bg-slate-900/80 border border-slate-500 text-xs font-bold text-white"
              >
                RLD
              </button>
              <button
                onTouchStart={() => {
                  virtualInputRef.current.ads = !virtualInputRef.current.ads;
                }}
                className="w-12 h-12 rounded-full bg-slate-900/80 border border-sky-400 text-xs font-bold text-sky-300"
              >
                ADS
              </button>
            </div>
            <div className="flex flex-col gap-2 items-center">
              <button
                onTouchStart={() => {
                  actionTriggerRef.current.jump = true;
                }}
                className="w-12 h-12 rounded-full bg-slate-900/80 border border-slate-500 text-xs font-bold text-white"
              >
                JMP
              </button>
              <button
                onTouchStart={() => {
                  virtualInputRef.current.firing = true;
                }}
                onTouchEnd={() => {
                  virtualInputRef.current.firing = false;
                }}
                className="w-16 h-16 rounded-full bg-amber-500/90 border-2 border-amber-200 text-xs font-bold text-slate-950 shadow-lg"
              >
                FIRE
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pause Modal */}
      {paused && !matchResult && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/75 p-4">
          <div className="w-full max-w-md rounded-xl bg-[#0e1420] border border-slate-700 p-6 space-y-5">
            <div>
              <h2 className="font-display text-2xl font-bold text-white">Match Paused</h2>
              <p className="text-xs text-slate-400 mt-1">
                {modeDef?.name} · {mapDef?.name} · {settings.graphics.toUpperCase()} Graphics
              </p>
            </div>

            <div className="space-y-2.5">
              <button
                onClick={() => setTouchHud((t) => !t)}
                className="w-full flex items-center justify-between px-4 py-2.5 rounded-lg bg-slate-800/80 border border-slate-700 text-sm text-slate-200"
              >
                <span className="flex items-center gap-2">
                  <Smartphone className="w-4 h-4 text-amber-400" />
                  Mobile Touch Controls
                </span>
                <span className="font-semibold text-amber-400">{touchHud ? 'ON' : 'OFF'}</span>
              </button>
              <button
                onClick={handleToggleAudio}
                className="w-full flex items-center justify-between px-4 py-2.5 rounded-lg bg-slate-800/80 border border-slate-700 text-sm text-slate-200"
              >
                <span className="flex items-center gap-2">
                  <Volume2 className="w-4 h-4 text-amber-400" />
                  Master Sound Effects
                </span>
                <span className="font-semibold text-amber-400">{mutedAudio ? 'MUTED' : 'ACTIVE'}</span>
              </button>
              <button
                onClick={() => {
                  const flushed = replayFlushRef.current?.() || latestReplay;
                  if (flushed) {
                    setLatestReplay(flushed);
                    setStoredReplays(loadStoredReplays());
                    openReplayTheater(flushed);
                  }
                }}
                className="w-full flex items-center justify-between px-4 py-2.5 rounded-lg bg-slate-800/80 border border-amber-500/40 text-sm text-amber-300 hover:bg-slate-800"
              >
                <span className="flex items-center gap-2">
                  <Film className="w-4 h-4 text-amber-400" />
                  Save &amp; Watch 60s Replay
                </span>
                <span className="text-xs font-semibold text-amber-400">Theater</span>
              </button>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setPaused(false)}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-amber-500 text-slate-950 font-bold text-sm hover:bg-amber-400"
              >
                <Play className="w-4 h-4" /> Resume
              </button>
              <button
                onClick={() => onExitMatch()}
                className="px-4 py-2.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 font-semibold text-sm hover:bg-slate-700"
              >
                Leave Match
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Victory / Defeat End Screen */}
      {matchResult && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/82 p-4">
          <div className="w-full max-w-lg rounded-xl bg-[#0e1420] border border-amber-500/40 p-6 space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold text-amber-400">
                  {matchResult.won ? `Victory Animation: ${victoryAnim?.name || 'Apex Crown'}` : 'Match Complete'}
                </div>
                <h2 className="font-display text-3xl font-bold text-white mt-0.5">
                  {matchResult.won ? 'BOOYAH — VICTORY!' : `Eliminated · Rank #${matchResult.placement}`}
                </h2>
              </div>
              <div className="w-12 h-12 rounded-xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-center">
                <Trophy className="w-6 h-6 text-amber-400" />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg bg-slate-900/90 border border-slate-800 p-3">
                <div className="text-xs text-slate-400">Eliminations</div>
                <div className="font-mono-num text-2xl font-bold text-white mt-0.5">
                  {matchResult.kills}
                </div>
              </div>
              <div className="rounded-lg bg-slate-900/90 border border-slate-800 p-3">
                <div className="text-xs text-slate-400">Damage Dealt</div>
                <div className="font-mono-num text-2xl font-bold text-amber-400 mt-0.5">
                  {matchResult.damageDealt}
                </div>
              </div>
              <div className="rounded-lg bg-slate-900/90 border border-slate-800 p-3">
                <div className="text-xs text-slate-400">Survival</div>
                <div className="font-mono-num text-2xl font-bold text-sky-400 mt-0.5">
                  {matchResult.survivalSeconds}s
                </div>
              </div>
            </div>

            <div className="rounded-lg bg-slate-900/70 border border-slate-800 p-3 text-xs text-slate-300">
              {matchResult.offlineSandbox
                ? 'Offline Sandbox Match: +600 Practice Coins & +10 Diamonds credited.'
                : `Rewards Earned: +${250 + matchResult.kills * 75 + (matchResult.won ? 600 : 120)} Coins · +${
                    (matchResult.won ? 35 : 5) + Math.min(25, matchResult.kills * 3)
                  } Diamonds · Battle Pass XP updated.`}
            </div>

            <div className="flex flex-wrap gap-2.5">
              {latestReplay && latestReplay.frames.length > 0 && (
                <button
                  onClick={() => openReplayTheater(latestReplay)}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-sky-500/20 border border-sky-400/60 text-sky-200 font-bold text-sm hover:bg-sky-500/30"
                >
                  <Film className="w-4 h-4 text-sky-300" /> Watch Last 60s Highlight Replay
                </button>
              )}
              <button
                onClick={onReplayMatch}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-amber-500 text-slate-950 font-bold text-sm hover:bg-amber-400"
              >
                <RotateCcw className="w-4 h-4" /> Play Again
              </button>
              <button
                onClick={() => onExitMatch(matchResult)}
                className="flex-1 py-2.5 rounded-lg bg-slate-800 border border-slate-700 text-white font-semibold text-sm hover:bg-slate-700"
              >
                Return to Lobby
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
