import { useRef, useEffect, useMemo, useCallback, useState } from 'react'
import * as Tone from 'tone'
import './PianoRoll.css'

// ── Base layout constants (zoom multiplies these) ─────────────────────────────
const BASE_PX_PER_SEC  = 120
const BASE_NOTE_HEIGHT = 9
const PIANO_WIDTH      = 60
const PADDING_SEC      = 1
const TIMELINE_HEIGHT  = 28

const TRACK_COLORS = [
  '#4fc3f7', '#81c784', '#ffb74d', '#f06292',
  '#ce93d8', '#80cbc4', '#fff176', '#ff8a65',
]

const BLACK_SEMITONES = new Set([1, 3, 6, 8, 10])
const isBlack  = (m) => BLACK_SEMITONES.has(m % 12)
const NOTE_NAMES    = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
const SOLFEGE_NAMES = ['Do','Do♯','Re','Re♯','Mi','Fa','Fa♯','Sol','Sol♯','La','La♯','Si']
const noteName   = (m) => NOTE_NAMES[m % 12] + (Math.floor(m / 12) - 1)

// ─────────────────────────────────────────────────────────────────────────────
export default function PianoRoll({
  midi, currentTime, duration, onSeek, isPreviewMode,
  hZoom, vZoom, onHZoomChange, onVZoomChange,
  noteNameMode,
}) {
  const rollCanvasRef     = useRef(null)
  const keysCanvasRef     = useRef(null)
  const timelineCanvasRef = useRef(null)
  const scrollRef         = useRef(null)
  const keysScrollRef     = useRef(null)   // mirrors roll's scrollTop for key sync

  // After a zoom we want to correct the scroll so the cursor position is stable.
  // We store the desired scrollLeft/Top here and apply it in the next effect.
  const hScrollAfterZoom = useRef(null)
  const vScrollAfterZoom = useRef(null)

  // ── Preview scrub state ───────────────────────────────────────────────────
  const [previewLineX, setPreviewLineX]           = useState(null)
  const [previewActiveMidi, setPreviewActiveMidi] = useState(new Set())
  const previewSynthRef  = useRef(null)
  const previewActiveRef = useRef(new Set())
  const previewDownRef   = useRef(false)

  // ── Effective zoom values ────────────────────────────────────────────────
  const pxPerSec = BASE_PX_PER_SEC  * hZoom
  const noteH    = Math.max(3, BASE_NOTE_HEIGHT * vZoom)

  // ── Flatten notes ─────────────────────────────────────────────────────────
  const notes = useMemo(() => {
    if (!midi) return []
    return midi.tracks.flatMap((track, trackIndex) =>
      track.notes.map(n => ({
        midi: n.midi, name: n.name, time: n.time,
        duration: n.duration, velocity: n.velocity, trackIndex,
      }))
    )
  }, [midi])

  // ── Pitch range ──────────────────────────────────────────────────────────
  const { maxNote, noteRange } = useMemo(() => {
    if (!notes.length) return { minNote: 48, maxNote: 84, noteRange: 37 }
    const vals = notes.map(n => n.midi)
    const min  = Math.max(0,   Math.min(...vals) - 3)
    const max  = Math.min(127, Math.max(...vals) + 3)
    return { minNote: min, maxNote: max, noteRange: max - min + 1 }
  }, [notes])

  // ── Active notes for key highlighting ────────────────────────────────────
  const activeNotes = useMemo(() => {
    const s = new Set()
    for (const n of notes)
      if (n.time <= currentTime && n.time + n.duration > currentTime) s.add(n.midi)
    return s
  }, [notes, currentTime])

  // ── Canvas dimensions ────────────────────────────────────────────────────
  const safeDur      = duration || 10
  const canvasWidth  = Math.ceil((safeDur + PADDING_SEC * 2) * pxPerSec)
  const canvasHeight = Math.ceil(noteRange * noteH)
  const totalHeight  = TIMELINE_HEIGHT + canvasHeight

  const bpm        = midi?.header?.tempos?.[0]?.bpm ?? 120
  const secPerBeat = 60 / bpm

  // ── Draw: timeline ruler ─────────────────────────────────────────────────
  const drawTimeline = useCallback(() => {
    const canvas = timelineCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    ctx.fillStyle = '#08080f'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.strokeStyle = '#2a2a44'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, TIMELINE_HEIGHT - 0.5)
    ctx.lineTo(canvas.width, TIMELINE_HEIGHT - 0.5)
    ctx.stroke()

    const totalBeats = Math.ceil((safeDur + PADDING_SEC * 2) / secPerBeat) + 2
    for (let b = 0; b <= totalBeats; b++) {
      const x      = (PADDING_SEC + b * secPerBeat) * pxPerSec
      const isBar  = b % 4 === 0
      const isHalf = b % 2 === 0

      if (isBar) {
        ctx.strokeStyle = '#3a3a60'
        ctx.lineWidth = 1
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, TIMELINE_HEIGHT - 1); ctx.stroke()
        ctx.fillStyle = '#7070b0'
        ctx.font = 'bold 10px monospace'
        ctx.textAlign = 'left'
        ctx.fillText(String(b / 4 + 1), x + 3, TIMELINE_HEIGHT - 9)
      } else if (isHalf) {
        ctx.strokeStyle = '#252540'
        ctx.lineWidth = 1
        ctx.beginPath(); ctx.moveTo(x, TIMELINE_HEIGHT - 10); ctx.lineTo(x, TIMELINE_HEIGHT - 1); ctx.stroke()
      } else {
        ctx.strokeStyle = '#1a1a30'
        ctx.lineWidth = 1
        ctx.beginPath(); ctx.moveTo(x, TIMELINE_HEIGHT - 5); ctx.lineTo(x, TIMELINE_HEIGHT - 1); ctx.stroke()
      }
    }
  }, [safeDur, secPerBeat, pxPerSec])

  // ── Draw: note grid ───────────────────────────────────────────────────────
  const drawRoll = useCallback(() => {
    const canvas = rollCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // Row backgrounds
    for (let i = 0; i < noteRange; i++) {
      ctx.fillStyle = isBlack(maxNote - i) ? '#111120' : '#17172a'
      ctx.fillRect(0, i * noteH, canvas.width, noteH)
    }

    // Octave lines (at C)
    for (let i = 0; i < noteRange; i++) {
      if ((maxNote - i) % 12 === 0) {
        ctx.strokeStyle = '#ffffff18'
        ctx.lineWidth = 1
        ctx.beginPath(); ctx.moveTo(0, i * noteH); ctx.lineTo(canvas.width, i * noteH); ctx.stroke()
      }
    }

    // Beat / bar grid lines
    const totalBeats = Math.ceil((safeDur + PADDING_SEC * 2) / secPerBeat) + 2
    for (let b = 0; b <= totalBeats; b++) {
      const x = (PADDING_SEC + b * secPerBeat) * pxPerSec
      ctx.strokeStyle = b % 4 === 0 ? '#ffffff22' : '#ffffff0d'
      ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke()
    }

    // Notes — body + accents
    for (const note of notes) {
      const x     = (PADDING_SEC + note.time) * pxPerSec
      const y     = (maxNote - note.midi) * noteH
      const w     = Math.max(note.duration * pxPerSec - 1, 2)
      const h     = Math.max(noteH - 1, 1)
      const color = TRACK_COLORS[note.trackIndex % TRACK_COLORS.length]

      ctx.fillStyle = color + 'bb'
      ctx.fillRect(x, y + 1, w, h - 1)
      ctx.fillStyle = color
      ctx.fillRect(x, y + 1, w, 2)
      ctx.fillStyle = '#ffffffcc'
      ctx.fillRect(x, y + 1, Math.min(2, w), h - 1)
    }

    // Note name labels (second pass so they're always on top)
    if (noteNameMode && noteNameMode !== 'off') {
      const fontSize = Math.max(7, Math.min(10, Math.floor(noteH * 0.78)))
      ctx.font      = `bold ${fontSize}px sans-serif`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'

      for (const note of notes) {
        const x = (PADDING_SEC + note.time) * pxPerSec
        const y = (maxNote - note.midi) * noteH
        const w = Math.max(note.duration * pxPerSec - 1, 2)
        const h = Math.max(noteH - 1, 1)

        // Skip notes too small to fit any text
        if (w < 10 || h < 6) continue

        const label = noteNameMode === 'solfege'
          ? SOLFEGE_NAMES[note.midi % 12]
          : NOTE_NAMES[note.midi % 12]

        ctx.save()
        ctx.beginPath()
        ctx.rect(x + 3, y + 1, w - 4, h)
        ctx.clip()
        // Dark shadow for readability on any note colour
        ctx.fillStyle = 'rgba(0,0,20,0.70)'
        ctx.fillText(label, x + 3, y + 1 + h / 2)
        ctx.restore()
      }
    }
  }, [notes, noteRange, maxNote, noteH, safeDur, secPerBeat, pxPerSec, noteNameMode])

  // ── Draw: piano keys ──────────────────────────────────────────────────────
  const drawKeys = useCallback(() => {
    const canvas = keysCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    for (let i = 0; i < noteRange; i++) {
      const noteNum = maxNote - i
      const y       = i * noteH
      const black   = isBlack(noteNum)
      const active  = activeNotes.has(noteNum) || previewActiveMidi.has(noteNum)

      ctx.fillStyle = active
        ? (black ? '#1e6a9e' : '#7dd3f8')
        : (black ? '#1c1c1c' : '#e0e0e0')
      ctx.fillRect(0, y, PIANO_WIDTH, noteH)

      ctx.strokeStyle = black ? '#00000066' : '#00000022'
      ctx.lineWidth = 0.5
      ctx.strokeRect(0.25, y + 0.25, PIANO_WIDTH - 0.5, noteH - 0.5)

      if (!black) {
        ctx.fillStyle = '#00000018'
        ctx.fillRect(PIANO_WIDTH - 3, y, 3, noteH)
      }

      // ── Key label ─────────────────────────────────────────────────────────
      const isC       = noteNum % 12 === 0
      const octave    = Math.floor(noteNum / 12) - 1
      const fontSize  = Math.max(6, Math.min(noteH - 2, 10))
      // Show all labels only when rows are tall enough; otherwise fall back to C-only
      const showAll   = noteNameMode !== 'off' && noteH >= 7
      const showC     = noteH >= 7   // always show C anchor regardless of mode

      let label = null
      if (showAll) {
        // Every key gets a label
        if (noteNameMode === 'solfege') {
          label = isC
            ? `${SOLFEGE_NAMES[0]}${octave}`   // "Do4"
            : SOLFEGE_NAMES[noteNum % 12]       // "Re", "Re♯", …
        } else {
          label = isC
            ? noteName(noteNum)                 // "C4"
            : NOTE_NAMES[noteNum % 12]          // "D", "D#", …
        }
      } else if (showC && isC) {
        // Default: only the C octave anchor
        label = noteNameMode === 'solfege'
          ? `${SOLFEGE_NAMES[0]}${octave}`
          : noteName(noteNum)
      }

      if (label !== null) {
        // Contrast colour: dark on white keys, light on black keys
        ctx.fillStyle = active
          ? '#003a5a'
          : black ? '#c0c0c0' : '#444'
        ctx.font      = `${fontSize}px monospace`
        ctx.textAlign = 'right'
        ctx.fillText(label, PIANO_WIDTH - 4, y + noteH - 2)
      }
    }
  }, [noteRange, maxNote, noteH, activeNotes, previewActiveMidi, noteNameMode])

  // ── Effects: redraw canvases ──────────────────────────────────────────────
  useEffect(() => { drawTimeline() }, [drawTimeline])
  useEffect(() => { drawRoll()     }, [drawRoll])
  useEffect(() => { drawKeys()     }, [drawKeys])

  // ── Apply scroll correction after zoom ────────────────────────────────────
  useEffect(() => {
    if (hScrollAfterZoom.current !== null && scrollRef.current) {
      scrollRef.current.scrollLeft = hScrollAfterZoom.current
      hScrollAfterZoom.current = null
    }
  }, [hZoom])

  useEffect(() => {
    if (vScrollAfterZoom.current !== null && scrollRef.current) {
      scrollRef.current.scrollTop = vScrollAfterZoom.current
      vScrollAfterZoom.current = null
    }
  }, [vZoom])

  // ── Mouse-wheel zoom (Ctrl = horizontal, Alt = vertical) ──────────────────
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const onWheel = (e) => {
      const isH = e.ctrlKey  && !e.altKey
      const isV = e.altKey   // Alt+scroll = vertical zoom
      if (!isH && !isV) return
      e.preventDefault()

      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15

      if (isH) {
        // Compute which time is under the cursor so we can re-centre after zoom
        const rect       = el.getBoundingClientRect()
        const mouseXView = e.clientX - rect.left
        const canvasX    = el.scrollLeft + mouseXView
        const timeAtCursor = canvasX / pxPerSec - PADDING_SEC

        const newHZoom    = Math.max(0.25, Math.min(8, hZoom * factor))
        const newPxPerSec = BASE_PX_PER_SEC * newHZoom
        const newCanvasX  = (timeAtCursor + PADDING_SEC) * newPxPerSec
        hScrollAfterZoom.current = Math.max(0, newCanvasX - mouseXView)
        onHZoomChange(newHZoom)
      } else {
        // Vertical: keep the note row under the cursor stable
        const rect       = el.getBoundingClientRect()
        const mouseYView = e.clientY - rect.top
        const canvasY    = el.scrollTop + mouseYView
        const rowAtCursor = canvasY / noteH

        const newVZoom  = Math.max(0.33, Math.min(4, vZoom * factor))
        const newNoteH  = Math.max(3, BASE_NOTE_HEIGHT * newVZoom)
        const newCanvasY = rowAtCursor * newNoteH
        vScrollAfterZoom.current = Math.max(0, newCanvasY - mouseYView)
        onVZoomChange(newVZoom)
      }
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [hZoom, vZoom, pxPerSec, noteH, onHZoomChange, onVZoomChange])

  // ── Timeline seek: click + drag ───────────────────────────────────────────
  const timelineDragging = useRef(false)

  const handleTimelineMouseDown = useCallback((e) => {
    if (isPreviewMode) return
    timelineDragging.current = true
    if (!onSeek) return
    const rect = timelineCanvasRef.current.getBoundingClientRect()
    onSeek(Math.max(0, (e.clientX - rect.left) / pxPerSec - PADDING_SEC))
  }, [onSeek, isPreviewMode, pxPerSec])

  const handleTimelineDragMove = useCallback((e) => {
    if (!timelineDragging.current || !onSeek || isPreviewMode) return
    const rect = timelineCanvasRef.current.getBoundingClientRect()
    onSeek(Math.max(0, (e.clientX - rect.left) / pxPerSec - PADDING_SEC))
  }, [onSeek, isPreviewMode, pxPerSec])

  const handleTimelineDragEnd = useCallback(() => { timelineDragging.current = false }, [])

  // ── Preview scrub helpers ─────────────────────────────────────────────────
  const ensurePreviewSynth = useCallback(async () => {
    await Tone.start()
    if (!previewSynthRef.current) {
      previewSynthRef.current = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'triangle8' },
        envelope: { attack: 0.01, decay: 0.12, sustain: 0.65, release: 0.35 },
        volume: -10,
      }).toDestination()
    }
    return previewSynthRef.current
  }, [])

  const scrubNotesAt = useCallback(async (time) => {
    const synth        = await ensurePreviewSynth()
    const hitting      = notes.filter(n => n.time <= time && n.time + n.duration > time)
    const desiredNames = new Set(hitting.map(n => n.name))
    const desiredMidis = new Set(hitting.map(n => n.midi))

    const toStop  = [...previewActiveRef.current].filter(n => !desiredNames.has(n))
    const toStart = [...desiredNames].filter(n => !previewActiveRef.current.has(n))

    if (toStop.length)  previewSynthRef.current.triggerRelease(toStop,  Tone.now())
    if (toStart.length) previewSynthRef.current.triggerAttack(toStart,  Tone.now(), 0.8)

    previewActiveRef.current = desiredNames
    setPreviewActiveMidi(desiredMidis)
  }, [notes, ensurePreviewSynth])

  const stopAllPreviewNotes = useCallback(() => {
    previewSynthRef.current?.releaseAll()
    previewActiveRef.current = new Set()
    setPreviewActiveMidi(new Set())
  }, [])

  useEffect(() => {
    if (!isPreviewMode) {
      stopAllPreviewNotes()
      setPreviewLineX(null)
      previewDownRef.current = false
    }
  }, [isPreviewMode, stopAllPreviewNotes])

  // ── Preview mouse handlers on roll canvas ─────────────────────────────────
  const getCanvasX = (e) => {
    const rect = rollCanvasRef.current?.getBoundingClientRect()
    return rect ? e.clientX - rect.left : 0
  }
  const xToTime = (x) => Math.max(0, x / pxPerSec - PADDING_SEC)

  const handleRollMouseMove = useCallback((e) => {
    if (!isPreviewMode) return
    const x = getCanvasX(e)
    setPreviewLineX(x)
    if (previewDownRef.current) scrubNotesAt(xToTime(x))
  }, [isPreviewMode, scrubNotesAt, pxPerSec])

  const handleRollMouseDown = useCallback((e) => {
    if (isPreviewMode) {
      e.preventDefault()
      previewDownRef.current = true
      scrubNotesAt(xToTime(getCanvasX(e)))
    } else if (onSeek) {
      // Normal mode: click to seek to that time
      onSeek(Math.max(0, xToTime(getCanvasX(e))))
    }
  }, [isPreviewMode, scrubNotesAt, onSeek, pxPerSec])

  const handleRollMouseUp = useCallback(() => {
    if (!isPreviewMode) return
    previewDownRef.current = false
    stopAllPreviewNotes()
  }, [isPreviewMode, stopAllPreviewNotes])

  const handleRollMouseLeave = useCallback(() => {
    if (!isPreviewMode) return
    previewDownRef.current = false
    setPreviewLineX(null)
    stopAllPreviewNotes()
  }, [isPreviewMode, stopAllPreviewNotes])

  // ── Piano key scroll sync ────────────────────────────────────────────────
  // The keys sidebar is NOT inside roll-scroll, so we mirror its scrollTop manually.
  const syncKeysScroll = useCallback(() => {
    if (keysScrollRef.current && scrollRef.current) {
      keysScrollRef.current.scrollTop = scrollRef.current.scrollTop
    }
  }, [])

  // ── Playhead ──────────────────────────────────────────────────────────────
  const playheadX = (PADDING_SEC + currentTime) * pxPerSec

  // Auto-scroll to keep playhead in view during playback
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const margin = 160
    const right  = el.scrollLeft + el.clientWidth
    if (playheadX > right - margin) {
      el.scrollLeft = playheadX - margin
    } else if (currentTime === 0) {
      el.scrollLeft = 0
    }
  }, [playheadX, currentTime])

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="piano-roll">
      {/* Fixed left column */}
      <div className="keys-column">
        <div className="keys-corner" style={{ height: TIMELINE_HEIGHT }} />
        {/* overflow:hidden hides the scrollbar but scrollTop can still be set in JS */}
        <div className="keys-scroll-area" ref={keysScrollRef}>
          <canvas ref={keysCanvasRef} width={PIANO_WIDTH} height={canvasHeight} />
        </div>
      </div>

      {/* Scrollable area */}
      <div
        className="roll-scroll"
        ref={scrollRef}
        onScroll={syncKeysScroll}
        onMouseMove={handleTimelineDragMove}
        onMouseUp={handleTimelineDragEnd}
        onMouseLeave={handleTimelineDragEnd}
      >
        <div className="roll-inner" style={{ width: canvasWidth, height: totalHeight }}>

          {/* Timeline ruler */}
          <canvas
            ref={timelineCanvasRef}
            width={canvasWidth}
            height={TIMELINE_HEIGHT}
            className={`timeline-canvas${isPreviewMode ? ' timeline-canvas--preview' : ''}`}
            onMouseDown={handleTimelineMouseDown}
          />

          {/* Note grid */}
          <canvas
            ref={rollCanvasRef}
            width={canvasWidth}
            height={canvasHeight}
            className={isPreviewMode ? 'roll-canvas--preview' : 'roll-canvas--seek'}
            onMouseMove={handleRollMouseMove}
            onMouseDown={handleRollMouseDown}
            onMouseUp={handleRollMouseUp}
            onMouseLeave={handleRollMouseLeave}
          />

          {/* Playhead */}
          <div className="playhead" style={{ left: playheadX, height: totalHeight }} />

          {/* Preview scrub line */}
          {isPreviewMode && previewLineX !== null && (
            <div
              className={`preview-line${previewDownRef.current ? ' preview-line--active' : ''}`}
              style={{ left: previewLineX, height: totalHeight }}
            />
          )}
        </div>
      </div>
    </div>
  )
}
