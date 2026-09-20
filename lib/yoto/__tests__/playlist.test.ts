import { describe, expect, it } from "vitest";
import { buildPlaylistPayload } from "../playlist";

describe("buildPlaylistPayload", () => {
  it("builds Yoto /content payload with three streamed chapters and URL icons", () => {
    const payload = buildPlaylistPayload(
      "https://penni.example.test",
      "opaque-media-token"
    ) as {
      title: string;
      content: {
        chapters: {
          key: string;
          title: string;
          tracks: {
            trackUrl: string;
            type: string;
            format: string;
            display: { iconUrl16x16: string };
          }[];
          display: { iconUrl16x16: string };
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
      expect(chapter.display.iconUrl16x16).toBe(
        "https://penni.example.test/api/yoto/icon/opaque-media-token"
      );
      expect(chapter.tracks[0].display.iconUrl16x16).toBe(
        "https://penni.example.test/api/yoto/icon/opaque-media-token"
      );
      expect(chapter.tracks[0].type).toBe("stream");
      expect(chapter.tracks[0].format).toBe("aiff");
      expect(chapter.tracks[0].trackUrl).toContain(
        "https://penni.example.test/api/yoto/audio/opaque-media-token/"
      );
    }

    const urls = payload.content.chapters.flatMap((chapter) => [
      chapter.display.iconUrl16x16,
      chapter.tracks[0].display.iconUrl16x16,
      chapter.tracks[0].trackUrl,
    ]);

    expect(urls.join(" ")).not.toContain("family");
    expect(urls.join(" ")).not.toContain("child");
  });
});
