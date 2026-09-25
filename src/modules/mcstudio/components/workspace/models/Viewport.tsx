import { useEffect, useRef } from "react";
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DataTexture,
  DoubleSide,
  EdgesGeometry,
  FrontSide,
  GridHelper,
  Group,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  Object3D,
  PerspectiveCamera,
  Raycaster,
  RGBAFormat,
  Scene,
  SRGBColorSpace,
  Sphere,
  Sprite,
  SpriteMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Texture,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import type { Pixels } from "../../../lib/pixels";
import { quadNormal, shadeOf, type Part } from "../../../lib/models/geometry";
import type { FaceName, Vec3 } from "../../../lib/models/types";

export type PaintPhase = "start" | "move" | "end";

export type ViewportProps = {
  parts: Part[];
  /** Morceaux gris, non sélectionnables (mannequin sous une armure). */
  ghosts?: Part[];
  textures: Map<string, Pixels>;
  /** Incrémenté à chaque changement de pixels : les textures sont renvoyées à la carte graphique. */
  textureVersion: number;
  /** Morceaux (propriétaires) mis en avant : un cube, ou tous les cubes d'un os. */
  selected: string[];
  mode: "select" | "paint";
  /** Change quand un autre modèle s'ouvre : la caméra se recadre. */
  frameKey: string;
  floor: "block" | "entity";
  /** `additive` : Maj, Ctrl ou Cmd enfoncée (ajouter à la sélection). */
  onPick?: (owner: string | null, face: FaceName | null, additive: boolean) => void;
  onPaint?: (hit: { texture: string; x: number; y: number; owner: string; face: FaceName | null }, phase: PaintPhase) => void;
  /**
   * Poignée de déplacement (mode sélection) : `position` dans l'espace de `parent` (matrice
   * de l'os, ou identité pour un bloc). `onMove` reçoit le décalage depuis le début du glisser.
   */
  gizmo?: { parent: Matrix4; position: Vec3 } | null;
  onMove?: (delta: Vec3, done: boolean) => void;
  /** Aperçu d'une forme à créer : translucide, non sélectionnable. */
  preview?: Part[];
  /** Boîtes repères (zone à creuser) : `parent` = matrice de l'os, identité pour un bloc. */
  boxes?: { from: Vec3; to: Vec3; parent?: Matrix4; tone: "danger" | "accent" }[];
};

type Stage = {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  controls: OrbitControls;
  content: Group;
  overlay: Group;
  marks: Group;
  floor: Group;
  textures: Map<string, DataTexture>;
  checker: Texture;
  transform: TransformControls;
  anchor: Object3D;
  handle: Object3D;
  render: () => void;
};

/**
 * Couleur d'un jeton du thème (souvent en `oklch`, que three.js ne lit pas) : le navigateur
 * la peint sur un pixel, on relit le rouge, le vert, le bleu et l'opacité.
 */
function cssColor(name: string, fallback: string): { color: Color; alpha: number } {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return { color: new Color(fallback), alpha: 1 };
  context.fillStyle = fallback;
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  const [r = 128, g = 128, b = 128, a = 255] = context.getImageData(0, 0, 1, 1).data;
  return { color: new Color().setRGB(r / 255, g / 255, b / 255, SRGBColorSpace), alpha: a / 255 };
}

/** Damier gris des textures absentes (texture du jeu, fichier manquant). */
function checkerTexture(): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 16;
  const context = canvas.getContext("2d")!;
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      context.fillStyle = (x + y) % 2 === 0 ? "#8b8b8b" : "#6f6f6f";
      context.fillRect(x, y, 1, 1);
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.magFilter = texture.minFilter = NearestFilter;
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function geometryOf(part: Part, flat = false): BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  for (const quad of part.quads) {
    const light = flat || !part.shade ? 1 : shadeOf(quadNormal(quad));
    for (const i of [0, 1, 2, 0, 2, 3]) {
      positions.push(...quad.positions[i]!);
      uvs.push(...quad.uvs[i]!);
      colors.push(light, light, light);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute("uv", new BufferAttribute(new Float32Array(uvs), 2));
  geometry.setAttribute("color", new BufferAttribute(new Float32Array(colors), 3));
  geometry.computeBoundingSphere();
  return geometry;
}

/** Contour des faces d'un morceau (sélection). */
function outlineOf(parts: Part[], color: Color): LineSegments {
  const points: number[] = [];
  for (const part of parts) {
    for (const quad of part.quads) {
      for (let i = 0; i < 4; i += 1) {
        points.push(...quad.positions[i]!, ...quad.positions[(i + 1) % 4]!);
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(points), 3));
  const material = new LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 });
  const lines = new LineSegments(geometry, material);
  lines.renderOrder = 10;
  return lines;
}

