# /// script
# requires-python = ">=3.10,<3.13"
# dependencies = ["earshot @ git+https://github.com/Leonxlnx/earshot@591fa3e028032e6dce56620a20e932e35667e8d8"]
# ///
"""Builds the launch film soundtrack from real, licensed recordings and masters it.

    uv run apps/marketing/launch-film/mix.py tmp/launch-film

Downloads every recording in sounds.json into <work>/sounds (sha256-checked), edits the music track at its bar lines,
places one take per cue from cues.json (written by render.mjs) on its measured onset or peak, sets each effect's level
against the music bed with earshot's bed-relative rule, and writes soundtrack.wav plus mix-report.json.
"""
import hashlib
import json
import os
import subprocess
import sys
import urllib.request

import numpy as np
import pyloudnorm
import soundfile
from earshot.forge import kit
from scipy import signal

SR = 48000
TARGET_LUFS = -14.0
CEILING_DBTP = -1.5
# Per role: level over the music bed (dB), the sync point, where it sits against the picture (ms), pan spread.
ROLES = {
    "tick": {"bed_db": 4.0, "align": "onset", "offset_ms": 0, "pan": 0.35},
    "pop": {"bed_db": 7.0, "align": "onset", "offset_ms": 4, "pan": 0.3, "climb": True},
    "click": {"bed_db": 7.0, "align": "onset", "offset_ms": -11, "pan": 0.0},
    "key": {"bed_db": 4.5, "align": "onset", "offset_ms": 8, "pan": 0.15},
    "whoosh": {"bed_db": 8.0, "align": "peak", "offset_ms": 37, "pan": 0.0},
    "swoosh": {"bed_db": 8.0, "align": "peak", "offset_ms": 40, "pan": 0.0},
    "riser": {"bed_db": 6.0, "align": "end", "offset_ms": -20, "pan": 0.0},
    "impact": {"bed_db": 9.0, "align": "onset", "offset_ms": 0, "pan": 0.0, "level_db": -9.0},
    "shimmer": {"bed_db": 5.0, "align": "onset", "offset_ms": 30, "pan": 0.0, "level_db": -16.0},
    "ding": {"bed_db": 6.5, "align": "onset", "offset_ms": 0, "pan": 0.0},
    "land": {"bed_db": 7.0, "align": "onset", "offset_ms": 30, "pan": 0.0},
    "error": {"bed_db": 6.0, "align": "onset", "offset_ms": 0, "pan": 0.0},
}
MUSIC_GAIN_DB = -6.0
STOP_DOWN_DB = -9.0
# The bed track is bright through the 1-3 kHz honk band; earshot critique asks for a 2 dB cut there.
MUSIC_MID_DIP_DB = -2.0


def fetch(entry, cache):
    """the recording as 48 kHz stereo float, downloaded once and checked against its sha256"""
    os.makedirs(cache, exist_ok=True)
    raw = os.path.join(cache, f"{entry['id']}{os.path.splitext(entry['preview'])[1]}")
    if not os.path.exists(raw):
        request = urllib.request.Request(entry["preview"], headers={"User-Agent": "OpenPost launch film"})
        with urllib.request.urlopen(request, timeout=60) as response:
            open(raw, "wb").write(response.read())
    digest = hashlib.sha256(open(raw, "rb").read()).hexdigest()
    if digest != entry["sha256"]:
        raise SystemExit(f"{entry['id']}: sha256 {digest} does not match sounds.json")
    wav = os.path.join(cache, f"{entry['id']}.wav")
    if not os.path.exists(wav):
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", raw, "-ar", str(SR), "-ac", "2", "-c:a", "pcm_f32le", wav], check=True)
    y, _ = soundfile.read(wav, always_2d=True)
    return y


