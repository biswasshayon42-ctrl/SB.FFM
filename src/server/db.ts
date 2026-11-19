import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  COLLECTION_ITEMS,
  DAILY_MISSIONS,
  DAILY_REWARDS,
  BATTLE_PASS_TIERS,
  DEFAULT_LOADOUT,
  WEAPONS,
} from '../shared/catalog';
import type {
  FriendEntry,
  GameEvent,
  MatchResultPayload,
  PatchNote,
  UserLoadout,
  UserProfile,
} from '../shared/types';

const dataDir = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'shayon.db');
export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'player',
    diamonds INTEGER NOT NULL DEFAULT 150,
    coins INTEGER NOT NULL DEFAULT 2500,
    xp INTEGER NOT NULL DEFAULT 0,
    level INTEGER NOT NULL DEFAULT 1,
    rank_points INTEGER NOT NULL DEFAULT 1000,
    kills INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0,
    matches_played INTEGER NOT NULL DEFAULT 0,
    is_banned INTEGER NOT NULL DEFAULT 0,
    loadout_json TEXT NOT NULL,
    missions_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS user_inventory (
    user_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    unlocked_at TEXT NOT NULL,
    PRIMARY KEY(user_id, item_id),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS friends (
    user_id TEXT NOT NULL,
    friend_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'accepted',
    PRIMARY KEY(user_id, friend_id)
  );

  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    subtitle TEXT NOT NULL,
    mode TEXT NOT NULL,
    bonus_multiplier REAL NOT NULL DEFAULT 2.0,
    active INTEGER NOT NULL DEFAULT 1,
    ends_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS catalog_overrides (
    item_id TEXT PRIMARY KEY,
    price_coins INTEGER,
    price_diamonds INTEGER,
    is_upcoming INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS patch_notes (
    id TEXT PRIMARY KEY,
    version TEXT NOT NULL,
    title TEXT NOT NULL,
    notes TEXT NOT NULL,
    published_at TEXT NOT NULL
  );
`);

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, key] = stored.split(':');
  if (!salt || !key) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(key, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

const STARTER_IDS = [
  ...WEAPONS.filter((w) => w.starter).map((w) => w.id),
  ...COLLECTION_ITEMS.filter((c) => c.starter).map((c) => c.id),
];

function defaultMissionsJson() {
  return JSON.stringify({
    dailyKills: 0,
    dailyMatches: 0,
    dailyWins: 0,
    claimedMissions: [],
    loginStreak: 0,
    lastLoginClaim: null,
    battlePassXp: 120,
    battlePassElite: false,
    claimedBpTiers: [],
  });
}

export function grantStarterInventory(userId: string) {
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO user_inventory (user_id, item_id, unlocked_at) VALUES (?, ?, ?)'
  );
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    for (const itemId of STARTER_IDS) {
      stmt.run(userId, itemId, now);
    }
  });
  tx();
}

export function seedInitialData() {
  const existingAdmin = db.prepare('SELECT id FROM users WHERE username = ?').get('admin') as
    | { id: string }
    | undefined;
  if (!existingAdmin) {
    const adminId = 'usr_admin_shayon';
    db.prepare(
      `INSERT INTO users (id, username, email, password_hash, role, diamonds, coins, xp, level, rank_points, kills, wins, matches_played, loadout_json, missions_json, created_at)
       VALUES (?, ?, ?, ?, 'admin', 99999, 250000, 12000, 48, 3450, 412, 68, 120, ?, ?, ?)`
    ).run(
      adminId,
      'admin',
      'admin@shayonfiremax.dev',
      hashPassword('shayonadmin123'),
      JSON.stringify({
        ...DEFAULT_LOADOUT,
        outfitId: 'outfit_crimson_shogun',
        gunSkinIds: { sf47_vanguard: 'skin_sf47_evo_dragon' },
        evoLevels: { ...DEFAULT_LOADOUT.evoLevels, skin_sf47_evo_dragon: 7 },
      }),
      defaultMissionsJson(),
      new Date().toISOString()
    );
    grantStarterInventory(adminId);
    const allIds = [...WEAPONS.map((w) => w.id), ...COLLECTION_ITEMS.map((c) => c.id)];
    const invStmt = db.prepare(
      'INSERT OR IGNORE INTO user_inventory (user_id, item_id, unlocked_at) VALUES (?, ?, ?)'
    );
    allIds.forEach((id) => invStmt.run(adminId, id, new Date().toISOString()));
  }

  const demoUsers = [
    {
      id: 'usr_striker_demo',
      username: 'Striker',
      email: 'striker@shayonfiremax.dev',
      pass: 'shayon123',
      diamonds: 450,
      coins: 8500,
      level: 14,
      rp: 1940,
      kills: 86,
      wins: 14,
      matches: 39,
    },
    {
      id: 'usr_rival_kaelen',
      username: 'KaelenVex',
      email: 'kaelen@shayonfiremax.dev',
      pass: 'rival1234',
      diamonds: 320,
      coins: 5400,
      level: 28,
      rp: 2850,
      kills: 214,
      wins: 41,
      matches: 92,
    },
    {
      id: 'usr_rival_nyx',
      username: 'NyxPhantom',
      email: 'nyx@shayonfiremax.dev',
      pass: 'rival1234',
      diamonds: 500,
      coins: 7200,
      level: 34,
      rp: 3120,
      kills: 298,
      wins: 52,
      matches: 105,
    },
    {
      id: 'usr_rival_blaze',
      username: 'BlazeOrion',
      email: 'blaze@shayonfiremax.dev',
      pass: 'rival1234',
      diamonds: 210,
      coins: 3900,
      level: 19,
      rp: 1680,
      kills: 130,
      wins: 21,
      matches: 64,
    },
  ];

  for (const u of demoUsers) {
    const found = db.prepare('SELECT id FROM users WHERE id = ?').get(u.id);
    if (!found) {
      db.prepare(
        `INSERT INTO users (id, username, email, password_hash, role, diamonds, coins, xp, level, rank_points, kills, wins, matches_played, loadout_json, missions_json, created_at)
         VALUES (?, ?, ?, ?, 'player', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        u.id,
        u.username,
        u.email,
        hashPassword(u.pass),
        u.diamonds,
        u.coins,
        u.level * 400,
        u.level,
        u.rp,
        u.kills,
        u.wins,
        u.matches,
        JSON.stringify(DEFAULT_LOADOUT),
        defaultMissionsJson(),
        new Date().toISOString()
      );
      grantStarterInventory(u.id);
    }
  }

  // Seed mutual friend links for Striker demo user
  db.prepare('INSERT OR IGNORE INTO friends (user_id, friend_id, status) VALUES (?, ?, ?)').run(
    'usr_striker_demo',
    'usr_rival_kaelen',
    'accepted'
  );
  db.prepare('INSERT OR IGNORE INTO friends (user_id, friend_id, status) VALUES (?, ?, ?)').run(
    'usr_striker_demo',
    'usr_rival_nyx',
    'accepted'
  );

  // Seed events
  const eventCount = (db.prepare('SELECT COUNT(*) as cnt FROM events').get() as { cnt: number }).cnt;
  if (eventCount === 0) {
    const insertEvent = db.prepare(
      'INSERT INTO events (id, title, subtitle, mode, bonus_multiplier, active, ends_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    insertEvent.run(
      'evt_solaris_blitz',
      'Solaris Storm Blitz',
      '2x Battle Pass XP & Coin rewards across Shayon Island and Neon City.',
      'special_event',
      2.0,
      1,
      '2026-12-31T23:59:59Z'
    );
    insertEvent.run(
      'evt_dragon_citadel',
      'Dragon Citadel Clash',
      'Bonus Diamonds on Clash Squad 4v4 victory streaks.',
      'clash_squad',
      1.5,
      1,
      '2026-12-20T23:59:59Z'
    );
    insertEvent.run(
      'evt_zombie_outbreak',
      'Midnight Outbreak',
      'Survive 5+ infected waves on Snow Mountain for rare crate shards.',
      'zombie_survival',
      2.5,
      1,
      '2026-12-25T23:59:59Z'
    );
  }

  // Seed patch notes
  const patchCount = (db.prepare('SELECT COUNT(*) as cnt FROM patch_notes').get() as { cnt: number }).cnt;
  if (patchCount === 0) {
    db.prepare(
      'INSERT INTO patch_notes (id, version, title, notes, published_at) VALUES (?, ?, ?, ?, ?)'
    ).run(
      'patch_1_0',
      '1.0.0 MAX',
      'Shayon Fire Max Global Launch',
      'Added 5 original 3D arenas, 8 playable game modes, Evolution Gun Skins Lv.1-7, dynamic weather & day/night cycle, and live WebSocket squad lobbies.',
      new Date().toISOString()
    );
  }
}

