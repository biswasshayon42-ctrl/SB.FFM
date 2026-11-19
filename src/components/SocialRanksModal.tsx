import React, { useEffect, useState } from 'react';
import {
  Mic,
  Plus,
  ShieldCheck,
  Trophy,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { GAME_MODES, MAPS, getRankTier } from '../shared/catalog';
import type {
  FriendEntry,
  GameModeId,
  MapId,
  RoomSummary,
  SquadSize,
  TimeOfDay,
  UserProfile,
  WeatherType,
} from '../shared/types';
import { apiRequest } from '../lib/api';

interface Props {
  user: UserProfile;
  rooms: RoomSummary[];
  onClose: () => void;
  onJoinRoomAndPlay: (room: {
    code: string;
    mode: GameModeId;
    mapId: MapId;
    squadSize: SquadSize;
    weather: WeatherType;
    timeOfDay: TimeOfDay;
    password?: string;
  }) => void;
  sendWsMessage?: (payload: Record<string, unknown>) => void;
}

export const SocialRanksModal: React.FC<Props> = ({
  user,
  rooms,
  onClose,
  onJoinRoomAndPlay,
  sendWsMessage,
}) => {
  const [tab, setTab] = useState<'friends' | 'rooms' | 'leaderboard' | 'voice'>('friends');
  const [friends, setFriends] = useState<FriendEntry[]>([]);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [friendUsername, setFriendUsername] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  // Custom Room Form
  const [roomName, setRoomName] = useState(`${user.username}'s Arena`);
  const [roomMode, setRoomMode] = useState<GameModeId>('classic_br');
  const [roomMap, setRoomMap] = useState<MapId>('shayon_island');
  const [roomWeather, setRoomWeather] = useState<WeatherType>('clear');
  const [roomTime, setRoomTime] = useState<TimeOfDay>('dynamic');
  const [roomPass, setRoomPass] = useState('');
  const [joinCode, setJoinCode] = useState('');

  // Voice & Safety Controls
  const [voiceChannel, setVoiceChannel] = useState<'squad' | 'all' | 'off'>('squad');
  const [profanityFilter, setProfanityFilter] = useState(true);
  const [autoMuteStrangers, setAutoMuteStrangers] = useState(false);

  const loadSocial = async () => {
    try {
      const [fRes, lRes] = await Promise.all([
        apiRequest<{ friends: FriendEntry[] }>('/api/friends'),
        apiRequest<{ leaderboard: any[] }>('/api/leaderboard'),
      ]);
      setFriends(fRes.friends);
      setLeaderboard(lRes.leaderboard);
    } catch {
      // Offline mode fallback
    }
  };

  useEffect(() => {
    loadSocial();
  }, []);

  const handleAddFriend = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try {
      const res = await apiRequest<{ friends: FriendEntry[] }>('/api/friends/add', {
        method: 'POST',
        body: JSON.stringify({ username: friendUsername }),
      });
      setFriends(res.friends);
      setFriendUsername('');
      setMsg('Friend added to your squad roster.');
    } catch (err: any) {
      setMsg(err.message);
    }
  };

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try {
      const res = await apiRequest<{ room: RoomSummary }>('/api/rooms/create', {
        method: 'POST',
        body: JSON.stringify({
          name: roomName,
          mode: roomMode,
          mapId: roomMap,
          squadSize: 'squad',
          weather: roomWeather,
          timeOfDay: roomTime,
          password: roomPass || undefined,
        }),
      });
      onJoinRoomAndPlay({
        code: res.room.code,
        mode: res.room.mode,
        mapId: res.room.mapId,
        squadSize: res.room.squadSize,
        weather: res.room.weather,
        timeOfDay: res.room.timeOfDay,
        password: roomPass || undefined,
      });
    } catch (err: any) {
      setMsg(err.message);
    }
  };

  const rankTier = getRankTier(user.rankPoints);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/75 p-4">
      <div className="w-full max-w-4xl max-h-[88vh] rounded-xl bg-[#0b101b] border border-slate-800 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <div>
            <h2 className="font-display text-xl font-bold text-white">Squad, Custom Rooms & Leaderboard</h2>
            <p className="text-xs text-slate-400">
              {user.username} · Rank {rankTier.name} ({user.rankPoints} RP) · K/D{' '}
              {(user.kills / Math.max(1, user.matchesPlayed)).toFixed(2)}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-300 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-2 px-6 py-3 border-b border-slate-800 overflow-x-auto">
          {(
            [
              ['friends', 'Friends & Squad'],
              ['rooms', 'Custom Rooms'],
              ['leaderboard', 'Global Leaderboard'],
              ['voice', 'Voice & Safety'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap ${
                tab === id ? 'bg-amber-500 text-slate-950' : 'bg-slate-900 text-slate-300 hover:bg-slate-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {msg && (
          <div className="mx-6 mt-3 px-3.5 py-2 rounded-lg bg-amber-500/15 border border-amber-500/40 text-xs text-amber-200">
            {msg}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {tab === 'friends' && (
            <>
              <form onSubmit={handleAddFriend} className="flex gap-2">
                <input
                  value={friendUsername}
                  onChange={(e) => setFriendUsername(e.target.value)}
                  placeholder="Enter player username (e.g., KaelenVex or NyxPhantom)..."
                  className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3.5 py-2 text-sm text-white focus:outline-none focus:border-amber-500"
                />
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-amber-500 text-slate-950 font-bold text-xs flex items-center gap-1.5"
                >
                  <UserPlus className="w-4 h-4" /> Add Friend
                </button>
              </form>

              <div className="space-y-2.5">
                {friends.length === 0 ? (
                  <div className="text-sm text-slate-400">No friends added yet.</div>
                ) : (
                  friends.map((f) => {
                    const tier = getRankTier(f.rankPoints);
                    return (
                      <div
                        key={f.id}
                        className="rounded-xl bg-slate-900/75 border border-slate-800 p-3.5 flex items-center justify-between"
                      >
                        <div>
                          <div className="flex items-center gap-2 text-sm font-bold text-white">
                            <span>{f.username}</span>
                            <span className="text-xs font-normal text-slate-400">Lv.{f.level}</span>
                          </div>
                          <div className="text-xs text-slate-400">
                            {tier.name} ({f.rankPoints} RP) · {f.online ? 'Online' : 'Offline'}
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            sendWsMessage?.({
                              type: 'squad:invite',
                              targetUserId: f.id,
                              mode: 'classic_br',
                              mapId: 'shayon_island',
                            });
                            setMsg(`Squad invitation sent to ${f.username}.`);
                          }}
                          className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs font-semibold text-amber-300 hover:border-amber-500"
                        >
                          Invite to Squad
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}

          {tab === 'rooms' && (
            <div className="grid md:grid-cols-2 gap-6">
              <form
                onSubmit={handleCreateRoom}
                className="rounded-xl bg-slate-900/80 border border-slate-800 p-4 space-y-3"
              >
                <h3 className="font-display text-base font-bold text-white flex items-center gap-2">
                  <Plus className="w-4 h-4 text-amber-400" /> Host Custom Room
                </h3>
                <input
                  value={roomName}
                  onChange={(e) => setRoomName(e.target.value)}
                  placeholder="Room Name"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white"
                />
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={roomMode}
                    onChange={(e) => setRoomMode(e.target.value as GameModeId)}
                    className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 text-xs text-white"
                  >
                    {GAME_MODES.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={roomMap}
                    onChange={(e) => setRoomMap(e.target.value as MapId)}
                    className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 text-xs text-white"
                  >
                    {MAPS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={roomWeather}
                    onChange={(e) => setRoomWeather(e.target.value as WeatherType)}
                    className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 text-xs text-white"
                  >
                    <option value="clear">Clear Sky</option>
                    <option value="rain">Storm Rain</option>
                    <option value="dust">Desert Dust</option>
                    <option value="snow">Alpine Snow</option>
                  </select>
                  <select
                    value={roomTime}
                    onChange={(e) => setRoomTime(e.target.value as TimeOfDay)}
                    className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 text-xs text-white"
                  >
                    <option value="dynamic">Day/Night Cycle</option>
                    <option value="day">Daylight</option>
                    <option value="sunset">Golden Sunset</option>
                    <option value="night">Night Ops</option>
                  </select>
                </div>
                <input
                  value={roomPass}
                  onChange={(e) => setRoomPass(e.target.value)}
                  placeholder="Optional Password"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white"
                />
                <button
                  type="submit"
                  className="w-full py-2.5 rounded-lg bg-amber-500 text-slate-950 font-bold text-xs hover:bg-amber-400"
                >
                  Create & Deploy Room
                </button>
              </form>

              <div className="space-y-3">
                <div className="flex gap-2">
                  <input
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                    placeholder="Room Code (e.g. SHAYON)"
                    className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-mono-num uppercase"
                  />
                  <button
                    onClick={() => {
                      const found = rooms.find((r) => r.code === joinCode.trim());
                      if (!found) {
                        setMsg('Room code not found.');
                        return;
                      }
                      onJoinRoomAndPlay(found);
                    }}
                    className="px-4 py-2 rounded-lg bg-sky-500 text-slate-950 font-bold text-xs"
                  >
                    Join Code
                  </button>
                </div>

                <div className="space-y-2">
                  {rooms.map((r) => (
                    <div
                      key={r.code}
                      className="rounded-xl bg-slate-900/75 border border-slate-800 p-3 flex items-center justify-between gap-3"
                    >
                      <div>
                        <div className="text-xs font-mono-num text-amber-400">
                          {r.code} · {r.playerCount}/{r.maxPlayers} Players
                        </div>
                        <div className="text-sm font-bold text-white">{r.name}</div>
                        <div className="text-xs text-slate-400">
                          {GAME_MODES.find((m) => m.id === r.mode)?.name} ·{' '}
                          {MAPS.find((m) => m.id === r.mapId)?.name}
                        </div>
                      </div>
                      <button
                        onClick={() => onJoinRoomAndPlay(r)}
                        className="px-3 py-1.5 rounded-lg bg-amber-500 text-slate-950 font-bold text-xs"
                      >
                        Join
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {tab === 'leaderboard' && (
            <div className="rounded-xl border border-slate-800 overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-900 text-slate-400">
                  <tr>
                    <th className="px-4 py-3">Rank</th>
                    <th className="px-4 py-3">Striker</th>
                    <th className="px-4 py-3">Tier</th>
                    <th className="px-4 py-3 text-right">RP</th>
                    <th className="px-4 py-3 text-right">Kills</th>
                    <th className="px-4 py-3 text-right">Wins</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80">
                  {leaderboard.map((row) => {
                    const t = getRankTier(row.rankPoints);
                    return (
                      <tr key={row.id} className={row.id === user.id ? 'bg-amber-500/10' : ''}>
                        <td className="px-4 py-3 font-mono-num font-bold text-amber-400">#{row.rank}</td>
                        <td className="px-4 py-3 font-semibold text-white">
                          {row.username} <span className="text-slate-500">Lv.{row.level}</span>
                        </td>
                        <td className="px-4 py-3" style={{ color: t.color }}>
                          {t.name}
                        </td>
                        <td className="px-4 py-3 text-right font-mono-num text-white">{row.rankPoints}</td>
                        <td className="px-4 py-3 text-right font-mono-num text-slate-300">{row.kills}</td>
                        <td className="px-4 py-3 text-right font-mono-num text-emerald-400">{row.wins}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'voice' && (
            <div className="space-y-4 max-w-xl">
              <div className="rounded-xl bg-slate-900/80 border border-slate-800 p-4 space-y-3">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Mic className="w-4 h-4 text-amber-400" /> Voice Chat Channel
                </h3>
                <div className="flex gap-2">
                  {(['squad', 'all', 'off'] as const).map((ch) => (
                    <button
                      key={ch}
                      onClick={() => {
                        setVoiceChannel(ch);
                        sendWsMessage?.({ type: 'voice:status', muted: ch === 'off', channel: ch });
                      }}
                      className={`px-4 py-2 rounded-lg text-xs font-bold capitalize ${
                        voiceChannel === ch
                          ? 'bg-amber-500 text-slate-950'
                          : 'bg-slate-800 text-slate-300'
                      }`}
                    >
                      {ch}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-xl bg-slate-900/80 border border-slate-800 p-4 space-y-3">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" /> Safety & Moderation Controls
                </h3>
                <label className="flex items-center justify-between text-xs text-slate-300 cursor-pointer">
                  <span>Real-time Chat Profanity Filter</span>
                  <input
                    type="checkbox"
                    checked={profanityFilter}
                    onChange={(e) => setProfanityFilter(e.target.checked)}
                    className="accent-amber-500"
                  />
                </label>
                <label className="flex items-center justify-between text-xs text-slate-300 cursor-pointer">
                  <span>Auto-Mute Non-Friend Players</span>
                  <input
                    type="checkbox"
                    checked={autoMuteStrangers}
                    onChange={(e) => setAutoMuteStrangers(e.target.checked)}
                    className="accent-amber-500"
                  />
                </label>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
