import { useCallback, useEffect, useRef, useState } from "react";
import { OpenSheetMusicDisplay, type Note } from "opensheetmusicdisplay";
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
};

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

  // Things the UI shows live in state (changing them re-renders the components).
  const [status, setStatus] = useState<Status>("empty");
  const [measureCount, setMeasureCount] = useState(0);
  const [currentMeasure, setCurrentMeasure] = useState(0);
  const [bpm, setBpmState] = useState(100);
  const [loop, setLoopState] = useState<Loop>(null);
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
  }, []);

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
          const tie = note.NoteTie;
          if (tie) {
            if (tie.StartNote !== note) continue; // continuation of a tie: already sounding
            notes.push({ midi: note.halfTone + 12, durationWhole: tie.Duration.RealValue });
          } else {
            notes.push({ midi: note.halfTone + 12, durationWhole: note.Length.RealValue });
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
      }, 0);
    }, `${endTicksRef.current}i`);
  }, [moveCursorTo]);

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
    transport.loop = false;
    try {
      console.time("osmd.load");
      await osmd.load(xml);
      console.timeEnd("osmd.load");
      console.time("osmd.render");
      osmd.render();
      console.timeEnd("osmd.render");
      osmd.cursor.show();
      cursorStepRef.current = 0;

      console.time("extractSteps");
      const steps = extractSteps(osmd);
      console.timeEnd("extractSteps");
      console.log(`${steps.length} steps, ${steps.reduce((n, s) => n + s.notes.length, 0)} notes`);
      stepsRef.current = steps;

      const measures = osmd.Sheet.SourceMeasures;
      measureStartsRef.current = measures.map((m) => m.AbsoluteTimestamp.RealValue);
      const last = measures[measures.length - 1];
      endTicksRef.current = wholeToTicks(last.AbsoluteTimestamp.RealValue + last.Duration.RealValue);

      const sheetBpm = osmd.Sheet.DefaultStartTempoInBpm || 100;
      transport.bpm.value = sheetBpm;
      setBpmState(Math.round(sheetBpm));

      setMeasureCount(measures.length);
      setCurrentMeasure(0);
      setTitle(osmd.Sheet.TitleString || fileName);
      console.time("scheduleAll");
      scheduleAll();
      console.timeEnd("scheduleAll");
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

  const play = useCallback(async () => {
    if (stepsRef.current.length === 0) return;
    await ensureAudio();
    Tone.getTransport().start();
    setStatus("playing");
  }, [ensureAudio]);

  const pause = useCallback(() => {
    Tone.getTransport().pause();
    samplerRef.current?.releaseAll();
    setStatus("paused");
  }, []);

  const stop = useCallback(() => {
    const transport = Tone.getTransport();
    transport.stop();
    samplerRef.current?.releaseAll();
    moveCursorTo(0);
    setStatus(stepsRef.current.length ? "ready" : "empty");
  }, [moveCursorTo]);

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
    moveCursorTo(stepIndex);
  }, [moveCursorTo]);

  // Loop a measure range (0-based, inclusive). null = no loop.
  const setLoop = useCallback((range: Loop) => {
    const transport = Tone.getTransport();
    const starts = measureStartsRef.current;
    if (!range || starts.length === 0) {
      transport.loop = false;
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
    status, error, title, measureCount, currentMeasure, bpm, loop,
    load, play, pause, stop, setBpm, setLoop, jumpToMeasure, measureAtPoint,
  };
}