export type GameModeId =
  | 'classic_br'
  | 'ranked_br'
  | 'clash_squad'
  | 'tdm'
  | 'training'
  | 'custom_room'
  | 'zombie_survival'
  | 'special_event';

export type SquadSize = 'solo' | 'duo' | 'squad';

export type MapId =
  | 'shayon_island'
  | 'dragon_city'
  | 'desert_storm'
  | 'snow_mountain'
  | 'neon_city';

export type GraphicsQuality = 'hd' | 'ultra';
export type WeatherType = 'clear' | 'rain' | 'dust' | 'snow';
export type TimeOfDay = 'day' | 'sunset' | 'night' | 'dynamic';

export type WeaponCategory =
  | 'assault_rifle'
  | 'sniper'
  | 'shotgun'
  | 'smg'
  | 'pistol'
  | 'melee'
  | 'special';

export type CollectionCategory =
  | 'character'
  | 'outfit'
  | 'gun_skin'
  | 'emote'
  | 'victory_anim'
  | 'parachute'
  | 'backpack'
  | 'loot_crate'
  | 'vehicle_skin'
  | 'pet'
  | 'frame'
  | 'avatar'
  | 'banner';

export type ItemRarity = 'classic' | 'rare' | 'epic' | 'legendary' | 'evo' | 'upcoming';

export interface WeaponSpec {
  id: string;
  name: string;
  category: WeaponCategory;
  damage: number;
  fireRate: number; // shots per second
  range: number;
  magSize: number;
  reloadTime: number; // seconds
  spread: number;
  projectileSpeed: number;
  color: string;
  accentColor: string;
  priceCoins: number;
  priceDiamonds: number;
  starter?: boolean;
  description: string;
}

export interface CollectionItem {
  id: string;
  name: string;
  category: CollectionCategory;
  rarity: ItemRarity;
  era: 'old' | 'new' | 'upcoming';
  primaryColor: string;
  secondaryColor: string;
  emissiveColor?: string;
  weaponId?: string;
  isEvo?: boolean;
  maxEvoLevel?: number;
  priceCoins: number;
  priceDiamonds: number;
  starter?: boolean;
  description: string;
  effectLabel?: string;
}

export interface MapDefinition {
  id: MapId;
  name: string;
  biome: string;
  previewImage: string;
  skyDay: string;
  skyNight: string;
  fogColor: string;
  groundColor: string;
  accentColor: string;
  defaultWeather: WeatherType;
  description: string;
}

export interface GameModeDefinition {
  id: GameModeId;
  name: string;
  shortDesc: string;
  playersLabel: string;
  hasSafeZone: boolean;
  hasParachute: boolean;
  respawns: boolean;
  offlineCapable: boolean;
}

export interface UserLoadout {
  characterId: string;
  outfitId: string;
  primaryWeaponId: string;
  secondaryWeaponId: string;
  meleeWeaponId: string;
  gunSkinIds: Record<string, string>; // weaponId -> gun_skin itemId
  evoLevels: Record<string, number>; // gun_skin itemId -> 1..7
  emoteId: string;
  victoryAnimId: string;
  parachuteId: string;
  backpackId: string;
  lootCrateId: string;
  vehicleSkinId: string;
  petId: string;
  frameId: string;
  avatarId: string;
  bannerId: string;
}

export interface UserProfile {
  id: string;
  username: string;
  email: string;
  role: 'player' | 'admin';
  diamonds: number;
  coins: number;
  xp: number;
  level: number;
  rankPoints: number;
  kills: number;
  wins: number;
  matchesPlayed: number;
  isBanned: boolean;
  loadout: UserLoadout;
  inventory: string[];
  missions: {
    dailyKills: number;
    dailyMatches: number;
    dailyWins: number;
    claimedMissions: string[];
    loginStreak: number;
    lastLoginClaim: string | null;
    battlePassXp: number;
    battlePassElite: boolean;
    claimedBpTiers: number[];
  };
}

export interface FriendEntry {
  id: string;
  username: string;
  level: number;
  rankPoints: number;
  online: boolean;
  status: 'pending' | 'accepted';
  avatarId: string;
  frameId: string;
}

export interface GameEvent {
  id: string;
  title: string;
  subtitle: string;
  mode: GameModeId;
  bonusMultiplier: number;
  active: boolean;
  endsAt: string;
}

export interface PatchNote {
  id: string;
  version: string;
  title: string;
  notes: string;
  publishedAt: string;
}

export interface RoomSummary {
  code: string;
  name: string;
  hostUsername: string;
  mode: GameModeId;
  mapId: MapId;
  squadSize: SquadSize;
  weather: WeatherType;
  timeOfDay: TimeOfDay;
  playerCount: number;
  maxPlayers: number;
  hasPassword: boolean;
  status: 'waiting' | 'in_match';
}

export interface MatchSettings {
  mode: GameModeId;
  mapId: MapId;
  squadSize: SquadSize;
  graphics: GraphicsQuality;
  weather: WeatherType;
  timeOfDay: TimeOfDay;
  roomCode?: string;
  offlineSandbox?: boolean;
}

export interface MatchResultPayload {
  mode: GameModeId;
  mapId: MapId;
  won: boolean;
  placement: number;
  kills: number;
  damageDealt: number;
  survivalSeconds: number;
  offlineSandbox: boolean;
}

export type ReplayCameraPerspective = 'chase' | 'orbit' | 'overhead' | 'first_person';

export interface ReplayActorSample {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  team: 'player' | 'enemy' | 'zombie';
  isZombie: boolean;
  alive: boolean;
}

export interface ReplayShotSample {
  ox: number;
  oy: number;
  oz: number;
  dx: number;
  dy: number;
  dz: number;
  color: string;
  isPlayer: boolean;
}

export interface ReplayHighlightEvent {
  t: number;
  kind: 'kill' | 'headshot' | 'hit' | 'vehicle' | 'victory' | 'eliminated';
  label: string;
  x?: number;
  y?: number;
  z?: number;
}

export interface ReplayFrame {
  t: number; // Match elapsed seconds
  p: {
    x: number;
    y: number;
    z: number;
    yaw: number;
    pitch: number;
    hp: number;
    shield: number;
    weaponId: string;
    para: boolean;
    veh: boolean;
    emote: boolean;
  };
  v: {
    x: number;
    y: number;
    z: number;
    yaw: number;
  };
  zr: number;
  a: ReplayActorSample[];
  shots: ReplayShotSample[];
}

export interface MatchReplayRecord {
  id: string;
  savedAt: string;
  mode: GameModeId;
  mapId: MapId;
  graphics: GraphicsQuality;
  weather: WeatherType;
  timeOfDay: TimeOfDay;
  won: boolean;
  placement: number;
  kills: number;
  username: string;
  loadout: UserLoadout;
  durationSeconds: number;
  frames: ReplayFrame[];
  highlights: ReplayHighlightEvent[];
}

