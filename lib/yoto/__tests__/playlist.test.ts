import { describe, expect, it } from "vitest";
import { buildCardPayload } from "../playlist";

describe("buildCardPayload", () => {
  const uploadIds = {
    "01-update": "abc01",
    "02-changed": "abc02",
    "03-moment": "abc03",
  };

  it("sets title to Penni Pig", () => {
    const payload = buildCardPayload(uploadIds) as {
      title: string;
    };
    expect(payload.title).toBe("Penni Pig");
  });

  it("produces three chapters with correct titles and keys", () => {
    const payload = buildCardPayload(uploadIds) as {
      content: {
        chapters: { key: string; title: string }[];
      };
    };
    expect(payload.content.chapters.map((c) => c.title)).toEqual([
      "My Penni update",
      "What changed?",
      "Family money moment",
    ]);
    expect(payload.content.chapters.map((c) => c.key)).toEqual([
      "01-update",
      "02-changed",
      "03-moment",
    ]);
  });

  it("each chapter has exactly one track with an uploadId (not a trackUrl)", () => {
    const payload = buildCardPayload(uploadIds) as {
      content: {
        chapters: {
          tracks: {
            uploadId?: string;
            trackUrl?: string;
            format: string;
            channels: string;
          }[];
        }[];
      };
    };

    for (const chapter of payload.content.chapters) {
      expect(chapter.tracks).toHaveLength(1);
      const track = chapter.tracks[0];
      // uploadId must be present — this is what allows the MYO card to
      // download audio for offline playback.
      expect(track.uploadId).toBeDefined();
      // trackUrl must NOT be present — that produces streaming-only cards.
      expect(track.trackUrl).toBeUndefined();
    }
  });

  it("maps uploadIds to the correct chapters", () => {
    const payload = buildCardPayload(uploadIds) as {
      content: {
        chapters: { key: string; tracks: { uploadId: string }[] }[];
      };
    };

    for (const chapter of payload.content.chapters) {
      expect(chapter.tracks[0].uploadId).toBe(uploadIds[chapter.key as keyof typeof uploadIds]);
    }
  });

  it("sets format to mp3 and channels to mono on every track", () => {
    const payload = buildCardPayload(uploadIds) as {
      content: {
        chapters: { tracks: { format: string; channels: string }[] }[];
      };
    };

    for (const chapter of payload.content.chapters) {
      expect(chapter.tracks[0].format).toBe("mp3");
      expect(chapter.tracks[0].channels).toBe("mono");
    }
  });
});
