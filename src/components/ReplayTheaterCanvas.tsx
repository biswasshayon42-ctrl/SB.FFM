import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { COLLECTION_ITEMS, MAPS, WEAPONS } from '../shared/catalog';
import type {
  MatchReplayRecord,
  ReplayActorSample,
  ReplayCameraPerspective,
  ReplayFrame,
} from '../shared/types';
import { buildArenaMap } from '../game/mapBuilder';
import {
  createParachuteModel,
  createPetModel,
  createStrikerCharacter,
  createVehicleModel,
  createWeaponModel,
  detectSoftwareWebGL,
  type StrikerRig,
} from '../game/proceduralModels';

export interface ReplayTelemetryHud {
  hp: number;
  shield: number;
  weaponName: string;
  zoneRadius: number;
  aliveCount: number;
  inVehicle: boolean;
  isParachuting: boolean;
}

interface Props {
  replay: MatchReplayRecord;
  perspective: ReplayCameraPerspective;
  playing: boolean;
  speed: number;
  currentTime: number;
  onTimeChange: (t: number) => void;
  onPlayingChange: (playing: boolean) => void;
  onTelemetryUpdate?: (hud: ReplayTelemetryHud) => void;
}

interface ReplayTracer {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  color: string;
}

interface ReplaySpark {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
}

const _camIdeal = new THREE.Vector3();
const _camTarget = new THREE.Vector3();
const _orbitDelta = new THREE.Vector3();
const _prevOrbitFocus = new THREE.Vector3();
const _sparkPos = new THREE.Vector3();

function lerpAngle(a: number, b: number, t: number): number {
  const diff = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + diff * t;
}

function findBracketingFrames(
  frames: ReplayFrame[],
  absT: number
): { i0: number; i1: number; alpha: number } {
  if (frames.length <= 1) return { i0: 0, i1: 0, alpha: 0 };
  if (absT <= frames[0].t) return { i0: 0, i1: 0, alpha: 0 };
  const last = frames.length - 1;
  if (absT >= frames[last].t) return { i0: last, i1: last, alpha: 0 };

  let lo = 0;
  let hi = last;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t <= absT) lo = mid;
    else hi = mid;
  }
  const span = Math.max(0.0001, frames[hi].t - frames[lo].t);
  return {
    i0: lo,
    i1: hi,
    alpha: THREE.MathUtils.clamp((absT - frames[lo].t) / span, 0, 1),
  };
}

