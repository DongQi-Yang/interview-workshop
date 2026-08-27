import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { makeTestDeps } from "./helpers.js";

const GOOD = JSON.stringify({ revised: "新简历", suggestions: [] });

describe("POST /api/v1/resume/polish", () => {
  it("润色成功并写入记录", async () => {
    const deps = await makeTestDeps(() => GOOD);
    const app = createApp(deps);
    const res = await request(app).post("/api/v1/resume/polish").send({ resumeText: "原文" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.revised).toBe("新简历");

    const list = await request(app).get("/api/v1/records");
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].type).toBe("polish");
  });

  it("空简历返回 400", async () => {
    const deps = await makeTestDeps(() => GOOD);
    const res = await request(createApp(deps))
      .post("/api/v1/resume/polish")
      .send({ resumeText: "" });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });
});
