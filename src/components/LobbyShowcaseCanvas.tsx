import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { COLLECTION_ITEMS, WEAPONS } from '../shared/catalog';
import type { UserLoadout } from '../shared/types';
import {
  createPetModel,
  createStrikerCharacter,
  createWeaponModel,
  detectSoftwareWebGL,
  type StrikerRig,
} from '../game/proceduralModels';

interface Props {
  loadout: UserLoadout;
  emotePulseKey: number;
  inspectWeaponId?: string | null;
}

export const LobbyShowcaseCanvas: React.FC<Props> = ({
  loadout,
  emotePulseKey,
  inspectWeaponId,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const rigRef = useRef<StrikerRig | null>(null);
  const stageGroupRef = useRef<THREE.Group | null>(null);
  const petGroupRef = useRef<THREE.Group | null>(null);
  const emoteTimerRef = useRef(0);

  // Build / rebuild 3D character, weapon, backpack, and pet whenever loadout changes
  const rebuildActor = () => {
    const stage = stageGroupRef.current;
    if (!stage) return;

    while (stage.children.length > 0) {
      stage.remove(stage.children[0]);
    }

    const outfit = COLLECTION_ITEMS.find((i) => i.id === loadout.outfitId);
    const charItem = COLLECTION_ITEMS.find((i) => i.id === loadout.characterId);
    const backpack = COLLECTION_ITEMS.find((i) => i.id === loadout.backpackId);
    const pet = COLLECTION_ITEMS.find((i) => i.id === loadout.petId);

    const activeWeaponId = inspectWeaponId || loadout.primaryWeaponId;
    const weaponSpec = WEAPONS.find((w) => w.id === activeWeaponId) || WEAPONS[0];
    const skinId = loadout.gunSkinIds[weaponSpec.id];
    const skinItem = COLLECTION_ITEMS.find((i) => i.id === skinId);
    const evoLevel = skinId ? loadout.evoLevels[skinId] || 1 : 1;

    const rig = createStrikerCharacter(outfit, charItem, backpack);
    const weaponMesh = createWeaponModel(weaponSpec, skinItem, evoLevel);
    weaponMesh.rotation.set(0.15, Math.PI / 2, 0);
    rig.weaponMount.add(weaponMesh);

    // Tactical ready stance
    rig.rightArm.rotation.x = -0.75;
    rig.leftArm.rotation.x = -0.35;
    rig.leftArm.rotation.z = 0.14;

    stage.add(rig.root);
    rigRef.current = rig;

    if (pet) {
      const petMesh = createPetModel(pet);
      petMesh.position.set(1.05, 0, 0.35);
      petMesh.rotation.y = -0.35;
      stage.add(petMesh);
      petGroupRef.current = petMesh;
    } else {
      petGroupRef.current = null;
    }
  };

  useEffect(() => {
    rebuildActor();
  }, [loadout, inspectWeaponId]);

  useEffect(() => {
    if (emotePulseKey > 0) {
      emoteTimerRef.current = 1.6;
    }
  }, [emotePulseKey]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = detectSoftwareWebGL();
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#090d16');
    scene.fog = new THREE.FogExp2('#090d16', 0.042);

    const camera = new THREE.PerspectiveCamera(
      42,
      container.clientWidth / Math.max(1, container.clientHeight),
      0.1,
      80
    );
    camera.position.set(0.55, 1.55, 3.85);

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    // 3-Point Studio Lighting
    const hemi = new THREE.HemisphereLight('#7dd3fc', '#1e1b4b', 0.75);
    scene.add(hemi);

    const keyLight = new THREE.DirectionalLight('#fff1d6', 2.2);
    keyLight.position.set(4, 6, 4);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.bias = -0.0005;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight('#38bdf8', 1.35);
    rimLight.position.set(-4, 4, -4);
    scene.add(rimLight);

    // Tactical Pedestal Platform
    const pedestal = new THREE.Group();
    const baseDisc = new THREE.Mesh(
      new THREE.CylinderGeometry(1.65, 1.85, 0.16, 40),
      new THREE.MeshStandardMaterial({ color: '#111827', roughness: 0.35, metalness: 0.75 })
    );
    baseDisc.position.y = -0.08;
    baseDisc.receiveShadow = true;
    pedestal.add(baseDisc);

    const glowRing = new THREE.Mesh(
      new THREE.TorusGeometry(1.66, 0.02, 8, 48),
      new THREE.MeshStandardMaterial({
        color: '#f59e0b',
        emissive: '#f59e0b',
        emissiveIntensity: 1.6,
      })
    );
    glowRing.rotation.x = Math.PI / 2;
    pedestal.add(glowRing);

    const floorPlane = new THREE.Mesh(
      new THREE.CircleGeometry(18, 36),
      new THREE.MeshStandardMaterial({ color: '#0b101b', roughness: 0.85, metalness: 0.2 })
    );
    floorPlane.rotation.x = -Math.PI / 2;
    floorPlane.position.y = -0.16;
    floorPlane.receiveShadow = true;
    pedestal.add(floorPlane);
    scene.add(pedestal);

    const stageGroup = new THREE.Group();
    scene.add(stageGroup);
    stageGroupRef.current = stageGroup;
    rebuildActor();

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1.05, 0);
    controls.enablePan = false;
    controls.minDistance = 2.4;
    controls.maxDistance = 6.2;
    controls.minPolarAngle = 0.6;
    controls.maxPolarAngle = Math.PI / 2 - 0.05;
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.06;

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
      const dt = Math.min(clock.getDelta(), 0.05);
      const t = clock.getElapsedTime();

      const rig = rigRef.current;
      if (rig) {
        rig.torso.position.y = 1.02 + Math.sin(t * 2.2) * 0.015;
        if (rig.auraRing) {
          rig.auraRing.rotation.z = t * 0.8;
        }

        if (emoteTimerRef.current > 0) {
          emoteTimerRef.current = Math.max(0, emoteTimerRef.current - dt);
          const p = emoteTimerRef.current;
          rig.root.rotation.y = Math.sin(p * Math.PI * 2) * 1.4;
          rig.leftArm.rotation.x = -2.1 * Math.sin(p * Math.PI);
          rig.rightArm.rotation.x = -2.2 * Math.sin(p * Math.PI);
          rig.root.position.y = Math.abs(Math.sin(p * Math.PI * 2)) * 0.35;
        } else {
          rig.root.rotation.y = THREE.MathUtils.damp(rig.root.rotation.y, Math.sin(t * 0.5) * 0.14, 4, dt);
          rig.root.position.y = THREE.MathUtils.damp(rig.root.position.y, 0, 6, dt);
          rig.rightArm.rotation.x = THREE.MathUtils.damp(rig.rightArm.rotation.x, -0.75, 6, dt);
          rig.leftArm.rotation.x = THREE.MathUtils.damp(rig.leftArm.rotation.x, -0.35, 6, dt);
        }
      }

      if (petGroupRef.current) {
        petGroupRef.current.position.y =
          loadout.petId === 'pet_recon_drone' ? 0.95 + Math.sin(t * 3.5) * 0.12 : 0;
        petGroupRef.current.rotation.y = -0.35 + Math.sin(t * 1.3) * 0.2;
      }

      controls.update();
      renderer.render(scene, camera);

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    }

    tick();

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return <div ref={mountRef} className="w-full h-full relative" />;
};