seedInitialData();

export function getUserProfile(userId: string): UserProfile | null {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as
    | Record<string, any>
    | undefined;
  if (!row) return null;

  const invRows = db
    .prepare('SELECT item_id FROM user_inventory WHERE user_id = ?')
    .all(userId) as { item_id: string }[];

  return {
    id: row.id,
    username: row.username,
    email: row.email,
    role: row.role,
    diamonds: row.diamonds,
    coins: row.coins,
    xp: row.xp,
    level: row.level,
    rankPoints: row.rank_points,
    kills: row.kills,
    wins: row.wins,
    matchesPlayed: row.matches_played,
    isBanned: Boolean(row.is_banned),
    loadout: JSON.parse(row.loadout_json) as UserLoadout,
    inventory: invRows.map((r) => r.item_id),
    missions: JSON.parse(row.missions_json),
  };
}

export function createSession(userId: string): string {
  const token = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)').run(
    token,
    userId,
    new Date().toISOString()
  );
  return token;
}

export function getUserByToken(token: string | undefined): UserProfile | null {
  if (!token) return null;
  const row = db.prepare('SELECT user_id FROM sessions WHERE token = ?').get(token) as
    | { user_id: string }
    | undefined;
  if (!row) return null;
  return getUserProfile(row.user_id);
}

