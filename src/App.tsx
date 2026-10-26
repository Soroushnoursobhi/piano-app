import { useRef } from "react";
import { usePlayer } from "./usePlayer";
import { Controls } from "./Controls";
import { ScoreView } from "./ScoreView";
import { Keyboard } from "./Keyboard";
import "./App.css";

/*
  A component is a function that returns HTML-like markup (JSX).
  React calls it again every time its state changes and updates the page.
*/
function bytesToBinaryString(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let out = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return out;
}

export default function App() {
  // A ref is a box that holds a value without causing re-renders.
  // Here it holds the <div> that OSMD draws into.
  const scoreRef = useRef<HTMLDivElement | null>(null);
  const player = usePlayer(scoreRef);

  // Read the chosen file into a string and hand it to the player.
  const onFile = async (file: File) => {
    const isCompressed = /\.mxl$/i.test(file.name);
    // .mxl is a zip. OSMD unpacks it itself, but needs the raw bytes as a
    // "binary string" (one character per byte), not UTF-8-decoded text.
    const content = isCompressed ? bytesToBinaryString(await file.arrayBuffer()) : await file.text();
    await player.load(content, file.name.replace(/\.(musicxml|xml|mxl)$/i, ""));
  };

  return (
    <div className="app">
      <header className="toolbar">
        <Controls player={player} onFile={onFile} />
      </header>
      <main className="stage">
        {player.status === "empty" && !player.error && (
          <p className="hint">Choose a .musicxml, .xml or .mxl file to begin.</p>
        )}
        {player.error && <p className="hint error">Could not read that file: {player.error}</p>}
        <ScoreView containerRef={scoreRef} player={player} empty={player.measureCount === 0} />
      </main>
      <footer className="keys">
        <Keyboard expected={player.expected} onNoteOn={player.noteOn} />
      </footer>
    </div>
  );
}