def trimmed(y, trim, fade=0.004):
    a, b = (int(trim[0] * SR), int(trim[1] * SR)) if trim else (0, len(y))
    x = y[a:b].copy()
    n = min(len(x) // 2, int(fade * SR))
    ramp = np.linspace(0, 1, n)[:, None]
    x[:n] *= ramp
    x[len(x) - n :] *= ramp[::-1]
    return x


def points(x):
    """measured onset, peak and end (s) of a take: the sync points a cue can align to"""
    env = np.sqrt(np.convolve(np.mean(x**2, axis=1), np.ones(240) / 240, mode="same"))
    peak = int(np.argmax(env))
    threshold = env[peak] * 10 ** (-30 / 20)
    onset = int(np.argmax(env > threshold))
    above = np.nonzero(env > env[peak] * 10 ** (-50 / 20))[0]
    return {"onset": onset / SR, "peak": peak / SR, "end": (above[-1] if len(above) else len(x)) / SR}


def pitched(x, semitones):
    """resampled up by semitones (shorter and higher, like a faster playback)"""
    if not semitones:
        return x
    ratio = 2 ** (semitones / 12)
    positions = np.arange(0, len(x) - 1, ratio)
    return np.stack([np.interp(positions, np.arange(len(x)), x[:, c]) for c in range(2)], axis=1)


def panned(x, pan):
    left, right = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    return x * np.array([left, right]) * np.sqrt(2)


def place(bus, x, start):
    offset = int(round(start * SR))
    if offset < 0:
        x, offset = x[-offset:], 0
    end = min(len(bus), offset + len(x))
    if end > offset:
        bus[offset:end] += x[: end - offset]


def limit(x, ceiling, lookahead=0.005, release=0.08):
    """a look-ahead peak limiter on the sample peaks of both channels"""
    peak = np.max(np.abs(x), axis=1)
    window = int(lookahead * SR)
    held = np.array([peak[max(0, i - window) : i + window + 1].max() for i in range(0, len(peak), 64)])
    target = np.minimum(1.0, ceiling / np.maximum(held, 1e-9))
    coefficient = np.exp(-1.0 / (release * SR / 64))
    gain = np.empty_like(target)
    level = 1.0
    for i, value in enumerate(target):
        level = value if value < level else value + (level - value) * coefficient
        gain[i] = level
    return x * np.interp(np.arange(len(peak)), np.arange(0, len(peak), 64), gain)[:, None]


def true_peak_db(x):
    return 20 * np.log10(np.max(np.abs(signal.resample_poly(x, 4, 1, axis=0))) + 1e-12)


def music_bed(entry, cache, total, sections):
    """the track edited at its bar lines, with a stop-down before the logo hit"""
    source = fetch(entry, cache)
    bed = np.zeros((total, 2))
    for segment in entry["edit"]:
        x = trimmed(source, (segment["from"], segment["to"]), fade=0.012)
        fade_out = segment.get("fade_out")
        if fade_out:
            n = int(fade_out * SR)
            x[-n:] *= np.linspace(1, 0, n)[:, None] ** 2
        place(bed, x, segment["at"])
    t = np.arange(total) / SR
    hit = sections["end"]
    automation = np.where((t >= hit - 0.42) & (t < hit), 10 ** (STOP_DOWN_DB / 20), 1.0)
    automation = np.convolve(automation, np.ones(480) / 480, mode="same")
    # A wide peaking cut over the honk band tames the track's harsh mids.
    sos = signal.iirfilter(2, [1000.0, 3000.0], btype="bandstop", fs=SR, output="sos")
    shaped = signal.sosfilt(sos, bed, axis=0)
    dip = 10 ** (MUSIC_MID_DIP_DB / 20)
    return (shaped * (1 - dip) + bed * dip) * automation[:, None] * 10 ** (MUSIC_GAIN_DB / 20)


def main(work):
    here = os.path.dirname(os.path.abspath(__file__))
    sounds = json.load(open(os.path.join(here, "sounds.json")))
    film = json.load(open(os.path.join(work, "cues.json")))
    cache = os.path.join(work, "sounds")
    total = int((film["duration"] + 0.05) * SR)
    music = music_bed(sounds["music"], cache, total, film["sections"])

    takes = {}
    for role, entries in sounds["effects"].items():
        takes[role] = []
        for entry in entries:
            y = fetch(entry, cache)
            for trim in entry.get("slices") or [entry.get("trim")]:
                x = trimmed(y, trim)
                takes[role].append({"x": x, "points": points(x), "l50": kit.loud_lufs(x), "id": entry["id"]})

    effects = np.zeros((total, 2))
    report, counters, last = [], {}, {}
    climb = {}
    for cue in film["cues"]:
        role, at = cue["role"], cue["t"]
        spec = ROLES[role]
        pool = takes[role]
        index = counters.get(role, 0)
        counters[role] = index + 1
        take = pool[index % len(pool)]
        # A run of pops climbs in pitch; a gap resets it.
        steps = climb.get(role, 0) + 1 if spec.get("climb") and at - last.get(role, -9) < 0.45 else 0
        climb[role], last[role] = steps, at
        x = pitched(take["x"], min(steps, 9) * 0.6)
        sync = take["points"][spec["align"]] / (2 ** (min(steps, 9) * 0.6 / 12))
        pan = spec["pan"] * (1 if index % 2 else -1) * ((index * 7) % 5) / 4
        bed = kit.bed_level(music, at) if at >= 0.06 else None
        if bed is None:
            gain = spec.get("level_db", -12.0) - 20 * np.log10(np.max(np.abs(x)) + 1e-9)
        else:
            gain = bed + kit.over_bed(spec["bed_db"]) - take["l50"]
            gain = min(gain, -1.0 - 20 * np.log10(np.max(np.abs(x)) + 1e-9))
        gain += cue.get("gain_db", 0)
        start = at + spec["offset_ms"] / 1000 - sync
        place(effects, panned(x, pan) * 10 ** (gain / 20), start)
        report.append({"t": at, "role": role, "id": take["id"], "start": round(start, 4), "bed_lufs": bed, "gain_db": round(float(gain), 2), "pitch": steps})

    mix = music + effects
    meter = pyloudnorm.Meter(SR)
    mix *= 10 ** ((TARGET_LUFS - meter.integrated_loudness(mix)) / 20)
    for _ in range(5):
        mix = limit(mix, 10 ** ((CEILING_DBTP - 0.4) / 20))
        peak = true_peak_db(mix)
        if peak <= CEILING_DBTP:
            break
        mix *= 10 ** ((CEILING_DBTP - peak) / 20)
    lufs = meter.integrated_loudness(mix)
    soundfile.write(os.path.join(work, "soundtrack.wav"), mix.astype(np.float32), SR, subtype="PCM_24")
    soundfile.write(os.path.join(work, "music-stem.wav"), music.astype(np.float32), SR, subtype="PCM_24")
    soundfile.write(os.path.join(work, "effects-stem.wav"), effects.astype(np.float32), SR, subtype="PCM_24")
    summary = {"lufs": round(lufs, 2), "true_peak_dbtp": round(true_peak_db(mix), 2), "effects": len(report), "cues": report}
    json.dump(summary, open(os.path.join(work, "mix-report.json"), "w"), indent=1)
    print(f"wrote soundtrack.wav: {len(report)} effects, {lufs:.1f} LUFS, true peak {summary['true_peak_dbtp']} dBTP")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "tmp/launch-film")
