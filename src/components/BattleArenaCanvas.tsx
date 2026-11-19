import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  COLLECTION_ITEMS,
  MAPS,
  WEAPONS,
} from '../shared/catalog';
import type {
  MatchReplayRecord,
  MatchResultPayload,
  MatchSettings,
  ReplayFrame,
  ReplayHighlightEvent,
  ReplayShotSample,
  UserLoadout,
  WeaponSpec,
} from '../shared/types';
import { buildArenaMap, type BoxCollider } from '../game/mapBuilder';
import {
  createLootCrateModel,
  createParachuteModel,
  createPetModel,
  createStrikerCharacter,
  createVehicleModel,
  createWeaponModel,
  detectSoftwareWebGL,
  type StrikerRig,
} from '../game/proceduralModels';
import { soundEngine } from '../game/soundEngine';
import { saveMatchReplay } from '../lib/replayStorage';

export interface HudSnapshot {
  hp: number;
  maxHp: number;
  shield: number;
  maxShield: number;
  ammo: number;
  magSize: number;
  reloading: boolean;
  medkits: number;
  weaponIndex: number;
  weaponName: string;
  kills: number;
  aliveCount: number;
  wave: number;
  teamScore: number;
  enemyScore: number;
  zoneRadius: number;
  inStorm: boolean;
  isParachuting: boolean;
  inVehicle: boolean;
  nearInteract: string | null;
  adsActive: boolean;
  damageFlash: number;
  hitmarker: 'none' | 'body' | 'head';
  killFeed: { id: number; text: string; isPlayer: boolean }[];
  minimapEntities: { x: number; z: number; kind: 'enemy' | 'ally' | 'crate' | 'vehicle' }[];
  playerPos: { x: number; z: number; yaw: number };
}

export interface VirtualInputState {
  moveX: number;
  moveY: number;
  lookDeltaX: number;
  lookDeltaY: number;
  firing: boolean;
  ads: boolean;
  sprint: boolean;
}

export interface PeerStatePacket {
  userId: string;
  username: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  hp: number;
  weaponId: string;
  outfitId: string;
  emoteId?: string | null;
}

interface Props {
  settings: MatchSettings;
  loadout: UserLoadout;
  username: string;
  paused: boolean;
  onHudUpdate: (hud: HudSnapshot) => void;
  onMatchEnd: (result: MatchResultPayload, replay?: MatchReplayRecord) => void;
  onPauseRequest: () => void;
  replayFlushRef?: React.MutableRefObject<(() => MatchReplayRecord | null) | null>;
  virtualInputRef: React.MutableRefObject<VirtualInputState>;
  actionTriggerRef: React.MutableRefObject<{
    jump: boolean;
    reload: boolean;
    interact: boolean;
    medkit: boolean;
    emote: boolean;
    switchSlot: number | null;
  }>;
  sendWsMessage?: (payload: Record<string, unknown>) => void;
  peerStatesRef: React.MutableRefObject<Map<string, PeerStatePacket>>;
}

interface CombatActor {
  id: string;
  name: string;
  team: 'player' | 'enemy' | 'zombie';
  rig: StrikerRig;
  x: number;
  y: number;
  z: number;
  yaw: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  respawnTimer: number;
  shootCooldown: number;
  moveAngle: number;
  aiTimer: number;
  isZombie: boolean;
}

interface BulletTracer {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  damage: number;
  ownerTeam: 'player' | 'enemy';
  isExplosive: boolean;
  color: string;
}

interface ParticleBurst {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
}

// Pre-allocated math helpers (zero GC inside tick)
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _camTarget = new THREE.Vector3();
const _camIdeal = new THREE.Vector3();

function resolveColliderPush(
  x: number,
  z: number,
  y: number,
  radius: number,
  colliders: BoxCollider[]
): { x: number; z: number } {
  let nx = x;
  let nz = z;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (y >= c.height - 0.1) continue;
    const closestX = Math.max(c.minX, Math.min(nx, c.maxX));
    const closestZ = Math.max(c.minZ, Math.min(nz, c.maxZ));
    const dx = nx - closestX;
    const dz = nz - closestZ;
    const distSq = dx * dx + dz * dz;
    if (distSq < radius * radius) {
      if (distSq > 0.00001) {
        const dist = Math.sqrt(distSq);
        const push = radius - dist;
        nx += (dx / dist) * push;
        nz += (dz / dist) * push;
      } else {
        nx += radius;
      }
    }
  }
  return { x: nx, z: nz };
}

