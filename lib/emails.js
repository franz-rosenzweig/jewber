'use strict';
// Jewber's emails, dressed up: Jerusalem stone around a paper card, a techelet band with the logo,
// Georgia for the big words, gold buttons, and Stars of David. Email clients are picky, so it's
// tables and inline styles only, no scripts, no SVG, and every color written out. Each template
// gives back { subject, text, html }; the text is the same email for mail apps that want plain text.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const C = { stone: '#F2ECE0', paper: '#FBF8F2', ink: '#1C1A17', body: '#4F4A42', muted: '#8A8275', blue: '#2347D9', blueDark: '#1A2E9A', gold: '#F5B82E', line: '#E6DDCC' };
const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const pick = (list) => list[Math.floor(Math.random() * list.length)];

function button(label, href, { gold = true } = {}) {
  const bg = gold ? C.gold : C.blue, fg = gold ? C.ink : '#FFFFFF';
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 4px"><tr><td align="center" bgcolor="${bg}" style="border-radius:14px;background:${bg};box-shadow:0 6px 16px rgba(233,169,44,.35)">
<a href="${esc(href)}" style="display:inline-block;padding:16px 30px;font-family:${SANS};font-size:17px;font-weight:700;color:${fg};text-decoration:none;border-radius:14px">${esc(label)}</a></td></tr></table>`;
}

function pills(items) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${items.map(([label, href]) => `<td style="padding:0 10px 0 0"><a href="${esc(href)}" style="display:inline-block;padding:10px 18px;border:2px solid ${C.blue};border-radius:999px;font-family:${SANS};font-size:15px;font-weight:700;color:${C.blue};text-decoration:none">${esc(label)}</a></td>`).join('')}</tr></table>`;
}

const kicker = (t) => `<div style="font-family:${SANS};font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${C.blue};margin:0 0 10px">${esc(t)}</div>`;
const title = (t) => `<h1 style="font-family:${SERIF};font-size:32px;line-height:1.15;font-weight:700;color:${C.ink};margin:0 0 16px">${t}</h1>`;
const para = (t, extra = '') => `<p style="font-family:${SANS};font-size:16px;line-height:1.6;color:${C.body};margin:0 0 16px;${extra}">${t}</p>`;
const stars = `<div style="text-align:center;font-family:${SERIF};font-size:16px;letter-spacing:10px;color:${C.gold};margin:22px 0 18px">&#10017; &#10017; &#10017;</div>`;
const bullet = (t) => `<tr><td valign="top" style="padding:0 12px 10px 0;font-family:${SERIF};font-size:15px;color:${C.gold}">&#10017;</td><td style="padding:0 0 10px;font-family:${SANS};font-size:15px;line-height:1.5;color:${C.body}">${t}</td></tr>`;

