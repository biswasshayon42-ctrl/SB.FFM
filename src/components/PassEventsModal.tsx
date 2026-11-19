import React, { useState } from 'react';
import { Calendar, CheckCircle2, Crown, Flame, Gift, X } from 'lucide-react';
import {
  BATTLE_PASS_TIERS,
  DAILY_MISSIONS,
  DAILY_REWARDS,
} from '../shared/catalog';
import type { GameEvent, PatchNote, UserProfile } from '../shared/types';
import { apiRequest } from '../lib/api';

interface Props {
  user: UserProfile;
  events: GameEvent[];
  patchNotes: PatchNote[];
  onUserUpdated: (u: UserProfile) => void;
  onClose: () => void;
  onLaunchEventMode: (event: GameEvent) => void;
}

export const PassEventsModal: React.FC<Props> = ({
  user,
  events,
  patchNotes,
  onUserUpdated,
  onClose,
  onLaunchEventMode,
}) => {
  const [tab, setTab] = useState<'pass' | 'missions' | 'login' | 'events'>('pass');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);
  const claimedToday = user.missions.lastLoginClaim === today;

  const handleClaimLogin = async () => {
    try {
      const res = await apiRequest<{ user: UserProfile; rewardLabel: string }>('/api/rewards/daily-login', {
        method: 'POST',
      });
      onUserUpdated(res.user);
      setStatusMsg(`Claimed Daily Reward: ${res.rewardLabel}`);
    } catch (e: any) {
      setStatusMsg(e.message);
    }
  };

  const handleClaimMission = async (missionId: string) => {
    try {
      const res = await apiRequest<{ user: UserProfile }>('/api/rewards/mission', {
        method: 'POST',
        body: JSON.stringify({ missionId }),
      });
      onUserUpdated(res.user);
      setStatusMsg('Mission reward credited.');
    } catch (e: any) {
      setStatusMsg(e.message);
    }
  };

  const handleClaimBp = async (tier: number) => {
    try {
      const res = await apiRequest<{ user: UserProfile }>('/api/rewards/battle-pass', {
        method: 'POST',
        body: JSON.stringify({ tier }),
      });
      onUserUpdated(res.user);
      setStatusMsg(`Battle Pass Tier ${tier} claimed.`);
    } catch (e: any) {
      setStatusMsg(e.message);
    }
  };

  const handleUnlockElite = async () => {
    try {
      const res = await apiRequest<{ user: UserProfile }>('/api/rewards/unlock-elite', {
        method: 'POST',
      });
      onUserUpdated(res.user);
      setStatusMsg('Elite Battle Pass unlocked!');
    } catch (e: any) {
      setStatusMsg(e.message);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/75 p-4">
      <div className="w-full max-w-4xl max-h-[88vh] rounded-xl bg-[#0b101b] border border-slate-800 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <div>
            <h2 className="font-display text-xl font-bold text-white">Battle Pass, Missions & Events</h2>
            <p className="text-xs text-slate-400">
              Earn free Diamonds, Coins, and Battle Pass XP through gameplay and daily streaks.
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
              ['pass', 'Battle Pass'],
              ['missions', 'Daily Missions'],
              ['login', 'Daily Login'],
              ['events', 'Seasonal Events & Notes'],
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
          <div className="mx-6 mt-3 px-3.5 py-2 rounded-lg bg-amber-500/15 border border-amber-500/40 text-xs text-amber-200">
            {statusMsg}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {tab === 'pass' && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-slate-900/90 border border-slate-800 p-4">
                <div>
                  <div className="text-xs text-amber-400 font-semibold">Season 1 · Solaris Vanguard</div>
                  <div className="font-mono-num text-lg font-bold text-white mt-0.5">
                    Battle Pass XP: {user.missions.battlePassXp}
                  </div>
                </div>
                {user.missions.battlePassElite ? (
                  <span className="flex items-center gap-1.5 text-xs font-bold text-emerald-400">
                    <Crown className="w-4 h-4" /> Elite Pass Active
                  </span>
                ) : (
                  <button
                    onClick={handleUnlockElite}
                    className="px-4 py-2 rounded-lg bg-amber-500 text-slate-950 font-bold text-xs hover:bg-amber-400"
                  >
                    Unlock Elite Track (200 Diamonds)
                  </button>
                )}
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                {BATTLE_PASS_TIERS.map((t) => {
                  const unlocked = user.missions.battlePassXp >= t.requiredXp;
                  const claimed = user.missions.claimedBpTiers.includes(t.tier);
                  return (
                    <div
                      key={t.tier}
                      className={`rounded-xl border p-3.5 flex items-center justify-between gap-3 ${
                        claimed
                          ? 'bg-slate-900/40 border-slate-800 opacity-75'
                          : unlocked
                            ? 'bg-amber-500/10 border-amber-500/40'
                            : 'bg-slate-900/70 border-slate-800'
                      }`}
                    >
                      <div>
                        <div className="text-xs font-mono-num text-slate-400">
                          Tier {t.tier} · {t.requiredXp} XP
                        </div>
                        <div className="text-sm font-semibold text-white mt-0.5">
                          Free: {t.freeRewardLabel}
                        </div>
                        <div className="text-xs text-amber-300">Elite: {t.eliteRewardLabel}</div>
                      </div>
                      <button
                        disabled={!unlocked || claimed}
                        onClick={() => handleClaimBp(t.tier)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold shrink-0 ${
                          claimed
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : unlocked
                              ? 'bg-amber-500 text-slate-950 hover:bg-amber-400'
                              : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                        }`}
                      >
                        {claimed ? 'Claimed' : unlocked ? 'Claim' : 'Locked'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {tab === 'missions' && (
            <div className="space-y-3">
              {DAILY_MISSIONS.map((m) => {
                const progress = Math.min(m.target, user.missions[m.targetKey]);
                const complete = progress >= m.target;
                const claimed = user.missions.claimedMissions.includes(m.id);
                return (
                  <div
                    key={m.id}
                    className="rounded-xl bg-slate-900/80 border border-slate-800 p-4 flex items-center justify-between gap-4"
                  >
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-white">{m.title}</h3>
                        <span className="font-mono-num text-xs text-amber-400">
                          {progress}/{m.target}
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-slate-800 rounded mt-2 overflow-hidden">
                        <div
                          className="h-full bg-amber-500"
                          style={{ width: `${(progress / m.target) * 100}%` }}
                        />
                      </div>
                      <div className="text-xs text-slate-400 mt-1.5">
                        Reward: {m.coins} Coins · {m.diamonds} Diamonds · {m.bpXp} BP XP
                      </div>
                    </div>
                    <button
                      disabled={!complete || claimed}
                      onClick={() => handleClaimMission(m.id)}
                      className={`px-3.5 py-2 rounded-lg text-xs font-bold shrink-0 ${
                        claimed
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : complete
                            ? 'bg-amber-500 text-slate-950 hover:bg-amber-400'
                            : 'bg-slate-800 text-slate-500'
                      }`}
                    >
                      {claimed ? 'Claimed' : complete ? 'Claim' : 'In Progress'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {tab === 'login' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-xl bg-slate-900/90 border border-slate-800 p-4">
                <div className="flex items-center gap-3">
                  <Calendar className="w-6 h-6 text-amber-400" />
                  <div>
                    <div className="text-sm font-bold text-white">
                      Current Login Streak: {user.missions.loginStreak} Days
                    </div>
                    <div className="text-xs text-slate-400">
                      Log in daily to earn free Diamonds and Coins.
                    </div>
                  </div>
                </div>
                <button
                  disabled={claimedToday}
                  onClick={handleClaimLogin}
                  className={`px-4 py-2 rounded-lg text-xs font-bold ${
                    claimedToday
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : 'bg-amber-500 text-slate-950 hover:bg-amber-400'
                  }`}
                >
                  {claimedToday ? 'Claimed Today' : 'Claim Today’s Reward'}
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {DAILY_REWARDS.map((r, idx) => {
                  const done = idx < (user.missions.loginStreak % DAILY_REWARDS.length);
                  return (
                    <div
                      key={r.day}
                      className={`rounded-xl border p-3.5 ${
                        done
                          ? 'bg-emerald-500/10 border-emerald-500/40'
                          : 'bg-slate-900/70 border-slate-800'
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs text-slate-400">
                        <span>Day {r.day}</span>
                        {done ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <Gift className="w-4 h-4 text-amber-400" />}
                      </div>
                      <div className="text-sm font-bold text-white mt-2">{r.label}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {tab === 'events' && (
            <div className="space-y-5">
              <div className="space-y-3">
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Live Seasonal Events
                </h3>
                {events.map((ev) => (
                  <div
                    key={ev.id}
                    className="rounded-xl bg-slate-900/80 border border-slate-800 p-4 flex items-center justify-between gap-4"
                  >
                    <div>
                      <div className="flex items-center gap-2 text-xs text-amber-400 font-semibold">
                        <Flame className="w-3.5 h-3.5" />
                        <span>{ev.bonusMultiplier}x Multiplier</span>
                        <span>·</span>
                        <span>{ev.active ? 'Active' : 'Ended'}</span>
                      </div>
                      <h4 className="font-display text-base font-bold text-white mt-0.5">{ev.title}</h4>
                      <p className="text-xs text-slate-400 mt-1">{ev.subtitle}</p>
                    </div>
                    {ev.active && (
                      <button
                        onClick={() => onLaunchEventMode(ev)}
                        className="px-4 py-2 rounded-lg bg-amber-500 text-slate-950 font-bold text-xs shrink-0 hover:bg-amber-400"
                      >
                        Deploy
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <div className="space-y-2.5">
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Game Updates & Patch Notes
                </h3>
                {patchNotes.map((pn) => (
                  <div key={pn.id} className="rounded-xl bg-slate-900/60 border border-slate-800 p-4">
                    <div className="text-xs font-mono-num text-sky-400">
                      v{pn.version} · {pn.publishedAt.slice(0, 10)}
                    </div>
                    <h4 className="text-sm font-bold text-white mt-0.5">{pn.title}</h4>
                    <p className="text-xs text-slate-300 mt-1">{pn.notes}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
