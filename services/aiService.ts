import { GoogleGenAI, Type } from "@google/genai";
import { Cue } from '../types';
import { timeToMs } from '../utils/timeUtils';

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

const DEFAULT_TRANSCRIPTION_MODEL = 'gemini-3.8-flash';

/**
 * Keep older saved UI selections working while using supported transcription models.
 */
const resolveTranscriptionModelId = (requestedModel?: string): string => {
  if (
    !requestedModel ||
    requestedModel === 'gemini-2.5-flash' ||
    requestedModel === 'gemini-3.0-flash' ||
    requestedModel === 'gemini-3-flash-preview'
  ) {
    return DEFAULT_TRANSCRIPTION_MODEL;
  }
  return requestedModel;
};

const resolveGenerationModelId = (requestedModel?: string): string => {
  if (!requestedModel || requestedModel === 'gemini-2.5-flash') {
    return 'gemini-3.8-flash';
  }
  if (
    requestedModel === 'gemini-3.0-flash' ||
    requestedModel === 'gemini-3-flash-preview'
  ) {
    return 'gemini-3.8-flash';
  }
  if (
    requestedModel === 'gemini-3.0-pro' ||
    requestedModel === 'gemini-3-pro-preview'
  ) {
    return 'gemini-3.8-pro';
  }
  return requestedModel;
};

export const transcribeAudio = async (
  file: File,
  options: TranscriptionOptions,
  signal?: AbortSignal
): Promise<Cue[]> => {
  // Gemini Files API supports files up to 2GB.
  const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024;
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(
      'File size exceeds the 2GB limit. Please compress or split the audio file.'
    );
  }

  const ai = getAiClient();
  const modelName = resolveTranscriptionModelId(options.model);
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

export const generateLyrics = async (
  topic: string,
  model: string = 'gemini-3.8-flash'
): Promise<Cue[]> => {
  const ai = getAiClient();
  const modelName = resolveGenerationModelId(model);

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
  instruction: string,
  model: string = 'gemini-3.8-flash'
): Promise<Cue[]> => {
  const ai = getAiClient();
  const modelName = resolveGenerationModelId(model);
  const simplifiedCues = cues.map(({ id, text }) => ({ id, text }));
  const prompt = `Refine the following lyrics based on this instruction: "${instruction}".

Input Lyrics JSON:
${JSON.stringify(simplifiedCues)}

Return a JSON array with objects containing "id" and "text".
Keep IDs matching the input so timestamps can be preserved.
If you split lines or add new ones, generate IDs starting with "ai-new-".`;

  const responseSchema = {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: {
        id: { type: Type.STRING },
        text: { type: Type.STRING },
      },
      required: ['id', 'text'],
    },
  };

  try {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema,
      },
    });

    if (!response.text) return cues;

    const refinedData = JSON.parse(response.text);
    const idMap = new Map(cues.map((cue) => [cue.id, cue]));
    const newCues: Cue[] = [];
    let lastEnd = 0;

    for (const item of refinedData) {
      const original = idMap.get(item.id);
      if (original) {
        newCues.push({
          ...original,
          text: item.text,
          words: item.text !== original.text ? undefined : original.words,
        });
        lastEnd = original.end;
      } else {
        newCues.push({
          id: item.id || `refine-${Date.now()}-${newCues.length}`,
          start: lastEnd,
          end: lastEnd + 2000,
          text: item.text || '',
        });
        lastEnd += 2000;
      }
    }

    return newCues;
  } catch (error) {
    console.error('Lyrics refinement failed', error);
    throw error;
  }
};

let currentUtterance: SpeechSynthesisUtterance | null = null;

export const stopTTS = () => {
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  currentUtterance = null;
};

export const playTTS = async (
  text: string,
  lang: string = 'en'
): Promise<void> => {
  stopTTS();

  const textToSpeak = text.trim();
  if (!textToSpeak) return;

  if (typeof window === 'undefined' || !window.speechSynthesis) {
    throw new Error('Web Speech API is not supported in this browser.');
  }

  await new Promise<void>((resolve, reject) => {
    const utterance = new SpeechSynthesisUtterance(textToSpeak);
    currentUtterance = utterance;

    const speak = () => {
      const voices = window.speechSynthesis.getVoices();
      const matchedVoice =
        voices.find((voice) => voice.voiceURI === lang) ||
        voices.find((voice) => voice.lang.startsWith(lang)) ||
        voices.find((voice) => voice.lang.startsWith(lang.split('-')[0]));

      if (matchedVoice) {
        utterance.voice = matchedVoice;
        utterance.lang = matchedVoice.lang;
      } else {
        utterance.lang = lang;
      }

      utterance.onend = () => {
        if (currentUtterance === utterance) currentUtterance = null;
        resolve();
      };
      utterance.onerror = (event) => {
        if (currentUtterance === utterance) currentUtterance = null;
        if (event.error === 'canceled') {
          resolve();
        } else {
          reject(new Error(`Failed to play TTS: ${event.error}`));
        }
      };

      window.speechSynthesis.speak(utterance);
    };

    if (window.speechSynthesis.getVoices().length === 0) {
      window.speechSynthesis.onvoiceschanged = () => {
        window.speechSynthesis.onvoiceschanged = null;
        speak();
      };
    } else {
      speak();
    }
  });
};
