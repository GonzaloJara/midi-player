import { Midi } from '@tonejs/midi'

// seconds per beat at a given BPM
const spb = (bpm) => 60 / bpm

// Add a note by MIDI number
function addNote(track, midiNum, beatTime, beatDur, secondsPerBeat, velocity = 0.8) {
  track.addNote({
    midi: midiNum,
    time: beatTime * secondsPerBeat,
    duration: Math.max(0.05, beatDur * secondsPerBeat * 0.93),
    velocity,
  })
}

// ── 1. C Major Scale ──────────────────────────────────────────────────────────
function makeCMajorScale() {
  const midi = new Midi()
  midi.header.setTempo(100)
  const s = spb(100)

  const track = midi.addTrack()
  track.name = 'Piano'
  track.instrument.number = 0 // Acoustic Grand Piano

  // C4 → C5 ascending then back
  const notes = [60, 62, 64, 65, 67, 69, 71, 72,
                  72, 71, 69, 67, 65, 64, 62, 60]
  // Also add a final C major chord
  notes.forEach((n, i) => addNote(track, n, i, 1, s, 0.75))

  // Final chord — stagger slightly for a rolled feel
  addNote(track, 60, 16,    1.8, s, 0.8)
  addNote(track, 64, 16.05, 1.8, s, 0.75)
  addNote(track, 67, 16.1,  1.8, s, 0.7)

  return midi
}

// ── 2. Twinkle Twinkle Little Star ────────────────────────────────────────────
function makeTwinkle() {
  const midi = new Midi()
  midi.header.setTempo(116)
  const s = spb(116)

  const track = midi.addTrack()
  track.name = 'Melody'
  track.instrument.number = 0

  const C=60, D=62, E=64, F=65, G=67, A=69

  // Each entry: note or [note, beatDuration]
  const melody = [
    C, C, G, G, A, A, [G, 2],
    F, F, E, E, D, D, [C, 2],
    G, G, F, F, E, E, [D, 2],
    G, G, F, F, E, E, [D, 2],
    C, C, G, G, A, A, [G, 2],
    F, F, E, E, D, D, [C, 2],
  ]

  let beat = 0
  for (const entry of melody) {
    const [note, dur] = Array.isArray(entry) ? entry : [entry, 1]
    addNote(track, note, beat, dur, s, 0.8)
    beat += dur
  }

  return midi
}

// ── 3. Multi-track Chord Progression ─────────────────────────────────────────
function makeChordDemo() {
  const midi = new Midi()
  midi.header.setTempo(108)
  const s = spb(108)

  // Lead melody — Strings
  const mel = midi.addTrack()
  mel.name = 'Melody'
  mel.instrument.number = 48 // String Ensemble 1

  // Chords — Electric Piano
  const chd = midi.addTrack()
  chd.name = 'Chords'
  chd.instrument.number = 4  // Electric Piano 1

  // Bass
  const bas = midi.addTrack()
  bas.name = 'Bass'
  bas.instrument.number = 33 // Electric Bass (finger)

  // Chord progression: C – Am – F – G (4 beats each)
  // chord = [root(bass octave), ...chord notes]
  const prog = [
    { bass: 48, notes: [60, 64, 67] }, // C  — C3, C4 E4 G4
    { bass: 45, notes: [57, 60, 64] }, // Am — A2, A3 C4 E4
    { bass: 41, notes: [53, 57, 60] }, // F  — F2, F3 A3 C4
    { bass: 43, notes: [55, 59, 62] }, // G  — G2, G3 B3 D4
  ]

  // Melody notes — one per beat, 4 per chord (16 total per repeat)
  const melNotes = [
    72, 71, 69, 67,   // over C  :  C5 B4 A4 G4
    69, 67, 64, 62,   // over Am :  A4 G4 E4 D4
    65, 67, 69, 67,   // over F  :  F4 G4 A4 G4
    67, 69, 71, 72,   // over G  :  G4 A4 B4 C5
  ]

  for (let rep = 0; rep < 3; rep++) {
    const off = rep * 16 // 4 chords × 4 beats

    prog.forEach(({ bass, notes }, ci) => {
      const bo = off + ci * 4

      // Bass: walking quarter notes
      addNote(bas, bass,     bo,     1, s, 0.75)
      addNote(bas, bass + 7, bo + 1, 1, s, 0.65)
      addNote(bas, bass,     bo + 2, 1, s, 0.70)
      addNote(bas, bass + 5, bo + 3, 1, s, 0.60)

      // Chords: held for most of the bar, slight roll
      notes.forEach((n, ni) => addNote(chd, n, bo + ni * 0.03, 3.7, s, 0.55))
    })

    // Melody
    melNotes.forEach((n, i) => addNote(mel, n, off + i, 0.9, s, rep === 2 ? 0.9 : 0.82))
  }

  // Final chord hold
  addNote(mel, 72, 48, 3, s, 0.9)
  ;[60, 64, 67].forEach((n, i) => addNote(chd, n, 48 + i * 0.04, 3, s, 0.6))
  addNote(bas, 48, 48, 3, s, 0.8)

  return midi
}

