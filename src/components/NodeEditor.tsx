"use client";

import React, { useCallback, useState } from "react";
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
}

interface NodeEditorProps {
  node: NodeData;
  doc: Y.Doc;
  isSelected?: boolean;
  handleGroupDragDelta?: (leaderId: string, dx: number, dy: number) => void;
  updateNodePositionEnd?: (id: string, newX: number, newY: number) => void;
  updateNodeSize?: (id: string, newWidth: number) => void;
  zoom?: number;
  onClick?: (e: React.MouseEvent) => void;
}

const CustomImage = Image.extend({
  addAttributes() {
    return { ...this.parent?.(), src: { default: null } };
  },
});

export default function NodeEditor({ 
  node, doc, isSelected, handleGroupDragDelta, updateNodePositionEnd, updateNodeSize, zoom = 1, onClick 
}: NodeEditorProps) {
  const controls = useDragControls();
  const type = node?.type || 'text';

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
        class: `focus:outline-none w-full h-full text-neutral-900 dark:text-neutral-100 ${type !== 'text' ? 'text-center flex flex-col justify-center' : ''}`,
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

  const handleDrag = useCallback(
    (event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
      if (handleGroupDragDelta) {
        // Delta is emitted in screen-space, so divide by zoom to map to World bounds linearly
        handleGroupDragDelta(node.id, info.delta.x / zoom, info.delta.y / zoom);
      }
    },
    [node.id, zoom, handleGroupDragDelta]
  );

  const handleDragEnd = useCallback(
    (event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
      if (updateNodePositionEnd) {
        // info.offset is total net drag in screen-space
        updateNodePositionEnd(node.id, node.x + (info.offset.x / zoom), node.y + (info.offset.y / zoom));
      }
    },
    [node.id, node.x, node.y, zoom, updateNodePositionEnd]
  );

  const deleteNode = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    const nodesMap = doc.getMap<NodeData>("nodes");
    nodesMap.delete(node.id);
  }, [doc, node.id]);

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = node.width || 300;
    
    const onMove = (moveEvent: PointerEvent) => {
      const deltaScreen = moveEvent.clientX - startX;
      // Calculate delta mapped to canvas world coordinates
      const deltaWorld = deltaScreen / zoom;
      const newW = Math.max(100, Math.min(startW + deltaWorld, 2000));
      updateNodeSize?.(node.id, newW);
    };
    
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };


  let designClasses = "bg-white dark:bg-neutral-900 rounded-xl shadow-lg border border-neutral-200 dark:border-neutral-800";
  let contentPadding = "p-4";
  
  // Custom overriding from generic style-bar
  const dynamicStyle: React.CSSProperties = {
    zIndex: isSelected ? 50 : 10,
    opacity: node.opacity !== undefined ? node.opacity : 1,
    width: node.width || 300,
    minHeight: type === 'text' ? 100 : undefined,
    height: type === 'sticky' ? 240 : (['rect', 'circle', 'diamond'].includes(type) ? (node.width || 300) : 'auto'),
  };

  if (node.color) {
     dynamicStyle.backgroundColor = node.color;
  }

  if (type === 'sticky') {
    designClasses = "text-neutral-900 shadow-xl rounded-none border border-black/10";
    if (!node.color) dynamicStyle.backgroundColor = '#fef3c7'; // default yellow
    contentPadding = "p-6";
  } else if (['rect', 'circle', 'diamond'].includes(type)) {
    designClasses = "bg-transparent"; 
    contentPadding = "p-4 pt-8"; 
  }

  if (type === 'image') {
    return (
      <motion.div
        className={`absolute top-0 left-0 flex flex-col group/image ${isSelected ? 'ring-4 ring-indigo-500 ring-offset-2 dark:ring-offset-neutral-900' : ''}`}
        initial={{ x: node.x, y: node.y }} animate={{ x: node.x, y: node.y }}
        drag dragControls={controls} dragListener={false} dragMomentum={false}
        onDrag={handleDrag} onDragEnd={handleDragEnd} onClick={onClick}
        onPointerDown={(e) => onClick?.(e as any)}
        style={{ ...dynamicStyle, minHeight: 'auto', backgroundColor: 'transparent' }}
      >
        <div 
          className="relative w-full h-full flex items-center justify-center cursor-grab active:cursor-grabbing p-2"
          onPointerDown={(e) => { e.stopPropagation(); controls.start(e); }}
        >
           <img 
             src={node.src} 
             alt="User inserted" 
             className="w-full h-auto object-contain rounded shadow-lg pointer-events-none"
             style={{ opacity: node.opacity !== undefined ? node.opacity : 1 }} 
           />
        </div>

        <button onClick={deleteNode} className="absolute top-0 right-0 opacity-0 group-hover/image:opacity-100 bg-red-500 text-white rounded-full p-1 m-1 z-50 pointer-events-auto transition-opacity shadow-sm hover:scale-105 active:scale-95">
           <X size={14} />
        </button>

        <div 
           className="absolute bottom-1 right-1 w-5 h-5 bg-black/50 backdrop-blur border border-white/20 rounded-tl-lg rounded-br opacity-0 group-hover/image:opacity-100 cursor-se-resize z-50 pointer-events-auto transition-opacity"
           onPointerDown={startResize}
        />
      </motion.div>
    );
  }

  const renderShapeBackground = () => {
    if (type === 'rect') {
      return <div className="absolute inset-0 bg-white/50 dark:bg-neutral-900/50 backdrop-blur-md border-[3px] border-blue-500 rounded-xl pointer-events-none -z-10 shadow-lg" />;
    }
    if (type === 'circle') {
      return <div className="absolute inset-0 bg-white/50 dark:bg-neutral-900/50 backdrop-blur-md border-[3px] border-emerald-500 rounded-full pointer-events-none -z-10 shadow-lg" />;
    }
    if (type === 'diamond') {
      return (
        <svg className="absolute inset-0 w-full h-full overflow-visible pointer-events-none -z-10 drop-shadow-lg" viewBox="0 0 100 100" preserveAspectRatio="none">
          <polygon points="50,2 98,50 50,98 2,50" fill={node.color || '#fff'} fillOpacity={node.color ? 0.8 : 0.1} stroke={node.color || '#a855f7'} strokeWidth="4" className="backdrop-blur-md" />
        </svg>
      );
    }
    return null;
  };

  return (
    <motion.div
      className={`absolute top-0 left-0 flex flex-col ${designClasses} ${isSelected ? 'ring-4 ring-indigo-500 ring-offset-2 dark:ring-offset-neutral-900' : ''}`}
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
      {renderShapeBackground()}

      {type === 'text' ? (
        <div className="flex items-center justify-between px-3 py-2 bg-neutral-50 dark:bg-neutral-950 border-b border-neutral-100 dark:border-neutral-800 shrink-0 rounded-t-xl" style={node.color ? { backgroundColor: 'rgba(0,0,0,0.1)', borderColor: 'rgba(0,0,0,0.1)' } : {}}>
          <div
            className="flex-1 cursor-grab active:cursor-grabbing hover:bg-black/5 dark:hover:bg-white/5 rounded py-1 flex items-center justify-center transition-colors touch-none"
            onPointerDown={(e) => {
              e.stopPropagation();
              controls.start(e);
            }}
          >
            <GripHorizontal size={14} className={node.color ? 'text-black/50' : 'text-neutral-400'} />
          </div>
          <button
            onClick={deleteNode}
            className="ml-2 hover:bg-black/10 dark:hover:bg-white/10 p-1 rounded transition-colors pointer-events-auto"
          >
            <X size={14} className={node.color ? 'text-black/50 hover:text-black/80' : 'text-neutral-400'} />
          </button>
        </div>
      ) : (
        <div className="absolute top-0 inset-x-0 h-6 group/handle overflow-visible flex items-start justify-center pt-1 z-20">
          <div
            className="w-1/2 h-4 cursor-grab active:cursor-grabbing rounded-full opacity-0 group-hover/handle:opacity-100 bg-black/10 dark:bg-white/10 flex items-center justify-center transition-opacity backdrop-blur-sm"
            onPointerDown={(e) => {
              e.stopPropagation();
              controls.start(e);
            }}
          >
            <GripHorizontal size={12} className="text-neutral-500" />
          </div>
          <button onClick={deleteNode} className="absolute top-1 right-1 opacity-0 group-hover/handle:opacity-100 bg-red-500 text-white rounded-full p-0.5 pointer-events-auto shadow-sm">
            <X size={12} />
          </button>
        </div>
      )}

      {/* Resize handle for shapes (if not text and not image, wait stickies don't resize dynamically normally, but we can enable it) */}
      {type !== 'text' && type !== 'image' && (
        <div 
           className="absolute bottom-1 right-1 w-4 h-4 rounded-tl opacity-0 hover:opacity-100 cursor-se-resize z-50 pointer-events-auto"
           onPointerDown={startResize}
        >
          {/* Subtle icon indicating resize capable */}
          <div className="w-full h-full bg-black/5 dark:bg-white/10 backdrop-blur rounded-br-xl" />
        </div>
      )}

      {/* Tiptap Editor Content */}
      <div className={`flex-1 cursor-text w-full h-full overflow-hidden ${contentPadding}`}>
        <EditorContent editor={editor} className={type !== 'text' ? 'h-full flex items-center justify-center' : ''} />
      </div>
    </motion.div>
  );
}
