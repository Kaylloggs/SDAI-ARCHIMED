"""Bande-son de la vidéo /brag d'ARCHIMED, synthétisée (numpy seul).

Ré majeur, 100 BPM (1 temps = 0,6 s). Musique et effets écrits ensemble : même tonalité, même
réverbération, effets mixés sous la musique. Sortie : work/audio.wav (48 kHz, stéréo, 22,8 s).
"""
import wave
from pathlib import Path

import numpy as np

SR = 48_000
DUR = 22.8
N = int(SR * DUR)
rng = np.random.default_rng(7)
HERE = Path(__file__).parent


def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12)


NOTE = {"C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5, "F#": 6, "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11}


def hz(name):
    """« F#4 » → fréquence."""
    pitch, octave = name[:-1], int(name[-1])
    return midi(12 * (octave + 1) + NOTE[pitch])


# ── Bus ─────────────────────────────────────────────────────────────────
music = np.zeros((N, 2))
sfx = np.zeros((N, 2))
send = np.zeros((N, 2))  # vers la réverbération


def put(bus, start, sig, gain=1.0, pan=0.0, rev=0.0):
    """Place un signal mono ou stéréo à `start` secondes (pan -1…1, envoi réverbération)."""
    i = int(start * SR)
    if i >= N:
        return
    if sig.ndim == 1:
        left, right = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
        sig = np.stack([sig * left * 1.414, sig * right * 1.414], axis=1)
    n = min(len(sig), N - i)
    bus[i:i + n] += sig[:n] * gain
    if rev:
        send[i:i + n] += sig[:n] * gain * rev


def lowpass(x, fc, order=2):
    spec = np.fft.rfft(x, axis=0)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    h = 1 / np.sqrt(1 + (f / fc) ** (2 * order))
    return np.fft.irfft(spec * (h[:, None] if x.ndim == 2 else h), n=len(x), axis=0)


def highpass(x, fc, order=2):
    spec = np.fft.rfft(x, axis=0)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    h = 1 / np.sqrt(1 + (fc / np.maximum(f, 1e-3)) ** (2 * order))
    return np.fft.irfft(spec * (h[:, None] if x.ndim == 2 else h), n=len(x), axis=0)


def bandpass(x, lo, hi):
    return highpass(lowpass(x, hi, 2), lo, 2)


def env(n, a, d, s, r, hold=None):
    """ADSR en secondes ; `hold` : durée avant le relâchement (par défaut tout le signal)."""
    t = np.arange(n) / SR
    hold = (n / SR - r) if hold is None else hold
    e = np.where(t < a, t / max(a, 1e-4), 1.0)
    dec = np.clip((t - a) / max(d, 1e-4), 0, 1)
    e = np.where(t >= a, 1 - (1 - s) * dec, e)
    rel = np.clip((t - hold) / max(r, 1e-4), 0, 1)
    return e * (1 - rel)


def tone(freq, dur, harmonics=1, decay=None, bright=1.0, detune=0.0, phase_seed=0):
    """Somme de partiels (dent de scie adoucie) ; `decay` : amortissement des aigus."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    prng = np.random.default_rng(phase_seed)
    for k in range(1, harmonics + 1):
        f = freq * k * (1 + detune)
        if f > 12_000:
            break
        amp = (1 / k) ** (1.0 / bright)
        partial = np.sin(2 * np.pi * f * t + prng.uniform(0, 2 * np.pi))
        if decay:
            partial *= np.exp(-t * decay * (k - 1) * 0.6)
        out += amp * partial
    return out


def pad(notes, start, dur, gain, cutoff=1800, attack=0.5, release=0.9):
    n = int((dur + release) * SR)
    left = np.zeros(n)
    right = np.zeros(n)
    for j, name in enumerate(notes):
        f = hz(name)
        left += tone(f, dur + release, 18, bright=1.1, detune=-0.0035, phase_seed=j * 3 + 1)
        right += tone(f, dur + release, 18, bright=1.1, detune=0.0035, phase_seed=j * 3 + 2)
    sig = np.stack([left, right], axis=1) / len(notes)
    sig = lowpass(sig, cutoff, 2)
    e = env(n, attack, 0.3, 0.85, release, hold=dur)
    put(music, start, sig * e[:, None], gain, rev=0.45)


def pluck(freq, dur=1.6, bright=0.5, seed=0):
    """Corde pincée (Karplus-Strong)."""
    n = int(dur * SR)
    period = int(SR / freq)
    buf = np.random.default_rng(seed).uniform(-1, 1, period)
    buf = lowpass(buf, 2000 + 6000 * bright, 1) if period > 64 else buf
    out = np.zeros(n)
    for i in range(n):
        out[i] = buf[i % period]
        buf[i % period] = 0.4985 * (buf[i % period] + buf[(i + 1) % period])
    return out * env(n, 0.002, 0.05, 1.0, 0.3)


def bell(freq, dur=2.5):
    """Cloche douce : partiels inharmoniques qui s'éteignent vite."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    ratios = [(1.0, 1.0, 2.2), (2.0, 0.35, 3.5), (2.76, 0.18, 5.0), (5.4, 0.06, 8.0)]
    out = sum(a * np.sin(2 * np.pi * freq * r * t) * np.exp(-t * d) for r, a, d in ratios)
    return out * env(n, 0.003, 0.1, 1.0, 0.2)


def kick(gain=1.0):
    n = int(0.45 * SR)
    t = np.arange(n) / SR
    f = 42 + 90 * np.exp(-t * 32)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 7.5)
    click = lowpass(rng.uniform(-1, 1, n) * np.exp(-t * 300), 3000, 1) * 0.15
    return (body + click) * gain


