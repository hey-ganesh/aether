"use client";

import React, { useCallback, useEffect } from "react";
import * as Y from "yjs";
import { motion, PanInfo, useDragControls } from "framer-motion";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import Image from "@tiptap/extension-image";
import { GripHorizontal, X } from "lucide-react";

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

interface NodeEditorProps {
  node: NodeData;
  doc: Y.Doc;
  isSelected?: boolean;
  toolMode?: "select" | "marquee" | "draw" | "highlight" | "erase";
  handleGroupDragDelta?: (leaderId: string, dx: number, dy: number) => void;
  updateNodePositionEnd?: (id: string, newX: number, newY: number) => void;
  updateNodeSize?: (id: string, newWidth: number, newHeight: number) => void;
  zoom?: number;
  onClick?: (e: React.MouseEvent) => void;
}

const CustomImage = Image.extend({
  addAttributes() {
    return { ...this.parent?.(), src: { default: null } };
  },
});

const getContrastTextColor = (value?: string) => {
  if (!value || !value.startsWith("#")) return "#111827";

  const normalized = value.length === 4
    ? `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`
    : value;

  if (normalized.length !== 7) return "#111827";

  const red = parseInt(normalized.slice(1, 3), 16);
  const green = parseInt(normalized.slice(3, 5), 16);
  const blue = parseInt(normalized.slice(5, 7), 16);
  const luminance = (red * 0.299 + green * 0.587 + blue * 0.114) / 255;

  return luminance > 0.62 ? "#111827" : "#f8fafc";
};

