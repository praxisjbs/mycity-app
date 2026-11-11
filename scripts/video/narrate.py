"""The narration of a MyCity training video (docs/runbooks/training-videos.md section 3).

    python scripts/video/narrate.py speak <lines.json> <out-dir>
        lines.json: {"voice": "bf_emma", "speed": 1.0, "lines": [{"id": "c01-01", "speech": "..."}]}
        Writes <out-dir>/<id>.wav for each line not already there (24 kHz mono, silence trimmed)
        and <out-dir>/durations.json, {"<id>": seconds}.

    python scripts/video/narrate.py mix <timeline.json> <out.wav>
        timeline.json: {"length": seconds, "clips": [{"file": "...wav", "at": seconds}]}
        Lays every clip at its time on one silent track.

The voice is Kokoro's bf_emma at speed 1.0, measured against the Milestone 3 video. Loudness is
set later, by ffmpeg, on the finished track.
"""
import json
import os
import sys

import numpy as np
import soundfile as sf

RATE = 24000


def trim(audio, floor_db=-40.0, pad=0.03):
    """Cut the silence Kokoro leaves at each end, keeping `pad` seconds either side."""
    if audio.size == 0:
        return audio
    frame = 240
    n = len(audio) // frame
    if n == 0:
        return audio
    rms = np.sqrt((audio[: n * frame].reshape(n, frame) ** 2).mean(axis=1) + 1e-12)
    loud = np.where(20 * np.log10(rms / (rms.max() + 1e-12)) > floor_db)[0]
    if loud.size == 0:
        return audio
    p = int(pad * RATE)
    return audio[max(0, loud[0] * frame - p): min(len(audio), (loud[-1] + 1) * frame + p)]


def speak(lines_path, out_dir):
    from kokoro import KPipeline  # imported here so `mix` runs without the model

    spec = json.load(open(lines_path, encoding="utf-8"))
    os.makedirs(out_dir, exist_ok=True)
    durations_path = os.path.join(out_dir, "durations.json")
    durations = json.load(open(durations_path)) if os.path.exists(durations_path) else {}
    pipeline = KPipeline(lang_code="b", repo_id="hexgrad/Kokoro-82M")
    for line in spec["lines"]:
        wav = os.path.join(out_dir, line["id"] + ".wav")
        stamp = os.path.join(out_dir, line["id"] + ".txt")
        said = f'{spec["voice"]}|{spec["speed"]}|{line["speech"]}'
        if os.path.exists(wav) and os.path.exists(stamp) and open(stamp, encoding="utf-8").read() == said:
            continue
        parts = [a.numpy() if hasattr(a, "numpy") else np.asarray(a)
                 for _, _, a in pipeline(line["speech"], voice=spec["voice"], speed=spec["speed"])]
        audio = trim(np.concatenate(parts).astype(np.float32))
        sf.write(wav, audio, RATE)
        open(stamp, "w", encoding="utf-8").write(said)
        durations[line["id"]] = round(len(audio) / RATE, 3)
        print(f'{line["id"]} {durations[line["id"]]:.2f}s', flush=True)
    for line in spec["lines"]:
        if line["id"] not in durations:
            durations[line["id"]] = round(sf.info(os.path.join(out_dir, line["id"] + ".wav")).duration, 3)
    json.dump(durations, open(durations_path, "w"), indent=1)


def mix(timeline_path, out_path):
    t = json.load(open(timeline_path, encoding="utf-8"))
    track = np.zeros(int(t["length"] * RATE) + RATE, dtype=np.float32)
    for clip in t["clips"]:
        audio, rate = sf.read(clip["file"], dtype="float32")
        assert rate == RATE, f'{clip["file"]} is {rate} Hz'
        start = int(clip["at"] * RATE)
        end = min(len(track), start + len(audio))
        track[start:end] += audio[: end - start]
    sf.write(out_path, track[: int(t["length"] * RATE)], RATE)


if __name__ == "__main__":
    if len(sys.argv) != 4 or sys.argv[1] not in ("speak", "mix"):
        sys.exit(__doc__)
    (speak if sys.argv[1] == "speak" else mix)(sys.argv[2], sys.argv[3])
