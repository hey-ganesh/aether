"use client";

import React, { useMemo, useEffect, useState, useCallback, useRef } from "react";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { ySyncPluginKey } from "@tiptap/y-tiptap";
import { Plus, Share, Check, MousePointer2, Pencil, Eraser, Square, Circle, Type, Highlighter, Image as ImageIcon, Undo2, Redo2 } from "lucide-react";
import { animate, AnimatePresence, motion } from "framer-motion";
import Xarrow from "react-xarrows";
import NodeEditor from "@/components/NodeEditor";
import Cursor from "@/components/Cursor";
import CollaboratorsBar from "@/components/CollaboratorsBar";

const cursorColors = ['#fbbf24', '#f87171', '#60a5fa', '#34d399', '#a78bfa', '#f472b6', '#38bdf8'];
const swatches = ['#fbbf24', '#f87171', '#60a5fa', '#34d399', '#a78bfa', '#f472b6', '#38bdf8', '#ffffff', '#9ca3af', '#4b5563', '#1f2937', '#000000'];
type ToolMode = "select" | "marquee" | "draw" | "highlight" | "erase";
type DrawToolMode = Extract<ToolMode, "draw" | "highlight">;

interface NodeData {
  id: string;
  type?: 'text' | 'sticky' | 'rect' | 'circle' | 'diamond' | 'image';
  x: number;
  y: number;
  color?: string;
  opacity?: number;
  src?: string;
  width?: number;
  height?: number;
  borderRadius?: number;
  borderWidth?: number;
  borderColor?: string;
}

interface EdgeData {
  id: string;
  source: string;
  target: string;
}

interface SharedPath {
  id: string;
  color?: string;
  opacity?: number;
  points: [number, number][];
  strokeWidth?: number;
  toolType?: 'pen' | 'highlighter';
}

interface ToolAppearance {
  color: string;
  opacity: number;
  strokeWidth: number;
}

interface RectBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface CameraState {
  x: number;
  y: number;
  zoom: number;
}

type CanvasInteraction =
  | { type: "draw"; pointerId: number }
  | { type: "erase"; pointerId: number; lastWorld: { x: number; y: number } }
  | { type: "marquee"; pointerId: number }
  | {
      type: "pan";
      pointerId: number;
      clientStart: { x: number; y: number };
      cameraStart: CameraState;
      touchLike: boolean;
    }
  | null;

const defaultPenAppearance: ToolAppearance = {
  color: "#ffffff",
  opacity: 1,
  strokeWidth: 4,
};

const defaultHighlighterAppearance: ToolAppearance = {
  color: "#fbbf24",
  opacity: 0.4,
  strokeWidth: 20,
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const isEditableTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
};

const isTouchLikePointer = (pointerType: string) => pointerType === "touch" || pointerType === "pen";
const borderSwatches = ['#ffffff', '#d4d4d8', '#94a3b8', '#60a5fa', '#34d399', '#fbbf24', '#f472b6', '#111827'];

const DEFAULT_NODE_SIZE: Record<NonNullable<NodeData["type"]>, { width: number; height: number }> = {
  text: { width: 340, height: 140 },
  sticky: { width: 260, height: 240 },
  rect: { width: 320, height: 220 },
  circle: { width: 260, height: 260 },
  diamond: { width: 280, height: 240 },
  image: { width: 300, height: 300 },
};

const getNodeDimensions = (node: NodeData) => {
  const type = node.type || "text";
  const defaults = DEFAULT_NODE_SIZE[type];
  return {
    width: node.width || defaults.width,
    height: node.height || defaults.height,
  };
};

const getNodeBounds = (node: NodeData): RectBounds => {
  const { width, height } = getNodeDimensions(node);
  return {
    left: node.x,
    top: node.y,
    right: node.x + width,
    bottom: node.y + height,
  };
};

const isPointInsideBounds = (x: number, y: number, bounds: RectBounds) =>
  x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;

const boundsIntersect = (a: RectBounds, b: RectBounds) =>
  a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;

const getPathBounds = (points: [number, number][]): RectBounds => {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  };
};

const distancePointToSegment = (
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number }
) => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - start.x, point.y - start.y);

  const t = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy), 0, 1);
  const projectedX = start.x + t * dx;
  const projectedY = start.y + t * dy;
  return Math.hypot(point.x - projectedX, point.y - projectedY);
};

const orientation = (
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number }
) => {
  const value = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  if (Math.abs(value) < 0.000001) return 0;
  return value > 0 ? 1 : 2;
};

const onSegment = (
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number }
) =>
  b.x <= Math.max(a.x, c.x) &&
  b.x >= Math.min(a.x, c.x) &&
  b.y <= Math.max(a.y, c.y) &&
  b.y >= Math.min(a.y, c.y);

const segmentsIntersect = (
  startA: { x: number; y: number },
  endA: { x: number; y: number },
  startB: { x: number; y: number },
  endB: { x: number; y: number }
) => {
  const o1 = orientation(startA, endA, startB);
  const o2 = orientation(startA, endA, endB);
  const o3 = orientation(startB, endB, startA);
  const o4 = orientation(startB, endB, endA);

  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(startA, startB, endA)) return true;
  if (o2 === 0 && onSegment(startA, endB, endA)) return true;
  if (o3 === 0 && onSegment(startB, startA, endB)) return true;
  if (o4 === 0 && onSegment(startB, endA, endB)) return true;

  return false;
};

const doesPathIntersectRect = (points: [number, number][], rect: RectBounds) => {
  if (points.length === 0) return false;
  if (!boundsIntersect(getPathBounds(points), rect)) return false;
  if (points.some(([x, y]) => isPointInsideBounds(x, y, rect))) return true;

  const rectEdges = [
    [{ x: rect.left, y: rect.top }, { x: rect.right, y: rect.top }],
    [{ x: rect.right, y: rect.top }, { x: rect.right, y: rect.bottom }],
    [{ x: rect.right, y: rect.bottom }, { x: rect.left, y: rect.bottom }],
    [{ x: rect.left, y: rect.bottom }, { x: rect.left, y: rect.top }],
  ] as const;

  for (let index = 1; index < points.length; index += 1) {
    const start = { x: points[index - 1][0], y: points[index - 1][1] };
    const end = { x: points[index][0], y: points[index][1] };

    if (isPointInsideBounds(start.x, start.y, rect) || isPointInsideBounds(end.x, end.y, rect)) {
      return true;
    }

    if (rectEdges.some(([edgeStart, edgeEnd]) => segmentsIntersect(start, end, edgeStart, edgeEnd))) {
      return true;
    }
  }

  return false;
};

