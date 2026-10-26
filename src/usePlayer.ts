import { useCallback, useEffect, useRef, useState } from "react";
import { OpenSheetMusicDisplay, type Note, type GraphicalNote } from "opensheetmusicdisplay";
import * as Tone from "tone";

/*
  This hook owns everything that is not pure UI:
  - the OSMD object that draws the score and moves the cursor
  - the Tone.js sampler (piano sound) and transport (the clock)
  - the list of "steps" we extracted from the score
  The React components only call the functions it returns.
*/

// One sounding note, as Tone.js needs it.
type PlayableNote = {
  midi: number;        // MIDI pitch number: 60 = middle C
  durationWhole: number; // length in whole notes (0.25 = a quarter note)
  staff: number;       // 0 = top staff (right hand), 1 = bottom staff (left hand)
  note: Note;          // OSMD's own note object, needed to colour it on screen
};

export type Hands = "both" | "right" | "left";

// One position of the cursor. The cursor stops at every distinct time
// where something starts (a note, a chord, a rest) in any staff.
type Step = {
  index: number;       // how many cursor.next() calls from the start
  timeWhole: number;   // start time in whole notes from the beginning
  measureIndex: number; // 0-based measure
  notes: PlayableNote[];
};

export type Status = "empty" | "loading" | "ready" | "playing" | "paused";

export type Loop = { start: number; end: number } | null; // 0-based measure indices, inclusive

const PPQ = 192; // ticks per quarter note on the Tone transport
const COLOR_PLAYING = "#d03a2a"; // notes at the cursor
const COLOR_OWED = "#c89a3c";    // wait mode: notes still to be played
const SAMPLE_BASE = "https://tonejs.github.io/audio/salamander/";
const SAMPLE_URLS: Record<string, string> = {
  A0: "A0.mp3", C1: "C1.mp3", "D#1": "Ds1.mp3", "F#1": "Fs1.mp3",
  A1: "A1.mp3", C2: "C2.mp3", "D#2": "Ds2.mp3", "F#2": "Fs2.mp3",
  A2: "A2.mp3", C3: "C3.mp3", "D#3": "Ds3.mp3", "F#3": "Fs3.mp3",
  A3: "A3.mp3", C4: "C4.mp3", "D#4": "Ds4.mp3", "F#4": "Fs4.mp3",
  A4: "A4.mp3", C5: "C5.mp3", "D#5": "Ds5.mp3", "F#5": "Fs5.mp3",
  A5: "A5.mp3", C6: "C6.mp3", "D#6": "Ds6.mp3", "F#6": "Fs6.mp3",
  A6: "A6.mp3", C7: "C7.mp3", "D#7": "Ds7.mp3", "F#7": "Fs7.mp3",
  A7: "A7.mp3", C8: "C8.mp3",
};

// whole notes -> transport ticks (a quarter note is PPQ ticks)
const wholeToTicks = (whole: number) => Math.round(whole * 4 * PPQ);

