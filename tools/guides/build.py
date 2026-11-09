"""Builds one step-by-step PDF guide per page of the Oakridge Product Suite rebuild.

Usage (from the repo root, after running shots.js to capture screenshots):
    python3 tools/guides/build.py docs/guides icons/icon-512.png

Update VERSION and the step text below when a page changes, then re-run both.
"""
import os
import sys
from PIL import Image as PILImage
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_CENTER
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Table,
                                TableStyle, Image, KeepTogether, Flowable)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(HERE, "shots")
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "out")
LOGO = sys.argv[2] if len(sys.argv) > 2 else None
os.makedirs(OUT, exist_ok=True)

pdfmetrics.registerFont(TTFont("Sans", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"))
pdfmetrics.registerFont(TTFont("Sans-Bold", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"))
pdfmetrics.registerFont(TTFont("Mono", "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"))
from reportlab.pdfbase.pdfmetrics import registerFontFamily
registerFontFamily("Sans", normal="Sans", bold="Sans-Bold", italic="Sans", boldItalic="Sans-Bold")

MAROON = colors.HexColor("#894554")
MAROON_DARK = colors.HexColor("#6b3341")
MAROON_SOFT = colors.HexColor("#f4e8eb")
BG_SOFT = colors.HexColor("#fbf5f6")
BORDER = colors.HexColor("#e6d3d8")
TEXT = colors.HexColor("#241419")
DIM = colors.HexColor("#7c6469")
AMBER = colors.HexColor("#9a640b")
AMBER_SOFT = colors.HexColor("#fff6e6")
GREEN = colors.HexColor("#2f7d55")

PAGE_W, PAGE_H = letter
MARGIN = 0.7 * inch
CONTENT_W = PAGE_W - 2 * MARGIN
VERSION = "v2.0.4"


def S(name, **kw):
    base = dict(fontName="Sans", fontSize=10, leading=14.2, textColor=TEXT)
    base.update(kw)
    return ParagraphStyle(name, **base)


S_BODY = S("body")
S_STEP_TITLE = S("st", fontName="Sans-Bold", fontSize=12.5, leading=16, textColor=MAROON_DARK, spaceAfter=3)
S_NUM = S("num", fontName="Sans-Bold", fontSize=13, leading=16, textColor=colors.white, alignment=TA_CENTER)
S_INTRO_H = S("ih", fontName="Sans-Bold", fontSize=10.5, textColor=MAROON_DARK, spaceAfter=2)
S_SMALL = S("small", fontSize=8.8, leading=12, textColor=DIM)
S_TIP = S("tip", fontSize=9.3, leading=13)
S_SECTION = S("sec", fontName="Sans-Bold", fontSize=14, leading=18, textColor=MAROON_DARK, spaceBefore=6, spaceAfter=6)
S_CELL = S("cell", fontSize=8.9, leading=12)
S_CELL_B = S("cellb", fontName="Sans-Bold", fontSize=8.9, leading=12)


def p(text, style=S_BODY):
    return Paragraph(text, style)


def shot(name):
    return os.path.join(SHOTS, f"{name}.png")


def img(name, max_w, max_h=4.9 * inch):
    path = shot(name)
    w, h = PILImage.open(path).size
    scale = min(max_w / w, max_h / h)
    im = Image(path, width=w * scale, height=h * scale)
    t = Table([[im]], colWidths=[w * scale + 2])
    t.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.6, BORDER),
        ("LEFTPADDING", (0, 0), (-1, -1), 1), ("RIGHTPADDING", (0, 0), (-1, -1), 1),
        ("TOPPADDING", (0, 0), (-1, -1), 1), ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
    ]))
    return t


def aspect(name):
    w, h = PILImage.open(shot(name)).size
    return w / h


def is_wide(name):
    # Thin strips (bars, button rows) read best underneath the text;
    # everything else sits beside it.
    return aspect(name) > 1.7


def box(items, bg, border, pad=10):
    t = Table([[items]], colWidths=[CONTENT_W])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), bg),
        ("BOX", (0, 0), (-1, -1), 0.6, border),
        ("LEFTPADDING", (0, 0), (-1, -1), pad), ("RIGHTPADDING", (0, 0), (-1, -1), pad),
        ("TOPPADDING", (0, 0), (-1, -1), pad - 2), ("BOTTOMPADDING", (0, 0), (-1, -1), pad),
    ]))
    return t


