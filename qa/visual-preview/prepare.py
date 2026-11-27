"""Package only CI-generated web assets and browser screenshots; no clinic data."""
from pathlib import Path
import shutil
import html
import sys

dist = Path(sys.argv[1])
screens = Path(sys.argv[2])
out = Path(__file__).parent / "src/main/assets"
assert (dist / "index.html").is_file()
allowed = {".html", ".js", ".mjs", ".css", ".json", ".webmanifest", ".png", ".jpg", ".jpeg", ".webp", ".svg", ".ico", ".woff", ".woff2", ".ttf"}
if out.exists():
    shutil.rmtree(out)
for file in dist.rglob("*"):
    if file.is_file() and file.suffix.lower() in allowed:
        rel = file.relative_to(dist)
        if rel.parts[0] == "releases":
            continue
        dest = out / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(file, dest)
gallery = out / "qa-gallery"
gallery.mkdir(parents=True)
items = []
for i, file in enumerate(sorted(screens.rglob("*.png")), 1):
    filename = f"screen-{i}.png"
    shutil.copyfile(file, gallery / filename)
    label = html.escape(str(file.relative_to(screens)))
    items.append(f'<figure><figcaption>{label}</figcaption><a href="{filename}"><img src="{filename}" loading="lazy" alt="{label}"></a></figure>')
assert items, "No actual browser evidence found"
(gallery / "index.html").write_text("""<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MinaDental QA</title><style>body{font-family:sans-serif;background:#eef3f7;color:#14283b;margin:16px}figure{background:white;border-radius:16px;padding:12px;margin:12px 0}img{width:100%;height:auto;border-radius:8px}figcaption{overflow-wrap:anywhere;direction:ltr;font-size:12px;margin:8px 0}</style><h2>تصاویر واقعی تست رابط مینادنتال</h2><p>این تصاویر از مرورگرهای CI هستند؛ داده واقعی و اتصال به مطب وجود ندارد. دکمه «رابط برنامه» نسخه محلی رابط را باز می‌کند؛ ورود و عملیات سرور در این بسته در دسترس نیستند.</p>""" + "".join(items), encoding="utf-8")
