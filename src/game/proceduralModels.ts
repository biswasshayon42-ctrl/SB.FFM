import * as THREE from 'three';
import type { CollectionItem, WeaponSpec } from '../shared/types';

export function detectSoftwareWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

export function createProceduralGridTexture(baseHex: string, lineHex: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, 512, 512);

  // Subtle tactical micro-noise
  for (let i = 0; i < 2400; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.05)';
    ctx.fillRect(x, y, 2, 2);
  }

  ctx.strokeStyle = lineHex;
  ctx.globalAlpha = 0.16;
  ctx.lineWidth = 2;
  for (let p = 0; p <= 512; p += 64) {
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, 512);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(512, p);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(36, 36);
  return tex;
}

export interface StrikerRig {
  root: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  weaponMount: THREE.Group;
  backpackMount: THREE.Group;
  auraRing?: THREE.Mesh;
}

export function createStrikerCharacter(
  outfit: CollectionItem | undefined,
  character: CollectionItem | undefined,
  backpack: CollectionItem | undefined
): StrikerRig {
  const root = new THREE.Group();

  const primaryCol = outfit?.primaryColor || character?.primaryColor || '#1e293b';
  const secondaryCol = outfit?.secondaryColor || character?.secondaryColor || '#f59e0b';
  const emissiveCol = outfit?.emissiveColor || character?.emissiveColor || '#000000';

  const armorMat = new THREE.MeshStandardMaterial({
    color: primaryCol,
    roughness: 0.45,
    metalness: 0.35,
  });
  const trimMat = new THREE.MeshStandardMaterial({
    color: secondaryCol,
    roughness: 0.25,
    metalness: 0.85,
  });
  const undersuitMat = new THREE.MeshStandardMaterial({
    color: '#111827',
    roughness: 0.78,
    metalness: 0.12,
  });
  const visorMat = new THREE.MeshStandardMaterial({
    color: emissiveCol === '#000000' ? '#38bdf8' : emissiveCol,
    emissive: emissiveCol === '#000000' ? '#0284c7' : emissiveCol,
    emissiveIntensity: 1.4,
    roughness: 0.15,
    metalness: 0.9,
  });

  // Legs (grounded at y=0 bottom-center)
  const makeLeg = (xOffset: number) => {
    const legGroup = new THREE.Group();
    legGroup.position.set(xOffset, 0.85, 0);

    const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.42, 0.26), undersuitMat);
    thigh.position.y = -0.21;
    thigh.castShadow = true;
    legGroup.add(thigh);

    const kneePad = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.14, 0.29), trimMat);
    kneePad.position.set(0, -0.42, 0.02);
    kneePad.castShadow = true;
    legGroup.add(kneePad);

    const shin = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.36, 0.24), armorMat);
    shin.position.y = -0.62;
    shin.castShadow = true;
    legGroup.add(shin);

    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.14, 0.34), undersuitMat);
    boot.position.set(0, -0.78, 0.04);
    boot.castShadow = true;
    legGroup.add(boot);

    return legGroup;
  };

  const leftLeg = makeLeg(-0.18);
  const rightLeg = makeLeg(0.18);
  root.add(leftLeg, rightLeg);

  // Pelvis
  const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.2, 0.32), undersuitMat);
  pelvis.position.y = 0.92;
  pelvis.castShadow = true;
  root.add(pelvis);

  // Torso group
  const torso = new THREE.Group();
  torso.position.y = 1.02;
  root.add(torso);

  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.58, 0.36), armorMat);
  chest.position.y = 0.3;
  chest.castShadow = true;
  torso.add(chest);

  const chestPlate = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.34, 0.41), trimMat);
  chestPlate.position.set(0, 0.35, 0.02);
  chestPlate.castShadow = true;
  torso.add(chestPlate);

  const coreBadge = new THREE.Mesh(new THREE.OctahedronGeometry(0.075, 0), visorMat);
  coreBadge.position.set(0, 0.36, 0.23);
  torso.add(coreBadge);

  // Shoulder Pauldrons
  [-0.4, 0.4].forEach((sx) => {
    const pauldron = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.2, 0.34), trimMat);
    pauldron.position.set(sx, 0.54, 0);
    pauldron.rotation.z = sx < 0 ? 0.2 : -0.2;
    pauldron.castShadow = true;
    torso.add(pauldron);
  });

  // Head & Helmet
  const head = new THREE.Group();
  head.position.set(0, 0.66, 0);
  torso.add(head);

  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.23, 14, 12), armorMat);
  helmet.position.y = 0.2;
  helmet.scale.set(0.95, 1.05, 1.05);
  helmet.castShadow = true;
  head.add(helmet);

  const crest = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 0.36), trimMat);
  crest.position.set(0, 0.38, -0.02);
  head.add(crest);

  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.1, 0.22), visorMat);
  visor.position.set(0, 0.21, 0.14);
  head.add(visor);

  // Arms
  const makeArm = (xOffset: number) => {
    const arm = new THREE.Group();
    arm.position.set(xOffset, 0.5, 0);
    const upper = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.34, 0.18), undersuitMat);
    upper.position.y = -0.17;
    upper.castShadow = true;
    arm.add(upper);

    const gauntlet = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, 0.2), armorMat);
    gauntlet.position.y = -0.44;
    gauntlet.castShadow = true;
    arm.add(gauntlet);

    return arm;
  };

  const leftArm = makeArm(-0.42);
  const rightArm = makeArm(0.42);
  torso.add(leftArm, rightArm);

  // Weapon Mount attached to right hand
  const weaponMount = new THREE.Group();
  weaponMount.position.set(0, -0.54, 0.2);
  rightArm.add(weaponMount);

  // Backpack Mount
  const backpackMount = new THREE.Group();
  backpackMount.position.set(0, 0.34, -0.24);
  torso.add(backpackMount);

  if (backpack) {
    const packBody = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.46, 0.2),
      new THREE.MeshStandardMaterial({
        color: backpack.primaryColor,
        roughness: 0.4,
        metalness: 0.55,
      })
    );
    packBody.castShadow = true;
    backpackMount.add(packBody);

    const packTrim = new THREE.Mesh(
      new THREE.BoxGeometry(0.46, 0.12, 0.24),
      new THREE.MeshStandardMaterial({
        color: backpack.secondaryColor,
        emissive: backpack.emissiveColor || '#000000',
        emissiveIntensity: backpack.emissiveColor ? 1.2 : 0,
        roughness: 0.25,
        metalness: 0.85,
      })
    );
    packTrim.position.y = 0.14;
    backpackMount.add(packTrim);

    if (backpack.id === 'pack_cyber_wing') {
      [-0.28, 0.28].forEach((wx) => {
        const wing = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.08, 0.14), visorMat);
        wing.position.set(wx, 0.18, -0.04);
        wing.rotation.z = wx < 0 ? 0.35 : -0.35;
        backpackMount.add(wing);
      });
    }
  }

  let auraRing: THREE.Mesh | undefined;
  if (outfit?.rarity === 'legendary' || outfit?.rarity === 'upcoming') {
    auraRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.58, 0.018, 8, 32),
      new THREE.MeshStandardMaterial({
        color: secondaryCol,
        emissive: emissiveCol === '#000000' ? secondaryCol : emissiveCol,
        emissiveIntensity: 1.5,
      })
    );
    auraRing.rotation.x = Math.PI / 2;
    auraRing.position.y = 0.05;
    root.add(auraRing);
  }

  return {
    root,
    torso,
    head,
    leftArm,
    rightArm,
    leftLeg,
    rightLeg,
    weaponMount,
    backpackMount,
    auraRing,
  };
}

