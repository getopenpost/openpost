# /// script
# requires-python = ">=3.10,<3.13"
# dependencies = [
#   "earshot @ git+https://github.com/Leonxlnx/earshot@591fa3e028032e6dce56620a20e932e35667e8d8",
#   "demucs==4.0.1",
#   "torch<2.9",
#   "torchaudio<2.9",
# ]
# ///
"""Arranges the launch film's score to picture from real, licensed recordings and masters it.

    uv run apps/marketing/launch-film/mix.py tmp/launch-film

Downloads every recording in sounds.json into <work>/sounds (sha256-checked) and separates the track into stems once.
cues.json (written by render.mjs) carries the film's cues and its score: spans of source bars per stem, with filter,
reverb and stutter automation. The score plays those stems on the picture's bars, adds a sub and kick under the real
bass, sidechains the bed, closes the filter underwater, then places one effect per cue on
its measured onset, peak or end against the music bed and writes soundtrack.wav plus mix-report.json.
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
CEILING_DBTP = -2.2
# Per role: level over the music bed (dB), the sync point, where it sits against the picture (ms), pan spread.
ROLES = {
    "tick": {"bed_db": 2.0, "align": "onset", "offset_ms": 0, "pan": 0.6},
    "pop": {"bed_db": 4.5, "align": "onset", "offset_ms": 4, "pan": 0.55, "climb": True},
    "click": {"bed_db": 7.0, "align": "onset", "offset_ms": -11, "pan": 0.0},
    "key": {"bed_db": 5.0, "align": "onset", "offset_ms": 8, "pan": 0.15, "level_db": -16.0},
    "whoosh": {"bed_db": 5.0, "align": "peak", "offset_ms": 37, "pan": 0.3},
    "swoosh": {"bed_db": 7.0, "align": "peak", "offset_ms": 40, "pan": 0.0},
    "riser": {"bed_db": 5.0, "align": "end", "offset_ms": -20, "pan": 0.0},
    "impact": {"bed_db": 9.0, "align": "onset", "offset_ms": 0, "pan": 0.0, "level_db": -9.0},
    "shimmer": {"bed_db": 4.0, "align": "onset", "offset_ms": 30, "pan": 0.0, "level_db": -16.0},
    "ding": {"bed_db": 6.5, "align": "onset", "offset_ms": 0, "pan": 0.0},
    "land": {"bed_db": 5.0, "align": "onset", "offset_ms": 30, "pan": 0.0},
    "chime": {"bed_db": 2.5, "align": "onset", "offset_ms": 0, "pan": 0.7, "level_db": -15.0},
    "plop": {"bed_db": 9.0, "align": "onset", "offset_ms": 0, "pan": 0.12, "level_db": -12.0},
    "slam": {"bed_db": 6.0, "align": "onset", "offset_ms": 0, "pan": 0.6, "level_db": -12.0},
    "splash": {"bed_db": 8.0, "align": "peak", "offset_ms": 0, "pan": 0.0, "level_db": -8.0},
    "surfacing": {"bed_db": 6.0, "align": "peak", "offset_ms": 0, "pan": 0.0, "level_db": -9.0},
    "boom": {"bed_db": 8.0, "align": "peak", "offset_ms": 0, "pan": 0.0, "level_db": -8.0},
    "bubbles": {"bed_db": 2.0, "align": "onset", "offset_ms": 0, "pan": 0.2, "level_db": -18.0},
    "ambience": {"bed_db": 0.0, "align": "onset", "offset_ms": 0, "pan": 0.0, "level_db": -26.0},
}
MUSIC_GAIN_DB = -4.0
STEMS = ("drums", "bass", "other", "vocals")
SIDECHAIN = 0.42
SUB_DB = -15.5
KICK_DB = -13.0
WIDTH = 2.5
BED_WIDTH = 1.45
AIR_DB = 1.8


def fetch(entry, cache):
    """the recording's file, downloaded once and checked against its sha256"""
    os.makedirs(cache, exist_ok=True)
    raw = os.path.join(cache, f"{entry['id']}{os.path.splitext(entry['preview'])[1]}")
    if not os.path.exists(raw):
        headers = {"User-Agent": "OpenPost launch film", "Referer": entry.get("page", "")}
        with urllib.request.urlopen(urllib.request.Request(entry["preview"], headers=headers), timeout=120) as response:
            open(raw, "wb").write(response.read())
    digest = hashlib.sha256(open(raw, "rb").read()).hexdigest()
    if digest != entry["sha256"]:
        raise SystemExit(f"{entry['id']}: sha256 {digest} does not match sounds.json")
    return raw


