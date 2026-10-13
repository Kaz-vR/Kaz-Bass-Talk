// Web MIDI input (local hardware only; no network).

export interface MidiHandlers {
  noteOn(note: number, velocity: number): void;
  noteOff(note: number): void;
  pitchBend(value: number): void;
  modWheel(value: number): void;
  allNotesOff(): void;
  status(text: string): void;
}

export async function initMidi(h: MidiHandlers): Promise<void> {
  const nav = navigator as Navigator & { requestMIDIAccess?: (o?: { sysex?: boolean }) => Promise<MIDIAccess> };
  if (!nav.requestMIDIAccess) {
    h.status('MIDI: not supported');
    return;
  }
  let access: MIDIAccess;
  try {
    access = await nav.requestMIDIAccess({ sysex: false });
  } catch {
    h.status('MIDI: blocked');
    return;
  }
  const onMessage = (e: MIDIMessageEvent) => {
    const d = e.data;
    if (!d || d.length < 1) return;
    const cmd = d[0] & 0xf0;
    if (cmd === 0x90 && d[2] > 0) h.noteOn(d[1], d[2] / 127);
    else if (cmd === 0x80 || (cmd === 0x90 && d[2] === 0)) h.noteOff(d[1]);
    else if (cmd === 0xe0) h.pitchBend(((d[2] << 7) | d[1]) / 8192 - 1);
    else if (cmd === 0xb0 && d[1] === 1) h.modWheel(d[2] / 127);
    else if (cmd === 0xb0 && (d[1] === 123 || d[1] === 120)) h.allNotesOff();
  };
  const bind = () => {
    const names: string[] = [];
    access.inputs.forEach((input) => {
      input.onmidimessage = onMessage;
      names.push(input.name ?? 'input');
    });
    h.status(names.length ? `MIDI: ${names.join(', ')}` : 'MIDI: no inputs');
  };
  access.onstatechange = bind;
  bind();
}
