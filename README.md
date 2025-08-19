# Lydia AI – Conversational Avatar (Vercel)

A static site + one Vercel Serverless Function that lets users talk to your ElevenLabs Conversational Agent via a Matrix-style Three.js avatar.

## Quick Start
1. Push this folder to a Git repo and import it into **Vercel**.
2. In Vercel → *Settings* → *Environment Variables*, set:
   - `ELEVENLABS_API_KEY` = your XI API key
3. Deploy. Open your site and click **Start** to talk to Lydia.

### Do I need an ElevenLabs API key?
**Yes.** The serverless function needs it to mint a **signed WebSocket URL** for your (private) agent. The browser will then connect directly to ElevenLabs using that signed URL. Keep your key server-side only.

### Agent ID
This build is hard-wired to Lydia’s agent:
```
agent_9901k319scqeftdt2x9nb1ht8p6j
```
You can change it in:
- `api/signed-url.js` (DEFAULT_AGENT_ID)
- `public/app.js` (DEFAULT_AGENT_ID)

### Local Dev
Install the Vercel CLI and run:
```
npm install -g vercel
vercel dev
```
Open http://localhost:3000

### Notes
- Microphone works only on secure origins (HTTPS) or localhost.
- Push-to-talk: hold the **Space** bar to speak.
- You can customize the avatar in `public/app.js` (Three.js section).
