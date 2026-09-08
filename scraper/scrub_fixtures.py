"""One-shot: turn raw spike fixtures (gitignored, PII) into committed scrubbed ones.

Run manually after a spike:  cd scraper && uv run python scrub_fixtures.py
Not run in CI. Raw fixtures live in tests/fixtures/, scrubbed in tests/fixtures/scrubbed/.

Scrubbing is done at several levels and is idempotent / safe to re-run:
  * key-based: any dict key in REDACT is replaced with a neutral value; keys in
    STR_REDACT are replaced only when their value is a string
  * title fields (TITLE_KEYS): free-text name suffixes are stripped
  * value-based: any string is matched against PII / URL regexes and rewritten;
    a broad catch-all rewrites any non-allowlisted http(s) host LAST
Large top-level data.<listkey> arrays are truncated to the first 6 items.
"""
import json
import re
from pathlib import Path

RAW = Path(__file__).parent / "tests" / "fixtures"
OUT = RAW / "scrubbed"
OUT.mkdir(exist_ok=True)

# key -> replacement value (applied recursively, any depth, any value type)
REDACT = {
    "email": "student@example.test",
    "phone": "0000000000",
    "bloodGroup": "O+",
    "firstName": "Test",
    "lastName": "Student",
    "enrollmentNo": "MSB_TEST_000",
    "avatarUrl": None,
    "coverImageUrl": None,
    "courseCoverUrl": None,
    "thumbnailUrl": None,
    "authorAvatarUrl": None,
    "userName": "Student",
    "topLikers": [],
    "likedBy": [],
    "reactions": [],
    "description": None,
    # instructor / people identifiers
    "instructorName": None,
    "instructorLinkedIn": None,
    "instructorEmail": None,
    "authorName": None,
    "createdByName": None,
    "updatedByName": None,
    "submittedByName": None,
    "graderName": None,
    "leaderName": None,
    "programName": None,
    "sectionNames": None,
    "sectionName": None,
    # attendee lists (arrays of emails / {name,email} objects)
    "gcalAttendees": None,
    "gcalAttendeesAt": None,
    "externalAttendees": None,
    "attendees": None,
    # opaque links / media that can encode addresses or signed identity
    "gcalEventLink": "https://calendar.example.test/event",
    "gcalEventId": "redacted-event-id",
    # embedUrl / videoUrl are handled value-based: youtube hosts are allowlisted
    # and survive; any other host is rewritten by the catch-all
}

# key -> replacement, applied ONLY when the current value is a string
STR_REDACT = {
    "body": "<scrubbed>",
    "htmlBody": "<scrubbed>",
    "instructions": "<scrubbed>",
    "content": "<scrubbed>",
}

# title-ish fields: strip trailing free-text name suffixes
TITLE_KEYS = {"title", "courseName", "courseTitle", "name", "shortName", "fileName"}

SIGNED_URL = re.compile(r"https://storage\.googleapis\.com/[^\"\s<>)]*")
EMAIL = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
LINKEDIN = re.compile(r"https?://(?:[a-z]{2,3}\.)?linkedin\.com/in/[^\"\s<>)]*", re.I)
GCAL_URL = re.compile(
    r"https?://(?:www\.)?(?:google\.com/calendar|calendar\.google\.com)/[^\"\s<>)]*", re.I
)
MESA_HOST = re.compile(r"(?:https?://)?[A-Za-z0-9.\-]*mesaschool\.co[^\"\s<>)]*", re.I)
MESA_SCRIPT = re.compile(r"https?://script\.google\.com/[^\"\s<>)]*", re.I)
GOOGLE_DOC = re.compile(r"https?://(?:docs|drive)\.google\.com/[^\"\s<>)]*", re.I)
FORMS_GLE = re.compile(r"https?://forms\.gle/[^\"\s<>)]*", re.I)
# broad catch-all: any http(s) URL, run LAST
ANY_URL = re.compile(r"https?://[^\"\s<>)]+", re.I)
ALLOWED_HOSTS = (
    "example.test",
    "youtube.com",
    "youtube-nocookie.com",
    "img.youtube.com",
)

TITLE_SUFFIX_WITH = re.compile(r"\s+with\s+.*$", re.I)
TITLE_SEP = re.compile(r"\s+[|–]\s+.*$")  # " | ..."  or  " – ..."

LIST_KEYS = ("events", "announcements", "assignments", "courses", "materials", "recordings")
MAX_ITEMS = 6


def _host_allowed(url: str) -> bool:
    m = re.match(r"https?://([^/\"\s<>)]+)", url, re.I)
    if not m:
        return True
    host = m.group(1).lower()
    return any(host == h or host.endswith("." + h) for h in ALLOWED_HOSTS)


def _catch_all(m: re.Match) -> str:
    url = m.group(0)
    return url if _host_allowed(url) else "https://example.test/link"


def scrub_str(s: str) -> str:
    s = SIGNED_URL.sub("https://example.test/asset", s)
    s = GCAL_URL.sub("https://calendar.example.test/event", s)
    s = EMAIL.sub("redacted@example.test", s)
    s = GOOGLE_DOC.sub("https://example.test/doc", s)
    s = FORMS_GLE.sub("https://example.test/form", s)
    s = MESA_SCRIPT.sub("https://example.test/link", s)
    s = MESA_HOST.sub("https://example.test/link", s)
    s = LINKEDIN.sub("https://example.test/profile", s)
    s = ANY_URL.sub(_catch_all, s)  # LAST
    return s


def scrub_title(v: str) -> str:
    v = TITLE_SUFFIX_WITH.sub("", v)
    v = TITLE_SEP.sub("", v)
    return v.strip()


def clean(node, key=None):
    if isinstance(node, dict):
        out = {}
        for k, v in node.items():
            if k in REDACT:
                out[k] = REDACT[k]
            elif k in STR_REDACT and isinstance(v, str):
                out[k] = STR_REDACT[k]
            else:
                out[k] = clean(v, k)
        return out
    if isinstance(node, list):
        return [clean(v, key) for v in node]
    if isinstance(node, str):
        s = scrub_str(node)
        if key in TITLE_KEYS:
            s = scrub_title(s)
        return s
    return node


def truncate(data):
    if isinstance(data, dict) and isinstance(data.get("data"), dict):
        for k, v in list(data["data"].items()):
            if k in LIST_KEYS and isinstance(v, list) and len(v) > MAX_ITEMS:
                data["data"][k] = v[:MAX_ITEMS]
    return data


for f in RAW.glob("*.json"):
    if f.name.startswith("_"):
        continue
    data = json.loads(f.read_text())
    data = truncate(clean(data))
    (OUT / f.name).write_text(json.dumps(data, indent=1))
    print("scrubbed", f.name)
