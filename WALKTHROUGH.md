# How this app is built

Read top to bottom once. Then open the files in the same order.

## Run it

```
npm install      # downloads the libraries listed in package.json into node_modules/
npm run dev      # starts a local dev server, prints a URL like http://localhost:5173
```

Open the URL, click "Open score", pick `samples/test-piece.musicxml`.

## The four ideas you need

**Component** – a function that returns markup (JSX, the HTML-looking code inside `.tsx`
files). React calls the function, puts the result on the page, and calls it again whenever
the component's state changes. `App`, `Controls`, `ScoreView` are components.

**State vs. ref** – `useState` holds values the page shows (status, tempo, current measure).
Changing state re-renders. `useRef` holds values that must survive between renders but must
not cause re-renders (the OSMD object, the sampler, the list of notes). Rule of thumb:
if the user should see it, state; if it is machinery, ref.

**Hook** – a function whose name starts with `use` and that itself uses `useState`/`useRef`/
`useEffect`. It is how you package stateful logic so a component can call one function
and get everything back. `usePlayer` is the only custom hook here; all the score and audio
logic lives in it.

**Audio context and transport** – browsers only produce sound after a user gesture, so
`Tone.start()` runs when you first press Play. Tone's *transport* is a clock. We don't play
notes ourselves; we tell the transport "at tick 384, play these notes", press start, and it
fires the callbacks at the right time. Pause, tempo and loop are then just transport settings.

## Files

| File | Job |
|---|---|
| `index.html` | the one page; has an empty `<div id="root">` |
| `src/main.tsx` | mounts `App` into that div |
| `src/App.tsx` | layout; reads the chosen file; passes the player to the other components |
| `src/Controls.tsx` | the toolbar buttons and inputs; only calls player functions |
| `src/ScoreView.tsx` | the div OSMD draws into; turns a click into a measure number |
| `src/usePlayer.ts` | everything else (read it last, it is the real app) |
| `src/App.css`, `src/index.css` | styling |
| `samples/` | a test score |

## What usePlayer does, in order

1. `useEffect` creates the OSMD object once, pointing at the score div.
2. `load(xml)` – OSMD parses and draws the score. Then `extractSteps` walks the score with
   OSMD's cursor: at each cursor position it records the time (in whole notes), the measure,
   and every note that starts there (pitch + length). Tied notes are merged.
3. `scheduleAll` – for every step, `transport.schedule(callback, time)`. Time is in *ticks*
   (192 per quarter note) rather than seconds, so changing the tempo later doesn't require
   rescheduling: the transport simply runs the ticks faster or slower.
   Each callback plays the notes on the sampler and asks `Tone.Draw` to move the cursor
   when the sound is actually heard.
4. `play` – unlock audio, download the piano samples (first time only), start the transport.
5. `pause`/`stop`/`setBpm` – one line each on the transport.
6. `jumpToMeasure` – set `transport.position` to the measure's tick, move the cursor.
7. `setLoop` – `transport.loopStart/loopEnd/loop`. The transport jumps back by itself.
8. `measureAtPoint` – OSMD keeps a box for every drawn measure; find the one under the click.

## Things worth knowing when it misbehaves

- MIDI pitch = `note.halfTone + 12` (OSMD numbers middle C as 48, MIDI as 60).
- OSMD positions are in "units" of 10px, scaled by `osmd.Zoom`. If clicks land on the wrong
  measure, this conversion is the suspect.
- Moving the cursor backwards is `reset()` then `next()` N times; OSMD has no `previous()`.
- The piano samples come from tonejs.github.io; no internet on first play = no sound.
