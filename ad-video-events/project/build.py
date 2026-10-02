#!/usr/bin/env python3
"""Editable timeline for the RAYA Garden events ad.

Everything that defines the cut lives in TIMELINE / TEXT / AUDIO below; the
script turns it into one ffmpeg filter graph per format and renders
  ../RAYA-Garden-events-ad_9x16_1080x1920.mp4
  ../RAYA-Garden-events-ad_4x5_1080x1350.mp4

    python3 build.py            # both formats
    python3 build.py 916        # one format

Change a trim, a transition or a text timing here and re-run; change the
copy or typography in render-overlays.cjs and re-run that first.
"""
import subprocess, sys, os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.dirname(HERE)
FPS = 24
DUR = 24.0

# Shots in order. src_in/len are seconds in the generated clip; `x` is the
# dissolve (seconds) INTO this shot from the previous one (0 = straight cut).
# crop45 = top edge of the 1080x1350 window taken from the 1080x1920 clip.
TIMELINE = [
    dict(name="S1 hook — banquet table",     clip="clips/s1_0266_kling.mp4",  src_in=0.15, len=3.20, x=0.0, crop45=300),
    dict(name="S2 corporate — long tables",  clip="clips/s2_0269_kling.mp4",  src_in=0.00, len=5.00, x=0.4, crop45=220),
    dict(name="S3 private — garden gazebo",  clip="clips/s3_0069_kling.mp4",  src_in=0.00, len=5.00, x=0.4, crop45=300),
    dict(name="S4a detail — dessert",        clip="clips/s4a_0072_kling.mp4", src_in=0.60, len=2.70, x=0.0, crop45=285),
    dict(name="S4b detail — rosé pour",      clip="clips/s4b_0075_kling.mp4", src_in=0.00, len=2.70, x=0.0, crop45=200),
    dict(name="S5 brand — view over town",   clip="clips/s5_0092_kling8s.mp4", src_in=0.00, len=6.60, x=0.4, crop45=150),
]

# Overlay cards (rendered by render-overlays.cjs): name, fade-in start,
# fully-on, fade-out start, fully-off (seconds on the output timeline).
TEXT = [
    ("hook",      0.15, 0.50,  2.50,  2.82),
    ("corporate", 3.25, 3.60,  7.05,  7.40),
    ("private",   7.85, 8.20, 11.95, 12.30),
    ("tagline1", 12.60, 12.95, 17.15, 17.45),
    ("tagline2", 14.10, 14.45, 17.15, 17.45),
    ("endcard",  17.85, 18.60, 99.00, 99.00),   # holds to the last frame
]

# Music: CC0 recording, excerpt [start, start+DUR), gentle fades.
MUSIC = dict(file="music/Chopin_Nocturne_Op62_No2_Musopen_CC0.mp3", start=31.0, fade_in=0.6, fade_out=1.6)
# Ambience from the generated clips (speech-checked); output-time placement.
AMBIENCE = [  # clip, src_in, out_start, length, volume
    ("clips/s1_0266_kling.mp4", 0.15, 0.00, 3.20, 0.30),
    ("clips/s4b_0075_kling.mp4", 0.00, 15.10, 2.70, 0.35),
]

FORMATS = {
    "916": dict(w=1080, h=1920, out="RAYA-Garden-events-ad_9x16_1080x1920.mp4"),
    "45":  dict(w=1080, h=1350, out="RAYA-Garden-events-ad_4x5_1080x1350.mp4"),
}

# One shared grade so every shot sits in the same warm, natural palette.
GRADE = "eq=contrast=1.03:saturation=0.96:gamma=1.0,colorbalance=rs=0.015:bs=-0.015:rh=0.01:bh=-0.01"


