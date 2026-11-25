import { GoogleGenAI, Type } from "@google/genai";
import { Cue } from '../types';
import { msToVtt, timeToMs } from '../utils/timeUtils';

// Helper to get the Gemini client using either the user's Settings key or env key
const getAiClient = () => {
  const savedKey =
    typeof window !== 'undefined'
      ? localStorage.getItem('gemini_api_key') ||
        localStorage.getItem('GEMINI_API_KEY') ||
        localStorage.getItem('apiKey')
      : null;
  const apiKey = savedKey || process.env.API_KEY || '';
  return new GoogleGenAI({ apiKey });
};

/**
 * Helper to convert small files (< 15MB) to inline base64 for fast processing
 */
export const fileToPart = async (
  file: File
): Promise<{ inlineData: { data: string; mimeType: string } }> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      const base64Data = result.split(',')[1];
      resolve({
        inlineData: {
          data: base64Data,
          mimeType: file.type || 'audio/mp3',
        },
      });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

export interface TranscriptionOptions {
  model: string;
  mode: 'lines' | 'words';
}

/**
 * Helper to safely parse timestamps from AI response
 */
const parseAiTimestamp = (val: any): number => {
  if (typeof val === 'number') return Math.round(val);
  if (typeof val === 'string') {
    return timeToMs(val);
  }
  return 0;
};

/**
 * Automatically maps outdated UI dropdown model IDs to active frontier models
 */
const resolveModelId = (requestedModel?: string): string => {
  if (!requestedModel || requestedModel === 'gemini-2.5-flash') {
    return 'gemini-3.8-flash';
  }
  if (
    requestedModel === 'gemini-3.0-flash' ||
    requestedModel === 'gemini-3-flash-preview'
  ) {
    return 'gemini-4-hydrogen';
  }
  if (
    requestedModel === 'gemini-3.0-pro' ||
    requestedModel === 'gemini-3-pro-preview'
  ) {
    return 'gemini-4-argon';
  }
  return requestedModel;
};

