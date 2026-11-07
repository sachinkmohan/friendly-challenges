# Friendly challenges

Friends share a habit challenge. This app signs a person in with Google through Firebase Authentication and stores one account per Google ID.

## Run

The app stores its data in Cloud Firestore. Local runs use the Firestore emulator, which needs Java 11 or later. Run `npm install` first.

Sign-in goes through Firebase Authentication. There is no OAuth client and no redirect URI to register. Set it up once in the [Firebase console](https://console.firebase.google.com).

1. Open **Authentication > Sign-in method** and enable **Google**.
2. Open **Authentication > Settings > Authorized domains**. `localhost` is there by default. Add your site's domain when you host it.
3. Open **Project settings > General > Your apps** and add a Web app. Its config shows `apiKey` and `authDomain`.

Copy `.env.example` to `.env`. Set `FIREBASE_API_KEY` and `FIREBASE_AUTH_DOMAIN` from the Web app config, and `FIREBASE_PROJECT_ID` to the project ID. The app reads `.env` when that file is present. Without the first two, the sign-in screen says sign-in is not configured.

Then start the app on the emulator.

```bash
npm run dev
```

Open `http://localhost:3000`. Use `localhost`, not `127.0.0.1`, because only `localhost` is an authorized domain by default. Sign in with Google. A Google popup opens. The page then shows your name, email, and avatar. Sign out. The account stays. The session does not.

Signing in again with the same Google account updates that account. It does not create a second user.

The emulator starts empty each time, then loads the sample group.

## Host

On the host, `npm start` talks to a real Firestore database. Create a Firebase project with Firestore, create a service account key, and put the whole key JSON in `FIREBASE_SERVICE_ACCOUNT`. The project ID comes from that key. Set `FIREBASE_API_KEY` and `FIREBASE_AUTH_DOMAIN` too, and add the host's domain under **Authentication > Settings > Authorized domains**. `npm run build` loads the sample group into that database. Deploy `firestore.rules` with `firebase deploy --only firestore:rules` so no browser client can read or write. Only the server talks to Firestore.

## Netlify

`netlify.toml` sends every path to the function in `netlify/functions/app.ts`, which runs the same app. Set `FIREBASE_SERVICE_ACCOUNT`, `FIREBASE_API_KEY`, and `FIREBASE_AUTH_DOMAIN` in the site's environment variables, scoped to Functions and Builds. Add `<site>.netlify.app`, and any custom domain, under **Authentication > Settings > Authorized domains**.

## Groups

Sign in. Choose **Create a group** and type a name. You are the first member. The group page shows the members, the active count, each join date, and an invite link.

Open that link while signed in as someone else. Choose **Join group**. A sixth person cannot join. The page says the group is full.

On the group page, name the challenge, pick the type, the currency, and the stake per day. The stake is the amount in that currency, and the app stores the minor units. Each member picks how often they log and an anchor date. The choices are every day, every 2 days, every 3 days, and alternate days. **Start challenge** appears when 3 to 5 people are active. After the start, the shared terms stay as they are. A member who has not picked a rhythm can still save one. A saved rhythm stays put.

## Check-ins

After the start, each member with a rhythm sees a day picker and two buttons on the group card. **Kept it** saves the day green. **Missed it** saves it red. Saving the same day again replaces the color. The app accepts only a day the member is due by their rhythm, inside the challenge dates, and inside their membership. The card lists every saved check-in with the member, the day, and the color.

## Calendar and heatmap

After the start, the group card shows a calendar. Each row is a member. Each column is a day from the start date through today, or through the end date once the challenge is over. A due day is green or red when it has a check-in. A past due day with no check-in is red. A due day that is today or later with no check-in is an empty outline. A day the member is not due is a blank cell.

Home shows your own days for each active challenge in weekly columns, Sunday at the top. It uses the same rules and the same check-ins. Logging a day again changes both views. The server picks today by UTC date.

## Balances

After the start, the group card shows who owes whom. The app does not send money. Every red day on the calendar, including a past due day with no check-in, means the member who missed owes the per-day stake to each other member who was in the group that day. A green day owes nothing. There is no pot.

Between two people, the app nets the debts in both directions, then subtracts recorded payments. Each member's net is positive when others owe them and negative when they owe others. The nets add up to zero.

To record a payment you already made outside the app, choose **Paid to**, the amount in the challenge currency, the date, and an optional PayPal reference. Choose **Record payment**. The app never calls PayPal. The date cannot be in the future.

Nothing is stored as a running total. The app works out the balances from check-ins, membership dates, and payments each time the page loads. When you change a red day to green, that day's debts go away.

## Dropout

A member can leave. On the group card, pick the member and their last day, then choose **Record dropout**. You can record your own dropout. The person who made the group can record anyone's. The last day cannot be before the member joined or after today.

Debts on days through the last day stay. The member who left still owes for their misses on those days, and others still owe them for theirs. Days after the last day create no debts for that member in either direction. Their calendar row stays, with blank days after the last day, and they cannot log those days.

After a dropout the group can have fewer than 3 active members. The leaver no longer counts toward the cap of 5, so someone else can join.

## Sample

A new database loads one group named Pantry. Ada, Bea, and Cam share a no-sugar challenge. They log on different intervals. The days include green and red check-ins, and Ada has recorded one payment to Cam. `SAMPLE_OPEN_DEBT_MINOR` in `src/sample.ts` states the open debt in minor units. The balance on that group matches that number. Loading the sample again writes only the documents that are missing.

## Check

```bash
npm test
```

The tests run on the Firestore emulator, and each test opens an empty project of its own. They stand in for Firebase Authentication with a fake ID token verifier. They check the account fields from the Google `sub`, a second sign-in for the same `sub`, rejected tokens, a sign-in posted from another site, and sign-out.

```bash
npm run check:auth
```

This runs the real token check once against the Firebase Authentication emulator. It makes a Google user in the emulator, posts its ID token to the app, and checks that the home page shows that user.