function label(text: string, color: Color): Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const context = canvas.getContext("2d")!;
  context.font = "600 40px system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = `#${color.getHexString()}`;
  context.fillText(text, 32, 34);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  const sprite = new Sprite(new SpriteMaterial({ map: texture, transparent: true }));
  sprite.scale.set(2.5, 2.5, 1);
  return sprite;
}

function disposeGroup(group: Group) {
  for (const child of [...group.children]) {
    group.remove(child);
    child.traverse((node) => {
      const mesh = node as Mesh;
      mesh.geometry?.dispose();
      const material = mesh.material as MeshBasicMaterial | MeshBasicMaterial[] | undefined;
      for (const m of Array.isArray(material) ? material : material ? [material] : []) {
        if (m.map && (m.map as Texture & { isCanvasTexture?: boolean }).isCanvasTexture && node instanceof Sprite) m.map.dispose();
        m.dispose();
      }
    });
  }
}

/**
 * Vue 3D d'un modèle : glisser pour tourner (clic droit en mode peinture), molette pour
 * zoomer, clic droit ou milieu pour déplacer. Un clic choisit un cube, que ses flèches
 * déplacent (au pixel) ; en mode peinture, le clic et le glisser peignent le pixel de la
 * texture sous la souris.
 */
export function Viewport({
  parts,
  ghosts = [],
  textures,
  textureVersion,
  selected,
  mode,
  frameKey,
  floor,
  onPick,
  onPaint,
  gizmo = null,
  onMove,
  preview = [],
  boxes = [],
}: ViewportProps) {
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<Stage | null>(null);
  const handlers = useRef({ onPick, onPaint, onMove, mode });
  handlers.current = { onPick, onPaint, onMove, mode };

  // Scène, caméra, contrôles : une fois.
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = SRGBColorSpace;
    element.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";
    const scene = new Scene();
    const camera = new PerspectiveCamera(40, 1, 0.5, 2000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    const content = new Group();
    const overlay = new Group();
    const marks = new Group();
    const floorGroup = new Group();
    scene.add(floorGroup, content, overlay, marks);
    const render = () => renderer.render(scene, camera);
    controls.addEventListener("change", render);

    // Poignée de déplacement : un point d'ancrage (matrice de l'os) et la poignée dedans.
    const anchor = new Object3D();
    anchor.matrixAutoUpdate = false;
    const handle = new Object3D();
    anchor.add(handle);
    scene.add(anchor);
    const transform = new TransformControls(camera, renderer.domElement);
    transform.setMode("translate");
    transform.setSpace("world");
    transform.setTranslationSnap(1);
    transform.setSize(0.7);
    scene.add(transform.getHelper());
    const start = new Vector3();
    transform.addEventListener("change", render);
    transform.addEventListener("dragging-changed", (event) => {
      const dragging = Boolean((event as unknown as { value: boolean }).value);
      controls.enabled = !dragging;
      if (dragging) {
        start.copy(handle.position);
      } else {
        const delta = handle.position.clone().sub(start);
        handlers.current.onMove?.([delta.x, delta.y, delta.z], true);
      }
    });
    transform.addEventListener("objectChange", () => {
      const delta = handle.position.clone().sub(start);
      handlers.current.onMove?.([delta.x, delta.y, delta.z], false);
    });

    const current: Stage = {
      renderer,
      scene,
      camera,
      controls,
      content,
      overlay,
      marks,
      floor: floorGroup,
      textures: new Map(),
      checker: checkerTexture(),
      transform,
      anchor,
      handle,
      render,
    };
    stage.current = current;

    const resize = () => {
      const { width, height } = element.getBoundingClientRect();
      if (width < 1 || height < 1) return;
      renderer.setSize(width, height, false);
      renderer.domElement.style.width = `${width}px`;
      renderer.domElement.style.height = `${height}px`;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      render();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();

    // Clic (sélection) et peinture.
    const raycaster = new Raycaster();
    const pointer = new Vector2();
    let down: { x: number; y: number; painting: boolean } | null = null;
    const hit = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      return raycaster.intersectObjects(content.children, false)[0] ?? null;
    };
    const paintAt = (event: PointerEvent, phase: PaintPhase) => {
      const found = hit(event);
      const part = found?.object.userData.part as Part | undefined;
      const uv = found?.uv;
      if (!part || !uv || !part.texture) return;
      const size = current.textures.get(part.texture)?.image as { width: number; height: number } | undefined;
      if (!size) return;
      const x = Math.min(size.width - 1, Math.max(0, Math.floor(uv.x * size.width)));
      const y = Math.min(size.height - 1, Math.max(0, Math.floor(uv.y * size.height)));
      handlers.current.onPaint?.({ texture: part.texture, x, y, owner: part.owner, face: part.face }, phase);
    };
    const onDown = (event: PointerEvent) => {
      const painting = handlers.current.mode === "paint" && event.button === 0;
      down = { x: event.clientX, y: event.clientY, painting };
      if (painting) {
        renderer.domElement.setPointerCapture(event.pointerId);
        paintAt(event, "start");
      }
    };
    const onMove = (event: PointerEvent) => {
      if (down?.painting) paintAt(event, "move");
    };
    const onUp = (event: PointerEvent) => {
      const start = down;
      down = null;
      if (!start) return;
      if (start.painting) {
        handlers.current.onPaint?.({ texture: "", x: -1, y: -1, owner: "", face: null }, "end");
        return;
      }
      // Un clic, pas un glisser (ni un clic sur la poignée) : sélection.
      if (transform.axis !== null || transform.dragging) return;
      if (event.button === 0 && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 4) {
        const found = hit(event);
        const part = found?.object.userData.part as Part | undefined;
        handlers.current.onPick?.(part?.owner ?? null, part?.face ?? null, event.shiftKey || event.ctrlKey || event.metaKey);
      }
    };
    const canvas = renderer.domElement;
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    return () => {
      observer.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      transform.detach();
      transform.dispose();
      controls.dispose();
      disposeGroup(content);
      disposeGroup(overlay);
      disposeGroup(marks);
      disposeGroup(floorGroup);
      for (const texture of current.textures.values()) texture.dispose();
      current.checker.dispose();
      renderer.dispose();
      element.removeChild(renderer.domElement);
      stage.current = null;
    };
  }, []);

  // Boutons de la souris selon le mode : en peinture, le clic gauche peint.
  useEffect(() => {
    const current = stage.current;
    if (!current) return;
    current.controls.mouseButtons =
      mode === "paint" ? { LEFT: null, MIDDLE: 1, RIGHT: 0 } : { LEFT: 0, MIDDLE: 1, RIGHT: 2 };
    current.renderer.domElement.style.cursor = mode === "paint" ? "crosshair" : "grab";
  }, [mode]);

  // Textures : créées ou mises à jour (mêmes objets, nouveaux pixels).
  useEffect(() => {
    const current = stage.current;
    if (!current) return;
    for (const [key, pixels] of textures) {
      let texture = current.textures.get(key);
      const size = texture?.image as { width: number; height: number } | undefined;
      if (!texture || size?.width !== pixels.width || size?.height !== pixels.height) {
        texture?.dispose();
        texture = new DataTexture(new Uint8Array(pixels.data.buffer.slice(0)), pixels.width, pixels.height, RGBAFormat);
        texture.magFilter = texture.minFilter = NearestFilter;
        texture.colorSpace = SRGBColorSpace;
        current.textures.set(key, texture);
      } else {
        (texture.image as { data: Uint8Array }).data.set(pixels.data);
      }
      texture.needsUpdate = true;
    }
    current.render();
  }, [textures, textureVersion]);

  // Géométrie : reconstruite quand le modèle change.
  useEffect(() => {
    const current = stage.current;
    if (!current) return;
    disposeGroup(current.content);
    const materials = new Map<string, MeshBasicMaterial>();
    const materialFor = (key: string | null) => {
      const id = key ?? "";
      let material = materials.get(id);
      if (!material) {
        material = new MeshBasicMaterial({
          map: (key && current.textures.get(key)) || current.checker,
          vertexColors: true,
          alphaTest: 0.05,
          side: FrontSide,
        });
        materials.set(id, material);
      }
      return material;
    };
    for (const part of parts) {
      const mesh = new Mesh(geometryOf(part), materialFor(part.texture));
      mesh.userData.part = part;
      current.content.add(mesh);
    }
    for (const ghost of ghosts) {
      const mesh = new Mesh(
        geometryOf(ghost),
        new MeshBasicMaterial({ color: 0x9a9a9a, vertexColors: true, side: FrontSide }),
      );
      mesh.raycast = () => undefined;
      current.content.add(mesh);
      mesh.userData.ghost = true;
    }
    current.render();
  }, [parts, ghosts, textures]);

  // Poignée de déplacement sur la sélection (pas pendant un glisser : elle y est déjà).
  useEffect(() => {
    const current = stage.current;
    if (!current) return;
    if (!gizmo || mode !== "select") {
      current.transform.detach();
    } else if (!current.transform.dragging) {
      current.anchor.matrix.copy(gizmo.parent);
      current.anchor.matrixWorldNeedsUpdate = true;
      current.handle.position.set(...gizmo.position);
      current.transform.attach(current.handle);
    }
    current.render();
  }, [gizmo, mode]);

  // Contour de la sélection.
  useEffect(() => {
    const current = stage.current;
    if (!current) return;
    disposeGroup(current.overlay);
    const chosen = parts.filter((p) => selected.includes(p.owner));
    if (chosen.length > 0) current.overlay.add(outlineOf(chosen, cssColor("--color-accent", "#d9a441").color));
    current.render();
  }, [parts, selected]);

  // Aperçu d'une forme et boîtes repères, par-dessus le modèle.
  useEffect(() => {
    const current = stage.current;
    if (!current) return;
    disposeGroup(current.marks);
    const accent = cssColor("--color-accent", "#d9a441").color;
    const danger = cssColor("--color-danger", "#d9534f").color;
    if (preview.length > 0) {
      const material = new MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.35, depthWrite: false, side: DoubleSide });
      for (const part of preview) {
        const mesh = new Mesh(geometryOf(part, true), material);
        mesh.raycast = () => undefined;
        current.marks.add(mesh);
      }
      const lines = outlineOf(preview, accent);
      lines.raycast = () => undefined;
      current.marks.add(lines);
    }
    for (const box of boxes) {
      const color = box.tone === "danger" ? danger : accent;
      const size = box.to.map((v, i) => Math.max(0.01, Math.abs(v - box.from[i]!))) as Vec3;
      const center = box.to.map((v, i) => (v + box.from[i]!) / 2) as Vec3;
      const holder = new Group();
      holder.matrixAutoUpdate = false;
      holder.matrix.copy(box.parent ?? new Matrix4());
      const shape = new BoxGeometry(...size);
      const fill = new Mesh(shape, new MeshBasicMaterial({ color, transparent: true, opacity: 0.18, depthWrite: false, side: DoubleSide }));
      fill.position.set(...center);
      fill.raycast = () => undefined;
      const edges = new LineSegments(new EdgesGeometry(shape), new LineBasicMaterial({ color, depthTest: false, transparent: true }));
      edges.position.set(...center);
      edges.renderOrder = 11;
      edges.raycast = () => undefined;
      holder.add(fill, edges);
      current.marks.add(holder);
    }
    current.render();
  }, [preview, boxes]);

  // Sol : un bloc (grille 16 × 16 et son cube) ou une grille de 3 × 3 blocs pour une entité.
  useEffect(() => {
    const current = stage.current;
    if (!current) return;
    disposeGroup(current.floor);
    const line = cssColor("--color-border-strong", "#555555");
    const text = cssColor("--color-text-subtle", "#888888").color;
    const size = floor === "block" ? 16 : 48;
    const grid = new GridHelper(size, floor === "block" ? 16 : 3, line.color, line.color);
    const gridMaterial = grid.material as LineBasicMaterial;
    gridMaterial.transparent = true;
    gridMaterial.opacity = Math.max(0.35, line.alpha);
    if (floor === "block") grid.position.set(8, 0, 8);
    current.floor.add(grid);
    if (floor === "entity") {
      // Grille fine d'un pixel sous l'entité (un bloc de côté), la grande en blocs.
      const fine = new GridHelper(16, 16, line.color, line.color);
      const fineMaterial = fine.material as LineBasicMaterial;
      fineMaterial.transparent = true;
      fineMaterial.opacity = Math.max(0.18, line.alpha * 0.6);
      current.floor.add(fine);
    }
    const half = size / 2;
    const center = floor === "block" ? 8 : 0;
    const north = label("N", text);
    north.position.set(center, 0.2, center - half - 2);
    current.floor.add(north);
    current.render();
  }, [floor]);

  // Cadrage de la caméra sur le modèle.
  useEffect(() => {
    const current = stage.current;
    if (!current) return;
    const sphere = new Sphere();
    const all = [...parts, ...ghosts].flatMap((p) => p.quads.flatMap((q) => q.positions.map((v) => new Vector3(...v))));
    if (all.length > 0) sphere.setFromPoints(all);
    else sphere.set(new Vector3(floor === "block" ? 8 : 0, 8, floor === "block" ? 8 : 0), 12);
    const radius = Math.max(sphere.radius, 6);
    const distance = radius / Math.sin((current.camera.fov * Math.PI) / 360) * 1.1;
    const direction = new Vector3(0.9, 0.7, 1.3).normalize();
    current.camera.position.copy(sphere.center.clone().add(direction.multiplyScalar(distance)));
    current.controls.target.copy(sphere.center);
    current.controls.update();
    current.render();
    // Recadrer seulement quand un autre modèle s'ouvre, pas à chaque retouche.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameKey]);

  return <div ref={host} className="absolute inset-0" aria-hidden />;
}