// ── URL-based loader ──────────────────────────────────────────────────────────
// Fetches a MIDI file from the public/midi/ folder and parses it.
// The path is relative so it works both in dev (/) and on GitHub Pages (subdir).
async function midiFromFile(filename) {
  const url = `./midi/${encodeURIComponent(filename)}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch ${filename}: ${res.status}`)
  const buf = await res.arrayBuffer()
  return new Midi(buf)
}

// Helper to build a URL-based song entry
function fileSong(id, name, description, emoji, filename) {
  return { id, name, description, emoji, getMidi: () => midiFromFile(filename) }
}

// ── Exports ───────────────────────────────────────────────────────────────────
export const DEMO_SONGS = [
  // ── Built-in (programmatic) ──────────────────────────────────────────────
  {
    id: 'scale',
    name: 'C Major Scale',
    description: 'Ascending & descending scale with a final chord',
    emoji: '🎹',
    group: 'Built-in',
    getMidi: async () => makeCMajorScale(),
  },
  {
    id: 'twinkle',
    name: 'Twinkle Twinkle',
    description: 'Classic nursery rhyme — single track melody',
    emoji: '⭐',
    group: 'Built-in',
    getMidi: async () => makeTwinkle(),
  },
  {
    id: 'chords',
    name: 'Chord Progression',
    description: 'C – Am – F – G with melody, chords & bass',
    emoji: '🎵',
    group: 'Built-in',
    getMidi: async () => makeChordDemo(),
  },

  // ── Classical ────────────────────────────────────────────────────────────
  fileSong('moonlight',  'Moonlight Sonata',      'Ludwig van Beethoven',                  '🌙', 'beethoven-moonlight-sonata.mid'),
  fileSong('russian',    'Russian Dance (Trepak)', 'P.I. Tchaikovsky — The Nutcracker',     '🩰', 'tchaikovsky-russian-dance.mid'),

  // ── Pop & Rock ───────────────────────────────────────────────────────────
  fileSong('immortal',   'My Immortal',           'Evanescence',                           '🖤', 'inmortalevanescence.mid'),
  fileSong('dontspeak',  "Don't Speak",            'No Doubt',                              '🎤', "Don't_Speak.mid"),
  fileSong('vangogh',    'Aunque no te pueda ver', 'Alex Ubago',                            '🎸', 'aunquenotepuedaveralexubago.mid'),

  // ── Ambient / Electronic ─────────────────────────────────────────────────
  fileSong('bluedream',  'Blue Dream',             'Multi-track ambient arrangement',       '💙', 'bluedream.mid'),
  fileSong('mimefab',    'Mime',                   'Orchestral piece by Fabien ROYER',      '🎻', 'mimefab.mid'),

  // ── Saint Seiya ──────────────────────────────────────────────────────────
  fileSong('ikki',       "Ikki's Theme",           'Saint Seiya — Phoenix',                 '🔥', 'Ikki.mid'),
  fileSong('athena',     "Athena's Theme",          'Saint Seiya',                           '🏛️', 'ssathena.mid'),
  fileSong('asgard',     'Asgard War',             'Saint Seiya — Nordic arc',              '⚔️', 'asgardwar.mid'),
  fileSong('hilda',      "Hilda's Theme",          'Saint Seiya',                           '🌹', 'hilda.mid'),
  fileSong('abel',       "Abel's Theme",           'Saint Seiya — Evil Twin',               '🌑', 'abel.mid'),
  fileSong('abelathena', 'Abel & Athena 2',        'Saint Seiya',                           '✨', 'abelathena2.mid'),
  fileSong('balmung',    'Balmung',                'Saint Seiya — Asgard',                  '🗡️', 'balmung.mid'),
  fileSong('pegasus',    'Fantasy Pegasus 2',      'Saint Seiya fan arrangement',           '🦄', 'fantasy pegasus 2.mid'),
]
