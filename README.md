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

If those Google variables are empty, the phone offers **Try the sample account** instead. That account is shared sample data, labeled on the screen, so the phone can be tried before a Google client exists. A configured Google client hides that path.

Signing in again with the same Google account updates that row. It does not create a second user.

## Groups

Sign in. Choose **Create a group** and type a name. You are the first member. The group page shows the members, the active count, each join date, and an invite link.

Open that link while signed in as someone else. Choose **Join group**. A sixth person cannot join. The page says the group is full. Leave dates stay empty. Starting a challenge comes later, and it needs 3 to 5 active members.

## Check

```bash
npm test
```

The tests stand in for Google's token and userinfo endpoints. They check the redirect to Google, the account fields from `sub`, a second sign-in for the same `sub`, and sign-out.

Published copies use Postgres from `DATABASE_URL`. Local `npm start` uses embedded Postgres when that variable is unset. `npm run build` applies `migrations/` when it is set.