def tip_box(text, label="Tip"):
    return box([p(f"<b>{label}:</b> {text}", S_TIP)], AMBER_SOFT, colors.HexColor("#e8cf9c"), pad=8)


class NumBadge(Flowable):
    def __init__(self, n, d=0.36 * inch):
        super().__init__()
        self.n, self.d = n, d
        self.width = self.height = d

    def draw(self):
        c = self.canv
        c.setFillColor(MAROON)
        c.circle(self.d / 2, self.d / 2, self.d / 2, stroke=0, fill=1)
        c.setFillColor(colors.white)
        c.setFont("Sans-Bold", 12.5)
        c.drawCentredString(self.d / 2, self.d / 2 - 4.5, str(self.n))


def step(n, title, body, image=None, tip=None):
    """One numbered step: text on the left, screenshot on the right
    (or underneath, for wide/short screenshots)."""
    text = [p(title, S_STEP_TITLE)]
    for para in (body if isinstance(body, list) else [body]):
        text.append(p(para))
        text.append(Spacer(1, 4))
    if tip:
        text.append(Spacer(1, 2))
        text.append(Table([[p(f"<b>Tip:</b> {tip}", S_TIP)]], colWidths=[None], style=TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), AMBER_SOFT), ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#e8cf9c")),
            ("LEFTPADDING", (0, 0), (-1, -1), 7), ("RIGHTPADDING", (0, 0), (-1, -1), 7),
            ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 6)])))

    badge_w = 0.5 * inch
    if image and not is_wide(image):
        img_w = 2.15 * inch if aspect(image) < 0.8 else 2.6 * inch
        text_w = CONTENT_W - badge_w - img_w - 0.2 * inch
        row = [[NumBadge(n), text, img(image, img_w, 4.1 * inch)]]
        widths = [badge_w, text_w + 0.2 * inch, img_w]
    else:
        text_w = CONTENT_W - badge_w
        cell = list(text)
        if image:
            cell += [Spacer(1, 6), img(image, min(text_w, 4.0 * inch), 2.6 * inch)]
        row = [[NumBadge(n), cell]]
        widths = [badge_w, text_w]
    t = Table(row, colWidths=widths)
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (1, 0), (1, 0), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    return KeepTogether([t, Spacer(1, 10), Divider(), Spacer(1, 12)])


class Divider(Flowable):
    def __init__(self):
        super().__init__()
        self.width, self.height = CONTENT_W, 1

    def draw(self):
        self.canv.setStrokeColor(BORDER)
        self.canv.setLineWidth(0.6)
        self.canv.line(0, 0, CONTENT_W, 0)


def ref_table(header, rows, widths):
    data = [[p(h, S_CELL_B) for h in header]] + [[p(c, S_CELL) for c in r] for r in rows]
    t = Table(data, colWidths=widths, repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), MAROON_SOFT),
        ("TEXTCOLOR", (0, 0), (-1, 0), MAROON_DARK),
        ("GRID", (0, 0), (-1, -1), 0.5, BORDER),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, BG_SOFT]),
        ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return t


