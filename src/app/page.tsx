"use client";

import { useRouter } from "next/navigation";
import { ArrowRight, Sparkles } from "lucide-react";

export default function LobbyPage() {
  const router = useRouter();

  const handleCreateBoard = () => {
    // Generate a secure random UUID for the new room
    const id = crypto.randomUUID();
    router.push(`/board/${id}`);
  };

  return (
    <main 
      className="min-h-screen text-white flex flex-col items-center justify-center relative overflow-hidden"
      style={{
        backgroundColor: '#171717',
        backgroundImage: 'radial-gradient(#404040 1px, transparent 1px)',
        backgroundSize: '24px 24px',
        backgroundPosition: '0 0',
      }}
    >
      <div className="relative z-10 max-w-3xl px-6 text-center flex flex-col items-center">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-sm font-medium text-neutral-300 mb-8 backdrop-blur-sm">
          <Sparkles size={14} className="text-indigo-400" />
          <span>Real-time infinite canvas</span>
        </div>

        <h1 className="text-6xl md:text-8xl font-bold tracking-tight mb-8 bg-gradient-to-br from-white to-neutral-500 bg-clip-text text-transparent">
          Think beyond <br/> the document.
        </h1>
        
        <p className="text-xl text-neutral-400 mb-12 max-w-2xl leading-relaxed">
          Create, connect, and collaborate with your team in a beautifully infinite spatial workspace. Drag anywhere, type anything.
        </p>

        <button 
          onClick={handleCreateBoard}
          className="group flex items-center justify-center gap-3 bg-white text-neutral-950 px-8 py-4 rounded-full font-semibold text-lg hover:scale-105 active:scale-95 transition-all w-full sm:w-auto shadow-[0_0_40px_rgba(255,255,255,0.2)] hover:shadow-[0_0_60px_rgba(255,255,255,0.4)]"
        >
          Create New Board
          <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
        </button>
      </div>

      <div className="absolute bottom-8 text-neutral-500 text-sm text-center w-full z-10">
        <p>No sign up required. Just create and share the link.</p>
      </div>
    </main>
  );
}