export default function NodeEditor({
  node, doc, isSelected, toolMode = "select", handleGroupDragDelta, updateNodePositionEnd, updateNodeSize, zoom = 1, onClick
}: NodeEditorProps) {
  const controls = useDragControls();
  const type = node?.type || 'text';
  const isCanvasSelectable = toolMode === "select";
  const defaultWidth = type === "text" ? 340 : type === "sticky" ? 260 : type === "circle" ? 260 : type === "diamond" ? 280 : type === "image" ? 300 : 320;
  const defaultHeight = type === "text" ? 140 : type === "sticky" ? 240 : type === "circle" ? 260 : type === "diamond" ? 240 : type === "image" ? 300 : 220;
  const width = node.width || defaultWidth;
  const height = node.height || defaultHeight;
  const borderRadius = node.borderRadius ?? (type === "sticky" ? 18 : type === "text" ? 20 : 24);
  const borderWidth = node.borderWidth ?? (type === "text" ? 1.5 : 2);
  const borderColor = node.borderColor || (type === "sticky" ? "#f59e0b" : "#94a3b8");
  const fillColor = node.color || (type === "sticky" ? "#fef3c7" : type === "text" ? "#ffffff" : "rgba(255,255,255,0.7)");
  const hasVisibleFrame = type === "text" ? !node.color && borderWidth > 0 : borderWidth > 0;
  const contentTextColor = getContrastTextColor(node.color || (type === "sticky" ? fillColor : undefined));

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        // @ts-ignore
        history: false,
      }),
      Collaboration.configure({
        document: doc,
        field: node.id,
      }),
      CustomImage.configure({
        inline: true,
        HTMLAttributes: { class: 'max-w-full rounded-md shadow-sm my-2' }
      })
    ],
      editorProps: {
      attributes: {
        class: `focus:outline-none w-full h-full ${type !== 'text' ? 'text-center flex flex-col justify-center' : ''}`,
      },
      handleDrop: (view, event, slice, moved) => {
        if (!moved && event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0]) {
          let file = event.dataTransfer.files[0];
          if (!file.type.startsWith('image/')) return false;

          if (file.size > 500 * 1024) {
            window.alert("Image exceeds 500KB limit! Please compress to preserve synchronized workspace performance.");
            return true;
          }

          let reader = new FileReader();
          reader.onload = (e) => {
            const schema = view.state.schema;
            const imgNode = schema.nodes.image.create({ src: e.target?.result as string });
            const transaction = view.state.tr.replaceSelectionWith(imgNode);
            view.dispatch(transaction);
          };
          reader.readAsDataURL(file);
          return true;
        }
        return false;
      }
    },
  });

  useEffect(() => {
    editor?.setEditable(isCanvasSelectable);
  }, [editor, isCanvasSelectable]);

  const handleDrag = useCallback(
    (event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
      if (!isCanvasSelectable) return;
      if (handleGroupDragDelta) {
        // Delta is emitted in screen-space, so divide by zoom to map to World bounds linearly
        handleGroupDragDelta(node.id, info.delta.x / zoom, info.delta.y / zoom);
      }
    },
    [handleGroupDragDelta, isCanvasSelectable, node.id, zoom]
  );

  const handleDragEnd = useCallback(
    (event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
      if (!isCanvasSelectable) return;
      if (updateNodePositionEnd) {
        // info.offset is total net drag in screen-space
        updateNodePositionEnd(node.id, node.x + (info.offset.x / zoom), node.y + (info.offset.y / zoom));
      }
    },
    [isCanvasSelectable, node.id, node.x, node.y, updateNodePositionEnd, zoom]
  );

  const deleteNode = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    const nodesMap = doc.getMap<NodeData>("nodes");
    nodesMap.delete(node.id);
  }, [doc, node.id]);

  const startResize = (e: React.PointerEvent) => {
    if (!isCanvasSelectable) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = width;
    const startH = height;

    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.cancelable) {
        moveEvent.preventDefault();
      }
      const deltaScreen = moveEvent.clientX - startX;
      const deltaScreenY = moveEvent.clientY - startY;
      // Calculate delta mapped to canvas world coordinates
      const deltaWorld = deltaScreen / zoom;
      const deltaWorldY = deltaScreenY / zoom;
      const newW = Math.max(120, Math.min(startW + deltaWorld, 2400));
      const newH = Math.max(type === "text" ? 100 : 120, Math.min(startH + deltaWorldY, 2000));
      updateNodeSize?.(node.id, newW, newH);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const dynamicStyle: React.CSSProperties = {
    zIndex: isSelected ? 50 : 10,
    opacity: node.opacity !== undefined ? node.opacity : 1,
    width,
    height,
    minHeight: type === 'text' ? 100 : undefined,
    pointerEvents: isCanvasSelectable ? "auto" : "none",
  };

  const frameShadow = type === "sticky"
    ? "0 22px 46px rgba(245, 158, 11, 0.16)"
    : type === "image"
      ? "0 24px 48px rgba(15, 23, 42, 0.24)"
      : "0 20px 40px rgba(15, 23, 42, 0.14)";

  const frameStyle: React.CSSProperties = {
    borderRadius: type === "circle" ? 9999 : borderRadius,
    border: hasVisibleFrame ? `${borderWidth}px solid ${borderColor}` : "1px solid transparent",
    boxShadow: frameShadow,
    backgroundColor: fillColor,
  };

  const selectionRing = isSelected ? "ring-4 ring-indigo-500/80 ring-offset-2 dark:ring-offset-neutral-950" : "";
  const chromeVisible = isCanvasSelectable && (isSelected || type !== "text");
  const sharedSurfaceClass = "absolute inset-0 overflow-hidden backdrop-blur-sm";

  if (type === 'image') {
    return (
      <motion.div
        className={`absolute top-0 left-0 flex flex-col group/node ${selectionRing}`}
        initial={{ x: node.x, y: node.y }} animate={{ x: node.x, y: node.y }}
        drag dragControls={controls} dragListener={false} dragMomentum={false}
        onDrag={handleDrag} onDragEnd={handleDragEnd} onClick={onClick}
        onPointerDown={(e) => onClick?.(e as any)}
        style={{ ...dynamicStyle, minHeight: 'auto', backgroundColor: 'transparent' }}
      >
        <div
          className="relative w-full h-full flex items-center justify-center touch-none select-none"
          onPointerDown={(e) => {
            if (!isCanvasSelectable) return;
            e.stopPropagation();
            controls.start(e);
          }}
        >
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              borderRadius: borderRadius + 2,
              boxShadow: frameShadow,
              border: borderWidth > 0 ? `${borderWidth}px solid ${borderColor}` : "1px solid rgba(255,255,255,0.16)",
              background: "linear-gradient(180deg, rgba(255,255,255,0.1), rgba(15,23,42,0.08))",
            }}
          />
          <img
            src={node.src}
            alt="User inserted"
            className="w-full h-full object-contain pointer-events-none"
            style={{
              opacity: node.opacity !== undefined ? node.opacity : 1,
              borderRadius,
              backgroundColor: "rgba(23, 23, 23, 0.18)",
            }}
          />
        </div>

        <button
          onClick={deleteNode}
          className="absolute top-2 right-2 opacity-0 group-hover/node:opacity-100 bg-black/70 text-white rounded-full p-1.5 z-50 pointer-events-auto transition-opacity shadow-sm hover:scale-105 active:scale-95"
        >
          <X size={14} />
        </button>

        <div
          className="absolute bottom-2 right-2 w-5 h-5 bg-black/60 backdrop-blur border border-white/20 rounded-2xl opacity-0 group-hover/node:opacity-100 cursor-se-resize z-50 pointer-events-auto transition-opacity touch-none"
          onPointerDown={startResize}
        />
      </motion.div>
    );
  }

  const renderFrame = () => {
    if (type === "rect") {
      return <div className={sharedSurfaceClass} style={frameStyle} />;
    }

    if (type === "circle") {
      return <div className={sharedSurfaceClass} style={{ ...frameStyle, borderRadius: 9999 }} />;
    }

    if (type === "diamond") {
      return (
        <svg className="absolute inset-0 w-full h-full overflow-visible pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
          <defs>
            <filter id={`diamond-shadow-${node.id}`} x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="18" stdDeviation="14" floodColor="rgba(15,23,42,0.2)" />
            </filter>
          </defs>
          <polygon
            points="50,1.5 98.5,50 50,98.5 1.5,50"
            fill={fillColor}
            stroke={hasVisibleFrame ? borderColor : "transparent"}
            strokeWidth={borderWidth}
            filter={`url(#diamond-shadow-${node.id})`}
          />
        </svg>
      );
    }

    if (type === "sticky") {
      return (
        <div
          className={`${sharedSurfaceClass} before:absolute before:top-0 before:right-0 before:h-14 before:w-14 before:bg-black/5 before:rounded-bl-3xl`}
          style={{
            ...frameStyle,
            borderRadius,
            background: `linear-gradient(180deg, rgba(255,255,255,0.22), rgba(15,23,42,0.05)), ${fillColor}`,
          }}
        />
      );
    }

    return (
      <div
        className={sharedSurfaceClass}
        style={{
          ...frameStyle,
          backgroundColor: fillColor,
        }}
      />
    );
  };

  const chromeTextColor = node.color ? "text-black/55" : "text-neutral-400";
  const shapeContentClass = type === "text"
    ? "absolute inset-x-0 bottom-0 top-11"
    : type === "diamond"
      ? "absolute left-[18%] top-[18%] h-[64%] w-[64%]"
      : "absolute inset-0";
  const contentPadding = type === "sticky" ? "px-5 py-6" : type === "text" ? "px-5 py-4" : "px-5 py-8";
  const editorWrapClass = type === "text" || type === "sticky"
    ? "h-full w-full overflow-hidden"
    : "h-full w-full overflow-hidden flex items-center justify-center text-center";

  return (
    <motion.div
      className={`absolute top-0 left-0 flex flex-col group/node ${selectionRing}`}
      initial={{ x: node.x, y: node.y }}
      animate={{ x: node.x, y: node.y }}
      drag
      dragControls={controls}
      dragListener={false}
      dragMomentum={false}
      onDrag={handleDrag}
      onDragEnd={handleDragEnd}
      onClick={onClick}
      onPointerDown={(e) => onClick?.(e as any)}
      style={dynamicStyle}
    >
      {renderFrame()}

      {type === 'text' ? (
        <div
          className="relative z-10 flex items-center justify-between px-3 py-2 shrink-0"
          style={node.color ? { backgroundColor: "rgba(15,23,42,0.05)", borderRadius: borderRadius, borderBottom: "1px solid rgba(15,23,42,0.06)" } : { borderBottom: "1px solid rgba(148,163,184,0.18)", borderTopLeftRadius: borderRadius, borderTopRightRadius: borderRadius }}
        >
          <div
            className="flex-1 cursor-grab active:cursor-grabbing hover:bg-black/5 dark:hover:bg-white/5 rounded-full py-1 flex items-center justify-center transition-colors touch-none select-none"
            onPointerDown={(e) => {
              if (!isCanvasSelectable) return;
              e.stopPropagation();
              controls.start(e);
            }}
          >
            <GripHorizontal size={14} className={chromeTextColor} />
          </div>
          <button
            onClick={deleteNode}
            className="ml-2 hover:bg-black/10 dark:hover:bg-white/10 p-1 rounded-full transition-colors pointer-events-auto"
          >
            <X size={14} className={node.color ? 'text-black/50 hover:text-black/80' : 'text-neutral-400'} />
          </button>
        </div>
      ) : (
        <div className="absolute top-0 inset-x-0 h-10 overflow-visible flex items-start justify-center pt-2 z-20">
          <div
            className={`w-24 h-5 cursor-grab active:cursor-grabbing rounded-full ${chromeVisible ? "opacity-100" : "opacity-0 group-hover/node:opacity-100"} bg-black/10 dark:bg-white/10 flex items-center justify-center transition-opacity backdrop-blur-sm touch-none select-none`}
            onPointerDown={(e) => {
              if (!isCanvasSelectable) return;
              e.stopPropagation();
              controls.start(e);
            }}
          >
            <GripHorizontal size={12} className="text-neutral-500" />
          </div>
          <button
            onClick={deleteNode}
            className={`absolute top-2 right-2 ${chromeVisible ? "opacity-100" : "opacity-0 group-hover/node:opacity-100"} bg-black/70 text-white rounded-full p-1 pointer-events-auto shadow-sm transition-opacity`}
          >
            <X size={12} />
          </button>
        </div>
      )}

      {(isSelected || type !== "text") && (
        <div
          className={`absolute bottom-2 right-2 w-5 h-5 bg-black/60 backdrop-blur border border-white/20 rounded-2xl ${chromeVisible ? "opacity-100" : "opacity-0 group-hover/node:opacity-100"} cursor-se-resize z-50 pointer-events-auto touch-none transition-opacity`}
          onPointerDown={startResize}
        />
      )}

      <div className={`${shapeContentClass} z-10`}>
        <div className={`h-full w-full overflow-hidden ${contentPadding}`} style={{ color: contentTextColor }}>
          <EditorContent editor={editor} className={editorWrapClass} />
        </div>
      </div>
    </motion.div>
  );
}
