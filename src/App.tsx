import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Coins,
  Download,
  Gem,
  LogOut,
  Map as MapIcon,
  Play,
  Shield,
  Sparkles,
  Swords,
  Trophy,
  Users,
  WifiOff,
  Wrench,
} from 'lucide-react';
import {
  COLLECTION_ITEMS,
  DEFAULT_LOADOUT,
  GAME_MODES,
  MAPS,
  WEAPONS,
  getRankTier,
} from './shared/catalog';
import type {
  GameEvent,
  GameModeId,
  GraphicsQuality,
  MapId,
  MatchResultPayload,
  MatchSettings,
  PatchNote,
  RoomSummary,
  SquadSize,
  TimeOfDay,
  UserLoadout,
  UserProfile,
  WeatherType,
} from './shared/types';
import { apiRequest, getStoredToken, setStoredToken } from './lib/api';
import { usePWAInstall } from './hooks/usePWAInstall';
import { LobbyShowcaseCanvas } from './components/LobbyShowcaseCanvas';
import { MatchView } from './components/MatchView';
import { ArmoryVaultModal } from './components/ArmoryVaultModal';
import { PassEventsModal } from './components/PassEventsModal';
import { SocialRanksModal } from './components/SocialRanksModal';
import { AdminDashboardModal } from './components/AdminDashboardModal';
import type { PeerStatePacket } from './components/BattleArenaCanvas';

const HERO_ART = '/src/assets/images/hero_shayon_island_1795060835551.jpg';

const OFFLINE_SANDBOX_USER: UserProfile = {
  id: 'offline_sandbox',
  username: 'Sandbox Striker',
  email: 'offline@local',
  role: 'player',
  diamonds: 99999,
  coins: 9999999,
  xp: 5000,
  level: 30,
  rankPoints: 2200,
  kills: 0,
  wins: 0,
  matchesPlayed: 0,
  isBanned: false,
  loadout: DEFAULT_LOADOUT,
  inventory: [...WEAPONS.map((w) => w.id), ...COLLECTION_ITEMS.map((c) => c.id)],
  missions: {
    dailyKills: 0,
    dailyMatches: 0,
    dailyWins: 0,
    claimedMissions: [],
    loginStreak: 1,
    lastLoginClaim: null,
    battlePassXp: 500,
    battlePassElite: true,
    claimedBpTiers: [],
  },
};

