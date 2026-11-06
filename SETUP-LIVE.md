# Turn on real logins

This is for the owner of TaskSpeck. You do not need to write code. The free demo on GitHub Pages stays as it is. Real accounts start only after you add two values from Supabase.

Supabase is the place that stores accounts and the shared job list. The app uses the free plan.

## 1. Create a free Supabase account

1. Open [https://supabase.com](https://supabase.com).
2. Click **Start your project** (or **Sign in** if you already have an account).
3. Sign up with your email. Confirm the email if they send you one.

## 2. Create a project

1. Click **New project**.
2. Pick the organisation they made for you.
3. Name the project `TaskSpeck`.
4. Choose a database password. Write it down somewhere safe, such as a password manager. You do not put this password in the TaskSpeck folder.
5. Choose a region close to Melbourne, such as Sydney, if you see a list.
6. Click **Create new project** and wait until it finishes. This can take a minute.

## 3. Run the database setup

1. In the left menu, click **SQL Editor**.
2. Click **New query**.
3. On your computer, open the file `supabase/migrations/20261106120000_init.sql` in the TaskSpeck folder.
4. Select everything in that file, copy it, and paste it into the SQL editor.
5. Click **Run**.
6. You should see a success message. If the only complaint is about storage, go to **Storage**, create a private bucket named `job-photos`, then click **Run** on the same SQL again.

That SQL creates the tables and the privacy rules. People can edit only their own profile. Logged-in people can see jobs inside 10 km of Melbourne CBD. Phone numbers and the street address stay hidden until a job is booked, and only the customer and the booked Tasker can see them. After the job is done, the phone number is hidden again. Chat is only for the two people on that job. Reports can be filed, not edited.

You do not need to change the 10 km zone, the $10,000 building limit, or the 15% fee. Those are already set. The fee is 15% of the whole amount the Tasker is paid, including materials.

## 4. Turn on email sign-in

1. In the left menu, click **Authentication**, then **Providers** (sometimes labelled **Sign In / Providers**).
2. Open **Email**.
3. Make sure email sign-in is enabled. Leave **Confirm email** on if you want people to click a link before they can use a password. Magic links work with the email provider as well.
4. Save if there is a save button.

Phone codes are already built into the app. They start working after you also turn on the **Phone** provider and add the SMS details Supabase asks for. Until then, people can use email.

## 5. Copy the project URL and the anon key

1. Click the gear icon, **Project Settings**.
2. Click **API** (or **Data API**).
3. Copy the **Project URL**. It looks like `https://abcdefgh.supabase.co`.
4. Copy the **anon public** key. It is a long public key. It is safe to put in the app.
5. Do not copy the **service_role** key. That one is a secret. It must not go in the app, in `.env`, or in GitHub.

## 6. Put the two values on your computer

1. In the TaskSpeck folder, duplicate the file `.env.example` and name the copy `.env`.
2. Open `.env` in a text editor.
3. Paste the project URL after `VITE_SUPABASE_URL=`.
4. Paste the anon key after `VITE_SUPABASE_ANON_KEY=`.
5. Do not put quotes around them and do not leave a space before the value.
6. Save the file. Do not commit `.env`. It is already ignored by git.

Example shape (these values are not real):

```
VITE_SUPABASE_URL=https://abcdefgh.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...your-anon-key
```

## 7. Start the app

1. Open a terminal in the TaskSpeck folder.
2. Run `npm install` the first time.
3. Run `npm run dev`.
4. Open http://127.0.0.1:5173 .
5. You should see **Welcome back**, with Password, Email link, and Phone code. You should not land in the app as Maya.
6. Create an account, then fill in your name, suburb, and whether you want to post jobs, offer to help, or both.

If those two lines in `.env` are empty, the app stays in demo mode: no login, Maya first, data saved on that phone.

## 8. Later, when you host it for real

The GitHub Pages demo should keep those two values unset, so friends still get the no-login sample.

When you put the real app on a host (Netlify, Vercel, Cloudflare, or similar):

1. Open the host's settings for environment variables.
2. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` with the same two values.
3. Rebuild and publish.

The host bakes those values in at build time. Changing them later means building again.

In Supabase, under **Authentication** then **URL configuration**, add your real website address so email links send people back to the right place.
