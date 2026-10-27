import { useEffect, useRef, useState } from "react";
import type { usePlayer } from "./usePlayer";
import type { ScoreEntry } from "./library";

type Player = ReturnType<typeof usePlayer>;

type Props = {
  player: Player;
  onFile: (f: File) => void;
  scores: ScoreEntry[];
  currentId: string | null;
  onPick: (id: string) => void;
  onRemove: () => void;
};

export function Controls({ player, onFile, scores, currentId, onPick, onRemove }: Props) {
  const fileInput = useRef<HTMLInputElement | null>(null);
  // Loop inputs are 1-based for humans; the player uses 0-based indices.
  const [loopStart, setLoopStart] = useState(1);
  const [loopEnd, setLoopEnd] = useState(4);

  const hasScore = player.measureCount > 0;
  const playing = player.status === "playing";

  // Keep the loop inputs in step with a loop restored from the library.
  useEffect(() => {
    if (player.loop) { setLoopStart(player.loop.start + 1); setLoopEnd(player.loop.end + 1); }
  }, [player.loop]);

  // Space = play/pause, unless you're typing in an input.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || (e.target as HTMLElement).tagName === "INPUT") return;
      e.preventDefault();
      if (!hasScore) return;
      if (playing) player.pause(); else player.play();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hasScore, playing, player]);

  const toggleLoop = () => {
    if (player.loop) player.setLoop(null);
    else player.setLoop({ start: loopStart - 1, end: loopEnd - 1 });
  };

  return (
    <>
      <div className="group">
        <button onClick={() => fileInput.current?.click()}>Open score</button>
        <input
          ref={fileInput}
          type="file"
          accept=".musicxml,.xml,.mxl"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = "";
          }}
        />
        {scores.length > 0 && (
          <select
            className="library"
            value={currentId ?? ""}
            onChange={(e) => e.target.value && onPick(e.target.value)}
            title="Your scores"
          >
            {currentId === null && <option value="">Choose a score…</option>}
            {scores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        {currentId && (
          <button className="quiet" title="Remove this score from the list" onClick={onRemove}>✕</button>
        )}
      </div>

      <div className="group">
        <button className="primary" disabled={!hasScore} onClick={playing ? player.pause : player.play}>
          {player.status === "loading" ? "Loading…" : playing ? "Pause" : "Play"}
        </button>
        <button disabled={!hasScore} onClick={player.stop}>Stop</button>
        <span className="readout">
          Measure {hasScore ? player.currentMeasure + 1 : "–"} / {hasScore ? player.measureCount : "–"}
        </span>
      </div>

      <div className="group">
        <span>Tempo</span>
        <input
          type="range" min={30} max={240} value={player.bpm}
          disabled={!hasScore}
          onChange={(e) => player.setBpm(Number(e.target.value))}
        />
        <button
          className="quiet readout"
          disabled={!hasScore}
          title="Reset to the score's tempo"
          onClick={() => player.setBpm(player.sheetBpm)}
        >
          {player.bpm} bpm{hasScore && player.bpm !== player.sheetBpm ? ` (${Math.round((player.bpm / player.sheetBpm) * 100)}%)` : ""}
        </button>
      </div>

      <div className="group seg" role="group" aria-label="Hands">
        {(["left", "both", "right"] as const).map((h) => (
          <button
            key={h}
            className={player.hands === h ? "active" : ""}
            disabled={!hasScore}
            onClick={() => player.setHands(h)}
          >
            {h === "both" ? "Both hands" : h === "right" ? "Right hand" : "Left hand"}
          </button>
        ))}
      </div>

      <div className="group">
        <button className={player.metronome ? "active" : ""} disabled={!hasScore} onClick={() => player.setMetronome(!player.metronome)}>
          Metronome
        </button>
        <button className={player.countIn ? "active" : ""} disabled={!hasScore} title="One bar of clicks before playback starts" onClick={() => player.setCountIn(!player.countIn)}>
          Count-in
        </button>
      </div>

      <button
        className={player.waitMode ? "active" : ""}
        disabled={!hasScore}
        title="Playback waits for you to play each note on the keyboard below"
        onClick={() => player.setWaitMode(!player.waitMode)}
      >
        {player.waitMode ? "Wait mode on" : "Wait mode off"}
      </button>

      <div className="group">
        <span>Loop</span>
        <input
          type="number" min={1} max={player.measureCount || 1} value={loopStart}
          disabled={!hasScore || !!player.loop}
          onChange={(e) => setLoopStart(Number(e.target.value))}
        />
        <span>to</span>
        <input
          type="number" min={1} max={player.measureCount || 1} value={loopEnd}
          disabled={!hasScore || !!player.loop}
          onChange={(e) => setLoopEnd(Number(e.target.value))}
        />
        <button className={player.loop ? "active" : ""} disabled={!hasScore} onClick={toggleLoop}>
          {player.loop ? "Loop on" : "Loop off"}
        </button>
      </div>
    </>
  );
}