export function createWeaponModel(
  weapon: WeaponSpec,
  skin?: CollectionItem,
  evoLevel = 1
): THREE.Group {
  const g = new THREE.Group();
  const baseColor = skin?.primaryColor || weapon.color;
  const accentColor = skin?.secondaryColor || weapon.accentColor;
  const emissiveColor = skin?.emissiveColor || weapon.accentColor;

  const bodyMat = new THREE.MeshStandardMaterial({
    color: baseColor,
    roughness: 0.35,
    metalness: 0.72,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: accentColor,
    roughness: 0.2,
    metalness: 0.88,
    emissive: evoLevel >= 2 ? emissiveColor : '#000000',
    emissiveIntensity: evoLevel >= 4 ? 1.4 : evoLevel >= 2 ? 0.6 : 0,
  });
  const gripMat = new THREE.MeshStandardMaterial({
    color: '#0f172a',
    roughness: 0.85,
    metalness: 0.1,
  });

  if (weapon.category === 'melee') {
    const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.28, 8), gripMat);
    hilt.rotation.x = Math.PI / 2;
    g.add(hilt);

    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.04, 0.05), accentMat);
    guard.position.z = 0.14;
    g.add(guard);

    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(0.025, 0.075, 0.92),
      new THREE.MeshStandardMaterial({
        color: accentColor,
        emissive: emissiveColor,
        emissiveIntensity: 1.4,
        roughness: 0.1,
        metalness: 0.95,
      })
    );
    blade.position.z = 0.62;
    g.add(blade);
    return g;
  }

  const len = weapon.category === 'sniper' ? 1.15 : weapon.category === 'pistol' ? 0.38 : weapon.category === 'smg' ? 0.56 : 0.78;

  // Receiver
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.15, len * 0.58), bodyMat);
  receiver.position.z = len * 0.22;
  receiver.castShadow = true;
  g.add(receiver);

  // Barrel
  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.024, 0.028, len * 0.55, 8),
    accentMat
  );
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.03, len * 0.66);
  g.add(barrel);

  // Magazine
  const mag = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, weapon.category === 'smg' ? 0.24 : 0.18, 0.09),
    gripMat
  );
  mag.position.set(0, -0.13, len * 0.28);
  mag.rotation.x = 0.22;
  g.add(mag);

  // Grip
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.08), gripMat);
  grip.position.set(0, -0.11, len * 0.05);
  grip.rotation.x = -0.25;
  g.add(grip);

  // Stock (if not pistol)
  if (weapon.category !== 'pistol') {
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.13, 0.26), bodyMat);
    stock.position.set(0, -0.01, -0.12);
    g.add(stock);
  }

  // Scope / Optic
  if (weapon.category === 'sniper' || weapon.category === 'assault_rifle') {
    const scope = new THREE.Mesh(
      new THREE.CylinderGeometry(0.032, 0.032, weapon.category === 'sniper' ? 0.34 : 0.16, 10),
      accentMat
    );
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.12, len * 0.24);
    g.add(scope);
  }

  // Evo Level 5-7 Visual Aura Core
  if (evoLevel >= 5) {
    const evoRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.12, 0.014, 6, 20),
      new THREE.MeshStandardMaterial({
        color: emissiveColor,
        emissive: emissiveColor,
        emissiveIntensity: 2.0,
      })
    );
    evoRing.position.set(0, 0.02, len * 0.45);
    evoRing.name = 'evoAuraRing';
    g.add(evoRing);
  }

  return g;
}

