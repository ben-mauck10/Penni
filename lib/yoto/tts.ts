// TTS Adapter — text-to-speech synthesis for Yoto card chapters.
// Production audio requires a live TTS provider.

import type { YotoPresentationState } from "./types";

// ---------------------------------------------------------------------------
// 8.1 — TTSAdapter interface
// ---------------------------------------------------------------------------

export interface TTSAdapter {
  synthesize(script: string): Promise<Buffer>;
}

// ---------------------------------------------------------------------------
// 8.2 — OpenAIAdapter
// ---------------------------------------------------------------------------

export class OpenAIAdapter implements TTSAdapter {
  private readonly apiKey: string;
  private readonly voice: string;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not set");
    }
    this.apiKey = apiKey;
    // Supported voices: alloy, ash, coral, echo, fable, onyx, nova, sage, shimmer
    // "nova" is warm and child-friendly; override with OPENAI_TTS_VOICE env var.
    this.voice = process.env.OPENAI_TTS_VOICE ?? "nova";
  }

  async synthesize(script: string): Promise<Buffer> {
    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: "tts-1",
        input: script,
        voice: this.voice,
        response_format: "mp3",
      }),
    });

    if (!response.ok) {
      let message: string;
      try {
        const body = await response.text();
        message = `OpenAI TTS request failed: ${response.status} ${response.statusText} — ${body}`;
      } catch {
        message = `OpenAI TTS request failed: ${response.status} ${response.statusText}`;
      }
      throw { errorType: "tts_failed", message };
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}

// ---------------------------------------------------------------------------
// 8.3 — ElevenLabsAdapter (kept for reference / future use)
// ---------------------------------------------------------------------------

export class ElevenLabsAdapter implements TTSAdapter {
  private readonly apiKey: string;
  private readonly voiceId: string;

  constructor() {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      throw new Error("ELEVENLABS_API_KEY is not set");
    }
    this.apiKey = apiKey;
    this.voiceId =
      process.env.ELEVENLABS_VOICE_ID ?? "EXAVITQu4vr4xnSDxMaL";
  }

  async synthesize(script: string): Promise<Buffer> {
    const url = new URL(
      `https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}`
    );
    url.searchParams.set("output_format", "mp3_44100_128");

    const response = await fetch(url.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": this.apiKey,
      },
      body: JSON.stringify({
        text: script,
        model_id: "eleven_turbo_v2_5",
      }),
    });

    if (!response.ok) {
      let message: string;
      try {
        const body = await response.text();
        message = `ElevenLabs TTS request failed: ${response.status} ${response.statusText} — ${body}`;
      } catch {
        message = `ElevenLabs TTS request failed: ${response.status} ${response.statusText}`;
      }
      throw { errorType: "tts_failed", message };
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}

// ---------------------------------------------------------------------------
// 8.3 — ScriptedFallbackAdapter
// ---------------------------------------------------------------------------

export class ScriptedFallbackAdapter implements TTSAdapter {
  async synthesize(): Promise<Buffer> {
    throw {
      errorType: "tts_provider_unconfigured",
      message:
        "Set TTS_PROVIDER=elevenlabs and ELEVENLABS_API_KEY before serving Yoto audio.",
    };
  }
}

// ---------------------------------------------------------------------------
// 8.4 — getScriptForChapter
// ---------------------------------------------------------------------------

/**
 * Derives the spoken TTS script for a given Yoto chapter from the
 * current `YotoPresentationState`.
 */
export function getScriptForChapter(
  chapter: "update" | "changed" | "moment",
  state: YotoPresentationState
): string {
  if (chapter === "moment") {
    return "Family money moment. Pick one thing you might save for, one thing you might spend on, and one kind thing you could give.";
  }

  const name = state.childDisplayName ? ` ${state.childDisplayName}` : "";

  const goal =
    state.goalName !== undefined && state.goalProgressPercent !== undefined
      ? ` You are ${state.goalProgressPercent}% of the way to your ${state.goalName} goal`
      : "";

  if (chapter === "update") {
    if (state.balanceMode === "hidden") {
      return `Hello${name}! You're doing a great job saving up${goal}.`;
    }

    if (
      state.balanceMode === "rounded" &&
      state.availableAmountPence !== undefined
    ) {
      const pounds = Math.round(state.availableAmountPence / 100);
      return `Hello${name}! You have about £${pounds} in your Penni pot${goal}.`;
    }

    if (
      state.balanceMode === "exact" &&
      state.availableAmountPence !== undefined
    ) {
      const pounds = (state.availableAmountPence / 100).toFixed(2);
      return `Hello${name}! You have £${pounds} in your Penni pot${goal}.`;
    }

    // Fallback: treat as hidden when amount is unexpectedly absent.
    return `Hello${name}! You're doing a great job saving up${goal}.`;
  }

  // chapter === "changed"
  if (state.weeklyChangePence === undefined) {
    return "Keep checking back to see how your Penni pot is growing!";
  }

  if (state.weeklyChangePence === 0) {
    return "Your Penni pot amount is unchanged this week.";
  }

  if (state.balanceMode === "hidden") {
    return state.weeklyChangePence > 0
      ? "Your Penni pot has grown this week. Well done!"
      : "Your Penni pot went down a little this week.";
  }

  if (state.weeklyChangePence > 0) {
    const pounds = (state.weeklyChangePence / 100).toFixed(2);
    return `You saved £${pounds} this week. Well done!`;
  }

  // negative
  const pounds = (Math.abs(state.weeklyChangePence) / 100).toFixed(2);
  return `Your Penni pot went down by £${pounds} this week.`;
}

// ---------------------------------------------------------------------------
// 8.5 — getTTSAdapter factory
// ---------------------------------------------------------------------------

/**
 * Returns the configured TTS adapter based on the `TTS_PROVIDER` env var.
 *
 * Supported values:
 *   - `openai`      — requires `OPENAI_API_KEY`
 *   - `elevenlabs`  — requires `ELEVENLABS_API_KEY`
 *
 * Falls back to `ScriptedFallbackAdapter` (throws a clear config error) if
 * neither provider is configured.
 */
export function getTTSAdapter(): TTSAdapter {
  if (process.env.TTS_PROVIDER === "openai" && process.env.OPENAI_API_KEY) {
    return new OpenAIAdapter();
  }
  if (
    process.env.TTS_PROVIDER === "elevenlabs" &&
    process.env.ELEVENLABS_API_KEY
  ) {
    return new ElevenLabsAdapter();
  }
  return new ScriptedFallbackAdapter();
}
