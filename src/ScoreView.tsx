import type { usePlayer } from "./usePlayer";

type Player = ReturnType<typeof usePlayer>;

// The div OSMD draws into. Clicking a measure jumps there.
export function ScoreView({ containerRef, player }: { containerRef: React.RefObject<HTMLDivElement | null>; player: Player }) {
  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const svg = containerRef.current?.querySelector("svg");
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const measure = player.measureAtPoint(e.clientX - rect.left, e.clientY - rect.top);
    if (measure !== null) player.jumpToMeasure(measure);
  };
  return <div ref={containerRef} className="score" onClick={onClick} />;
}