def clap():
    n = int(0.3 * SR)
    t = np.arange(n) / SR
    noise = rng.uniform(-1, 1, n)
    e = np.exp(-t * 22) + 0.5 * np.exp(-np.maximum(t - 0.012, 0) * 30) * (t > 0.012)
    return bandpass(noise * e, 900, 5000) * 0.8


def hat(open_=False):
    n = int((0.22 if open_ else 0.06) * SR)
    t = np.arange(n) / SR
    return highpass(rng.uniform(-1, 1, n), 7000, 2) * np.exp(-t * (18 if open_ else 70))


def whoosh(dur, lo=300, hi=4000, rising=True):
    n = int(dur * SR)
    t = np.arange(n) / SR
    noise = rng.uniform(-1, 1, n)
    out = np.zeros(n)
    steps = 12
    for s in range(steps):
        a, b = s * n // steps, (s + 1) * n // steps
        k = s / (steps - 1)
        center = lo * (hi / lo) ** (k if rising else 1 - k)
        seg = np.zeros(n)
        seg[a:b] = noise[a:b]
        out += bandpass(seg, center * 0.6, center * 1.6)
    shape = np.sin(np.pi * np.clip(t / dur, 0, 1)) ** 1.5
    return out * shape


def click(freq=3200, gain=1.0):
    n = int(0.05 * SR)
    t = np.arange(n) / SR
    noise = bandpass(rng.uniform(-1, 1, n), freq * 0.6, freq * 1.5) * np.exp(-t * 180)
    thud = np.sin(2 * np.pi * 180 * t) * np.exp(-t * 90) * 0.4
    return (noise + thud) * gain


# ── Musique ─────────────────────────────────────────────────────────────
BEAT = 0.6
CHORDS = [
    (0.0, 3.6, ["D3", "A3", "E4", "F#4"]),          # Dadd9, intro
    (3.6, 1.8, ["D3", "A3", "C#4", "E4", "F#4"]),   # Dmaj9
    (5.4, 1.8, ["B2", "F#3", "A3", "C#4", "D4"]),   # Bm9
    (7.2, 1.8, ["G2", "D3", "F#3", "A3", "B3"]),    # Gmaj9
    (9.0, 1.8, ["A2", "E3", "A3", "B3", "E4"]),     # Aadd9
    (10.8, 1.8, ["D3", "A3", "C#4", "E4", "F#4"]),
    (12.6, 1.8, ["B2", "F#3", "A3", "C#4", "D4"]),
    (14.4, 1.8, ["G2", "D3", "F#3", "A3", "B3"]),
    (16.2, 1.5, ["A2", "E3", "A3", "B3", "E4"]),    # Asus2, respiration
    (17.7, 1.5, ["A2", "E3", "A3", "C#4", "E4"]),   # A
    (19.2, 3.6, ["D3", "A3", "C#4", "E4", "F#4", "A4"]),  # fin
]
ROOT = {0.0: "D2", 3.6: "D2", 5.4: "B1", 7.2: "G1", 9.0: "A1", 10.8: "D2", 12.6: "B1", 14.4: "G1", 16.2: "A1", 17.7: "A1", 19.2: "D2"}