export function registerUser(username: string, email: string, password: string): { user?: UserProfile; token?: string; error?: string } {
  const cleanUser = username.trim().slice(0, 20);
  const cleanEmail = email.trim().toLowerCase();
  if (cleanUser.length < 3) return { error: 'Username must be at least 3 characters.' };
  if (!cleanEmail.includes('@')) return { error: 'Valid email is required.' };
  if (password.length < 6) return { error: 'Password must be at least 6 characters.' };

  const exists = db
    .prepare('SELECT id FROM users WHERE lower(username) = lower(?) OR lower(email) = lower(?)')
    .get(cleanUser, cleanEmail);
  if (exists) return { error: 'Username or email is already registered.' };

  const userId = `usr_${crypto.randomBytes(6).toString('hex')}`;
  db.prepare(
    `INSERT INTO users (id, username, email, password_hash, role, diamonds, coins, xp, level, rank_points, kills, wins, matches_played, loadout_json, missions_json, created_at)
     VALUES (?, ?, ?, ?, 'player', 200, 3500, 0, 1, 1000, 0, 0, 0, ?, ?, ?)`
  ).run(
    userId,
    cleanUser,
    cleanEmail,
    hashPassword(password),
    JSON.stringify(DEFAULT_LOADOUT),
    defaultMissionsJson(),
    new Date().toISOString()
  );
  grantStarterInventory(userId);
  const token = createSession(userId);
  return { user: getUserProfile(userId)!, token };
}

export function loginUser(identifier: string, password: string): { user?: UserProfile; token?: string; error?: string } {
  const row = db
    .prepare('SELECT * FROM users WHERE lower(username) = lower(?) OR lower(email) = lower(?)')
    .get(identifier.trim(), identifier.trim()) as Record<string, any> | undefined;
  if (!row) return { error: 'Account not found.' };
  if (row.is_banned) return { error: 'This account is suspended by an administrator.' };
  if (!verifyPassword(password, row.password_hash)) return { error: 'Invalid credentials.' };
  const token = createSession(row.id);
  return { user: getUserProfile(row.id)!, token };
}