def build(fmt_key):
    fmt = FORMATS[fmt_key]
    w, h = fmt["w"], fmt["h"]
    inputs, chains = [], []

    for i, s in enumerate(TIMELINE):
        inputs += ["-i", os.path.join(HERE, s["clip"])]
        crop = "" if fmt_key == "916" else f"crop={w}:{h}:0:{s['crop45']},"
        chains.append(
            f"[{i}:v]trim=start={s['src_in']}:duration={s['len']},setpts=PTS-STARTPTS,"
            f"fps={FPS},scale=1080:1920:flags=lanczos,{crop}{GRADE},format=yuv420p,setsar=1,settb=1/{FPS}[v{i}]")

    # Chain the shots: xfade for dissolves, concat for straight cuts.
    cur, t = "v0", TIMELINE[0]["len"]
    for i in range(1, len(TIMELINE)):
        s = TIMELINE[i]
        nxt = f"c{i}"
        if s["x"] > 0:
            off = t - s["x"]
            chains.append(f"[{cur}][v{i}]xfade=transition=fade:duration={s['x']}:offset={off:.3f},settb=1/{FPS}[{nxt}]")
            t = off + s["len"]
        else:
            chains.append(f"[{cur}][v{i}]concat=n=2:v=1:a=0,settb=1/{FPS}[{nxt}]")
            t = t + s["len"]
        cur = nxt
    assert abs(t - DUR) < 0.05, f"timeline is {t:.2f}s, expected {DUR}"

    # Overlays with alpha fades.
    n = len(TIMELINE)
    for j, (card, a, b, c, d) in enumerate(TEXT):
        inputs += ["-loop", "1", "-framerate", str(FPS), "-t", str(DUR),
                   "-i", os.path.join(HERE, "overlays", fmt_key, f"{card}.png")]
        k = n + j
        fades = f"fade=t=in:st={a}:d={b - a}:alpha=1"
        if c < DUR:
            fades += f",fade=t=out:st={c}:d={d - c}:alpha=1"
        chains.append(f"[{k}:v]format=rgba,{fades}[o{j}]")
        chains.append(f"[{cur}][o{j}]overlay=0:0:shortest=1[t{j}]")
        cur = f"t{j}"
    chains.append(f"[{cur}]trim=duration={DUR},format=yuv420p[vout]")

    # Audio: music bed + quiet ambience, then loudness-normalised.
    m = n + len(TEXT)
    inputs += ["-i", os.path.join(HERE, MUSIC["file"])]
    chains.append(
        f"[{m}:a]atrim=start={MUSIC['start']}:duration={DUR},asetpts=PTS-STARTPTS,"
        f"aresample=48000,afade=t=in:d={MUSIC['fade_in']},"
        f"afade=t=out:st={DUR - MUSIC['fade_out']}:d={MUSIC['fade_out']}[mus]")
    mix = ["[mus]"]
    for a_i, (clip, src_in, start, length, vol) in enumerate(AMBIENCE):
        idx = m + 1 + a_i
        inputs += ["-i", os.path.join(HERE, clip)]
        chains.append(
            f"[{idx}:a]atrim=start={src_in}:duration={length},asetpts=PTS-STARTPTS,aresample=48000,"
            f"highpass=f=80,volume={vol},afade=t=in:d=0.4,afade=t=out:st={length - 0.5}:d=0.5,"
            f"adelay={int(start * 1000)}|{int(start * 1000)}[amb{a_i}]")
        mix.append(f"[amb{a_i}]")
    chains.append(
        f"{''.join(mix)}amix=inputs={len(mix)}:normalize=0:duration=first,"
        f"atrim=duration={DUR},loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[aout]")

    out = os.path.join(OUT, fmt["out"])
    cmd = ["ffmpeg", "-v", "error", "-y", *inputs,
           "-filter_complex", ";".join(chains),
           "-map", "[vout]", "-map", "[aout]",
           "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-profile:v", "high",
           "-pix_fmt", "yuv420p", "-r", str(FPS), "-movflags", "+faststart",
           "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-t", str(DUR), out]
    subprocess.run(cmd, check=True)
    print("wrote", out)


if __name__ == "__main__":
    for key in (sys.argv[1:] or FORMATS.keys()):
        build(key)
