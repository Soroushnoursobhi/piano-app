/*
  An on-screen piano. It is an "input device": clicking a key calls onNoteOn
  with a MIDI number, exactly what a real MIDI keyboard will do later.
  Keys listed in `expected` are highlighted (wait mode).
*/
const LOW = 36;  // C2
const HIGH = 96; // C7
const WHITE_W = 26;
const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const isBlack = (midi: number) => NAMES[midi % 12].includes("#");

type Props = {
  expected: number[]; // wait mode: keys still to be played (gold)
  playing: number[];  // keys sounding right now (red)
  onNoteOn: (midi: number) => void;
};

export function Keyboard({ expected, playing, onNoteOn }: Props) {
  const keys: { midi: number; black: boolean; x: number }[] = [];
  let whiteIndex = 0;
  for (let midi = LOW; midi <= HIGH; midi++) {
    const black = isBlack(midi);
    // A black key sits on the boundary between the previous and next white key.
    const x = black ? whiteIndex * WHITE_W - WHITE_W * 0.3 : whiteIndex * WHITE_W;
    keys.push({ midi, black, x });
    if (!black) whiteIndex++;
  }
  const width = whiteIndex * WHITE_W;
  const want = new Set(expected);
  const lit = new Set(playing);
  const cls = (k: { midi: number; black: boolean }) =>
    "key " + (k.black ? "black" : "white") + (want.has(k.midi) ? " expected" : lit.has(k.midi) ? " playing" : "");

  return (
    <div className="keyboard" style={{ width }}>
      {keys.filter((k) => !k.black).map((k) => (
        <button
          key={k.midi}
          className={cls(k)}
          style={{ left: k.x, width: WHITE_W }}
          onPointerDown={() => onNoteOn(k.midi)}
          aria-label={NAMES[k.midi % 12] + (Math.floor(k.midi / 12) - 1)}
        >
          {k.midi % 12 === 0 ? "C" + (Math.floor(k.midi / 12) - 1) : ""}
        </button>
      ))}
      {keys.filter((k) => k.black).map((k) => (
        <button
          key={k.midi}
          className={cls(k)}
          style={{ left: k.x, width: WHITE_W * 0.6 }}
          onPointerDown={() => onNoteOn(k.midi)}
          aria-label={NAMES[k.midi % 12] + (Math.floor(k.midi / 12) - 1)}
        />
      ))}
    </div>
  );
}
