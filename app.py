from flask import Flask, render_template, jsonify, request, send_file
import json
import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email.mime.text import MIMEText
from email import encoders
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
import tempfile
from datetime import datetime

try:
    import gspread
    from google.oauth2.service_account import Credentials as SACredentials
    _GSPREAD_AVAILABLE = True
except ImportError:
    _GSPREAD_AVAILABLE = False

import urllib.request

# ── Green API (WhatsApp) config ───────────────────────────────────
WA_INSTANCE  = os.environ.get('WA_INSTANCE', '7107619441')
WA_TOKEN     = os.environ.get('WA_TOKEN', 'ff2ce0fab0154d8a94fd5153423feb4ab9a76b0a5b5047cf8f')
WA_GROUP_ID  = os.environ.get('WA_GROUP_ID', '120363425235648966@g.us')  # Fiber order grp
WA_BASE      = f'https://api.green-api.com/waInstance{WA_INSTANCE}'

app = Flask(__name__)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PARENT_DIR = BASE_DIR  # data files now live alongside app.py

_products_cache = None
_catalog_mtime  = None  # tracks product_catalog.xlsx modification time

def _load_from_excel(xlsx_path):
    wb = openpyxl.load_workbook(xlsx_path, read_only=True, data_only=True)
    ws = wb['All Products']
    products, seen = [], set()
    headers = [c.value for c in next(ws.iter_rows(min_row=1, max_row=1))]
    col = {h: i for i, h in enumerate(headers) if h}
    for row in ws.iter_rows(min_row=2, values_only=True):
        pn = str(row[col['AS Part No']] or '').strip()
        if not pn or pn in seen:
            continue
        seen.add(pn)
        mrp_raw = row[col.get('MRP (₹)', -1)] if 'MRP (₹)' in col else None
        try:
            mrp = float(mrp_raw) if mrp_raw not in (None, '', '-') else None
        except (ValueError, TypeError):
            mrp = None
        products.append({
            'id':             pn,
            'as_part_number': pn,
            'sai_part_number': str(row[col.get('SAI Part No', -1)] or '').strip(),
            'description':    str(row[col.get('Description', -1)] or '').strip(),
            'category':       str(row[col.get('Category', -1)] or '').strip(),
            'brand':          str(row[col.get('Brand', -1)] or '').strip(),
            'vehicle':        str(row[col.get('Vehicle', -1)] or '').strip(),
            'colour':         str(row[col.get('Colour', -1)] or 'N/A').strip(),
            'mrp':            mrp,
            'std_packing':    str(row[col.get('Std. Packing', -1)] or '').strip() if 'Std. Packing' in col else '',
        })
    wb.close()
    return products

def load_products():
    global _products_cache, _catalog_mtime

    catalog_file = os.path.join(BASE_DIR, 'product_catalog.xlsx')
    mapping_file = os.path.join(PARENT_DIR, 'product_mapping.json')
    aerostar_file = os.path.join(PARENT_DIR, 'aerostar_products.json')

    # If catalog Excel exists, use it and reload when file changes
    if os.path.exists(catalog_file):
        mtime = os.path.getmtime(catalog_file)
        if _products_cache is not None and mtime == _catalog_mtime:
            return _products_cache
        try:
            products = _load_from_excel(catalog_file)
            _products_cache = products
            _catalog_mtime  = mtime
            return products
        except Exception as e:
            print(f'[catalog] Failed to load Excel: {e}')

    if _products_cache is not None:
        return _products_cache

    products = []

    if os.path.exists(mapping_file):
        with open(mapping_file) as f:
            mapping = json.load(f)
        seen = set()
        for m in mapping:
            key = m.get('as_part_number', '') or m.get('sai_part_number', '')
            if not key or key in seen:
                continue
            seen.add(key)
            products.append({
                'id': key,
                'as_part_number': m.get('as_part_number', ''),
                'sai_part_number': m.get('sai_part_number', ''),
                'description': m.get('description', ''),
                'category': m.get('category', ''),
                'brand': m.get('brand', ''),
                'vehicle': (m.get('vehicle') or '').strip(),
                'colour': m.get('colour', 'N/A'),
                'mrp': m.get('mrp'),
            })
    elif os.path.exists(aerostar_file):
        with open(aerostar_file) as f:
            raw = json.load(f)
        seen = set()
        for p in raw:
            pn = p.get('part_number', '')
            if pn in seen:
                continue
            seen.add(pn)
            products.append({
                'id': pn,
                'as_part_number': pn,
                'sai_part_number': pn.replace('AS-', 'SAI-'),
                'description': p.get('description', ''),
                'category': p.get('category', ''),
                'brand': p.get('brand', ''),
                'vehicle': (p.get('vehicle') or '').strip(),
                'colour': p.get('colour', 'N/A'),
                'mrp': p.get('mrp'),
            })

    _products_cache = products
    return products


