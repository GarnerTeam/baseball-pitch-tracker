from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, KeepTogether
)
from reportlab.lib.enums import TA_LEFT, TA_CENTER

# ── Colors ─────────────────────────────────────────────────────────────────────
NAVY   = colors.HexColor('#0f172a')
BLUE   = colors.HexColor('#1d4ed8')
AMBER  = colors.HexColor('#d97706')
GREEN  = colors.HexColor('#15803d')
SLATE  = colors.HexColor('#475569')
LIGHT  = colors.HexColor('#f1f5f9')
WHITE  = colors.white
RED    = colors.HexColor('#dc2626')

# ── Styles ─────────────────────────────────────────────────────────────────────
styles = getSampleStyleSheet()

title_style = ParagraphStyle('AppTitle',
    fontSize=28, fontName='Helvetica-Bold',
    textColor=WHITE, alignment=TA_CENTER, spaceAfter=4)

subtitle_style = ParagraphStyle('Subtitle',
    fontSize=13, fontName='Helvetica',
    textColor=colors.HexColor('#94a3b8'), alignment=TA_CENTER, spaceAfter=0)

h1 = ParagraphStyle('H1',
    fontSize=15, fontName='Helvetica-Bold',
    textColor=NAVY, spaceBefore=18, spaceAfter=6)

h2 = ParagraphStyle('H2',
    fontSize=12, fontName='Helvetica-Bold',
    textColor=BLUE, spaceBefore=10, spaceAfter=4)

body = ParagraphStyle('Body',
    fontSize=10, fontName='Helvetica',
    textColor=colors.HexColor('#1e293b'),
    leading=16, spaceAfter=6)

code_style = ParagraphStyle('Code',
    fontSize=9, fontName='Courier',
    textColor=colors.HexColor('#1e293b'),
    backColor=colors.HexColor('#f8fafc'),
    borderPadding=(6, 8, 6, 8),
    leading=14, spaceAfter=8)

step_num = ParagraphStyle('StepNum',
    fontSize=20, fontName='Helvetica-Bold',
    textColor=WHITE, alignment=TA_CENTER)

step_label = ParagraphStyle('StepLabel',
    fontSize=12, fontName='Helvetica-Bold',
    textColor=NAVY, spaceBefore=0, spaceAfter=2)

note_style = ParagraphStyle('Note',
    fontSize=9.5, fontName='Helvetica',
    textColor=colors.HexColor('#92400e'),
    leading=15)

tip_style = ParagraphStyle('Tip',
    fontSize=9.5, fontName='Helvetica',
    textColor=colors.HexColor('#065f46'),
    leading=15)

# ── Helper flowables ───────────────────────────────────────────────────────────
def rule(color=colors.HexColor('#e2e8f0'), thickness=1):
    return HRFlowable(width='100%', thickness=thickness, color=color, spaceAfter=10, spaceBefore=4)

def note_box(text, kind='note'):
    bg   = colors.HexColor('#fffbeb') if kind == 'note' else colors.HexColor('#f0fdf4')
    bdr  = AMBER if kind == 'note' else GREEN
    icon = '⚠' if kind == 'note' else '✓'
    st   = note_style if kind == 'note' else tip_style
    data = [[Paragraph(f'{icon}  {text}', st)]]
    t = Table(data, colWidths=[6.5*inch])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), bg),
        ('BOX',        (0,0), (-1,-1), 1.5, bdr),
        ('LEFTPADDING',(0,0), (-1,-1), 10),
        ('RIGHTPADDING',(0,0),(-1,-1), 10),
        ('TOPPADDING', (0,0), (-1,-1), 8),
        ('BOTTOMPADDING',(0,0),(-1,-1), 8),
    ]))
    return t