export function getLeaderboard() {
  const rows = db
    .prepare(
      'SELECT id, username, level, rank_points, kills, wins, matches_played, loadout_json FROM users WHERE is_banned = 0 ORDER BY rank_points DESC LIMIT 20'
    )
    .all() as Record<string, any>[];
  return rows.map((r, i) => {
    const loadout = JSON.parse(r.loadout_json) as UserLoadout;
    return {
      rank: i + 1,
      id: r.id,
      username: r.username,
      level: r.level,
      rankPoints: r.rank_points,
      kills: r.kills,
      wins: r.wins,
      matchesPlayed: r.matches_played,
      avatarId: loadout.avatarId,
      frameId: loadout.frameId,
      bannerId: loadout.bannerId,
    };
  });
}

export function getFriends(userId: string, onlineSet: Set<string>): FriendEntry[] {
  const rows = db
    .prepare(
      `SELECT u.id, u.username, u.level, u.rank_points, u.loadout_json, f.status
       FROM friends f
       JOIN users u ON u.id = f.friend_id
       WHERE f.user_id = ?`
    )
    .all(userId) as Record<string, any>[];
  return rows.map((r) => {
    const loadout = JSON.parse(r.loadout_json) as UserLoadout;
    return {
      id: r.id,
      username: r.username,
      level: r.level,
      rankPoints: r.rank_points,
      online: onlineSet.has(r.id),
      status: r.status,
      avatarId: loadout.avatarId,
      frameId: loadout.frameId,
    };
  });
}

export function addFriendByUsername(userId: string, targetUsername: string): { ok: boolean; error?: string } {
  const target = db
    .prepare('SELECT id FROM users WHERE lower(username) = lower(?)')
    .get(targetUsername.trim()) as { id: string } | undefined;
  if (!target) return { ok: false, error: 'Player username not found.' };
  if (target.id === userId) return { ok: false, error: 'Cannot add yourself.' };
  db.prepare('INSERT OR IGNORE INTO friends (user_id, friend_id, status) VALUES (?, ?, ?)').run(
    userId,
    target.id,
    'accepted'
  );
  db.prepare('INSERT OR IGNORE INTO friends (user_id, friend_id, status) VALUES (?, ?, ?)').run(
    target.id,
    userId,
    'accepted'
  );
  return { ok: true };
}

export function purchaseItem(userId: string, itemId: string, currency: 'coins' | 'diamonds'): { user?: UserProfile; error?: string } {
  const user = getUserProfile(userId);
  if (!user) return { error: 'User not found.' };
  if (user.inventory.includes(itemId)) return { error: 'Item already owned.' };

  const weapon = WEAPONS.find((w) => w.id === itemId);
  const col = COLLECTION_ITEMS.find((c) => c.id === itemId);
  const override = db.prepare('SELECT * FROM catalog_overrides WHERE item_id = ?').get(itemId) as
    | { price_coins: number | null; price_diamonds: number | null; enabled: number }
    | undefined;

  if (override && override.enabled === 0) return { error: 'Item is currently disabled by Admin.' };

  const priceCoins = override?.price_coins ?? weapon?.priceCoins ?? col?.priceCoins ?? 0;
  const priceDiamonds = override?.price_diamonds ?? weapon?.priceDiamonds ?? col?.priceDiamonds ?? 0;

  if (!weapon && !col) return { error: 'Unknown item.' };

  if (currency === 'coins') {
    if (priceCoins <= 0) return { error: 'Not purchasable with Coins.' };
    if (user.coins < priceCoins) return { error: 'Insufficient Coins.' };
    db.prepare('UPDATE users SET coins = coins - ? WHERE id = ?').run(priceCoins, userId);
  } else {
    if (priceDiamonds <= 0) return { error: 'Not purchasable with Diamonds.' };
    if (user.diamonds < priceDiamonds) return { error: 'Insufficient Diamonds.' };
    db.prepare('UPDATE users SET diamonds = diamonds - ? WHERE id = ?').run(priceDiamonds, userId);
  }

  db.prepare('INSERT OR IGNORE INTO user_inventory (user_id, item_id, unlocked_at) VALUES (?, ?, ?)').run(
    userId,
    itemId,
    new Date().toISOString()
  );

  return { user: getUserProfile(userId)! };
}