def build(filename, title, subtitle, purpose, need, steps, extras=None):
    path = os.path.join(OUT, filename)
    doc = BaseDocTemplate(path, pagesize=letter, leftMargin=MARGIN, rightMargin=MARGIN,
                          topMargin=MARGIN, bottomMargin=0.75 * inch,
                          title=f"{title} — Oakridge Product Suite guide", author="Oakridge Product Suite")
    band_h = 1.55 * inch

    def first_page(c, d):
        c.saveState()
        c.setFillColor(MAROON)
        c.rect(0, PAGE_H - band_h, PAGE_W, band_h, stroke=0, fill=1)
        c.setFillColor(MAROON_DARK)
        c.rect(0, PAGE_H - band_h, PAGE_W, 4, stroke=0, fill=1)
        x = MARGIN
        if LOGO:
            c.drawImage(LOGO, MARGIN, PAGE_H - band_h + 0.35 * inch, 0.85 * inch, 0.85 * inch, mask="auto")
            x = MARGIN + 1.05 * inch
        c.setFillColor(colors.HexColor("#f3dfe5"))
        c.setFont("Sans-Bold", 8.5)
        c.drawString(x, PAGE_H - 0.5 * inch, f"OAKRIDGE PRODUCT SUITE · {VERSION} · STEP-BY-STEP GUIDE")
        c.setFillColor(colors.white)
        c.setFont("Sans-Bold", 24)
        c.drawString(x, PAGE_H - 0.92 * inch, title)
        c.setFont("Sans", 11)
        c.setFillColor(colors.HexColor("#f6e9ed"))
        c.drawString(x, PAGE_H - 1.2 * inch, subtitle)
        footer(c, d)
        c.restoreState()

    def footer(c, d):
        c.setFont("Sans", 7.8)
        c.setFillColor(DIM)
        c.drawString(MARGIN, 0.45 * inch, f"Oakridge Product Suite {VERSION} — {title} guide")
        c.drawRightString(PAGE_W - MARGIN, 0.45 * inch, f"Page {d.page}")

    def later(c, d):
        c.saveState()
        c.setFillColor(MAROON)
        c.rect(0, PAGE_H - 0.16 * inch, PAGE_W, 0.16 * inch, stroke=0, fill=1)
        footer(c, d)
        c.restoreState()

    frame_first = Frame(MARGIN, 0.75 * inch, CONTENT_W, PAGE_H - band_h - 0.25 * inch - 0.75 * inch, id="f1", leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    frame_later = Frame(MARGIN, 0.75 * inch, CONTENT_W, PAGE_H - MARGIN - 0.75 * inch, id="f2", leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    doc.addPageTemplates([PageTemplate("first", [frame_first], onPage=first_page, autoNextPageTemplate="later"),
                          PageTemplate("later", [frame_later], onPage=later)])

    flow = []
    intro = [p("What this page is for", S_INTRO_H), p(purpose)]
    if need:
        intro += [Spacer(1, 6), p("Before you start", S_INTRO_H), p(need)]
    flow.append(box(intro, BG_SOFT, BORDER, pad=11))
    flow.append(Spacer(1, 16))
    for i, s in enumerate(steps, 1):
        flow.append(step(i, **s))
    if extras:
        flow += extras
    doc.build(flow)
    return path


# ======================================================================
GUIDES = []

GUIDES.append(dict(
    filename="00-Getting-Started.pdf",
    title="Getting Started",
    subtitle="Signing in, the access key, getting around, settings and updates",
    purpose="How to open the app at the start of a shift, sign in, find your way around, and keep the app up to date. "
            "Every other guide assumes you've done the steps here.",
    need="The app link (ask a lead), and the store's <b>access key</b> the first time you use a new device.",
    steps=[
        dict(title="Install it on the store phone",
             body=["Open the app link in <b>Safari</b> (not Chrome). Tap the <b>Share</b> icon, then <b>Add to Home Screen</b> → <b>Add</b>.",
                   "From then on, always open it from the home-screen icon. It runs full-screen and keeps working when the Wi-Fi drops."],
             tip="The new app has its own icon, separate from the original one. Both can be installed while the store switches over."),
        dict(title="Enter the access key (first time only)",
             body=["The first time a device opens the app, the sign-in screen shows an <b>Access key</b> box. Paste the store's key into it.",
                   "The app checks the key with the Google Sheet before saving it. <b>“That key was rejected”</b> means it was mistyped, or the key has changed: check with a lead.",
                   "Once it's saved you'll see <b>“Access key saved on this device”</b>, or <b>“Using the access key from the original app”</b> if that browser already had it."],
             image="start-01-signin",
             tip="An iPhone home-screen icon keeps its own storage, separate from Safari, so you may need to enter the key once on the icon even if Safari already has it."),
        dict(title="Pick your initials and tap Continue",
             body=["Choose your initials from the list. Everything you do this shift is stamped with them, and the date is always added automatically.",
                   "Not on the list? Tap <b>+ Add new initials</b>, type them, and tap <b>Add</b>. They're added to the shared roster for every device."],
             image="start-02-signin-filled",
             tip="The app asks who's working every time it's opened, so a shared phone never keeps the last person's initials."),
        dict(title="Let it pull the latest from the sheet",
             body=["After sign-in the app pulls the catalog, counts, consolidations, receiving and floor lists from the Google Sheet. This can take up to about 10 seconds.",
                   "If it's slow (weak signal), a <b>Continue with what's saved on this device</b> button appears after a few seconds. Tap it to start working: the pull carries on in the background and the screen updates when it's done."],
             image="start-03-loading"),
        dict(title="Get around with the bottom bar",
             body=["Six pages: <b>Home</b>, <b>Catalog</b>, <b>Counts</b>, <b>Consol</b> (Consolidations), <b>Receiving</b> and <b>Floor</b> (Floor Stock). Each one has its own guide.",
                   "The red number on Home is how many things need someone's attention right now."],
             image="start-05-nav"),
        dict(title="The top bar",
             body=["<b>Initials</b>: see who's signed in, or switch user. "
                   "<b>↻ Refresh</b>: pull the newest data from the sheet (use it after a lead pastes a new list into the sheet). "
                   "<b>⚙ Settings</b>: access key, staff roster, feedback and version.",
                   "An <b>Offline</b> badge appears next to the title when the device has no connection."],
             image="start-04-header"),
        dict(title="Hand the phone to someone else",
             body=["Tap your <b>initials</b> in the top bar, pick the new person's initials and tap <b>Switch</b>. Nothing else changes. Anything already staged stays where it is."],
             image="start-08-change-user"),
        dict(title="Settings",
             body=["The <b>Google Sheet URL</b> and <b>Access key</b> rarely need touching. If the key is ever changed, paste the new one here and tap <b>Save &amp; sync</b>.",
                   "<b>Staff roster</b> shows everyone's initials, and you can add new ones here. The bottom line shows the app version and when it last synced."],
             image="start-06-settings"),
        dict(title="Leave feedback",
             body=["Something broken, confusing or missing? In Settings tap <b>Leave feedback</b>, type it and tap <b>Send</b>. It goes straight to the Feedback tab of the sheet, tagged as coming from the new app."],
             image="start-07-feedback"),
        dict(title="Install updates",
             body=["When a new version is published, a bar appears at the top: <b>“A new version is ready.”</b> Tap <b>Reload</b>. That's all."],
             image="start-09-update"),
    ],
    extras=[
        Paragraph("If something goes wrong", S_SECTION),
        ref_table(["You see", "What it means", "What to do"], [
            ["“Couldn't reach the sheet — showing what's saved on this device.”", "No connection, or Google was slow to answer.", "Keep working; things you stage are kept on the device. Tap ↻ once you're back on Wi-Fi."],
            ["“The sheet rejected this device's access key.”", "The key on this device is wrong or out of date.", "⚙ Settings → paste the current key → Save &amp; sync. Ask a lead for the key."],
            ["Stuck on the loading screen", "The sheet is slow to answer.", "Wait for <b>Continue with what's saved on this device</b> and tap it."],
            ["The app looks out of date", "An older version is still loaded.", "Close and reopen the app, then tap Reload on the update bar."],
        ], [1.9 * inch, 2.1 * inch, CONTENT_W - 4.0 * inch]),
    ],
))

GUIDES.append(dict(
    filename="01-Home.pdf",
    title="Home",
    subtitle="What needs attention right now, shortcuts, and this week's numbers",
    purpose="Home is the first screen after sign-in. It answers one question: <b>what needs someone's attention right now?</b> "
            "It watches every other page and lists anything that's stuck, unsaved or waiting on MAO, so nobody has to tap through every page to find out.",
    need="Signed in (see the Getting Started guide).",
    steps=[
        dict(title="Check how fresh the numbers are",
             body=["Under the greeting, <b>“Synced with the sheet”</b> shows when the app last pulled everything from the Google Sheet.",
                   "If it's old, or a lead has just pasted something new into the sheet, tap <b>↻</b> in the top bar."],
             image="home-01-overview"),
        dict(title="Use a shortcut",
             body=["<b>Scan to Count</b> opens Counts with the camera ready. "
                   "<b>Scan Packing Slip</b> opens Consolidations ready to close a box. "
                   "<b>Scan Boxes</b> opens Receiving in continuous box-scanning mode."],
             image="home-02-quick"),
        dict(title="Work through “Needs attention”",
             body=["Each card is one thing that needs doing, with a button that takes you straight to the right page.",
                   "<b>Red</b> means act now, <b>amber</b> means soon, and <b>grey</b> cards are just notes (e.g. something staged on this device but not sent yet). "
                   "A card disappears by itself once the problem is fixed. There's nothing to dismiss.",
                   "When there's nothing left you'll see <b>“All clear.”</b>"],
             image="home-03-exceptions"),
        dict(title="Glance at this week's numbers",
             body=["<b>Count accuracy</b>: the share of this week's counts that were within tolerance. "
                   "<b>Open consolidation lines</b>: items on HQ's list not yet processed. "
                   "<b>Boxes received</b>: boxes physically received this week. "
                   "<b>86 Board</b>: items currently out of stock.",
                   "Tap any tile to open that page. The week starts on Monday."],
             image="home-04-kpis"),
        dict(title="Watch the badge",
             body=["The red number on the <b>Home</b> button in the bottom bar is how many red and amber cards are waiting, so you can see it from any page. Grey notes aren't counted."],
             image="start-05-nav"),
    ],
    extras=[
        Paragraph("What can appear on Home, and how to clear it", S_SECTION),
        ref_table(["Card", "Why it appears", "How it clears"], [
            ["Box on the shelf but not received into MAO", "A box was marked Physically Received over a day ago, but not Received into MAO.", "Receive it in MAO, then mark it <b>Received into MAO</b> on the Receiving page."],
            ["Count outside tolerance", "The latest count of a product (last 14 days) was off by more than 2 units or 5%, whichever is larger.", "Recount it on Counts. A recount within tolerance clears it."],
            ["Counts not saved to the sheet", "Counts logged on this device haven't been sent yet.", "Counts → <b>Save to Sheet</b>."],
            ["Consolidation items waiting in Holding", "Items were marked Actioned but Update wasn't tapped. Turns amber after a day.", "Consolidations → <b>Update Sheet</b>."],
            ["Consolidation adjustment unresolved", "An old “Needs Adjustment” entry from the original app.", "Consolidations → Activity → <b>Resolve</b>."],
            ["Floor item Needed for 3+ days", "A size has sat on the Replen list for 3 or more days.", "Floor Stock → Replen → <b>Picked</b> or <b>Out of stock</b>."],
            ["Staged in Receiving / Check Floor / Replen", "Decisions held on this device only.", "Tap the update button on that page."],
            ["The sheet rejected this device's access key", "The key is wrong or has changed.", "⚙ Settings → paste the current key."],
            ["Data may be out of date", "No full sync in the last 24 hours.", "Tap ↻ when connected."],
        ], [1.75 * inch, 2.45 * inch, CONTENT_W - 4.2 * inch]),
    ],
))

GUIDES.append(dict(
    filename="02-Product-Catalog.pdf",
    title="Product Catalog",
    subtitle="Look up products, set hard-tag placement, and add new products from MAO",
    purpose="One place for everything about a product: its details, where its <b>hard tag</b> goes, and how it's been counted recently. "
            "It replaces the original app's Tag Lookup and Product Master tabs. New products are added here by pasting from MAO.",
    need="Signed in. To set a tag or import products you need a connection.",
    steps=[
        dict(title="Open the Catalog",
             body=["Tap <b>Catalog</b> in the bottom bar. The line under the title shows how many products and styles are in the shared catalog."],
             image="cat-01-empty"),
        dict(title="Search or scan for a product",
             body=["Type any part of a <b>SKU, UPC, style number or name</b>. Results update as you type.",
                   "Or tap the <b>camera</b> button and scan the barcode. An exact barcode match opens that product straight away. Tap <b>✕</b> to clear."],
             image="cat-02-results",
             tip="Nothing found? The product isn't in the catalog yet. Add it with “Import from MAO” (step 6)."),
        dict(title="Open a product's details",
             body=["Tap <b>Details</b> on a result to see its style, color, size, dept, the expected count last used on this device, its <b>hard-tag placement</b>, and its most recent counts.",
                   "<b>Count this product</b> takes you to Counts with this product already loaded. Tap <b>‹ Back to results</b> to return."],
             image="cat-03-detail"),
        dict(title="Set or change the hard-tag placement",
             body=["In the <b>Hard-tag placement</b> box, choose a location from the list (Hood, Below Wash Tag, Through Wash Tag, Tag Side Pocket, Left Leg In-seam, Chest Pocket, or <b>No Hard Tag</b>) and tap <b>Save</b>.",
                   "A tag location belongs to the whole <b>style</b>, so it's applied to every color and size of that style at once. The line under the box says how many variants that covers."],
             image="cat-04-tag",
             tip="Use “No Hard Tag” for a style that genuinely doesn't get one, so nobody wonders whether it was just never set."),
        dict(title="Paste new products from MAO",
             body=["Open <b>Import from MAO</b>. In MAO's <b>View Inventory</b> page, select and copy the product blocks, then paste them into the box.",
                   "Tap <b>Import / Update</b>. Products are matched by SKU: new ones are added, existing ones are refreshed. Expected counts are never overwritten."],
             image="cat-05-import"),
        dict(title="Check they reached the sheet",
             body=["The message under the buttons confirms how many were added and that they were <b>shared</b> with the sheet, so every device now has them.",
                   "If it says only some were shared, check your connection and import the same paste again. Re-importing is safe."],
             image="cat-06-imported",
             tip="Export CSV downloads the whole catalog as a spreadsheet file."),
        dict(title="Review every tag assignment",
             body=["Open <b>Hard-tag assignments</b> to see every style that has a tag location set. Tap one to open that product and change it."],
             image="cat-07-tags"),
    ],
))

GUIDES.append(dict(
    filename="03-Counts.pdf",
    title="Counts",
    subtitle="Scan, count, and save inventory counts to the shared log",
    purpose="Cycle counting. Scan or find a product, confirm the expected quantity, enter what's actually there, and the difference is logged. "
            "Counts that are off by too much are flagged so they get a second look instead of disappearing into a list.",
    need="Signed in. Counting works offline, and you send the counts to the sheet when you're connected.",
    steps=[
        dict(title="Start a count",
             body=["Tap <b>Scan Product to Count</b> and scan the product's barcode. If you can't scan, type in the search box underneath (step 2)."],
             image="cnt-01-top"),
        dict(title="Or search for it",
             body=["Type any part of the SKU, UPC, style or name and tap <b>Count</b> on the right result."],
             image="cnt-02-search"),
        dict(title="Enter expected and actual",
             body=["The card shows the product and when it was last counted, and by whom.",
                   "<b>Expected</b> is pre-filled with the last expected count used on this device. Confirm or correct it. Type what you actually counted into <b>Actual</b>, then tap <b>Log Count</b> (or press Enter)."],
             image="cnt-03-active"),
        dict(title="Read the result",
             body=["The message tells you whether the count <b>matched</b>, or was <b>over</b> or <b>under</b> and by how much.",
                   "If it's off by more than <b>2 units or 5%</b> (whichever is larger), it's flagged as <b>outside tolerance</b>. It shows in red here and as a card on Home until it's recounted."],
             image="cnt-04-logged"),
        dict(title="Scanned something that isn't in the catalog?",
             body=["A <b>Not in the catalog yet</b> form opens with the barcode filled in. Enter at least the <b>SKU</b> and <b>Description</b> (style, dept, color and size if you have them) and tap <b>Add Product</b>.",
                   "It's added to the shared catalog and loaded straight into the count."],
             image="cnt-05-add"),
        dict(title="Save to Sheet",
             body=["Counts are kept <b>on this device</b> until you tap <b>Save to Sheet</b>. The button shows how many are waiting, and unsent counts carry a <b>not saved</b> tag.",
                   "Saving sends every unsent count in one go. If the connection fails, nothing is lost: they stay queued, so just tap Save again later."],
             image="cnt-06-list",
             tip="Save before you hand the device to someone else and at the end of your shift. Home reminds you if anything is left unsaved."),
        dict(title="Recount anything outside tolerance",
             body=["Tap the <b>Outside tolerance</b> filter to see only flagged counts, then tap <b>Recount</b> to load that product again.",
                   "The flag clears once the newest count of that product is within tolerance. <b>Not saved</b> shows only unsent counts, and <b>All</b> shows everything. <b>CSV</b> downloads the full log."],
             image="cnt-07-flagged"),
    ],
))

GUIDES.append(dict(
    filename="04-Consolidations.pdf",
    title="Consolidations",
    subtitle="Pull HQ's consolidation list, track counts, and log closed boxes",
    purpose="Working through HQ's consolidation list: tracking how many of each item you've pulled, marking lines done, and recording who closed each box and when.",
    need="A lead pastes HQ's list into the <b>ConsolMaster</b> tab of the Google Sheet. Tap <b>↻</b> in the top bar to load a new list. "
         "The full process is in the <b>Consolidations Guide</b> linked at the top of the page.",
    steps=[
        dict(title="Find the items to consolidate",
             body=["Each line is one item on HQ's list: name, color, style and destination, with your <b>pulled count</b> against the <b>total</b> HQ wants.",
                   "Use the filter box above the list to narrow it by name, style, color or destination."],
             image="con-04-items"),
        dict(title="Track what you've pulled",
             body=["Tap <b>+</b> / <b>−</b> as you pull pieces, or type the number. Each change saves to the sheet <b>immediately</b>, so everyone sees the same running count.",
                   "The line turns green once you've reached the total."],
             image="con-05-stepper"),
        dict(title="Mark a line Actioned",
             body=["When a line is done, tap <b>Actioned</b>. It moves out of the list into <b>Holding</b>, where it waits until you tap <b>Update Sheet</b>.",
                   "Changed your mind? Tap <b>Remove</b> in Holding to put it back."],
             image="con-06-holding"),
        dict(title="Update the sheet",
             body=["Tap <b>Update Sheet</b> to send everything in Holding at once. Each line is marked <b>Processed</b> on HQ's list and logged in Activity with your initials.",
                   "If it can't reach the sheet, the items stay in Holding. Try again when you're connected."],
             image="con-07-log",
             tip="Lines left in Holding show up on Home, and turn amber after a day, so nothing gets forgotten."),
        dict(title="Close a box",
             body=["When a box is sealed, tap <b>Scan Packing Slip</b> and scan the slip's barcode. If it won't scan, type the reference number and tap <b>Close Box</b>.",
                   "This only records the reference number, who closed it and when. The box's contents are looked up in MAO by that number."],
             image="con-01-close"),
        dict(title="Confirm it's closed in MAO",
             body=["A reminder appears every time: <b>this app can't see MAO</b>. Close the box in MAO first, then tap <b>It's closed in MAO, log it</b>."],
             image="con-02-mao"),
        dict(title="Check it was logged",
             body=["A green message confirms the box was closed and logged. It also appears at the top of <b>Activity</b>. <b>CSV</b> downloads the full consolidation log."],
             image="con-03-closed"),
    ],
))

GUIDES.append(dict(
    filename="05-Receiving.pdf",
    title="Receiving",
    subtitle="Import shipments, scan boxes in, and make sure MAO gets updated",
    purpose="Logging incoming boxes in two separate steps: <b>Physically Received</b> (it's on our shelf) and <b>Received into MAO</b> (MAO knows about it). "
            "Each step is stamped with who did it and when. Boxes that are on the shelf but not yet in MAO stay visible until they are.",
    need="The expected-shipment list from MAO's <b>Receive Inventory</b> page (step 1).",
    steps=[
        dict(title="Import the expected shipments",
             body=["Open <b>Import from MAO</b> at the bottom of the page. In MAO's <b>Receive Inventory</b> page, copy the shipment list (the ETA / Package / PO # blocks) and paste it in.",
                   "Tap <b>Import</b>. The boxes appear under <b>Expected boxes</b> and are shared with every device. Re-importing the same list is safe."],
             image="rec-02-import"),
        dict(title="Scan boxes as they come in",
             body=["Tap <b>Scan Boxes</b>. The camera stays open, so scan each box's package barcode one after another. Each one goes into <b>Holding</b> and the count updates on screen.",
                   "Tap <b>Done Scanning</b> when you're finished."],
             image="rec-03-scanner"),
        dict(title="A box that isn't on the list",
             body=["If a scanned box wasn't in the import, the camera stops and asks for its <b>PO #</b>. Enter it and tap <b>Add &amp; hold</b>. The box is added to the shared list and held, ready to mark."],
             image="rec-07-notexpected"),
        dict(title="Mark them Physically Received",
             body=["With the boxes in <b>Holding</b>, tap <b>Physically Received</b>. They're stamped with today's date and your initials.",
                   "Tap <b>Remove</b> to take a box back out of Holding before marking."],
             image="rec-04-holding"),
        dict(title="Watch “Waiting on MAO”",
             body=["Boxes that are on the shelf but <b>not yet received into MAO</b> are listed here, each showing how long it has been waiting.",
                   "After a day, a box also shows up as a red card on Home. This is the step that's easy to forget, and it's what this list is for."],
             image="rec-05-awaiting"),
        dict(title="Receive them into MAO",
             body=["Receive the boxes in MAO first. Then tap <b>Hold all</b> on Waiting on MAO (or scan just the boxes you did) and tap <b>Received into MAO</b>.",
                   "Those boxes are finished: they drop off every list, and the Home card clears."],
             image="rec-06-held-mao"),
        dict(title="No camera? Tick boxes instead",
             body=["Under <b>Expected boxes</b>, tick the boxes and tap <b>Hold selected</b>. Then mark them as in steps 4 and 6. Use the filter to find a PO # or package number quickly.",
                   "<b>Export CSV</b> (inside Import from MAO) downloads the full receiving log."],
             image="rec-08-expected"),
    ],
))

GUIDES.append(dict(
    filename="06-Floor-Stock.pdf",
    title="Floor Stock",
    subtitle="Check the floor after sales, pick replen, and run the 86 Board",
    purpose="Keeping the floor stocked after things sell, in three tabs that follow one item from start to finish: "
            "<b>Check Floor</b> (what sold, and is it needed?) → <b>Replen</b> (pick it from the back) → <b>86 Board</b> (we're out, and that's been noted).",
    need="A lead pastes MAO's <b>Items Sold</b> export (columns A–H) into the <b>FloorRestock</b> tab of the sheet. Tap <b>↻</b> to load it. "
         "Accessories (gender “U”) are left out automatically, since they're restocked from the floor.",
    steps=[
        dict(title="Open Check Floor",
             body=["Tap <b>Floor</b> in the bottom bar, then the <b>Check Floor</b> tab. The numbers on the tabs show how much is waiting in each.",
                   "The line under the title shows when the floor was last checked, and by whom."],
             image="flr-01-check"),
        dict(title="One line per style and color",
             body=["Sold items are grouped into <b>one line per style + color</b>, whatever size sold. For example, Black Atom Hoodies sold in S, M and L show as one <b>Atom Hoody Men's · Black · 4 sold</b> line.",
                   "Go to that style on the floor and see for yourself which sizes are missing."],
             image="flr-02-lines"),
        dict(title="Needed? Pick the sizes",
             body=["If the floor needs restocking, tap <b>Needed</b> and pick the sizes that are missing, or <b>Other (any size)</b> if any size will do. Then tap <b>Stage as Needed</b>.",
                   "If the floor is fine, tap <b>Not needed</b>."],
             image="flr-03-sizes",
             tip="Only the sizes you pick go to Replen. The sizes that sold don't matter. What matters is what you saw missing."),
        dict(title="Update the sheet",
             body=["Your decisions wait in <b>Holding</b> (tap <b>Remove</b> to undo one). Tap <b>Update Sheet</b> to send them all.",
                   "The sizes you picked appear on the <b>Replen</b> tab for whoever is picking in the back."],
             image="flr-04-holding"),
        dict(title="Something needs restocking but isn't on the list",
             body=["Type it into <b>“Something not on the list?”</b> at the top. If it's in the catalog, tap <b>Add</b> on the result and it joins the Check Floor list.",
                   "Not in the catalog at all? Tap <b>Not in the catalog? Add “…” by hand</b>, pick the sizes and tap <b>Add as Needed</b>. It's staged as Needed, ready for Update."],
             image="flr-06-manual"),
        dict(title="Pick on the Replen tab",
             body=["Replen lists each style and color once, with the <b>needed sizes</b> underneath. For each size, tap <b>Picked</b> once it's on the floor, or <b>Out of stock</b> if there's none in the back.",
                   "An amber <b>needed … days</b> note means it has been waiting 3 or more days. It's also flagged on Home."],
             image="flr-07-replen"),
        dict(title="Update Replen",
             body=["Picks wait in Holding until you tap <b>Update Sheet</b>. Anything marked <b>Out of stock</b> goes onto the <b>86 Board</b>."],
             image="flr-08-replen-holding"),
        dict(title="Run the 86 Board",
             body=["The 86 Board lists everything that's out, newest first, so the floor team can see it without calling the back.",
                   "When stock comes back, tap <b>Restocked</b>. It saves straight away and the item drops off the board."],
             image="flr-09-86"),
    ],
    extras=[
        Paragraph("Reading the progress bar", S_SECTION),
        p("Lines on Replen and the 86 Board carry a small three-step bar: <b>Needed → Picked / Out of stock → Restocked</b>. "
          "A red middle segment means the item went out of stock. A green label means it's finished."),
    ],
))

if __name__ == "__main__":
    for g in GUIDES:
        print("Wrote", build(**g))
