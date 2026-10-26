import { useRef, useState } from "react";
import type { usePlayer } from "./usePlayer";

type Player = ReturnType<typeof usePlayer>;

export function Controls({ player, onFile }: { player: Player; onFile: (f: File) => void }) {
  const fileInput = useRef<HTMLInputElement | null>(null);
  // Loop inputs are 1-based for humans; the player uses 0-based indices.
  const [loopStart, setLoopStart] = useState(1);
  const [loopEnd, setLoopEnd] = useState(4);

  const hasScore = player.measureCount > 0;
  const playing = player.status === "playing";

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
        <span className="title">{player.title || "No score"}</span>
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

      <label className="group">
        Tempo
        <input
          type="range" min={30} max={240} value={player.bpm}
          disabled={!hasScore}
          onChange={(e) => player.setBpm(Number(e.target.value))}
        />
        <span className="readout">{player.bpm} bpm</span>
      </label>

      <div className="group">
        <label>
          Loop
          <input
            type="number" min={1} max={player.measureCount || 1} value={loopStart}
            disabled={!hasScore || !!player.loop}
            onChange={(e) => setLoopStart(Number(e.target.value))}
          />
        </label>
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
