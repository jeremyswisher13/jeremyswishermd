"""Build the one-page referral handoff; requires reportlab and pypdf."""
from pathlib import Path
from shutil import copyfile

from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Table, TableStyle
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "output/pdf/jeremy-swisher-referral-guide.pdf"
PUBLIC = ROOT / "resources/jeremy-swisher-referral-guide.pdf"
INK = colors.HexColor("#183E43")
TEAL = colors.HexColor("#17615C")
MUTED = colors.HexColor("#475A5D")
PALE = colors.HexColor("#EFF5F4")

styles = {
    "kicker": ParagraphStyle("kicker", fontName="Helvetica-Bold", fontSize=9, leading=12, textColor=TEAL, spaceAfter=9),
    "title": ParagraphStyle("title", fontName="Helvetica-Bold", fontSize=25, leading=29, textColor=INK, spaceAfter=5),
    "subtitle": ParagraphStyle("subtitle", fontName="Helvetica", fontSize=12, leading=16, textColor=MUTED, spaceAfter=15),
    "heading": ParagraphStyle("heading", fontName="Helvetica-Bold", fontSize=12, leading=15, textColor=TEAL, spaceBefore=13, spaceAfter=6),
    "body": ParagraphStyle("body", fontName="Helvetica", fontSize=10.5, leading=14.5, textColor=INK, spaceAfter=6),
    "phone": ParagraphStyle("phone", fontName="Helvetica-Bold", fontSize=18, leading=23, textColor=INK, spaceAfter=4),
    "small": ParagraphStyle("small", fontName="Helvetica", fontSize=8.5, leading=11.5, textColor=MUTED, spaceAfter=4),
}

def p(text, style="body"):
    return Paragraph(text, styles[style])

def link(url, label):
    return f'<link href="{url}" color="#17615C"><u>{label}</u></link>'

story = [
    p("REFERRAL GUIDE  /  WESTWOOD + WEST HILLS", "kicker"),
    p("Jeremy Swisher, MD", "title"),
    p("Nonsurgical Sports Medicine | UCLA Health", "subtitle"),
]
contact = Table([[ [
    p("REQUESTED PHYSICIAN: JEREMY SWISHER, MD, SPORTS MEDICINE", "kicker"),
    p("Appointments &amp; routing: 310-319-1234", "phone"),
    p("UCLA's general physician referral fax: <b>310-301-5391</b>"),
    p("Name Dr. Swisher on the referral and note Westwood or West Hills as the preferred location.", "body"),
] ]], colWidths=[532])
contact.setStyle(TableStyle([("BACKGROUND", (0,0), (-1,-1), PALE), ("LEFTPADDING", (0,0), (-1,-1), 14), ("RIGHTPADDING", (0,0), (-1,-1), 14), ("TOPPADDING", (0,0), (-1,-1), 12), ("BOTTOMPADDING", (0,0), (-1,-1), 9)]))
story += [contact, p("When to refer", "heading"),
    p("Diagnostic clarification; persistent joint or tendon symptoms; sports or overuse injuries; nonsurgical treatment planning; ultrasound evaluation; or return-to-activity guidance. A specific procedure does not need to be selected before referral."),
    p("Helpful information to send through UCLA's approved channels", "heading"),
    p("<b>Clinical question:</b> symptom history, relevant examination findings, treatment notes, and the patient's activity goals."),
    p("<b>Prior care:</b> imaging reports and access to actual images, rehabilitation notes, operative or procedure reports, and response to treatment, when available."),
    p("<b>Coordination:</b> patient contact details and any required referral or insurance authorization. Do not send patient records through this independent website."),
    p("Two UCLA clinic locations", "heading"),
]
clinics = Table([[
    p("<b>Westwood</b><br/>Orthopedics &amp; Sports Medicine<br/>100 UCLA Medical Plaza, Suite 170<br/>Los Angeles, CA 90095"),
    p("<b>West Hills</b><br/>West Hills Orthopedic Surgery<br/>7230 Medical Center Drive, Suite 604<br/>West Hills, CA 91307"),
]], colWidths=[266,266])
clinics.setStyle(TableStyle([("VALIGN",(0,0),(-1,-1),"TOP"), ("LEFTPADDING",(0,0),(-1,-1),0), ("RIGHTPADDING",(0,0),(-1,-1),14), ("TOPPADDING",(0,0),(-1,-1),0), ("BOTTOMPADDING",(0,0),(-1,-1),0)]))
story += [clinics,
    p("Patient handoff", "heading"),
    p('"Call UCLA Orthopedics at <b>310-319-1234</b> and ask for a sports medicine appointment with <b>Jeremy Swisher, MD</b> in Westwood or West Hills." Confirm the office and suite in the appointment confirmation.'),
    p("Verify the exact plan, network, referral requirements, and visit costs with UCLA and the health plan. Consultation coverage does not establish procedure coverage. A procedure may need a separate visit, authorization, or self-pay estimate."),
    p("Routine referrals only. Do not wait for routine scheduling for an urgent problem. For a medical emergency, call 911.", "small"),
    p("Official UCLA sources: " + link("https://www.uclahealth.org/providers/jeremy-swisher", "physician &amp; locations") + " | " + link("https://www.uclahealth.org/discover/healthcare-professionals", "referral instructions") + " | " + link("https://www.uclahealth.org/patient-resources/billing-insurance/health-insurance-accepted", "insurance"), "small"),
    p("Patient resources: " + link("https://jeremyswishermd.com/locations/#referrals", "jeremyswishermd.com/locations/#referrals") + "<br/>Exercise library: " + link("https://jeremyswishermd.com/home-exercise-programs/", "jeremyswishermd.com/home-exercise-programs/"), "small"),
]

def footer(canvas, doc):
    canvas.setTitle("Jeremy Swisher, MD - Sports Medicine Referral Guide")
    canvas.setAuthor("Jeremy Swisher, MD")
    canvas.setSubject("Named-physician referral and scheduling guide for Westwood and West Hills")
    canvas.setStrokeColor(colors.HexColor("#CDDCD9"))
    canvas.line(40, 52, 572, 52)
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 8)
    canvas.drawString(40, 40, "Independent professional website guide; not an official UCLA form. UCLA manages clinical care.")
    canvas.drawString(40, 28, "Contact and location information checked September 4, 2026. Verify current details with UCLA.")

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
SimpleDocTemplate(str(OUTPUT), pagesize=(612,792), rightMargin=40, leftMargin=40,
                  topMargin=32, bottomMargin=67).build(story, onFirstPage=footer, onLaterPages=footer)
reader = PdfReader(OUTPUT)
assert len(reader.pages) == 1, "Referral guide must remain one page"
text = reader.pages[0].extract_text()
for value in ["Jeremy Swisher, MD", "310-319-1234", "310-301-5391", "Suite 170", "Suite 604", "Westwood", "West Hills"]:
    assert value in text, f"Missing PDF content: {value}"
PUBLIC.parent.mkdir(parents=True, exist_ok=True)
copyfile(OUTPUT, PUBLIC)
print(f"Built and checked one-page referral guide: {PUBLIC}")