def step_block(number, title, body_paragraphs):
    """Returns a KeepTogether block with step circle + content."""
    circle_data = [[Paragraph(str(number), step_num)]]
    circle = Table(circle_data, colWidths=[0.45*inch], rowHeights=[0.45*inch])
    circle.setStyle(TableStyle([
        ('BACKGROUND',    (0,0),(-1,-1), BLUE),
        ('ROUNDEDCORNERS',[4,4,4,4]),
        ('VALIGN',        (0,0),(-1,-1), 'MIDDLE'),
    ]))
    header = Table([[circle, Paragraph(title, step_label)]],
                   colWidths=[0.6*inch, 5.9*inch])
    header.setStyle(TableStyle([
        ('VALIGN',       (0,0),(-1,-1), 'MIDDLE'),
        ('LEFTPADDING',  (0,0),(0,-1),  0),
        ('LEFTPADDING',  (1,0),(1,-1),  8),
        ('BOTTOMPADDING',(0,0),(-1,-1), 4),
    ]))
    items = [header] + body_paragraphs
    return KeepTogether(items)

# ── Document ───────────────────────────────────────────────────────────────────
doc = SimpleDocTemplate(
    '/home/user/magica/OnTheBump_Setup_Guide.pdf',
    pagesize=letter,
    leftMargin=0.75*inch, rightMargin=0.75*inch,
    topMargin=0.75*inch,  bottomMargin=0.75*inch,
)

story = []

# ── Cover banner ──────────────────────────────────────────────────────────────
banner_data = [[
    Paragraph('On the Bump', title_style),
], [
    Paragraph('Google Sheets Data Backup — Setup Guide', subtitle_style),
]]
banner = Table(banner_data, colWidths=[7*inch])
banner.setStyle(TableStyle([
    ('BACKGROUND',    (0,0),(-1,-1), NAVY),
    ('TOPPADDING',    (0,0),(-1,-1), 20),
    ('BOTTOMPADDING', (0,0),(-1,-1), 20),
    ('ROUNDEDCORNERS',[6,6,6,6]),
]))
story.append(banner)
story.append(Spacer(1, 16))

# ── Why set this up ────────────────────────────────────────────────────────────
story.append(Paragraph('Why Set This Up?', h1))
story.append(rule())
story.append(Paragraph(
    'On the Bump stores all pitch data locally on your phone. That means if your browser '
    'refreshes, you switch devices, or your phone restarts mid-game, <b>you could lose '
    'everything</b>. Connecting Google Sheets gives you a live, permanent backup — every '
    'pitch is saved to the cloud the moment you record it.',
    body))
story.append(Spacer(1, 4))
story.append(note_box(
    'Complete this setup before your first game. It only takes about 5 minutes and '
    'you only do it once per team/season.', 'note'))
story.append(Spacer(1, 8))

# ── What you need ──────────────────────────────────────────────────────────────
story.append(Paragraph('What You Need', h1))
story.append(rule())
req_data = [
    ['✓', 'A Google account (Gmail)'],
    ['✓', 'Google Sheets (free, browser or phone)'],
    ['✓', 'About 5 minutes'],
]
req_table = Table(req_data, colWidths=[0.3*inch, 6.2*inch])
req_table.setStyle(TableStyle([
    ('FONTNAME',      (0,0),(-1,-1), 'Helvetica'),
    ('FONTSIZE',      (0,0),(-1,-1), 10),
    ('TEXTCOLOR',     (0,0),(0,-1),  GREEN),
    ('FONTNAME',      (0,0),(0,-1),  'Helvetica-Bold'),
    ('FONTSIZE',      (0,0),(0,-1),  13),
    ('VALIGN',        (0,0),(-1,-1), 'MIDDLE'),
    ('BOTTOMPADDING', (0,0),(-1,-1), 5),
    ('TOPPADDING',    (0,0),(-1,-1), 5),
]))
story.append(req_table)
story.append(Spacer(1, 12))

# ── Step 1 ─────────────────────────────────────────────────────────────────────
story.append(step_block(1, 'Create a New Google Spreadsheet', [
    Paragraph('Go to <b>sheets.google.com</b> and click the large <b>+</b> button to create a blank spreadsheet.', body),
    Paragraph('Name it something you will recognize, for example:', body),
    Paragraph('  <i>On the Bump — Garner 15u 2026</i>', code_style),
    note_box('One spreadsheet per pitcher / team per season works best. You can run the same pitcher against every opponent all season in one sheet.', 'tip'),
]))
story.append(Spacer(1, 10))

