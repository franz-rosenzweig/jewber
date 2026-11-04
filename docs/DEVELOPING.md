# Running your own

Jewber is one Node program with no dependencies (Node 22 or newer), a folder for its state, and the page. If you want your own, this is everything.

## The files

| | |
|---|---|
| `server.js` | the whole server: sign-in, rides, payments, the ledger, profiles and reviews, live updates (server-sent events), and the page |
| `lib/geo.js` | routes (OSRM) and address search (Photon), spaced and cached |
| `lib/shabbat.js` | the Shabbat and Yom Tov closings, the holidays and the parsha (Hebcal) |
| `lib/rules.js` | the ride types, ways to pay, statuses, brachot, kvetches, compliments and profile choices |
| `lib/paypal.js` | PayPal Checkout (Orders v2): orders, capture, refunds |
| `lib/mail.js`, `lib/push.js` | email over SMTP, and web push, with no dependencies |
| `lib/store.js` | the state, one JSON file written safely |
| `web/` | the page: `app.js`, `app.css`, MapLibre, the service worker, the icons |
| `android/` | the Android app (Java, no AndroidX) and `release.sh` |
| `deploy/` | a systemd unit to copy and fill in, and the deploy script |
| `tools/` | the tests |

## Running it

```bash
node server.js driver you@example.com Yourname     # who drives (with the server stopped)
node server.js friend friend@example.com Avi       # let a friend in (or add them later in the ledger)
node server.js                                     # serve
```

The settings are environment variables:

| | |
|---|---|
| `JEWBER_STATE` | the state folder (default `./state`): `state.json`, `mail.json`, `vapid.json`, `photos/`, `dist/` |
| `JEWBER_PORT`, `JEWBER_HOSTS` | where it listens (default 8525 on 127.0.0.1; more addresses comma-separated) |
| `JEWBER_URL` | the public address, for emails, PayPal's way back and links |
| `JEWBER_PAYPAL_ENV` | an env file with `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` (or put `paypal.json` in the state folder) |
| `JEWBER_NOTIFY` | a script that pings the driver for requests, called as `NOTIFY TITLE MESSAGE now` |

Email needs `mail.json` in the state folder (`host`, `port`, `user`, `pass`, `from`) for any SMTP server. Without it, sign-in codes can't go out.

Put it behind a tunnel or a reverse proxy with HTTPS, since phones only share location and get notifications on a secure address. The server sends `private, no-cache` on everything, so a proxy like Cloudflare doesn't keep old copies.

## Deploying

The unit in `deploy/` runs Jewber from its own detached worktree, which means working on the code never touches the running app. `deploy/deploy.sh` moves that worktree to a commit and restarts the service:

```bash
git worktree add --detach ../jewber-live     # once
deploy/deploy.sh                             # HEAD, or a commit
```

## Releasing the Android app

Raise `versionCode` and `versionName` in `android/app/build.gradle`, then:

```bash
JEWBER_STATE=/path/to/state android/release.sh
```

It signs with the key in the state folder (`android/keystore.properties`), so back that up. Without it, phones can't update and would have to uninstall first. The APK goes to `dist/`, where the site serves it at `/Jewber.apk` and `/apk/`. Then make a GitHub release with the APK attached, for Obtainium.

## The tests

```bash
node tools/e2e.js              # a whole ride and everything around it, through the API
node tools/paypal-check.js     # PayPal against a pretend PayPal
node tools/walk.js OUT         # the real page in headless Chrome: two phones, a simulated drive with the voice, screenshots
node tools/android-check.js APK OUT   # the Android app on an emulator; build it with -PjewberUrl=http://10.0.2.2:8526
```

Every test runs its own throwaway server with email going to a file, so none of them ever touch a real one. `tools/webkit-check.py` runs the friends' screens in WebKit at iPhone size.
