import { describe, expect, it } from "vitest";
import { buildCardPayload } from "../playlist";

describe("buildCardPayload", () => {
  const hashes = {
    "01-update": "abc01hash",
    "02-changed": "abc02hash",
    "03-moment": "abc03hash",
  };

  it("sets title to Penni Pig", () => {
    const payload = buildCardPayload(hashes) as { title: string };
    expect(payload.title).toBe("Penni Pig");
  });

  it("produces three chapters with correct titles and keys", () => {
    const payload = buildCardPayload(hashes) as {
      content: { chapters: { key: string; title: string }[] };
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

  it("each chapter has exactly one track with a yoto:# trackUrl (not an uploadId)", () => {
    const payload = buildCardPayload(hashes) as {
      content: {
        chapters: {
          tracks: { trackUrl?: string; uploadId?: unknown }[];
        }[];
      };
    };

    for (const chapter of payload.content.chapters) {
      expect(chapter.tracks).toHaveLength(1);
      const track = chapter.tracks[0];
      // trackUrl must use the "yoto:#<hash>" scheme for uploaded audio.
      expect(track.trackUrl).toMatch(/^yoto:#/);
      // uploadId must NOT be present.
      expect(track.uploadId).toBeUndefined();
    }
  });

  it("maps transcodedSha256 hashes into yoto:# trackUrls correctly", () => {
    const payload = buildCardPayload(hashes) as {
      content: {
        chapters: { key: string; tracks: { trackUrl: string }[] }[];
      };
    };

    for (const chapter of payload.content.chapters) {
      const expectedHash = hashes[chapter.key as keyof typeof hashes];
      expect(chapter.tracks[0].trackUrl).toBe(`yoto:#${expectedHash}`);
    }
  });

  it("sets format to mp3 and channels to mono on every track", () => {
    const payload = buildCardPayload(hashes) as {
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
