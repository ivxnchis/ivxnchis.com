#!/usr/bin/env node
/* One-time Spotify sign-in for the Now Playing widget.

   Run it on your own computer:   node scripts/spotify-auth.mjs
   It asks for your Spotify app's client ID and secret, opens Spotify's
   approval page, and prints the refresh token the Worker needs. Add all
   three as secrets on the ivxnchis Worker in the Cloudflare dashboard.

   With --dev-vars it also writes them to .dev.vars (git-ignored) so
   `npx wrangler dev` can use them locally.

   The Spotify app needs this redirect URI: http://127.0.0.1:8888/callback */

import http from 'node:http';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { execFile } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const PORT = 8888;
const REDIRECT_URI = `http://127.0.0.1:${PORT}/callback`;
const SCOPES = 'user-read-currently-playing user-read-recently-played';

function ask(question, hidden) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    if (hidden) {
      // print the question ourselves, then echo nothing while the secret is typed
      process.stdout.write(question);
      rl._writeToOutput = () => {};
    }
    rl.question(hidden ? '' : question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

const clientId = process.env.SPOTIFY_CLIENT_ID || await ask('Spotify client ID: ');
const clientSecret = process.env.SPOTIFY_CLIENT_SECRET || await ask('Spotify client secret (hidden): ', true);
if (!clientId || !clientSecret) {
  console.error('Both the client ID and the client secret are needed.');
  process.exit(1);
}

const state = crypto.randomBytes(16).toString('hex');
const authorizeUrl = 'https://accounts.spotify.com/authorize?' + new URLSearchParams({
  response_type: 'code',
  client_id: clientId,
  scope: SCOPES,
  redirect_uri: REDIRECT_URI,
  state
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT_URI);
  if (url.pathname !== '/callback') { res.writeHead(404).end(); return; }

  const finish = (status, message) => {
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }).end(message);
    server.close();
  };
  if (url.searchParams.get('state') !== state) return finish(400, 'State did not match. Run the script again.');
  if (url.searchParams.get('error')) return finish(400, 'Spotify said: ' + url.searchParams.get('error'));

  const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(clientId + ':' + clientSecret).toString('base64')
    },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: url.searchParams.get('code'), redirect_uri: REDIRECT_URI })
  });
  const data = await tokenRes.json();
  if (!tokenRes.ok || !data.refresh_token) {
    console.error('\nSpotify did not return a refresh token:', data.error_description || data.error || tokenRes.status);
    return finish(500, 'Something went wrong. Check the terminal.');
  }

  console.log('\nDone. Add these three secrets to the ivxnchis Worker in Cloudflare');
  console.log('(Workers & Pages → ivxnchis → Settings → Variables and Secrets → Add, type "Secret"):\n');
  console.log('  SPOTIFY_CLIENT_ID      ' + clientId);
  console.log('  SPOTIFY_CLIENT_SECRET  (the client secret you just typed)');
  console.log('  SPOTIFY_REFRESH_TOKEN  ' + data.refresh_token + '\n');

  if (process.argv.includes('--dev-vars')) {
    writeFileSync('.dev.vars',
      `SPOTIFY_CLIENT_ID=${clientId}\nSPOTIFY_CLIENT_SECRET=${clientSecret}\nSPOTIFY_REFRESH_TOKEN=${data.refresh_token}\n`,
      { mode: 0o600 });
    console.log('Also wrote them to .dev.vars for `npx wrangler dev`.\n');
  }
  finish(200, 'Spotify is connected. You can close this tab and go back to the terminal.');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('\nOpening Spotify to approve access. If no browser opens, visit:\n\n' + authorizeUrl + '\n');
  if (process.platform === 'darwin') execFile('open', [authorizeUrl]);
});