export const transcribeAudio = async (
  file: File,
  options: TranscriptionOptions,
  signal?: AbortSignal
): Promise<Cue[]> => {
  // Support files up to 500MB (Gemini Files API supports up to 2GB)
  const MAX_FILE_SIZE = 500 * 1024 * 1024;
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(
      'File size exceeds 500MB limit. Please compress or split the audio file.'
    );
  }

  const ai = getAiClient();
  const modelName = resolveModelId(options.model);
  const isWordsMode = options.mode === 'words';

  let audioContentPart: any;
  let uploadedFileName: string | null = null;

  // Use Gemini Files API for files >= 15MB (50MB+ WAV/FLAC files) to prevent browser memory crashes
  if (file.size >= 15 * 1024 * 1024) {
    const uploadResult = await ai.files.upload({
      file: file,
      config: { mimeType: file.type || 'audio/mp3' },
    });

    uploadedFileName = uploadResult.name;
    audioContentPart = {
      fileData: {
        fileUri: uploadResult.uri,
        mimeType: uploadResult.mimeType || file.type || 'audio/mp3',
      },
    };
  } else {
    audioContentPart = await fileToPart(file);
  }

  const timingInstructions = `
    CRITICAL TIMING INSTRUCTIONS:
    1. Timestamps MUST be in 'MM:SS.mmm' format (e.g., 00:01.500 for 1.5s, 01:23.456 for 83.456s).
    2. Use "HH:MM:SS.mmm" for durations longer than an hour.
    3. Do NOT use integer milliseconds.
    4. Timestamps are ABSOLUTE from file start (00:00.000).
    5. INSTRUMENTAL BREAKS & GAPS: 
       - When music plays without vocals (solos, intros, bridges), do NOT generate text.
       - CRITICAL: When vocals resume, the timestamp MUST jump forward to match the actual elapsed time.
       - Example: If vocals stop at 01:00.000 and resume after a 20s solo, the next timestamp must be ~01:20.000.
  `;

  const commonRules = `
    TRANSCRIPTION RULES:
    1. STRICT VERBATIM & REPETITIONS (CRITICAL):
       - You MUST transcribe EVERY repetition of a line, phrase, or chorus EXACTLY as heard.
       - NEVER summarize repetitions. (e.g. DO NOT write "Chorus x2" or "...").
       - If a line is sung 4 times, output 4 separate cues with their distinct timestamps.
       - Skipping repeated lines causes critical timing errors for the rest of the song.
       
    2. SONG STRUCTURE:
       - This audio likely contains music. Expect instrumental sections.
       - Do NOT hallucinate text during instrumental breaks.
       
    3. FILLERS: 
       - Exclude non-lyrical fillers like "um", "ah", or coughing, unless they are intentional stylistic vocalizations (like ad-libs in rap/pop).
       
    4. COMPLETENESS:
       - Ensure the transcription covers the audio from start to finish.
  `;

  const wordLevelInstructions = `
    WORD-LEVEL KARAOKE PRECISION (CRITICAL):
    1. ALIGNMENT: Align the start and end of EACH word precisely to the audio waveform.
    2. DURATION: Do NOT evenly distribute word durations. Fast words must have short durations.
    3. SILENCE: If there is a pause between words, the previous word's 'end' must NOT equal the next word's 'start'. Leave a gap.
    4. ACCURACY: Do not estimate. Listen to the phonemes.
  `;

  const prompt = isWordsMode
    ? `Transcribe audio to lyrics (JSON) with high-precision word-level timestamps.
       ${wordLevelInstructions}
       Format: Array of cues (lines).
       EACH CUE MUST HAVE A "words" ARRAY.
       Word Schema: { text: string, start: string (MM:SS.mmm), end: string (MM:SS.mmm) }
       ${timingInstructions}
       ${commonRules}`
    : `Transcribe audio to lyrics (JSON).
       Format: Array of cues (lines).
       Cue Schema: { text: string, start: string (MM:SS.mmm), end: string (MM:SS.mmm) }
       ${timingInstructions}
       ${commonRules}`;

  const wordSchema = {
    type: Type.OBJECT,
    properties: {
      text: { type: Type.STRING },
      start: { type: Type.STRING },
      end: { type: Type.STRING },
    },
    required: ['text', 'start', 'end'],
  };

  const cueSchema = {
    type: Type.OBJECT,
    properties: {
      text: { type: Type.STRING },
      start: { type: Type.STRING },
      end: { type: Type.STRING },
      words: {
        type: Type.ARRAY,
        items: wordSchema,
      },
    },
    required: isWordsMode
      ? ['text', 'start', 'end', 'words']
      : ['text', 'start', 'end'],
  };

  const responseSchema = {
    type: Type.ARRAY,
    items: cueSchema,
  };

  try {
    const generateReq = ai.models.generateContent({
      model: modelName,
      contents: {
        parts: [audioContentPart, { text: prompt }],
      },
      config: {
        responseMimeType: 'application/json',
        responseSchema: responseSchema,
        temperature: 0.0,
        topP: 0.8,
      },
    });

    let response;

    if (signal) {
      const abortPromise = new Promise<never>((_, reject) => {
        const handleAbort = () =>
          reject(new DOMException('Aborted', 'AbortError'));
        if (signal.aborted) handleAbort();
        else signal.addEventListener('abort', handleAbort);
      });
      response = await Promise.race([generateReq, abortPromise]);
    } else {
      response = await generateReq;
    }

    if (response.text) {
      const rawCues = JSON.parse(response.text);
      return rawCues.map((c: any, index: number) => ({
        id: `ai-${index}-${Date.now()}`,
        start: parseAiTimestamp(c.start),
        end: parseAiTimestamp(c.end),
        text: c.text || '',
        words: c.words
          ? c.words.map((w: any, wi: number) => ({
              id: `ai-w-${index}-${wi}`,
              text: w.text,
              start: parseAiTimestamp(w.start),
              end: parseAiTimestamp(w.end),
            }))
          : undefined,
      }));
    }
    return [];
  } catch (error: any) {
    if (error.name === 'AbortError' || (signal && signal.aborted)) {
      throw new Error('Transcription cancelled by user.');
    }
    console.error('Transcription failed', error);
    throw error;
  } finally {
    // Clean up uploaded large file from Google servers
    if (uploadedFileName) {
      try {
        await ai.files.delete({ name: uploadedFileName });
      } catch (cleanupErr) {
        console.warn('Could not delete temporary uploaded file:', cleanupErr);
      }
    }
  }
};