export const BattleArenaCanvas: React.FC<Props> = ({
  settings,
  loadout,
  username,
  paused,
  onHudUpdate,
  onMatchEnd,
  onPauseRequest,
  replayFlushRef,
  virtualInputRef,
  actionTriggerRef,
  sendWsMessage,
  peerStatesRef,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const onMatchEndRef = useRef(onMatchEnd);
  onMatchEndRef.current = onMatchEnd;

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = detectSoftwareWebGL();
    const ultra = settings.graphics === 'ultra';
    const mapDef = MAPS.find((m) => m.id === settings.mapId) || MAPS[0];

    const scene = new THREE.Scene();
    const dayColor = new THREE.Color(mapDef.skyDay);
    const nightColor = new THREE.Color(mapDef.skyNight);
    const initialBg = settings.timeOfDay === 'night' ? nightColor.clone() : dayColor.clone();
    scene.background = initialBg;
    scene.fog = new THREE.FogExp2(initialBg.getHex(), settings.weather === 'dust' ? 0.014 : 0.0075);

    const camera = new THREE.PerspectiveCamera(
      62,
      container.clientWidth / Math.max(1, container.clientHeight),
      0.15,
      280
    );

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, ultra ? 2 : 1.5));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    // Lighting Rig
    const hemiLight = new THREE.HemisphereLight('#bae6fd', '#334155', 0.75);
    scene.add(hemiLight);

    const sunLight = new THREE.DirectionalLight('#fff2d6', 2.0);
    sunLight.position.set(45, 75, 35);
    sunLight.castShadow = !isSoftwareGl;
    sunLight.shadow.mapSize.set(ultra ? 2048 : 1024, ultra ? 2048 : 1024);
    const sd = 75;
    sunLight.shadow.camera.left = -sd;
    sunLight.shadow.camera.right = sd;
    sunLight.shadow.camera.top = sd;
    sunLight.shadow.camera.bottom = -sd;
    sunLight.shadow.camera.near = 5;
    sunLight.shadow.camera.far = 190;
    sunLight.shadow.bias = -0.0005;
    sunLight.shadow.normalBias = 0.02;
    scene.add(sunLight);

    const rimLight = new THREE.DirectionalLight('#38bdf8', 0.55);
    rimLight.position.set(-40, 25, -40);
    scene.add(rimLight);

    // Build Arena Map
    const arena = buildArenaMap(settings.mapId, ultra);
    scene.add(arena.group);

    // Weather Particle System (Rain / Snow / Dust)
    let weatherPoints: THREE.Points | null = null;
    if (settings.weather !== 'clear') {
      const pCount = ultra ? 1400 : 750;
      const positions = new Float32Array(pCount * 3);
      for (let i = 0; i < pCount; i++) {
        positions[i * 3] = (Math.random() - 0.5) * 140;
        positions[i * 3 + 1] = Math.random() * 45;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 140;
      }
      const pGeo = new THREE.BufferGeometry();
      pGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const pColor =
        settings.weather === 'snow' ? '#f8fafc' : settings.weather === 'dust' ? '#fbbf24' : '#7dd3fc';
      const pMat = new THREE.PointsMaterial({
        color: pColor,
        size: settings.weather === 'snow' ? 0.38 : 0.22,
        transparent: true,
        opacity: 0.72,
      });
      weatherPoints = new THREE.Points(pGeo, pMat);
      scene.add(weatherPoints);
    }

    // Safe Zone Storm Ring
    const hasZone = settings.mode !== 'training' && settings.mode !== 'tdm' && settings.mode !== 'zombie_survival';
    let zoneRadius = hasZone ? 82 : 120;
    const zoneRingGeo = new THREE.CylinderGeometry(1, 1, 38, 48, 1, true);
    const zoneRingMat = new THREE.MeshBasicMaterial({
      color: '#38bdf8',
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const zoneCylinder = new THREE.Mesh(zoneRingGeo, zoneRingMat);
    zoneCylinder.position.y = 18;
    zoneCylinder.scale.set(zoneRadius, 1, zoneRadius);
    zoneCylinder.visible = hasZone;
    scene.add(zoneCylinder);

    // Player Rig & Weapons
    const outfit = COLLECTION_ITEMS.find((i) => i.id === loadout.outfitId);
    const charItem = COLLECTION_ITEMS.find((i) => i.id === loadout.characterId);
    const backpack = COLLECTION_ITEMS.find((i) => i.id === loadout.backpackId);
    const petItem = COLLECTION_ITEMS.find((i) => i.id === loadout.petId);
    const paraItem = COLLECTION_ITEMS.find((i) => i.id === loadout.parachuteId);
    const crateItem = COLLECTION_ITEMS.find((i) => i.id === loadout.lootCrateId);
    const vehSkin = COLLECTION_ITEMS.find((i) => i.id === loadout.vehicleSkinId);

    const playerWeapons: WeaponSpec[] = [
      WEAPONS.find((w) => w.id === loadout.primaryWeaponId) || WEAPONS[0],
      WEAPONS.find((w) => w.id === loadout.secondaryWeaponId) || WEAPONS[5],
      WEAPONS.find((w) => w.id === loadout.meleeWeaponId) || WEAPONS[7],
    ];

    const playerRig = createStrikerCharacter(outfit, charItem, backpack);
    scene.add(playerRig.root);

    let activeWeaponIdx = 0;
    const buildActiveWeaponOnRig = () => {
      while (playerRig.weaponMount.children.length > 0) {
        playerRig.weaponMount.remove(playerRig.weaponMount.children[0]);
      }
      const wSpec = playerWeapons[activeWeaponIdx];
      const skinId = loadout.gunSkinIds[wSpec.id];
      const skinItem = COLLECTION_ITEMS.find((i) => i.id === skinId);
      const evoLv = skinId ? loadout.evoLevels[skinId] || 1 : 1;
      const mesh = createWeaponModel(wSpec, skinItem, evoLv);
      mesh.rotation.set(0.08, 0, 0);
      playerRig.weaponMount.add(mesh);
    };
    buildActiveWeaponOnRig();

    // Player Pet Companion
    let petMesh: THREE.Group | null = null;
    if (petItem) {
      petMesh = createPetModel(petItem);
      scene.add(petMesh);
    }

    // Parachute Canopy attached during aerial drop
    const hasParachuteStart =
      settings.mode === 'classic_br' ||
      settings.mode === 'ranked_br' ||
      settings.mode === 'custom_room' ||
      settings.mode === 'special_event';
    let isParachuting = hasParachuteStart;
    const parachuteMesh = createParachuteModel(paraItem);
    parachuteMesh.visible = isParachuting;
    playerRig.root.add(parachuteMesh);

    // Muzzle Flash PointLight
    const muzzleLight = new THREE.PointLight('#fbbf24', 0, 9);
    scene.add(muzzleLight);

    // Driveable Vehicle on Map
    const vehicleMesh = createVehicleModel(vehSkin);
    const vehPos = new THREE.Vector3(14, arena.groundHeightAt(14, 10), 10);
    vehicleMesh.position.copy(vehPos);
    scene.add(vehicleMesh);
    let vehicleYaw = 0.4;
    let inVehicle = false;

    // Loot Crates
    const crates: { mesh: THREE.Group; pos: THREE.Vector3; active: boolean; respawn: number }[] =
      arena.crateSpots.map((spot) => {
        const mesh = createLootCrateModel(crateItem);
        mesh.position.copy(spot);
        scene.add(mesh);
        return { mesh, pos: spot.clone(), active: true, respawn: 0 };
      });

    // Player State
    let px = 0;
    let pz = hasParachuteStart ? 36 : 32;
    let py = hasParachuteStart ? 46 : arena.groundHeightAt(px, pz);
    let vy = 0;
    let yaw = 0;
    let pitch = -0.1;
    let hp = 100;
    const maxHp = 100;
    let shield = loadout.characterId === 'char_titan' ? 65 : 50;
    const maxShield = loadout.characterId === 'char_titan' ? 65 : 50;
    const ammoCounts = playerWeapons.map((w) => w.magSize);
    let reloadTimer = 0;
    let fireCooldown = 0;
    let medkits = 3;
    let kills = 0;
    let damageDealt = 0;
    let teamScore = 0;
    let enemyScore = 0;
    let wave = 1;
    let matchEnded = false;
    let elapsedMatch = 0;
    let emoteTimer = 0;
    let hitstopTimer = 0;
    let shakeIntensity = 0;
    let damageFlash = 0;
    let hitmarker: 'none' | 'body' | 'head' = 'none';
    let hitmarkerTimer = 0;
    let killFeedCounter = 1;
    const killFeed: { id: number; text: string; isPlayer: boolean }[] = [];
    const pushFeed = (text: string, isPlayer = false) => {
      killFeed.unshift({ id: killFeedCounter++, text, isPlayer });
      if (killFeed.length > 4) killFeed.pop();
    };

    // 60-Second Rolling Replay Telemetry Buffer (10 Hz)
    const round2 = (v: number) => Math.round(v * 100) / 100;
    const replayFrames: ReplayFrame[] = [];
    const replayHighlights: ReplayHighlightEvent[] = [];
    let pendingReplayShots: ReplayShotSample[] = [];
    let lastReplaySample = -1;
    let lastHeadshotHighlight = -1;
    const replayId = `replay_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    // Spawn AI Combatants (Bots / Allies / Zombies)
    const actors: CombatActor[] = [];
    const enemyOutfit = COLLECTION_ITEMS.find((i) => i.id === 'outfit_crimson_shogun');
    const allyOutfit = COLLECTION_ITEMS.find((i) => i.id === 'outfit_astral_valkyrie');
    const zombieOutfit = {
      ...COLLECTION_ITEMS[3],
      primaryColor: '#365314',
      secondaryColor: '#84cc16',
      emissiveColor: '#a3e635',
    };

    const spawnBot = (
      id: string,
      name: string,
      team: 'player' | 'enemy' | 'zombie',
      idx: number,
      isZombie = false
    ) => {
      const sp = arena.spawnPoints[idx % arena.spawnPoints.length];
      const angleOffset = idx * 1.1;
      const sx = sp.x + Math.cos(angleOffset) * 5;
      const sz = sp.z + Math.sin(angleOffset) * 5;
      const sy = arena.groundHeightAt(sx, sz);
      const rig = createStrikerCharacter(
        isZombie ? zombieOutfit : team === 'player' ? allyOutfit : enemyOutfit,
        undefined,
        undefined
      );
      if (!isZombie) {
        const w = createWeaponModel(WEAPONS[idx % 4]);
        rig.weaponMount.add(w);
        rig.rightArm.rotation.x = -0.85;
      } else {
        rig.leftArm.rotation.x = -1.35;
        rig.rightArm.rotation.x = -1.35;
      }
      rig.root.position.set(sx, sy, sz);
      scene.add(rig.root);

      actors.push({
        id,
        name,
        team,
        rig,
        x: sx,
        y: sy,
        z: sz,
        yaw: 0,
        hp: isZombie ? 75 + wave * 15 : settings.mode === 'training' ? 100 : 90,
        maxHp: isZombie ? 75 + wave * 15 : 100,
        alive: true,
        respawnTimer: 0,
        shootCooldown: 0.6 + Math.random() * 1.2,
        moveAngle: Math.random() * Math.PI * 2,
        aiTimer: 1 + Math.random() * 2,
        isZombie,
      });
    };

    if (settings.mode === 'training') {
      for (let i = 0; i < 6; i++) {
        spawnBot(`dummy_${i}`, `Target-0${i + 1}`, 'enemy', i + 2);
      }
    } else if (settings.mode === 'zombie_survival') {
      for (let i = 0; i < 6; i++) {
        spawnBot(`zom_${i}`, `Infected-0${i + 1}`, 'zombie', (i + 3) % arena.spawnPoints.length, true);
      }
    } else if (settings.mode === 'clash_squad' || settings.mode === 'tdm') {
      for (let i = 0; i < 3; i++) spawnBot(`ally_${i}`, `Squad-${i + 1}`, 'player', i);
      for (let i = 0; i < 4; i++) spawnBot(`enemy_${i}`, `[BOT] Viper-${i + 1}`, 'enemy', i + 3);
    } else {
      // Battle Royale Modes
      const botCount = settings.squadSize === 'solo' ? 10 : 12;
      if (settings.squadSize !== 'solo') {
        const allies = settings.squadSize === 'duo' ? 1 : 2;
        for (let i = 0; i < allies; i++) spawnBot(`ally_${i}`, `Ally-${i + 1}`, 'player', i);
      }
      const botNames = ['[BOT] Raze', '[BOT] Kestrel', '[BOT] Specter', '[BOT] Vandal', '[BOT] Onyx', '[BOT] Drako', '[BOT] Nova', '[BOT] Blitz', '[BOT] Talon', '[BOT] Zero', '[BOT] Echo', '[BOT] Phantom'];
      for (let i = 0; i < botCount; i++) {
        spawnBot(`br_bot_${i}`, botNames[i % botNames.length], 'enemy', (i + 2) % arena.spawnPoints.length);
      }
    }

    // Remote WebSocket Human Peers Map
    const remotePeerRigs = new Map<string, StrikerRig>();

    // Bullet Tracers & Particles
    const tracers: BulletTracer[] = [];
    const particles: ParticleBurst[] = [];
    const tracerGeo = new THREE.SphereGeometry(0.09, 6, 6);
    const sparkGeo = new THREE.BoxGeometry(0.11, 0.11, 0.11);

    const spawnBurst = (pos: THREE.Vector3, hex: string, count = 6) => {
      for (let i = 0; i < count; i++) {
        const m = new THREE.Mesh(
          sparkGeo,
          new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 1 })
        );
        m.position.copy(pos);
        scene.add(m);
        particles.push({
          mesh: m,
          vel: new THREE.Vector3(
            (Math.random() - 0.5) * 8,
            Math.random() * 6 + 1,
            (Math.random() - 0.5) * 8
          ),
          life: 0.32 + Math.random() * 0.2,
        });
      }
    };

    // Input Tracking (Continuous held vs Edge justPressed)
    const keys: Record<string, boolean> = {};
    let mouseFiring = false;
    let mouseAds = false;

    const onKeyDown = (e: KeyboardEvent) => {
      keys[e.code] = true;
      if (e.code === 'Escape') {
        if (document.pointerLockElement) document.exitPointerLock();
        onPauseRequest();
      }
      if (e.code === 'Space') actionTriggerRef.current.jump = true;
      if (e.code === 'KeyR') actionTriggerRef.current.reload = true;
      if (e.code === 'KeyF') actionTriggerRef.current.interact = true;
      if (e.code === 'KeyH') actionTriggerRef.current.medkit = true;
      if (e.code === 'KeyE') actionTriggerRef.current.emote = true;
      if (e.code === 'Digit1') actionTriggerRef.current.switchSlot = 0;
      if (e.code === 'Digit2') actionTriggerRef.current.switchSlot = 1;
      if (e.code === 'Digit3') actionTriggerRef.current.switchSlot = 2;
    };

    const onKeyUp = (e: KeyboardEvent) => {
      keys[e.code] = false;
    };

    const onBlur = () => {
      for (const k of Object.keys(keys)) keys[k] = false;
      mouseFiring = false;
      mouseAds = false;
    };

    const onMouseMove = (e: MouseEvent) => {
      if (pausedRef.current) return;
      if (document.pointerLockElement === renderer.domElement || mouseAds || mouseFiring) {
        const sens = mouseAds ? 0.0016 : 0.0028;
        yaw -= e.movementX * sens;
        pitch = THREE.MathUtils.clamp(pitch - e.movementY * sens, -0.65, 0.55);
      }
    };

    const onMouseDown = (e: MouseEvent) => {
      if (pausedRef.current) return;
      if (e.target === renderer.domElement && !document.pointerLockElement) {
        renderer.domElement.requestPointerLock?.();
      }
      if (e.button === 0) mouseFiring = true;
      if (e.button === 2) mouseAds = true;
    };

    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 0) mouseFiring = false;
      if (e.button === 2) mouseAds = false;
    };

    const onContextMenu = (e: MouseEvent) => e.preventDefault();

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    window.addEventListener('mousemove', onMouseMove);
    renderer.domElement.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    renderer.domElement.addEventListener('contextmenu', onContextMenu);

    const handleResize = () => {
      if (!container) return;
      camera.aspect = container.clientWidth / Math.max(1, container.clientHeight);
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    };
    window.addEventListener('resize', handleResize);

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    const fireWeapon = (isPlayer: boolean, origin: THREE.Vector3, dir: THREE.Vector3, spec: WeaponSpec) => {
      const mColor = isPlayer ? spec.accentColor : '#ef4444';
      const mesh = new THREE.Mesh(
        tracerGeo,
        new THREE.MeshBasicMaterial({ color: mColor })
      );
      mesh.position.copy(origin);
      scene.add(mesh);

      tracers.push({
        mesh,
        pos: origin.clone(),
        vel: dir.clone().multiplyScalar(spec.projectileSpeed),
        life: spec.range / spec.projectileSpeed,
        damage: spec.damage,
        ownerTeam: isPlayer ? 'player' : 'enemy',
        isExplosive: spec.category === 'special',
        color: mColor,
      });

      pendingReplayShots.push({
        ox: round2(origin.x),
        oy: round2(origin.y),
        oz: round2(origin.z),
        dx: round2(dir.x),
        dy: round2(dir.y),
        dz: round2(dir.z),
        color: mColor,
        isPlayer,
      });

      if (isPlayer) {
        muzzleLight.position.copy(origin);
        muzzleLight.color.set(mColor);
        muzzleLight.intensity = 4.5;
        soundEngine.playShoot(spec.category);
        shakeIntensity = Math.max(shakeIntensity, spec.category === 'sniper' ? 0.22 : 0.06);
        sendWsMessage?.({
          type: 'match:shoot',
          origin: { x: origin.x, y: origin.y, z: origin.z },
          dir: { x: dir.x, y: dir.y, z: dir.z },
          weaponId: spec.id,
        });
      }
    };

    const clock = new THREE.Clock();
    let frameId = 0;
    let lastHudEmit = 0;
    let lastWsEmit = 0;

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    const sampleReplayFrame = (force = false) => {
      if (!force && elapsedMatch - lastReplaySample < 0.1) return;
      lastReplaySample = elapsedMatch;
      const spec = playerWeapons[activeWeaponIdx] || playerWeapons[0];
      replayFrames.push({
        t: round2(elapsedMatch),
        p: {
          x: round2(px),
          y: round2(py),
          z: round2(pz),
          yaw: round2(yaw),
          pitch: round2(pitch),
          hp: Math.max(0, Math.round(hp)),
          shield: Math.max(0, Math.round(shield)),
          weaponId: spec.id,
          para: isParachuting,
          veh: inVehicle,
          emote: emoteTimer > 0,
        },
        v: {
          x: round2(vehPos.x),
          y: round2(vehPos.y),
          z: round2(vehPos.z),
          yaw: round2(vehicleYaw),
        },
        zr: round2(zoneRadius),
        a: actors.map((act) => ({
          id: act.id,
          name: act.name,
          x: round2(act.x),
          y: round2(act.y),
          z: round2(act.z),
          yaw: round2(act.yaw),
          team: act.team,
          isZombie: act.isZombie,
          alive: act.alive,
        })),
        shots: pendingReplayShots,
      });
      pendingReplayShots = [];

      const cutoff = elapsedMatch - 62;
      while (replayFrames.length > 0 && replayFrames[0].t < cutoff) {
        replayFrames.shift();
      }
      while (replayHighlights.length > 0 && replayHighlights[0].t < cutoff) {
        replayHighlights.shift();
      }
    };

    const buildAndSaveReplay = (won: boolean, placement: number): MatchReplayRecord => {
      sampleReplayFrame(true);
      const startT = replayFrames[0]?.t ?? 0;
      const endT = replayFrames[replayFrames.length - 1]?.t ?? startT;
      const record: MatchReplayRecord = {
        id: replayId,
        savedAt: new Date().toISOString(),
        mode: settings.mode,
        mapId: settings.mapId,
        graphics: settings.graphics,
        weather: settings.weather,
        timeOfDay: settings.timeOfDay,
        won,
        placement,
        kills,
        username,
        loadout,
        durationSeconds: round2(Math.max(0.1, endT - startT)),
        frames: replayFrames.slice(),
        highlights: replayHighlights.slice(),
      };
      return saveMatchReplay(record);
    };

    if (replayFlushRef) {
      replayFlushRef.current = () => {
        const aliveEnemiesNow = actors.filter((a) => a.alive && a.team !== 'player').length;
        return buildAndSaveReplay(false, aliveEnemiesNow + 1);
      };
    }

    const finishMatch = (won: boolean, placement: number) => {
      if (matchEnded) return;
      matchEnded = true;
      if (document.pointerLockElement) document.exitPointerLock();
      if (won) soundEngine.playVictory();
      replayHighlights.push({
        t: round2(elapsedMatch),
        kind: won ? 'victory' : 'eliminated',
        label: won ? 'BOOYAH — Victory!' : `Eliminated (#${placement})`,
        x: round2(px),
        y: round2(py),
        z: round2(pz),
      });
      const savedReplay = buildAndSaveReplay(won, placement);
      onMatchEndRef.current(
        {
          mode: settings.mode,
          mapId: settings.mapId,
          won,
          placement,
          kills,
          damageDealt: Math.round(damageDealt),
          survivalSeconds: Math.round(elapsedMatch),
          offlineSandbox: Boolean(settings.offlineSandbox || settings.mode === 'training'),
        },
        savedReplay
      );
    };

    function tick() {
      const rawDt = clock.getDelta();
      let dt = Math.min(rawDt, 0.05);

      if (hitstopTimer > 0) {
        hitstopTimer -= dt;
        dt *= 0.2;
      }

      if (!pausedRef.current && !matchEnded) {
        elapsedMatch += dt;

        // Day & Night Cycle
        if (settings.timeOfDay === 'dynamic' || settings.timeOfDay === 'sunset') {
          const cycle =
            settings.timeOfDay === 'sunset'
              ? 0.55
              : (Math.sin(elapsedMatch * 0.035) + 1) * 0.5;
          const skyCol = dayColor.clone().lerp(nightColor, cycle);
          (scene.background as THREE.Color).copy(skyCol);
          if (scene.fog instanceof THREE.FogExp2) scene.fog.color.copy(skyCol);
          sunLight.intensity = THREE.MathUtils.lerp(2.1, 0.45, cycle);
          sunLight.position.set(Math.cos(cycle * Math.PI) * 65, 25 + (1 - cycle) * 55, 35);
          hemiLight.intensity = THREE.MathUtils.lerp(0.8, 0.32, cycle);
        }

        // Weather Animation
        if (weatherPoints) {
          const posArr = weatherPoints.geometry.attributes.position.array as Float32Array;
          const speedY = settings.weather === 'rain' ? 32 : settings.weather === 'snow' ? 4.5 : 1.5;
          const driftX = settings.weather === 'dust' ? 14 : 2;
          for (let i = 0; i < posArr.length; i += 3) {
            posArr[i] += driftX * dt;
            posArr[i + 1] -= speedY * dt;
            if (posArr[i + 1] < 0) {
              posArr[i + 1] = 42;
              posArr[i] = px + (Math.random() - 0.5) * 120;
              posArr[i + 2] = pz + (Math.random() - 0.5) * 120;
            }
          }
          weatherPoints.geometry.attributes.position.needsUpdate = true;
        }

        // Virtual Touch Look
        const vIn = virtualInputRef.current;
        if (Math.abs(vIn.lookDeltaX) > 0.0001 || Math.abs(vIn.lookDeltaY) > 0.0001) {
          yaw -= vIn.lookDeltaX * 0.0045;
          pitch = THREE.MathUtils.clamp(pitch - vIn.lookDeltaY * 0.0045, -0.65, 0.55);
          vIn.lookDeltaX = 0;
          vIn.lookDeltaY = 0;
        }

        // Weapon Switch
        if (actionTriggerRef.current.switchSlot !== null) {
          const slot = actionTriggerRef.current.switchSlot;
          actionTriggerRef.current.switchSlot = null;
          if (slot >= 0 && slot < playerWeapons.length && slot !== activeWeaponIdx) {
            activeWeaponIdx = slot;
            reloadTimer = 0;
            buildActiveWeaponOnRig();
          }
        }

        const activeSpec = playerWeapons[activeWeaponIdx];

        // Reload
        if (actionTriggerRef.current.reload) {
          actionTriggerRef.current.reload = false;
          if (reloadTimer <= 0 && ammoCounts[activeWeaponIdx] < activeSpec.magSize) {
            const reloadMult = loadout.characterId === 'char_shayon' ? 0.9 : 1;
            reloadTimer = activeSpec.reloadTime * reloadMult;
            soundEngine.playReload();
          }
        }
        if (reloadTimer > 0) {
          reloadTimer -= dt;
          if (reloadTimer <= 0) {
            ammoCounts[activeWeaponIdx] = activeSpec.magSize;
          }
        }

        // Medkit
        if (actionTriggerRef.current.medkit) {
          actionTriggerRef.current.medkit = false;
          if (medkits > 0 && hp < maxHp) {
            medkits -= 1;
            hp = Math.min(maxHp, hp + 45);
            soundEngine.playPickup();
          }
        }

        // Emote
        if (actionTriggerRef.current.emote) {
          actionTriggerRef.current.emote = false;
          emoteTimer = 1.4;
        }
        if (emoteTimer > 0) emoteTimer = Math.max(0, emoteTimer - dt);

        // Interact (Enter/Exit Vehicle or Loot Crate)
        const distToVehicle = Math.hypot(px - vehPos.x, pz - vehPos.z);
        let nearInteract: string | null = null;
        if (inVehicle) {
          nearInteract = 'Press F to Exit Vehicle';
        } else if (distToVehicle < 4.2 && !isParachuting) {
          nearInteract = 'Press F to Drive Buggy';
        } else {
          for (const c of crates) {
            if (c.active && Math.hypot(px - c.pos.x, pz - c.pos.z) < 3.4) {
              nearInteract = 'Press F to Loot Supply Crate';
              break;
            }
          }
        }

        if (actionTriggerRef.current.interact) {
          actionTriggerRef.current.interact = false;
          if (inVehicle) {
            inVehicle = false;
            px += Math.cos(vehicleYaw) * 2.4;
            pz -= Math.sin(vehicleYaw) * 2.4;
            replayHighlights.push({
              t: round2(elapsedMatch),
              kind: 'vehicle',
              label: 'Exited Vehicle',
              x: round2(px),
              y: round2(py),
              z: round2(pz),
            });
          } else if (distToVehicle < 4.2 && !isParachuting) {
            inVehicle = true;
            replayHighlights.push({
              t: round2(elapsedMatch),
              kind: 'vehicle',
              label: 'Mounted Buggy',
              x: round2(vehPos.x),
              y: round2(vehPos.y),
              z: round2(vehPos.z),
            });
          } else {
            for (const c of crates) {
              if (c.active && Math.hypot(px - c.pos.x, pz - c.pos.z) < 3.8) {
                c.active = false;
                c.mesh.visible = false;
                c.respawn = 18;
                shield = Math.min(maxShield, shield + 30);
                medkits = Math.min(5, medkits + 1);
                ammoCounts[activeWeaponIdx] = activeSpec.magSize;
                soundEngine.playPickup();
                pushFeed('Looted Supply Crate (+Armor, +Medkit)', true);
                break;
              }
            }
          }
        }

        // Respawn crates
        for (const c of crates) {
          if (!c.active) {
            c.respawn -= dt;
            if (c.respawn <= 0) {
              c.active = true;
              c.mesh.visible = true;
            }
          } else {
            c.mesh.rotation.y += dt * 0.6;
          }
        }

        // Player Movement
        let moveForward = (keys['KeyW'] || keys['ArrowUp'] ? 1 : 0) - (keys['KeyS'] || keys['ArrowDown'] ? 1 : 0);
        let moveRight = (keys['KeyD'] || keys['ArrowRight'] ? 1 : 0) - (keys['KeyA'] || keys['ArrowLeft'] ? 1 : 0);
        moveForward += vIn.moveY;
        moveRight += vIn.moveX;
        const moveLen = Math.hypot(moveForward, moveRight);
        if (moveLen > 1) {
          moveForward /= moveLen;
          moveRight /= moveLen;
        }

        const isSprinting = Boolean(keys['ShiftLeft'] || keys['ShiftRight'] || vIn.sprint);
        const isCrouching = Boolean(keys['KeyC']);
        const adsActive = Boolean(mouseAds || vIn.ads) && !isParachuting && !inVehicle;

        if (inVehicle) {
          // Vehicle Driving Physics
          const throttle = moveForward;
          const steer = moveRight;
          if (Math.abs(throttle) > 0.05) {
            vehicleYaw -= steer * dt * 2.3 * Math.sign(throttle);
          }
          const vSpeed = throttle * 21;
          vehPos.x -= Math.sin(vehicleYaw) * vSpeed * dt;
          vehPos.z -= Math.cos(vehicleYaw) * vSpeed * dt;
          const clamped = resolveColliderPush(vehPos.x, vehPos.z, vehPos.y, 1.8, arena.colliders);
          vehPos.x = THREE.MathUtils.clamp(clamped.x, -arena.arenaRadius, arena.arenaRadius);
          vehPos.z = THREE.MathUtils.clamp(clamped.z, -arena.arenaRadius, arena.arenaRadius);
          vehPos.y = arena.groundHeightAt(vehPos.x, vehPos.z);
          vehicleMesh.position.copy(vehPos);
          vehicleMesh.rotation.y = vehicleYaw + Math.PI;

          px = vehPos.x;
          py = vehPos.y + 0.6;
          pz = vehPos.z;
          playerRig.root.visible = false;
        } else {
          playerRig.root.visible = true;
          const charSpeedBonus = loadout.characterId === 'char_nyx' ? 1.08 : 1.0;
          const meleeBonus = activeSpec.category === 'melee' ? 1.12 : 1.0;
          const baseSpeed = isParachuting
            ? 14.5
            : (isCrouching ? 4.8 : isSprinting ? 10.6 : 7.4) * charSpeedBonus * meleeBonus;

          const sinY = Math.sin(yaw);
          const cosY = Math.cos(yaw);
          const vx = (-sinY * moveForward + cosY * moveRight) * baseSpeed;
          const vz = (-cosY * moveForward - sinY * moveRight) * baseSpeed;

          px += vx * dt;
          pz += vz * dt;

          const pushed = resolveColliderPush(px, pz, py, 0.62, arena.colliders);
          px = THREE.MathUtils.clamp(pushed.x, -arena.arenaRadius, arena.arenaRadius);
          pz = THREE.MathUtils.clamp(pushed.z, -arena.arenaRadius, arena.arenaRadius);

          const groundY = arena.groundHeightAt(px, pz);

          if (isParachuting) {
            py -= (keys['KeyW'] ? 7.5 : 5.2) * dt;
            if (actionTriggerRef.current.jump && py < groundY + 14) {
              isParachuting = false;
              parachuteMesh.visible = false;
            }
            if (py <= groundY) {
              py = groundY;
              isParachuting = false;
              parachuteMesh.visible = false;
              actionTriggerRef.current.jump = false;
            }
          } else {
            if (actionTriggerRef.current.jump) {
              actionTriggerRef.current.jump = false;
              if (py <= groundY + 0.08) {
                vy = settings.mode === 'special_event' ? 12.5 : 8.6;
              }
            }
            vy -= (settings.mode === 'special_event' ? 14 : 23) * dt;
            py += vy * dt;
            if (py <= groundY) {
              py = groundY;
              vy = 0;
            }
          }

          playerRig.root.position.set(px, py, pz);
          playerRig.root.rotation.y = yaw + Math.PI;

          // Procedural Stride / Crouch / Emote Animation
          const horizSpeed = Math.hypot(vx, vz);
          if (emoteTimer > 0) {
            playerRig.root.rotation.y += Math.sin(emoteTimer * Math.PI * 3) * 2.4;
            playerRig.leftArm.rotation.x = -2.2;
            playerRig.rightArm.rotation.x = -2.2;
          } else if (isParachuting) {
            playerRig.leftArm.rotation.x = -2.4;
            playerRig.rightArm.rotation.x = -2.4;
            playerRig.leftLeg.rotation.x = 0.25;
            playerRig.rightLeg.rotation.x = -0.2;
          } else if (horizSpeed > 0.4) {
            const stride = Math.sin(elapsedMatch * (isSprinting ? 12 : 8));
            playerRig.leftLeg.rotation.x = stride * 0.65;
            playerRig.rightLeg.rotation.x = -stride * 0.65;
            playerRig.leftArm.rotation.x = -0.45 - stride * 0.3;
            playerRig.rightArm.rotation.x = -0.95 + pitch * 0.6;
          } else {
            playerRig.leftLeg.rotation.x = THREE.MathUtils.damp(playerRig.leftLeg.rotation.x, 0, 10, dt);
            playerRig.rightLeg.rotation.x = THREE.MathUtils.damp(playerRig.rightLeg.rotation.x, 0, 10, dt);
            playerRig.rightArm.rotation.x = -0.95 + pitch * 0.6;
          }
          playerRig.torso.position.y = isCrouching ? 0.78 : 1.02;
        }

        // Pet Follow
        if (petMesh) {
          const targetPetX = px - Math.cos(yaw) * 1.1;
          const targetPetZ = pz + Math.sin(yaw) * 1.1;
          const targetPetY =
            (loadout.petId === 'pet_recon_drone' ? py + 1.45 + Math.sin(elapsedMatch * 4) * 0.14 : arena.groundHeightAt(targetPetX, targetPetZ));
          petMesh.position.x = THREE.MathUtils.damp(petMesh.position.x, targetPetX, 5, dt);
          petMesh.position.z = THREE.MathUtils.damp(petMesh.position.z, targetPetZ, 5, dt);
          petMesh.position.y = THREE.MathUtils.damp(petMesh.position.y, targetPetY, 6, dt);
          petMesh.rotation.y = yaw + Math.PI;
          petMesh.visible = !inVehicle;
        }

        // Shooting
        if (fireCooldown > 0) fireCooldown -= dt;
        const wantsFire = Boolean(mouseFiring || vIn.firing) && !isParachuting && !inVehicle && reloadTimer <= 0;
        if (wantsFire && fireCooldown <= 0) {
          if (ammoCounts[activeWeaponIdx] <= 0 && settings.mode !== 'training') {
            actionTriggerRef.current.reload = true;
          } else {
            if (settings.mode !== 'training' && activeSpec.category !== 'melee') {
              ammoCounts[activeWeaponIdx] -= 1;
            }
            fireCooldown = 1 / activeSpec.fireRate;
            const spread = adsActive ? activeSpec.spread * 0.35 : activeSpec.spread;
            _v1.set(px, py + (isCrouching ? 1.05 : 1.45), pz);
            _v2.set(
              -Math.sin(yaw) * Math.cos(pitch) + (Math.random() - 0.5) * spread,
              Math.sin(pitch) + (Math.random() - 0.5) * spread,
              -Math.cos(yaw) * Math.cos(pitch) + (Math.random() - 0.5) * spread
            ).normalize();
            _v1.addScaledVector(_v2, 0.9);
            fireWeapon(true, _v1, _v2, activeSpec);
          }
        }

        // Safe Zone Shrinking & Storm Damage
        let inStorm = false;
        if (hasZone) {
          zoneRadius = Math.max(12, zoneRadius - dt * 0.72);
          zoneCylinder.scale.set(zoneRadius, 1, zoneRadius);
          const distCenter = Math.hypot(px, pz);
          if (distCenter > zoneRadius && !isParachuting) {
            inStorm = true;
            hp -= dt * 3.8;
            damageFlash = Math.max(damageFlash, 0.25);
          }
        }

        // AI Actors Update
        let aliveEnemies = 0;
        for (let i = 0; i < actors.length; i++) {
          const a = actors[i];
          if (!a.alive) {
            if (settings.mode === 'tdm' || settings.mode === 'training' || settings.mode === 'special_event') {
              a.respawnTimer -= dt;
              if (a.respawnTimer <= 0) {
                a.alive = true;
                a.hp = a.maxHp;
                a.rig.root.visible = true;
                const sp = arena.spawnPoints[i % arena.spawnPoints.length];
                a.x = sp.x;
                a.z = sp.z;
                a.y = arena.groundHeightAt(a.x, a.z);
              }
            }
            continue;
          }

          if (a.team !== 'player') aliveEnemies++;

          const distToPlayer = Math.hypot(px - a.x, pz - a.z);
          if (a.isZombie) {
            // Zombies rush player directly
            a.yaw = Math.atan2(px - a.x, pz - a.z);
            const zSpeed = 4.6 + wave * 0.25;
            a.x += Math.sin(a.yaw) * zSpeed * dt;
            a.z += Math.cos(a.yaw) * zSpeed * dt;
            if (distToPlayer < 1.9 && !isParachuting) {
              a.shootCooldown -= dt;
              if (a.shootCooldown <= 0) {
                a.shootCooldown = 0.85;
                let dmg = 11;
                if (shield > 0) {
                  const absorbed = Math.min(shield, dmg * 0.6);
                  shield -= absorbed;
                  dmg -= absorbed;
                }
                hp -= dmg;
                damageFlash = 0.7;
              }
            }
          } else {
            // Tactical Bot AI
            a.aiTimer -= dt;
            if (a.aiTimer <= 0) {
              a.aiTimer = 1.2 + Math.random() * 1.8;
              if (hasZone && Math.hypot(a.x, a.z) > zoneRadius * 0.8) {
                a.moveAngle = Math.atan2(-a.x, -a.z);
              } else {
                a.moveAngle = Math.random() * Math.PI * 2;
              }
            }
            const botSpeed = settings.mode === 'training' ? 2.1 : 4.2;
            a.x += Math.sin(a.moveAngle) * botSpeed * dt;
            a.z += Math.cos(a.moveAngle) * botSpeed * dt;

            if (a.team === 'enemy' && settings.mode !== 'training' && distToPlayer < 52 && !isParachuting) {
              a.yaw = Math.atan2(px - a.x, pz - a.z);
              a.shootCooldown -= dt;
              if (a.shootCooldown <= 0) {
                a.shootCooldown = 0.75 + Math.random() * 0.9;
                _v1.set(a.x, a.y + 1.4, a.z);
                _v2.set(
                  px - a.x + (Math.random() - 0.5) * 4.2,
                  py + 1.1 - (a.y + 1.4) + (Math.random() - 0.5) * 1.4,
                  pz - a.z + (Math.random() - 0.5) * 4.2
                ).normalize();
                fireWeapon(false, _v1, _v2, WEAPONS[0]);
              }
            } else {
              a.yaw = a.moveAngle;
            }
          }

          const pushedBot = resolveColliderPush(a.x, a.z, a.y, 0.6, arena.colliders);
          a.x = THREE.MathUtils.clamp(pushedBot.x, -arena.arenaRadius, arena.arenaRadius);
          a.z = THREE.MathUtils.clamp(pushedBot.z, -arena.arenaRadius, arena.arenaRadius);
          a.y = arena.groundHeightAt(a.x, a.z);
          a.rig.root.position.set(a.x, a.y, a.z);
          a.rig.root.rotation.y = a.yaw;
          const stride = Math.sin(elapsedMatch * 7 + i);
          a.rig.leftLeg.rotation.x = stride * 0.5;
          a.rig.rightLeg.rotation.x = -stride * 0.5;
        }

        // Update Remote WebSocket Human Peers
        peerStatesRef.current.forEach((peer, peerId) => {
          let rig = remotePeerRigs.get(peerId);
          if (!rig) {
            const pOutfit = COLLECTION_ITEMS.find((c) => c.id === peer.outfitId);
            rig = createStrikerCharacter(pOutfit, undefined, undefined);
            rig.weaponMount.add(createWeaponModel(WEAPONS[0]));
            scene.add(rig.root);
            remotePeerRigs.set(peerId, rig);
          }
          rig.root.visible = peer.hp > 0;
          rig.root.position.set(peer.x, peer.y, peer.z);
          rig.root.rotation.y = peer.yaw + Math.PI;
        });

        // Update Tracers & Hit Detection
        for (let i = tracers.length - 1; i >= 0; i--) {
          const tr = tracers[i];
          tr.pos.addScaledVector(tr.vel, dt);
          tr.mesh.position.copy(tr.pos);
          tr.life -= dt;

          let remove = tr.life <= 0 || tr.pos.y < arena.groundHeightAt(tr.pos.x, tr.pos.z);

          // Check building hit
          if (!remove) {
            for (const c of arena.colliders) {
              if (
                tr.pos.x >= c.minX &&
                tr.pos.x <= c.maxX &&
                tr.pos.z >= c.minZ &&
                tr.pos.z <= c.maxZ &&
                tr.pos.y <= c.height
              ) {
                remove = true;
                spawnBurst(tr.pos, tr.color, 4);
                break;
              }
            }
          }

          // Check actor hits
          if (!remove && tr.ownerTeam === 'player') {
            for (const a of actors) {
              if (!a.alive || a.team === 'player') continue;
              const dx = tr.pos.x - a.x;
              const dz = tr.pos.z - a.z;
              const dy = tr.pos.y - a.y;
              if (dx * dx + dz * dz < 0.72 && dy >= 0 && dy <= 2.05) {
                const isHead = dy > 1.48;
                const dmg = tr.damage * (isHead ? 1.55 : 1.0);
                a.hp -= dmg;
                damageDealt += dmg;
                hitmarker = isHead ? 'head' : 'body';
                hitmarkerTimer = 0.16;
                soundEngine.playHit(isHead);
                spawnBurst(tr.pos, isHead ? '#fbbf24' : '#ef4444', isHead ? 9 : 5);
                if (isHead || tr.isExplosive) {
                  hitstopTimer = 0.035;
                }
                if (tr.isExplosive) soundEngine.playExplosion();
                if (a.hp <= 0) {
                  a.alive = false;
                  a.rig.root.visible = false;
                  a.respawnTimer = 2.6;
                  kills += 1;
                  teamScore += 1;
                  pushFeed(`${username} eliminated ${a.name}`, true);
                  replayHighlights.push({
                    t: round2(elapsedMatch),
                    kind: isHead ? 'headshot' : 'kill',
                    label: isHead ? `Headshot Elim · ${a.name}` : `Eliminated ${a.name}`,
                    x: round2(a.x),
                    y: round2(a.y),
                    z: round2(a.z),
                  });
                } else if (isHead && elapsedMatch - lastHeadshotHighlight > 0.5) {
                  lastHeadshotHighlight = elapsedMatch;
                  replayHighlights.push({
                    t: round2(elapsedMatch),
                    kind: 'headshot',
                    label: `Headshot Hit · ${a.name}`,
                    x: round2(a.x),
                    y: round2(a.y),
                    z: round2(a.z),
                  });
                }
                remove = true;
                break;
              }
            }
          } else if (!remove && tr.ownerTeam === 'enemy' && !isParachuting) {
            const dx = tr.pos.x - px;
            const dz = tr.pos.z - pz;
            const dy = tr.pos.y - py;
            if (dx * dx + dz * dz < 0.55 && dy >= 0 && dy <= 1.95) {
              let dmg = tr.damage * 0.48;
              if (shield > 0) {
                const absorbed = Math.min(shield, dmg * 0.65);
                shield -= absorbed;
                dmg -= absorbed;
              }
              hp -= dmg;
              damageFlash = 0.65;
              spawnBurst(tr.pos, '#ef4444', 5);
              remove = true;
            }
          }

          if (remove) {
            scene.remove(tr.mesh);
            tracers.splice(i, 1);
          }
        }

        // Update Particles
        for (let i = particles.length - 1; i >= 0; i--) {
          const p = particles[i];
          p.vel.y -= 18 * dt;
          p.mesh.position.addScaledVector(p.vel, dt);
          p.life -= dt;
          if (p.life <= 0) {
            scene.remove(p.mesh);
            particles.splice(i, 1);
          }
        }

        // Decay visual timers
        muzzleLight.intensity = THREE.MathUtils.damp(muzzleLight.intensity, 0, 22, dt);
        shakeIntensity = THREE.MathUtils.damp(shakeIntensity, 0, 14, dt);
        damageFlash = Math.max(0, damageFlash - dt * 1.8);
        if (hitmarkerTimer > 0) {
          hitmarkerTimer -= dt;
          if (hitmarkerTimer <= 0) hitmarker = 'none';
        }

        // Win / Loss Checks
        if (hp <= 0) {
          if (settings.mode === 'tdm' || settings.mode === 'training') {
            hp = maxHp;
            shield = maxShield;
            px = 0;
            pz = 32;
            py = arena.groundHeightAt(px, pz);
            enemyScore += 1;
            pushFeed(`${username} respawned`, false);
          } else {
            finishMatch(false, aliveEnemies + 1);
          }
        } else if (settings.mode === 'zombie_survival' && aliveEnemies === 0) {
          if (wave >= 3) {
            finishMatch(true, 1);
          } else {
            wave += 1;
            pushFeed(`Wave ${wave} Incoming!`, true);
            for (let z = 0; z < 5 + wave * 2; z++) {
              spawnBot(`zom_w${wave}_${z}`, `Infected W${wave}`, 'zombie', z % arena.spawnPoints.length, true);
            }
          }
        } else if (settings.mode === 'tdm' && teamScore >= 15) {
          finishMatch(true, 1);
        } else if (
          (settings.mode === 'classic_br' ||
            settings.mode === 'ranked_br' ||
            settings.mode === 'clash_squad' ||
            settings.mode === 'custom_room') &&
          aliveEnemies === 0
        ) {
          finishMatch(true, 1);
        }

        // Camera Follow (Smooth Over-The-Shoulder / Vehicle Chase / Parachute)
        const targetFov = adsActive
          ? activeSpec.category === 'sniper'
            ? 30
            : 44
          : inVehicle
            ? 70
            : 62;
        camera.fov = THREE.MathUtils.damp(camera.fov, targetFov, 12, dt);
        camera.updateProjectionMatrix();

        const camDist = isParachuting ? 7.5 : inVehicle ? 7.2 : adsActive ? 2.4 : 4.2;
        const camHeight = isParachuting ? 3.2 : inVehicle ? 3.0 : isCrouching ? 1.35 : 1.85;
        const shoulderOffset = inVehicle || isParachuting ? 0 : adsActive ? 0.55 : 0.72;

        const effYaw = inVehicle ? vehicleYaw : yaw;
        _camIdeal.set(
          px + Math.sin(effYaw) * camDist + Math.cos(effYaw) * shoulderOffset,
          py + camHeight - Math.sin(pitch) * (camDist * 0.45),
          pz + Math.cos(effYaw) * camDist - Math.sin(effYaw) * shoulderOffset
        );
        const minGround = arena.groundHeightAt(_camIdeal.x, _camIdeal.z) + 0.55;
        if (_camIdeal.y < minGround) _camIdeal.y = minGround;

        camera.position.x = THREE.MathUtils.damp(camera.position.x, _camIdeal.x, 16, dt);
        camera.position.y = THREE.MathUtils.damp(camera.position.y, _camIdeal.y, 16, dt);
        camera.position.z = THREE.MathUtils.damp(camera.position.z, _camIdeal.z, 16, dt);

        if (shakeIntensity > 0.005) {
          camera.position.x += (Math.random() - 0.5) * shakeIntensity;
          camera.position.y += (Math.random() - 0.5) * shakeIntensity;
        }

        _camTarget.set(
          px - Math.sin(effYaw) * 14,
          py + (isCrouching ? 1.1 : 1.5) + Math.sin(pitch) * 10,
          pz - Math.cos(effYaw) * 14
        );
        camera.lookAt(_camTarget);

        // Capture 10Hz Rolling Replay Telemetry Sample
        sampleReplayFrame(false);

        // Throttled WebSocket State Broadcast (15Hz)
        if (sendWsMessage && elapsedMatch - lastWsEmit > 0.066) {
          lastWsEmit = elapsedMatch;
          sendWsMessage({
            type: 'match:state',
            x: Number(px.toFixed(2)),
            y: Number(py.toFixed(2)),
            z: Number(pz.toFixed(2)),
            yaw: Number(yaw.toFixed(2)),
            hp: Math.round(hp),
            weaponId: activeSpec.id,
            outfitId: loadout.outfitId,
            emoteId: emoteTimer > 0 ? loadout.emoteId : null,
          });
        }

        // Throttled HUD Snapshot (~12Hz)
        if (elapsedMatch - lastHudEmit > 0.08) {
          lastHudEmit = elapsedMatch;
          onHudUpdate({
            hp: Math.max(0, Math.round(hp)),
            maxHp,
            shield: Math.max(0, Math.round(shield)),
            maxShield,
            ammo: ammoCounts[activeWeaponIdx],
            magSize: activeSpec.magSize,
            reloading: reloadTimer > 0,
            medkits,
            weaponIndex: activeWeaponIdx,
            weaponName: activeSpec.name,
            kills,
            aliveCount: aliveEnemies + 1,
            wave,
            teamScore,
            enemyScore,
            zoneRadius: Math.round(zoneRadius),
            inStorm,
            isParachuting,
            inVehicle,
            nearInteract,
            adsActive,
            damageFlash,
            hitmarker,
            killFeed: [...killFeed],
            minimapEntities: [
              ...actors
                .filter((a) => a.alive)
                .map((a) => ({
                  x: a.x,
                  z: a.z,
                  kind: (a.team === 'player' ? 'ally' : 'enemy') as 'ally' | 'enemy',
                })),
              ...crates
                .filter((c) => c.active)
                .map((c) => ({ x: c.pos.x, z: c.pos.z, kind: 'crate' as const })),
              { x: vehPos.x, z: vehPos.z, kind: 'vehicle' as const },
            ],
            playerPos: { x: px, z: pz, yaw },
          });
        }
      }

      renderer.render(scene, camera);

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    }

    tick();

    return () => {
      if (replayFlushRef) replayFlushRef.current = null;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('resize', handleResize);
      renderer.domElement.removeEventListener('mousedown', onMouseDown);
      renderer.domElement.removeEventListener('contextmenu', onContextMenu);
      if (document.pointerLockElement === renderer.domElement) {
        document.exitPointerLock();
      }
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [settings]);

  return <div ref={mountRef} className="w-full h-full relative" />;
};
