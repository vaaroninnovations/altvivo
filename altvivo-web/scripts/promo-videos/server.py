"""Promo video recorder for the homepage hero (src/components/hero-videos.tsx).

Run the `promo-recorder` entry in .claude/launch.json (or: python -I server.py), open
http://localhost:8790/?app=xprism (or ?app=amaze) in Chrome, keep the tab visible and run
`await record()` in the console. The animation is recorded in real time (13 s) and saved,
with a poster frame, straight into public/videos/.
"""
import http.server, os, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
PUBLIC = os.path.normpath(os.path.join(HERE, "..", "..", "public"))
OUT = os.path.join(PUBLIC, "videos")
ALLOWED = {f"{app}-promo.{ext}" for app in ("xprism", "amaze") for ext in ("mp4", "webm", "jpg")}


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=HERE, **k)

    def translate_path(self, path):
        # Brand artwork comes from the site's own public/brand folder.
        if path.startswith("/brand/"):
            return os.path.join(PUBLIC, "brand", os.path.basename(urllib.parse.urlparse(path).path))
        return super().translate_path(path)

    def do_POST(self):
        name = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).get("name", [""])[0]
        if name not in ALLOWED:
            self.send_error(400, "unexpected file name")
            return
        data = self.rfile.read(int(self.headers["Content-Length"]))
        with open(os.path.join(OUT, name), "wb") as f:
            f.write(data)
        self.send_response(200)
        self.end_headers()
        self.wfile.write(f"saved {name} {len(data)}".encode())


if __name__ == "__main__":
    http.server.ThreadingHTTPServer(("127.0.0.1", 8790), Handler).serve_forever()
