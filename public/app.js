const $ = (s) => document.querySelector(s);

async function api(path, options) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const body = await res.json();
  if (!body.ok) throw new Error(body.error?.message ?? "请求失败");
  return body.data;
}

function metaLine(data) {
  const fb = data.fallback ? "（活跃引擎不可用，已自动降级）" : "";
  return `<p class="meta">本次使用：${data.providerId}${fb}</p>`;
}

async function loadProviders() {
  const data = await api("/api/v1/settings/providers");
  const sel = $("#provider");
  sel.innerHTML = data.providers
    .map(
      (p) =>
        `<option value="${p.id}" ${p.id === data.active ? "selected" : ""} ${p.available ? "" : "disabled"}>
          ${p.name}${p.available ? "" : "（不可用）"}</option>`,
    )
    .join("");
  sel.onchange = () =>
    api("/api/v1/settings/provider", { method: "PUT", body: JSON.stringify({ id: sel.value }) });
}

document.querySelectorAll("nav button").forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll("nav button, .tab").forEach((el) => el.classList.remove("active"));
    btn.classList.add("active");
    $(`#tab-${btn.dataset.tab}`).classList.add("active");
    if (btn.dataset.tab === "records") loadRecords();
  };
});

$("#polishBtn").onclick = async () => {
  const out = $("#polishResult");
  out.innerHTML = "<p>润色中…</p>";
  try {
    const data = await api("/api/v1/resume/polish", {
      method: "POST",
      body: JSON.stringify({ resumeText: $("#resumeText").value }),
    });
    out.innerHTML =
      metaLine(data) +
      "<h3>修改建议</h3><ul>" +
      data.suggestions
        .map(
          (s) =>
            `<li class="sev-${s.severity}"><b>[${{ high: "硬伤", medium: "建议", low: "可选" }[s.severity]}]</b>
             「${s.original}」→ ${s.suggestion}<br><small>${s.reason}</small></li>`,
        )
        .join("") +
      `</ul><h3>改写版全文 <button id="copyBtn">复制</button></h3><pre>${data.revised}</pre>`;
    $("#copyBtn").onclick = () => navigator.clipboard.writeText(data.revised);
  } catch (err) {
    out.innerHTML = `<p class="error">${err.message}</p>`;
  }
};

$("#planBtn").onclick = async () => {
  const out = $("#planResult");
  out.innerHTML = "<p>生成中…</p>";
  try {
    const data = await api("/api/v1/interview-plan", {
      method: "POST",
      body: JSON.stringify({
        resumeText: $("#planResume").value,
        jobDescription: $("#planJD").value,
      }),
    });
    out.innerHTML =
      metaLine(data) +
      "<h3>备战重点</h3><ul>" + data.focusAreas.map((f) => `<li>${f}</li>`).join("") + "</ul>" +
      "<h3>预测面试题</h3>" +
      data.questions
        .map(
          (q) =>
            `<details><summary>[${q.category}] ${q.question}</summary><ul>` +
            q.answerOutline.map((a) => `<li>${a}</li>`).join("") +
            "</ul></details>",
        )
        .join("") +
      "<h3>冲刺计划</h3><ol>" +
      data.studyPlan.map((d) => `<li>D${d.day}：${d.task}</li>`).join("") +
      "</ol>";
  } catch (err) {
    out.innerHTML = `<p class="error">${err.message}</p>`;
  }
};

async function loadRecords() {
  const list = await api("/api/v1/records");
  $("#recordsList").innerHTML =
    list.length === 0
      ? "<p>暂无记录</p>"
      : list
          .map(
            (r) =>
              `<details><summary>${r.type === "polish" ? "简历润色" : "面试方案"} · ${new Date(r.createdAt).toLocaleString("zh-CN")}</summary>
               <pre>${JSON.stringify(r.result, null, 2)}</pre></details>`,
          )
          .join("");
}

loadProviders().catch((err) => console.error(err));