export function upgradeEvoSkin(userId: string, skinId: string): { user?: UserProfile; error?: string } {
  const user = getUserProfile(userId);
  if (!user) return { error: 'User not found.' };
  if (!user.inventory.includes(skinId)) return { error: 'Unlock this Evo skin first.' };

  const currentLv = user.loadout.evoLevels[skinId] || 1;
  if (currentLv >= 7) return { error: 'Already at Max Level 7.' };

  const diamondCost = currentLv * 45;
  if (user.diamonds < diamondCost) return { error: `Need ${diamondCost} Diamonds to evolve to Lv.${currentLv + 1}.` };

  const nextLoadout: UserLoadout = {
    ...user.loadout,
    evoLevels: {
      ...user.loadout.evoLevels,
      [skinId]: currentLv + 1,
    },
  };

  db.prepare('UPDATE users SET diamonds = diamonds - ?, loadout_json = ? WHERE id = ?').run(
    diamondCost,
    JSON.stringify(nextLoadout),
    userId
  );

  return { user: getUserProfile(userId)! };
}

export function recordMatchResult(userId: string, payload: MatchResultPayload): UserProfile | null {
  const user = getUserProfile(userId);
  if (!user) return null;

  // Offline sandbox gives practice rewards (unlimited coins in sandbox mode, no Ranked RP inflation)
  const rpDelta =
    payload.mode === 'ranked_br' && !payload.offlineSandbox
      ? (payload.won ? 48 : Math.max(-18, payload.kills * 6 - (payload.placement > 12 ? 12 : 0)))
      : payload.won
        ? 15
        : 4;

  const coinReward = payload.offlineSandbox ? 600 : 250 + payload.kills * 75 + (payload.won ? 600 : 120);
  const diamondReward = payload.offlineSandbox ? 10 : (payload.won ? 35 : 5) + Math.min(25, payload.kills * 3);
  const xpGain = 120 + payload.kills * 35 + (payload.won ? 240 : 60);

  const nextXp = user.xp + xpGain;
  const nextLevel = Math.max(user.level, 1 + Math.floor(nextXp / 500));
  const nextMissions = {
    ...user.missions,
    dailyKills: user.missions.dailyKills + payload.kills,
    dailyMatches: user.missions.dailyMatches + 1,
    dailyWins: user.missions.dailyWins + (payload.won ? 1 : 0),
    battlePassXp: user.missions.battlePassXp + Math.round(xpGain * 0.8),
  };

  db.prepare(
    `UPDATE users SET
      coins = coins + ?,
      diamonds = diamonds + ?,
      xp = ?,
      level = ?,
      rank_points = MAX(100, rank_points + ?),
      kills = kills + ?,
      wins = wins + ?,
      matches_played = matches_played + 1,
      missions_json = ?
     WHERE id = ?`
  ).run(
    coinReward,
    diamondReward,
    nextXp,
    nextLevel,
    rpDelta,
    payload.kills,
    payload.won ? 1 : 0,
    JSON.stringify(nextMissions),
    userId
  );

  return getUserProfile(userId);
}

export function claimDailyLogin(userId: string): { user?: UserProfile; rewardLabel?: string; error?: string } {
  const user = getUserProfile(userId);
  if (!user) return { error: 'User not found.' };
  const today = new Date().toISOString().slice(0, 10);
  if (user.missions.lastLoginClaim === today) {
    return { error: 'Today’s login reward was already claimed.' };
  }
  const dayIdx = user.missions.loginStreak % DAILY_REWARDS.length;
  const reward = DAILY_REWARDS[dayIdx];
  const nextMissions = {
    ...user.missions,
    loginStreak: user.missions.loginStreak + 1,
    lastLoginClaim: today,
  };
  db.prepare('UPDATE users SET coins = coins + ?, diamonds = diamonds + ?, missions_json = ? WHERE id = ?').run(
    reward.coins,
    reward.diamonds,
    JSON.stringify(nextMissions),
    userId
  );
  return { user: getUserProfile(userId)!, rewardLabel: reward.label };
}

