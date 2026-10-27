import { useEffect, useRef, useState } from "react";
import { usePlayer } from "./usePlayer";
import { Controls } from "./Controls";
import { ScoreView } from "./ScoreView";
import { Keyboard } from "./Keyboard";
import * as lib from "./library";
import "./App.css";

function bytesToBinaryString(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let out = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return out;
}

/*
  A component is a function that returns HTML-like markup (JSX).
  React calls it again every time its state changes and updates the page.
*/
export default function App() {
  // A ref is a box that holds a value without causing re-renders.
  // Here it holds the <div> that OSMD draws into.
  const scoreRef = useRef<HTMLDivElement | null>(null);
  const player = usePlayer(scoreRef);

  // ---- library ----
  const [scores, setScores] = useState<lib.ScoreEntry[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);

  // Load a library entry into the player and restore its settings.
  const openEntry = async (entry: lib.ScoreEntry) => {
    const content = await lib.getContent(entry.id);
    if (!content) return;
    setCurrentId(entry.id);
    await player.load(content, entry.name);
    player.applySettings(entry.settings);
    await lib.setLastOpened(entry.id);
  };

  // On first render: read the library and reopen the last score.
  // useEffect with [] runs once after the component is on the page.
  useEffect(() => {
    (async () => {
      const entries = await lib.listScores();
      setScores(entries);
      const lastId = await lib.getLastOpened();
      const last = entries.find((e) => e.id === lastId);
      if (last) openEntry(last);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Read a newly chosen file, store it, open it.
  const onFile = async (file: File) => {
    const isCompressed = /\.mxl$/i.test(file.name);
    // .mxl is a zip. OSMD unpacks it itself, but needs the raw bytes as a
    // "binary string" (one character per byte), not UTF-8-decoded text.
    const content = isCompressed ? bytesToBinaryString(await file.arrayBuffer()) : await file.text();
    const name = file.name.replace(/\.(musicxml|xml|mxl)$/i, "");
    const entry = await lib.addScore(name, content);
    setScores(await lib.listScores());
    await openEntry(entry);
  };

  const onRemove = async () => {
    if (!currentId) return;
    await lib.removeScore(currentId);
    setScores(await lib.listScores());
    setCurrentId(null);
    player.stop();
  };

  // Whenever a setting changes, save it for the current score.
  // The dependency list is what React watches; the effect runs when any of them changes.
  const { bpm, hands, loop, metronome, countIn, waitMode, measureCount } = player;
  useEffect(() => {
    if (!currentId || measureCount === 0) return;
    lib.saveSettings(currentId, { bpm, hands, loop, metronome, countIn, waitMode });
  }, [currentId, measureCount, bpm, hands, loop, metronome, countIn, waitMode]);

  return (
    <div className="app">
      <header className="toolbar">
        <Controls
          player={player}
          onFile={onFile}
          scores={scores}
          currentId={currentId}
          onPick={(id) => { const e = scores.find((s) => s.id === id); if (e) openEntry(e); }}
          onRemove={onRemove}
        />
      </header>
      <main className="stage">
        {player.status === "empty" && !player.error && (
          <p className="hint">Choose a .musicxml, .xml or .mxl file to begin.</p>
        )}
        {player.error && <p className="hint error">Could not read that file: {player.error}</p>}
        <ScoreView containerRef={scoreRef} player={player} empty={player.measureCount === 0} />
      </main>
      <footer className="keys">
        <Keyboard expected={player.expected} playing={player.sounding} onNoteOn={player.noteOn} />
      </footer>
    </div>
  );
}