export function usePlayer(containerRef: React.RefObject<HTMLDivElement | null>) {
  // Things that must survive re-renders but should NOT trigger re-renders live in refs.
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);
  const samplerRef = useRef<Tone.Sampler | null>(null);
  const stepsRef = useRef<Step[]>([]);
  const cursorStepRef = useRef(0);       // which step the visual cursor is on now
  const endTicksRef = useRef(0);         // where the piece ends
  const measureStartsRef = useRef<number[]>([]); // start time (whole notes) of each measure
  const handsRef = useRef<Hands>("both");        // read inside scheduled callbacks, so a ref
  const loopRef = useRef<Loop>(null);
  // Wait mode: playback advances only when you play the expected notes.
  const waitModeRef = useRef(false);
  const waitActiveRef = useRef(false);           // true while wait-mode playback is running
  const waitStepRef = useRef(0);                 // the step we are currently waiting on
  const expectedRef = useRef<Set<number>>(new Set()); // MIDI numbers still to be played
  const paintedRef = useRef<GraphicalNote[]>([]);     // notes currently coloured, to undo

  // Things the UI shows live in state (changing them re-renders the components).
  const [status, setStatus] = useState<Status>("empty");
  const [measureCount, setMeasureCount] = useState(0);
  const [currentMeasure, setCurrentMeasure] = useState(0);
  const [bpm, setBpmState] = useState(100);
  const [sheetBpm, setSheetBpm] = useState(100);
  const [loop, setLoopState] = useState<Loop>(null);
  const [hands, setHandsState] = useState<Hands>("both");
  const [waitMode, setWaitModeState] = useState(false);
  const [expected, setExpected] = useState<number[]>([]); // for the on-screen keyboard
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");

  // ---- setup: create OSMD once the container div exists ----
  useEffect(() => {
    if (!containerRef.current || osmdRef.current) return;
    osmdRef.current = new OpenSheetMusicDisplay(containerRef.current, {
      autoResize: true,
      drawTitle: true,
      followCursor: true, // OSMD scrolls the page so the cursor stays visible
    });
  }, [containerRef]);

  const isSelectedHand = (n: PlayableNote) => {
    const h = handsRef.current;
    return h === "both" || (h === "right" ? n.staff === 0 : n.staff !== 0);
  };

  // ---- colouring notes on the score ----
  // Colour the notes of one step; pass null to clear. In wait mode, notes still
  // owed are gold, everything else at the cursor is blue.
  const paint = useCallback((stepIndex: number | null) => {
    const osmd = osmdRef.current;
    if (!osmd) return;
    const base = osmd.EngravingRules.DefaultColorMusic || "#000000";
    for (const g of paintedRef.current) g.setColor(base, {});
    paintedRef.current = [];
    if (stepIndex === null) return;
    const step = stepsRef.current[stepIndex];
    if (!step) return;
    for (const n of step.notes) {
      // GNote: source note -> the drawn note (undefined if not drawn, e.g. hidden staff)
      const g = osmd.EngravingRules.GNote(n.note);
      if (!g) continue;
      const owed = waitActiveRef.current && expectedRef.current.has(n.midi) && isSelectedHand(n);
      g.setColor(owed ? COLOR_OWED : COLOR_PLAYING, {});
      paintedRef.current.push(g);
    }
  }, []);

  // ---- cursor helpers ----
  // Move the visual cursor to a given step. Forward = call next() repeatedly;
  // backward = reset to the start and walk forward again.
  const moveCursorTo = useCallback((stepIndex: number) => {
    const osmd = osmdRef.current;
    if (!osmd) return;
    const cursor = osmd.cursor;
    if (stepIndex < cursorStepRef.current) {
      cursor.reset();
      cursorStepRef.current = 0;
    }
    while (cursorStepRef.current < stepIndex && !cursor.iterator.EndReached) {
      cursor.next();
      cursorStepRef.current++;
    }
    const step = stepsRef.current[stepIndex];
    if (step) setCurrentMeasure(step.measureIndex);
    paint(stepIndex);
  }, [paint]);

  // ---- extract steps by walking the score with OSMD's cursor ----
  const extractSteps = useCallback((osmd: OpenSheetMusicDisplay): Step[] => {
    const steps: Step[] = [];
    const cursor = osmd.cursor;
    cursor.reset();
    let index = 0;
    let lastKey = "";
    let stuck = 0;
    while (!cursor.iterator.EndReached) {
      const it = cursor.iterator;
      // Safety: OSMD's iterator can get stuck on some repeat structures.
      const key = `${it.CurrentMeasureIndex}:${it.CurrentSourceTimestamp.RealValue}`;
      stuck = key === lastKey ? stuck + 1 : 0;
      lastKey = key;
      if (stuck > 50 || index > 100000) {
        console.warn("extractSteps: iterator stuck at", key, "- stopping early");
        break;
      }
      const notes: PlayableNote[] = [];
      for (const voiceEntry of it.CurrentVoiceEntries) {
        for (const note of voiceEntry.Notes as Note[]) {
          if (note.isRest() || !note.Pitch || note.IsGraceNote) continue;
          // Which staff the note is printed on. For piano music staff 0 is the
          // treble (right hand) and staff 1 the bass (left hand).
          const staff = note.ParentStaffEntry?.ParentStaff?.idInMusicSheet ?? 0;
          const tie = note.NoteTie;
          if (tie) {
            if (tie.StartNote !== note) continue; // continuation of a tie: already sounding
            notes.push({ midi: note.halfTone + 12, durationWhole: tie.Duration.RealValue, staff, note });
          } else {
            notes.push({ midi: note.halfTone + 12, durationWhole: note.Length.RealValue, staff, note });
          }
        }
      }
      steps.push({
        index,
        timeWhole: it.CurrentSourceTimestamp.RealValue,
        measureIndex: it.CurrentMeasureIndex,
        notes,
      });
      cursor.next();
      index++;
    }
    cursor.reset();
    return steps;
  }, []);

  // ---- put every step on the transport ----
  const scheduleAll = useCallback(() => {
    const transport = Tone.getTransport();
    transport.cancel(0); // remove anything scheduled before
    for (const step of stepsRef.current) {
      transport.schedule((time) => {
        // Sound: durations are converted to seconds *now*, so a tempo change
        // made before this note is respected.
        const sampler = samplerRef.current;
        if (sampler && step.notes.length) {
          const secPerWhole = (60 / Tone.getTransport().bpm.value) * 4;
          for (const n of step.notes) {
            if (!isSelectedHand(n)) continue;
            const seconds = Math.max(0.05, n.durationWhole * secPerWhole * 0.95);
            sampler.triggerAttackRelease(Tone.Frequency(n.midi, "midi").toNote(), seconds, time);
          }
        }
        // Visual: Draw runs the callback at the moment the sound is heard.
        Tone.getDraw().schedule(() => moveCursorTo(step.index), time);
      }, `${wholeToTicks(step.timeWhole)}i`);
    }
    // Stop at the end of the piece.
    transport.schedule(() => {
      Tone.getDraw().schedule(() => {
        transport.stop();
        setStatus("ready");
        moveCursorTo(0);
        paint(null);
      }, 0);
    }, `${endTicksRef.current}i`);
  }, [moveCursorTo, paint]);

  // ---- public: load a MusicXML string ----
  const load = useCallback(async (xml: string, fileName: string) => {
    const osmd = osmdRef.current;
    if (!osmd) return;
    const transport = Tone.getTransport();
    transport.stop();
    transport.cancel(0);
    setStatus("loading");
    setError("");
    setLoopState(null);
    loopRef.current = null;
    transport.loop = false;
    waitActiveRef.current = false;
    expectedRef.current = new Set();
    setExpected([]);
    try {
      paintedRef.current = [];
      await osmd.load(xml);
      osmd.render();
      osmd.cursor.show();
      cursorStepRef.current = 0;

      const steps = extractSteps(osmd);
      console.log(`${steps.length} steps, ${steps.reduce((n, s) => n + s.notes.length, 0)} notes`);
      stepsRef.current = steps;

      const measures = osmd.Sheet.SourceMeasures;
      measureStartsRef.current = measures.map((m) => m.AbsoluteTimestamp.RealValue);
      const last = measures[measures.length - 1];
      endTicksRef.current = wholeToTicks(last.AbsoluteTimestamp.RealValue + last.Duration.RealValue);

      const sheetBpm = osmd.Sheet.DefaultStartTempoInBpm || 100;
      transport.bpm.value = sheetBpm;
      setBpmState(Math.round(sheetBpm));
      setSheetBpm(Math.round(sheetBpm));

      setMeasureCount(measures.length);
      setCurrentMeasure(0);
      setTitle(osmd.Sheet.TitleString || fileName);
      scheduleAll();
      setStatus("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("empty");
    }
  }, [extractSteps, scheduleAll]);

  // ---- public: load the piano sound (needs a user click first, browser rule) ----
  const ensureAudio = useCallback(async () => {
    await Tone.start(); // unlocks the browser's AudioContext
    if (samplerRef.current) return;
    const sampler = new Tone.Sampler({ urls: SAMPLE_URLS, baseUrl: SAMPLE_BASE, release: 1 }).toDestination();
    samplerRef.current = sampler;
    await Tone.loaded(); // waits for every sample file to download
  }, []);

  // Play some notes right now (used by wait mode and the on-screen keyboard).
  const soundNotes = useCallback((notes: PlayableNote[]) => {
    const sampler = samplerRef.current;
    if (!sampler) return;
    const secPerWhole = (60 / Tone.getTransport().bpm.value) * 4;
    for (const n of notes) {
      sampler.triggerAttackRelease(Tone.Frequency(n.midi, "midi").toNote(), Math.max(0.1, n.durationWhole * secPerWhole));
    }
  }, []);

  // ---- wait mode engine ----
  // Enter a step: move the cursor there, sound the notes of the muted hand(s),
  // and wait for the selected hand's notes. Steps with nothing to wait for
  // (rests, muted-hand-only) are passed through immediately.
  const enterStep = useCallback((startIndex: number) => {
    const steps = stepsRef.current;
    let i = startIndex;
    for (let guard = 0; guard <= steps.length; guard++) {
      const loop = loopRef.current;
      if (loop && (i >= steps.length || steps[i].measureIndex > loop.end)) {
        i = steps.findIndex((s) => s.measureIndex >= loop.start);
      }
      if (i < 0 || i >= steps.length) {
        // end of piece
        waitActiveRef.current = false;
        expectedRef.current = new Set();
        setExpected([]);
        setStatus("ready");
        moveCursorTo(0);
        paint(null);
        return;
      }
      const step = steps[i];
      moveCursorTo(i);
      soundNotes(step.notes.filter((n) => !isSelectedHand(n)));
      const wanted = step.notes.filter(isSelectedHand).map((n) => n.midi);
      if (wanted.length > 0) {
        waitStepRef.current = i;
        expectedRef.current = new Set(wanted);
        setExpected([...new Set(wanted)]);
        paint(i);
        return;
      }
      i++;
    }
  }, [moveCursorTo, soundNotes, paint]);

  // Called by any input device: on-screen keyboard now, MIDI keyboard later.
  const noteOn = useCallback(async (midi: number) => {
    await ensureAudio();
    samplerRef.current?.triggerAttackRelease(Tone.Frequency(midi, "midi").toNote(), 0.8);
    if (!waitActiveRef.current) return;
    const exp = expectedRef.current;
    if (!exp.has(midi)) return; // wrong note: ignored
    exp.delete(midi);
    setExpected([...exp]);
    if (exp.size === 0) enterStep(waitStepRef.current + 1);
    else paint(waitStepRef.current); // the note just played turns blue
  }, [ensureAudio, enterStep, paint]);

  const play = useCallback(async () => {
    if (stepsRef.current.length === 0) return;
    await ensureAudio();
    setStatus("playing");
    if (waitModeRef.current) {
      waitActiveRef.current = true;
      enterStep(cursorStepRef.current);
    } else {
      Tone.getTransport().start();
    }
  }, [ensureAudio, enterStep]);

  const pause = useCallback(() => {
    Tone.getTransport().pause();
    samplerRef.current?.releaseAll();
    waitActiveRef.current = false;
    expectedRef.current = new Set();
    setExpected([]);
    setStatus("paused");
  }, []);

  const stop = useCallback(() => {
    const transport = Tone.getTransport();
    transport.stop();
    samplerRef.current?.releaseAll();
    waitActiveRef.current = false;
    expectedRef.current = new Set();
    setExpected([]);
    moveCursorTo(0);
    paint(null);
    setStatus(stepsRef.current.length ? "ready" : "empty");
  }, [moveCursorTo, paint]);

  const setWaitMode = useCallback((on: boolean) => {
    if (waitModeRef.current === on) return;
    // Switching modes mid-playback: pause first, the user presses Play again.
    if (Tone.getTransport().state === "started" || waitActiveRef.current) pause();
    waitModeRef.current = on;
    setWaitModeState(on);
  }, [pause]);

  const setHands = useCallback((value: Hands) => {
    handsRef.current = value;
    setHandsState(value);
  }, []);

  const setBpm = useCallback((value: number) => {
    Tone.getTransport().bpm.value = value;
    setBpmState(value);
  }, []);

  // Jump to a measure (0-based). Works while playing, paused or stopped.
  const jumpToMeasure = useCallback((measureIndex: number) => {
    const steps = stepsRef.current;
    const stepIndex = steps.findIndex((s) => s.measureIndex >= measureIndex);
    if (stepIndex < 0) return;
    samplerRef.current?.releaseAll();
    Tone.getTransport().position = `${wholeToTicks(steps[stepIndex].timeWhole)}i`;
    if (waitActiveRef.current) enterStep(stepIndex);
    else moveCursorTo(stepIndex);
  }, [moveCursorTo, enterStep]);

  // Loop a measure range (0-based, inclusive). null = no loop.
  const setLoop = useCallback((range: Loop) => {
    const transport = Tone.getTransport();
    const starts = measureStartsRef.current;
    if (!range || starts.length === 0) {
      transport.loop = false;
      loopRef.current = null;
      setLoopState(null);
      return;
    }
    const start = Math.max(0, Math.min(range.start, range.end));
    const end = Math.min(starts.length - 1, Math.max(range.start, range.end));
    const startTicks = wholeToTicks(starts[start]);
    const endTicks = end + 1 < starts.length ? wholeToTicks(starts[end + 1]) : endTicksRef.current;
    transport.loopStart = `${startTicks}i`;
    transport.loopEnd = `${endTicks}i`;
    transport.loop = true;
    loopRef.current = { start, end };
    setLoopState({ start, end });
    // If we are outside the loop, jump into it.
    const posTicks = transport.ticks;
    if (posTicks < startTicks || posTicks >= endTicks) jumpToMeasure(start);
  }, [jumpToMeasure]);

  // Given a click position in CSS pixels relative to the score's SVG,
  // find which measure was clicked.
  const measureAtPoint = useCallback((xPx: number, yPx: number): number | null => {
    const osmd = osmdRef.current;
    if (!osmd || !osmd.GraphicSheet) return null;
    const unit = 10 * osmd.Zoom; // OSMD lays out in "units"; 10px per unit at zoom 1
    const x = xPx / unit;
    const y = yPx / unit;
    const list = osmd.GraphicSheet.MeasureList;
    for (let i = 0; i < list.length; i++) {
      for (const gm of list[i] ?? []) {
        if (!gm) continue;
        const sys = gm.ParentMusicSystem?.PositionAndShape;
        const box = gm.PositionAndShape;
        if (!sys || !box) continue;
        const inX = x >= box.AbsolutePosition.x && x <= box.AbsolutePosition.x + box.Size.width;
        const inY = y >= sys.AbsolutePosition.y - 1 && y <= sys.AbsolutePosition.y + sys.Size.height + 1;
        if (inX && inY) return i;
      }
    }
    return null;
  }, []);

  return {
    status, error, title, measureCount, currentMeasure, bpm, sheetBpm, loop, hands, waitMode, expected,
    load, play, pause, stop, setBpm, setLoop, setHands, setWaitMode, noteOn, jumpToMeasure, measureAtPoint,
  };
}