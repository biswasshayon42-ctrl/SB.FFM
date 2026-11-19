import React, { useEffect, useState } from 'react';
import {
  Activity,
  Ban,
  Coins,
  Gem,
  Server,
  ShieldAlert,
  Smartphone,
  Wrench,
  X,
} from 'lucide-react';
import { COLLECTION_ITEMS, GAME_MODES } from '../shared/catalog';
import type { GameEvent, GameModeId, PatchNote, UserProfile } from '../shared/types';
import { apiRequest } from '../lib/api';

interface Props {
  currentUser: UserProfile;
  onRefreshCurrentUser: () => Promise<void>;
  onClose: () => void;
}

export const AdminDashboardModal: React.FC<Props> = ({
  currentUser,
  onRefreshCurrentUser,
  onClose,
}) => {
  const [tab, setTab] = useState<'players' | 'events' | 'catalog' | 'servers' | 'updates' | 'apk'>('players');
  const [overview, setOverview] = useState<any>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [newEventTitle, setNewEventTitle] = useState('');
  const [newEventMode, setNewEventMode] = useState<GameModeId>('special_event');
  const [newVersion, setNewVersion] = useState('1.0.2 MAX');
  const [newPatchTitle, setNewPatchTitle] = useState('');
  const [newPatchNotes, setNewPatchNotes] = useState('');

  const loadOverview = async () => {
    try {
      const data = await apiRequest('/api/admin/overview');
      setOverview(data);
    } catch (e: any) {
      setStatusMsg(e.message);
    }
  };

  useEffect(() => {
    loadOverview();
  }, []);

  const grantCurrency = async (targetUserId: string, diamondsDelta: number, coinsDelta: number) => {
    await apiRequest('/api/admin/currency', {
      method: 'POST',
      body: JSON.stringify({ targetUserId, diamondsDelta, coinsDelta }),
    });
    setStatusMsg('Test currency updated.');
    await loadOverview();
    if (targetUserId === currentUser.id) await onRefreshCurrentUser();
  };

  const toggleBan = async (targetUserId: string, currentBanned: boolean) => {
    await apiRequest('/api/admin/player-status', {
      method: 'POST',
      body: JSON.stringify({ targetUserId, isBanned: !currentBanned }),
    });
    await loadOverview();
  };

  const toggleEvent = async (ev: GameEvent) => {
    await apiRequest('/api/admin/events/toggle', {
      method: 'POST',
      body: JSON.stringify({ eventId: ev.id, active: !ev.active, bonusMultiplier: ev.bonusMultiplier }),
    });
    await loadOverview();
  };

  const createEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEventTitle.trim()) return;
    await apiRequest('/api/admin/events/create', {
      method: 'POST',
      body: JSON.stringify({
        title: newEventTitle,
        subtitle: 'Admin-launched seasonal battle event.',
        mode: newEventMode,
        bonusMultiplier: 2.0,
      }),
    });
    setNewEventTitle('');
    await loadOverview();
  };

  const publishPatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPatchTitle.trim()) return;
    await apiRequest('/api/admin/patch-notes', {
      method: 'POST',
      body: JSON.stringify({
        version: newVersion,
        title: newPatchTitle,
        notes: newPatchNotes,
      }),
    });
    setNewPatchTitle('');
    setNewPatchNotes('');
    setStatusMsg('Patch notes published to all players.');
    await loadOverview();
  };

  const toggleCatalogItem = async (itemId: string, priceCoins: number, priceDiamonds: number, enabled: boolean) => {
    await apiRequest('/api/admin/catalog-override', {
      method: 'POST',
      body: JSON.stringify({ itemId, priceCoins, priceDiamonds, enabled }),
    });
    setStatusMsg(`Catalog updated for ${itemId}`);
    await loadOverview();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div className="w-full max-w-5xl max-h-[90vh] rounded-xl bg-[#0b101b] border border-amber-500/40 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <ShieldAlert className="w-5 h-5 text-amber-400" />
            <div>
              <h2 className="font-display text-xl font-bold text-white">Developer Admin Console</h2>
              <p className="text-xs text-slate-400">
                Manage Players · Test Currency · Skins & Rewards · Live Servers · Android APK Packaging
              </p>
            </div>
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
              ['players', 'Players & Currency'],
              ['events', 'Events & Rewards'],
              ['catalog', 'Outfits & Skins'],
              ['servers', 'Server Monitor'],
              ['updates', 'Game Updates'],
              ['apk', 'Android APK Build'],
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

        {statusMsg && (
          <div className="mx-6 mt-3 px-3.5 py-2 rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-xs text-emerald-200">
            {statusMsg}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-6">
          {!overview ? (
            <div className="text-sm text-slate-400">Loading server telemetry...</div>
          ) : tab === 'players' ? (
            <div className="space-y-3">
              {overview.players.map((p: any) => (
                <div
                  key={p.id}
                  className="rounded-xl bg-slate-900/80 border border-slate-800 p-4 flex flex-wrap items-center justify-between gap-4"
                >
                  <div>
                    <div className="flex items-center gap-2 text-sm font-bold text-white">
                      <span>{p.username}</span>
                      <span className="text-xs font-normal text-amber-400 uppercase">{p.role}</span>
                      {p.is_banned ? <span className="text-xs text-red-400">BANNED</span> : null}
                    </div>
                    <div className="text-xs text-slate-400 font-mono-num mt-0.5">
                      {p.diamonds} Diamonds · {p.coins} Coins · Lv.{p.level} · {p.rank_points} RP
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => grantCurrency(p.id, 500, 0)}
                      className="px-2.5 py-1.5 rounded-lg bg-sky-500/20 border border-sky-400/50 text-xs font-semibold text-sky-300 flex items-center gap-1"
                    >
                      <Gem className="w-3.5 h-3.5" /> +500 Dia
                    </button>
                    <button
                      onClick={() => grantCurrency(p.id, 0, 5000)}
                      className="px-2.5 py-1.5 rounded-lg bg-amber-500/20 border border-amber-400/50 text-xs font-semibold text-amber-300 flex items-center gap-1"
                    >
                      <Coins className="w-3.5 h-3.5" /> +5k Coins
                    </button>
                    <button
                      onClick={() => grantCurrency(p.id, -500, -1000)}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-300"
                    >
                      Deduct Test
                    </button>
                    {p.id !== currentUser.id && (
                      <button
                        onClick={() => toggleBan(p.id, Boolean(p.is_banned))}
                        className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 ${
                          p.is_banned
                            ? 'bg-emerald-600/20 text-emerald-300 border border-emerald-500/40'
                            : 'bg-red-600/20 text-red-300 border border-red-500/40'
                        }`}
                      >
                        <Ban className="w-3.5 h-3.5" /> {p.is_banned ? 'Unban' : 'Ban'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : tab === 'events' ? (
            <div className="space-y-4">
              <form onSubmit={createEvent} className="flex flex-wrap gap-2">
                <input
                  value={newEventTitle}
                  onChange={(e) => setNewEventTitle(e.target.value)}
                  placeholder="New Event Title..."
                  className="flex-1 min-w-[200px] bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white"
                />
                <select
                  value={newEventMode}
                  onChange={(e) => setNewEventMode(e.target.value as GameModeId)}
                  className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white"
                >
                  {GAME_MODES.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-amber-500 text-slate-950 font-bold text-xs"
                >
                  Launch Event
                </button>
              </form>

              {overview.events.map((ev: GameEvent) => (
                <div
                  key={ev.id}
                  className="rounded-xl bg-slate-900/80 border border-slate-800 p-4 flex items-center justify-between"
                >
                  <div>
                    <div className="text-sm font-bold text-white">{ev.title}</div>
                    <div className="text-xs text-slate-400">
                      {ev.mode} · {ev.bonusMultiplier}x Multiplier · {ev.active ? 'ACTIVE' : 'PAUSED'}
                    </div>
                  </div>
                  <button
                    onClick={() => toggleEvent(ev)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
                      ev.active
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {ev.active ? 'Disable' : 'Activate'}
                  </button>
                </div>
              ))}
            </div>
          ) : tab === 'catalog' ? (
            <div className="grid sm:grid-cols-2 gap-3">
              {COLLECTION_ITEMS.slice(0, 14).map((item) => {
                const ov = overview.overrides.find((o: any) => o.item_id === item.id);
                const enabled = ov ? Boolean(ov.enabled) : true;
                return (
                  <div
                    key={item.id}
                    className="rounded-xl bg-slate-900/75 border border-slate-800 p-3.5 flex items-center justify-between gap-3"
                  >
                    <div>
                      <div className="text-sm font-bold text-white">{item.name}</div>
                      <div className="text-xs text-slate-400 font-mono-num">
                        {item.priceCoins} Coins · {item.priceDiamonds} Dia · {enabled ? 'Listed' : 'Disabled'}
                      </div>
                    </div>
                    <button
                      onClick={() =>
                        toggleCatalogItem(item.id, item.priceCoins, item.priceDiamonds, !enabled)
                      }
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
                        enabled ? 'bg-slate-800 text-amber-300' : 'bg-red-500/20 text-red-300'
                      }`}
                    >
                      {enabled ? 'Disable' : 'Enable'}
                    </button>
                  </div>
                );
              })}
            </div>
          ) : tab === 'servers' ? (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="rounded-xl bg-slate-900 border border-slate-800 p-4">
                  <div className="text-xs text-slate-400 flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5 text-emerald-400" /> Online Players
                  </div>
                  <div className="font-mono-num text-2xl font-bold text-white mt-1">
                    {overview.telemetry.onlinePlayers}
                  </div>
                </div>
                <div className="rounded-xl bg-slate-900 border border-slate-800 p-4">
                  <div className="text-xs text-slate-400 flex items-center gap-1.5">
                    <Server className="w-3.5 h-3.5 text-amber-400" /> Active Rooms
                  </div>
                  <div className="font-mono-num text-2xl font-bold text-white mt-1">
                    {overview.telemetry.activeRooms}
                  </div>
                </div>
                <div className="rounded-xl bg-slate-900 border border-slate-800 p-4">
                  <div className="text-xs text-slate-400">WS Packets Processed</div>
                  <div className="font-mono-num text-2xl font-bold text-sky-400 mt-1">
                    {overview.telemetry.messagesProcessed}
                  </div>
                </div>
              </div>
            </div>
          ) : tab === 'updates' ? (
            <div className="space-y-4">
              <form onSubmit={publishPatch} className="rounded-xl bg-slate-900 border border-slate-800 p-4 space-y-3">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Wrench className="w-4 h-4 text-amber-400" /> Publish Game Update / Patch Notes
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={newVersion}
                    onChange={(e) => setNewVersion(e.target.value)}
                    placeholder="Version"
                    className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white"
                  />
                  <input
                    value={newPatchTitle}
                    onChange={(e) => setNewPatchTitle(e.target.value)}
                    placeholder="Update Title"
                    className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white"
                  />
                </div>
                <textarea
                  value={newPatchNotes}
                  onChange={(e) => setNewPatchNotes(e.target.value)}
                  placeholder="Describe weapon balance, new skins, or arena fixes..."
                  rows={3}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white"
                />
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-amber-500 text-slate-950 font-bold text-xs"
                >
                  Publish Update
                </button>
              </form>
              {overview.patchNotes.map((pn: PatchNote) => (
                <div key={pn.id} className="rounded-xl bg-slate-900/60 border border-slate-800 p-3.5">
                  <div className="text-xs font-mono-num text-amber-400">v{pn.version}</div>
                  <div className="text-sm font-bold text-white">{pn.title}</div>
                  <div className="text-xs text-slate-400 mt-1">{pn.notes}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl bg-slate-900/80 border border-slate-800 p-5 space-y-3 text-xs text-slate-300">
              <div className="flex items-center gap-2 text-sm font-bold text-white">
                <Smartphone className="w-4 h-4 text-amber-400" /> Android APK Build Pipeline (Capacitor)
              </div>
              <p>
                This project ships with <code className="text-amber-300">capacitor.config.ts</code>,{' '}
                <code className="text-amber-300">manifest.webmanifest</code>, and{' '}
                <code className="text-amber-300">ANDROID_APK_GUIDE.md</code> configured for landscape mobile gameplay and touch controls.
              </p>
              <pre className="bg-slate-950 border border-slate-800 rounded-lg p-3 overflow-x-auto font-mono text-[11px] text-emerald-300">
{`npm run build
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap add android
npx cap sync android
cd android && ./gradlew assembleRelease`}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