for start, dur, notes in CHORDS:
    intro = start == 0.0
    final = start == 19.2
    breath = start in (16.2, 17.7)
    pad(notes, start, dur, gain=0.36 if intro else 0.21 if breath else 0.26 if not final else 0.36,
        cutoff=1600 if intro else 5200 if not final else 4200,
        attack=1.6 if intro else 0.08, release=1.6 if final else 0.35)

# Basse : croches sur la fondamentale (3,6 → 16,2), note tenue à la fin.
def root_at(t):
    return ROOT[max(k for k in ROOT if k <= t + 1e-6)]


for k in range(int(3.6 / 0.3), int(16.2 / 0.3)):
    t0 = k * 0.3
    f = hz(root_at(t0)) * (2 if k % 2 else 1)
    n = int(0.28 * SR)
    b = tone(f, 0.28, 4, bright=0.6) * env(n, 0.005, 0.12, 0.6, 0.08)
    put(music, t0, lowpass(b, 900), 0.2 if k % 2 == 0 else 0.12)
n = int(3.4 * SR)
put(music, 19.2, lowpass(tone(hz("D2"), 3.4, 4, bright=0.6), 500) * env(n, 0.01, 0.4, 0.7, 1.6), 0.3)

# Batterie.
for k in range(int(3.6 / BEAT), int(16.2 / BEAT)):
    t0 = k * BEAT
    put(music, t0, highpass(kick(), 38, 2), 0.30, rev=0.05)
    if k % 2 == 1:
        put(music, t0, clap(), 0.15, pan=0.05, rev=0.25)
for k in range(int(3.6 / 0.3), int(19.2 / 0.3)):
    t0 = k * 0.3
    off = k % 2 == 1
    put(music, t0, hat(open_=off and k % 8 == 7), 0.12 if off else 0.06, pan=0.3, rev=0.08)
put(music, 19.2, highpass(kick(1.1), 38, 2), 0.4, rev=0.2)
# Respiration (16,2 → 19,2) : basse tenue sur la.
n2 = int(3.0 * SR)
put(music, 16.2, lowpass(tone(hz("A1"), 3.0, 4, bright=0.6), 500) * env(n2, 0.05, 0.3, 0.8, 0.3), 0.14)

# Arpège discret sous le montage (10,8 → 16,2), doubles croches pincées.
ARP = {10.8: ["D5", "F#5", "A5", "E5"], 12.6: ["B4", "D5", "F#5", "C#5"], 14.4: ["G4", "B4", "D5", "A4"]}
for base, notes in ARP.items():
    for j in range(12):
        t0 = base + j * 0.15
        put(music, t0, pluck(hz(notes[j % 4]), 0.8, bright=0.3, seed=j), 0.07, pan=-0.35 + 0.7 * (j % 2), rev=0.35)

# ── Effets (dans la tonalité, sous la musique) ──────────────────────────
for i, t0 in enumerate([0.15, 0.45, 0.75]):
    put(sfx, t0, click(2600 + i * 300), 0.28, pan=-0.2 + i * 0.2, rev=0.15)