def load_config():
    cfg = os.path.join(BASE_DIR, 'portal_config.json')
    if os.path.exists(cfg):
        with open(cfg) as f:
            data = json.load(f)
    else:
        data = {
            'order_email': 'harshrupani@rupaniautomobiles.com',
            'smtp_host': 'smtp.gmail.com',
            'smtp_port': 587,
            'smtp_user': '',
            'smtp_pass': ''
        }
    # env vars always override file (used in cloud deployments like Railway)
    if os.environ.get('SMTP_USER'):
        data['smtp_user'] = os.environ['SMTP_USER'].strip()
    if os.environ.get('SMTP_PASS'):
        data['smtp_pass'] = os.environ['SMTP_PASS']  # keep spaces – Gmail App Password uses them
    if os.environ.get('ORDER_EMAIL'):
        data['order_email'] = os.environ['ORDER_EMAIL'].strip()
    if os.environ.get('GSHEET_ID'):
        data['gsheet_id'] = os.environ['GSHEET_ID'].strip()
    if os.environ.get('SMTP_HOST'):
        data['smtp_host'] = os.environ['SMTP_HOST'].strip()
    if os.environ.get('SMTP_PORT'):
        data['smtp_port'] = int(os.environ['SMTP_PORT'].strip())
    return data


def save_config(data):
    cfg = os.path.join(BASE_DIR, 'portal_config.json')
    with open(cfg, 'w') as f:
        json.dump(data, f, indent=2)


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/products')
def get_products():
    return jsonify(load_products())


@app.route('/api/config', methods=['GET'])
def get_config():
    c = load_config()
    return jsonify({k: v for k, v in c.items() if k != 'smtp_pass'})


@app.route('/api/config', methods=['POST'])
def update_config():
    data = request.json or {}
    c = load_config()
    c.update(data)
    save_config(c)
    return jsonify({'success': True})


@app.route('/api/test-email')
def test_email():
    config = load_config()
    smtp_user = config.get('smtp_user', '')
    smtp_pass = config.get('smtp_pass', '')
    order_email = config.get('order_email', '')
    smtp_host = config.get('smtp_host', 'smtp.gmail.com')
    smtp_port = int(config.get('smtp_port', 587))

    print(f"[TEST-EMAIL] smtp_user={repr(smtp_user)}", flush=True)
    print(f"[TEST-EMAIL] smtp_pass_len={len(smtp_pass)} smtp_pass_repr={repr(smtp_pass)}", flush=True)
    print(f"[TEST-EMAIL] order_email={repr(order_email)}", flush=True)
    print(f"[TEST-EMAIL] smtp_host={smtp_host} smtp_port={smtp_port}", flush=True)

    if not smtp_user or not smtp_pass:
        return jsonify({
            'success': False,
            'smtp_user': smtp_user,
            'smtp_pass_len': len(smtp_pass),
            'error': 'Missing SMTP credentials'
        })

    try:
        msg = MIMEText('Test email from Rupani Order Portal (/api/test-email)')
        msg['From'] = smtp_user
        msg['To'] = order_email
        msg['Subject'] = 'Rupani Portal – SMTP Test'
        with smtplib.SMTP(smtp_host, smtp_port) as s:
            s.starttls()
            s.login(smtp_user, smtp_pass)
            s.sendmail(smtp_user, [order_email], msg.as_string())
        return jsonify({'success': True, 'smtp_user': smtp_user, 'smtp_pass_len': len(smtp_pass), 'error': None})
    except Exception as e:
        print(f"[TEST-EMAIL ERROR] {e}", flush=True)
        return jsonify({'success': False, 'smtp_user': smtp_user, 'smtp_pass_len': len(smtp_pass), 'error': str(e)})


@app.route('/api/reload-catalog', methods=['POST'])
def reload_catalog():
    global _products_cache, _catalog_mtime
    _products_cache = None
    _catalog_mtime  = None
    load_products()
    return jsonify({'success': True, 'total': len(_products_cache or [])})


