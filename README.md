# TaskSpeck

TaskSpeck is a small marketplace for one-off jobs. A requester posts a task, Taskers make offers, and the requester picks who does the work. There is no booking fee. The payment is held until the job is done. Cancelling inside 24 hours of the start keeps a call-out fee for the Tasker and refunds the rest. A no-show is a full refund and the task can be matched again. Proof photos depend on the kind of job. The safety check blocks risky or licensed work. One account can post tasks and make offers.

## Run it

```bash
npm install
npm test
npm run dev
```

Open http://localhost:5173 . Create an account with an email and a password (at least 8 characters), then log in. The same account has a Requester side and a Tasker side. The switch is at the top of the screen.

Data is saved in `data/store.json`, so it is still there after you restart. That file is not committed.

## What you can do

- **Sign up and log in.** Passwords are stored as a hash. You can edit your name, phone, suburb and short bio, and you can delete the account. Google and Apple sign-in are ready to add later. They stay off until their keys are set, so you do not need any API keys to run the app.
- **Ask a question before accepting.** From an offer, or from a task you might offer on, either person can send a message while the task is still open. If a message talks about swapping phone numbers or paying cash, the app shows a short warning. Keeping the job in TaskSpeck is what protects the payment.
- **Notifications.** New offers, bookings, the morning of the job, and payment updates are saved in the app. The same events are handed to an email and SMS sender. With no provider keys, that sender writes to the console and to `data/notifications.log`. Your notification switches still apply. A Tasker only hears about a new task when it fits the days, hours, distance, categories and pause switch on their availability. A saved search with alerts uses the same availability check.
- **The server follows the same steps as the screen.** Cancel, no-show, fix, dispute, refund and review are API calls. Each one checks who is logged in and which stage the task is in. A booked task cannot be published again. If accepting an offer fails, the screen says why and does not pretend the booking went through.
- **More than one task.** A requester can have several tasks at once. A Tasker can edit the price or message on a waiting offer, or withdraw it.
- **Map and search.** Find Tasks has a list and a real map (Leaflet and OpenStreetMap, no API key). Pins show the suburb, not the street. You can sort by distance or price, and you can save a search so you are told when a match is posted.
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
