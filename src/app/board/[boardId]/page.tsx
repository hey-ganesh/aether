import Canvas from "@/components/Canvas";

// In Next.js App Router, params is officially an asynchronous Promise
interface BoardPageProps {
  params: Promise<{ boardId: string }>;
}

export default async function BoardPage({ params }: BoardPageProps) {
  // Await the params to resolve the dynamic segment
  const { boardId } = await params;

  return (
    <main className="w-screen h-screen overflow-hidden bg-background">
      <Canvas boardId={boardId} />
    </main>
  );
}
