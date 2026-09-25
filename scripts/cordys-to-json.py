#!/usr/bin/env python3
"""把 Cordys CRM 导出的 客户.xlsx + 联系人.xlsx 转成 WMCRM 导入用 JSON。

用法:
  python3 scripts/cordys-to-json.py 客户.xlsx 联系人.xlsx data/cordys-customers.json
"""
import zipfile
import xml.etree.ElementTree as ET
import sys
import json
from datetime import datetime

NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'


def read_sheet(path):
    """用标准库读取 xlsx 第一个工作表，返回 dict 列表（首行为表头）。"""
    z = zipfile.ZipFile(path)
    strings = []
    if 'xl/sharedStrings.xml' in z.namelist():
        root = ET.fromstring(z.read('xl/sharedStrings.xml'))
        for si in root.findall(f'{NS}si'):
            strings.append(''.join(t.text or '' for t in si.iter(f'{NS}t')))

    sheet = ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
    records = []
    headers = {}
    for row in sheet.iter(f'{NS}row'):
        cells = {}
        for c in row.findall(f'{NS}c'):
            col = ''.join(ch for ch in c.get('r') if ch.isalpha())
            t = c.get('t')
            v = c.find(f'{NS}v')
            is_el = c.find(f'{NS}is')
            if t == 's' and v is not None:
                val = strings[int(v.text)]
            elif t == 'inlineStr' and is_el is not None:
                val = ''.join(x.text or '' for x in is_el.iter(f'{NS}t'))
            else:
                val = v.text if v is not None else ''
            cells[col] = (val or '').strip()
        if not headers:
            headers = cells
            continue
        records.append({headers.get(k, k): v for k, v in cells.items()})
    return records


def parse_time(s):
    """'2026-07-26 15:38:20' -> 毫秒时间戳；解析失败返回当前时间。"""
    try:
        return int(datetime.strptime(s, '%Y-%m-%d %H:%M:%S').timestamp() * 1000)
    except (ValueError, TypeError):
        return int(__import__('time').time() * 1000)


def valid_email(s):
    # 旧数据里有大量 "22"、"dd" 之类占位值，只认真含 @ 的
    return '@' in s and ' ' not in s and len(s) <= 200


def valid_phone(s):
    # 去掉非数字字符后至少 7 位才算真实手机号
    digits = ''.join(ch for ch in s if ch.isdigit())
    return len(digits) >= 7


# 客户等级 -> 采购意向
LEVEL_TO_INTENT = {
    '可以下单的客户': 'high',
    '已经成交的客户': 'high',
    '需持续跟踪的客户': 'medium',
    '观望的客户': 'low',
    '公海客户': 'low',
}


def main():
    customer_xlsx, contact_xlsx, out_json = sys.argv[1:4]
    raw_customers = read_sheet(customer_xlsx)
    raw_contacts = read_sheet(contact_xlsx)

    customers = {}  # 客户名称 -> 客户对象
    order = []

    for r in raw_customers:
        name = r.get('客户名称', '')
        if not name or name in customers:
            continue
        source = r.get('客户来源', '')
        tag = r.get('客户标签', '')
        if tag:
            source = f'{source}（{tag}）' if source else tag
        c = {
            'name': name,
            'company': '',
            'nationality': r.get('地区', ''),
            'source': source,
            'type': r.get('客户类型', ''),
            'phone': '',
            'email': '',
            'intent': LEVEL_TO_INTENT.get(r.get('客户等级', ''), 'medium'),
            'createdAt': parse_time(r.get('创建时间', '')),
        }
        customers[name] = c
        order.append(name)

    # 联系人按客户名称归集
    for r in raw_contacts:
        key = r.get('客户名称', '')
        if not key:
            continue
        if key not in customers:
            # 客户表里没有的联系人，也补建成客户
            c = {
                'name': key,
                'company': '',
                'nationality': '',
                'source': '',
                'type': '',
                'phone': '',
                'email': '',
                'intent': 'medium',
                'createdAt': parse_time(r.get('创建时间', '')),
            }
            customers[key] = c
            order.append(key)
        c = customers[key]

        email = r.get('邮箱', '')
        if valid_email(email) and email not in c['email'].split(' / '):
            c['email'] = ' / '.join(x for x in [c['email'], email] if x)[:200]

        phone = r.get('手机号', '')
        if valid_phone(phone) and phone not in c['phone'].split(' / '):
            c['phone'] = ' / '.join(x for x in [c['phone'], phone] if x)[:100]

    result = [customers[name] for name in order]
    with open(out_json, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f'转换完成：共 {len(result)} 个客户 -> {out_json}')
    print(f"  有电话: {sum(1 for c in result if c['phone'])}")
    print(f"  有邮箱: {sum(1 for c in result if c['email'])}")


if __name__ == '__main__':
    main()
