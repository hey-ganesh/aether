"use client";

import React, { useMemo, useEffect, useState, useCallback, useRef } from "react";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { Plus, Share, Check, MousePointer2, Pencil, Eraser, Square, Circle, Triangle, Type, Highlighter, Image as ImageIcon } from "lucide-react";
import { animate, AnimatePresence, motion } from "framer-motion";
import Xarrow from "react-xarrows";
import NodeEditor from "@/components/NodeEditor";
import Cursor from "@/components/Cursor";
import CollaboratorsBar from "@/components/CollaboratorsBar";

const cursorColors = ['#fbbf24', '#f87171', '#60a5fa', '#34d399', '#a78bfa', '#f472b6', '#38bdf8'];
const swatches = ['#fbbf24', '#f87171', '#60a5fa', '#34d399', '#a78bfa', '#f472b6', '#38bdf8', '#ffffff', '#9ca3af', '#4b5563', '#1f2937', '#000000'];

interface NodeData {
  id: string;
  type?: 'text' | 'sticky' | 'rect' | 'circle' | 'diamond' | 'image';
  x: number;
  y: number;
  color?: string;
  opacity?: number;
  src?: string;
  width?: number;
}

interface EdgeData {
  id: string;
  source: string;
  target: string;
}

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

  const [nodes, setNodes] = useState<NodeData[]>([]);
  const [edges, setEdges] = useState<EdgeData[]>([]);
  const [renderedPaths, setRenderedPaths] = useState<any[]>([]);
  const [wsStatus, setWsStatus] = useState<string>("disconnected");
  const [hasCopied, setHasCopied] = useState(false);
  
  const [userName, setUserName] = useState<string | null>(null);
  const [showNameModal, setShowNameModal] = useState(false);
  const [nameInput, setNameInput] = useState("");
  
  const [providerInstance, setProviderInstance] = useState<WebsocketProvider | null>(null);
  const [awarenessUsers, setAwarenessUsers] = useState<Map<number, any>>(new Map());

  const [toolMode, setToolMode] = useState<"select" | "draw" | "highlight" | "erase">("select");
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPath, setCurrentPath] = useState<[number, number][] | null>(null);

  // Marquee State
  const [selectionStart, setSelectionStart] = useState<{x: number, y: number} | null>(null);
  const [selectionCurrent, setSelectionCurrent] = useState<{x: number, y: number} | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
  const [selectedPathId, setSelectedPathId] = useState<string | null>(null);
  
  // Toolbar state
  const [showAddMenu, setShowAddMenu] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [camera, setCamera] = useState({ x: 0, y: 0, zoom: 1 });
  const [connectingNode, setConnectingNode] = useState<string | null>(null);
  const isDraggingCanvas = useRef(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [isSpaceDown, setIsSpaceDown] = useState(false);

  useEffect(() => {
    const provider = new WebsocketProvider("ws://localhost:1234", boardId, doc);
    setProviderInstance(provider);

    const localName = localStorage.getItem("milanote_username");
    if (localName) {
      const color = cursorColors[Math.floor(Math.random() * cursorColors.length)];
      provider.awareness.setLocalStateField("user", { name: localName, color });
      setUserName(localName);
    } else {
      setShowNameModal(true);
    }

    provider.awareness.on("change", () => setAwarenessUsers(new Map(provider.awareness.getStates())));
    provider.on("status", (event: { status: string }) => setWsStatus(event.status));

    const nodesMap = doc.getMap<NodeData>("nodes");
    const edgesMap = doc.getMap<EdgeData>("edges");
    const pathsArray = doc.getArray<Y.Map<any>>("shared_paths");

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

    const syncPaths = () => setRenderedPaths(pathsArray.toJSON());

    syncNodes(); syncEdges(); syncPaths();

    nodesMap.observe(syncNodes);
    edgesMap.observe(syncEdges);
    pathsArray.observe(syncPaths);

    return () => {
      nodesMap.unobserve(syncNodes); edgesMap.unobserve(syncEdges); pathsArray.unobserve(syncPaths);
      provider.destroy();
    };
  }, [doc, boardId]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => { if (e.code === 'Space' && e.target === document.body) setIsSpaceDown(true); };
    const handleKeyUp = (e: KeyboardEvent) => { if (e.code === 'Space') setIsSpaceDown(false); };
    window.addEventListener('keydown', handleKeyDown); window.addEventListener('keyup', handleKeyUp);
    return () => { window.removeEventListener('keydown', handleKeyDown); window.removeEventListener('keyup', handleKeyUp); };
  }, []);

  useEffect(() => {
    const canvasElement = canvasRef.current;
    if (!canvasElement) return;
    const preventDefaultZoom = (e: WheelEvent) => { if (e.ctrlKey || e.metaKey) e.preventDefault(); };
    canvasElement.addEventListener("wheel", preventDefaultZoom, { passive: false });
    return () => canvasElement.removeEventListener("wheel", preventDefaultZoom);
  }, []);

  const submitName = (e: React.FormEvent) => {
    e.preventDefault();
    if (nameInput.trim()) {
      const name = nameInput.trim();
      localStorage.setItem("milanote_username", name);
      setUserName(name);
      setShowNameModal(false);
      if (providerInstance) {
        const color = cursorColors[Math.floor(Math.random() * cursorColors.length)];
        providerInstance.awareness.setLocalStateField("user", { name, color });
      }
    }
  };

  const addNode = useCallback((type: 'text' | 'sticky' | 'rect' | 'circle' | 'diamond' | 'image') => {
    const nodesMap = doc.getMap<NodeData>("nodes");
    const id = Math.random().toString(36).substring(2, 9);
    const worldX = (window.innerWidth / 2 - camera.x) / camera.zoom;
    const worldY = (window.innerHeight / 2 - camera.y) / camera.zoom;
    
    nodesMap.set(id, { id, type, x: worldX - 150, y: worldY - 100 });
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
      nodesMap.set(id, { id, type: 'image', src: ev.target?.result as string, width: 300, x: worldX - 150, y: worldY - 150 });
      setShowAddMenu(false);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const applyStyle = (key: 'color' | 'opacity', value: string | number) => {
    if (selectedPathId) {
      const pathsArray = doc.getArray<Y.Map<any>>("shared_paths");
      pathsArray.forEach(map => {
        if (map.get('id') === selectedPathId) {
           map.set(key, value);
        }
      });
    } else if (selectedNodeIds.size > 0) {
      const nodesMap = doc.getMap<NodeData>("nodes");
      selectedNodeIds.forEach(id => {
         const current = nodesMap.get(id);
         if (current) nodesMap.set(id, { ...current, [key]: value });
      });
    }
  };

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (showNameModal) return;

    const worldX = (e.clientX - camera.x) / camera.zoom;
    const worldY = (e.clientY - camera.y) / camera.zoom;

    if ((toolMode === 'draw' || toolMode === 'highlight') && e.button === 0 && !isSpaceDown) {
      e.currentTarget.setPointerCapture(e.pointerId);
      setIsDrawing(true);
      setCurrentPath([[worldX, worldY]]);
    } else if (toolMode === 'select' && e.button === 0 && !isSpaceDown) {
      if (e.target !== e.currentTarget) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      setSelectedNodeIds(new Set()); 
      setSelectedPathId(null);
      setSelectionStart({ x: worldX, y: worldY });
      setSelectionCurrent({ x: worldX, y: worldY });
    } else if (e.button === 1 || (e.button === 0 && isSpaceDown) || toolMode === 'erase') {
      if (toolMode !== 'erase') {
        isDraggingCanvas.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
      }
    }
  }, [isSpaceDown, toolMode, camera, showNameModal]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const worldX = (e.clientX - camera.x) / camera.zoom;
    const worldY = (e.clientY - camera.y) / camera.zoom;

    if (providerInstance) {
      providerInstance.awareness.setLocalStateField("cursor", { x: worldX, y: worldY });
    }

    if (isDrawing && currentPath) {
      setCurrentPath(prev => prev ? [...prev, [worldX, worldY]] : null);
    } else if (selectionStart && toolMode === 'select') {
      setSelectionCurrent({ x: worldX, y: worldY });
    } else if (isDraggingCanvas.current) {
      setCamera((cam) => ({ ...cam, x: cam.x + e.movementX, y: cam.y + e.movementY }));
    }
  }, [providerInstance, camera, isDrawing, currentPath, selectionStart, toolMode]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (isDrawing && currentPath) {
      setIsDrawing(false);
      if (currentPath.length > 2) {
        const pathsArray = doc.getArray<Y.Map<any>>("shared_paths");
        const yMap = new Y.Map();
        yMap.set('id', crypto.randomUUID());
        const userState = providerInstance?.awareness.getLocalState()?.user;
        const defaultColor = userState?.color || '#ffffff';
        yMap.set('color', toolMode === 'highlight' ? '#fbbf24' : defaultColor);
        yMap.set('toolType', toolMode === 'highlight' ? 'highlighter' : 'pen');
        yMap.set('opacity', toolMode === 'highlight' ? 0.4 : 1);
        yMap.set('strokeWidth', toolMode === 'highlight' ? 20 : 4);
        yMap.set('points', currentPath);
        pathsArray.push([yMap]);
      }
      setCurrentPath(null);
    } else if (selectionStart && selectionCurrent) {
      const left = Math.min(selectionStart.x, selectionCurrent.x);
      const right = Math.max(selectionStart.x, selectionCurrent.x);
      const top = Math.min(selectionStart.y, selectionCurrent.y);
      const bottom = Math.max(selectionStart.y, selectionCurrent.y);

      const activeSet = new Set<string>();
      nodes.forEach(n => {
        const nodeWidth = n.width || 300; 
        const nodeHeight = n.type === 'sticky' ? 240 : 150;
        if (n.x < right && n.x + nodeWidth > left && n.y < bottom && n.y + nodeHeight > top) {
          activeSet.add(n.id);
        }
      });
      setSelectedNodeIds(activeSet);
      setSelectionStart(null);
      setSelectionCurrent(null);
    }
    
    isDraggingCanvas.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }, [isDrawing, currentPath, doc, providerInstance, selectionStart, selectionCurrent, nodes, toolMode]);

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
    if (toolMode === 'draw') return "cursor-[url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"white\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M12 20h9\"/><path d=\"M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z\"/></svg>'),_auto]";
    if (toolMode === 'highlight') return "cursor-[url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"%23fbbf24\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"m9 11-6 6v3h9l3-3\"/><path d=\"m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4\"/></svg>'),_auto]";
    if (toolMode === 'erase') return "cursor-[url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"red\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21\"/><path d=\"M22 21H7\"/><path d=\"m5 11 9 9\"/></svg>'),_auto]";
    return 'cursor-default';
  };

  const handlePathInteraction = (id: string, e: React.PointerEvent) => {
    e.stopPropagation();
    if (toolMode === 'erase') {
      const pathsArray = doc.getArray<Y.Map<any>>("shared_paths");
      let targetIndex = -1;
      pathsArray.forEach((map, idx) => { if (map.get('id') === id) targetIndex = idx; });
      if (targetIndex !== -1) pathsArray.delete(targetIndex);
    } else if (toolMode === 'select') {
      setSelectedPathId(id);
      setSelectedNodeIds(new Set());
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

  const updateNodeSize = useCallback((id: string, newWidth: number) => {
    const nodesMap = doc.getMap<NodeData>("nodes");
    const current = nodesMap.get(id);
    if (current) nodesMap.set(id, { ...current, width: newWidth });
  }, [doc]);

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
      style={{
        backgroundColor: '#171717',
        backgroundImage: 'radial-gradient(#404040 1px, transparent 1px)',
        backgroundSize: `${24 * camera.zoom}px ${24 * camera.zoom}px`,
        backgroundPosition: `${camera.x}px ${camera.y}px`,
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
        {(selectedNodeIds.size > 0 || selectedPathId) && (
          <motion.div 
            className="absolute top-20 right-4 bg-neutral-900 border border-neutral-800 p-4 rounded-xl shadow-xl z-50 pointer-events-auto w-64"
            initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}
            onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}
          >
            <h3 className="text-xs font-bold text-neutral-500 uppercase tracking-wider mb-3">Styles</h3>
            <div className="flex flex-wrap gap-2 mb-4">
              {swatches.map(c => (
                <button
                  key={c} onClick={() => applyStyle('color', c)}
                  className="w-6 h-6 rounded-full border border-white/20 transition-transform hover:scale-110"
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-neutral-400">Opacity</label>
              <input 
                 type="range" min="0" max="1" step="0.1" defaultValue="1"
                 onChange={(e) => applyStyle('opacity', parseFloat(e.target.value))}
                 className="w-full accent-indigo-500"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="absolute top-4 right-4 z-50 flex items-center gap-3" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
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

        <CollaboratorsBar users={awarenessUsers} localClientId={providerInstance?.awareness.clientID} onJumpToUser={(x,y) => {}} />
        
        <div className="flex items-center gap-2 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-sm px-3 py-1.5 rounded-full border border-neutral-200 dark:border-neutral-800 shadow-sm">
          <div className={`w-2 h-2 rounded-full ${wsStatus === 'connected' ? 'bg-green-500' : wsStatus === 'connecting' ? 'bg-yellow-500 animate-pulse' : 'bg-red-500'}`} />
        </div>
      </div>

      <div className="absolute left-4 top-1/2 -translate-y-1/2 z-50 flex flex-col gap-2 p-2 bg-neutral-900/90 backdrop-blur-md border border-neutral-800 rounded-2xl shadow-xl" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
        <button onClick={() => setToolMode('select')} className={`p-3 rounded-xl transition-all ${toolMode === 'select' ? 'bg-white text-black shadow-sm' : 'text-neutral-400 hover:text-white hover:bg-neutral-800'}`}><MousePointer2 size={20} /></button>
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
                  { type: 'diamond', icon: Triangle, label: 'Diamond', action: () => addNode('diamond') },
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

        <svg className="absolute inset-0 z-0 pointer-events-none w-full h-full" style={{ overflow: 'visible' }}>
          {sortedPaths.map((pathObj) => (
            <path
              key={pathObj.id}
              d={getSvgPathFromStroke(pathObj.points)}
              stroke={toolMode === 'erase' ? '#ef4444' : pathObj.color || '#ffffff'}
              strokeWidth={(pathObj.strokeWidth || 4) / camera.zoom}
              strokeOpacity={pathObj.opacity !== undefined ? pathObj.opacity : 1}
              strokeLinecap="round" strokeLinejoin="round" fill="none"
              pointerEvents={(toolMode === 'erase' || toolMode === 'select') ? 'stroke' : 'none'}
              onPointerDown={(e) => handlePathInteraction(pathObj.id, e)}
              className={`${toolMode === 'erase' ? 'hover:stroke-red-500 cursor-crosshair' : ''} ${selectedPathId === pathObj.id && toolMode === 'select' ? 'filter drop-shadow-[0_0_8px_rgba(99,102,241,0.8)]' : ''}`}
            />
          ))}

          {currentPath && (
            <path
              d={getSvgPathFromStroke(currentPath)}
              stroke={providerInstance?.awareness.getLocalState()?.user?.color || '#ffffff'}
              strokeWidth={(toolMode === 'highlight' ? 20 : 4) / camera.zoom}
              strokeOpacity={toolMode === 'highlight' ? 0.4 : 1}
              strokeLinecap="round" strokeLinejoin="round" fill="none"
            />
          )}
        </svg>

        {nodes.map((node) => {
          if (!node || typeof node.x !== 'number') return null;
          return (
            <NodeEditor 
              key={node.id} 
              node={node} 
              doc={doc}
              isSelected={selectedNodeIds.has(node.id)}
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
                    setSelectedPathId(null);
                 }
              }}
            />
          );
        })}

        {Array.from(awarenessUsers.entries()).map(([clientId, state]) => {
          if (!providerInstance || clientId === providerInstance.awareness.clientID) return null;
          if (!state.user || !state.cursor) return null;

          return (
             <div key={clientId} className="absolute pointer-events-none z-50 transition-transform duration-100 ease-out" style={{ transform: `translate(${state.cursor.x}px, ${state.cursor.y}px)` }}>
                <Cursor color={state.user.color} name={state.user.name} x={0} y={0} zoom={camera.zoom} onClick={() => {}} />
             </div>
          );
        })}
      </div>
    </div>
  );
}
