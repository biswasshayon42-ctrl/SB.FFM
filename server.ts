import express from 'express';
import http from 'http';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import {
  addFriendByUsername,
  claimBattlePassTier,
  claimDailyLogin,
  claimMission,
  db,
  getFriends,
  getLeaderboard,
  getUserByToken,
  getUserProfile,
  listCatalogOverrides,
  listEvents,
  listPatchNotes,
  loginUser,
  purchaseItem,
  recordMatchResult,
  registerUser,
  unlockElitePass,
  upgradeEvoSkin,
} from './src/server/db';
import { MultiplayerHub } from './src/server/multiplayer';
import type { UserLoadout } from './src/shared/types';

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const hub = new MultiplayerHub(server);

  app.use(express.json());

  function getAuthUser(req: express.Request) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    return getUserByToken(token);
  }

  // Health
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, onlinePlayers: hub.getOnlineUserIds().size });
  });

  // Auth Routes
  app.post('/api/auth/register', (req, res) => {
    const { username, email, password } = req.body || {};
    const result = registerUser(String(username || ''), String(email || ''), String(password || ''));
    if (result.error) return res.status(400).json({ error: result.error });
    res.json(result);
  });

  app.post('/api/auth/login', (req, res) => {
    const { identifier, password } = req.body || {};
    const result = loginUser(String(identifier || ''), String(password || ''));
    if (result.error) return res.status(401).json({ error: result.error });
    res.json(result);
  });

  app.get('/api/me', (req, res) => {
    const user = getAuthUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    res.json({ user });
  });

  // Loadout & Collection
  app.post('/api/loadout', (req, res) => {
    const user = getAuthUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    const nextLoadout = req.body?.loadout as UserLoadout | undefined;
    if (!nextLoadout) return res.status(400).json({ error: 'Missing loadout payload' });
    // Preserve server-owned evoLevels
    nextLoadout.evoLevels = user.loadout.evoLevels;
    db.prepare('UPDATE users SET loadout_json = ? WHERE id = ?').run(JSON.stringify(nextLoadout), user.id);
    res.json({ user: getUserProfile(user.id) });
  });

  app.post('/api/shop/purchase', (req, res) => {
    const user = getAuthUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    const { itemId, currency } = req.body || {};
    const result = purchaseItem(user.id, String(itemId || ''), currency === 'diamonds' ? 'diamonds' : 'coins');
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ user: result.user });
  });

  app.post('/api/shop/evolve', (req, res) => {
    const user = getAuthUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    const result = upgradeEvoSkin(user.id, String(req.body?.skinId || ''));
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ user: result.user });
  });

  // Rewards, Missions & Battle Pass
  app.post('/api/rewards/daily-login', (req, res) => {
    const user = getAuthUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    const result = claimDailyLogin(user.id);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json(result);
  });

  app.post('/api/rewards/mission', (req, res) => {
    const user = getAuthUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    const result = claimMission(user.id, String(req.body?.missionId || ''));
    if (result.error) return res.status(400).json({ error: result.error });
    res.json(result);
  });

  app.post('/api/rewards/battle-pass', (req, res) => {
    const user = getAuthUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    const result = claimBattlePassTier(user.id, Number(req.body?.tier || 0));
    if (result.error) return res.status(400).json({ error: result.error });
    res.json(result);
  });

  app.post('/api/rewards/unlock-elite', (req, res) => {
    const user = getAuthUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    const result = unlockElitePass(user.id);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json(result);
  });

  app.post('/api/match/result', (req, res) => {
    const user = getAuthUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    const updated = recordMatchResult(user.id, req.body);
    res.json({ user: updated });
  });

  // Social, Leaderboard, Rooms, Events
  app.get('/api/leaderboard', (_req, res) => {
    res.json({ leaderboard: getLeaderboard() });
  });

  app.get('/api/friends', (req, res) => {
    const user = getAuthUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    res.json({ friends: getFriends(user.id, hub.getOnlineUserIds()) });
  });

  app.post('/api/friends/add', (req, res) => {
    const user = getAuthUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    const result = addFriendByUsername(user.id, String(req.body?.username || ''));
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ friends: getFriends(user.id, hub.getOnlineUserIds()) });
  });

  app.get('/api/rooms', (_req, res) => {
    res.json({ rooms: hub.getRoomsSummary() });
  });

  app.post('/api/rooms/create', (req, res) => {
    const user = getAuthUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    const room = hub.createCustomRoom({
      hostUserId: user.id,
      hostUsername: user.username,
      name: String(req.body?.name || ''),
      mode: req.body?.mode || 'classic_br',
      mapId: req.body?.mapId || 'shayon_island',
      squadSize: req.body?.squadSize || 'squad',
      weather: req.body?.weather || 'clear',
      timeOfDay: req.body?.timeOfDay || 'day',
      password: req.body?.password ? String(req.body.password) : undefined,
    });
    res.json({ room });
  });

  app.get('/api/events', (_req, res) => {
    res.json({ events: listEvents(), patchNotes: listPatchNotes(), overrides: listCatalogOverrides() });
  });

  // Admin Panel API (Developer Only)
  function requireAdmin(req: express.Request, res: express.Response) {
    const user = getAuthUser(req);
    if (!user || user.role !== 'admin') {
      res.status(403).json({ error: 'Developer Admin access required.' });
      return null;
    }
    return user;
  }

  app.get('/api/admin/overview', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const players = db
      .prepare(
        'SELECT id, username, email, role, diamonds, coins, level, rank_points, kills, wins, is_banned, created_at FROM users ORDER BY created_at DESC'
      )
      .all();
    res.json({
      players,
      events: listEvents(),
      patchNotes: listPatchNotes(),
      overrides: listCatalogOverrides(),
      telemetry: hub.getServerTelemetry(),
    });
  });

  app.post('/api/admin/currency', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { targetUserId, diamondsDelta, coinsDelta } = req.body || {};
    db.prepare(
      'UPDATE users SET diamonds = MAX(0, diamonds + ?), coins = MAX(0, coins + ?) WHERE id = ?'
    ).run(Number(diamondsDelta || 0), Number(coinsDelta || 0), String(targetUserId || ''));
    res.json({ ok: true, updatedUser: getUserProfile(String(targetUserId || '')) });
  });

  app.post('/api/admin/player-status', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { targetUserId, isBanned, role } = req.body || {};
    if (typeof isBanned === 'boolean') {
      db.prepare('UPDATE users SET is_banned = ? WHERE id = ?').run(isBanned ? 1 : 0, String(targetUserId));
    }
    if (role === 'admin' || role === 'player') {
      db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, String(targetUserId));
    }
    res.json({ ok: true });
  });

  app.post('/api/admin/events/toggle', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { eventId, active, bonusMultiplier } = req.body || {};
    db.prepare('UPDATE events SET active = ?, bonus_multiplier = ? WHERE id = ?').run(
      active ? 1 : 0,
      Number(bonusMultiplier || 1.5),
      String(eventId)
    );
    res.json({ events: listEvents() });
  });

  app.post('/api/admin/events/create', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { title, subtitle, mode, bonusMultiplier } = req.body || {};
    const id = `evt_${Date.now()}`;
    db.prepare(
      'INSERT INTO events (id, title, subtitle, mode, bonus_multiplier, active, ends_at) VALUES (?, ?, ?, ?, ?, 1, ?)'
    ).run(
      id,
      String(title || 'Flash Event'),
      String(subtitle || 'Bonus rewards active.'),
      String(mode || 'special_event'),
      Number(bonusMultiplier || 2.0),
      '2026-12-31T23:59:59Z'
    );
    res.json({ events: listEvents() });
  });

  app.post('/api/admin/catalog-override', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { itemId, priceCoins, priceDiamonds, enabled } = req.body || {};
    db.prepare(
      `INSERT INTO catalog_overrides (item_id, price_coins, price_diamonds, is_upcoming, enabled)
       VALUES (?, ?, ?, 0, ?)
       ON CONFLICT(item_id) DO UPDATE SET
         price_coins = excluded.price_coins,
         price_diamonds = excluded.price_diamonds,
         enabled = excluded.enabled`
    ).run(String(itemId), Number(priceCoins || 0), Number(priceDiamonds || 0), enabled === false ? 0 : 1);
    res.json({ overrides: listCatalogOverrides() });
  });

  app.post('/api/admin/patch-notes', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { version, title, notes } = req.body || {};
    db.prepare(
      'INSERT INTO patch_notes (id, version, title, notes, published_at) VALUES (?, ?, ?, ?, ?)'
    ).run(
      `patch_${Date.now()}`,
      String(version || '1.0.1'),
      String(title || 'Balance Update'),
      String(notes || ''),
      new Date().toISOString()
    );
    res.json({ patchNotes: listPatchNotes() });
  });

  // Vite / Static Serving
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = 3000;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`SHAYON FIRE MAX server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