export const alignLyricsToAudio = async (
  file: File,
  cues: Cue[],
  model: string,
  signal?: AbortSignal
): Promise<Cue[]> => {
  const MAX_FILE_SIZE = 500 * 1024 * 1024;
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(
      'File size exceeds 500MB limit. Please compress or split the audio file.'
    );
  }

  const alignableCues = cues.filter((cue) => cue.text.trim());
  if (alignableCues.length === 0) {
    throw new Error('There are no lyrics to align.');
  }

  const ai = getAiClient();
  const modelName = resolveModelId(model);
  let audioContentPart: any;
  let uploadedFileName: string | null = null;

  try {
    if (file.size >= 15 * 1024 * 1024) {
      const uploadResult = await ai.files.upload({
        file,
        config: { mimeType: file.type || 'audio/mp3' },
      });

      uploadedFileName = uploadResult.name;
      audioContentPart = {
        fileData: {
          fileUri: uploadResult.uri,
          mimeType: uploadResult.mimeType || file.type || 'audio/mp3',
        },
      };
    } else {
      audioContentPart = await fileToPart(file);
    }

    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const wordSchema = {
      type: Type.OBJECT,
      properties: {
        text: { type: Type.STRING },
        start: { type: Type.STRING },
        end: { type: Type.STRING },
      },
      required: ['text', 'start', 'end'],
    };
    const cueSchema = {
      type: Type.OBJECT,
      properties: {
        index: { type: Type.NUMBER },
        words: { type: Type.ARRAY, items: wordSchema },
      },
      required: ['index', 'words'],
    };

    const lyricInput = alignableCues.map((cue, index) => ({
      index,
      start: msToVtt(cue.start),
      end: msToVtt(cue.end),
      text: cue.text,
    }));
    const request = ai.models.generateContent({
      model: modelName,
      contents: {
        parts: [
          audioContentPart,
          {
            text: `Align the supplied existing lyrics to this audio. Do not transcribe, rewrite, translate, omit, or reorder lyrics. Return exactly one result per input line, in the same order. For each line, split its exact text into words and provide each word's absolute start and end timestamp in MM:SS.mmm format (use HH:MM:SS.mmm after one hour). Use the supplied line times as a guide, but listen to the audio for each word boundary. Do not evenly distribute words. Leave gaps for pauses. Keep punctuation attached to its word. Return only JSON matching the schema.\n\nExisting lines:\n${JSON.stringify(lyricInput)}`,
          },
        ],
      },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: cueSchema,
        },
        temperature: 0,
      },
    });

    const response = signal
      ? await new Promise<Awaited<typeof request>>((resolve, reject) => {
          const handleAbort = () =>
            reject(new DOMException('Aborted', 'AbortError'));
          signal.addEventListener('abort', handleAbort, { once: true });
          request.then(resolve, reject).finally(() =>
            signal.removeEventListener('abort', handleAbort)
          );
        })
      : await request;

    if (!response.text) {
      throw new Error('The AI returned no word timings.');
    }

    const alignedResults: unknown = JSON.parse(response.text);
    if (
      !Array.isArray(alignedResults) ||
      alignedResults.length !== alignableCues.length
    ) {
      throw new Error('The AI returned an incomplete set of aligned lines.');
    }

    const normalizeText = (text: string) =>
      text
        .normalize('NFKC')
        .toLocaleLowerCase()
        .replace(/[\s\p{P}\p{S}]/gu, '');
    const wordsByCueId = new Map<string, Cue['words']>();

    alignedResults.forEach((result: unknown, index: number) => {
      const originalCue = alignableCues[index];
      if (
        !result ||
        typeof result !== 'object' ||
        !('index' in result) ||
        result.index !== index
      ) {
        throw new Error('The AI returned lines in an unexpected order.');
      }
      if (
        !('words' in result) ||
        !Array.isArray(result.words) ||
        result.words.length === 0
      ) {
        throw new Error(`The AI returned no words for line ${index + 1}.`);
      }

      const words = result.words.map((word: unknown, wordIndex: number) => {
        if (
          !word ||
          typeof word !== 'object' ||
          !('text' in word) ||
          typeof word.text !== 'string' ||
          !('start' in word) ||
          typeof word.start !== 'string' ||
          !('end' in word) ||
          typeof word.end !== 'string' ||
          !/^\d{1,3}:\d{2}(?::\d{2})?\.\d{1,3}$/.test(word.start) ||
          !/^\d{1,3}:\d{2}(?::\d{2})?\.\d{1,3}$/.test(word.end)
        ) {
          throw new Error(`The AI returned invalid timing for line ${index + 1}.`);
        }

        const start = timeToMs(word.start);
        const end = timeToMs(word.end);
        if (
          !Number.isFinite(start) ||
          !Number.isFinite(end) ||
          start < 0 ||
          end < start
        ) {
          throw new Error(`The AI returned invalid timing for line ${index + 1}.`);
        }

        return {
          id: `${originalCue.id}-word-${wordIndex}`,
          text: word.text,
          start,
          end,
        };
      });

      if (
        words.map((word) => normalizeText(word.text)).join('') !==
        normalizeText(originalCue.text)
      ) {
        throw new Error(
          `The AI changed or missed words in line ${index + 1}; no timings were applied.`
        );
      }

      wordsByCueId.set(originalCue.id, words);
    });

    return cues.map((cue) => {
      const words = wordsByCueId.get(cue.id);
      return words ? { ...cue, words } : cue;
    });
  } catch (error: any) {
    if (error.name === 'AbortError' || signal?.aborted) {
      throw new Error('Word alignment cancelled by user.');
    }
    console.error('Word alignment failed', error);
    throw error;
  } finally {
    if (uploadedFileName) {
      try {
        await ai.files.delete({ name: uploadedFileName });
      } catch (cleanupErr) {
        console.warn('Could not delete temporary uploaded file:', cleanupErr);
      }
    }
  }
};

