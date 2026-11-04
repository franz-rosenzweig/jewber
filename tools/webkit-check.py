# The friends' screens in WebKit (Safari's engine) at iPhone size, against a sandbox server.
# Runs inside mcr.microsoft.com/playwright/python:v1.55.0-noble with --network host:
#   python3 webkit-check.py BASE STATE_DIR OUT_DIR
import json, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE, STATE, OUT = sys.argv[1], Path(sys.argv[2]), Path(sys.argv[3])
OUT.mkdir(parents=True, exist_ok=True)
errors = []

def code(email):
    lines = [json.loads(l) for l in (STATE / 'outbox.jsonl').read_text().splitlines()]
    import re
    return re.search(r'\d{6}', [m for m in lines if m['to'] == email][-1]['subject']).group(0)

with sync_playwright() as p:
    b = p.webkit.launch()
    ctx = b.new_context(**p.devices['iPhone 15'], geolocation={'latitude': 33.5089, 'longitude': -112.0569}, permissions=['geolocation'])
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('console', lambda m: m.type == 'error' and errors.append(m.text))
    pg.goto(BASE)
    pg.wait_for_selector('#email')
    pg.screenshot(path=str(OUT / 'ios-01-signin.png'))
    pg.fill('#email', 'avi@example.com')
    pg.click('button[type=submit]')
    pg.wait_for_selector('#code')
    time.sleep(0.5)
    pg.fill('#code', code('avi@example.com'))
    pg.wait_for_selector('text=Where to?', timeout=15000)
    time.sleep(3)
    pg.screenshot(path=str(OUT / 'ios-02-home.png'))
    pg.click('[data-act="whereTo"]')
    pg.fill('#f-drop', 'Desert Botanical Garden')
    pg.wait_for_selector('[data-act="pickResult"]', timeout=15000)
    pg.click('[data-act="pickResult"] >> nth=0')
    pg.wait_for_selector('text=Choose a ride', timeout=20000)
    pg.wait_for_selector('text=Schlep', timeout=20000)
    time.sleep(3)
    pg.screenshot(path=str(OUT / 'ios-03-choose.png'))
    pg.click('[data-act="openWhen"] >> nth=0')
    time.sleep(0.8)
    pg.screenshot(path=str(OUT / 'ios-04-when.png'))
    pg.click('[data-act="setWhen"] >> nth=0')
    time.sleep(2)
    pg.click('[data-act="request"]')
    time.sleep(2)
    pg.screenshot(path=str(OUT / 'ios-05-booked.png'))
    pg.click('[data-act="go"][data-to="account"]')
    time.sleep(1)
    pg.screenshot(path=str(OUT / 'ios-06-account.png'))
    b.close()
print('errors:', errors or 'none')
