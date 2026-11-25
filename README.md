# Lyrical Editor Plus

A browser-based editor for creating, syncing, and exporting lyrics and subtitles. Load a media file to sync lines by hand, transcribe with Gemini, or add word timings to lyrics you already have.

## What it does

- **Edit and sync:** Work with LRC, SRT, VTT, TTML, YouTube SRV, JSON, and plain-text files. Play audio or video alongside your lyrics and adjust cue and word timings.
- **Transcribe with AI:** Turn audio or video into line-level or word-level lyrics.
- **Align existing lyrics:** In the media panel, choose **Align Existing Lyrics** to time the words in your current cues against the loaded audio. It preserves lyric text and line timings; review the results in Word view before exporting. Existing word timings require confirmation before they are replaced.
- **Generate or refine lyrics:** Use the AI Assistant to generate lyrics or request text changes such as translation and proofreading.
- **Edit precisely:** Use undo/redo, keyboard shortcuts, timing adjustments, and tools for managing word timings.

## Export

Export standard subtitles as **LRC, SRT, VTT, TTML**, or **YouTube SRV**. Word-timed lyrics can be exported as **Enhanced LRC**, **karaoke VTT**, **karaoke TTML**, or **YouTube SRV words**. Structured JSON and plain text exports are also available.

## Run locally

Requires Node.js and npm.

```bash
git clone https://github.com/ATECCA/lyricaleditorplus.git
cd lyricaleditorplus
npm install
cp .env.example .env
```

Add your Gemini API key to `.env`:

```env
GEMINI_API_KEY=your_google_api_key
```

Start the development server:

```bash
npm run dev
```

Vite serves the app at `http://localhost:3000`.

## AI and media privacy

AI features require a Google Gemini API key. Using transcription or word alignment sends the selected media and, for alignment, the existing lyrics to Gemini. Files of 15 MB or more are uploaded to Gemini's Files API and the app attempts to delete those temporary uploads after processing. The app limits media files to 500 MB.

For public deployments, do not bundle a shared API key in the browser app. Use a protected server-side proxy or have each user provide their own key.

## License

MIT
