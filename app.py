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

app = Flask(__name__)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PARENT_DIR = BASE_DIR  # data files now live alongside app.py

_products_cache = None

def load_products():
    global _products_cache
    if _products_cache is not None:
        return _products_cache

    mapping_file = os.path.join(PARENT_DIR, 'product_mapping.json')
    aerostar_file = os.path.join(PARENT_DIR, 'aerostar_products.json')

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
    # env vars override file (used in cloud deployments)
    if os.environ.get('SMTP_USER'):
        data['smtp_user'] = os.environ['SMTP_USER']
    if os.environ.get('SMTP_PASS'):
        data['smtp_pass'] = os.environ['SMTP_PASS']
    if os.environ.get('ORDER_EMAIL'):
        data['order_email'] = os.environ['ORDER_EMAIL']
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

    if smtp_user and smtp_pass:
        try:
            _send_email(config, firm_name, contact_number, items, save_path, fname)
            return jsonify({'success': True, 'email_sent': True,
                            'message': f'Order sent successfully to {order_email}',
                            'download': fname})
        except Exception as e:
            return jsonify({'success': True, 'email_sent': False,
                            'message': f'Order saved. Email failed: {str(e)}',
                            'download': fname})
    else:
        return jsonify({'success': True, 'email_sent': False,
                        'message': 'Order saved. Configure SMTP to enable auto-email.',
                        'download': fname})


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


if __name__ == '__main__':
    app.run(debug=True, port=5001, host='0.0.0.0')