put(sfx, 1.02, click(2200, 0.6), 0.16, rev=0.1)
put(sfx, 0.95, bell(hz("A5")), 0.10, pan=-0.15, rev=0.5)
put(sfx, 1.03, bell(hz("D6")), 0.08, pan=0.15, rev=0.5)
put(sfx, 2.2, whoosh(1.4, 200, 3000), 0.10, rev=0.3)                 # montée vers le premier temps fort
put(sfx, 3.3, whoosh(0.5, 800, 5000), 0.08, rev=0.2)                 # la pastille rejoint l'app
put(sfx, 4.2, bell(hz("F#5")), 0.09, pan=-0.1, rev=0.5)              # l'app répond
put(sfx, 4.28, bell(hz("A5")), 0.08, pan=0.1, rev=0.5)
for i, name in enumerate(["D5", "F#5", "A5", "D6"]):                   # les quatre cartes
    put(sfx, 4.5 + i * 0.3, pluck(hz(name), 1.4, bright=0.6, seed=10 + i), 0.22, pan=-0.3 + i * 0.2, rev=0.4)
put(sfx, 6.6, whoosh(0.6, 3000, 300, rising=False), 0.05, rev=0.3)
# Logo : cloche grave et scintillement en sol.
put(sfx, 7.3, bell(hz("G3"), 3.0), 0.16, rev=0.6)
put(sfx, 7.32, bell(hz("D4"), 3.0), 0.10, rev=0.6)
put(sfx, 7.5, whoosh(0.9, 2000, 8000), 0.04, rev=0.5)
put(sfx, 8.05, bell(hz("B5"), 1.5), 0.07, rev=0.5)                   # point du logo
for s in (10.8, 12.6, 14.4):                                          # les captures glissent
    put(sfx, s - 0.05, whoosh(0.55, 400, 6000), 0.09, pan=0.25, rev=0.25)
    put(sfx, s + 0.38, bell(hz("A5"), 1.0), 0.05, rev=0.4)
for i, name in enumerate(["A4", "C#5", "E5"]):                        # agents
    put(sfx, 16.5 + i * 0.3, pluck(hz(name), 1.2, bright=0.5, seed=20 + i), 0.2, pan=-0.3 + i * 0.3, rev=0.4)
put(sfx, 17.4, whoosh(0.8, 3000, 9000), 0.035, rev=0.5)
put(sfx, 18.0, whoosh(1.2, 150, 2500), 0.10, rev=0.3)                 # montée vers la fin
put(sfx, 19.2, bell(hz("D5"), 3.5), 0.12, pan=-0.1, rev=0.6)
put(sfx, 19.22, bell(hz("A5"), 3.5), 0.08, pan=0.1, rev=0.6)
for i, t0 in enumerate([20.7, 20.82, 20.94]):                          # touches de la fin
    put(sfx, t0, click(2600 + i * 300), 0.14, pan=-0.2 + i * 0.2, rev=0.2)

# ── Réverbération (réponse impulsionnelle synthétique, 2,2 s) ───────────
ir_n = int(2.2 * SR)
ti = np.arange(ir_n) / SR
ir = rng.standard_normal((ir_n, 2)) * np.exp(-ti * 3.1)[:, None]
ir = lowpass(ir, 5000, 1)
ir[: int(0.012 * SR)] = 0
ir /= np.sqrt((ir ** 2).sum(axis=0))
size = 1 << int(np.ceil(np.log2(N + ir_n)))
wet = np.stack([np.fft.irfft(np.fft.rfft(send[:, c], size) * np.fft.rfft(ir[:, c], size), size)[:N] for c in range(2)], axis=1)
wet = highpass(wet, 200, 1)

# ── Mix et mastering ────────────────────────────────────────────────────
mix = music + sfx * 0.85 + wet * 0.9
mix = highpass(mix, 30, 2)
t = np.arange(N) / SR
mix *= np.clip((DUR - t) / 0.6, 0, 1)[:, None]          # dernier fondu
mix *= np.clip(t / 0.05, 0, 1)[:, None]
peak = np.abs(mix).max()
mix = mix / peak * 1.25
mix = np.tanh(mix)                                        # limiteur doux
mix = mix / np.abs(mix).max() * 0.89                      # crête à -1 dBFS
rms = np.sqrt((mix ** 2).mean())
print(f"crête {20 * np.log10(np.abs(mix).max()):.1f} dBFS, efficace {20 * np.log10(rms):.1f} dBFS")

pcm = (np.clip(mix, -1, 1) * 32767).astype(np.int16)
with wave.open(str(HERE / "audio.wav"), "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print("audio.wav", DUR, "s")
