# Launch checklist

Everything is free for now: with no Stripe keys set, every account gets every
feature, and nothing on the site mentions plans or prices. These are the steps
to put Shohmot live and start getting users.

## 1. Deploy (Vercel)

- [ ] Import the GitHub repo in Vercel (framework: Astro; the build settings come from `vercel.json`).
- [ ] **Database:**
  1. Make a free Redis database at [console.upstash.com](https://console.upstash.com).
  2. From its "REST API" section, copy the URL and token into Vercel → Project → Settings → Environment Variables as `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. Tick Production and Preview.
  3. Redeploy.

  Connecting an Upstash store from Vercel's Storage or Marketplace also works; Shohmot finds the variables whatever they're named.
- [ ] Add a custom domain, then set `SITE_URL` to it.
- [ ] Set the env vars in `.env.example` under "Needed to launch", then redeploy. `PUBLIC_*` values are read at build time, so a redeploy is required.
- [ ] Open `https://your-domain/api/health`. It should show `"db": true` and `"mail": true`.
- [ ] Check that all API routes run from the one function `api/[route].js`. In the Vercel dashboard → Functions, there should be a single function.

## 2. Email

- [ ] **No domain yet: Gmail.**
  1. On the Google account you'll send from, turn on 2-Step Verification.
  2. Make an app password at [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords).
  3. Set `GMAIL_USER` (the address) and `GMAIL_APP_PASSWORD` (the 16 letters).

  Gmail allows about 500 emails a day.
- [ ] **Later, with a domain: Resend.** Create a Resend account, verify the domain (DNS records), and create an API key. Set `RESEND_API_KEY` and `MAIL_FROM`. Resend is used over Gmail once its key is set.
- [ ] Sign up on the live site with your own email. The confirmation email should arrive (check spam too).
- [ ] Try "Forgot it?" on the sign-in page. The reset link should work once and sign you out everywhere else.
- [ ] The weekly recap goes out Mondays from the daily cron (`vercel.json` → `crons`). Check Vercel → Cron Jobs to see it listed. `CRON_SECRET` must be set.

## 3. Check it yourself

- [ ] Signed out: open /demo.html (it works even before the database is connected); review a game by pasting a Lichess link and a Chess.com PGN; make a share image; open the analysis board.
- [ ] Signed in: add your accounts, play a game with the counter open, and check that the "what to work on" card appears. Train the position.
- [ ] Open Brilliants and let the scan run on your accounts. Note how long it takes; heavy Lichess accounts are slowest.
- [ ] Coach: in Settings → Coach → Start coaching, send the link to a second account, and check that it shows up on /coach.html.
- [ ] **Your admin login:** set `ADMIN_EMAILS` to your email and `ADMIN_PASSWORD` to a long password, then redeploy.
  - Signing in with those creates the account; no sign-up is needed.
  - Change the password in Settings afterwards. `ADMIN_PASSWORD` only creates the account once, and you can then remove it.
  - Or run `npm run seed -- you@example.com "Your Name" 'password'` with the Upstash variables set locally.
  - Then open /admin.html.
- [ ] Settings → Download my data, then delete a test account.
- [ ] On a phone: install it ("Add to Home Screen"), and check the counter and Training.

## 4. Before inviting people

- [ ] Read the Privacy policy and Terms (`web/pages/privacy.astro`, `terms.astro`) and make sure they match how you run things. Set `PUBLIC_OPERATOR_NAME` and `PUBLIC_GOVERNING_LAW`. A lawyer's look is worth it before you take payments.
- [ ] Read the Chess.com and Lichess API terms for anything about apps built on their data, and use a contact email in the `User-Agent` in `src/games.js` if they ask for one.
- [ ] Add an uptime monitor (UptimeRobot or Better Stack, both free) on `/api/health`.
- [ ] Keep an eye on Upstash usage after launch. The free tier has a monthly request limit.

## 5. Getting users

- [ ] Share review images and brilliant moves on r/chess, chess Discords and Twitter/X; every image carries the site's address.
- [ ] Offer chess coaches and clubs the coach dashboard: one coach brings all their students.
- [ ] Submit `https://your-domain/sitemap.xml` in Google Search Console. The free game review and analysis board pages are built to be found by searches like "free chess game review".
- [ ] Watch /admin.html: visitors → sign-ups → chess account added → review finished. Work on the step where most people drop off.

## Later: paid plans

When there are users who come back every week:

1. Create Pro and Coach prices in Stripe.
2. Set the `STRIPE_*` env vars and add a webhook to `https://your-domain/api/stripe-webhook` (events: `checkout.session.completed`, `customer.subscription.*`).
3. Build the pricing page. The Upgrade button and the limits switch on by themselves once billing is set up.
