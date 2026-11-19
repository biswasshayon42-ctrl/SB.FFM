import * as THREE from 'three';
import { MAPS } from '../shared/catalog';
import type { MapId } from '../shared/types';
import { createProceduralGridTexture } from './proceduralModels';

export interface BoxCollider {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  height: number;
}

export interface BuiltArena {
  group: THREE.Group;
  colliders: BoxCollider[];
  groundHeightAt: (x: number, z: number) => number;
  arenaRadius: number;
  spawnPoints: THREE.Vector3[];
  crateSpots: THREE.Vector3[];
}

export function createGroundHeightFn(mapId: MapId): (x: number, z: number) => number {
  return (x: number, z: number) => {
    const dist = Math.hypot(x, z);
    if (mapId === 'neon_city') {
      // Flat urban boulevard with subtle outer ramp
      return dist > 86 ? (dist - 86) * 0.45 : 0;
    }
    if (mapId === 'desert_storm') {
      const dune = Math.sin(x * 0.045) * Math.cos(z * 0.04) * 1.4;
      const canyonRim = dist > 84 ? (dist - 84) * 0.75 : 0;
      return dune + canyonRim;
    }
    if (mapId === 'snow_mountain') {
      const slope = Math.sin(x * 0.035) * 1.6 + Math.cos(z * 0.035) * 1.6;
      const ridge = dist > 82 ? (dist - 82) * 0.9 : 0;
      return slope + ridge;
    }
    if (mapId === 'dragon_city') {
      const terrace = Math.abs(x) < 28 && Math.abs(z) < 28 ? 0.6 : 0;
      const hill = Math.sin(x * 0.05) * Math.cos(z * 0.05) * 0.9;
      return terrace + hill + (dist > 85 ? (dist - 85) * 0.65 : 0);
    }
    // shayon_island: raised center plateau sloping down to beach
    const wave = Math.sin(x * 0.04) * Math.cos(z * 0.04) * 1.1;
    const plateau = Math.max(0, 1.8 - dist * 0.02);
    return wave + plateau;
  };
}