def wav48(raw, out):
    if not os.path.exists(out):
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", raw, "-ar", str(SR), "-ac", "2", "-c:a", "pcm_f32le", out], check=True)
    return soundfile.read(out, always_2d=True)[0]


def recording(entry, cache):
    return wav48(fetch(entry, cache), os.path.join(cache, f"{entry['id']}.wav"))


def separated(entry, cache):
    """the track's four stems at 48 kHz, separated once"""
    raw = fetch(entry, cache)
    name = os.path.splitext(os.path.basename(raw))[0]
    base = os.path.join(cache, "stems")
    folder = os.path.join(base, "htdemucs", name)
    if not all(os.path.exists(os.path.join(folder, f"{s}.wav")) for s in STEMS):
        subprocess.run([sys.executable, "-m", "demucs", "-n", "htdemucs", "-d", "mps", "-o", base, raw], check=True)
    return {s: wav48(os.path.join(folder, f"{s}.wav"), os.path.join(folder, f"{s}-48k.wav")) for s in STEMS}


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


def sweep(n, a, b):
    """a filter sweep that moves evenly in pitch"""
    return np.exp(np.linspace(np.log(a), np.log(b), n))


def automation(score, bar, total):
    """the lowpass, highpass and reverb send over time, sample-accurate and deglitched"""
    lp, hp, wet = np.full(total, 22000.0), np.full(total, 30.0), np.zeros(total)
    for span in score:
        a, b = int(span["from"] * bar * SR), min(total, int(span["to"] * bar * SR))
        if "lp" in span:
            lp[a:b] = sweep(b - a, *span["lp"])
        if "hp" in span:
            hp[a:b] = sweep(b - a, *span["hp"])
        wet[a:b] = span.get("wet", 0)
    smooth = np.ones(int(0.02 * SR)) / int(0.02 * SR)
    return (
        np.exp(signal.fftconvolve(np.log(lp), smooth, mode="same")),
        np.exp(signal.fftconvolve(np.log(hp), smooth, mode="same")),
        signal.fftconvolve(wet, smooth, mode="same"),
    )


def filtered(x, lp, hp, air=0.0):
    """time-varying filters in the STFT domain: fourth-order slopes that follow the automation"""
    hop = 256
    out = np.zeros_like(x)
    for c in range(2):
        f, frames, spectrum = signal.stft(x[:, c], SR, nperseg=2048, noverlap=2048 - hop)
        index = np.clip((frames * SR).astype(int), 0, len(lp) - 1)
        freq = np.maximum(f, 1.0)[:, None]
        mask = 1 / np.sqrt(1 + (freq / lp[index][None, :]) ** 8) / np.sqrt(1 + (hp[index][None, :] / freq) ** 8)
        mask = mask * (1 + (10 ** (air / 20) - 1) * freq**2 / (freq**2 + 3200.0**2)) / np.sqrt(1 + (freq / 13000.0) ** 4)
        _, y = signal.istft(spectrum * mask, SR, nperseg=2048, noverlap=2048 - hop)
        n = min(len(x), len(y))
        out[:n, c] = y[:n]
    return out


