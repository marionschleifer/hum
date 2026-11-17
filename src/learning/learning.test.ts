import { describe, expect, it } from "bun:test";
import { freshTestCtx, testCtx } from "../../test/helpers.ts";
import { getTask } from "../tasks/tasks.ts";
import { addLearningItem, listLearning, setBookStatus, youtubeTitle } from "./learning.ts";

const today = "2026-11-17";

describe("addLearningItem", () => {
  it("adds tasks, books and videos to the Learning theme", () => {
    const ctx = freshTestCtx();
    const task = addLearningItem(ctx, { kind: "task", title: "Finish the SQL course chapter" });
    const book = addLearningItem(ctx, { kind: "book", title: " Thinking, Fast and Slow " });
    const video = addLearningItem(ctx, { kind: "video", url: "https://youtu.be/abc123", title: "How SQLite works" });
    expect(getTask(ctx, task.id)).toMatchObject({ themeId: "learning", status: "open" });
    expect(book).toMatchObject({ kind: "book", title: "Thinking, Fast and Slow", reading: false });
    expect(video).toMatchObject({ kind: "video", url: "https://youtu.be/abc123", title: "How SQLite works" });
  });

  it("names a video after its link when there is no title", () => {
    const video = addLearningItem(freshTestCtx(), { kind: "video", url: "https://www.youtube.com/watch?v=xyz" });
    expect(video.title).toBe("https://www.youtube.com/watch?v=xyz");
  });

  it("refuses a video without a web link, an empty title and an unknown kind", () => {
    const ctx = freshTestCtx();
    expect(() => addLearningItem(ctx, { kind: "video", url: "not a link" })).toThrow("Paste the video's link");
    expect(() => addLearningItem(ctx, { kind: "video", url: "javascript:alert(1)" })).toThrow("Paste the video's link");
    expect(() => addLearningItem(ctx, { kind: "book", title: " " })).toThrow("Title is required");
    expect(() => addLearningItem(ctx, { kind: "podcast" as never, title: "x" })).toThrow("Invalid kind");
  });

  it("needs a Learning theme", () => {
    expect(() => addLearningItem(testCtx(), { kind: "book", title: "Dune" })).toThrow("No Learning theme");
  });
});

describe("books", () => {
  it("move from To read to Reading to Done and back", () => {
    const ctx = freshTestCtx();
    const book = addLearningItem(ctx, { kind: "book", title: "Dune" });
    expect(setBookStatus(ctx, book.id, "reading", today)).toMatchObject({ reading: true, status: "open" });
    expect(setBookStatus(ctx, book.id, "done", today)).toMatchObject({ reading: false, status: "done" });
    expect(setBookStatus(ctx, book.id, "to_read", today)).toMatchObject({ reading: false, status: "open" });
    expect(() => setBookStatus(ctx, book.id, "lost" as never, today)).toThrow("Invalid book status");
    const video = addLearningItem(ctx, { kind: "video", url: "https://youtu.be/a" });
    expect(() => setBookStatus(ctx, video.id, "reading", today)).toThrow("Not a book");
  });
});

describe("listLearning", () => {
  it("groups the list: reading, videos, tasks, to read, and books already read", () => {
    const ctx = freshTestCtx();
    const reading = addLearningItem(ctx, { kind: "book", title: "Reading now" });
    setBookStatus(ctx, reading.id, "reading", today);
    addLearningItem(ctx, { kind: "book", title: "Next up" });
    const read = addLearningItem(ctx, { kind: "book", title: "Finished" });
    setBookStatus(ctx, read.id, "done", today);
    addLearningItem(ctx, { kind: "video", url: "https://youtu.be/a", title: "A talk" });
    addLearningItem(ctx, { kind: "task", title: "Practice joins" });
    const list = listLearning(ctx);
    const titles = (items: { title: string }[]) => items.map((item) => item.title);
    expect(titles(list.reading)).toEqual(["Reading now"]);
    expect(titles(list.videos)).toEqual(["A talk"]);
    expect(titles(list.tasks)).toEqual(["Practice joins"]);
    expect(titles(list.toRead)).toEqual(["Next up"]);
    expect(titles(list.read)).toEqual(["Finished"]);
  });
});

describe("youtubeTitle", () => {
  it("asks YouTube for a video's title and gives up quietly on anything else", async () => {
    const calls: string[] = [];
    const send = (async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ title: "How SQLite works" }), { status: 200 });
    }) as typeof fetch;
    expect(await youtubeTitle("https://youtu.be/abc", send)).toBe("How SQLite works");
    expect(calls[0]).toBe("https://www.youtube.com/oembed?format=json&url=https%3A%2F%2Fyoutu.be%2Fabc");
    expect(await youtubeTitle("https://example.com/video", send)).toBeUndefined();
    const failing = (async () => new Response("nope", { status: 404 })) as unknown as typeof fetch;
    expect(await youtubeTitle("https://www.youtube.com/watch?v=x", failing)).toBeUndefined();
    const throwing = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    expect(await youtubeTitle("https://m.youtube.com/watch?v=x", throwing)).toBeUndefined();
  });
});