export const generateLyrics = async (
  topic: string,
  model: string = 'gemini-3.8-flash'
): Promise<Cue[]> => {
  const ai = getAiClient();
  const modelName = resolveModelId(model);

  const prompt = `Generate song lyrics about: "${topic}". 
  Return the result as a plain text string with line breaks. 
  Separate stanzas (Verses/Chorus) with an empty line.
  Do not include [Verse], [Chorus] tags, just the lyrics lines.`;

  try {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: prompt,
      config: {
        temperature: 0.7,
      },
    });

    const text = response.text;
    if (!text) return [];

    const cues: Cue[] = [];
    let currentTime = 0;
    const LINE_DURATION = 3000;
    const STANZA_GAP = 4000;

    const lines = text.split('\n');
    let cueIndex = 0;

    lines.forEach((line) => {
      const cleanLine = line.trim();

      if (!cleanLine) {
        currentTime += STANZA_GAP;
        return;
      }

      cues.push({
        id: `gen-${cueIndex++}-${Date.now()}`,
        start: currentTime,
        end: currentTime + LINE_DURATION,
        text: cleanLine,
      });

      currentTime += LINE_DURATION;
    });

    return cues;
  } catch (error) {
    console.error('Lyrics generation failed', error);
    throw error;
  }
};

export const refineLyrics = async (
  cues: Cue[],
  instructions: string,
  model: string = 'gemini-3.8-flash'
): Promise<Cue[]> => {
  if (cues.length === 0) return [];

  const ai = getAiClient();
  const modelName = resolveModelId(model);
  const response = await ai.models.generateContent({
    model: modelName,
    contents: `Apply the user's instructions to the lyric text only. Keep the same number and order of lines. Do not add timestamps or rewrite the JSON structure. Return one object per input line with its index and revised text.\n\nInstructions: ${instructions}\n\nLyrics:\n${JSON.stringify(
      cues.map((cue, index) => ({ index, text: cue.text }))
    )}`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            index: { type: Type.NUMBER },
            text: { type: Type.STRING },
          },
          required: ['index', 'text'],
        },
      },
      temperature: 0.2,
    },
  });

  if (!response.text) {
    throw new Error('The AI returned no refined lyrics.');
  }

  const refinedLines: unknown = JSON.parse(response.text);
  if (!Array.isArray(refinedLines) || refinedLines.length !== cues.length) {
    throw new Error('The AI returned an incomplete set of refined lines.');
  }

  return cues.map((cue, index) => {
    const result = refinedLines[index];
    if (
      !result ||
      typeof result !== 'object' ||
      !('index' in result) ||
      result.index !== index ||
      !('text' in result) ||
      typeof result.text !== 'string'
    ) {
      throw new Error(`The AI returned invalid refined lyrics for line ${index + 1}.`);
    }

    return result.text === cue.text
      ? cue
      : { ...cue, text: result.text, words: undefined };
  });
};

let activeSpeechResolve: (() => void) | null = null;

export const stopTTS = () => {
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  const resolve = activeSpeechResolve;
  activeSpeechResolve = null;
  resolve?.();
};

export const playTTS = (text: string, language = 'en-US'): Promise<void> =>
  new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      reject(new Error('Text-to-speech is not available in this browser.'));
      return;
    }
    if (!text.trim()) {
      resolve();
      return;
    }

    stopTTS();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = language;
    const voices = window.speechSynthesis.getVoices();
    utterance.voice =
      voices.find((voice) => voice.voiceURI === language) ??
      voices.find((voice) => voice.lang.toLowerCase() === language.toLowerCase()) ??
      voices.find((voice) =>
        voice.lang.toLowerCase().startsWith(`${language.split('-')[0].toLowerCase()}-`)
      ) ??
      null;

    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      activeSpeechResolve = null;
      if (error) reject(error);
      else resolve();
    };

    activeSpeechResolve = () => finish();
    utterance.onend = () => finish();
    utterance.onerror = (event) => {
      finish(new Error(`Text-to-speech failed: ${event.error}.`));
    };

    try {
      window.speechSynthesis.speak(utterance);
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