# ── Step 2 ─────────────────────────────────────────────────────────────────────
story.append(step_block(2, 'Open the Apps Script Editor', [
    Paragraph('Inside your new spreadsheet, click the menu:', body),
    Paragraph('  Extensions  →  Apps Script', code_style),
    Paragraph('A new browser tab opens with the script editor. You will see a default empty function — delete it completely.', body),
]))
story.append(Spacer(1, 10))

# ── Step 3 ─────────────────────────────────────────────────────────────────────
story.append(step_block(3, 'Paste the Webhook Code', [
    Paragraph('Copy the entire contents of the file <b>apps-script.js</b> (provided alongside this PDF) and paste it into the script editor.', body),
    Paragraph('Then click the <b>floppy disk icon</b> (or press Ctrl+S / Cmd+S) to save. Name the project anything you like — <i>OnTheBump</i> works fine.', body),
    note_box('The script is read-only from your end — you never need to edit it. Just paste and save.', 'tip'),
]))
story.append(Spacer(1, 10))

# ── Step 4 ─────────────────────────────────────────────────────────────────────
story.append(step_block(4, 'Deploy as a Web App', [
    Paragraph('In the Apps Script editor, click:', body),
    Paragraph('  Deploy  →  New deployment', code_style),
    Paragraph('Fill in the deployment settings exactly as shown below:', body),
]))

deploy_data = [
    ['Setting',       'Value'],
    ['Type',          'Web App'],
    ['Description',   'On the Bump webhook  (or anything you like)'],
    ['Execute as',    'Me  (your Google account)'],
    ['Who has access','Anyone'],
]
deploy_table = Table(deploy_data, colWidths=[2*inch, 4.5*inch])
deploy_table.setStyle(TableStyle([
    ('BACKGROUND',    (0,0),(-1,0),  NAVY),
    ('TEXTCOLOR',     (0,0),(-1,0),  WHITE),
    ('FONTNAME',      (0,0),(-1,0),  'Helvetica-Bold'),
    ('FONTNAME',      (0,1),(-1,-1), 'Helvetica'),
    ('FONTSIZE',      (0,0),(-1,-1), 10),
    ('BACKGROUND',    (0,1),(-1,-1), LIGHT),
    ('ROWBACKGROUNDS',(0,1),(-1,-1), [WHITE, LIGHT]),
    ('BOX',           (0,0),(-1,-1), 1, colors.HexColor('#cbd5e1')),
    ('INNERGRID',     (0,0),(-1,-1), 0.5, colors.HexColor('#cbd5e1')),
    ('TOPPADDING',    (0,0),(-1,-1), 6),
    ('BOTTOMPADDING', (0,0),(-1,-1), 6),
    ('LEFTPADDING',   (0,0),(-1,-1), 8),
]))
story.append(deploy_table)
story.append(Spacer(1, 8))
story.append(note_box(
    '"Who has access: Anyone" does NOT make your spreadsheet public. It only allows '
    'the webhook URL to receive data — your sheet remains private in your Google account.', 'note'))
story.append(Spacer(1, 6))
story.append(Paragraph(
    'Click <b>Deploy</b>. Google may ask you to authorize the script — click '
    '<b>Authorize access</b>, choose your Google account, and click <b>Allow</b>. '
    'This is normal and safe.', body))
story.append(Spacer(1, 10))

# ── Step 5 ─────────────────────────────────────────────────────────────────────
story.append(step_block(5, 'Copy Your Web App URL', [
    Paragraph('After deploying, Google shows a <b>Web App URL</b>. It looks like this:', body),
    Paragraph('  https://script.google.com/macros/s/AKfycb.../exec', code_style),
    Paragraph('<b>Copy this URL</b> — you will paste it into the On the Bump app in the next step.', body),
    note_box('Save this URL somewhere safe (notes app, email to yourself). If you lose it you can always find it again: Deploy → Manage deployments.', 'tip'),
]))
story.append(Spacer(1, 10))

# ── Step 6 ─────────────────────────────────────────────────────────────────────
story.append(step_block(6, 'Connect the App', [
    Paragraph('Open <b>On the Bump</b> in your browser and go to the startup screen.', body),
    Paragraph('In the <b>Data Backup</b> card at the top:', body),
]))