const doesPathIntersectBrush = (points: [number, number][], brushPoint: { x: number; y: number }, radius: number) => {
  if (points.length === 0) return false;
  const radiusBounds = {
    left: brushPoint.x - radius,
    top: brushPoint.y - radius,
    right: brushPoint.x + radius,
    bottom: brushPoint.y + radius,
  };
  if (!boundsIntersect(getPathBounds(points), radiusBounds)) return false;

  for (let index = 0; index < points.length; index += 1) {
    const [x, y] = points[index];
    if (Math.hypot(brushPoint.x - x, brushPoint.y - y) <= radius) {
      return true;
    }
    if (index > 0) {
      const [prevX, prevY] = points[index - 1];
      if (
        distancePointToSegment(
          brushPoint,
          { x: prevX, y: prevY },
          { x, y }
        ) <= radius
      ) {
        return true;
      }
    }
  }

  return false;
};

const DiamondToolbarIcon = ({ className = "", size = 20 }: { className?: string; size?: number }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className={className} width={size} height={size}>
    <path d="M12 3.5 20.5 12 12 20.5 3.5 12 12 3.5Z" fill="currentColor" />
  </svg>
);

const MarqueeToolbarIcon = ({ className = "", size = 20 }: { className?: string; size?: number }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className={className} width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.75">
    <path strokeDasharray="2.5 2.5" d="M5 5h14v14H5z" />
    <path d="M9 9h6v6H9z" />
  </svg>
);

const getSvgPathFromStroke = (points: [number, number][]) => {
  if (!points || points.length === 0) return "";
  if (points.length === 1) return `M ${points[0][0]} ${points[0][1]} L ${points[0][0]} ${points[0][1]}`;

  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length - 1; i++) {
    const current = points[i];
    const next = points[i + 1];
    d += ` Q ${current[0]} ${current[1]} ${(current[0] + next[0]) / 2} ${(current[1] + next[1]) / 2}`;
  }
  d += ` L ${points[points.length - 1][0]} ${points[points.length - 1][1]}`;
  return d;
};

