import { describe, expect, it } from "vitest";
import { buildPlaylistPayload } from "../playlist";

describe("buildPlaylistPayload", () => {
  it("builds Yoto Labs TTS payload with three spoken chapters", () => {
    const payload = buildPlaylistPayload() as {
      title: string;
      content: {
        chapters: {
          key: string;
          title: string;
          tracks: {
            trackUrl: string;
            type: string;
            display: object;
          }[];
          display: object;
        }[];
      };
    };

    expect(payload.title).toBe("Penni Pig");
    expect(payload.content.chapters.map((chapter) => chapter.title)).toEqual([
      "My Penni update",
      "What changed?",
      "Family money moment",
    ]);

    for (const chapter of payload.content.chapters) {
      expect(chapter.tracks).toHaveLength(1);
      expect(chapter.tracks[0].type).toBe("elevenlabs");
      expect(chapter.tracks[0].trackUrl.length).toBeGreaterThan(20);
    }
  });
});
