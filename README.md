# Friendly challenges

Friends share a habit challenge. This app signs a person in with Google and stores one account per Google ID.

## Run

Copy `.env.example` to `.env` and fill in the Google OAuth client. `npm start` reads `.env` when that file is present. In the Google client, register this redirect URI.

`http://127.0.0.1:3000/auth/google/callback`

Then start the app.

```bash
npm start
```

Open `http://127.0.0.1:3000`. Sign in with Google. The page shows your name, email, and avatar. Sign out. The account row stays. The session does not.

Signing in again with the same Google account updates that row. It does not create a second user.

## Groups

Sign in. Choose **Create a group** and type a name. You are the first member. The group page shows the members, the active count, each join date, and an invite link.

Open that link while signed in as someone else. Choose **Join group**. A sixth person cannot join. The page says the group is full. Leave dates stay empty.

On the group page, name the challenge, pick the type, the currency, and the stake per day. The stake is the amount in that currency, and the app stores the minor units. Each member picks how often they log and an anchor date. The choices are every day, every 2 days, every 3 days, and alternate days. **Start challenge** appears when 3 to 5 people are active. After the start, the shared terms stay as they are. A member who has not picked a rhythm can still save one. A saved rhythm stays put.

## Check-ins

After the start, each member with a rhythm sees a day picker and two buttons on the group card. **Kept it** saves the day green. **Missed it** saves it red. Saving the same day again replaces the color. The app accepts only a day the member is due by their rhythm, inside the challenge dates, and inside their membership. The card lists every saved check-in with the member, the day, and the color.

## Calendar and heatmap

After the start, the group card shows a calendar. Each row is a member. Each column is a day from the start date through today, or through the end date once the challenge is over. A due day is green or red when it has a check-in. A past due day with no check-in is red. A due day that is today or later with no check-in is an empty outline. A day the member is not due is a blank cell.

Home shows your own days for each active challenge in weekly columns, Sunday at the top. It uses the same rules and the same check-ins. Logging a day again changes both views. The server picks today by UTC date.

## Check

```bash
npm test
```

The tests stand in for Google's token and userinfo endpoints. They check the redirect to Google, the account fields from `sub`, a second sign-in for the same `sub`, and sign-out.
