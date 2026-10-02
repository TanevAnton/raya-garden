#!/usr/bin/env python3
"""Builds the RAYA Garden ads from films.json.

    python3 build.py                     # every film, both formats
    python3 build.py birthday            # one film, both formats
    python3 build.py wedding 916         # one film, one format

Each film renders to ../<out>_9x16_1080x1920.mp4 and ../<out>_4x5_1080x1350.mp4.
Shots, trims, dissolves, text timings, music excerpt and ambience are all in
films.json; overlays come from render-overlays.cjs (run it first after any
copy change). Needs ffmpeg.
"""
import json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.dirname(HERE)
FPS, DUR = 24, 24.0
FILMS = {k: v for k, v in json.load(open(os.path.join(HERE, "films.json"))).items() if not k.startswith("_")}
FORMATS = {"916": (1080, 1920, "9x16_1080x1920"), "45": (1080, 1350, "4x5_1080x1350")}

# One shared grade so every shot sits in the same warm, natural palette.
GRADE = "eq=contrast=1.03:saturation=0.96,colorbalance=rs=0.015:bs=-0.015:rh=0.01:bh=-0.01"


def build(film, fmt_key):
    cfg = FILMS[film]
    w, h, suffix = FORMATS[fmt_key]
    inputs, g = [], []
    p = lambda rel: os.path.join(HERE, rel)

    shots = cfg["shots"]
    for i, s in enumerate(shots):
        inputs += ["-i", p(s["clip"])]
        crop = "" if fmt_key == "916" else f"crop={w}:{h}:0:{s['crop45']},"
        g.append(f"[{i}:v]trim=start={s['src_in']}:duration={s['len']},setpts=PTS-STARTPTS,"
                 f"fps={FPS},scale=1080:1920:flags=lanczos,{crop}{GRADE},format=yuv420p,setsar=1,settb=1/{FPS}[v{i}]")

    cur, t = "v0", shots[0]["len"]
    for i, s in enumerate(shots[1:], 1):
        if s["x"] > 0:
            off = t - s["x"]
            g.append(f"[{cur}][v{i}]xfade=transition=fade:duration={s['x']}:offset={off:.3f},settb=1/{FPS}[c{i}]")
            t = off + s["len"]
        else:
            g.append(f"[{cur}][v{i}]concat=n=2:v=1:a=0,settb=1/{FPS}[c{i}]")
            t += s["len"]
        cur = f"c{i}"
    assert abs(t - DUR) < 0.05, f"{film}: timeline is {t:.2f}s, expected {DUR}"

    n = len(shots)
    for j, c in enumerate(cfg["cards"]):
        a, b, fo, off = c["t"]
        inputs += ["-loop", "1", "-framerate", str(FPS), "-t", str(DUR),
                   "-i", p(f"overlays/{film}/{fmt_key}/{c['id']}.png")]
        fades = f"fade=t=in:st={a}:d={b - a:.3f}:alpha=1"
        if fo < DUR:
            fades += f",fade=t=out:st={fo}:d={off - fo:.3f}:alpha=1"
        g.append(f"[{n + j}:v]format=rgba,{fades}[o{j}]")
        g.append(f"[{cur}][o{j}]overlay=0:0:shortest=1[t{j}]")
        cur = f"t{j}"
    g.append(f"[{cur}]trim=duration={DUR},format=yuv420p[vout]")

    m = n + len(cfg["cards"])
    mus = cfg["music"]
    inputs += ["-i", p(mus["file"])]
    g.append(f"[{m}:a]atrim=start={mus['start']}:duration={DUR},asetpts=PTS-STARTPTS,aresample=48000,"
             f"afade=t=in:d=0.6,afade=t=out:st={DUR - 1.6}:d=1.6[mus]")
    mix = ["[mus]"]
    for k, (clip, src_in, start, length, vol) in enumerate(cfg.get("ambience", [])):
        inputs += ["-i", p(clip)]
        ms = int(start * 1000)
        g.append(f"[{m + 1 + k}:a]atrim=start={src_in}:duration={length},asetpts=PTS-STARTPTS,aresample=48000,"
                 f"highpass=f=80,volume={vol},afade=t=in:d=0.4,afade=t=out:st={length - 0.5}:d=0.5,"
                 f"adelay={ms}|{ms}[amb{k}]")
        mix.append(f"[amb{k}]")
    g.append(f"{''.join(mix)}amix=inputs={len(mix)}:normalize=0:duration=first,atrim=duration={DUR},"
             f"loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[aout]")

    out = os.path.join(OUT, f"{cfg['out']}_{suffix}.mp4")
    subprocess.run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", ";".join(g),
                    "-map", "[vout]", "-map", "[aout]",
                    "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-profile:v", "high",
                    "-pix_fmt", "yuv420p", "-r", str(FPS), "-movflags", "+faststart",
                    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-t", str(DUR), out], check=True)
    print("wrote", out)


if __name__ == "__main__":
    args = sys.argv[1:]
    films = [a for a in args if a in FILMS] or list(FILMS)
    fmts = [a for a in args if a in FORMATS] or list(FORMATS)
    for f in films:
        for k in fmts:
            build(f, k)