export default function App() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [identifier, setIdentifier] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [sandboxMode, setSandboxMode] = useState(false);

  // Lobby & Match Config
  const [screen, setScreen] = useState<'title' | 'lobby' | 'match'>('title');
  const [matchKey, setMatchKey] = useState(1);
  const [selectedMode, setSelectedMode] = useState<GameModeId>('classic_br');
  const [selectedMap, setSelectedMap] = useState<MapId>('shayon_island');
  const [squadSize, setSquadSize] = useState<SquadSize>('solo');
  const [graphics, setGraphics] = useState<GraphicsQuality>('ultra');
  const [weather, setWeather] = useState<WeatherType>('clear');
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>('dynamic');
  const [activeRoomCode, setActiveRoomCode] = useState<string>('SHAYON');

  // UI Drawers & Modals
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [activePanel, setActivePanel] = useState<
    null | 'modes' | 'maps' | 'armory' | 'pass' | 'social' | 'admin'
  >(null);
  const [emotePulseKey, setEmotePulseKey] = useState(0);
  const [inspectWeaponId, setInspectWeaponId] = useState<string | null>(null);

  // Server Data & WebSocket
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [patchNotes, setPatchNotes] = useState<PatchNote[]>([]);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [onlineCount, setOnlineCount] = useState(1);
  const [chatMessages, setChatMessages] = useState<{ username: string; text: string; ts: number }[]>([]);
  const [pendingInvite, setPendingInvite] = useState<{
    fromUsername: string;
    mode: GameModeId;
    mapId: MapId;
    roomCode: string;
  } | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const peerStatesRef = useRef<Map<string, PeerStatePacket>>(new Map());
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();

  const loadServerMeta = useCallback(async () => {
    try {
      const [evRes, rRes] = await Promise.all([
        apiRequest<{ events: GameEvent[]; patchNotes: PatchNote[] }>('/api/events'),
        apiRequest<{ rooms: RoomSummary[] }>('/api/rooms'),
      ]);
      setEvents(evRes.events);
      setPatchNotes(evRes.patchNotes);
      setRooms(rRes.rooms);
    } catch {
      // Offline fallback
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    const token = getStoredToken();
    if (!token) {
      setAuthLoading(false);
      return;
    }
    try {
      const res = await apiRequest<{ user: UserProfile }>('/api/me');
      setUser(res.user);
      setScreen('lobby');
    } catch {
      setStoredToken('');
    } finally {
      setAuthLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshProfile();
    loadServerMeta();
  }, [refreshProfile, loadServerMeta]);

  // Connect WebSocket when authenticated online
  useEffect(() => {
    if (!user || sandboxMode) return;
    const token = getStoredToken();
    if (!token) return;

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'auth', token }));
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'auth:ok' || msg.type === 'rooms:list') {
          if (msg.rooms) setRooms(msg.rooms);
          if (typeof msg.onlineCount === 'number') setOnlineCount(msg.onlineCount);
        } else if (msg.type === 'squad:invite') {
          setPendingInvite({
            fromUsername: msg.fromUsername,
            mode: msg.mode,
            mapId: msg.mapId,
            roomCode: msg.roomCode,
          });
        } else if (msg.type === 'match:peer_state') {
          peerStatesRef.current.set(msg.userId, msg);
        } else if (msg.type === 'room:member_left') {
          peerStatesRef.current.delete(msg.userId);
        } else if (msg.type === 'match:chat') {
          setChatMessages((prev) => [...prev.slice(-24), { username: msg.username, text: msg.text, ts: msg.ts }]);
        }
      } catch {
        // Ignore malformed packets
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
      peerStatesRef.current.clear();
    };
  }, [user?.id, sandboxMode]);

  const sendWsMessage = useCallback((payload: Record<string, unknown>) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
    }
  }, []);

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    try {
      const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const body =
        authMode === 'login'
          ? { identifier, password }
          : { username: identifier, email, password };
      const res = await apiRequest<{ user: UserProfile; token: string }>(endpoint, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setStoredToken(res.token);
      setSandboxMode(false);
      setUser(res.user);
      setScreen('lobby');
    } catch (err: any) {
      setAuthError(err.message);
    }
  };

  const quickLogin = async (id: string, pass: string) => {
    setAuthError(null);
    try {
      const res = await apiRequest<{ user: UserProfile; token: string }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier: id, password: pass }),
      });
      setStoredToken(res.token);
      setSandboxMode(false);
      setUser(res.user);
      setScreen('lobby');
    } catch (err: any) {
      setAuthError(err.message);
    }
  };

  const enterOfflineSandbox = () => {
    setSandboxMode(true);
    setUser(OFFLINE_SANDBOX_USER);
    setSelectedMode('training');
    setScreen('lobby');
  };

  const handleLogout = () => {
    setStoredToken('');
    setUser(null);
    setSandboxMode(false);
    setActivePanel(null);
    setScreen('title');
  };

  const handleEquipLoadout = async (next: UserLoadout) => {
    if (!user) return;
    setUser({ ...user, loadout: next });
    if (!sandboxMode) {
      try {
        const res = await apiRequest<{ user: UserProfile }>('/api/loadout', {
          method: 'POST',
          body: JSON.stringify({ loadout: next }),
        });
        setUser(res.user);
      } catch {
        // Keep local optimistic state
      }
    }
  };

  const handlePurchaseItem = async (itemId: string, currency: 'coins' | 'diamonds') => {
    if (sandboxMode || !user) return;
    const res = await apiRequest<{ user: UserProfile }>('/api/shop/purchase', {
      method: 'POST',
      body: JSON.stringify({ itemId, currency }),
    });
    setUser(res.user);
  };

  const handleEvolveSkin = async (skinId: string) => {
    if (sandboxMode || !user) return;
    const res = await apiRequest<{ user: UserProfile }>('/api/shop/evolve', {
      method: 'POST',
      body: JSON.stringify({ skinId }),
    });
    setUser(res.user);
  };

  const startMatch = (overrideRoomCode?: string) => {
    const roomToJoin = overrideRoomCode || activeRoomCode || 'SHAYON';
    setActivePanel(null);
    peerStatesRef.current.clear();
    setChatMessages([]);
    if (!sandboxMode && user) {
      sendWsMessage({
        type: 'room:join',
        roomCode: roomToJoin,
        inMatch: true,
        weaponId: user.loadout.primaryWeaponId,
        outfitId: user.loadout.outfitId,
      });
    }
    setMatchKey((k) => k + 1);
    setScreen('match');
  };

  const handleExitMatch = async (result?: MatchResultPayload) => {
    if (!sandboxMode) {
      sendWsMessage({ type: 'room:leave' });
    }
    if (result && user && !sandboxMode) {
      try {
        const res = await apiRequest<{ user: UserProfile }>('/api/match/result', {
          method: 'POST',
          body: JSON.stringify(result),
        });
        if (res.user) setUser(res.user);
      } catch {
        // Ignore offline network errors
      }
    }
    setScreen('lobby');
  };

  // Match View
  if (screen === 'match' && user) {
    const matchSettings: MatchSettings = {
      mode: selectedMode,
      mapId: selectedMap,
      squadSize,
      graphics,
      weather,
      timeOfDay,
      roomCode: activeRoomCode,
      offlineSandbox: sandboxMode || selectedMode === 'training',
    };
    return (
      <MatchView
        key={matchKey}
        settings={matchSettings}
        loadout={user.loadout}
        username={user.username}
        onExitMatch={handleExitMatch}
        onReplayMatch={() => startMatch()}
        sendWsMessage={sandboxMode ? undefined : sendWsMessage}
        peerStatesRef={peerStatesRef}
        chatMessages={chatMessages}
      />
    );
  }

  // Title & Login Screen
  if (screen === 'title' || !user) {
    return (
      <div className="relative w-full h-full overflow-hidden bg-[#070a10] flex items-center">
        <img
          src={HERO_ART}
          alt="SHAYON FIRE MAX island battle royale key art"
          referrerPolicy="no-referrer"
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[#070a10]/95 via-[#070a10]/72 to-[#070a10]/30" />

        <div className="relative z-10 w-full max-w-6xl mx-auto px-6 sm:px-10 py-8 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-10">
          {/* Left: Brand Lockup over Calm Scrim */}
          <div className="max-w-xl space-y-5">
            <div className="flex items-center gap-3.5">
              <svg width="52" height="52" viewBox="0 0 512 512" className="shrink-0">
                <defs>
                  <linearGradient id="sfmLogo" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#fbbf24" />
                    <stop offset="100%" stopColor="#ef4444" />
                  </linearGradient>
                </defs>
                <circle cx="256" cy="256" r="220" fill="#0b101b" stroke="url(#sfmLogo)" strokeWidth="18" />
                <path d="M256 96 L352 212 L302 212 L344 352 L256 280 L168 352 L210 212 L160 212 Z" fill="url(#sfmLogo)" />
              </svg>
              <div>
                <div className="text-xs font-semibold tracking-widest text-amber-400 uppercase">
                  Original 3D Battle Royale
                </div>
                <h1 className="font-display text-4xl sm:text-5xl font-bold tracking-tight text-white">
                  SHAYON FIRE MAX
                </h1>
              </div>
            </div>

            <p className="text-sm sm:text-base text-slate-300 leading-relaxed">
              Deploy into five original 3D arenas across eight combat modes — from Classic Battle Royale and Ranked Clash Squad to Zombie Survival and Offline Training Sandbox. Evolve weapons, customize your striker, and dominate the storm ring.
            </p>

            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-300">
              <span>5 Original 3D Maps</span>
              <span aria-hidden="true">·</span>
              <span>8 Game Modes</span>
              <span aria-hidden="true">·</span>
              <span>Evo Gun Skins Lv.1–7</span>
              <span aria-hidden="true">·</span>
              <span>Dynamic Weather & Day/Night</span>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                onClick={enterOfflineSandbox}
                className="px-4 py-2.5 rounded-lg bg-slate-900/90 border border-slate-700 text-xs font-semibold text-slate-200 hover:border-amber-500 flex items-center gap-2"
              >
                <WifiOff className="w-4 h-4 text-amber-400" />
                Offline Sandbox (Unlimited Coins)
              </button>

              {isInstallable && !isInstalled && (
                <button
                  onClick={install}
                  className="px-4 py-2.5 rounded-lg bg-sky-500/20 border border-sky-400/50 text-xs font-semibold text-sky-200 hover:bg-sky-500/30 flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  Install Android / Desktop App
                </button>
              )}
              {isIOS && !isInstalled && (
                <span className="text-xs text-slate-400">
                  iOS: Tap Share → Add to Home Screen
                </span>
              )}
            </div>

            <div className="text-xs text-slate-400">
              Controls: WASD Move · Mouse Aim · LMB Fire · RMB Scope · R Reload · F Drive/Loot · Esc Pause
            </div>
          </div>

          {/* Right: Login / Registration Card */}
          <div className="w-full max-w-md rounded-xl bg-[#0b101b]/95 border border-slate-800 p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h2 className="font-display text-lg font-bold text-white">
                {authMode === 'login' ? 'Striker Sign In' : 'Create Striker Account'}
              </h2>
              <div className="flex gap-1 bg-slate-900 p-1 rounded-lg text-xs">
                <button
                  onClick={() => {
                    setAuthMode('login');
                    setAuthError(null);
                  }}
                  className={`px-3 py-1 rounded-md font-semibold ${
                    authMode === 'login' ? 'bg-amber-500 text-slate-950' : 'text-slate-400'
                  }`}
                >
                  Login
                </button>
                <button
                  onClick={() => {
                    setAuthMode('register');
                    setAuthError(null);
                  }}
                  className={`px-3 py-1 rounded-md font-semibold ${
                    authMode === 'register' ? 'bg-amber-500 text-slate-950' : 'text-slate-400'
                  }`}
                >
                  Register
                </button>
              </div>
            </div>

            {authError && (
              <div className="px-3 py-2 rounded-lg bg-red-500/15 border border-red-500/40 text-xs text-red-200">
                {authError}
              </div>
            )}

            <form onSubmit={handleAuthSubmit} className="space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  {authMode === 'login' ? 'Username or Email' : 'Striker Callsign'}
                </label>
                <input
                  required
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="Enter callsign..."
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500"
                />
              </div>

              {authMode === 'register' && (
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Email</label>
                  <input
                    required
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="striker@example.com"
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs text-slate-400 mb-1">Password</label>
                <input
                  required
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500"
                />
              </div>

              <button
                disabled={authLoading}
                type="submit"
                className="w-full py-3 rounded-lg bg-amber-500 text-slate-950 font-display font-bold text-sm tracking-wide hover:bg-amber-400 transition-colors"
              >
                {authMode === 'login' ? 'ENTER LOBBY' : 'REGISTER & DEPLOY'}
              </button>
            </form>

            <div className="pt-2 border-t border-slate-800 space-y-2">
              <div className="text-[11px] text-slate-400">Quick Access Accounts</div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => quickLogin('Striker', 'shayon123')}
                  className="py-2 px-3 rounded-lg bg-slate-900 border border-slate-700 text-xs font-semibold text-slate-200 hover:border-amber-500"
                >
                  Demo Striker
                </button>
                <button
                  type="button"
                  onClick={() => quickLogin('admin', 'shayonadmin123')}
                  className="py-2 px-3 rounded-lg bg-slate-900 border border-slate-700 text-xs font-semibold text-amber-300 hover:border-amber-500"
                >
                  Developer Admin
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Main 3D Lobby Shell
  const activeModeDef = GAME_MODES.find((m) => m.id === selectedMode) || GAME_MODES[0];
  const activeMapDef = MAPS.find((m) => m.id === selectedMap) || MAPS[0];
  const rankTier = getRankTier(user.rankPoints);

  return (
    <div className="relative w-full h-full bg-[#090d16] overflow-hidden">
      {/* Full-Viewport Interactive 3D Character & Weapon Showcase */}
      <LobbyShowcaseCanvas
        loadout={user.loadout}
        emotePulseKey={emotePulseKey}
        inspectWeaponId={inspectWeaponId}
      />

      {/* Top Perimeter Header (Clean 3-Zone Status Strip) */}
      <header className="pointer-events-none absolute top-0 inset-x-0 z-20 flex items-center justify-between gap-4 px-4 sm:px-6 py-3">
        {/* Player Profile Badge */}
        <div className="pointer-events-auto flex items-center gap-3 rounded-xl bg-[#0b101b]/92 border border-slate-800 px-3.5 py-2">
          <div className="w-9 h-9 rounded-lg bg-amber-500/20 border border-amber-500/60 flex items-center justify-center font-display font-bold text-amber-400">
            {user.username.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <div className="flex items-center gap-2 text-sm font-bold text-white leading-tight">
              <span>{user.username}</span>
              <span className="font-mono-num text-xs text-slate-400">Lv.{user.level}</span>
            </div>
            <div className="text-[11px] flex items-center gap-1.5" style={{ color: rankTier.color }}>
              <span>{rankTier.name}</span>
              <span className="text-slate-600">·</span>
              <span className="font-mono-num text-slate-400">{user.rankPoints} RP</span>
              <span className="text-slate-600">·</span>
              <span className="text-slate-400">
                {sandboxMode ? 'Offline Sandbox' : `${onlineCount} Online`}
              </span>
            </div>
          </div>
        </div>

        {/* Currency & Utility Actions */}
        <div className="pointer-events-auto flex items-center gap-2">
          <div className="flex items-center gap-3 rounded-xl bg-[#0b101b]/92 border border-slate-800 px-3.5 py-2 text-xs font-mono-num font-bold">
            <span className="flex items-center gap-1.5 text-amber-400">
              <Coins className="w-4 h-4" />
              {sandboxMode ? '∞' : user.coins.toLocaleString()}
            </span>
            <span className="text-slate-700">|</span>
            <span className="flex items-center gap-1.5 text-sky-400">
              <Gem className="w-4 h-4" />
              {user.diamonds.toLocaleString()}
            </span>
          </div>

          {user.role === 'admin' && (
            <button
              onClick={() => setActivePanel('admin')}
              className="px-3 py-2 rounded-xl bg-amber-500/15 border border-amber-500/50 text-xs font-bold text-amber-300 hover:bg-amber-500/25 flex items-center gap-1.5"
            >
              <Wrench className="w-3.5 h-3.5" /> Admin
            </button>
          )}

          {isInstallable && !isInstalled && (
            <button
              onClick={install}
              className="hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-xl bg-sky-500/20 border border-sky-400/50 text-xs font-semibold text-sky-200"
            >
              <Download className="w-3.5 h-3.5" /> Install App
            </button>
          )}

          <button
            onClick={handleLogout}
            title="Sign Out"
            className="p-2.5 rounded-xl bg-[#0b101b]/92 border border-slate-800 text-slate-400 hover:text-white"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Incoming Squad Invite Banner */}
      {pendingInvite && (
        <div className="absolute top-20 right-6 z-30 w-80 rounded-xl bg-[#0e1420] border border-amber-500 p-4 space-y-2.5 shadow-xl">
          <div className="text-xs font-semibold text-amber-400">Squad Invitation</div>
          <div className="text-sm text-white">
            <strong>{pendingInvite.fromUsername}</strong> invited you to{' '}
            {GAME_MODES.find((m) => m.id === pendingInvite.mode)?.name}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                setSelectedMode(pendingInvite.mode);
                setSelectedMap(pendingInvite.mapId);
                setActiveRoomCode(pendingInvite.roomCode);
                setPendingInvite(null);
                startMatch(pendingInvite.roomCode);
              }}
              className="flex-1 py-1.5 rounded-lg bg-amber-500 text-slate-950 font-bold text-xs"
            >
              Accept & Join
            </button>
            <button
              onClick={() => setPendingInvite(null)}
              className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs"
            >
              Decline
            </button>
          </div>
        </div>
      )}

      {/* Collapsible Bottom Tactical Dock (Zero Mid-Screen Occlusion) */}
      <div
        className={`fixed left-1/2 -translate-x-1/2 z-20 w-[94vw] max-w-[960px] transition-transform duration-200 ${
          dockCollapsed ? 'bottom-0 translate-y-[calc(100%-34px)]' : 'bottom-4 translate-y-0'
        }`}
      >
        <div className="flex justify-center">
          <button
            onClick={() => setDockCollapsed((c) => !c)}
            className="px-4 py-1 rounded-t-lg bg-[#0b101b]/95 border border-b-0 border-slate-700 text-[11px] font-semibold text-slate-300 hover:text-amber-400 flex items-center gap-1"
          >
            {dockCollapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            {dockCollapsed ? 'Show Controls' : 'Inspect 3D View'}
          </button>
        </div>

        <div className="rounded-xl bg-[#0b101b]/95 border border-slate-800 p-3 sm:p-3.5 flex flex-wrap items-center justify-between gap-3 shadow-2xl">
          {/* Navigation & Customization */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setActivePanel('armory')}
              className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs font-semibold text-white hover:border-amber-500 flex items-center gap-1.5 whitespace-nowrap"
            >
              <Swords className="w-3.5 h-3.5 text-amber-400" /> Vault & Armory
            </button>
            <button
              onClick={() => setActivePanel('pass')}
              className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs font-semibold text-white hover:border-amber-500 flex items-center gap-1.5 whitespace-nowrap"
            >
              <Trophy className="w-3.5 h-3.5 text-amber-400" /> Pass & Events
            </button>
            <button
              onClick={() => setActivePanel('social')}
              className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs font-semibold text-white hover:border-amber-500 flex items-center gap-1.5 whitespace-nowrap"
            >
              <Users className="w-3.5 h-3.5 text-sky-400" /> Squad & Rooms
            </button>
            <button
              onClick={() => setEmotePulseKey((k) => k + 1)}
              className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs font-semibold text-slate-200 hover:border-amber-500 flex items-center gap-1.5 whitespace-nowrap"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-400" /> Emote
            </button>
          </div>

          {/* Mode, Map & Primary Deploy CTA */}
          <div className="flex flex-wrap items-center gap-2 ml-auto">
            <button
              onClick={() => setActivePanel('modes')}
              className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-left hover:border-amber-500"
            >
              <div className="text-[10px] text-slate-400 uppercase">{squadSize} · {graphics}</div>
              <div className="text-xs font-bold text-white whitespace-nowrap">{activeModeDef.name}</div>
            </button>

            <button
              onClick={() => setActivePanel('maps')}
              className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-left hover:border-amber-500 flex items-center gap-2"
            >
              <MapIcon className="w-4 h-4 text-amber-400 shrink-0" />
              <div>
                <div className="text-[10px] text-slate-400 uppercase">{weather} · {timeOfDay}</div>
                <div className="text-xs font-bold text-white whitespace-nowrap">{activeMapDef.name}</div>
              </div>
            </button>

            <button
              onClick={() => startMatch()}
              className="px-6 py-2.5 rounded-lg bg-amber-500 text-slate-950 font-display font-bold text-sm tracking-wide hover:bg-amber-400 flex items-center gap-2 whitespace-nowrap shadow-lg"
            >
              <Play className="w-4 h-4 fill-current" /> DEPLOY
            </button>
          </div>
        </div>
      </div>

      {/* Mode & Graphics Selector Modal */}
      {activePanel === 'modes' && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/75 p-4">
          <div className="w-full max-w-3xl max-h-[86vh] rounded-xl bg-[#0b101b] border border-slate-800 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
              <h2 className="font-display text-xl font-bold text-white">Select Game Mode & Graphics</h2>
              <button
                onClick={() => setActivePanel(null)}
                className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-300"
              >
                Done
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              <div className="grid sm:grid-cols-2 gap-3">
                {GAME_MODES.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => {
                      if (m.id === 'custom_room') {
                        setActivePanel('social');
                        return;
                      }
                      setSelectedMode(m.id);
                    }}
                    className={`text-left rounded-xl border p-3.5 transition-colors ${
                      selectedMode === m.id
                        ? 'bg-amber-500/15 border-amber-500'
                        : 'bg-slate-900/75 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="text-xs text-amber-400 font-semibold">{m.playersLabel}</div>
                    <div className="font-display text-base font-bold text-white mt-0.5">{m.name}</div>
                    <div className="text-xs text-slate-400 mt-1">{m.shortDesc}</div>
                  </button>
                ))}
              </div>

              <div className="grid sm:grid-cols-2 gap-4 pt-2 border-t border-slate-800">
                <div>
                  <div className="text-xs font-semibold text-slate-400 mb-2">Squad Format</div>
                  <div className="flex gap-2">
                    {(['solo', 'duo', 'squad'] as const).map((s) => (
                      <button
                        key={s}
                        onClick={() => setSquadSize(s)}
                        className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase ${
                          squadSize === s ? 'bg-amber-500 text-slate-950' : 'bg-slate-900 text-slate-300'
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-400 mb-2">3D Graphics Preset</div>
                  <div className="flex gap-2">
                    {(
                      [
                        ['hd', 'HD Optimized'],
                        ['ultra', 'Ultra HD Shadows'],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        onClick={() => setGraphics(id)}
                        className={`flex-1 py-2 rounded-lg text-xs font-bold ${
                          graphics === id ? 'bg-sky-500 text-slate-950' : 'bg-slate-900 text-slate-300'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Map, Weather & Day/Night Selector Modal */}
      {activePanel === 'maps' && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/75 p-4">
          <div className="w-full max-w-4xl max-h-[86vh] rounded-xl bg-[#0b101b] border border-slate-800 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
              <h2 className="font-display text-xl font-bold text-white">
                Select Arena, Weather & Time of Day
              </h2>
              <button
                onClick={() => setActivePanel(null)}
                className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-300"
              >
                Done
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {MAPS.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => {
                      setSelectedMap(m.id);
                      setWeather(m.defaultWeather);
                    }}
                    className={`text-left rounded-xl border overflow-hidden transition-colors ${
                      selectedMap === m.id
                        ? 'border-amber-500 bg-amber-500/10'
                        : 'border-slate-800 bg-slate-900/80 hover:border-slate-700'
                    }`}
                  >
                    <div className="relative h-28 w-full bg-slate-950">
                      <img
                        src={m.previewImage}
                        alt={m.name}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                      <div className="absolute bottom-2 left-3 right-3">
                        <div className="text-[10px] text-amber-400 font-semibold">{m.biome}</div>
                        <div className="font-display text-base font-bold text-white">{m.name}</div>
                      </div>
                    </div>
                    <div className="p-3 text-xs text-slate-400">{m.description}</div>
                  </button>
                ))}
              </div>

              <div className="grid sm:grid-cols-2 gap-4 pt-2 border-t border-slate-800">
                <div>
                  <div className="text-xs font-semibold text-slate-400 mb-2">Weather Effects</div>
                  <div className="flex gap-2">
                    {(['clear', 'rain', 'dust', 'snow'] as const).map((w) => (
                      <button
                        key={w}
                        onClick={() => setWeather(w)}
                        className={`flex-1 py-2 rounded-lg text-xs font-bold capitalize ${
                          weather === w ? 'bg-amber-500 text-slate-950' : 'bg-slate-900 text-slate-300'
                        }`}
                      >
                        {w}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-400 mb-2">Day & Night Cycle</div>
                  <div className="flex gap-2">
                    {(['dynamic', 'day', 'sunset', 'night'] as const).map((t) => (
                      <button
                        key={t}
                        onClick={() => setTimeOfDay(t)}
                        className={`flex-1 py-2 rounded-lg text-xs font-bold capitalize ${
                          timeOfDay === t ? 'bg-sky-500 text-slate-950' : 'bg-slate-900 text-slate-300'
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Armory & Collection Vault */}
      {activePanel === 'armory' && (
        <ArmoryVaultModal
          user={user}
          sandboxMode={sandboxMode}
          onClose={() => setActivePanel(null)}
          onEquipLoadout={handleEquipLoadout}
          onPurchaseItem={handlePurchaseItem}
          onEvolveSkin={handleEvolveSkin}
          onPreviewEmote={() => setEmotePulseKey((k) => k + 1)}
          onInspectWeapon={setInspectWeaponId}
        />
      )}

      {/* Battle Pass, Missions & Events */}
      {activePanel === 'pass' && (
        <PassEventsModal
          user={user}
          events={events}
          patchNotes={patchNotes}
          onUserUpdated={setUser}
          onClose={() => setActivePanel(null)}
          onLaunchEventMode={(ev) => {
            setSelectedMode(ev.mode);
            setActivePanel(null);
            startMatch();
          }}
        />
      )}

      {/* Social, Custom Rooms & Leaderboard */}
      {activePanel === 'social' && (
        <SocialRanksModal
          user={user}
          rooms={rooms}
          onClose={() => setActivePanel(null)}
          sendWsMessage={sandboxMode ? undefined : sendWsMessage}
          onJoinRoomAndPlay={(room) => {
            setSelectedMode(room.mode);
            setSelectedMap(room.mapId);
            setSquadSize(room.squadSize);
            setWeather(room.weather);
            setTimeOfDay(room.timeOfDay);
            setActiveRoomCode(room.code);
            setActivePanel(null);
            startMatch(room.code);
          }}
        />
      )}

      {/* Developer Admin Console */}
      {activePanel === 'admin' && user.role === 'admin' && (
        <AdminDashboardModal
          currentUser={user}
          onRefreshCurrentUser={refreshProfile}
          onClose={() => {
            setActivePanel(null);
            loadServerMeta();
          }}
        />
      )}
    </div>
  );
}