@app.route('/api/checkout', methods=['POST'])
def checkout():
    data = request.json or {}
    firm_name = (data.get('firm_name') or '').strip()
    contact_number = (data.get('contact_number') or '').strip()
    items = data.get('items', [])

    if not items:
        return jsonify({'success': False, 'error': 'No items in order'})
    if not firm_name:
        return jsonify({'success': False, 'error': 'Firm name required'})

    wb = _build_excel(firm_name, contact_number, items)

    fname = f"Order_{firm_name.replace(' ','_')}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
    save_path = os.path.join(BASE_DIR, fname)
    wb.save(save_path)

    config = load_config()
    smtp_user = config.get('smtp_user', '')
    smtp_pass = config.get('smtp_pass', '')
    order_email = config.get('order_email', 'harshrupani@rupaniautomobiles.com')

    email_sent = False
    if smtp_user and smtp_pass:
        try:
            _send_email(config, firm_name, contact_number, items, save_path, fname)
            email_sent = True
            msg = f'Order sent successfully to {order_email}'
        except Exception as e:
            print(f"[EMAIL ERROR] {e}", flush=True)
            msg = f'Order saved. Email failed: {str(e)}'
    else:
        print(f"[EMAIL SKIP] smtp_user={repr(smtp_user)} smtp_pass_len={len(smtp_pass)}", flush=True)
        msg = 'Order saved.'

    # ── WhatsApp notification ────────────────────────────────────
    wa_sent = False
    try:
        _send_whatsapp(firm_name, contact_number, items, save_path, fname)
        wa_sent = True
        msg = 'Order placed! WhatsApp sent to Fiber order grp ✅'
    except Exception as e:
        print(f"[WhatsApp ERROR] {e}", flush=True)
        msg += f' WhatsApp failed: {str(e)}'

    # Log to Google Sheet (non-blocking)
    try:
        _log_to_gsheet(config, firm_name, contact_number, items, email_sent or wa_sent)
    except Exception as e:
        print(f"[GSheet] Logging failed: {e}")

    return jsonify({'success': True, 'email_sent': email_sent, 'wa_sent': wa_sent, 'message': msg, 'download': fname})


@app.route('/download/<path:filename>')
def download_order(filename):
    fp = os.path.join(BASE_DIR, filename)
    if os.path.exists(fp):
        return send_file(fp, as_attachment=True, download_name=filename)
    return 'File not found', 404


def _build_excel(firm_name, contact_number, items):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = 'Order'

    navy = PatternFill(start_color='1B2A4A', end_color='1B2A4A', fill_type='solid')
    gold_fill = PatternFill(start_color='FFF3CD', end_color='FFF3CD', fill_type='solid')
    alt_fill = PatternFill(start_color='F8F9FA', end_color='F8F9FA', fill_type='solid')
    white_fill = PatternFill(start_color='FFFFFF', end_color='FFFFFF', fill_type='solid')

    hdr_font = Font(color='FFFFFF', bold=True, size=11)
    bold_font = Font(bold=True, size=11)
    normal_font = Font(size=11)
    title_font = Font(bold=True, size=14, color='1B2A4A')

    thin = Side(style='thin', color='CCCCCC')
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    center = Alignment(horizontal='center', vertical='center', wrap_text=True)
    left_wrap = Alignment(horizontal='left', vertical='center', wrap_text=True)

    # Title row
    ws.merge_cells('A1:G1')
    ws['A1'] = 'RUPANI AUTOMOBILES PVT. LTD. — ORDER SHEET'
    ws['A1'].font = title_font
    ws['A1'].alignment = center
    ws['A1'].fill = PatternFill(start_color='E8EAF6', end_color='E8EAF6', fill_type='solid')
    ws.row_dimensions[1].height = 30

    ws.append([])  # row 2

    # Row 3: Firm Name
    ws['A3'] = 'Firm Name'
    ws['A3'].font = bold_font
    ws['A3'].fill = gold_fill
    ws['A3'].border = border
    ws['B3'] = firm_name
    ws['B3'].font = normal_font
    ws['B3'].border = border
    ws.merge_cells('B3:D3')

    # Row 4: Contact
    ws['A4'] = 'Contact Number'
    ws['A4'].font = bold_font
    ws['A4'].fill = gold_fill
    ws['A4'].border = border
    ws['B4'] = contact_number
    ws['B4'].font = normal_font
    ws['B4'].border = border
    ws.merge_cells('B4:D4')

    # Row 5: Date
    ws['A5'] = 'Order Date'
    ws['A5'].font = bold_font
    ws['A5'].fill = gold_fill
    ws['A5'].border = border
    ws['B5'] = datetime.now().strftime('%d-%m-%Y %H:%M')
    ws['B5'].font = normal_font
    ws['B5'].border = border
    ws.merge_cells('B5:D5')

    ws.append([])  # row 6

    # Row 7: column headers
    hdrs = ['Part No. (AS)', 'Part No. (SAI)', 'Description', 'Vehicle', 'Colour', 'MRP (₹)', 'Qty']
    for col, h in enumerate(hdrs, 1):
        c = ws.cell(row=7, column=col, value=h)
        c.font = hdr_font
        c.fill = navy
        c.border = border
        c.alignment = center
    ws.row_dimensions[7].height = 22

    # Data rows start at row 8
    for i, item in enumerate(items):
        row = 8 + i
        fill = alt_fill if i % 2 == 0 else white_fill
        vals = [
            item.get('as_part_number', ''),
            item.get('sai_part_number', ''),
            item.get('description', ''),
            item.get('vehicle', ''),
            item.get('colour', ''),
            item.get('mrp', ''),
            item.get('qty', 0),
        ]
        for col, v in enumerate(vals, 1):
            c = ws.cell(row=row, column=col, value=v)
            c.border = border
            c.fill = fill
            c.font = normal_font
            c.alignment = center if col in (1, 2, 6, 7) else left_wrap
        ws.row_dimensions[row].height = 18

    # Column widths
    for col, w in zip('ABCDEFG', [18, 18, 42, 28, 18, 10, 7]):
        ws.column_dimensions[col].width = w

    return wb