export default function Canvas({ boardId }: { boardId: string }) {
  const doc = useMemo(() => new Y.Doc(), []);
  const undoManager = useMemo(
    () =>
      new Y.UndoManager(doc, {
        captureTimeout: 400,
        trackedOrigins: new Set([null, ySyncPluginKey]),
      }),
    [doc]
  );

  const [nodes, setNodes] = useState<NodeData[]>([]);
  const [edges, setEdges] = useState<EdgeData[]>([]);
  const [renderedPaths, setRenderedPaths] = useState<SharedPath[]>([]);
  const [wsStatus, setWsStatus] = useState<string>("disconnected");
  const [hasCopied, setHasCopied] = useState(false);

  const [showNameModal, setShowNameModal] = useState(false);
  const [nameInput, setNameInput] = useState("");

  const [providerInstance, setProviderInstance] = useState<WebsocketProvider | null>(null);
  const [awarenessUsers, setAwarenessUsers] = useState<Map<number, any>>(new Map());

  const [toolMode, setToolMode] = useState<ToolMode>("select");
  const [penAppearance, setPenAppearance] = useState<ToolAppearance>(defaultPenAppearance);
  const [highlighterAppearance, setHighlighterAppearance] = useState<ToolAppearance>(defaultHighlighterAppearance);
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPath, setCurrentPath] = useState<[number, number][] | null>(null);

  // Marquee State
  const [selectionStart, setSelectionStart] = useState<{ x: number, y: number } | null>(null);
  const [selectionCurrent, setSelectionCurrent] = useState<{ x: number, y: number } | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
  const [selectedPathIds, setSelectedPathIds] = useState<Set<string>>(new Set());

  // Toolbar state
  const [showAddMenu, setShowAddMenu] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [camera, setCamera] = useState<CameraState>({ x: 0, y: 0, zoom: 1 });
  const isDraggingCanvas = useRef(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [isSpaceDown, setIsSpaceDown] = useState(false);
  const cameraRef = useRef(camera);
  const currentPathRef = useRef<[number, number][] | null>(null);
  const activePointersRef = useRef<Map<number, { clientX: number; clientY: number; pointerType: string }>>(new Map());
  const interactionRef = useRef<CanvasInteraction>(null);
  const pinchGestureRef = useRef<{ cameraStart: CameraState; anchorWorld: { x: number; y: number }; startDistance: number } | null>(null);
  const cameraAnimationRef = useRef<{ stop?: () => void } | null>(null);

  useEffect(() => {
    cameraRef.current = camera;
  }, [camera]);

  useEffect(() => {
    currentPathRef.current = currentPath;
  }, [currentPath]);

  const clientToWorld = useCallback((clientX: number, clientY: number, activeCamera: CameraState) => {
    return {
      x: (clientX - activeCamera.x) / activeCamera.zoom,
      y: (clientY - activeCamera.y) / activeCamera.zoom,
    };
  }, []);

  const syncHistoryState = useCallback(() => {
    setHistoryState({
      canUndo: undoManager.canUndo(),
      canRedo: undoManager.canRedo(),
    });
  }, [undoManager]);

  useEffect(() => {
    const onHistoryChange = () => syncHistoryState();

    syncHistoryState();
    undoManager.on("stack-item-added", onHistoryChange);
    undoManager.on("stack-item-updated", onHistoryChange);
    undoManager.on("stack-item-popped", onHistoryChange);
    undoManager.on("stack-cleared", onHistoryChange);

    return () => {
      undoManager.off("stack-item-added", onHistoryChange);
      undoManager.off("stack-item-updated", onHistoryChange);
      undoManager.off("stack-item-popped", onHistoryChange);
      undoManager.off("stack-cleared", onHistoryChange);
      undoManager.destroy();
    };
  }, [syncHistoryState, undoManager]);

  const applyLocalUser = useCallback((provider: WebsocketProvider, name: string) => {
    const color = cursorColors[Math.floor(Math.random() * cursorColors.length)];

    provider.awareness.setLocalStateField("user", { name, color });
    setPenAppearance((current) => (current.color === defaultPenAppearance.color ? { ...current, color } : current));
  }, []);

  useEffect(() => {
    const provider = new WebsocketProvider("wss://aether-production-5792.up.railway.app", boardId, doc);
    setProviderInstance(provider);

    const localName = localStorage.getItem("milanote_username");
    if (localName) {
      applyLocalUser(provider, localName);
    } else {
      setShowNameModal(true);
    }

    provider.awareness.on("change", () => setAwarenessUsers(new Map(provider.awareness.getStates())));
    provider.on("status", (event: { status: string }) => setWsStatus(event.status));

    const nodesMap = doc.getMap<NodeData>("nodes");
    const edgesMap = doc.getMap<EdgeData>("edges");
    const pathsArray = doc.getArray<Y.Map<unknown>>("shared_paths");

    const syncNodes = () => {
      const currentNodes: NodeData[] = [];
      nodesMap.forEach((node) => currentNodes.push(node));
      setNodes(currentNodes);
    };

    const syncEdges = () => {
      const currentEdges: EdgeData[] = [];
      edgesMap.forEach((edge) => currentEdges.push(edge));
      setEdges(currentEdges);
    };

    const syncPaths = () => setRenderedPaths(pathsArray.toJSON() as SharedPath[]);

    syncNodes(); syncEdges(); syncPaths();

    nodesMap.observe(syncNodes);
    edgesMap.observe(syncEdges);
    pathsArray.observe(syncPaths);

    return () => {
      nodesMap.unobserve(syncNodes); edgesMap.unobserve(syncEdges); pathsArray.unobserve(syncPaths);
      provider.destroy();
    };
  }, [applyLocalUser, boardId, doc]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (e.code === "Space" && e.target === document.body) {
        e.preventDefault();
        setIsSpaceDown(true);
      }

      if (!isMod || showNameModal || isEditableTarget(e.target)) return;

      if (key === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          undoManager.redo();
        } else {
          undoManager.stopCapturing();
          undoManager.undo();
        }
      } else if (key === "y") {
        e.preventDefault();
        undoManager.redo();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") setIsSpaceDown(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [showNameModal, undoManager]);

  useEffect(() => {
    const canvasElement = canvasRef.current;
    if (!canvasElement) return;
    const preventDefaultZoom = (e: WheelEvent) => { if (e.ctrlKey || e.metaKey) e.preventDefault(); };
    canvasElement.addEventListener("wheel", preventDefaultZoom, { passive: false });
    return () => canvasElement.removeEventListener("wheel", preventDefaultZoom);
  }, []);

  useEffect(() => {
    return () => {
      cameraAnimationRef.current?.stop?.();
    };
  }, []);

  const submitName = (e: React.FormEvent) => {
    e.preventDefault();
    if (nameInput.trim() && providerInstance) {
      const name = nameInput.trim();
      localStorage.setItem("milanote_username", name);
      setShowNameModal(false);
      applyLocalUser(providerInstance, name);
    }
  };

  const getToolAppearance = useCallback(
    (mode: DrawToolMode) => (mode === "highlight" ? highlighterAppearance : penAppearance),
    [highlighterAppearance, penAppearance]
  );

  const updateToolAppearance = useCallback((mode: DrawToolMode, patch: Partial<ToolAppearance>) => {
    if (mode === "highlight") {
      setHighlighterAppearance((current) => ({ ...current, ...patch }));
    } else {
      setPenAppearance((current) => ({ ...current, ...patch }));
    }
  }, []);

  const addNode = useCallback((type: 'text' | 'sticky' | 'rect' | 'circle' | 'diamond' | 'image') => {
    const nodesMap = doc.getMap<NodeData>("nodes");
    const id = Math.random().toString(36).substring(2, 9);
    const worldX = (window.innerWidth / 2 - camera.x) / camera.zoom;
    const worldY = (window.innerHeight / 2 - camera.y) / camera.zoom;
    const defaults = DEFAULT_NODE_SIZE[type];

    const baseNode: NodeData = {
      id,
      type,
      x: worldX - defaults.width / 2,
      y: worldY - defaults.height / 2,
      width: defaults.width,
      height: defaults.height,
      borderRadius: type === "sticky" ? 18 : type === "text" ? 20 : 24,
      borderWidth: type === "text" ? 1.5 : 2,
      borderColor: type === "text" ? "#d4d4d8" : "#94a3b8",
    };

    if (type === "sticky") {
      baseNode.color = "#fef3c7";
      baseNode.borderColor = "#f59e0b";
      baseNode.borderWidth = 1.5;
    }

    nodesMap.set(id, baseNode);
    setToolMode('select');
    setShowAddMenu(false);
  }, [doc, camera]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1024 * 1024) {
      window.alert("Image too large (Max 1MB for real-time sync)");
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const nodesMap = doc.getMap<NodeData>("nodes");
      const id = Math.random().toString(36).substring(2, 9);
      const worldX = (window.innerWidth / 2 - camera.x) / camera.zoom;
      const worldY = (window.innerHeight / 2 - camera.y) / camera.zoom;
      const defaults = DEFAULT_NODE_SIZE.image;
      nodesMap.set(id, {
        id,
        type: 'image',
        src: ev.target?.result as string,
        width: defaults.width,
        height: defaults.height,
        borderRadius: 24,
        borderWidth: 0,
        borderColor: "#ffffff",
        x: worldX - defaults.width / 2,
        y: worldY - defaults.height / 2,
      });
      setShowAddMenu(false);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const updateSelectedNodes = useCallback(
    (key: "color" | "opacity" | "borderRadius" | "borderWidth" | "borderColor", value: string | number) => {
      const nodesMap = doc.getMap<NodeData>("nodes");
      selectedNodeIds.forEach((id) => {
        const current = nodesMap.get(id);
        if (current) nodesMap.set(id, { ...current, [key]: value });
      });
    },
    [doc, selectedNodeIds]
  );

  const updateSelectedPath = useCallback(
    (key: "color" | "opacity" | "strokeWidth", value: string | number) => {
      if (selectedPathIds.size === 0) return;

      const pathsArray = doc.getArray<Y.Map<unknown>>("shared_paths");
      pathsArray.forEach((map) => {
        if (selectedPathIds.has(String(map.get("id")))) {
          map.set(key, value);
        }
      });
    },
    [doc, selectedPathIds]
  );

  const applyColor = useCallback((color: string) => {
    if (selectedPathIds.size > 0) {
      updateSelectedPath("color", color);
    } else if (selectedNodeIds.size > 0) {
      updateSelectedNodes("color", color);
    } else if (toolMode === "draw" || toolMode === "highlight") {
      updateToolAppearance(toolMode, { color });
    }
  }, [selectedNodeIds.size, selectedPathIds, toolMode, updateSelectedNodes, updateSelectedPath, updateToolAppearance]);

  const applyOpacity = useCallback((opacity: number) => {
    if (selectedPathIds.size > 0) {
      updateSelectedPath("opacity", opacity);
    } else if (selectedNodeIds.size > 0) {
      updateSelectedNodes("opacity", opacity);
    } else if (toolMode === "draw" || toolMode === "highlight") {
      updateToolAppearance(toolMode, { opacity });
    }
  }, [selectedNodeIds.size, selectedPathIds, toolMode, updateSelectedNodes, updateSelectedPath, updateToolAppearance]);

  const applyStrokeWidth = useCallback((strokeWidth: number) => {
    if (selectedPathIds.size > 0) {
      updateSelectedPath("strokeWidth", strokeWidth);
    } else if (toolMode === "draw" || toolMode === "highlight") {
      updateToolAppearance(toolMode, { strokeWidth });
    }
  }, [selectedPathIds, toolMode, updateSelectedPath, updateToolAppearance]);

  const applyBorderRadius = useCallback((borderRadius: number) => {
    if (selectedNodeIds.size > 0) {
      updateSelectedNodes("borderRadius", borderRadius);
    }
  }, [selectedNodeIds.size, updateSelectedNodes]);

  const applyBorderWidth = useCallback((borderWidth: number) => {
    if (selectedNodeIds.size > 0) {
      updateSelectedNodes("borderWidth", borderWidth);
    }
  }, [selectedNodeIds.size, updateSelectedNodes]);

  const applyBorderColor = useCallback((borderColor: string) => {
    if (selectedNodeIds.size > 0) {
      updateSelectedNodes("borderColor", borderColor);
    }
  }, [selectedNodeIds.size, updateSelectedNodes]);

  const commitSharedPath = useCallback((points: [number, number][], mode: DrawToolMode) => {
    if (points.length < 2) return;

    const settings = getToolAppearance(mode);
    const pathsArray = doc.getArray<Y.Map<unknown>>("shared_paths");
    const yMap = new Y.Map<unknown>();

    yMap.set("id", crypto.randomUUID());
    yMap.set("color", settings.color);
    yMap.set("toolType", mode === "highlight" ? "highlighter" : "pen");
    yMap.set("opacity", settings.opacity);
    yMap.set("strokeWidth", settings.strokeWidth);
    yMap.set("points", points);
    pathsArray.push([yMap]);
  }, [doc, getToolAppearance]);

  const eraseAtPoint = useCallback((worldPoint: { x: number; y: number }, radius: number) => {
    const nodesMap = doc.getMap<NodeData>("nodes");
    const pathsArray = doc.getArray<Y.Map<unknown>>("shared_paths");

    const nodeIdsToDelete: string[] = [];
    nodesMap.forEach((node, id) => {
      if (isPointInsideBounds(worldPoint.x, worldPoint.y, getNodeBounds(node))) {
        nodeIdsToDelete.push(id);
      }
    });
    nodeIdsToDelete.forEach((id) => nodesMap.delete(id));

    const pathIndexesToDelete: number[] = [];
    pathsArray.forEach((map, index) => {
      const points = map.get("points") as [number, number][] | undefined;
      if (points && doesPathIntersectBrush(points, worldPoint, radius)) {
        pathIndexesToDelete.push(index);
      }
    });
    pathIndexesToDelete.reverse().forEach((index) => pathsArray.delete(index));
  }, [doc]);

  const eraseAlongSegment = useCallback((from: { x: number; y: number }, to: { x: number; y: number }, radius: number) => {
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.max(1, Math.ceil(distance / Math.max(radius * 0.6, 1)));

    for (let step = 0; step <= steps; step += 1) {
      const progress = step / steps;
      eraseAtPoint(
        {
          x: from.x + (to.x - from.x) * progress,
          y: from.y + (to.y - from.y) * progress,
        },
        radius
      );
    }
  }, [eraseAtPoint]);

  const clearPointerState = useCallback(() => {
    interactionRef.current = null;
    pinchGestureRef.current = null;
    activePointersRef.current.clear();
    isDraggingCanvas.current = false;
    setIsDrawing(false);
  }, []);

  const beginPinchGesture = useCallback(() => {
    const touchPointers = Array.from(activePointersRef.current.values()).filter((pointer) => pointer.pointerType === "touch");
    if (touchPointers.length < 2) return;

    const [first, second] = touchPointers;
    const activeCamera = cameraRef.current;
    const center = {
      x: (first.clientX + second.clientX) / 2,
      y: (first.clientY + second.clientY) / 2,
    };

    pinchGestureRef.current = {
      cameraStart: activeCamera,
      anchorWorld: clientToWorld(center.x, center.y, activeCamera),
      startDistance: Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY),
    };

    interactionRef.current = null;
    isDraggingCanvas.current = false;
    setSelectionStart(null);
    setSelectionCurrent(null);
    setIsDrawing(false);
    currentPathRef.current = null;
    setCurrentPath(null);
  }, [clientToWorld]);

  const jumpToWorldPoint = useCallback((worldX: number, worldY: number) => {
    const start = cameraRef.current;
    const next = {
      x: window.innerWidth / 2 - worldX * start.zoom,
      y: window.innerHeight / 2 - worldY * start.zoom,
      zoom: start.zoom,
    };

    cameraAnimationRef.current?.stop?.();
    cameraAnimationRef.current = animate(0, 1, {
      duration: 0.28,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (latest) => {
        setCamera({
          x: start.x + (next.x - start.x) * latest,
          y: start.y + (next.y - start.y) * latest,
          zoom: start.zoom,
        });
      },
    });
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (showNameModal) return;

    activePointersRef.current.set(e.pointerId, {
      clientX: e.clientX,
      clientY: e.clientY,
      pointerType: e.pointerType,
    });

    const isPrimaryAction = e.pointerType !== "mouse" || e.button === 0;
    const touchLike = isTouchLikePointer(e.pointerType);
    const worldPoint = clientToWorld(e.clientX, e.clientY, cameraRef.current);
    const touchPointers = Array.from(activePointersRef.current.values()).filter((pointer) => pointer.pointerType === "touch");

    if (touchPointers.length >= 2) {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      beginPinchGesture();
      return;
    }

    if ((toolMode === "draw" || toolMode === "highlight") && isPrimaryAction && !isSpaceDown) {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      interactionRef.current = { type: "draw", pointerId: e.pointerId };
      setSelectedNodeIds(new Set());
      setSelectedPathIds(new Set());
      setSelectionStart(null);
      setSelectionCurrent(null);
      setIsDrawing(true);
      currentPathRef.current = [[worldPoint.x, worldPoint.y] as [number, number]];
      setCurrentPath(currentPathRef.current);
      return;
    }

    if (toolMode === "erase" && isPrimaryAction) {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      interactionRef.current = { type: "erase", pointerId: e.pointerId, lastWorld: worldPoint };
      setSelectedNodeIds(new Set());
      setSelectedPathIds(new Set());
      eraseAtPoint(worldPoint, 18 / cameraRef.current.zoom);
      return;
    }

    if ((toolMode === "select" || toolMode === "marquee") && isPrimaryAction && !isSpaceDown) {
      if (toolMode === "select" && e.target !== e.currentTarget) return;

      e.currentTarget.setPointerCapture(e.pointerId);
      setSelectedPathIds(new Set());

      if (touchLike && toolMode === "select") {
        e.preventDefault();
        isDraggingCanvas.current = true;
        interactionRef.current = {
          type: "pan",
          pointerId: e.pointerId,
          clientStart: { x: e.clientX, y: e.clientY },
          cameraStart: cameraRef.current,
          touchLike: true,
        };
        return;
      }

      setSelectedNodeIds(new Set());
      setSelectionStart({ x: worldPoint.x, y: worldPoint.y });
      setSelectionCurrent({ x: worldPoint.x, y: worldPoint.y });
      interactionRef.current = { type: "marquee", pointerId: e.pointerId };
      return;
    }

    if ((e.button === 1 || (isPrimaryAction && isSpaceDown)) && toolMode !== "erase") {
      e.preventDefault();
      isDraggingCanvas.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      interactionRef.current = {
        type: "pan",
        pointerId: e.pointerId,
        clientStart: { x: e.clientX, y: e.clientY },
        cameraStart: cameraRef.current,
        touchLike,
      };
    }
  }, [beginPinchGesture, clientToWorld, eraseAtPoint, isSpaceDown, showNameModal, toolMode]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    activePointersRef.current.set(e.pointerId, {
      clientX: e.clientX,
      clientY: e.clientY,
      pointerType: e.pointerType,
    });

    const worldPoint = clientToWorld(e.clientX, e.clientY, cameraRef.current);

    if (providerInstance) {
      providerInstance.awareness.setLocalStateField("cursor", { x: worldPoint.x, y: worldPoint.y });
    }

    const touchPointers = Array.from(activePointersRef.current.values()).filter((pointer) => pointer.pointerType === "touch");
    if (touchPointers.length >= 2 && pinchGestureRef.current) {
      e.preventDefault();

      const [first, second] = touchPointers;
      const distance = Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
      const center = {
        x: (first.clientX + second.clientX) / 2,
        y: (first.clientY + second.clientY) / 2,
      };
      const scale = pinchGestureRef.current.startDistance === 0 ? 1 : distance / pinchGestureRef.current.startDistance;
      const nextZoom = clamp(pinchGestureRef.current.cameraStart.zoom * scale, 0.1, 3);

      setCamera({
        x: center.x - pinchGestureRef.current.anchorWorld.x * nextZoom,
        y: center.y - pinchGestureRef.current.anchorWorld.y * nextZoom,
        zoom: nextZoom,
      });
      return;
    }

    const interaction = interactionRef.current;
    if (!interaction || interaction.pointerId !== e.pointerId) return;

    if (interaction.type === "draw") {
      e.preventDefault();
      setCurrentPath((previous) => {
        const point: [number, number] = [worldPoint.x, worldPoint.y];
        const next: [number, number][] = previous ? [...previous, point] : [point];
        currentPathRef.current = next;
        return next;
      });
    } else if (interaction.type === "erase") {
      e.preventDefault();
      eraseAlongSegment(interaction.lastWorld, worldPoint, 18 / cameraRef.current.zoom);
      interactionRef.current = { ...interaction, lastWorld: worldPoint };
    } else if (interaction.type === "marquee") {
      setSelectionCurrent({ x: worldPoint.x, y: worldPoint.y });
    } else if (interaction.type === "pan") {
      e.preventDefault();
      setCamera({
        x: interaction.cameraStart.x + (e.clientX - interaction.clientStart.x),
        y: interaction.cameraStart.y + (e.clientY - interaction.clientStart.y),
        zoom: interaction.cameraStart.zoom,
      });
    }
  }, [clientToWorld, eraseAlongSegment, providerInstance]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const interaction = interactionRef.current;

    if (interaction && interaction.pointerId === e.pointerId) {
      if (interaction.type === "draw") {
        const points = currentPathRef.current;
        const activeDrawMode: DrawToolMode = toolMode === "highlight" ? "highlight" : "draw";

        setIsDrawing(false);
        if (points && points.length > 2) {
          commitSharedPath(points, activeDrawMode);
        }
        currentPathRef.current = null;
        setCurrentPath(null);
      } else if (interaction.type === "erase") {
        eraseAlongSegment(interaction.lastWorld, interaction.lastWorld, 18 / cameraRef.current.zoom);
      } else if (interaction.type === "marquee" && selectionStart && selectionCurrent) {
        const left = Math.min(selectionStart.x, selectionCurrent.x);
        const right = Math.max(selectionStart.x, selectionCurrent.x);
        const top = Math.min(selectionStart.y, selectionCurrent.y);
        const bottom = Math.max(selectionStart.y, selectionCurrent.y);
        const selectionBounds = { left, right, top, bottom };

        const activeSet = new Set<string>();
        nodes.forEach((node) => {
          if (boundsIntersect(getNodeBounds(node), selectionBounds)) {
            activeSet.add(node.id);
          }
        });

        const activePathSet = new Set<string>();
        renderedPaths.forEach((path) => {
          if (doesPathIntersectRect(path.points, selectionBounds)) {
            activePathSet.add(path.id);
          }
        });
        setSelectedNodeIds(activeSet);
        setSelectedPathIds(activePathSet);
        setSelectionStart(null);
        setSelectionCurrent(null);
      } else if (interaction.type === "pan") {
        const movement = Math.hypot(e.clientX - interaction.clientStart.x, e.clientY - interaction.clientStart.y);
        if (interaction.touchLike && movement < 8 && e.target === e.currentTarget) {
          setSelectedNodeIds(new Set());
          setSelectedPathIds(new Set());
        }
      }

      interactionRef.current = null;
    }

    activePointersRef.current.delete(e.pointerId);
    if (Array.from(activePointersRef.current.values()).filter((pointer) => pointer.pointerType === "touch").length < 2) {
      pinchGestureRef.current = null;
    }
    if (activePointersRef.current.size === 0) {
      isDraggingCanvas.current = false;
    }

    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // Ignore release errors when capture is already dropped.
      }
    }
  }, [commitSharedPath, eraseAlongSegment, nodes, renderedPaths, selectionCurrent, selectionStart, toolMode]);

  const handlePointerCancel = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    currentPathRef.current = null;
    setCurrentPath(null);
    setSelectionStart(null);
    setSelectionCurrent(null);
    clearPointerState();
    activePointersRef.current.delete(e.pointerId);

    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // Ignore release errors when capture is already dropped.
      }
    }
  }, [clearPointerState]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (showNameModal) return;
    if (e.ctrlKey || e.metaKey) {
      setCamera((cam) => {
        const scaleFactor = 0.002;
        const newZoom = Math.min(Math.max(cam.zoom - e.deltaY * scaleFactor, 0.1), 3);
        const pointerX = e.clientX;
        const pointerY = e.clientY;
        const worldX = (pointerX - cam.x) / cam.zoom;
        const worldY = (pointerY - cam.y) / cam.zoom;
        const newX = pointerX - worldX * newZoom;
        const newY = pointerY - worldY * newZoom;
        return { x: newX, y: newY, zoom: newZoom };
      });
    } else {
      setCamera((cam) => ({ ...cam, x: cam.x - e.deltaX, y: cam.y - e.deltaY }));
    }
  }, [showNameModal]);

  const getDynamicCursor = () => {
    if (isSpaceDown) return isDraggingCanvas.current ? 'cursor-grabbing' : 'cursor-grab';
    if (toolMode === 'marquee') return 'cursor-crosshair';
    if (toolMode === 'draw') return "cursor-[url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"white\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M12 20h9\"/><path d=\"M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z\"/></svg>'),_auto]";
    if (toolMode === 'highlight') return "cursor-[url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"%23fbbf24\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"m9 11-6 6v3h9l3-3\"/><path d=\"m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4\"/></svg>'),_auto]";
    if (toolMode === 'erase') return "cursor-[url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"red\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21\"/><path d=\"M22 21H7\"/><path d=\"m5 11 9 9\"/></svg>'),_auto]";
    return 'cursor-default';
  };

  const handlePathInteraction = (id: string, e: React.PointerEvent) => {
    e.stopPropagation();
    if (toolMode === 'erase') {
      const pathsArray = doc.getArray<Y.Map<unknown>>("shared_paths");
      let targetIndex = -1;
      pathsArray.forEach((map, idx) => { if (map.get('id') === id) targetIndex = idx; });
      if (targetIndex !== -1) pathsArray.delete(targetIndex);
    } else if (toolMode === 'select') {
      setSelectedNodeIds(new Set());
      setSelectedPathIds((current) => {
        if (e.shiftKey) {
          const next = new Set(current);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        }
        return new Set([id]);
      });
    }
  };

  const handleGroupDragDelta = useCallback((leaderId: string, dx: number, dy: number) => {
    if (!selectedNodeIds.has(leaderId)) return;
    const nodesMap = doc.getMap<NodeData>("nodes");

    // Yjs naturally batches these sets into a single transaction broadcast
    selectedNodeIds.forEach(id => {
      if (id === leaderId) return;
      const current = nodesMap.get(id);
      if (current) nodesMap.set(id, { ...current, x: current.x + dx, y: current.y + dy });
    });
  }, [doc, selectedNodeIds]);

  const updateNodePositionEnd = useCallback((id: string, newX: number, newY: number) => {
    const nodesMap = doc.getMap<NodeData>("nodes");
    const current = nodesMap.get(id);
    if (!current) return;
    nodesMap.set(id, { ...current, x: newX, y: newY });
  }, [doc]);

  const updateNodeSize = useCallback((id: string, newWidth: number, newHeight: number) => {
    const nodesMap = doc.getMap<NodeData>("nodes");
    const current = nodesMap.get(id);
    if (current) nodesMap.set(id, { ...current, width: newWidth, height: newHeight });
  }, [doc]);

  const selectedNodes = nodes.filter((node) => selectedNodeIds.has(node.id));
  const selectedNode = selectedNodes[0] ?? null;
  const selectedPaths = renderedPaths.filter((path) => selectedPathIds.has(path.id));
  const selectedPath = selectedPaths[0] ?? null;
  const strokeEditorMode: DrawToolMode | null = selectedPath
    ? selectedPath.toolType === "highlighter"
      ? "highlight"
      : "draw"
    : toolMode === "draw" || toolMode === "highlight"
      ? toolMode
      : null;
  const strokeEditorSettings = selectedPath
    ? {
        color: selectedPath.color || "#ffffff",
        opacity: selectedPath.opacity !== undefined ? selectedPath.opacity : 1,
        strokeWidth: selectedPath.strokeWidth || 4,
      }
    : strokeEditorMode
      ? getToolAppearance(strokeEditorMode)
      : null;
  const strokeWidthRange = strokeEditorMode === "highlight" ? { min: 8, max: 36, step: 1 } : { min: 1, max: 24, step: 1 };
  const previewAppearance = toolMode === "highlight" ? highlighterAppearance : penAppearance;
  const showStylePanel = selectedNodeIds.size > 0 || selectedPathIds.size > 0 || !!strokeEditorSettings;
  const showStrokeEditor = selectedPathIds.size > 0 || !!strokeEditorSettings;

  const sortedPaths = renderedPaths.slice().sort((a, b) => {
    if (a.toolType === 'highlighter' && b.toolType !== 'highlighter') return -1;
    if (a.toolType !== 'highlighter' && b.toolType === 'highlighter') return 1;
    return 0;
  });

  return (
    <div
      ref={canvasRef}
      className={`relative w-screen h-screen overflow-hidden ${getDynamicCursor()}`}
      onPointerMove={handlePointerMove}
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        backgroundColor: '#171717',
        backgroundImage: 'radial-gradient(#404040 1px, transparent 1px)',
        backgroundSize: `${24 * camera.zoom}px ${24 * camera.zoom}px`,
        backgroundPosition: `${camera.x}px ${camera.y}px`,
        overscrollBehavior: 'none',
        touchAction: showNameModal ? 'auto' : 'none',
      }}
    >
      <AnimatePresence>
        {showNameModal && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 z-[100] bg-black/60 backdrop-blur-md flex items-center justify-center p-4"
            onPointerDown={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }}
              className="bg-neutral-900 border border-neutral-800 p-8 rounded-3xl shadow-2xl max-w-sm w-full text-center"
            >
              <h2 className="text-2xl font-bold text-white mb-2">Welcome</h2>
              <p className="text-neutral-400 mb-8">What should we call you on this board?</p>
              <form onSubmit={submitName} className="flex flex-col gap-4">
                <input
                  type="text" autoFocus
                  value={nameInput} onChange={(e) => setNameInput(e.target.value)}
                  placeholder="Your name..."
                  className="w-full bg-neutral-950 border border-neutral-800 text-white rounded-xl px-4 py-3 outline-none focus:border-indigo-500 transition-colors placeholder:text-neutral-600"
                />
                <button type="submit" disabled={!nameInput.trim()} className="w-full py-3 bg-white text-black font-semibold rounded-xl hover:bg-neutral-200 active:scale-[0.98] transition-all disabled:opacity-50 disabled:active:scale-100">
                  Join Board
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showStylePanel && (
          <motion.div
            className="absolute top-20 right-4 bg-neutral-900 border border-neutral-800 p-4 rounded-xl shadow-xl z-50 pointer-events-auto w-64"
            initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}
            onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}
          >
            {selectedNodeIds.size > 0 && (
              <>
                <h3 className="text-xs font-bold text-neutral-500 uppercase tracking-wider mb-3">Node Styles</h3>
                <div className="flex flex-wrap gap-2 mb-4">
                  {swatches.map((color) => (
                    <button
                      key={`node-${color}`}
                      onClick={() => applyColor(color)}
                      className="w-6 h-6 rounded-full border border-white/20 transition-transform hover:scale-110"
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-neutral-400">Opacity</label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={selectedNode?.opacity ?? 1}
                    onChange={(e) => applyOpacity(parseFloat(e.target.value))}
                    className="w-full accent-indigo-500"
                  />
                </div>

                <div className="h-px bg-neutral-800 my-4" />
                <h3 className="text-xs font-bold text-neutral-500 uppercase tracking-wider mb-3">Frame</h3>
                <div className="flex flex-wrap gap-2 mb-4">
                  {borderSwatches.map((color) => (
                    <button
                      key={`border-${color}`}
                      onClick={() => applyBorderColor(color)}
                      className="w-6 h-6 rounded-full border border-white/20 transition-transform hover:scale-110"
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
                <div className="flex flex-col gap-1 mb-3">
                  <label className="text-xs text-neutral-400">
                    Border
                    <span className="ml-2 text-neutral-500">{Math.round(selectedNode?.borderWidth ?? 0)}px</span>
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="12"
                    step="0.5"
                    value={selectedNode?.borderWidth ?? 0}
                    onChange={(e) => applyBorderWidth(parseFloat(e.target.value))}
                    className="w-full accent-indigo-500"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-neutral-400">
                    Radius
                    <span className="ml-2 text-neutral-500">{Math.round(selectedNode?.borderRadius ?? 0)}px</span>
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="48"
                    step="1"
                    value={selectedNode?.borderRadius ?? 0}
                    onChange={(e) => applyBorderRadius(parseFloat(e.target.value))}
                    className="w-full accent-indigo-500"
                  />
                </div>
              </>
            )}

            {showStrokeEditor && strokeEditorSettings && (
              <>
                {selectedNodeIds.size > 0 && <div className="h-px bg-neutral-800 my-4" />}
                <h3 className="text-xs font-bold text-neutral-500 uppercase tracking-wider mb-3">
                  {selectedPathIds.size > 0 ? "Stroke" : strokeEditorMode === "highlight" ? "Highlighter" : "Pencil"}
                </h3>
                <div className="flex flex-wrap gap-2 mb-4">
                  {swatches.map((color) => (
                    <button
                      key={`stroke-${color}`}
                      onClick={() => applyColor(color)}
                      className="w-6 h-6 rounded-full border border-white/20 transition-transform hover:scale-110"
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
                <div className="flex flex-col gap-1 mb-3">
                  <label className="text-xs text-neutral-400">
                    Width
                    <span className="ml-2 text-neutral-500">{Math.round(strokeEditorSettings.strokeWidth)}px</span>
                  </label>
                  <input
                    type="range"
                    min={strokeWidthRange.min}
                    max={strokeWidthRange.max}
                    step={strokeWidthRange.step}
                    value={strokeEditorSettings.strokeWidth}
                    onChange={(e) => applyStrokeWidth(parseFloat(e.target.value))}
                    className="w-full accent-indigo-500"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-neutral-400">
                    Opacity
                    <span className="ml-2 text-neutral-500">{Math.round(strokeEditorSettings.opacity * 100)}%</span>
                  </label>
                  <input
                    type="range"
                    min="0.05"
                    max="1"
                    step="0.05"
                    value={strokeEditorSettings.opacity}
                    onChange={(e) => applyOpacity(parseFloat(e.target.value))}
                    className="w-full accent-indigo-500"
                  />
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="absolute top-4 right-4 z-50 flex items-center gap-3" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-1 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-sm px-1.5 py-1.5 rounded-full border border-neutral-200 dark:border-neutral-800 shadow-sm">
          <button
            onClick={() => {
              undoManager.stopCapturing();
              undoManager.undo();
            }}
            disabled={!historyState.canUndo}
            className="p-2 rounded-full text-neutral-500 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors"
            title="Undo"
          >
            <Undo2 size={16} />
          </button>
          <button
            onClick={() => undoManager.redo()}
            disabled={!historyState.canRedo}
            className="p-2 rounded-full text-neutral-500 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors"
            title="Redo"
          >
            <Redo2 size={16} />
          </button>
        </div>

        <button
          onClick={() => {
            navigator.clipboard.writeText(window.location.href);
            setHasCopied(true);
            setTimeout(() => setHasCopied(false), 2000);
          }}
          className="flex items-center gap-2 bg-white/80 dark:bg-neutral-900/80 hover:bg-neutral-100 dark:hover:bg-neutral-800 backdrop-blur-sm px-3 py-1.5 rounded-full border border-neutral-200 dark:border-neutral-800 shadow-sm transition-colors text-sm font-medium"
        >
          {hasCopied ? <Check size={14} className="text-green-500" /> : <Share size={14} className="text-neutral-500" />}
          <span className="text-neutral-700 dark:text-neutral-300">{hasCopied ? "Copied!" : "Share"}</span>
        </button>

        <CollaboratorsBar users={awarenessUsers} localClientId={providerInstance?.awareness.clientID} onJumpToUser={jumpToWorldPoint} />

        <div className="flex items-center gap-2 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-sm px-3 py-1.5 rounded-full border border-neutral-200 dark:border-neutral-800 shadow-sm">
          <div className={`w-2 h-2 rounded-full ${wsStatus === 'connected' ? 'bg-green-500' : wsStatus === 'connecting' ? 'bg-yellow-500 animate-pulse' : 'bg-red-500'}`} />
        </div>
      </div>

      <div className="absolute left-4 top-1/2 -translate-y-1/2 z-50 flex flex-col gap-2 p-2 bg-neutral-900/90 backdrop-blur-md border border-neutral-800 rounded-2xl shadow-xl" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
        <button onClick={() => setToolMode('select')} className={`p-3 rounded-xl transition-all ${toolMode === 'select' ? 'bg-white text-black shadow-sm' : 'text-neutral-400 hover:text-white hover:bg-neutral-800'}`}><MousePointer2 size={20} /></button>
        <button onClick={() => setToolMode('marquee')} className={`p-3 rounded-xl transition-all ${toolMode === 'marquee' ? 'bg-white text-black shadow-sm' : 'text-neutral-400 hover:text-white hover:bg-neutral-800'}`}><MarqueeToolbarIcon size={20} /></button>
        <button onClick={() => setToolMode('draw')} className={`p-3 rounded-xl transition-all ${toolMode === 'draw' ? 'bg-indigo-500 text-white shadow-sm' : 'text-neutral-400 hover:text-white hover:bg-neutral-800'}`}><Pencil size={20} /></button>
        <button onClick={() => setToolMode('highlight')} className={`p-3 rounded-xl transition-all ${toolMode === 'highlight' ? 'bg-amber-500 text-white shadow-sm' : 'text-neutral-400 hover:text-white hover:bg-neutral-800'}`}><Highlighter size={20} /></button>
        <button onClick={() => setToolMode('erase')} className={`p-3 rounded-xl transition-all ${toolMode === 'erase' ? 'bg-red-500 text-white shadow-sm' : 'text-neutral-400 hover:text-white hover:bg-neutral-800'}`}><Eraser size={20} /></button>
      </div>

      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-50 pointer-events-auto" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
        <div className="relative flex flex-col items-center">
          <AnimatePresence>
            {showAddMenu && (
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.95 }}
                className="absolute bottom-16 mb-2 bg-neutral-900 border border-neutral-800 p-2 rounded-2xl shadow-2xl flex gap-2"
              >
                <input type="file" ref={fileInputRef} onChange={handleImageUpload} accept="image/*" className="hidden" />
                {[
                  { type: 'text', icon: Type, label: 'Text', action: () => addNode('text') },
                  { type: 'sticky', icon: Square, label: 'Sticky', action: () => addNode('sticky') },
                  { type: 'rect', icon: Square, label: 'Rectangle', action: () => addNode('rect') },
                  { type: 'circle', icon: Circle, label: 'Circle', action: () => addNode('circle') },
                  { type: 'diamond', icon: DiamondToolbarIcon, label: 'Diamond', action: () => addNode('diamond') },
                  { type: 'image', icon: ImageIcon, label: 'Image', action: () => fileInputRef.current?.click() },
                ].map(({ type, icon: Icon, label, action }) => (
                  <button key={type} onClick={action} className="p-3 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-xl transition-colors flex flex-col items-center gap-1 min-w-[60px]">
                    <Icon size={20} />
                    <span className="text-[10px] uppercase font-bold tracking-wider">{label}</span>
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          <button onClick={() => setShowAddMenu(!showAddMenu)} className="flex items-center justify-center gap-2 text-sm font-medium bg-neutral-900 text-white py-3 px-6 rounded-full hover:scale-105 transition-transform active:scale-95 shadow-xl border border-neutral-800">
            <Plus size={16} className={showAddMenu ? 'rotate-45 transition-transform' : 'transition-transform'} />
            <span>Add Block</span>
          </button>
        </div>
      </div>

      <div className="absolute inset-0 z-10 w-full h-full origin-top-left" style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})` }}>

        {selectionStart && selectionCurrent && (
          <div
            className="absolute bg-indigo-500/10 border border-indigo-500 z-50 pointer-events-none"
            style={{
              left: Math.min(selectionStart.x, selectionCurrent.x),
              top: Math.min(selectionStart.y, selectionCurrent.y),
              width: Math.abs(selectionCurrent.x - selectionStart.x),
              height: Math.abs(selectionCurrent.y - selectionStart.y)
            }}
          />
        )}

        <svg className="absolute inset-0 z-0 pointer-events-none w-full h-full" style={{ overflow: 'visible' }} />

        {nodes.map((node) => {
          if (!node || typeof node.x !== 'number') return null;
          return (
            <NodeEditor
              key={node.id}
              node={node}
              doc={doc}
              isSelected={selectedNodeIds.has(node.id)}
              toolMode={toolMode}
              updateNodePositionEnd={updateNodePositionEnd}
              handleGroupDragDelta={handleGroupDragDelta}
              updateNodeSize={updateNodeSize}
              zoom={camera.zoom}
              onClick={(e) => {
                if (toolMode === 'select') {
                  e.stopPropagation();
                  if (!e.shiftKey && !selectedNodeIds.has(node.id)) {
                    setSelectedNodeIds(new Set([node.id]));
                  } else if (e.shiftKey) {
                    const next = new Set(selectedNodeIds);
                    if (next.has(node.id)) next.delete(node.id); else next.add(node.id);
                    setSelectedNodeIds(next);
                  }
                  setSelectedPathIds(new Set());
                }
              }}
            />
          );
        })}

        {edges.map((edge) => (
          <Xarrow
            key={edge.id}
            start={edge.source}
            end={edge.target}
            color="#6366f1"
            strokeWidth={2 / camera.zoom}
            path="smooth"
            curveness={0.4}
            zIndex={1}
          />
        ))}

        <svg className="absolute inset-0 z-[15] pointer-events-none w-full h-full" style={{ overflow: 'visible' }}>
          {sortedPaths.map((pathObj) => (
            <path
              key={`overlay-${pathObj.id}`}
              d={getSvgPathFromStroke(pathObj.points)}
              stroke={toolMode === 'erase' ? '#ef4444' : pathObj.color || '#ffffff'}
              strokeWidth={(pathObj.strokeWidth || 4) / camera.zoom}
              strokeOpacity={pathObj.opacity !== undefined ? pathObj.opacity : 1}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
              pointerEvents={(toolMode === 'erase' || toolMode === 'select') ? 'stroke' : 'none'}
              onPointerDown={(e) => handlePathInteraction(pathObj.id, e)}
              className={`${toolMode === 'erase' ? 'hover:stroke-red-500 cursor-crosshair' : ''} ${selectedPathIds.has(pathObj.id) && toolMode === 'select' ? 'filter drop-shadow-[0_0_8px_rgba(99,102,241,0.8)]' : ''}`}
            />
          ))}

          {currentPath && (
            <path
              d={getSvgPathFromStroke(currentPath)}
              stroke={previewAppearance.color}
              strokeWidth={previewAppearance.strokeWidth / camera.zoom}
              strokeOpacity={previewAppearance.opacity}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          )}
        </svg>

        {Array.from(awarenessUsers.entries()).map(([clientId, state]) => {
          if (!providerInstance || clientId === providerInstance.awareness.clientID) return null;
          if (!state.user || !state.cursor) return null;

          return (
            <div key={clientId} className="absolute z-50 transition-transform duration-100 ease-out" style={{ transform: `translate(${state.cursor.x}px, ${state.cursor.y}px)` }}>
              <Cursor color={state.user.color} name={state.user.name} x={0} y={0} zoom={camera.zoom} onClick={() => jumpToWorldPoint(state.cursor.x, state.cursor.y)} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
