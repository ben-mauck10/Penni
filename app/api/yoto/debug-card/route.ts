import { NextResponse } from "next/server";
import { getConnection, getFamilyId } from "@/lib/yoto/db";
import { ensureFreshToken } from "@/lib/yoto/oauth";

export const runtime = "nodejs";

const YOTO_API_URL = process.env.YOTO_API_URL ?? "https://api.yotoplay.com";
const DEBUG_TOKEN = process.env.YOTO_DEBUG_TOKEN;

function summarizeTrackUrl(value: unknown): object {
  if (typeof value !== "string") {
    return { kind: typeof value, length: 0 };
  }

  try {
    const url = new URL(value);
    return {
      kind: "url",
      length: value.length,
      protocol: url.protocol,
      host: url.host,
      pathname: url.pathname,
    };
  } catch {
    return {
      kind: "text",
      length: value.length,
      preview: value.slice(0, 80),
    };
  }
}

async function summarizeTrackReachability(value: unknown): Promise<object> {
  if (typeof value !== "string") {
    return { checked: false, reason: "trackUrl is not a string" };
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { checked: false, reason: "trackUrl is not a URL" };
  }

  try {
    const response = await fetch(url.toString(), { method: "HEAD" });
    return {
      checked: true,
      status: response.status,
      contentType: response.headers.get("content-type"),
      contentLength: response.headers.get("content-length"),
    };
  } catch (error) {
    return {
      checked: true,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function GET(req: Request) {
  const providedToken =
    req.headers.get("x-yoto-debug-token") ??
    new URL(req.url).searchParams.get("token");

  if (!DEBUG_TOKEN || providedToken !== DEBUG_TOKEN) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const familyId = getFamilyId();
  const conn = getConnection(familyId);

  if (!conn?.playlistId) {
    return NextResponse.json(
      { error: "No Penni Pig playlist/card id is stored." },
      { status: 404 }
    );
  }

  const accessToken = await ensureFreshToken(familyId);
  const response = await fetch(`${YOTO_API_URL}/content/${conn.playlistId}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  const body = (await response.json().catch(() => null)) as
    | Record<string, unknown>
    | null;

  if (!response.ok || !body) {
    return NextResponse.json(
      {
        error: "Could not read Yoto card content.",
        status: response.status,
        body,
      },
      { status: 502 }
    );
  }

  const card = (body.card ?? body) as Record<string, unknown>;
  const content = card.content as Record<string, unknown> | undefined;
  const chapters = Array.isArray(content?.chapters) ? content.chapters : [];

  const summarizedChapters = await Promise.all(
    chapters.map(async (chapter) => {
      const chapterObj = chapter as Record<string, unknown>;
      const tracks = Array.isArray(chapterObj.tracks) ? chapterObj.tracks : [];
      return {
        key: chapterObj.key,
        title: chapterObj.title,
        trackCount: tracks.length,
        tracks: await Promise.all(
          tracks.map(async (track) => {
            const trackObj = track as Record<string, unknown>;
            return {
              key: trackObj.key,
              title: trackObj.title,
              type: trackObj.type,
              format: trackObj.format,
              duration: trackObj.duration,
              fileSize: trackObj.fileSize,
              channels: trackObj.channels,
              trackUrl: summarizeTrackUrl(trackObj.trackUrl),
              reachability: await summarizeTrackReachability(trackObj.trackUrl),
            };
          })
        ),
      };
    })
  );

  return NextResponse.json({
    cardId: card.cardId ?? conn.playlistId,
    title: card.title,
    deleted: card.deleted,
    availability: card.availability,
    contentVersion: content?.version,
    chapterCount: summarizedChapters.length,
    chapters: summarizedChapters,
  });
}
