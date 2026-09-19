# Yoto Static Audio Assets

These files are old development placeholders and should not be used in
production. The Yoto audio route now requires live TTS:

- `TTS_PROVIDER=elevenlabs`
- `ELEVENLABS_API_KEY=<your ElevenLabs key>`
- `ELEVENLABS_VOICE_ID=<optional voice id>`

If live TTS is not configured, the audio route returns `503` rather than
serving a silent placeholder that makes the card skip chapters.
