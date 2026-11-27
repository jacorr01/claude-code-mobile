#!/usr/bin/env python3
"""Export a standalone copy of Spirebound that needs no room server.

    python3 tools/export-static.py <out-dir>

Writes <out-dir>/index.html plus every asset beside it, with relative paths, so
the folder can be served from any static host or published as a single page
with supporting files. The page is a body fragment (no doctype/head) because
some hosts wrap it in their own document; browsers accept it either way.

The copy keeps its Hall of Ascents in the browser: it ships src/logic.js and
runs the same rules locally instead of opening a socket. Models are packed as
base64 text (models/<id>.glb.txt), which the 3D layer unpacks itself.
"""
import base64
import re
import shutil
import sys
from pathlib import Path

APP = Path(__file__).resolve().parent.parent / "app"
PUBLIC = APP / "public"


def main(out: Path) -> None:
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(PUBLIC, out, ignore=shutil.ignore_patterns("index.html", "style.css", "fonts"))
    shutil.copy(APP / "src" / "logic.js", out / "logic.js")

    # Hosts that serve only web media types refuse .glb, so models travel as base64 text.
    for glb in sorted((out / "models").glob("*.glb")):
        glb.with_name(glb.name + ".txt").write_bytes(base64.b64encode(glb.read_bytes()))
        glb.unlink()
    index = out / "models.js"
    listing = index.read_text()
    assert '.glb"' in listing
    index.write_text(listing.replace('.glb"', '.glb.txt"'))

    html = (PUBLIC / "index.html").read_text()
    body = re.search(r"<body>(.*)</body>", html, re.S).group(1)
    body = body.replace(
        '<script type="module" src="client.js"></script>',
        '<script>window.SPIRE_STANDALONE = true;</script>\n    <script type="module" src="client.js"></script>',
    )
    assert "SPIRE_STANDALONE" in body, "client script tag not found"

    css = (PUBLIC / "style.css").read_text()
    font = base64.b64encode((PUBLIC / "fonts" / "Cinzel.ttf").read_bytes()).decode()
    assert 'url("fonts/Cinzel.ttf")' in css
    css = css.replace('url("fonts/Cinzel.ttf")', f'url("data:font/ttf;base64,{font}")')

    page = f"<title>Spirebound</title>\n<style>\n{css}\n</style>\n{body.strip()}\n"
    (out / "index.html").write_text(page)
    files = sorted(p.relative_to(out).as_posix() for p in out.rglob("*") if p.is_file())
    print(f"{len(files)} files, {sum((out / f).stat().st_size for f in files) / 1e6:.1f} MB -> {out}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(Path(sys.argv[1]).resolve())
