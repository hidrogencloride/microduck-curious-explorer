#!/usr/bin/env python3
"""Build the self-contained Hugging Face Spaces preview using only Python's stdlib.

The editable website stays in web/. The release contains a single-document preview
with an embedded field guide, a direct guide entry point, a Spaces README, and the
project license. Every style, script, and artwork asset is embedded.
No source file or robot configuration is changed by this command.
"""

from __future__ import annotations

import argparse
import base64
from html.parser import HTMLParser
import json
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"
SOURCE_URL = "https://github.com/hidrogencloride/curious-explorer"
ENGINE_IMPORT = re.compile(
    r"^import\s+\{\s*Explorer\s*,\s*PREVIEW_SKILLS\s*\}\s+"
    r"from\s+['\"]\./engine\.js['\"];?\s*\n",
    re.MULTILINE,
)

# Hash-only routing keeps the hosted preview and guide inside the same authorized
# document. It does not read, copy, or change a hosting provider's query parameters.
SPACE_ROUTER = r"""
const spacePracticeView = document.getElementById('space-practice-view');
const spaceGuideView = document.getElementById('space-guide-view');
const spaceDefaultGuide = __DEFAULT_GUIDE__;
function showSpaceRoute() {
  const route = location.hash || (spaceDefaultGuide ? '#field-guide' : '#home');
  const showGuide = route === '#field-guide' || route.startsWith('#field-guide-');
  if (showGuide && spaceGuideView.hidden) void pauseExplorer('guide');
  spacePracticeView.hidden = showGuide;
  spaceGuideView.hidden = !showGuide;
  document.title = showGuide
    ? 'Your field guide — Curious Explorer'
    : 'Curious Explorer — A little wonder, every day.';
  requestAnimationFrame(() => {
    let target = document.getElementById(route.slice(1));
    if (showGuide && !target) target = document.getElementById('field-guide');
    if (route === '#home') {
      window.scrollTo({ top: 0, behavior: 'instant' });
      target = spacePracticeView.querySelector('h1');
    } else if (target) {
      target.scrollIntoView({ block: 'start', behavior: 'instant' });
    }
    if (target) {
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    }
  });
}
window.addEventListener('hashchange', showSpaceRoute);
showSpaceRoute();
"""


def svg_url(path: Path) -> str:
    return "data:image/svg+xml;base64," + base64.b64encode(path.read_bytes()).decode("ascii")


def inline_artwork(text: str) -> str:
    """Embed each referenced SVG in HTML attributes or JavaScript string literals."""
    for path in sorted((WEB / "assets").glob("*.svg")):
        text = text.replace("assets/" + path.name, svg_url(path))
    if re.search(r"(?:['\"]|url\()assets/", text):
        raise ValueError("A web asset was not embedded. Add its format to the build script.")
    return text


def bundle_script() -> str:
    engine = (WEB / "engine.js").read_text(encoding="utf-8")
    # Only the engine's named declaration exports are removed. Other module
    # constructs cause a clear failure rather than a partial, broken release.
    engine = re.sub(r"^export (?=(?:const|class|function)\s)", "", engine, flags=re.MULTILINE)
    app, count = ENGINE_IMPORT.subn("", (WEB / "app.js").read_text(encoding="utf-8"), count=1)
    if count != 1:
        raise ValueError("The expected engine import changed; update the static bundler.")
    script = inline_artwork(engine + "\n\n" + app)
    if re.search(r"^\s*(?:import|export)\s", script, flags=re.MULTILINE):
        raise ValueError("An unsupported module import or export remains in the bundle.")
    # Keep an accidental future closing tag inside JS text from ending the element.
    return re.sub(r"</script", r"<\\/script", script, flags=re.IGNORECASE)


class DependencyCheck(HTMLParser):
    """Ensure published pages need no separate CSS, JS, font, or image files."""

    def __init__(self) -> None:
        super().__init__()
        self.errors: list[str] = []
        self.inline_scripts = 0
        self.inline_styles = 0
        self.ids: set[str] = set()

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if values.get("id"):
            if values["id"] in self.ids:
                self.errors.append(f"Duplicate element id: {values['id']}")
            self.ids.add(values["id"])
        if tag == "script":
            if values.get("src"):
                self.errors.append("An external script reference remains.")
            else:
                self.inline_scripts += 1
        if tag == "style":
            self.inline_styles += 1
        if tag == "link" and values.get("rel") == "stylesheet":
            self.errors.append("An external stylesheet reference remains.")
        for name in ("src", "poster"):
            value = values.get(name)
            if value and not value.startswith("data:"):
                self.errors.append(f"Unembedded {tag} {name}: {value}")
        if tag == "link" and values.get("rel") == "icon":
            if not (values.get("href") or "").startswith("data:"):
                self.errors.append("An external icon reference remains.")


