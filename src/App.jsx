import { useState, useRef, useCallback, useMemo, useEffect } from 'react'
import { Midi } from '@tonejs/midi'
import * as Tone from 'tone'
import Soundfont from 'soundfont-player'
import PianoRoll from './PianoRoll.jsx'
import { GM_INSTRUMENTS, gmDisplayName, GM_FAMILY_LABELS } from './gmInstruments.js'
import { createDrumKit } from './drumKit.js'
import { DEMO_SONGS } from './demoSongs.js'
import './App.css'

const ZOOM_STEP  = 1.25
const H_ZOOM_MIN = 0.25;  const H_ZOOM_MAX = 8
const V_ZOOM_MIN = 0.33;  const V_ZOOM_MAX = 4

const TRACK_COLORS = [
  '#4fc3f7','#81c784','#ffb74d','#f06292',
  '#ce93d8','#80cbc4','#fff176','#ff8a65',
]

export default function App() {
  const [midi, setMidi]               = useState(null)
  const [fileName, setFileName]       = useState(null)
  const [isPlaying, setIsPlaying]     = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [isPreviewMode, setIsPreviewMode] = useState(false)
  const [hZoom, setHZoom]             = useState(1)
  const [vZoom, setVZoom]             = useState(1)
  const [noteNameMode, setNoteNameMode] = useState('off')
  // Soundfont loading state
  const [loadingInstruments, setLoadingInstruments] = useState(false)
  const [loadedPrograms, setLoadedPrograms]         = useState(new Set())
  // Per-track user overrides, keyed by the track's original index in midi.tracks:
  //   { muted: bool, programOverride: number | null }
  // A programOverride lets a track (including the drum channel) play a chosen
  // GM instrument instead of being silent / using its embedded program.
  const [trackSettings, setTrackSettings] = useState({})
  // How muted tracks appear in the roll: 'dim' (faint) or 'hide' (not drawn).
  const [mutedDisplay, setMutedDisplay] = useState('dim')

  const synthRef        = useRef(null)   // fallback PolySynth
  const animFrameRef    = useRef(null)
  const seekPosRef      = useRef(0)
  const instrumentsRef  = useRef({})     // { programNumber → Soundfont instrument }
  const drumKitRef      = useRef(null)   // synthesized GM drum kit

  const NOTE_NAME_CYCLE = { off: 'american', american: 'solfege', solfege: 'off' }
  const NOTE_NAME_LABEL = { off: '♩', american: 'ABC', solfege: 'Do' }

  // ── Derived ───────────────────────────────────────────────────────────────
  const duration = useMemo(() => {
    if (!midi) return 0
    const all = midi.tracks.flatMap(t => t.notes)
    return all.length ? Math.max(...all.map(n => n.time + n.duration)) : 0
  }, [midi])

  // Tracks that have at least one note (for display & loading)
  const activeTracks = useMemo(() => {
    if (!midi) return []
    return midi.tracks
      .map((t, i) => ({ track: t, originalIndex: i }))
      .filter(({ track }) => track.notes.length > 0)
  }, [midi])

  // ── Per-track helpers ──────────────────────────────────────────────────────
  // Effective GM program for a track: the user's override if set, else the
  // track's own program. Percussion tracks have no program of their own, so
  // they only become audible once the user picks an override (returns null).
  const effectiveProgram = useCallback((track, originalIndex) => {
    const override = trackSettings[originalIndex]?.programOverride
    if (override != null) return override
    return track.instrument.percussion ? null : track.instrument.number
  }, [trackSettings])

  // Original indices of tracks the user has muted (also used to dim the roll).
  const mutedTracks = useMemo(() => {
    const s = new Set()
    for (const i of Object.keys(trackSettings))
      if (trackSettings[i]?.muted) s.add(Number(i))
    return s
  }, [trackSettings])

  // Reset overrides when a new file/demo loads.
  useEffect(() => { setTrackSettings({}) }, [midi])

  // Drop cached instruments when the MIDI changes (loading effect refills them).
  useEffect(() => {
    instrumentsRef.current = {}
    setLoadedPrograms(new Set())
  }, [midi])

  // Sorted list of GM programs that any track currently needs a soundfont for.
  // Keyed string so the loading effect only re-runs when the *set* changes
  // (e.g. picking an instrument for the drum track), not on mute toggles.
  const neededPrograms = useMemo(() => {
    const set = new Set()
    for (const { track, originalIndex } of activeTracks) {
      const prog = effectiveProgram(track, originalIndex)
      if (prog != null) set.add(prog)
    }
    return [...set].sort((a, b) => a - b).join(',')
  }, [activeTracks, effectiveProgram])

  // ── Load soundfonts for any program not yet cached ────────────────────────
  useEffect(() => {
    if (!midi || !neededPrograms) return

    const programs = neededPrograms.split(',').map(Number)
    const toLoad   = programs.filter(p => !(p in instrumentsRef.current))
    if (!toLoad.length) return

    setLoadingInstruments(true)
    const ac = Tone.getContext().rawContext

    let cancelled = false
    const loaded = new Set(loadedPrograms)

    Promise.allSettled(
      toLoad.map(async (prog) => {
        const name = GM_INSTRUMENTS[prog] ?? 'acoustic_grand_piano'
        try {
          const inst = await Soundfont.instrument(ac, name, {
            soundfont: 'MusyngKite',
            gain: 5,
          })
          if (!cancelled) {
            instrumentsRef.current[prog] = inst
            loaded.add(prog)
            setLoadedPrograms(new Set(loaded))
          }
        } catch {
          // Try piano as fallback
          try {
            const inst = await Soundfont.instrument(ac, 'acoustic_grand_piano', { gain: 5 })
            if (!cancelled) {
              instrumentsRef.current[prog] = inst
              loaded.add(prog)
              setLoadedPrograms(new Set(loaded))
            }
          } catch { /* give up, will use PolySynth */ }
        }
      })
    ).finally(() => {
      if (!cancelled) setLoadingInstruments(false)
    })

    return () => { cancelled = true }
  }, [midi, neededPrograms]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Track control handlers ─────────────────────────────────────────────────
  const toggleMute = useCallback((originalIndex) => {
    setTrackSettings(prev => ({
      ...prev,
      [originalIndex]: { ...prev[originalIndex], muted: !prev[originalIndex]?.muted },
    }))
  }, [])

  const setProgramOverride = useCallback((originalIndex, value) => {
    // value is '' (clear override) or a program number as a string
    const programOverride = value === '' ? null : Number(value)
    setTrackSettings(prev => ({
      ...prev,
      [originalIndex]: { ...prev[originalIndex], programOverride },
    }))
  }, [])

  // ── Fallback PolySynth ────────────────────────────────────────────────────
  const ensureSynth = () => {
    if (!synthRef.current) {
      synthRef.current = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'triangle8' },
        envelope: { attack: 0.02, decay: 0.1, sustain: 0.5, release: 0.8 },
        volume: -12,
      }).toDestination()
    }
  }

  // ── Synthesized drum kit (for the GM percussion channel) ──────────────────
  const ensureDrumKit = () => {
    if (!drumKitRef.current) drumKitRef.current = createDrumKit()
  }

  const startAnimLoop = useCallback(() => {
    const tick = () => {
      setCurrentTime(Tone.Transport.seconds)
      animFrameRef.current = requestAnimationFrame(tick)
    }
    tick()
  }, [])

  // Stop all soundfont notes that may still be ringing
  const stopAllInstruments = useCallback(() => {
    Object.values(instrumentsRef.current).forEach(inst => {
      try { inst.stop() } catch { /* ignore */ }
    })
    synthRef.current?.releaseAll()
  }, [])

  // Schedule all tracks using their per-program soundfont (fallback to PolySynth)
  const scheduleNotes = useCallback(() => {
    Tone.Transport.cancel()
    if (!midi) return

    for (const { track, originalIndex } of activeTracks) {
      if (mutedTracks.has(originalIndex)) continue        // user-muted

      const prog = effectiveProgram(track, originalIndex)

      // Percussion track with no melodic override → synthesized drum kit
      if (prog == null) {
        ensureDrumKit()
        for (const note of track.notes) {
          Tone.Transport.schedule((time) => {
            drumKitRef.current?.play(note.midi, time, note.velocity)
          }, note.time)
        }
        continue
      }

      for (const note of track.notes) {
        Tone.Transport.schedule((time) => {
          const inst = instrumentsRef.current[prog]
          if (inst) {
            inst.play(note.name, time, {
              duration: Math.max(note.duration, 0.05),
              gain:     note.velocity,
            })
          } else {
            ensureSynth()
            synthRef.current?.triggerAttackRelease(
              note.name, Math.max(note.duration, 0.05), time, note.velocity,
            )
          }
        }, note.time)
      }
    }

    // Auto-stop when the piece ends
    Tone.Transport.schedule(() => {
      cancelAnimationFrame(animFrameRef.current)
      stopAllInstruments()
      seekPosRef.current = 0
      setCurrentTime(0)
      setIsPlaying(false)
    }, duration + 0.2)
  }, [midi, duration, activeTracks, stopAllInstruments, mutedTracks, effectiveProgram])

  // ── Demo loader ───────────────────────────────────────────────────────────
  const loadDemo = useCallback(async (demo) => {
    Tone.Transport.stop()
    Tone.Transport.cancel()
    stopAllInstruments()
    cancelAnimationFrame(animFrameRef.current)
    seekPosRef.current = 0
    setIsPlaying(false)
    setCurrentTime(0)
    setFileName(`⏳ Loading ${demo.name}…`)
    try {
      const midiData = await demo.getMidi()
      setMidi(midiData)
      setFileName(demo.name)
    } catch (err) {
      console.error('Failed to load demo:', err)
      setFileName('⚠️ Load failed')
    }
  }, [stopAllInstruments])

  // ── File loading ──────────────────────────────────────────────────────────
  const handleFileLoad = useCallback(async (e) => {
    const file = e.target.files[0]
    if (!file) return
    Tone.Transport.stop()
    Tone.Transport.cancel()
    stopAllInstruments()
    cancelAnimationFrame(animFrameRef.current)
    seekPosRef.current = 0
    setIsPlaying(false)
    setCurrentTime(0)
    const buf = await file.arrayBuffer()
    setMidi(new Midi(buf))
    setFileName(file.name)
    e.target.value = ''
  }, [stopAllInstruments])

  // ── Transport controls ────────────────────────────────────────────────────
  const handlePlayPause = useCallback(async () => {
    if (!midi) return
    if (isPlaying) {
      const pos = Tone.Transport.seconds
      Tone.Transport.stop()
      Tone.Transport.cancel()
      stopAllInstruments()
      cancelAnimationFrame(animFrameRef.current)
      seekPosRef.current = pos
      setCurrentTime(pos)
      setIsPlaying(false)
    } else {
      await Tone.start()
      ensureSynth()
      scheduleNotes()
      Tone.Transport.start('+0.05', seekPosRef.current)
      setIsPlaying(true)
      startAnimLoop()
    }
  }, [midi, isPlaying, scheduleNotes, startAnimLoop, stopAllInstruments])

  // Spacebar toggles play/pause (unless typing in a form control)
  useEffect(() => {
    const onKey = (e) => {
      if (e.code !== 'Space' && e.key !== ' ') return
      const tag = e.target?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return
      e.preventDefault()  // stop page scroll / activating a focused button
      handlePlayPause()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handlePlayPause])

  const handleStop = useCallback(() => {
    Tone.Transport.stop()
    Tone.Transport.cancel()
    stopAllInstruments()
    cancelAnimationFrame(animFrameRef.current)
    seekPosRef.current = 0
    setCurrentTime(0)
    setIsPlaying(false)
  }, [stopAllInstruments])

  const seekTo = useCallback(async (time) => {
    if (!midi) return
    const t = Math.max(0, Math.min(time, duration))
    if (isPlaying) {
      cancelAnimationFrame(animFrameRef.current)
      stopAllInstruments()
      Tone.Transport.stop()
      ensureSynth()
      scheduleNotes()
      Tone.Transport.start('+0.05', t)
      setCurrentTime(t)
      startAnimLoop()
    } else {
      seekPosRef.current = t
      setCurrentTime(t)
    }
  }, [midi, isPlaying, duration, scheduleNotes, startAnimLoop, stopAllInstruments])

  const handleJumpStart = useCallback(() => seekTo(0),        [seekTo])
  const handleJumpEnd   = useCallback(() => seekTo(duration), [seekTo, duration])

  // ── Zoom helpers ──────────────────────────────────────────────────────────
  const clampH = (z) => Math.max(H_ZOOM_MIN, Math.min(H_ZOOM_MAX, z))
  const clampV = (z) => Math.max(V_ZOOM_MIN, Math.min(V_ZOOM_MAX, z))
  const zoomLabel = (z) => `${Math.round(z * 100)}%`

  // ── Formatting ────────────────────────────────────────────────────────────
  const fmt = (s) => {
    const m  = Math.floor(s / 60).toString().padStart(2, '0')
    const ss = Math.floor(s % 60).toString().padStart(2, '0')
    const t  = Math.floor((s % 1) * 10)
    return `${m}:${ss}.${t}`
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="app">
      <header className="header">
        <span className="logo">Piano Roll</span>

        {/* Transport */}
        <div className="transport">
          <button className="btn" onClick={handleJumpStart} disabled={!midi} title="Jump to start">⏮</button>
          <button
            className={`btn ${isPlaying ? 'btn-pause' : 'btn-play'}`}
            onClick={handlePlayPause} disabled={!midi}
            title={isPlaying ? 'Pause' : 'Play'}
          >{isPlaying ? '⏸' : '▶'}</button>
          <button className="btn btn-stop" onClick={handleStop} disabled={!midi} title="Stop">⏹</button>
          <button className="btn" onClick={handleJumpEnd} disabled={!midi} title="Jump to end">⏭</button>
        </div>

        <div className="toolbar-sep" />

        {/* Preview scrub */}
        <button
          className={`btn btn-preview ${isPreviewMode ? 'btn-preview--active' : ''}`}
          onClick={() => setIsPreviewMode(v => !v)}
          disabled={!midi}
          title="Preview tool — click & drag to hear notes"
        >
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
            <polygon points="7,1 3.5,4.5 1,4.5 1,10.5 3.5,10.5 7,14" fill="currentColor" />
            <path d="M9.5,5 a3,3 0 0,1 0,5"  stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round"/>
            <path d="M12,3 a6,6 0 0,1 0,9"   stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round"/>
          </svg>
        </button>

        {/* Note name labels */}
        <button
          className={`btn btn-note-names ${noteNameMode !== 'off' ? 'btn-note-names--active' : ''}`}
          onClick={() => setNoteNameMode(m => NOTE_NAME_CYCLE[m])}
          disabled={!midi}
          title="Note labels: off → American → Solfège"
        >{NOTE_NAME_LABEL[noteNameMode]}</button>

        <div className="toolbar-sep" />

        {/* Horizontal zoom */}
        <div className="zoom-group" title="Horizontal zoom  (Ctrl + scroll)">
          <span className="zoom-label">↔</span>
          <button className="btn zoom-btn" onClick={() => setHZoom(z => clampH(z / ZOOM_STEP))} disabled={!midi}>−</button>
          <button className="zoom-value" onClick={() => setHZoom(1)} disabled={!midi} title="Reset">{zoomLabel(hZoom)}</button>
          <button className="btn zoom-btn" onClick={() => setHZoom(z => clampH(z * ZOOM_STEP))} disabled={!midi}>+</button>
        </div>

        {/* Vertical zoom */}
        <div className="zoom-group" title="Vertical zoom  (Alt + scroll)">
          <span className="zoom-label">↕</span>
          <button className="btn zoom-btn" onClick={() => setVZoom(z => clampV(z / ZOOM_STEP))} disabled={!midi}>−</button>
          <button className="zoom-value" onClick={() => setVZoom(1)} disabled={!midi} title="Reset">{zoomLabel(vZoom)}</button>
          <button className="btn zoom-btn" onClick={() => setVZoom(z => clampV(z * ZOOM_STEP))} disabled={!midi}>+</button>
        </div>

        <div className="toolbar-sep" />

        {/* Time */}
        <div className="time-display">
          <span className="time-current">{fmt(currentTime)}</span>
          <span className="time-sep">/</span>
          <span className="time-total">{fmt(duration)}</span>
        </div>

        <div className="load-controls">
          <label className="load-btn">
            Load MIDI
            <input type="file" accept=".mid,.midi" onChange={handleFileLoad} style={{ display: 'none' }} />
          </label>
          <select
            className="demo-select"
            value=""
            onChange={e => {
              const demo = DEMO_SONGS.find(d => d.id === e.target.value)
              if (demo) loadDemo(demo)
            }}
          >
            <option value="" disabled>Demos ▾</option>
            {(() => {
              const groups = [...new Set(DEMO_SONGS.map(d => d.group || 'Other'))]
              return groups.map(g => (
                <optgroup key={g} label={g}>
                  {DEMO_SONGS.filter(d => (d.group || 'Other') === g).map(d => (
                    <option key={d.id} value={d.id}>{d.emoji} {d.name}</option>
                  ))}
                </optgroup>
              ))
            })()}
          </select>
        </div>

        {fileName && <span className="file-name">{fileName}</span>}
      </header>

      {/* ── Track strip ───────────────────────────────────────────────────── */}
      {midi && activeTracks.length > 0 && (
        <div className="track-strip">
          {activeTracks.map(({ track, originalIndex }) => {
            const color    = TRACK_COLORS[originalIndex % TRACK_COLORS.length]
            const isPerc   = track.instrument.percussion
            const settings = trackSettings[originalIndex]
            const muted    = !!settings?.muted
            const override = settings?.programOverride ?? null
            const prog     = effectiveProgram(track, originalIndex)  // null ⇒ drum kit
            const isReady  = prog == null || loadedPrograms.has(prog)
            const label    = track.name || track.instrument.name || `Track ${originalIndex + 1}`
            // Select value: '' = no override (perc → drum kit, melodic → embedded program)
            const selectValue = override != null ? String(override) : String(prog ?? '')
            return (
              <div key={originalIndex} className={`track-chip ${muted ? 'track-chip--muted' : ''}`}>
                <button
                  className="track-chip-mute"
                  onClick={() => toggleMute(originalIndex)}
                  title={muted ? 'Unmute track' : 'Mute track'}
                >{muted ? '🔇' : '🔊'}</button>
                <div className="track-chip-dot" style={{ background: color }} />
                <div className="track-chip-text">
                  <span className="track-chip-name">{label}</span>
                  <select
                    className="track-chip-select"
                    value={selectValue}
                    onChange={e => setProgramOverride(originalIndex, e.target.value)}
                    title={isPerc ? 'Drum track — drum kit, or pick a melodic instrument' : 'Change instrument'}
                  >
                    {isPerc && <option value="">🥁 Drum kit</option>}
                    {GM_FAMILY_LABELS.map((fam, fi) => (
                      <optgroup key={fam} label={fam}>
                        {Array.from({ length: 8 }, (_, k) => fi * 8 + k).map(p => (
                          <option key={p} value={p}>{gmDisplayName(p)}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
                {!isReady && loadingInstruments && (
                  <span className="track-chip-spinner" />
                )}
              </div>
            )
          })}
          {mutedTracks.size > 0 && (
            <button
              className="muted-display-toggle"
              onClick={() => setMutedDisplay(m => (m === 'dim' ? 'hide' : 'dim'))}
              title="Toggle how muted tracks appear in the roll"
            >{mutedDisplay === 'dim' ? '◐ Muted: dimmed' : '○ Muted: hidden'}</button>
          )}
        </div>
      )}

      <main className="main">
        {midi ? (
          <PianoRoll
            midi={midi}
            currentTime={currentTime}
            duration={duration}
            onSeek={seekTo}
            isPreviewMode={isPreviewMode}
            hZoom={hZoom}
            vZoom={vZoom}
            onHZoomChange={(z) => setHZoom(clampH(z))}
            onVZoomChange={(z) => setVZoom(clampV(z))}
            noteNameMode={noteNameMode}
            mutedTracks={mutedTracks}
            mutedDisplay={mutedDisplay}
          />
        ) : (
          <div className="empty-state">
            <div className="empty-icon">🎹</div>
            <h2 className="empty-title">MIDI Piano Roll</h2>
            <p className="empty-sub">Visualize and play MIDI files with GM soundfonts</p>

            <label className="load-btn load-btn--hero">
              📁 Load from Computer
              <input type="file" accept=".mid,.midi" onChange={handleFileLoad} style={{ display: 'none' }} />
            </label>

            <div className="demo-divider"><span>or try a demo</span></div>

            <div className="demo-library">
              {(() => {
                const groups = [...new Set(DEMO_SONGS.map(d => d.group || 'Other'))]
                return groups.map(g => (
                  <div key={g} className="demo-group">
                    <div className="demo-group-label">{g}</div>
                    <div className="demo-grid">
                      {DEMO_SONGS.filter(d => (d.group || 'Other') === g).map(demo => (
                        <button
                          key={demo.id}
                          className="demo-card"
                          onClick={() => loadDemo(demo)}
                        >
                          <span className="demo-card-emoji">{demo.emoji}</span>
                          <span className="demo-card-name">{demo.name}</span>
                          <span className="demo-card-desc">{demo.description}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))
              })()}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