export function buildArenaMap(mapId: MapId, ultraQuality: boolean): BuiltArena {
  const mapDef = MAPS.find((m) => m.id === mapId) || MAPS[0];
  const group = new THREE.Group();
  const colliders: BoxCollider[] = [];
  const arenaRadius = 86;
  const groundHeightAt = createGroundHeightFn(mapId);

  // Terrain Plane (extends far beyond playable zone to horizon)
  const segs = ultraQuality ? 72 : 48;
  const terrainGeo = new THREE.PlaneGeometry(340, 340, segs, segs);
  terrainGeo.rotateX(-Math.PI / 2);
  const posAttr = terrainGeo.attributes.position;
  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i);
    const z = posAttr.getZ(i);
    posAttr.setY(i, groundHeightAt(x, z));
  }
  terrainGeo.computeVertexNormals();

  const groundTex = createProceduralGridTexture(mapDef.groundColor, mapDef.accentColor);
  const terrainMat = new THREE.MeshStandardMaterial({
    map: groundTex,
    roughness: mapId === 'neon_city' ? 0.35 : 0.88,
    metalness: mapId === 'neon_city' ? 0.25 : 0.04,
  });
  const terrain = new THREE.Mesh(terrainGeo, terrainMat);
  terrain.receiveShadow = true;
  group.add(terrain);

  // Natural Water Perimeter on Shayon Island
  if (mapId === 'shayon_island') {
    const water = new THREE.Mesh(
      new THREE.RingGeometry(88, 220, 48),
      new THREE.MeshStandardMaterial({
        color: '#0c4a6e',
        roughness: 0.12,
        metalness: 0.65,
      })
    );
    water.rotation.x = -Math.PI / 2;
    water.position.y = -0.35;
    group.add(water);
  }

  // Helper to add composite tactical building/cover with collider
  const addCoverStructure = (
    x: number,
    z: number,
    w: number,
    h: number,
    d: number,
    primaryHex: string,
    trimHex: string,
    kind: 'bunker' | 'pagoda' | 'tower' | 'crate' = 'bunker'
  ) => {
    const baseY = groundHeightAt(x, z);
    const struct = new THREE.Group();
    struct.position.set(x, baseY, z);

    const wallMat = new THREE.MeshStandardMaterial({
      color: primaryHex,
      roughness: 0.72,
      metalness: 0.18,
    });
    const trimMat = new THREE.MeshStandardMaterial({
      color: trimHex,
      roughness: 0.35,
      metalness: 0.65,
      emissive: mapId === 'neon_city' ? trimHex : '#000000',
      emissiveIntensity: mapId === 'neon_city' ? 0.9 : 0,
    });

    const mainBody = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
    mainBody.position.y = h / 2;
    mainBody.castShadow = true;
    mainBody.receiveShadow = true;
    struct.add(mainBody);

    // Secondary architectural detail (cornice / roof / trim)
    if (kind === 'pagoda') {
      const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.78, h * 0.48, 4), trimMat);
      roof.position.y = h + h * 0.22;
      roof.rotation.y = Math.PI / 4;
      roof.castShadow = true;
      struct.add(roof);
    } else if (kind === 'tower') {
      const crown = new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, 0.45, d + 0.6), trimMat);
      crown.position.y = h + 0.2;
      struct.add(crown);
      const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.14, 3.2, 6), trimMat);
      antenna.position.y = h + 1.8;
      struct.add(antenna);
    } else {
      const rim = new THREE.Mesh(new THREE.BoxGeometry(w + 0.25, 0.28, d + 0.25), trimMat);
      rim.position.y = h - 0.12;
      struct.add(rim);
    }

    group.add(struct);
    colliders.push({
      minX: x - w / 2 - 0.45,
      maxX: x + w / 2 + 0.45,
      minZ: z - d / 2 - 0.45,
      maxZ: z + d / 2 + 0.45,
      height: baseY + h,
    });
  };

  // Biome-Specific Landmarks & Tactical Cover Layout
  const bKind =
    mapId === 'dragon_city' ? 'pagoda' : mapId === 'neon_city' ? 'tower' : 'bunker';
  const primaryWall =
    mapId === 'dragon_city'
      ? '#473c38'
      : mapId === 'desert_storm'
        ? '#b58d5e'
        : mapId === 'snow_mountain'
          ? '#64748b'
          : mapId === 'neon_city'
            ? '#0f172a'
            : '#475569';

  // Central Citadel / Landmark
  addCoverStructure(0, -18, 9, 6.2, 6, primaryWall, mapDef.accentColor, bKind);
  addCoverStructure(0, 18, 9, 4.8, 6, primaryWall, mapDef.accentColor, bKind);

  // Mid-ring Compound Structures
  const ringOffsets = [
    [-26, -24, 7, 4.2, 6],
    [26, -24, 7, 4.2, 6],
    [-28, 22, 6, 3.6, 7],
    [28, 22, 6, 3.6, 7],
    [-44, 0, 6, 5.2, 9],
    [44, 0, 6, 5.2, 9],
    [0, -48, 10, 4.8, 6],
    [0, 48, 10, 4.8, 6],
  ];
  ringOffsets.forEach(([ox, oz, w, h, d]) => {
    addCoverStructure(ox, oz, w, h, d, primaryWall, mapDef.accentColor, bKind);
  });

  // Low tactical cover walls & shipping containers
  const coverSpots = [
    [-12, -4],
    [12, -4],
    [-14, 8],
    [14, 8],
    [-34, -44],
    [34, -44],
    [-36, 44],
    [36, 44],
    [-58, -26],
    [58, -26],
    [-58, 26],
    [58, 26],
  ];
  coverSpots.forEach(([cx, cz], idx) => {
    addCoverStructure(
      cx,
      cz,
      idx % 2 === 0 ? 4.4 : 2.6,
      1.75,
      idx % 2 === 0 ? 1.8 : 4.2,
      '#334155',
      mapDef.accentColor,
      'crate'
    );
  });

  // Instanced Environment Props (Trees / Canyon Rocks / Neon Pylons / Pines)
  const propCount = ultraQuality ? 72 : 44;
  const propGeo =
    mapId === 'neon_city'
      ? new THREE.BoxGeometry(1.4, 9, 1.4)
      : mapId === 'desert_storm'
        ? new THREE.DodecahedronGeometry(1.8, 0)
        : new THREE.ConeGeometry(1.4, 4.6, 7);
  const propMat = new THREE.MeshStandardMaterial({
    color:
      mapId === 'neon_city'
        ? '#1e293b'
        : mapId === 'desert_storm'
          ? '#a17449'
          : mapId === 'snow_mountain'
            ? '#cbd5e1'
            : '#2d5a36',
    roughness: 0.78,
    metalness: mapId === 'neon_city' ? 0.65 : 0.08,
  });
  const instancedProps = new THREE.InstancedMesh(propGeo, propMat, propCount);
  instancedProps.castShadow = true;
  instancedProps.receiveShadow = true;

  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();
  for (let i = 0; i < propCount; i++) {
    const angle = (i / propCount) * Math.PI * 2 + (i % 3) * 0.25;
    const rad = i < propCount * 0.45 ? 36 + (i % 5) * 9 : 88 + (i % 4) * 6;
    const px = Math.cos(angle) * rad;
    const pz = Math.sin(angle) * rad;
    const py = groundHeightAt(px, pz);
    const s = 0.85 + ((i * 37) % 30) / 100; // ±15% variation
    dummy.position.set(px, py + (mapId === 'neon_city' ? 4.5 * s : 1.9 * s), pz);
    dummy.rotation.y = angle;
    dummy.scale.set(s, s * (mapId === 'neon_city' ? 1.3 : 1), s);
    dummy.updateMatrix();
    instancedProps.setMatrixAt(i, dummy.matrix);

    tint.set(propMat.color);
    tint.offsetHSL(0, 0, ((i % 5) - 2) * 0.03);
    instancedProps.setColorAt(i, tint);
  }
  instancedProps.instanceMatrix.needsUpdate = true;
  if (instancedProps.instanceColor) instancedProps.instanceColor.needsUpdate = true;
  instancedProps.computeBoundingSphere();
  group.add(instancedProps);

  const spawnPoints = [
    new THREE.Vector3(0, groundHeightAt(0, 32), 32),
    new THREE.Vector3(-22, groundHeightAt(-22, 14), 14),
    new THREE.Vector3(22, groundHeightAt(22, 14), 14),
    new THREE.Vector3(0, groundHeightAt(0, -34), -34),
    new THREE.Vector3(-42, groundHeightAt(-42, -18), -18),
    new THREE.Vector3(42, groundHeightAt(42, -18), -18),
    new THREE.Vector3(-48, groundHeightAt(-48, 34), 34),
    new THREE.Vector3(48, groundHeightAt(48, 34), 34),
  ];

  const crateSpots = [
    new THREE.Vector3(0, groundHeightAt(0, 0), 0),
    new THREE.Vector3(-18, groundHeightAt(-18, -14), -14),
    new THREE.Vector3(18, groundHeightAt(18, -14), -14),
    new THREE.Vector3(-30, groundHeightAt(-30, 8), 8),
    new THREE.Vector3(30, groundHeightAt(30, 8), 8),
    new THREE.Vector3(0, groundHeightAt(0, -30), -30),
  ];

  return {
    group,
    colliders,
    groundHeightAt,
    arenaRadius,
    spawnPoints,
    crateSpots,
  };
}
