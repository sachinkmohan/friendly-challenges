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

Open that link while signed in as someone else. Choose **Join group**. A sixth person cannot join. The page says the group is full. Leave dates stay empty. Starting a challenge comes later, and it needs 3 to 5 active members.

## Check

```bash
npm test
```

The tests stand in for Google's token and userinfo endpoints. They check the redirect to Google, the account fields from `sub`, a second sign-in for the same `sub`, and sign-out.