export function createPetModel(pet: CollectionItem): THREE.Group {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({
    color: pet.primaryColor,
    roughness: 0.35,
    metalness: 0.55,
  });
  const glowMat = new THREE.MeshStandardMaterial({
    color: pet.secondaryColor,
    emissive: pet.emissiveColor || pet.secondaryColor,
    emissiveIntensity: 1.4,
    roughness: 0.2,
    metalness: 0.85,
  });

  if (pet.id === 'pet_recon_drone') {
    const hub = new THREE.Mesh(new THREE.OctahedronGeometry(0.18, 1), bodyMat);
    g.add(hub);
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 10), glowMat);
    lens.position.z = 0.15;
    g.add(lens);
    [
      [-0.22, -0.22],
      [0.22, -0.22],
      [-0.22, 0.22],
      [0.22, 0.22],
    ].forEach(([rx, rz]) => {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.04), bodyMat);
      arm.position.set(rx * 0.6, 0.04, rz * 0.6);
      arm.rotation.y = Math.atan2(rz, rx);
      g.add(arm);
      const rotor = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.015, 10), glowMat);
      rotor.position.set(rx, 0.06, rz);
      g.add(rotor);
    });
    return g;
  }

  // Cyber Fox / Glacier Cub grounded at y=0
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.2, 0.38), bodyMat);
  torso.position.y = 0.22;
  torso.castShadow = true;
  g.add(torso);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.19, 0.22), bodyMat);
  head.position.set(0, 0.36, 0.2);
  g.add(head);

  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.06, 0.06), glowMat);
  visor.position.set(0, 0.38, 0.3);
  g.add(visor);

  [-0.07, 0.07].forEach((ex) => {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.12, 4), glowMat);
    ear.position.set(ex, 0.5, 0.18);
    g.add(ear);
  });

  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.26), glowMat);
  tail.position.set(0, 0.28, -0.26);
  tail.rotation.x = 0.45;
  g.add(tail);

  return g;
}

