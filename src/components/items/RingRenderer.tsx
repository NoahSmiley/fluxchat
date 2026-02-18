/**
 * RingRenderer — Real 3D ring using Three.js.
 * TorusGeometry with metallic PBR material, environment-mapped.
 * Full 360° drag-to-rotate. Owns its own canvas.
 */

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { seedToPattern, RING_GRADIENTS, type DopplerType } from "./dopplerPattern.js";
import type { ItemRarity } from "../../types/shared.js";

interface RingRendererProps {
  name: string;
  rarity: ItemRarity;
  previewCss: string | null;
  patternSeed: number | null;
}

/** Parse a CSS color string to a THREE.Color. Handles hsl(), hex, named colors. */
function cssToThreeColor(css: string): THREE.Color {
  // Use a canvas to resolve any CSS color
  const ctx = document.createElement("canvas").getContext("2d")!;
  ctx.fillStyle = css;
  return new THREE.Color(ctx.fillStyle);
}

/** Extract dominant colors from a CSS gradient string */
function extractGradientColors(gradient: string): THREE.Color[] {
  const colorRegex = /(#[0-9a-fA-F]{3,8}|hsl\([^)]+\)|rgb\([^)]+\))/g;
  const matches = gradient.match(colorRegex) || [];
  return matches.map((c) => cssToThreeColor(c));
}

/** Create a gradient texture that wraps seamlessly around the torus tube.
 *  Horizontal gradient (left→right = around the ring), uniform vertically. */
function createGradientTexture(colors: THREE.Color[], size = 512): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = 4; // uniform vertically — no seam across tube cross-section
  const ctx = canvas.getContext("2d")!;

  // Horizontal gradient along the ring circumference
  const grad = ctx.createLinearGradient(0, 0, size, 0);
  colors.forEach((c, i) => {
    grad.addColorStop(i / Math.max(colors.length - 1, 1), `#${c.getHexString()}`);
  });
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, 4);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

/** Create a simple environment map for metallic reflections */
function createEnvMap(): THREE.CubeTexture {
  const size = 128;
  const faces: HTMLCanvasElement[] = [];

  for (let f = 0; f < 6; f++) {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;

    // Dark environment with subtle gradient highlights
    const grad = ctx.createRadialGradient(
      size * (0.3 + f * 0.1), size * 0.3, 0,
      size * 0.5, size * 0.5, size * 0.8
    );
    grad.addColorStop(0, f < 2 ? "#444" : "#222");
    grad.addColorStop(0.5, "#111");
    grad.addColorStop(1, "#080808");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    // Add a bright spot for specular
    if (f === 0 || f === 2) {
      const spec = ctx.createRadialGradient(size * 0.6, size * 0.3, 0, size * 0.6, size * 0.3, size * 0.3);
      spec.addColorStop(0, "rgba(255,255,255,0.6)");
      spec.addColorStop(1, "transparent");
      ctx.fillStyle = spec;
      ctx.fillRect(0, 0, size, size);
    }

    faces.push(canvas);
  }

  const cubeTexture = new THREE.CubeTexture(faces);
  cubeTexture.needsUpdate = true;
  return cubeTexture;
}

export function RingRenderer({ previewCss, patternSeed }: RingRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const frameRef = useRef<number>(0);
  const rotRef = useRef({ x: Math.PI * 0.15, y: 0 }); // slight tilt (~27°)
  const dragRef = useRef({ active: false, lastX: 0, lastY: 0 });
  const idleRef = useRef(true); // true = idle rotation active
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dopplerType: DopplerType = previewCss === "gamma_doppler" ? "gamma_doppler" : "doppler";
  const pattern = patternSeed != null ? seedToPattern(patternSeed, dopplerType) : null;
  const ringGrad = previewCss ? RING_GRADIENTS[previewCss] : undefined;
  const bgCss = pattern ? pattern.background : ringGrad ?? "conic-gradient(#888, #555, #888)";

  // Stable ref for the gradient string
  const bgRef = useRef(bgCss);
  bgRef.current = bgCss;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const W = 300;
    const H = 300;

    // Scene setup
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, W / H, 0.1, 100);
    camera.position.set(0, 0, 4);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Environment map
    const envMap = createEnvMap();
    scene.environment = envMap;

    // Extract colors and build texture
    const colors = extractGradientColors(bgRef.current);
    const colorTex = createGradientTexture(
      colors.length > 0 ? colors : [new THREE.Color("#cc0000"), new THREE.Color("#880000")],
      512
    );

    // Torus geometry — thin ring (tube radius 0.12 for a sleek band)
    const geometry = new THREE.TorusGeometry(1.0, 0.12, 48, 128);

    // Metallic PBR material — double-sided to avoid backface culling at edge angles
    const material = new THREE.MeshStandardMaterial({
      map: colorTex,
      metalness: 0.95,
      roughness: 0.15,
      envMap,
      envMapIntensity: 1.5,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.0);
    keyLight.position.set(3, 4, 5);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x8888ff, 0.6);
    fillLight.position.set(-3, -1, 2);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xffffff, 1.0);
    rimLight.position.set(0, -3, -3);
    scene.add(rimLight);

    // Render loop with idle rotation (CS2-style)
    let lastTime = performance.now();
    function animate() {
      frameRef.current = requestAnimationFrame(animate);
      const now = performance.now();
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      // Idle rotation: slow Y spin + gentle X bob
      if (idleRef.current && !dragRef.current.active) {
        rotRef.current.y += 0.3 * dt; // ~17° per second
        rotRef.current.x = Math.PI * 0.15 + Math.sin(now * 0.0008) * 0.06; // gentle tilt bob around center
      }

      mesh.rotation.x = rotRef.current.x;
      mesh.rotation.y = rotRef.current.y;
      renderer.render(scene, camera);
    }
    animate();

    // Pointer handlers for drag rotation
    const canvas = renderer.domElement;
    canvas.style.cursor = "grab";

    function onPointerDown(e: PointerEvent) {
      dragRef.current = { active: true, lastX: e.clientX, lastY: e.clientY };
      idleRef.current = false;
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = "grabbing";
    }

    function onPointerMove(e: PointerEvent) {
      if (!dragRef.current.active) return;
      const dx = e.clientX - dragRef.current.lastX;
      const dy = e.clientY - dragRef.current.lastY;
      dragRef.current.lastX = e.clientX;
      dragRef.current.lastY = e.clientY;
      rotRef.current.y += dx * 0.01;
      rotRef.current.x += dy * 0.01;
    }

    function onPointerUp() {
      dragRef.current.active = false;
      canvas.style.cursor = "grab";
      // Resume idle rotation after 3 seconds of inactivity
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => { idleRef.current = true; }, 3000);
    }

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);

    return () => {
      cancelAnimationFrame(frameRef.current);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      renderer.dispose();
      geometry.dispose();
      material.dispose();
      colorTex.dispose();
      envMap.dispose();
      container.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={containerRef} className="ring-renderer-canvas" />;
}