def single_document_markup() -> str:
    page = (WEB / "index.html").read_text(encoding="utf-8")
    source_guide = (WEB / "guide.html").read_text(encoding="utf-8")
    body = re.search(r"<body[^>]*>(.*?)</body>", source_guide, flags=re.DOTALL)
    if not body:
        raise ValueError("guide.html: expected a field guide body.")
    guide = body.group(1)
    guide_ids = {
        name: "field-guide" if name == "guide" else "field-guide-" + name
        for name in re.findall(r'\bid="([^"]+)"', guide)
    }
    guide = re.sub(r'\bid="([^"]+)"', lambda match: 'id="' + guide_ids[match[1]] + '"', guide)
    guide = re.sub(
        r'href="#([^"]+)"',
        lambda match: 'href="#' + guide_ids.get(match[1], "field-guide-" + match[1]) + '"',
        guide,
    )
    guide = guide.replace('class="brand" href="./"', 'class="brand" href="#home"')
    guide = guide.replace('href="./"', 'href="#practice"')
    page = re.sub(
        r'href="guide\.html(?:#([^"]+))?"',
        lambda match: 'href="#field-guide' + ("-" + match[1] if match[1] else "") + '"',
        page,
    )
    page = page.replace('href="./"', 'href="#home"')
    script_tag = '<script type="module" src="app.js"></script>'
    if page.count(script_tag) != 1:
        raise ValueError("index.html: expected exactly one app module reference.")
    page = page.replace("<body>", '<body>\n<div id="space-practice-view">', 1)
    page = page.replace(script_tag, '</div>\n<div id="space-guide-view" hidden>\n' + guide + '\n</div>\n' + script_tag)
    return page


def build_page(filename: str, style: str, script: str) -> str:
    # guide.html remains a direct-entry fallback; both files have the same complete
    # app and guide, and all in-product navigation stays in the current document.
    page = single_document_markup()
    stylesheet = '<link rel="stylesheet" href="style.css">'
    if page.count(stylesheet) != 1:
        raise ValueError(f"{filename}: expected exactly one stylesheet reference.")
    page = page.replace(stylesheet, "<style>\n" + style + "\n</style>")
    script_tag = '<script type="module" src="app.js"></script>'
    router = SPACE_ROUTER.replace("__DEFAULT_GUIDE__", "true" if filename == "guide.html" else "false")
    page = page.replace(script_tag, '<script type="module">\n' + script + router + "\n</script>")
    page = inline_artwork(page)
    check = DependencyCheck()
    check.feed(page)
    if check.inline_styles != 1:
        check.errors.append("Expected exactly one embedded stylesheet.")
    if check.inline_scripts != 1:
        check.errors.append("Unexpected script count.")
    if re.search(r'href="(?:\./|guide\.html|index\.html)(?:["#])', page):
        check.errors.append("An in-product link would leave the current document.")
    if check.errors:
        raise ValueError(f"{filename}: " + " ".join(check.errors))
    return page


def space_readme(version: str) -> str:
    return f"""---
title: Curious Explorer
emoji: 🦆
colorFrom: green
colorTo: yellow
sdk: static
app_file: index.html
pinned: false
license: apache-2.0
---

# Curious Explorer

**A little wonder, every day.**

A thoughtful character for Microduck, with a soft spot for small discoveries.
Meet it in an illustrated practice field: introduce a rustling leaf, a new object,
or a friendly hello, and watch its curiosity unfold.

Choose **Let’s explore** to begin. No robot, account, or AI subscription is needed.
The **Field guide** explains the character, its memories, and the next steps.

## Your duck keeps what it knows

Curious Explorer is an additive personality layer. It requests available actions;
it does not install, replace, or remove the robot’s existing skills. Optional
greetings require the owner’s permission, and the character can be paused at any time.

## A character rehearsal

Version {version} uses synthetic encounters and an illustrated field. It is not a
physics simulator, does not recognize objects through a camera, and does not control
a robot from this hosted page. Creature sounds are shown as cues in the field notes;
the browser preview does not play audio.

Preferences, skill choices, and simple encounter memories stay in this browser.
Clear the field journal to reset memories, or clear the site’s browser data to remove
everything saved by the preview. There is no app analytics or recording collection.
Hugging Face may maintain its normal hosting logs.

The [source project]({SOURCE_URL}) includes the local companion and an experimental
adapter for an existing Microduck simulator. Hardware behavior and permanent
installation on the duck have not been validated.

An independent community project by **hidrogencloride**. Not affiliated with
Pollen Robotics, Hugging Face, or NVIDIA. Code, documentation, and original artwork
are available under the [Apache 2.0 license](LICENSE).
"""


def build(output: Path) -> dict[str, int]:
    output = output.expanduser().resolve()
    if output == ROOT or ROOT in output.parents:
        raise ValueError("Choose a release output directory outside the source checkout.")
    style = inline_artwork((WEB / "style.css").read_text(encoding="utf-8"))
    if "</style" in style.lower():
        raise ValueError("The stylesheet contains a closing style tag.")
    if re.search(r"url\(\s*['\"]?(?!data:)[^\s'\")]+", style):
        raise ValueError("The stylesheet contains an asset URL that was not embedded.")
    script = bundle_script()
    version = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]
    files = {
        "index.html": build_page("index.html", style, script),
        "guide.html": build_page("guide.html", style, script),
        "README.md": space_readme(version),
        "LICENSE": (ROOT / "LICENSE").read_text(encoding="utf-8"),
    }
    output.mkdir(parents=True, exist_ok=True)
    for name, content in files.items():
        (output / name).write_text(content, encoding="utf-8")
    return {name: (output / name).stat().st_size for name in files}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output", type=Path, default=ROOT.parent / "curious-explorer-space",
        help="Output folder outside this checkout (default: adjacent curious-explorer-space folder).",
    )
    args = parser.parse_args()
    try:
        files = build(args.output)
    except (OSError, ValueError, KeyError) as exc:
        parser.exit(1, f"Build failed: {exc}\n")
    print(f"Spaces preview built and asset references checked: {args.output.resolve()}")
    for name, size in files.items():
        print(f"  {name}: {size:,} bytes")


if __name__ == "__main__":
    main()
