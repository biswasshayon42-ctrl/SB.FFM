import type http from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { getUserByToken } from './db';
import type { GameModeId, MapId, RoomSummary, SquadSize, TimeOfDay, WeatherType } from '../shared/types';

interface ConnectedClient {
  ws: WebSocket;
  userId: string;
  username: string;
  roomCode: string | null;
  mutedBySelf: boolean;
  voiceChannel: 'squad' | 'all' | 'off';
  lastPingAt: number;
}

interface ActiveRoom {
  code: string;
  name: string;
  hostUserId: string;
  hostUsername: string;
  mode: GameModeId;
  mapId: MapId;
  squadSize: SquadSize;
  weather: WeatherType;
  timeOfDay: TimeOfDay;
  password: string;
  maxPlayers: number;
  status: 'waiting' | 'in_match';
  members: Map<
    string,
    {
      userId: string;
      username: string;
      x: number;
      y: number;
      z: number;
      yaw: number;
      hp: number;
      weaponId: string;
      outfitId: string;
      kills: number;
    }
  >;
}

const PROFANITY_LIST = ['badword', 'cheat', 'hack', 'noobtrash'];

function sanitizeChat(text: string): string {
  let clean = text.slice(0, 140);
  for (const word of PROFANITY_LIST) {
    const re = new RegExp(word, 'gi');
    clean = clean.replace(re, '***');
  }
  return clean;
}

export class MultiplayerHub {
  private wss: WebSocketServer;
  private clients = new Map<WebSocket, ConnectedClient>();
  private userSockets = new Map<string, WebSocket>();
  private rooms = new Map<string, ActiveRoom>();
  private totalMessagesProcessed = 0;

  constructor(server: http.Server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    // Seed a persistent public Quick-Play Squad Lobby so players see live server activity
    this.rooms.set('SHAYON', {
      code: 'SHAYON',
      name: 'Shayon Island — Public Arena 01',
      hostUserId: 'system',
      hostUsername: 'Vanguard Host',
      mode: 'classic_br',
      mapId: 'shayon_island',
      squadSize: 'squad',
      weather: 'clear',
      timeOfDay: 'dynamic',
      password: '',
      maxPlayers: 24,
      status: 'waiting',
      members: new Map(),
    });

    this.wss.on('connection', (ws) => {
      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          this.handleMessage(ws, msg);
        } catch {
          // Ignore malformed JSON frames
        }
      });

