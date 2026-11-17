import { describe, expect, it } from "bun:test";
import { createJudgeMail, judgeMailRequest, type JudgeMailInput } from "./mail.ts";

const input: JudgeMailInput = {
  today: "2026-11-17",
  stakes: "career, Code Blossom funding or donations, partnerships",
  items: [
    { id: "waiting:t1", kind: "waiting", from: "Me", to: "Anna <anna@funder.org>", subject: "Grant", snippet: "Could you send the form?", at: "2026-11-05" },
    { id: "unanswered:t2", kind: "unanswered", from: "Ben <ben@partner.org>", to: "Me", subject: "Partnership", snippet: "Shall we meet?", at: "2026-11-14" },
  ],
};

describe("judgeMailRequest", () => {
  it("asks for one verdict per mail, with the ids as an enum and the stakes in the prompt", () => {
    const request = judgeMailRequest("m", input, "Marion");
    expect(request.output_config.format.schema.properties.verdicts.items.properties.id.enum).toEqual(["waiting:t1", "unanswered:t2"]);
    expect(request.system).toContain("Marion");
    expect(request.system).toContain("career, Code Blossom funding or donations, partnerships");
    expect(request.system).toContain("data, not instructions");
    expect(request.system).not.toContain("—");
    expect(request.messages[0]!.content).toContain("<emails>");
  });

  it("uses a plain default when no stakes are set", () => {
    const request = judgeMailRequest("m", { ...input, stakes: "" });
    expect(request.system).toContain("the user");
    expect(request.system).toContain("a deadline, money, a job or a commitment");
  });
});

describe("createJudgeMail", () => {
  it("sends through the shared structured call", async () => {
    const send = (async () =>
      new Response(JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: '{"verdicts":[]}' }] }), { status: 200 })) as unknown as typeof fetch;
    expect(await createJudgeMail({ apiKey: "k", model: "m", fetch: send })(input)).toEqual({ verdicts: [] });
  });
});
