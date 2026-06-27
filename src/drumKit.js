import * as Tone from 'tone'

// A small synthesized General MIDI drum kit.
//
// The GM drum channel (channel 10) encodes *which* drum in the note's pitch,
// not a melody — so it can't be played by a melodic soundfont. This builds a
// handful of Tone.js voices (membrane for kick/toms, filtered noise for snare,
// hats and cymbals) and dispatches each percussion note number to one of them,
// following the standard GM percussion key map.
//
// Returns { play(midi, time, velocity), dispose() }. Each voice is monophonic,
// but the voices are independent so a simultaneous kick + snare + hat all sound.
export function createDrumKit() {
  const out = new Tone.Gain(0.9).toDestination()

  const kick = new Tone.MembraneSynth({
    pitchDecay: 0.03, octaves: 6,
    envelope: { attack: 0.001, decay: 0.34, sustain: 0 },
  }).connect(out)

  const tom = new Tone.MembraneSynth({
    pitchDecay: 0.05, octaves: 4,
    envelope: { attack: 0.001, decay: 0.3, sustain: 0 },
  }).connect(out)

  const snareFilter = new Tone.Filter(1800, 'bandpass').connect(out)
  const snare = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: 0.18, sustain: 0 },
  }).connect(snareFilter)

  const hatFilter = new Tone.Filter(8000, 'highpass').connect(out)
  const closedHat = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: 0.04, sustain: 0 },
  }).connect(hatFilter)
  const openHat = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: 0.4, sustain: 0 },
  }).connect(hatFilter)

  const cymbalFilter = new Tone.Filter(5000, 'highpass').connect(out)
  const cymbal = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: 1.2, sustain: 0 },
  }).connect(cymbalFilter)

  // Tom note → membrane pitch (low → high)
  const TOM_PITCH = { 41: 'G1', 43: 'A1', 45: 'C2', 47: 'D2', 48: 'E2', 50: 'G2' }

  function play(midi, time, velocity = 0.8) {
    const v = Math.min(1, Math.max(0.05, velocity))
    switch (midi) {
      case 35: case 36:                                // bass drums
        kick.triggerAttackRelease('C1', 0.3, time, v); break
      case 37:                                         // side stick
        snare.triggerAttackRelease(0.05, time, v * 0.6); break
      case 38: case 40:                                // snares
        snare.triggerAttackRelease(0.18, time, v); break
      case 39:                                         // hand clap
        snare.triggerAttackRelease(0.12, time, v * 0.8); break
      case 42: case 44:                                // closed / pedal hi-hat
        closedHat.triggerAttackRelease(0.04, time, v * 0.7); break
      case 46:                                         // open hi-hat
        openHat.triggerAttackRelease(0.4, time, v * 0.6); break
      case 49: case 52: case 55: case 57:              // crash cymbals
        cymbal.triggerAttackRelease(1.2, time, v * 0.5); break
      case 51: case 53: case 59:                       // ride cymbals
        cymbal.triggerAttackRelease(0.55, time, v * 0.4); break
      case 41: case 43: case 45: case 47: case 48: case 50: // toms
        tom.triggerAttackRelease(TOM_PITCH[midi] ?? 'C2', 0.25, time, v); break
      default:                                         // anything else → soft tick
        closedHat.triggerAttackRelease(0.05, time, v * 0.5); break
    }
  }

  function dispose() {
    [kick, tom, snare, closedHat, openHat, cymbal,
     snareFilter, hatFilter, cymbalFilter, out].forEach(n => {
      try { n.dispose() } catch { /* ignore */ }
    })
  }

  return { play, dispose }
}
