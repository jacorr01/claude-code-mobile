#!/usr/bin/env python3
"""Export a standalone copy of Spirebound that needs no room server.

    python3 tools/export-static.py <out-dir>                  # a site for any static host
    python3 tools/export-static.py <out-dir> --url <address>  # ...that knows its own address
    python3 tools/export-static.py <out-dir> --fragment       # one page for hosts that wrap it

Either way the copy keeps its Hall of Ascents in the browser: it ships
src/logic.js and runs the same rules locally instead of opening a socket.

The default is a complete site (index.html plus assets, all on relative paths)
that works from any folder of any static host. --url is the address it will be
served from, used only for the link-preview image.

--fragment is for hosts that wrap the page in their own document and serve only
common web file types: index.html becomes a body fragment with its styles and
font inlined, and the models travel as base64 text (models/<id>.glb.txt), which
the 3D layer unpacks itself.
"""
import argparse
import base64
import re
import shutil
from pathlib import Path

APP = Path(__file__).resolve().parent.parent / "app"
PUBLIC = APP / "public"
CLIENT = '<script type="module" src="client.js"></script>'
FLAG = "<script>window.SPIRE_STANDALONE = true;</script>\n    " + CLIENT
PREVIEW = re.compile(r'^\s*<meta (?:property="og:image"|name="twitter:card")[^>]*>\n', re.M)


def site(out: Path, url: str | None) -> None:
    shutil.copytree(PUBLIC, out)
    html = (out / "index.html").read_text()
    assert CLIENT in html, "client script tag not found"
    html = html.replace(CLIENT, FLAG)
    if url:
        image = url.rstrip("/") + "/cover.jpg"
        html, n = re.subn(r'(<meta property="og:image" content=")[^"]*(")', rf"\g<1>{image}\g<2>", html)
        assert n == 1, "og:image tag not found"
    else:
        html = PREVIEW.sub("", html)
    (out / "index.html").write_text(html)
    # Tell GitHub Pages to serve the folder as it is.
    (out / ".nojekyll").write_text("")


def fragment(out: Path) -> None:
    shutil.copytree(PUBLIC, out, ignore=shutil.ignore_patterns("index.html", "style.css", "fonts"))
    for glb in sorted((out / "models").glob("*.glb")):
        glb.with_name(glb.name + ".txt").write_bytes(base64.b64encode(glb.read_bytes()))
        glb.unlink()
    index = out / "models.js"
    listing = index.read_text()
    assert '.glb"' in listing
    index.write_text(listing.replace('.glb"', '.glb.txt"'))

    html = (PUBLIC / "index.html").read_text()
    body = re.search(r"<body>(.*)</body>", html, re.S).group(1)
    assert CLIENT in body, "client script tag not found"
    body = body.replace(CLIENT, FLAG)

    css = (PUBLIC / "style.css").read_text()
    font = base64.b64encode((PUBLIC / "fonts" / "Cinzel.ttf").read_bytes()).decode()
    assert 'url("fonts/Cinzel.ttf")' in css
    css = css.replace('url("fonts/Cinzel.ttf")', f'url("data:font/ttf;base64,{font}")')
    (out / "index.html").write_text(f"<title>Spirebound</title>\n<style>\n{css}\n</style>\n{body.strip()}\n")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("out", type=Path)
    ap.add_argument("--url")
    ap.add_argument("--fragment", action="store_true")
    args = ap.parse_args()
    out = args.out.resolve()
    if out.exists():
        shutil.rmtree(out)
    if args.fragment:
        fragment(out)
    else:
        site(out, args.url)
    shutil.copy(APP / "src" / "logic.js", out / "logic.js")
    files = [p for p in out.rglob("*") if p.is_file()]
    print(f"{len(files)} files, {sum(p.stat().st_size for p in files) / 1e6:.1f} MB -> {out}")


if __name__ == "__main__":
    main()