connect_steps = [
    ['1.', 'Tap the URL input field'],
    ['2.', 'Paste your Web App URL'],
    ['3.', 'Tap Connect'],
    ['4.', 'The card turns green with a checkmark — you are connected'],
]
connect_table = Table(connect_steps, colWidths=[0.35*inch, 6.1*inch])
connect_table.setStyle(TableStyle([
    ('FONTNAME',      (0,0),(0,-1),  'Helvetica-Bold'),
    ('FONTNAME',      (1,0),(1,-1),  'Helvetica'),
    ('FONTSIZE',      (0,0),(-1,-1), 10),
    ('TEXTCOLOR',     (0,0),(0,-1),  BLUE),
    ('VALIGN',        (0,0),(-1,-1), 'MIDDLE'),
    ('BOTTOMPADDING', (0,0),(-1,-1), 5),
    ('TOPPADDING',    (0,0),(-1,-1), 5),
]))
story.append(connect_table)
story.append(note_box(
    'The URL is saved permanently to your device. You will not need to re-enter it '
    'unless you clear your browser data or switch to a new device.', 'tip'))
story.append(Spacer(1, 10))

# ── Step 7 ─────────────────────────────────────────────────────────────────────
story.append(step_block(7, 'Initialize the Sheet (First Time Only)', [
    Paragraph(
        'Back in the Apps Script editor, run the <b>setupSheet</b> function once to '
        'create the header row and column formatting:', body),
    Paragraph('  Run  →  Run function  →  setupSheet', code_style),
    Paragraph(
        'You will see a green checkmark and a pop-up: '
        '<i>"Sheet initialized! Headers and formatting are ready."</i>', body),
    Paragraph(
        'You can also skip this step — headers are created automatically the first '
        'time a pitch is recorded from the app.', body),
]))
story.append(Spacer(1, 10))

# ── Verify section ─────────────────────────────────────────────────────────────
story.append(Paragraph('Verifying the Connection', h1))
story.append(rule())
story.append(Paragraph(
    'Start a game in On the Bump and record one test pitch. Then open your Google Sheet — '
    'you should see a new row appear within a few seconds with all pitch details filled in.', body))
story.append(Spacer(1, 6))
story.append(note_box(
    'If no row appears after 30 seconds: (1) confirm the URL was copied correctly with no '
    'extra spaces, (2) check that the deployment is set to "Anyone" access, '
    '(3) re-authorize the script if prompted.', 'note'))
story.append(Spacer(1, 16))

# ── Column reference ───────────────────────────────────────────────────────────
story.append(Paragraph('Sheet Column Reference', h1))
story.append(rule())

col_data = [
    ['Col', 'Header',          'Description'],
    ['A',   'Game ID',         'Unique ID per game session'],
    ['B',   'Timestamp',       'Date and time the pitch was recorded'],
    ['C',   'My Team',         'Your team name from the startup screen'],
    ['D',   'Opposing Team',   'Opponent name from the startup screen'],
    ['E',   'Pitcher #',       'Pitcher jersey number'],
    ['F',   'Pitcher Name',    'Pitcher name (updates for relief pitchers)'],
    ['G',   'Batter #',        'Batter jersey number'],
    ['H',   'Batter Name',     'Batter name'],
    ['I',   'Handedness',      'L or R'],
    ['J',   'Lineup Pos',      '1–9 (or higher) in the batting order'],
    ['K',   'At-Bat #',        'How many times this batter has faced your pitcher'],
    ['L',   'Pitch # in AB',   'Pitch number within the current at-bat'],
    ['M',   'Balls Before',    'Ball count before this pitch'],
    ['N',   'Strikes Before',  'Strike count before this pitch'],
    ['O',   'Pitch Type',      'FB / CB / SL / CH'],
    ['P',   'Zone',            'Strike or Ball'],
    ['Q',   'Pitch Location',  'Z1–Z9 for strikes; B-High, B-Low, B-In, B-Out for balls'],
    ['R',   'Action',          'Swing / Look / In Play'],
    ['S',   'Result',          'Ball / Strike / Foul / K / K-look / BB / In-Play'],
    ['T',   'Balls After',     'Ball count after this pitch'],
    ['U',   'Strikes After',   'Strike count after this pitch'],
    ['V',   'Hit Type',        'ground-ball / line-drive / fly-ball / pop-up'],
    ['W',   'Hit Type Name',   'Ground Ball / Line Drive / Fly Ball / Pop Up'],
    ['X',   'Hit Result',      'out / error / single / double / triple / home-run'],
    ['Y',   'Hit Result Name', 'Out / Error / 1B / 2B / 3B / HR'],
    ['Z',   'Hit Zone',        'Field zone: LF, CF, RF, SS, 3B, 2B, 1B, etc.'],
    ['AA',  'Hit X',           'Horizontal spray chart coordinate (0.0–1.0)'],
    ['AB',  'Hit Y',           'Depth spray chart coordinate (0.0–1.0)'],
    ['AC',  'Runner 1B',       'Yes / No — runner on first at time of pitch'],
    ['AD',  'Runner 2B',       'Yes / No — runner on second at time of pitch'],
    ['AE',  'Runner 3B',       'Yes / No — runner on third at time of pitch'],
    ['AF',  'Outs',            '0 / 1 / 2 — outs in the inning at time of pitch'],
    ['AG',  'Base State',      'Empty / 1B / 2B+3B / Loaded / etc.'],
]