// The frame every email shares.
function shell({ preheader, body, url, footer }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>Jewber</title></head>
<body style="margin:0;padding:0;background:${C.stone}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.stone}">${esc(preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.stone}" style="background:${C.stone}"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px">
  <tr><td bgcolor="${C.blue}" style="background:${C.blue};background-image:linear-gradient(180deg,${C.blueDark} 0%,${C.blue} 70%,#4C6CF0 100%);border-radius:24px 24px 0 0;padding:30px 32px 26px" align="center">
    <a href="${esc(url)}" style="text-decoration:none">
      <img src="${esc(url)}/icons/icon-192.png" width="64" height="64" alt="" style="display:block;border:0;border-radius:16px;margin:0 auto 12px">
      <div style="font-family:${SERIF};font-size:34px;font-weight:700;color:#FFFFFF;letter-spacing:-0.5px;line-height:1">Jewber</div>
      <div style="font-family:${SANS};font-size:13px;color:#C9D3FF;margin-top:6px;letter-spacing:.5px">Rides with friends. Closed on Shabbat.</div>
    </a>
  </td></tr>
  <tr><td bgcolor="${C.paper}" style="background:${C.paper};border-radius:0 0 24px 24px;padding:34px 32px 30px;border:1px solid ${C.line};border-top:0">
    ${body}
  </td></tr>
  <tr><td align="center" style="padding:20px 24px 0;font-family:${SANS};font-size:12px;line-height:1.6;color:${C.muted}">
    ${footer}<br><a href="${esc(url)}" style="color:${C.muted}">${esc(url.replace(/^https?:\/\//, ''))}</a>
  </td></tr>
</table></td></tr></table>
</body></html>`;
}

// Someone was added (or their ask to join got a yes).
function invite({ driver, name, email, url }) {
  const n = esc(name), d = esc(driver);
  const ps = pick([
    'P.S. Every 18th ride is on the house. Chai!',
    "P.S. The Bubbe ride is slower, but you'll be asked if you ate.",
    'P.S. You can tip in rugelach. I mean it.',
    'P.S. Chutzpah rides cut the line. Use responsibly.',
  ]);
  const html = shell({
    url,
    preheader: `${driver} added you to Jewber. Sign in with this email, no password needed.`,
    footer: `You got this because ${d} added you to Jewber.`,
    body: `
      ${kicker("You're in")}
      ${title(`Shalom, ${n}!`)}
      ${para(`${d} added you to <b style="color:${C.ink}">Jewber</b>, his ride app for friends. It's like Uber, except there's one driver, it closes for Shabbat, and you can pay in babka.`)}
      ${button('Open Jewber', url)}
      ${para(`Sign in with <b style="color:${C.ink}">${esc(email)}</b>. You'll get a 6-digit code, no password needed (you can set one later in Account, if you'd rather).`, `font-size:14px;color:${C.muted};margin-top:12px`)}
      ${stars}
      <h2 style="font-family:${SERIF};font-size:21px;font-weight:700;color:${C.ink};margin:0 0 12px">Put it on your phone</h2>
      ${para('One tap to open, and a ping when the car is on the way.', 'font-size:15px')}
      ${pills([['Android', `${url}/get#android`], ['iPhone', `${url}/get#iphone`]])}
      ${stars}
      <table role="presentation" cellpadding="0" cellspacing="0" border="0">
        ${bullet('Watch the car come to you, live, with the minutes counting down (and the same minutes in Jewish Standard Time).')}
        ${bullet('Pick your ride: Schlep, Mensch (carries your bags), Bubbe (asks if you ate), Chutzpah (cuts the line).')}
        ${bullet('Pay with PayPal, Cash App, Venmo, Zelle, cash, a babka, or a mitzvah.')}
      </table>
      ${para(esc(ps), `font-family:${SERIF};font-style:italic;font-size:15px;color:${C.muted};margin:14px 0 0`)}`,
  });
  const text = `Shalom, ${name}!

${driver} added you to Jewber, his ride app for friends. It's like Uber, except there's one driver, it closes for Shabbat, and you can pay in babka.

Open Jewber: ${url}
Sign in with ${email}. You'll get a 6-digit code, no password needed.

Put it on your phone:
Android: ${url}/get#android
iPhone: ${url}/get#iphone

${ps}
`;
  return { subject: `${driver} added you to Jewber`, text, html };
}

// The 6-digit sign-in code.
function code({ code: c, url }) {
  const digits = String(c).split('').map((x) => `<td align="center" width="46" style="width:46px;height:58px;border:2px solid ${C.blue};border-radius:12px;background:#FFFFFF;font-family:${SERIF};font-size:30px;font-weight:700;color:${C.ink}">${esc(x)}</td><td width="8" style="width:8px"></td>`).join('');
  const line = pick(['Six digits. Easier than finding parking.', 'Nu? Type it in.', 'Faster than a shul announcement.', 'No password. No kvetching.']);
  const html = shell({
    url,
    preheader: `${c} is your Jewber code. It works for 10 minutes.`,
    footer: "If you didn't ask for this code, you can ignore this email. Nobody gets in without it.",
    body: `
      ${kicker('Sign in')}
      ${title('Your code')}
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 20px"><tr>${digits}</tr></table>
      ${para('It works for 10 minutes. Type it into Jewber, or paste it.')}
      ${para(esc(line), `font-family:${SERIF};font-style:italic;font-size:15px;color:${C.muted};margin:0`)}`,
  });
  return { subject: `Your Jewber code: ${c}`, text: `${c}\n\nYour Jewber sign-in code. It works for 10 minutes.\n\n${url}\n`, html };
}

// The driver's nudge about the tab.
function nudge({ driver, name, owed, url }) {
  const d = esc(driver);
  const html = shell({
    url,
    preheader: `Your tab: ${owed}. ${driver} says hi.`,
    footer: `${d} sent you this from his ledger. Gently, like a Bubbe.`,
    body: `
      ${kicker('Your tab')}
      ${title(`Nu, ${esc(name)}?`)}
      ${para(`${d} says hi, and that there's a little something on your tab:`)}
      <div style="font-family:${SERIF};font-size:40px;font-weight:700;color:${C.ink};margin:4px 0 18px;line-height:1.1">${esc(owed)}</div>
      ${para('No rush. Well, a little rush.')}
      ${button('Pay it', url)}
      ${para('PayPal, Cash App, Venmo, Zelle or cash. A babka is also legal tender.', `font-size:14px;color:${C.muted};margin-top:12px`)}`,
  });
  return { subject: `A little nudge from ${driver}`, text: `${driver} says hi. Your tab: ${owed}.\n\nPay it here: ${url}\n`, html };
}

module.exports = { invite, code, nudge };