export function claimMission(userId: string, missionId: string): { user?: UserProfile; error?: string } {
  const user = getUserProfile(userId);
  if (!user) return { error: 'User not found.' };
  const m = DAILY_MISSIONS.find((x) => x.id === missionId);
  if (!m) return { error: 'Mission not found.' };
  if (user.missions.claimedMissions.includes(missionId)) return { error: 'Already claimed.' };
  const progress = user.missions[m.targetKey];
  if (progress < m.target) return { error: 'Mission objective not yet complete.' };

  const nextMissions = {
    ...user.missions,
    claimedMissions: [...user.missions.claimedMissions, missionId],
    battlePassXp: user.missions.battlePassXp + m.bpXp,
  };
  db.prepare('UPDATE users SET coins = coins + ?, diamonds = diamonds + ?, missions_json = ? WHERE id = ?').run(
    m.coins,
    m.diamonds,
    JSON.stringify(nextMissions),
    userId
  );
  return { user: getUserProfile(userId)! };
}

export function claimBattlePassTier(userId: string, tier: number): { user?: UserProfile; error?: string } {
  const user = getUserProfile(userId);
  if (!user) return { error: 'User not found.' };
  const bp = BATTLE_PASS_TIERS.find((t) => t.tier === tier);
  if (!bp) return { error: 'Invalid tier.' };
  if (user.missions.battlePassXp < bp.requiredXp) return { error: 'Not enough Battle Pass XP.' };
  if (user.missions.claimedBpTiers.includes(tier)) return { error: 'Tier already claimed.' };

  const coins = bp.freeCoins;
  const diamonds = bp.freeDiamonds + (user.missions.battlePassElite ? bp.eliteDiamonds : 0);
  const nextMissions = {
    ...user.missions,
    claimedBpTiers: [...user.missions.claimedBpTiers, tier],
  };
  db.prepare('UPDATE users SET coins = coins + ?, diamonds = diamonds + ?, missions_json = ? WHERE id = ?').run(
    coins,
    diamonds,
    JSON.stringify(nextMissions),
    userId
  );
  return { user: getUserProfile(userId)! };
}

export function unlockElitePass(userId: string): { user?: UserProfile; error?: string } {
  const user = getUserProfile(userId);
  if (!user) return { error: 'User not found.' };
  if (user.missions.battlePassElite) return { error: 'Elite Pass already unlocked.' };
  const cost = 200;
  if (user.diamonds < cost) return { error: `Requires ${cost} Diamonds.` };
  const nextMissions = { ...user.missions, battlePassElite: true };
  db.prepare('UPDATE users SET diamonds = diamonds - ?, missions_json = ? WHERE id = ?').run(
    cost,
    JSON.stringify(nextMissions),
    userId
  );
  return { user: getUserProfile(userId)! };
}

export function listEvents(): GameEvent[] {
  const rows = db.prepare('SELECT * FROM events').all() as Record<string, any>[];
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    subtitle: r.subtitle,
    mode: r.mode,
    bonusMultiplier: r.bonus_multiplier,
    active: Boolean(r.active),
    endsAt: r.ends_at,
  }));
}

export function listPatchNotes(): PatchNote[] {
  const rows = db.prepare('SELECT * FROM patch_notes ORDER BY published_at DESC').all() as Record<string, any>[];
  return rows.map((r) => ({
    id: r.id,
    version: r.version,
    title: r.title,
    notes: r.notes,
    publishedAt: r.published_at,
  }));
}

export function listCatalogOverrides() {
  return db.prepare('SELECT * FROM catalog_overrides').all() as {
    item_id: string;
    price_coins: number | null;
    price_diamonds: number | null;
    is_upcoming: number;
    enabled: number;
  }[];
}