export function createVehicleModel(skin?: CollectionItem): THREE.Group {
  const g = new THREE.Group();
  const hullMat = new THREE.MeshStandardMaterial({
    color: skin?.primaryColor || '#3f4d3b',
    roughness: 0.4,
    metalness: 0.55,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: skin?.secondaryColor || '#f59e0b',
    roughness: 0.25,
    metalness: 0.85,
  });
  const tireMat = new THREE.MeshStandardMaterial({
    color: '#111827',
    roughness: 0.88,
    metalness: 0.1,
  });
  const lightMat = new THREE.MeshStandardMaterial({
    color: '#fef08a',
    emissive: skin?.emissiveColor || '#fbbf24',
    emissiveIntensity: 1.6,
  });

  // Main chassis
  const hull = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.65, 4.1), hullMat);
  hull.position.y = 0.72;
  hull.castShadow = true;
  hull.receiveShadow = true;
  g.add(hull);

  // Hood slope
  const hood = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.32, 1.3), accentMat);
  hood.position.set(0, 1.04, 1.15);
  hood.rotation.x = 0.12;
  g.add(hood);

  // Roll cage roof
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.14, 1.85), accentMat);
  roof.position.set(0, 1.82, -0.25);
  roof.castShadow = true;
  g.add(roof);

  // Pillars
  [
    [-0.8, 0.55],
    [0.8, 0.55],
    [-0.8, -1.05],
    [0.8, -1.05],
  ].forEach(([px, pz]) => {
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.85, 8), accentMat);
    pillar.position.set(px, 1.4, pz);
    g.add(pillar);
  });

  // 4 Wheels
  [
    [-1.12, 1.35],
    [1.12, 1.35],
    [-1.12, -1.35],
    [1.12, -1.35],
  ].forEach(([wx, wz]) => {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.34, 16), tireMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wx, 0.46, wz);
    wheel.castShadow = true;
    g.add(wheel);

    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.36, 8), accentMat);
    rim.rotation.z = Math.PI / 2;
    rim.position.set(wx, 0.46, wz);
    g.add(rim);
  });

  // Headlights
  [-0.65, 0.65].forEach((hx) => {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.14, 0.08), lightMat);
    hl.position.set(hx, 0.82, 2.06);
    g.add(hl);
  });

  return g;
}

export function createLootCrateModel(crate?: CollectionItem): THREE.Group {
  const g = new THREE.Group();
  const baseMat = new THREE.MeshStandardMaterial({
    color: crate?.primaryColor || '#334155',
    roughness: 0.45,
    metalness: 0.55,
  });
  const glowMat = new THREE.MeshStandardMaterial({
    color: crate?.secondaryColor || '#f59e0b',
    emissive: crate?.emissiveColor || '#f59e0b',
    emissiveIntensity: 1.5,
    roughness: 0.2,
    metalness: 0.85,
  });

  const box = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.72, 0.8), baseMat);
  box.position.y = 0.36;
  box.castShadow = true;
  g.add(box);

  const lid = new THREE.Mesh(new THREE.BoxGeometry(1.16, 0.14, 0.86), glowMat);
  lid.position.y = 0.76;
  g.add(lid);

  const beacon = new THREE.Mesh(new THREE.TorusGeometry(0.68, 0.025, 6, 24), glowMat);
  beacon.rotation.x = Math.PI / 2;
  beacon.position.y = 0.04;
  g.add(beacon);

  return g;
}

export function createParachuteModel(parachute?: CollectionItem): THREE.Group {
  const g = new THREE.Group();
  const canopyMat = new THREE.MeshStandardMaterial({
    color: parachute?.primaryColor || '#334155',
    roughness: 0.65,
    metalness: 0.15,
    side: THREE.DoubleSide,
  });
  const stripeMat = new THREE.MeshStandardMaterial({
    color: parachute?.secondaryColor || '#f59e0b',
    emissive: parachute?.emissiveColor || '#000000',
    emissiveIntensity: parachute?.emissiveColor ? 1.1 : 0,
    roughness: 0.4,
    side: THREE.DoubleSide,
  });

  const canopy = new THREE.Mesh(
    new THREE.SphereGeometry(2.2, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.45),
    canopyMat
  );
  canopy.scale.set(1.3, 0.65, 0.9);
  canopy.position.y = 2.6;
  g.add(canopy);

  const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.12, 3.6), stripeMat);
  stripe.position.y = 3.85;
  g.add(stripe);

  [-1.5, 1.5].forEach((cx) => {
    const cord = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.015, 2.7, 4),
      new THREE.MeshBasicMaterial({ color: '#cbd5e1' })
    );
    cord.position.set(cx * 0.55, 1.5, 0);
    cord.rotation.z = cx < 0 ? -0.36 : 0.36;
    g.add(cord);
  });

  return g;
}
