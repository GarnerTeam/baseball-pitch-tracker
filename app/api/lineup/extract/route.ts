import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import {
  LINEUP_EXTRACTION_PROMPT,
  LINEUP_JSON_SCHEMA,
  parseLineupResponse,
} from '@/lib/lineup-extract-parse';

export const runtime = 'nodejs';
// Vision calls can take a few seconds; allow headroom (the platform plan may
// cap this lower — the client shows a retry message on timeout either way).
export const maxDuration = 60;

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
// Vercel serverless request bodies are limited to ~4.5 MB. The client
// downsizes photos well under this; this is the server-side backstop.
const MAX_BASE64_CHARS = 4_000_000;

/**
 * POST /api/lineup/extract
 * Body: { imageBase64: string (no data: prefix), mimeType: 'image/jpeg'|'image/png'|'image/webp' }
 *
 * Reads a batting lineup out of a screenshot/photo using Gemini and returns
 * { teamName, players: [{order,name,number,hand}], warnings }. Nothing is
 * written anywhere — the Lineup tab shows the result on a review screen and
 * the coach confirms/edits first.
 *
 * Requires a signed-in user (this endpoint spends paid model credits) and
 * two environment variables:
 *   GEMINI_API_KEY  — Google AI Studio / Gemini API key
 *   GEMINI_MODEL    — model id to use (e.g. the same one the other app uses);
 *                     deliberately NOT hard-coded so a model retirement is a
 *                     config change, not a code change.
 *
 * Privacy: the image is forwarded to Google for this one request and is never
 * stored, logged, or written to the sheet by this app. Names/numbers are not
 * logged either.
 */
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL;
  if (!apiKey || !model) {
    return NextResponse.json(
      { error: 'Photo import is not configured yet (missing GEMINI_API_KEY or GEMINI_MODEL on the server).' },
      { status: 503 },
    );
  }

  let body: { imageBase64?: unknown; mimeType?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const imageBase64 = typeof body.imageBase64 === 'string' ? body.imageBase64.replace(/^data:[^;]+;base64,/, '') : '';
  const mimeType = typeof body.mimeType === 'string' ? body.mimeType : '';

  if (!imageBase64) {
    return NextResponse.json({ error: 'Missing image.' }, { status: 400 });
  }
  if (!ALLOWED_MIME.has(mimeType)) {
    return NextResponse.json({ error: 'Unsupported image type — use a JPEG, PNG or WebP.' }, { status: 415 });
  }
  if (imageBase64.length > MAX_BASE64_CHARS) {
    return NextResponse.json({ error: 'Image is too large — try a smaller photo or a screenshot.' }, { status: 413 });
  }
  if (!/^[A-Za-z0-9+/=\s]+$/.test(imageBase64)) {
    return NextResponse.json({ error: 'Image data is not valid base64.' }, { status: 400 });
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  const parts = [
    { inline_data: { mime_type: mimeType, data: imageBase64 } },
    { text: LINEUP_EXTRACTION_PROMPT },
  ];

  async function callGemini(structured: boolean): Promise<Response> {
    const payload: Record<string, unknown> = { contents: [{ parts }] };
    if (structured) {
      payload.generationConfig = {
        temperature: 0,
        responseFormat: { text: { mimeType: 'application/json', schema: LINEUP_JSON_SCHEMA } },
      };
    } else {
      // Fallback path: plain prompt-only JSON (the prompt already demands
      // JSON only). Used if Google changes/rejects the structured-output
      // field so the feature degrades instead of breaking.
      payload.generationConfig = { temperature: 0 };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 50_000);
    try {
      return await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey as string },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  try {
    let res = await callGemini(true);
    if (res.status === 400) {
      // Most likely the structured-output setting was rejected — retry once
      // without it before giving up.
      res = await callGemini(false);
    }

    if (res.status === 429) {
      return NextResponse.json({ error: 'The photo reader is busy right now — please try again in a moment.' }, { status: 429 });
    }
    if (!res.ok) {
      const errText = (await res.text().catch(() => '')).slice(0, 300);
      console.error('[lineup extract] gemini error status', res.status);
      return NextResponse.json(
        { error: `The photo reader returned an error (${res.status}).`, detail: errText },
        { status: 502 },
      );
    }

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
      promptFeedback?: { blockReason?: string };
    };

    if (data.promptFeedback?.blockReason) {
      return NextResponse.json({ error: 'The photo could not be processed. Try a different image.' }, { status: 422 });
    }

    const text = (data.candidates?.[0]?.content?.parts ?? []).map(p => p.text ?? '').join('').trim();
    if (!text) {
      return NextResponse.json({ error: 'The photo reader returned nothing. Try a clearer image.' }, { status: 422 });
    }

    const lineup = parseLineupResponse(text);
    return NextResponse.json(lineup);
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    console.error('[lineup extract] failed', aborted ? 'timeout' : 'error');
    return NextResponse.json(
      { error: aborted ? 'The photo reader timed out — please try again.' : 'Could not read that image. Please try again.' },
      { status: aborted ? 504 : 500 },
    );
  }
}
