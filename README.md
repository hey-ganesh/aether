🛸 Aether
Aether is a high-performance, real-time spatial collaboration engine. Think Notion’s rich-text flexibility met with Figma’s infinite-canvas spatiality. Built for teams that need a "brain dump" space that doesn't feel like a rigid grid.

**

🚀 Key Features
Infinite Spatial Canvas: A custom-engineered workspace with panning, zooming (0.1x to 3x), and world-to-screen coordinate mapping.

Multiplayer "Awareness": Live cursor presence and state-synced user avatars with "Teleport to User" functionality.

Conflict-Free Collaboration: Powered by Yjs (CRDTs), ensuring seamless concurrent editing without a central "state-lock."

Polymorphic Nodes: Real-time rich-text editors (TipTap), sticky notes, and geometric shapes (rectangles, circles, diamonds).

Vector Ink Engine: High-frequency SVG drawing with Bézier curve smoothing and a stroke-based eraser.

Bulk Interaction: Marquee selection and delta-based group dragging for complex layout management.

Rich Media: Integrated standalone image nodes with aspect-ratio-locked resizing handles.

🛠 The Stack
Frontend: Next.js 15 (App Router), TypeScript, Tailwind CSS

Real-time: Yjs (CRDT), y-websocket, Socket.io

Animations/Drag: Framer Motion, use-gesture

Editor: TipTap (Headless ProseMirror)

Database: PostgreSQL (via Prisma) — Work in Progress

Icons: Lucide React

🧠 Technical Deep Dive
1. Distributed State Management (CRDTs)
At its core, Aether treats every interaction as an incremental update rather than a full state overwrite. Using Yjs, the document state is shared as a binary structure. When two users move the same node, the CRDT handles the merge at the byte level, ensuring 100% eventual consistency without a heavy backend authority.

2. Screen-to-World Coordinate Mapping
To handle panning and zooming, the engine uses a custom transformation matrix. Cursors and drawings are broadcasted in World Space coordinates, then locally translated into Screen Space based on the user's specific camera offset.

Formula: WorldX=(ClientX−CameraX)/Zoom

3. Performance Optimization
To prevent WebSocket flooding during high-frequency events (like drawing or group dragging), Aether utilizes a Hybrid Rendering Strategy:

Optimistic UI: Local transforms run at 60fps via React state.

Throttled Broadcast: Changes are flushed to the Yjs shared document at a controlled frequency to optimize network bandwidth.

🏁 Getting Started
1. Clone & Install
Bash
git clone https://github.com/yourusername/Aether.git
cd Aether
npm install

3. Start the WebSocket Server
In a separate terminal:

Bash
npm run ws-server

3. Start the Frontend
Bash
npm run dev
Visit localhost:3000 and click "Create New Board". Open the link in an Incognito tab to witness the real-time magic.

Developed with ❤️ and a lot of caffeine. If you like this project, feel free to reach out or open a PR!
