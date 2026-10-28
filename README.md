# TaskSpeck

TaskSpeck is a small marketplace for one-off jobs. A requester posts a task, Taskers make offers, and the requester picks who does the work. There is no booking fee. The payment is held until the job is done. Cancelling inside 24 hours of the start keeps a call-out fee for the Tasker and refunds the rest. A no-show is a full refund and the task can be matched again. Proof photos depend on the kind of job. The safety check blocks risky or licensed work. One account can post tasks and make offers.

## How to run the demo

The demo fills the app with sample people, sample tasks around inner Melbourne, offers, messages, and one finished job with a review. Payments are pretend. Nothing is charged.

On a Mac or Linux computer:

```bash
npm install
npm run demo
```

On Windows, double-click `start-demo.bat` in this folder. The first time, it installs the app. It then starts the demo and opens a browser at http://127.0.0.1:5173/ .

The sign-in screen lists the demo email addresses and the shared password. Each name says whether that person posts tasks, makes offers, or lives outside the launch area. A yellow Demo label shows wherever the sample data appears. A Demo payment note shows when a price is recorded. No real money moves.

The server listens on every network address on your computer, not only this machine. The terminal prints a second address such as http://192.168.1.20:5173/ . On a phone connected to the same Wi-Fi, type that address into the browser. Leave the terminal window open while you look around.

The demo keeps its sample data in `data/demo/`, separate from any account you create with `npm run dev`.

To run the automatic click-through checks (phone width and desktop width):

```bash
npm run test:e2e
```

## Run it yourself

```bash
npm install
npm test
npm run dev
```

Open http://127.0.0.1:5173 . Create an account with an email and a password (at least 8 characters), then log in. The same account has a Requester side and a Tasker side. The switch is at the top of the screen.

Data is saved in `data/store.json`, so it is still there after you restart. That file is not committed.

## What you can do

- **Sign up and log in.** Passwords are stored as a hash. You can edit your name, phone, suburb and short bio, and you can delete the account. Google and Apple sign-in are ready to add later. They stay off until their keys are set, so you do not need any API keys to run the app.
- **Ask a question before accepting.** From an offer, or from a task you might offer on, either person can send a message while the task is still open. If a message talks about swapping phone numbers or paying cash, the app shows a short warning. Keeping the job in TaskSpeck is what protects the payment.
- **Notifications.** New offers, bookings, the morning of the job, and payment updates are saved in the app. The same events are handed to an email and SMS sender. With no provider keys, that sender writes to the console and to `data/notifications.log`. Your notification switches still apply. A Tasker only hears about a new task when it fits the days, hours, distance, categories and pause switch on their availability. A saved search with alerts uses the same availability check.
- **The server follows the same steps as the screen.** Cancel, no-show, fix, dispute, refund and review are API calls. Each one checks who is logged in and which stage the task is in. A booked task cannot be published again. If accepting an offer fails, the screen says why and does not pretend the booking went through.
- **More than one task.** A requester can have several tasks at once. A Tasker can edit the price or message on a waiting offer, or withdraw it.
- **Where it is open.** Greater Melbourne suburbs are on the map, but posting and offering are limited to a launch circle. `LAUNCH_RADIUS_KM` defaults to **10**, measured from Melbourne CBD at Flinders Street and Swanston Street, so the inner suburbs are included. Change that number, or set `LAUNCH_EXTRA_SUBURBS` to a comma-separated list, when you want to open more places. Someone outside the circle can still create an account. They see “Coming soon to your area” and can join a waitlist (email and suburb). Signed-in members can download it at `/api/waitlist.csv`. Set `LAUNCH_ADMIN_KEY` if you want that download to require the header `x-admin-key`.
- **Any everyday job.** Categories cover cleaning, assembly, moving help, gardening, painting, handyman, errands and delivery, hard rubbish, pet care, tech help, admin and office help, and more, plus Other. Plant watering sits with gardening. You can ask for quotes or set a fixed price, including larger amounts, and you can split a fixed price into stages that stay held until that stage is done. Licensed work (electrical, gas, plumbing, building, roofing, asbestos, chemical pest control, air-conditioning, locksmithing, data cabling, and antenna installs) is still blocked, with a short note to use a licensed tradesperson or a registered cabler. Painting, handyman, assembly, and other jobs that are renovation or building work are also blocked when the price, quote, or stage total is over $10,000 (`REGISTERED_WORK_LIMIT_AUD` in `shared/registeredWork.js`). Those need a registered builder in Victoria.
- **Demo mode is off.** Sample Taskers such as Jordan and Sam are not shown unless you turn Demo mode on in Profile. The label says Demo wherever those samples appear.
- **Map and search.** Find Tasks is on the Tasker side. It starts with every open task in the 10 km launch zone. Distance, category and sort sit in Filters. The default is the whole zone, all categories, closest first, and those defaults do not show a chip or a badge. Choosing 2 km, 5 km or 10 km, a category, or another sort adds a chip you can remove. It has a list and a Leaflet / OpenStreetMap map (no API key). Pins are suburbs, not streets. You can save a search so you are told when a match is posted.
- **Share and export.** On a job record, create a share link or download a CSV. The share link and the CSV from that link leave out the street and unit. Your own CSV, while you are logged in, can still include the property name for your records.

## Email, SMS and later sign-in

Set these only if you want a real sender or a later sign-in provider. Leave them unset and the app keeps working.

| Variable | Purpose |
| --- | --- |
| `NOTIFY_PROVIDER` | `log` (default), `file`, `webhook`, `twilio`, or `smtp` |
| `NOTIFY_LOG_FILE` | Where log and file delivery are written. Default `data/notifications.log` |
| `NOTIFY_WEBHOOK_URL` | Used when `NOTIFY_PROVIDER=webhook` |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | Used when `NOTIFY_PROVIDER=twilio` and the channel is SMS |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Noted when `NOTIFY_PROVIDER=smtp`. Without a mail library the message is still written to the log |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Reserved for Google sign-in |
| `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` | Reserved for Apple sign-in |

SMS is off on a new account until you turn it on in notification settings and add a phone number. Email logging is on by default.

`TASKSPECK_DATA` can point the JSON store at another folder. That is what the tests use.