      ws.on('close', () => {
        this.handleDisconnect(ws);
      });
    });
  }

  public getOnlineUserIds(): Set<string> {
    return new Set(this.userSockets.keys());
  }

  public getRoomsSummary(): RoomSummary[] {
    return Array.from(this.rooms.values()).map((r) => ({
      code: r.code,
      name: r.name,
      hostUsername: r.hostUsername,
      mode: r.mode,
      mapId: r.mapId,
      squadSize: r.squadSize,
      weather: r.weather,
      timeOfDay: r.timeOfDay,
      playerCount: r.members.size,
      maxPlayers: r.maxPlayers,
      hasPassword: Boolean(r.password),
      status: r.status,
    }));
  }

  public getServerTelemetry() {
    return {
      onlinePlayers: this.userSockets.size,
      activeRooms: this.rooms.size,
      messagesProcessed: this.totalMessagesProcessed,
      rooms: this.getRoomsSummary(),
    };
  }

  public createCustomRoom(params: {
    hostUserId: string;
    hostUsername: string;
    name: string;
    mode: GameModeId;
    mapId: MapId;
    squadSize: SquadSize;
    weather: WeatherType;
    timeOfDay: TimeOfDay;
    password?: string;
  }): RoomSummary {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const room: ActiveRoom = {
      code,
      name: params.name.trim().slice(0, 32) || `${params.hostUsername}'s Room`,
      hostUserId: params.hostUserId,
      hostUsername: params.hostUsername,
      mode: params.mode,
      mapId: params.mapId,
      squadSize: params.squadSize,
      weather: params.weather,
      timeOfDay: params.timeOfDay,
      password: params.password || '',
      maxPlayers: params.mode === 'clash_squad' || params.mode === 'tdm' ? 8 : 24,
      status: 'waiting',
      members: new Map(),
    };
    this.rooms.set(code, room);
    this.broadcastRoomsUpdate();
    return {
      code: room.code,
      name: room.name,
      hostUsername: room.hostUsername,
      mode: room.mode,
      mapId: room.mapId,
      squadSize: room.squadSize,
      weather: room.weather,
      timeOfDay: room.timeOfDay,
      playerCount: 0,
      maxPlayers: room.maxPlayers,
      hasPassword: Boolean(room.password),
      status: room.status,
    };
  }

  private handleMessage(ws: WebSocket, msg: any) {
    this.totalMessagesProcessed += 1;
    const type = msg?.type;

    if (type === 'auth') {
      const user = getUserByToken(msg.token);
      if (!user) {
        ws.send(JSON.stringify({ type: 'auth:error', error: 'Invalid session token' }));
        return;
      }
      const client: ConnectedClient = {
        ws,
        userId: user.id,
        username: user.username,
        roomCode: null,
        mutedBySelf: false,
        voiceChannel: 'squad',
        lastPingAt: Date.now(),
      };
      this.clients.set(ws, client);
      this.userSockets.set(user.id, ws);
      ws.send(
        JSON.stringify({
          type: 'auth:ok',
          userId: user.id,
          rooms: this.getRoomsSummary(),
          onlineCount: this.userSockets.size,
        })
      );
      return;
    }

    const client = this.clients.get(ws);
    if (!client) return;

    if (type === 'ping') {
      client.lastPingAt = Date.now();
      ws.send(JSON.stringify({ type: 'pong', ts: msg.ts }));
      return;
    }

    if (type === 'squad:invite') {
      const targetWs = this.userSockets.get(msg.targetUserId);
      if (targetWs && targetWs.readyState === WebSocket.OPEN) {
        targetWs.send(
          JSON.stringify({
            type: 'squad:invite',
            fromUserId: client.userId,
            fromUsername: client.username,
            mode: msg.mode,
            mapId: msg.mapId,
            roomCode: msg.roomCode || 'SHAYON',
          })
        );
      }
      return;
    }

    if (type === 'room:join') {
      const code = String(msg.roomCode || 'SHAYON').toUpperCase();
      let room = this.rooms.get(code);
      if (!room) {
        ws.send(JSON.stringify({ type: 'room:error', error: 'Room code not found.' }));
        return;
      }
      if (room.password && room.password !== (msg.password || '')) {
        ws.send(JSON.stringify({ type: 'room:error', error: 'Incorrect room password.' }));
        return;
      }
      if (client.roomCode && client.roomCode !== code) {
        this.leaveCurrentRoom(client);
      }
      client.roomCode = code;
      room.members.set(client.userId, {
        userId: client.userId,
        username: client.username,
        x: 0,
        y: 0,
        z: 0,
        yaw: 0,
        hp: 100,
        weaponId: msg.weaponId || 'sf47_vanguard',
        outfitId: msg.outfitId || 'outfit_classic_ranger',
        kills: 0,
      });
      if (msg.inMatch) {
        room.status = 'in_match';
      }
      ws.send(
        JSON.stringify({
          type: 'room:joined',
          code: room.code,
          members: Array.from(room.members.values()),
        })
      );
      this.broadcastToRoom(
        room,
        {
          type: 'room:member_joined',
          member: room.members.get(client.userId),
        },
        client.userId
      );
      this.broadcastRoomsUpdate();
      return;
    }

    if (type === 'room:leave') {
      this.leaveCurrentRoom(client);
      return;
    }

    if (type === 'match:state' && client.roomCode) {
      const room = this.rooms.get(client.roomCode);
      if (!room) return;
      const member = room.members.get(client.userId);
      if (member) {
        member.x = Number(msg.x) || 0;
        member.y = Number(msg.y) || 0;
        member.z = Number(msg.z) || 0;
        member.yaw = Number(msg.yaw) || 0;
        member.hp = Number(msg.hp) ?? 100;
        member.weaponId = msg.weaponId || member.weaponId;
        member.outfitId = msg.outfitId || member.outfitId;
      }
      this.broadcastToRoom(
        room,
        {
          type: 'match:peer_state',
          userId: client.userId,
          username: client.username,
          x: msg.x,
          y: msg.y,
          z: msg.z,
          yaw: msg.yaw,
          hp: msg.hp,
          weaponId: msg.weaponId,
          outfitId: msg.outfitId,
          emoteId: msg.emoteId || null,
        },
        client.userId
      );
      return;
    }

    if (type === 'match:shoot' && client.roomCode) {
      const room = this.rooms.get(client.roomCode);
      if (!room) return;
      this.broadcastToRoom(
        room,
        {
          type: 'match:peer_shoot',
          userId: client.userId,
          origin: msg.origin,
          dir: msg.dir,
          weaponId: msg.weaponId,
        },
        client.userId
      );
      return;
    }

    if (type === 'match:chat' && client.roomCode) {
      const room = this.rooms.get(client.roomCode);
      if (!room) return;
      const safeText = sanitizeChat(String(msg.text || ''));
      if (!safeText) return;
      this.broadcastToRoom(room, {
        type: 'match:chat',
        userId: client.userId,
        username: client.username,
        text: safeText,
        ts: Date.now(),
      });
      return;
    }

    if (type === 'voice:status') {
      client.mutedBySelf = Boolean(msg.muted);
      client.voiceChannel = msg.channel || 'squad';
      if (client.roomCode) {
        const room = this.rooms.get(client.roomCode);
        if (room) {
          this.broadcastToRoom(room, {
            type: 'voice:peer_status',
            userId: client.userId,
            username: client.username,
            muted: client.mutedBySelf,
            channel: client.voiceChannel,
          });
        }
      }
    }
  }

  private leaveCurrentRoom(client: ConnectedClient) {
    if (!client.roomCode) return;
    const room = this.rooms.get(client.roomCode);
    if (room) {
      room.members.delete(client.userId);
      this.broadcastToRoom(room, {
        type: 'room:member_left',
        userId: client.userId,
      });
      if (room.code !== 'SHAYON' && room.members.size === 0) {
        this.rooms.delete(room.code);
      } else if (room.members.size === 0) {
        room.status = 'waiting';
      }
    }
    client.roomCode = null;
    this.broadcastRoomsUpdate();
  }

  private handleDisconnect(ws: WebSocket) {
    const client = this.clients.get(ws);
    if (!client) return;
    this.leaveCurrentRoom(client);
    this.clients.delete(ws);
    if (this.userSockets.get(client.userId) === ws) {
      this.userSockets.delete(client.userId);
    }
  }

  private broadcastToRoom(room: ActiveRoom, payload: any, excludeUserId?: string) {
    const json = JSON.stringify(payload);
    for (const memberId of room.members.keys()) {
      if (excludeUserId && memberId === excludeUserId) continue;
      const targetWs = this.userSockets.get(memberId);
      if (targetWs && targetWs.readyState === WebSocket.OPEN) {
        targetWs.send(json);
      }
    }
  }

  private broadcastRoomsUpdate() {
    const json = JSON.stringify({
      type: 'rooms:list',
      rooms: this.getRoomsSummary(),
      onlineCount: this.userSockets.size,
    });
    for (const ws of this.clients.keys()) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(json);
      }
    }
  }
}