col_table = Table(col_data, colWidths=[0.45*inch, 1.5*inch, 4.55*inch])
col_table.setStyle(TableStyle([
    ('BACKGROUND',    (0,0),(-1,0),  NAVY),
    ('TEXTCOLOR',     (0,0),(-1,0),  WHITE),
    ('FONTNAME',      (0,0),(-1,0),  'Helvetica-Bold'),
    ('FONTNAME',      (0,1),(-1,-1), 'Helvetica'),
    ('FONTSIZE',      (0,0),(-1,-1), 8.5),
    ('ROWBACKGROUNDS',(0,1),(-1,-1), [WHITE, LIGHT]),
    ('BOX',           (0,0),(-1,-1), 1,   colors.HexColor('#cbd5e1')),
    ('INNERGRID',     (0,0),(-1,-1), 0.5, colors.HexColor('#e2e8f0')),
    ('TOPPADDING',    (0,0),(-1,-1), 4),
    ('BOTTOMPADDING', (0,0),(-1,-1), 4),
    ('LEFTPADDING',   (0,0),(-1,-1), 6),
    ('VALIGN',        (0,0),(-1,-1), 'MIDDLE'),
    # Color-band the column groups
    ('BACKGROUND',    (0,1),(0,4),   colors.HexColor('#e0f2fe')),  # A–D game
    ('BACKGROUND',    (0,5),(0,6),   colors.HexColor('#dcfce7')),  # E–F pitcher
    ('BACKGROUND',    (0,7),(0,11),  colors.HexColor('#f3e8ff')),  # G–K batter
    ('BACKGROUND',    (0,12),(0,18), colors.HexColor('#fef9c3')),  # L–R pitch
    ('BACKGROUND',    (0,19),(0,28), colors.HexColor('#ffe4e6')),  # S–AB outcome
    ('BACKGROUND',    (0,29),(0,33), colors.HexColor('#d1fae5')),  # AC–AG base
]))
story.append(col_table)
story.append(Spacer(1, 20))

# ── Footer ─────────────────────────────────────────────────────────────────────
footer_data = [[Paragraph(
    'On the Bump  ·  baseball.robertegarner.com  ·  Setup Guide v1.0',
    ParagraphStyle('Footer', fontSize=8, fontName='Helvetica',
                   textColor=SLATE, alignment=TA_CENTER))]]
footer = Table(footer_data, colWidths=[7*inch])
footer.setStyle(TableStyle([
    ('TOPPADDING',    (0,0),(-1,-1), 8),
    ('LINEABOVE',     (0,0),(-1,-1), 1, colors.HexColor('#e2e8f0')),
]))
story.append(footer)

# ── Build ──────────────────────────────────────────────────────────────────────
doc.build(story)
print("PDF created: OnTheBump_Setup_Guide.pdf")
