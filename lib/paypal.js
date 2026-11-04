'use strict';
// PayPal Checkout (Orders v2) for rides and tabs: an order, the friend approves it on PayPal
// (with a PayPal account or as a guest with a card), and we capture it. Refunds go back the same
// way. No SDK: OAuth client credentials and four calls.
//
// Keys: JEWBER_STATE/paypal.json {client_id, client_secret, currency} if there is one, else the
// env file JEWBER_PAYPAL_ENV names (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET / CURRENCY), so an
// env file another tool already keeps can be used where it is. Nothing here logs a key.
const fs = require('node:fs');
const path = require('node:path');

const API = (process.env.JEWBER_PAYPAL_API || 'https://api-m.paypal.com').replace(/\/$/, '');

function readConfig(stateDir) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(stateDir, 'paypal.json'), 'utf8'));
    if (j.client_id && j.client_secret) return { id: j.client_id, secret: j.client_secret, currency: j.currency || 'USD' };
  } catch {}
  const envFile = process.env.JEWBER_PAYPAL_ENV;
  if (!envFile) return null;
  try {
    const env = {};
    for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
      const i = line.indexOf('=');
      if (i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    }
    if (env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET) return { id: env.PAYPAL_CLIENT_ID, secret: env.PAYPAL_CLIENT_SECRET, currency: env.CURRENCY || 'USD' };
  } catch {}
  return null;
}

function client(stateDir) {
  const cfg = readConfig(stateDir);
  if (!cfg) return { on: false };
  let token = null;
  let until = 0;

  async function auth() {
    if (token && Date.now() < until) return token;
    const r = await fetch(`${API}/v1/oauth2/token`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from(`${cfg.id}:${cfg.secret}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error(`paypal auth ${r.status}`);
    const j = await r.json();
    token = j.access_token;
    until = Date.now() + Math.max(60, (j.expires_in || 3000) - 120) * 1000;
    return token;
  }

  async function call(method, p, body, extra = {}) {
    const r = await fetch(API + p, {
      method,
      headers: { Authorization: `Bearer ${await auth()}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...extra },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
    const text = await r.text();
    let j = {};
    try { j = text ? JSON.parse(text) : {}; } catch {}
    if (!r.ok) {
      const issue = (j.details && j.details[0] && j.details[0].issue) || j.name || r.status;
      throw Object.assign(new Error(`paypal ${method} ${p.split('/').slice(0, 4).join('/')}: ${issue}`), { status: r.status, issue });
    }
    return j;
  }

  const money = (n) => ({ currency_code: cfg.currency, value: (Math.round(n * 100) / 100).toFixed(2) });

  // An order for `amount`; returns { id, url } where url is where the friend approves it.
  async function createOrder({ amount, description, customId, invoiceId, returnUrl, cancelUrl }) {
    const j = await call('POST', '/v2/checkout/orders', {
      intent: 'CAPTURE',
      purchase_units: [{ reference_id: customId, custom_id: customId, invoice_id: invoiceId, description: description.slice(0, 127), soft_descriptor: 'JEWBER RIDE', amount: money(amount) }],
      payment_source: { paypal: { experience_context: { brand_name: 'Jewber', shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW', landing_page: 'NO_PREFERENCE', return_url: returnUrl, cancel_url: cancelUrl } } },
    }, { 'PayPal-Request-Id': invoiceId });
    const link = (j.links || []).find((l) => l.rel === 'payer-action' || l.rel === 'approve');
    return { id: j.id, status: j.status, url: link && link.href };
  }

  const getOrder = (id) => call('GET', `/v2/checkout/orders/${encodeURIComponent(id)}`);

  // Capture an approved order: { status, captureId, gross, fee, net }.
  async function capture(id) {
    let j;
    try {
      j = await call('POST', `/v2/checkout/orders/${encodeURIComponent(id)}/capture`, {}, { 'PayPal-Request-Id': `cap-${id}` });
    } catch (e) {
      if (e.issue !== 'ORDER_ALREADY_CAPTURED') throw e;
      j = await getOrder(id);
    }
    const c = j.purchase_units && j.purchase_units[0] && j.purchase_units[0].payments && j.purchase_units[0].payments.captures && j.purchase_units[0].payments.captures[0];
    if (!c) return { status: j.status };
    const b = c.seller_receivable_breakdown || {};
    const num = (x) => (x && x.value ? +x.value : null);
    return { status: c.status, orderStatus: j.status, captureId: c.id, gross: num(c.amount), fee: num(b.paypal_fee), net: num(b.net_amount), payer: j.payer && j.payer.email_address };
  }

  async function refund(captureId) {
    const j = await call('POST', `/v2/payments/captures/${encodeURIComponent(captureId)}/refund`, {}, { 'PayPal-Request-Id': `ref-${captureId}` });
    return { status: j.status, id: j.id };
  }

  return { on: true, currency: cfg.currency, createOrder, getOrder, capture, refund };
}

// What a friend pays so the driver still gets `amount` after PayPal's cut (US goods and
// services: 3.49% + $0.49), when the driver has chosen to pass the fee on.
function withFee(amount) {
  return Math.ceil(((amount + 0.49) / (1 - 0.0349)) * 100) / 100;
}

module.exports = { client, withFee };
