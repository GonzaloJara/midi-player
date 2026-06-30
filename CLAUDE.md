# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Vite dev server (hot reload)
npm run build    # Production build → dist/
npm run preview  # Serve the production build locally
```

There is no test suite, linter, or type-checker configured. The only npm scripts are the three Vite commands above.

## Deployment

Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds and publishes `dist/` to GitHub Pages. `vite.config.js` sets `base: './'` so all asset paths are relative — this is deliberate and must stay relative so the app works both at a domain root and under a GitHub Pages sub-path. Demo MIDI files are fetched at runtime with relative `./midi/...` URLs for the same reason.

## Architecture

A single-page React 18 + Vite app (no router, no state library) that visualizes and plays MIDI files as a piano roll. There are only two components.

**[src/App.jsx](src/App.jsx) — playback engine & app shell.** Owns all transport state and audio. Key flows:
- **Audio stack:** [@tonejs/midi](https://github.com/Tonejs/Midi) parses files into a `Midi` object; [Tone.js](https://tonejs.github.io/) `Transport` drives scheduling/timing; [soundfont-player](https://github.com/danigb/soundfont-player) renders realistic GM instruments (MusyngKite soundfont). A `Tone.PolySynth` is the fallback when a soundfont fails to load.
- **Per-program instrument loading:** a `useEffect` keyed on `midi` collects the unique GM program numbers across non-percussion tracks and loads one soundfont per program into `instrumentsRef.current` (`{ programNumber → instrument }`). Loading is async and tracked via `loadedPrograms`/`loadingInstruments` for the track-strip UI. A `cancelled` flag guards against stale loads when the MIDI changes mid-load.
- **Scheduling:** `scheduleNotes()` calls `Tone.Transport.schedule` for every note of every audible track, picking the track's soundfont instrument (or the fallback synth). A muted track is skipped. A **percussion track (`track.instrument.percussion`) with no instrument override** has no melodic program (`effectiveProgram()` returns `null`) and is routed to the synthesized drum kit instead; assigning it a melodic instrument override switches it to that soundfont.
- **Drum kit ([src/drumKit.js](src/drumKit.js)):** there is no drum-kit soundfont, so the GM drum channel is synthesized with Tone.js voices (membrane kick/toms, filtered-noise snare/hats/cymbals) dispatched by the standard GM percussion key map. `createDrumKit()` returns `{ play(midi, time, velocity), dispose() }`; App lazily builds one into `drumKitRef`.
- **Per-track controls:** `trackSettings` (keyed by a track's original index in `midi.tracks`) holds `{ muted, programOverride }`. The track-strip chips expose a mute toggle and an instrument `<select>` (drum tracks default to "🥁 Drum kit"). `effectiveProgram()` resolves override-or-embedded program (`null` ⇒ drum kit); `neededPrograms` (a sorted, comma-joined key) drives additive soundfont loading so toggling mute doesn't reload instruments. `mutedTracks` + `mutedDisplay` ('dim'/'hide') are passed to PianoRoll, which dims or hides those notes and excludes them from the preview scrub.
- **Transport quirks:** play/pause/seek all `cancel()` the Transport, re-`scheduleNotes()`, and restart at `seekPosRef.current`. The current playhead time comes from a `requestAnimationFrame` loop reading `Tone.Transport.seconds` into `currentTime` state (not React-driven timing).

**[src/PianoRoll.jsx](src/PianoRoll.jsx) — pure canvas renderer + interaction.** Receives `midi`, `currentTime`, zoom, etc. as props; owns no playback state. Renders three separate `<canvas>` layers (timeline ruler, note grid, piano keys) plus DOM playhead/preview-line overlays.
- **Coordinate model:** x = `(PADDING_SEC + time) * pxPerSec`, y = `(maxNote - midiNumber) * noteH`. `pxPerSec` and `noteH` derive from `BASE_*` constants times `hZoom`/`vZoom`. Many handlers convert between pixels and time/pitch — keep this mapping consistent if you touch layout.
- **Pitch range** auto-fits to the notes present (±3 semitones), so the visible keyboard changes per song.
- **Scroll sync:** the piano-keys column lives outside the scroll container; its `scrollTop` is mirrored manually in `syncKeysScroll`. Zoom uses `hScrollAfterZoom`/`vScrollAfterZoom` refs to keep the point under the cursor stable across a zoom (applied in a follow-up effect).
- **Preview ("scrub") mode:** a separate `Tone.PolySynth` (`previewSynthRef`) plays whatever notes are under the cursor as you drag, independent of the main transport. Toggled by `isPreviewMode` from App.

**[src/demoSongs.js](src/demoSongs.js) — `DEMO_SONGS` registry.** Each entry has a `getMidi()` returning a `Midi`. Two kinds: programmatic songs built note-by-note (`makeCMajorScale`, `makeTwinkle`, `makeChordDemo`) and `fileSong(...)` entries that fetch a `.mid` from [public/midi/](public/midi). Entries are grouped via the `group` field for the picker UI. To add a file-based demo: drop the `.mid` in `public/midi/` and add a `fileSong(...)` line.

**[src/gmInstruments.js](src/gmInstruments.js) — GM program tables.** `GM_INSTRUMENTS[programNumber]` maps a General MIDI program (0–127) to a soundfont-player instrument name (gleitz/midi-js-soundfonts naming); `gmDisplayName()` produces a human label. Index order matters — it must match the GM standard.

## Conventions

- Track colors are an 8-entry palette indexed by `trackIndex % 8`. The **same palette is duplicated** in [App.jsx](src/App.jsx) and [PianoRoll.jsx](src/PianoRoll.jsx) — keep them in sync if changed.
- `App.jsx` filters to `activeTracks` (tracks with `notes.length > 0`) but preserves each track's `originalIndex` so colors stay stable; `PianoRoll.jsx` flattens *all* tracks and colors by raw `trackIndex`.