def reverb(x, wet, seconds=2.6):
    """a long stereo tail for the underwater send and for throwing sounds into space"""
    n = int(seconds * SR)
    rng = np.random.default_rng(7)
    decay = np.exp(-np.arange(n) / (n / 6.5))
    ir = rng.standard_normal((n, 2)) * decay[:, None]
    sos = signal.butter(2, [120, 5200], "bandpass", fs=SR, output="sos")
    ir = signal.sosfilt(sos, ir, axis=0)
    ir /= np.sqrt(np.sum(ir**2, axis=0, keepdims=True))
    send = x * wet[:, None]
    return np.stack([signal.fftconvolve(send[:, c], ir[:, c])[: len(x)] for c in range(2)], axis=1)


def stutter(x, per_bar, bar):
    """vocal chops: each step repeats the grain that starts its pair, on the bar grid"""
    step = int(bar / per_bar * SR)
    out = np.zeros_like(x)
    fade = min(int(0.004 * SR), step // 4)
    ramp = np.linspace(0, 1, fade)[:, None]
    for i in range(0, len(x) - step, step):
        grain = x[i - (i % (2 * step)) : i - (i % (2 * step)) + step].copy()
        if len(grain) < step:
            continue
        grain[:fade] *= ramp
        grain[-fade:] *= ramp[::-1]
        out[i : i + step] = grain
    return out


def arrange(score, stems, origin, bar, total):
    """the source track re-cut to the picture, stem by stem, on shared bar lines"""
    buses = {s: np.zeros((total, 2)) for s in STEMS}
    for span in score:
        length = (span["to"] - span["from"]) * bar
        start = origin + span["at"] * bar
        for name, db in span["stems"].items():
            a, b = int(start * SR), int((start + length) * SR)
            x = trimmed(stems[name], (start, start + length), fade=0.006)
            if span.get("chop") and name == "vocals":
                x = stutter(x, span["chop"], bar)
            place(buses[name], x * 10 ** (db / 20), span["from"] * bar)
    return buses


def reinforcement(score, bass_stem, origin, bar, total):
    """the modern weight the source lacks: a sub that follows its bass notes and a kick on every beat"""
    sub, kick_track = np.zeros(total), np.zeros(total)
    side = np.ones(total)
    beat = bar / 4
    mono = bass_stem.mean(axis=1)
    win = int(beat / 2 * SR)
    t = np.arange(int(0.34 * SR)) / SR
    kick = np.sin(2 * np.pi * np.cumsum(52 + 120 * np.exp(-t / 0.032)) / SR) * np.exp(-t / 0.13)
    kick[: int(0.002 * SR)] *= np.linspace(0, 1, int(0.002 * SR))
    pump_t = np.arange(int(beat * SR)) / SR
    pump = 1 - SIDECHAIN * np.exp(-pump_t / 0.11)
    phase = 0.0
    for span in score:
        if not span.get("sub"):
            continue
        beats = int(round((span["to"] - span["from"]) * 4))
        for i in range(beats):
            at = span["from"] * bar + i * beat
            a = int(at * SR)
            if a + len(pump) < total:
                side[a : a + len(pump)] = np.minimum(side[a : a + len(pump)], pump)
            if a + len(kick) < total:
                kick_track[a : a + len(kick)] += kick
        steps = int(round((span["to"] - span["from"]) * 8))
        for i in range(steps):
            at = span["from"] * bar + i * beat / 2
            src = int((origin + span["at"] * bar + i * beat / 2) * SR)
            grain = mono[src : src + win]
            if len(grain) < win:
                continue
            spectrum = np.abs(np.fft.rfft(grain * np.hanning(win), n=win * 4))
            freq = np.fft.rfftfreq(win * 4, 1 / SR)
            band = (freq > 32) & (freq < 170)
            f0 = freq[band][np.argmax(spectrum[band])]
            while f0 > 72:
                f0 /= 2
            level = np.sqrt(np.mean(grain**2))
            a = int(at * SR)
            n = min(win, total - a)
            if n <= 0:
                continue
            tt = np.arange(n)
            wave = np.sin(phase + 2 * np.pi * f0 * tt / SR)
            phase = (phase + 2 * np.pi * f0 * n / SR) % (2 * np.pi)
            env = np.minimum(1, np.minimum(tt, n - tt) / (0.004 * SR))
            sub[a : a + n] += wave * env * min(1.0, level * 12)
    sub = np.tanh(sub * 1.6) * 10 ** (SUB_DB / 20)
    return np.stack([sub, sub], axis=1), np.stack([kick_track, kick_track], axis=1) * 10 ** (KICK_DB / 20), side


def music_bed(film, entry, cache):
    bar = film["bar"]
    total = int((film["duration"] + 0.05) * SR)
    stems = separated(entry, cache)
    origin = entry["grid_origin"]
    buses = arrange(film["score"], stems, origin, bar, total)
    sub, kick, side = reinforcement(film["score"], stems["bass"], origin, bar, total)
    upper = buses["other"] + buses["vocals"]
    mid, wide = upper.mean(axis=1, keepdims=True), (upper[:, 0] - upper[:, 1])[:, None] / 2
    upper = np.hstack([mid + wide * WIDTH, mid - wide * WIDTH])
    tonal = (buses["bass"] + upper + sub) * side[:, None]
    bed = tonal + buses["drums"] + kick
    lp, hp, wet = automation(film["score"], bar, total)
    bed = filtered(bed, lp, hp, air=AIR_DB)
    bed = bed + reverb(bed, wet) * 0.9
    mid, side = bed.mean(axis=1, keepdims=True), (bed[:, 0] - bed[:, 1])[:, None] / 2
    bed = np.hstack([mid + side * BED_WIDTH, mid - side * BED_WIDTH])
    return bed * 10 ** (MUSIC_GAIN_DB / 20), lp


def main(work):
    here = os.path.dirname(os.path.abspath(__file__))
    sounds = json.load(open(os.path.join(here, "sounds.json")))
    film = json.load(open(os.path.join(work, "cues.json")))
    cache = os.path.join(work, "sounds")
    total = int((film["duration"] + 0.05) * SR)
    music, lp = music_bed(film, sounds["music"], cache)

    takes = {}
    for role, entries in sounds["effects"].items():
        takes[role] = []
        for entry in entries:
            y = recording(entry, cache)
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
        # A cue can name its own pitch, which is how bell runs play a scale.
        shift = cue.get("semitones", min(steps, 9) * 0.6)
        x = pitched(take["x"], shift)
        if "until" in cue:
            n = int((cue["until"] - at) * SR)
            x = np.resize(x, (n, 2))
            fade = int(0.6 * SR)
            ramp = np.linspace(0, 1, fade)[:, None]
            x[:fade] *= ramp
            x[-fade:] *= ramp[::-1]
        sync = take["points"][spec["align"]] / (2 ** (shift / 12))
        pan = spec["pan"] * (1 if index % 2 else -1) * ((index * 7) % 5) / 4
        bed = kit.bed_level(music, at) if at >= 0.06 else None
        if bed is None or bed < -46:
            gain = spec.get("level_db", -12.0) - 20 * np.log10(np.max(np.abs(x)) + 1e-9)
        else:
            gain = bed + kit.over_bed(spec["bed_db"]) - take["l50"]
            gain = min(gain, -1.0 - 20 * np.log10(np.max(np.abs(x)) + 1e-9))
        gain += cue.get("gain_db", 0)
        target = cue.get("ends", at)
        start = target + spec["offset_ms"] / 1000 - sync
        place(effects, panned(x, pan) * 10 ** (gain / 20), start)
        report.append({"t": at, "role": role, "id": take["id"], "start": round(start, 4), "bed_lufs": bed, "gain_db": round(float(gain), 2), "pitch": steps})

    # Underwater, the effects are heard through the same water as the music.
    effects = filtered(effects, np.minimum(lp * 5, 22000.0), np.full(total, 34.0))
    mix = music + effects
    meter = pyloudnorm.Meter(SR)
    for _ in range(3):
        mix *= 10 ** ((TARGET_LUFS - meter.integrated_loudness(mix)) / 20)
        mix = limit(mix, 10 ** ((CEILING_DBTP - 0.4) / 20))
    peak = true_peak_db(mix)
    if peak > CEILING_DBTP:
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