def _send_email(config, firm_name, contact_number, items, filepath, fname):
    order_email = config['order_email']
    smtp_user   = config['smtp_user']

    # Always CC the sender account so there's a copy in Gmail Sent/Inbox
    recipients = [order_email]
    if smtp_user and smtp_user != order_email:
        recipients.append(smtp_user)

    msg = MIMEMultipart()
    msg['From']    = smtp_user
    msg['To']      = order_email
    msg['Cc']      = smtp_user
    msg['Subject'] = f"New Order – {firm_name} | {datetime.now().strftime('%d %b %Y %H:%M')}"

    body = (
        f"A new order has been placed via the Rupani Automobiles Order Portal.\n\n"
        f"Firm Name   : {firm_name}\n"
        f"Contact     : {contact_number}\n"
        f"Total Items : {len(items)}\n"
        f"Order Date  : {datetime.now().strftime('%d-%m-%Y %H:%M')}\n\n"
        f"Please find the order details attached."
    )
    msg.attach(MIMEText(body, 'plain'))

    with open(filepath, 'rb') as fh:
        part = MIMEBase('application', 'vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        part.set_payload(fh.read())
        encoders.encode_base64(part)
        part.add_header('Content-Disposition', f'attachment; filename="{fname}"')
        msg.attach(part)

    with smtplib.SMTP(config['smtp_host'], int(config['smtp_port'])) as s:
        s.starttls()
        s.login(smtp_user, config['smtp_pass'])
        s.sendmail(smtp_user, recipients, msg.as_string())


def _send_whatsapp(firm_name, contact_number, items, filepath, fname):
    """Send order summary text + Excel file to the WhatsApp group via Green API."""
    import base64

    now = datetime.now().strftime('%d %b %Y, %I:%M %p')
    total_qty = sum(i.get('qty', 0) for i in items)
    total_mrp = sum((i.get('mrp') or 0) * i.get('qty', 0) for i in items)

    # ── 1. Text summary ──────────────────────────────────────────
    lines = [
        f"🛒 *New Order — {firm_name}*",
        f"📱 {contact_number}",
        f"📦 {len(items)} item(s) | Qty: {total_qty} | ₹{total_mrp:,.0f}",
        f"🕐 {now}",
        "",
    ]
    for it in items:
        lines.append(f"• {it.get('as_part_number','')} — {it.get('description','')[:45]}  x{it.get('qty',0)}")
    text_body = json.dumps({"chatId": WA_GROUP_ID, "message": "\n".join(lines)})
    text_url  = f"{WA_BASE}/sendMessage/{WA_TOKEN}"
    req = urllib.request.Request(
        text_url,
        data=text_body.encode(),
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    urllib.request.urlopen(req, timeout=15)

    # ── 2. Excel file ────────────────────────────────────────────
    with open(filepath, 'rb') as fh:
        b64 = base64.b64encode(fh.read()).decode()

    file_body = json.dumps({
        "chatId":   WA_GROUP_ID,
        "fileName": fname,
        "caption":  f"Order: {firm_name} — {now}",
        "file":     f"data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,{b64}"
    })
    file_url = f"{WA_BASE}/sendFileByUpload/{WA_TOKEN}"
    req2 = urllib.request.Request(
        file_url,
        data=file_body.encode(),
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    urllib.request.urlopen(req2, timeout=30)
    print(f"[WhatsApp] Sent order to group for {firm_name}", flush=True)


def _log_to_gsheet(config, firm_name, contact_number, items, email_sent):
    if not _GSPREAD_AVAILABLE:
        return
    creds_file = os.path.join(BASE_DIR, 'google_credentials.json')
    sheet_id   = config.get('gsheet_id', '').strip()
    if not os.path.exists(creds_file) or not sheet_id:
        return

    try:
        scopes = [
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/drive',
        ]
        creds = SACredentials.from_service_account_file(creds_file, scopes=scopes)
        gc    = gspread.authorize(creds)
        spreadsheet = gc.open_by_key(sheet_id)

        # ── master Orders sheet ──────────────────────────
        try:
            master = spreadsheet.worksheet('Orders')
        except gspread.WorksheetNotFound:
            master = spreadsheet.add_worksheet(title='Orders', rows=1000, cols=8)
            master.append_row(
                ['Date & Time', 'Firm Name', 'Contact', 'Items', 'Total Qty', 'MRP Total (₹)', 'Email Sent'],
                value_input_option='USER_ENTERED'
            )
            master.format('A1:G1', {
                'textFormat': {'bold': True},
                'backgroundColor': {'red': 0.106, 'green': 0.165, 'blue': 0.290}
            })

        # ── individual order sheet tab ───────────────────
        now       = datetime.now()
        tab_name  = f"{now.strftime('%d%m%y_%H%M')}_{firm_name[:18].strip()}"
        tab_name  = ''.join(c for c in tab_name if c not in r'\/*?[]')[:100]

        # avoid duplicate tab names
        existing  = [ws.title for ws in spreadsheet.worksheets()]
        suffix    = 0
        base_name = tab_name
        while tab_name in existing:
            suffix   += 1
            tab_name  = f"{base_name}_{suffix}"

        order_ws = spreadsheet.add_worksheet(title=tab_name, rows=len(items) + 15, cols=8)
        order_gid = order_ws.id

        # header info rows
        header_rows = [
            ['Rupani Automobiles — Order Sheet'],
            [],
            ['Firm Name',      firm_name],
            ['Contact',        contact_number],
            ['Date & Time',    now.strftime('%d-%m-%Y %H:%M')],
            ['Total Items',    len(items)],
            [],
            ['Part No. (AS)', 'Part No. (SAI)', 'Description', 'Vehicle', 'Colour', 'MRP (₹)', 'Qty'],
        ]
        order_ws.update(range_name='A1', values=header_rows, value_input_option='USER_ENTERED')

        data_rows = [[
            i.get('as_part_number', ''),
            i.get('sai_part_number', ''),
            i.get('description', ''),
            i.get('vehicle', ''),
            i.get('colour', ''),
            i.get('mrp', ''),
            i.get('qty', 0),
        ] for i in items]
        if data_rows:
            order_ws.update(range_name='A9', values=data_rows, value_input_option='USER_ENTERED')

        # ── append row to master with hyperlink ──────────
        total_qty = sum(i.get('qty', 0) for i in items)
        total_mrp = sum((i.get('mrp') or 0) * i.get('qty', 0) for i in items)
        hyperlink  = f'=HYPERLINK("#gid={order_gid}","{firm_name.replace(chr(34), "")}")'

        master.append_row(
            [now.strftime('%d-%m-%Y %H:%M'), hyperlink, contact_number,
             len(items), total_qty, total_mrp, 'Yes' if email_sent else 'No'],
            value_input_option='USER_ENTERED'
        )
    except Exception as e:
        print(f"[GSheet] Error: {e}")


if __name__ == '__main__':
    app.run(debug=True, port=5001, host='0.0.0.0')
