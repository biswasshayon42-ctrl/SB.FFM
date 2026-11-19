import React, { useState } from 'react';
import {
  Check,
  Flame,
  Sparkles,
  Swords,
  X,
} from 'lucide-react';
import { COLLECTION_ITEMS, WEAPONS } from '../shared/catalog';
import type { CollectionCategory, CollectionItem, UserLoadout, UserProfile, WeaponSpec } from '../shared/types';

interface Props {
  user: UserProfile;
  sandboxMode: boolean;
  onClose: () => void;
  onEquipLoadout: (next: UserLoadout) => void;
  onPurchaseItem: (itemId: string, currency: 'coins' | 'diamonds') => Promise<void>;
  onEvolveSkin: (skinId: string) => Promise<void>;
  onPreviewEmote: () => void;
  onInspectWeapon: (weaponId: string | null) => void;
}

type VaultTab =
  | 'outfits'
  | 'weapons'
  | 'gun_skins'
  | 'emotes'
  | 'gear'
  | 'pets'
  | 'profile';

export const ArmoryVaultModal: React.FC<Props> = ({
  user,
  sandboxMode,
  onClose,
  onEquipLoadout,
  onPurchaseItem,
  onEvolveSkin,
  onPreviewEmote,
  onInspectWeapon,
}) => {
  const [tab, setTab] = useState<VaultTab>('outfits');
  const [eraFilter, setEraFilter] = useState<'all' | 'old' | 'new' | 'upcoming'>('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const isOwned = (id: string) => sandboxMode || user.inventory.includes(id);

  const handleBuy = async (id: string, currency: 'coins' | 'diamonds') => {
    setBusyId(id);
    setNotice(null);
    try {
      await onPurchaseItem(id, currency);
      setNotice('Unlocked and added to your Vault.');
    } catch (e: any) {
      setNotice(e.message || 'Purchase failed.');
    } finally {
      setBusyId(null);
    }
  };

  const handleEvolve = async (skinId: string) => {
    setBusyId(skinId);
    setNotice(null);
    try {
      await onEvolveSkin(skinId);
      setNotice('Evolution Skin upgraded! Visual aura intensified in 3D view.');
    } catch (e: any) {
      setNotice(e.message || 'Upgrade failed.');
    } finally {
      setBusyId(null);
    }
  };

  const equipCollectionItem = (item: CollectionItem) => {
    const next = { ...user.loadout };
    if (item.category === 'character') next.characterId = item.id;
    if (item.category === 'outfit') next.outfitId = item.id;
    if (item.category === 'emote') {
      next.emoteId = item.id;
      onPreviewEmote();
    }
    if (item.category === 'victory_anim') next.victoryAnimId = item.id;
    if (item.category === 'parachute') next.parachuteId = item.id;
    if (item.category === 'backpack') next.backpackId = item.id;
    if (item.category === 'loot_crate') next.lootCrateId = item.id;
    if (item.category === 'vehicle_skin') next.vehicleSkinId = item.id;
    if (item.category === 'pet') next.petId = item.id;
    if (item.category === 'frame') next.frameId = item.id;
    if (item.category === 'avatar') next.avatarId = item.id;
    if (item.category === 'banner') next.bannerId = item.id;
    if (item.category === 'gun_skin' && item.weaponId) {
      next.gunSkinIds = { ...next.gunSkinIds, [item.weaponId]: item.id };
      next.primaryWeaponId = item.weaponId;
      onInspectWeapon(item.weaponId);
    }
    onEquipLoadout(next);
  };

  const isEquipped = (item: CollectionItem): boolean => {
    const l = user.loadout;
    switch (item.category) {
      case 'character': return l.characterId === item.id;
      case 'outfit': return l.outfitId === item.id;
      case 'emote': return l.emoteId === item.id;
      case 'victory_anim': return l.victoryAnimId === item.id;
      case 'parachute': return l.parachuteId === item.id;
      case 'backpack': return l.backpackId === item.id;
      case 'loot_crate': return l.lootCrateId === item.id;
      case 'vehicle_skin': return l.vehicleSkinId === item.id;
      case 'pet': return l.petId === item.id;
      case 'frame': return l.frameId === item.id;
      case 'avatar': return l.avatarId === item.id;
      case 'banner': return l.bannerId === item.id;
      case 'gun_skin': return item.weaponId ? l.gunSkinIds[item.weaponId] === item.id : false;
      default: return false;
    }
  };

  const tabCategories: Record<VaultTab, CollectionCategory[]> = {
    outfits: ['character', 'outfit'],
    weapons: [],
    gun_skins: ['gun_skin'],
    emotes: ['emote', 'victory_anim'],
    gear: ['parachute', 'backpack', 'loot_crate', 'vehicle_skin'],
    pets: ['pet'],
    profile: ['frame', 'avatar', 'banner'],
  };

  const filteredItems = COLLECTION_ITEMS.filter((i) => {
    if (!tabCategories[tab].includes(i.category)) return false;
    if (eraFilter !== 'all' && i.era !== eraFilter) return false;
    return true;
  });

  const equipWeapon = (w: WeaponSpec) => {
    const next = { ...user.loadout };
    if (w.category === 'melee') next.meleeWeaponId = w.id;
    else if (w.category === 'pistol') next.secondaryWeaponId = w.id;
    else next.primaryWeaponId = w.id;
    onInspectWeapon(w.id);
    onEquipLoadout(next);
  };

  const isWeaponEquipped = (w: WeaponSpec) =>
    user.loadout.primaryWeaponId === w.id ||
    user.loadout.secondaryWeaponId === w.id ||
    user.loadout.meleeWeaponId === w.id;

  return (
    <div className="fixed inset-y-0 right-0 z-30 w-full max-w-xl bg-[#0b101b]/96 border-l border-slate-800 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
        <div>
          <h2 className="font-display text-xl font-bold text-white">Vault & Armory Collection</h2>
          <p className="text-xs text-slate-400">
            Click any item to inspect live on your 3D Striker · {sandboxMode ? 'Offline Sandbox (All Unlocked)' : 'Live Inventory'}
          </p>
        </div>
        <button
          onClick={() => {
            onInspectWeapon(null);
            onClose();
          }}
          className="p-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-300 hover:text-white"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Category Tabs */}
      <div className="flex items-center gap-1.5 px-5 py-3 border-b border-slate-800 overflow-x-auto">
        {(
          [
            ['outfits', 'Characters & Outfits'],
            ['weapons', 'Weapons (7 Types)'],
            ['gun_skins', 'Gun & Evo Skins'],
            ['emotes', 'Emotes & Victory'],
            ['gear', 'Gear & Vehicles'],
            ['pets', 'Pets'],
            ['profile', 'Frames & Banners'],
          ] as [VaultTab, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
              tab === id
                ? 'bg-amber-500 text-slate-950'
                : 'bg-slate-900 text-slate-300 hover:bg-slate-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Era Filter for Collections */}
      {tab !== 'weapons' && (
        <div className="flex items-center justify-between px-5 py-2.5 bg-slate-950/60 border-b border-slate-800/80 text-xs">
          <span className="text-slate-400">Collection Era</span>
          <div className="flex gap-1">
            {(['all', 'old', 'new', 'upcoming'] as const).map((era) => (
              <button
                key={era}
                onClick={() => setEraFilter(era)}
                className={`px-2.5 py-1 rounded text-xs capitalize ${
                  eraFilter === era
                    ? 'bg-slate-800 text-amber-400 font-semibold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {era === 'upcoming' ? 'Upcoming Preview' : era}
              </button>
            ))}
          </div>
        </div>
      )}

      {notice && (
        <div className="mx-5 mt-3 px-3 py-2 rounded-lg bg-amber-500/15 border border-amber-500/40 text-xs text-amber-200">
          {notice}
        </div>
      )}

      {/* Content Grid */}
      <div className="flex-1 overflow-y-auto p-5 space-y-3">
        {tab === 'weapons' ? (
          WEAPONS.map((w) => {
            const owned = isOwned(w.id);
            const equipped = isWeaponEquipped(w);
            return (
              <div
                key={w.id}
                className={`rounded-xl border p-3.5 transition-colors ${
                  equipped ? 'bg-amber-500/10 border-amber-500/50' : 'bg-slate-900/70 border-slate-800'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <span className="uppercase font-semibold text-amber-400">{w.category.replace('_', ' ')}</span>
                      <span>·</span>
                      <span className="font-mono-num">DMG {w.damage}</span>
                      <span>·</span>
                      <span className="font-mono-num">RPM {Math.round(w.fireRate * 60)}</span>
                    </div>
                    <h3 className="font-display text-base font-bold text-white mt-0.5">{w.name}</h3>
                    <p className="text-xs text-slate-400 mt-1">{w.description}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    {owned ? (
                      <button
                        onClick={() => equipWeapon(w)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 ${
                          equipped
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                            : 'bg-amber-500 text-slate-950 hover:bg-amber-400'
                        }`}
                      >
                        {equipped ? <><Check className="w-3.5 h-3.5" /> Equipped</> : <><Swords className="w-3.5 h-3.5" /> Equip</>}
                      </button>
                    ) : (
                      <div className="flex gap-1.5">
                        <button
                          disabled={busyId === w.id}
                          onClick={() => handleBuy(w.id, 'coins')}
                          className="px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs font-semibold text-amber-300 hover:border-amber-500"
                        >
                          {w.priceCoins} Coins
                        </button>
                        <button
                          disabled={busyId === w.id}
                          onClick={() => handleBuy(w.id, 'diamonds')}
                          className="px-2.5 py-1.5 rounded-lg bg-sky-500/20 border border-sky-400/50 text-xs font-semibold text-sky-300 hover:bg-sky-500/30"
                        >
                          {w.priceDiamonds} Dia
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          filteredItems.map((item) => {
            const owned = isOwned(item.id);
            const equipped = isEquipped(item);
            const evoLv = item.isEvo ? user.loadout.evoLevels[item.id] || 1 : 0;
            return (
              <div
                key={item.id}
                onClick={() => {
                  if (owned) equipCollectionItem(item);
                }}
                className={`rounded-xl border p-3.5 transition-colors cursor-pointer ${
                  equipped ? 'bg-amber-500/10 border-amber-500/60' : 'bg-slate-900/70 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    {/* Color Swatch Preview */}
                    <div
                      className="w-11 h-11 rounded-lg border border-white/15 shrink-0 flex items-center justify-center"
                      style={{
                        background: `linear-gradient(135deg, ${item.primaryColor}, ${item.secondaryColor})`,
                      }}
                    >
                      {item.isEvo && <Flame className="w-5 h-5 text-white" />}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 text-xs text-slate-400">
                        <span className="capitalize font-semibold text-amber-400">{item.rarity}</span>
                        <span>·</span>
                        <span className="capitalize">{item.era}</span>
                        {item.isEvo && (
                          <>
                            <span>·</span>
                            <span className="font-mono-num text-sky-300">Evo Lv.{evoLv}/7</span>
                          </>
                        )}
                      </div>
                      <h3 className="font-display text-base font-bold text-white mt-0.5">{item.name}</h3>
                      <p className="text-xs text-slate-400 mt-1">{item.description}</p>
                      {item.effectLabel && (
                        <div className="text-[11px] text-amber-300 mt-1 flex items-center gap-1">
                          <Sparkles className="w-3 h-3" /> {item.effectLabel}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                    {owned ? (
                      <>
                        <button
                          onClick={() => equipCollectionItem(item)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
                            equipped
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                              : 'bg-amber-500 text-slate-950 hover:bg-amber-400'
                          }`}
                        >
                          {equipped ? (item.category === 'emote' ? 'Play Again' : 'Equipped') : 'Equip'}
                        </button>
                        {item.isEvo && evoLv < 7 && !sandboxMode && (
                          <button
                            disabled={busyId === item.id}
                            onClick={() => handleEvolve(item.id)}
                            className="px-2.5 py-1 rounded bg-sky-500/20 border border-sky-400/50 text-[11px] font-semibold text-sky-200 hover:bg-sky-500/30"
                          >
                            Evolve Lv.{evoLv + 1} ({evoLv * 45} Dia)
                          </button>
                        )}
                      </>
                    ) : (
                      <div className="flex gap-1.5">
                        {item.priceCoins > 0 && (
                          <button
                            disabled={busyId === item.id}
                            onClick={() => handleBuy(item.id, 'coins')}
                            className="px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs font-semibold text-amber-300 hover:border-amber-500"
                          >
                            {item.priceCoins} C
                          </button>
                        )}
                        {item.priceDiamonds > 0 && (
                          <button
                            disabled={busyId === item.id}
                            onClick={() => handleBuy(item.id, 'diamonds')}
                            className="px-2.5 py-1.5 rounded-lg bg-sky-500/20 border border-sky-400/50 text-xs font-semibold text-sky-300 hover:bg-sky-500/30"
                          >
                            {item.priceDiamonds} Dia
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