export const ReplayTheaterCanvas: React.FC<Props> = ({
  replay,
  perspective,
  playing,
  speed,
  currentTime,
  onTimeChange,
  onPlayingChange,
  onTelemetryUpdate,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);

  const perspectiveRef = useRef(perspective);
  const prevPerspectiveRef = useRef<ReplayCameraPerspective>(perspective);
  perspectiveRef.current = perspective;

  const playingRef = useRef(playing);
  playingRef.current = playing;

  const speedRef = useRef(speed);
  speedRef.current = speed;

  const externalTimeRef = useRef(currentTime);
  const playheadRef = useRef(currentTime);
  if (Math.abs(currentTime - externalTimeRef.current) > 0.0001) {
    externalTimeRef.current = currentTime;
    if (Math.abs(playheadRef.current - currentTime) > 0.14 || !playing) {
      playheadRef.current = currentTime;
    }
  }

  const onTimeChangeRef = useRef(onTimeChange);
  onTimeChangeRef.current = onTimeChange;
  const onPlayingChangeRef = useRef(onPlayingChange);
  onPlayingChangeRef.current = onPlayingChange;
  const onTelemetryUpdateRef = useRef(onTelemetryUpdate);
  onTelemetryUpdateRef.current = onTelemetryUpdate;

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const frames = replay.frames;
    const startT = frames[0]?.t ?? 0;
    const endT = frames[frames.length - 1]?.t ?? startT;
    const duration = Math.max(0.1, endT - startT);

    const isSoftwareGl = detectSoftwareWebGL();
    const ultra = replay.graphics === 'ultra';
    const mapDef = MAPS.find((m) => m.id === replay.mapId) || MAPS[0];

    const scene = new THREE.Scene();
    const dayColor = new THREE.Color(mapDef.skyDay);
    const nightColor = new THREE.Color(mapDef.skyNight);
    const initialBg = replay.timeOfDay === 'night' ? nightColor.clone() : dayColor.clone();
    scene.background = initialBg;
    scene.fog = new THREE.FogExp2(initialBg.getHex(), replay.weather === 'dust' ? 0.014 : 0.0075);

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

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.08;
    controls.minDistance = 3;
    controls.maxDistance = 42;
    controls.maxPolarAngle = Math.PI * 0.48;
    controls.enabled = perspectiveRef.current === 'orbit';

    // Three-point lighting
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
    const arena = buildArenaMap(replay.mapId, ultra);
    scene.add(arena.group);

    // Weather Particle System
    let weatherPoints: THREE.Points | null = null;
    if (replay.weather !== 'clear') {
      const pCount = ultra ? 1200 : 650;
      const positions = new Float32Array(pCount * 3);
      for (let i = 0; i < pCount; i++) {
        positions[i * 3] = (Math.random() - 0.5) * 140;
        positions[i * 3 + 1] = Math.random() * 45;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 140;
      }
      const pGeo = new THREE.BufferGeometry();
      pGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const pColor =
        replay.weather === 'snow' ? '#f8fafc' : replay.weather === 'dust' ? '#fbbf24' : '#7dd3fc';
      const pMat = new THREE.PointsMaterial({
        color: pColor,
        size: replay.weather === 'snow' ? 0.38 : 0.22,
        transparent: true,
        opacity: 0.7,
      });
      weatherPoints = new THREE.Points(pGeo, pMat);
      scene.add(weatherPoints);
    }

    // Safe Zone Storm Ring
    const hasZone =
      replay.mode !== 'training' && replay.mode !== 'tdm' && replay.mode !== 'zombie_survival';
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
    zoneCylinder.visible = hasZone;
    scene.add(zoneCylinder);

    // Player Rig & Loadout
    const loadout = replay.loadout;
    const outfit = COLLECTION_ITEMS.find((i) => i.id === loadout.outfitId);
    const charItem = COLLECTION_ITEMS.find((i) => i.id === loadout.characterId);
    const backpack = COLLECTION_ITEMS.find((i) => i.id === loadout.backpackId);
    const petItem = COLLECTION_ITEMS.find((i) => i.id === loadout.petId);
    const paraItem = COLLECTION_ITEMS.find((i) => i.id === loadout.parachuteId);
    const vehSkin = COLLECTION_ITEMS.find((i) => i.id === loadout.vehicleSkinId);

    const playerRig = createStrikerCharacter(outfit, charItem, backpack);
    scene.add(playerRig.root);

    let equippedWeaponId = '';
    const ensurePlayerWeapon = (weaponId: string) => {
      if (equippedWeaponId === weaponId) return;
      equippedWeaponId = weaponId;
      while (playerRig.weaponMount.children.length > 0) {
        playerRig.weaponMount.remove(playerRig.weaponMount.children[0]);
      }
      const wSpec = WEAPONS.find((w) => w.id === weaponId) || WEAPONS[0];
      const skinId = loadout.gunSkinIds[wSpec.id];
      const skinItem = COLLECTION_ITEMS.find((i) => i.id === skinId);
      const evoLv = skinId ? loadout.evoLevels[skinId] || 1 : 1;
      const mesh = createWeaponModel(wSpec, skinItem, evoLv);
      mesh.rotation.set(0.08, 0, 0);
      playerRig.weaponMount.add(mesh);
    };
    ensurePlayerWeapon(frames[0]?.p.weaponId || loadout.primaryWeaponId);

    const parachuteMesh = createParachuteModel(paraItem);
    parachuteMesh.visible = false;
    playerRig.root.add(parachuteMesh);

    let petMesh: THREE.Group | null = null;
    if (petItem) {
      petMesh = createPetModel(petItem);
      scene.add(petMesh);
    }

    const vehicleMesh = createVehicleModel(vehSkin);
    scene.add(vehicleMesh);

    // Pre-create Rigs for All Actors Observed in Replay
    const enemyOutfit = COLLECTION_ITEMS.find((i) => i.id === 'outfit_crimson_shogun');
    const allyOutfit = COLLECTION_ITEMS.find((i) => i.id === 'outfit_astral_valkyrie');
    const zombieOutfit = {
      ...COLLECTION_ITEMS[3],
      primaryColor: '#365314',
      secondaryColor: '#84cc16',
      emissiveColor: '#a3e635',
    };

    const actorRigs = new Map<string, StrikerRig>();
    const ensureActorRig = (sample: ReplayActorSample, indexHint: number): StrikerRig => {
      let rig = actorRigs.get(sample.id);
      if (rig) return rig;
      rig = createStrikerCharacter(
        sample.isZombie ? zombieOutfit : sample.team === 'player' ? allyOutfit : enemyOutfit,
        undefined,
        undefined
      );
      if (!sample.isZombie) {
        rig.weaponMount.add(createWeaponModel(WEAPONS[indexHint % 4]));
        rig.rightArm.rotation.x = -0.85;
      } else {
        rig.leftArm.rotation.x = -1.35;
        rig.rightArm.rotation.x = -1.35;
      }
      scene.add(rig.root);
      actorRigs.set(sample.id, rig);
      return rig;
    };

    frames.forEach((f) => {
      f.a.forEach((a, idx) => ensureActorRig(a, idx));
    });

    // Tracers & Sparks for Weapon Fire Visualization
    const tracers: ReplayTracer[] = [];
    const sparks: ReplaySpark[] = [];
    const tracerGeo = new THREE.SphereGeometry(0.095, 6, 6);
    const sparkGeo = new THREE.BoxGeometry(0.11, 0.11, 0.11);

    const spawnSparkBurst = (pos: THREE.Vector3, hex: string, count = 4) => {
      for (let i = 0; i < count; i++) {
        const m = new THREE.Mesh(
          sparkGeo,
          new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 1 })
        );
        m.position.copy(pos);
        scene.add(m);
        sparks.push({
          mesh: m,
          vel: new THREE.Vector3(
            (Math.random() - 0.5) * 7,
            Math.random() * 5 + 1,
            (Math.random() - 0.5) * 7
          ),
          life: 0.28 + Math.random() * 0.18,
        });
      }
    };

    const spawnReplayShotsFromFrame = (frame: ReplayFrame) => {
      for (let i = 0; i < frame.shots.length; i++) {
        const s = frame.shots[i];
        const m = new THREE.Mesh(tracerGeo, new THREE.MeshBasicMaterial({ color: s.color }));
        m.position.set(s.ox, s.oy, s.oz);
        scene.add(m);
        tracers.push({
          mesh: m,
          pos: new THREE.Vector3(s.ox, s.oy, s.oz),
          vel: new THREE.Vector3(s.dx, s.dy, s.dz).multiplyScalar(78),
          life: 0.55,
          color: s.color,
        });
      }
    };

    // Initial Camera Focus
    const initFrame = frames[0];
    if (initFrame) {
      _prevOrbitFocus.set(initFrame.p.x, initFrame.p.y + 1.4, initFrame.p.z);
      controls.target.copy(_prevOrbitFocus);
      camera.position.set(initFrame.p.x + 6, initFrame.p.y + 4.5, initFrame.p.z + 6);
      camera.lookAt(controls.target);
    }

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

    const clock = new THREE.Clock();
    let frameId = 0;
    let lastTriggeredFrame = -1;
    let lastUiEmit = 0;
    let lastHudEmit = 0;

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

    function tick() {
      const rawDt = clock.getDelta();
      const dt = Math.min(rawDt, 0.05);

      if (frames.length > 0) {
        if (playingRef.current) {
          playheadRef.current += dt * speedRef.current;
          if (playheadRef.current >= duration) {
            playheadRef.current = duration;
            playingRef.current = false;
            onPlayingChangeRef.current(false);
            onTimeChangeRef.current(duration);
          } else if (clock.elapsedTime - lastUiEmit > 0.06) {
            lastUiEmit = clock.elapsedTime;
            externalTimeRef.current = playheadRef.current;
            onTimeChangeRef.current(playheadRef.current);
          }
        }

        const absT = startT + playheadRef.current;
        const { i0, i1, alpha } = findBracketingFrames(frames, absT);
        const f0 = frames[i0];
        const f1 = frames[i1];

        // Trigger shot tracers cleanly as playback advances forward
        if (playingRef.current && i0 !== lastTriggeredFrame) {
          if (lastTriggeredFrame >= 0 && i0 > lastTriggeredFrame && i0 - lastTriggeredFrame <= 4) {
            for (let k = lastTriggeredFrame + 1; k <= i0; k++) {
              spawnReplayShotsFromFrame(frames[k]);
            }
          } else {
            spawnReplayShotsFromFrame(f0);
          }
          lastTriggeredFrame = i0;
        } else if (!playingRef.current) {
          lastTriggeredFrame = i0;
        }

        // Day & Night Cycle Replay
        if (replay.timeOfDay === 'dynamic' || replay.timeOfDay === 'sunset') {
          const cycle =
            replay.timeOfDay === 'sunset' ? 0.55 : (Math.sin(absT * 0.035) + 1) * 0.5;
          const skyCol = dayColor.clone().lerp(nightColor, cycle);
          (scene.background as THREE.Color).copy(skyCol);
          if (scene.fog instanceof THREE.FogExp2) scene.fog.color.copy(skyCol);
          sunLight.intensity = THREE.MathUtils.lerp(2.1, 0.45, cycle);
          sunLight.position.set(Math.cos(cycle * Math.PI) * 65, 25 + (1 - cycle) * 55, 35);
          hemiLight.intensity = THREE.MathUtils.lerp(0.8, 0.32, cycle);
        }

        // Interpolated Player State
        const px = THREE.MathUtils.lerp(f0.p.x, f1.p.x, alpha);
        const py = THREE.MathUtils.lerp(f0.p.y, f1.p.y, alpha);
        const pz = THREE.MathUtils.lerp(f0.p.z, f1.p.z, alpha);
        const yaw = lerpAngle(f0.p.yaw, f1.p.yaw, alpha);
        const pitch = THREE.MathUtils.lerp(f0.p.pitch, f1.p.pitch, alpha);
        const inVehicle = f0.p.veh;
        const isParachuting = f0.p.para;
        const isEmoting = f0.p.emote;
        const moveDist = Math.hypot(f1.p.x - f0.p.x, f1.p.z - f0.p.z);

        ensurePlayerWeapon(f0.p.weaponId);

        // Weather Particles around player
        if (weatherPoints) {
          const posArr = weatherPoints.geometry.attributes.position.array as Float32Array;
          const speedY = replay.weather === 'rain' ? 32 : replay.weather === 'snow' ? 4.5 : 1.5;
          const driftX = replay.weather === 'dust' ? 14 : 2;
          const stepDt = playingRef.current ? dt * speedRef.current : dt * 0.2;
          for (let i = 0; i < posArr.length; i += 3) {
            posArr[i] += driftX * stepDt;
            posArr[i + 1] -= speedY * stepDt;
            if (posArr[i + 1] < 0) {
              posArr[i + 1] = 42;
              posArr[i] = px + (Math.random() - 0.5) * 120;
              posArr[i + 2] = pz + (Math.random() - 0.5) * 120;
            }
          }
          weatherPoints.geometry.attributes.position.needsUpdate = true;
        }

        // Zone Ring
        const zr = THREE.MathUtils.lerp(f0.zr, f1.zr, alpha);
        if (hasZone) {
          zoneCylinder.scale.set(zr, 1, zr);
        }

        // Vehicle Transform
        const vx = THREE.MathUtils.lerp(f0.v.x, f1.v.x, alpha);
        const vy = THREE.MathUtils.lerp(f0.v.y, f1.v.y, alpha);
        const vz = THREE.MathUtils.lerp(f0.v.z, f1.v.z, alpha);
        const vyaw = lerpAngle(f0.v.yaw, f1.v.yaw, alpha);
        vehicleMesh.position.set(vx, vy, vz);
        vehicleMesh.rotation.y = vyaw + Math.PI;

        // Player Rig Transform & Procedural Animation
        const activePerspective = perspectiveRef.current;
        playerRig.root.visible = !inVehicle && activePerspective !== 'first_person';
        playerRig.root.position.set(px, py, pz);
        playerRig.root.rotation.y = yaw + Math.PI;
        parachuteMesh.visible = isParachuting && activePerspective !== 'first_person';

        if (isEmoting) {
          playerRig.root.rotation.y += Math.sin(absT * Math.PI * 3) * 2.4;
          playerRig.leftArm.rotation.x = -2.2;
          playerRig.rightArm.rotation.x = -2.2;
        } else if (isParachuting) {
          playerRig.leftArm.rotation.x = -2.4;
          playerRig.rightArm.rotation.x = -2.4;
          playerRig.leftLeg.rotation.x = 0.25;
          playerRig.rightLeg.rotation.x = -0.2;
        } else if (moveDist > 0.08) {
          const stride = Math.sin(absT * 9.5);
          playerRig.leftLeg.rotation.x = stride * 0.6;
          playerRig.rightLeg.rotation.x = -stride * 0.6;
          playerRig.leftArm.rotation.x = -0.45 - stride * 0.28;
          playerRig.rightArm.rotation.x = -0.95 + pitch * 0.6;
        } else {
          playerRig.leftLeg.rotation.x = THREE.MathUtils.damp(playerRig.leftLeg.rotation.x, 0, 10, dt);
          playerRig.rightLeg.rotation.x = THREE.MathUtils.damp(playerRig.rightLeg.rotation.x, 0, 10, dt);
          playerRig.rightArm.rotation.x = -0.95 + pitch * 0.6;
        }

        // Pet Follow
        if (petMesh) {
          petMesh.visible = !inVehicle && activePerspective !== 'first_person';
          const targetPetX = px - Math.cos(yaw) * 1.1;
          const targetPetZ = pz + Math.sin(yaw) * 1.1;
          const targetPetY =
            loadout.petId === 'pet_recon_drone'
              ? py + 1.45 + Math.sin(absT * 4) * 0.14
              : arena.groundHeightAt(targetPetX, targetPetZ);
          petMesh.position.set(targetPetX, targetPetY, targetPetZ);
          petMesh.rotation.y = yaw + Math.PI;
        }

        // Interpolate Combat Actors
        let aliveCount = 1;
        const f1ActorsMap = new Map<string, ReplayActorSample>();
        for (let i = 0; i < f1.a.length; i++) {
          f1ActorsMap.set(f1.a[i].id, f1.a[i]);
        }
        const seenIds = new Set<string>();
        for (let i = 0; i < f0.a.length; i++) {
          const a0 = f0.a[i];
          const a1 = f1ActorsMap.get(a0.id) || a0;
          seenIds.add(a0.id);
          const rig = ensureActorRig(a0, i);
          const isAlive = alpha < 0.5 ? a0.alive : a1.alive;
          rig.root.visible = isAlive;
          if (!isAlive) continue;
          if (a0.team !== 'player') aliveCount++;

          const ax = THREE.MathUtils.lerp(a0.x, a1.x, alpha);
          const ay = THREE.MathUtils.lerp(a0.y, a1.y, alpha);
          const az = THREE.MathUtils.lerp(a0.z, a1.z, alpha);
          const ayaw = lerpAngle(a0.yaw, a1.yaw, alpha);
          rig.root.position.set(ax, ay, az);
          rig.root.rotation.y = ayaw;
          const stride = Math.sin(absT * 7 + i);
          rig.leftLeg.rotation.x = stride * 0.5;
          rig.rightLeg.rotation.x = -stride * 0.5;
        }
        actorRigs.forEach((rig, id) => {
          if (!seenIds.has(id)) rig.root.visible = false;
        });

        // Update Replay Tracers & Sparks
        const fxDt = playingRef.current ? dt * speedRef.current : dt;
        for (let i = tracers.length - 1; i >= 0; i--) {
          const tr = tracers[i];
          tr.pos.addScaledVector(tr.vel, fxDt);
          tr.mesh.position.copy(tr.pos);
          tr.life -= fxDt;
          if (tr.life <= 0 || tr.pos.y < arena.groundHeightAt(tr.pos.x, tr.pos.z)) {
            _sparkPos.copy(tr.pos);
            spawnSparkBurst(_sparkPos, tr.color, 3);
            scene.remove(tr.mesh);
            tracers.splice(i, 1);
          }
        }
        for (let i = sparks.length - 1; i >= 0; i--) {
          const s = sparks[i];
          s.vel.y -= 18 * fxDt;
          s.mesh.position.addScaledVector(s.vel, fxDt);
          s.life -= fxDt;
          if (s.life <= 0) {
            scene.remove(s.mesh);
            sparks.splice(i, 1);
          }
        }

        // Camera Perspectives
        const effYaw = inVehicle ? vyaw : yaw;
        const perspectiveChanged = prevPerspectiveRef.current !== activePerspective;
        if (perspectiveChanged) {
          prevPerspectiveRef.current = activePerspective;
          controls.enabled = activePerspective === 'orbit';
          if (activePerspective === 'orbit') {
            _prevOrbitFocus.set(px, py + 1.4, pz);
            controls.target.copy(_prevOrbitFocus);
            camera.position.set(
              px + Math.sin(effYaw + 0.7) * 9,
              py + 5.2,
              pz + Math.cos(effYaw + 0.7) * 9
            );
            controls.update();
          }
        }

        if (activePerspective === 'orbit') {
          camera.fov = THREE.MathUtils.damp(camera.fov, 60, 12, dt);
          camera.updateProjectionMatrix();
          _camTarget.set(px, py + 1.4, pz);
          _orbitDelta.subVectors(_camTarget, _prevOrbitFocus);
          camera.position.add(_orbitDelta);
          controls.target.copy(_camTarget);
          _prevOrbitFocus.copy(_camTarget);
          controls.update();
        } else if (activePerspective === 'overhead') {
          camera.fov = THREE.MathUtils.damp(camera.fov, 54, 12, dt);
          camera.updateProjectionMatrix();
          _camIdeal.set(px, py + 28, pz + 13);
          const minG = arena.groundHeightAt(_camIdeal.x, _camIdeal.z) + 4;
          if (_camIdeal.y < minG) _camIdeal.y = minG;
          camera.position.x = THREE.MathUtils.damp(camera.position.x, _camIdeal.x, 12, dt);
          camera.position.y = THREE.MathUtils.damp(camera.position.y, _camIdeal.y, 12, dt);
          camera.position.z = THREE.MathUtils.damp(camera.position.z, _camIdeal.z, 12, dt);
          _camTarget.set(px, py + 0.8, pz);
          camera.lookAt(_camTarget);
        } else if (activePerspective === 'first_person') {
          camera.fov = THREE.MathUtils.damp(camera.fov, 72, 14, dt);
          camera.updateProjectionMatrix();
          const eyeY = inVehicle ? py + 1.35 : py + 1.62;
          camera.position.set(px, eyeY, pz);
          _camTarget.set(
            px - Math.sin(effYaw) * 14,
            eyeY + Math.sin(pitch) * 12,
            pz - Math.cos(effYaw) * 14
          );
          camera.lookAt(_camTarget);
        } else {
          // 'chase' — Smooth Over-the-Shoulder Tactical Cam
          camera.fov = THREE.MathUtils.damp(camera.fov, inVehicle ? 70 : 62, 12, dt);
          camera.updateProjectionMatrix();
          const camDist = isParachuting ? 7.5 : inVehicle ? 7.4 : 4.6;
          const camHeight = isParachuting ? 3.2 : inVehicle ? 3.1 : 1.95;
          const shoulderOffset = inVehicle || isParachuting ? 0 : 0.78;
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
          _camTarget.set(
            px - Math.sin(effYaw) * 14,
            py + 1.45 + Math.sin(pitch) * 10,
            pz - Math.cos(effYaw) * 14
          );
          camera.lookAt(_camTarget);
        }

        // Emit Replay Telemetry HUD Snapshot (~12Hz)
        if (onTelemetryUpdateRef.current && clock.elapsedTime - lastHudEmit > 0.08) {
          lastHudEmit = clock.elapsedTime;
          const wSpec = WEAPONS.find((w) => w.id === f0.p.weaponId) || WEAPONS[0];
          onTelemetryUpdateRef.current({
            hp: f0.p.hp,
            shield: f0.p.shield,
            weaponName: wSpec.name,
            zoneRadius: Math.round(zr),
            aliveCount,
            inVehicle,
            isParachuting,
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
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      window.removeEventListener('resize', handleResize);
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [replay]);

  return <div ref={mountRef} className="w-full h-full relative" />;
};
