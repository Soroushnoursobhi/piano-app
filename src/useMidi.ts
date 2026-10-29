import { useCallback, useEffect, useRef, useState } from "react";

/*
  Web MIDI: the browser API for MIDI devices (Chrome and Edge; not Safari).
  A MIDI message is 3 bytes: [status, data1, data2]. For a key press the status
  byte is 0x90 + channel, data1 the MIDI note number, data2 the velocity (how
  hard). Velocity 0 means "key released" on many devices, as does status 0x80.
*/
export function useMidi(onNoteOn: (midi: number, velocity: number) => void) {
  const [device, setDevice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const accessRef = useRef<MIDIAccess | null>(null);
  const handlerRef = useRef(onNoteOn);
  handlerRef.current = onNoteOn; // always call the latest version

  const attach = useCallback((access: MIDIAccess) => {
    const inputs = [...access.inputs.values()];
    for (const input of inputs) {
      input.onmidimessage = (e: MIDIMessageEvent) => {
        const [status, note, velocity] = e.data ?? [];
        if (status === undefined) return;
        const command = status & 0xf0;
        if (command === 0x90 && velocity > 0) handlerRef.current(note, velocity);
      };
    }
    setDevice(inputs.length ? inputs.map((i) => i.name ?? "MIDI device").join(", ") : null);
  }, []);

  const connect = useCallback(async () => {
    if (!("requestMIDIAccess" in navigator)) {
      setError("This browser has no Web MIDI. Use Chrome.");
      return;
    }
    try {
      const access = await navigator.requestMIDIAccess();
      accessRef.current = access;
      attach(access);
      // Re-attach when a device is plugged in or unplugged.
      access.onstatechange = () => attach(access);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "MIDI access denied");
    }
  }, [attach]);

  // Clean up listeners if the component goes away.
  useEffect(() => () => {
    const access = accessRef.current;
    if (!access) return;
    for (const input of access.inputs.values()) input.onmidimessage = null;
  }, []);

  return { device, error, connect };
}
