const $ = (s) => document.querySelector(s);

// HTML 转义：所有插入 innerHTML 的不受信文本（用户输入 / LLM 输出）必须先转义，
// 防止被当作 HTML 解析（内容被静默丢失）或注入（XSS）。
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

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
  try {
    const data = await api("/api/v1/settings/providers");
    const sel = $("#provider");
    sel.innerHTML = data.providers
      .map(
        (p) => {
          const reasonText = p.available ? "" : `（不可用：${esc(p.reason ?? "未知原因")}）`;
          return `<option value="${esc(p.id)}" ${p.id === data.active ? "selected" : ""} ${p.available ? "" : "disabled"}>
            ${esc(p.name)}${reasonText}</option>`;
        },
      )
      .join("");

    let prevValue = sel.value;
    sel.onchange = async () => {
      try {
        await api("/api/v1/settings/provider", { method: "PUT", body: JSON.stringify({ id: sel.value }) });
        $("#providerError").textContent = "";
        prevValue = sel.value;
      } catch (err) {
        sel.value = prevValue;
        $("#providerError").textContent = `切换引擎失败：${err.message}`;
      }
    };
    $("#providerError").textContent = "";
  } catch (err) {
    $("#providerError").textContent = `加载引擎列表失败：${err.message}`;
  }
}
// 注：#providerError 用 textContent 赋值（非 innerHTML），浏览器不解析其中的 HTML，天然安全，无需 esc。

document.querySelectorAll("nav button").forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll("nav button, .tab").forEach((el) => el.classList.remove("active"));
    btn.classList.add("active");
    $(`#tab-${btn.dataset.tab}`).classList.add("active");
    if (btn.dataset.tab === "records") {
      loadRecords().catch((err) => {
        $("#recordsList").innerHTML = `<p class="error">加载记录失败：${esc(err.message)}</p>`;
      });
    }
    if (btn.dataset.tab === "practice") {
      loadPractice().catch((err) => {
        $("#practiceView").innerHTML = `<p class="error">${esc(err.message)}</p>`;
      });
    }
  };
});

$("#polishBtn").onclick = async () => {
  const btn = $("#polishBtn");
  const out = $("#polishResult");
  btn.disabled = true;
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
            `<li class="sev-${esc(s.severity)}"><b>[${{ high: "硬伤", medium: "建议", low: "可选" }[s.severity] ?? esc(s.severity)}]</b>
             「${esc(s.original)}」→ ${esc(s.suggestion)}<br><small>${esc(s.reason)}</small></li>`,
        )
        .join("") +
      `</ul><h3>改写版全文 <button id="copyBtn">复制</button></h3><pre>${esc(data.revised)}</pre>`;
    $("#copyBtn").onclick = () => navigator.clipboard.writeText(data.revised);
  } catch (err) {
    out.innerHTML = `<p class="error">${esc(err.message)}</p>`;
  } finally {
    btn.disabled = false;
  }
};

$("#planBtn").onclick = async () => {
  const btn = $("#planBtn");
  const out = $("#planResult");
  btn.disabled = true;
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
      "<h3>备战重点</h3><ul>" + data.focusAreas.map((f) => `<li>${esc(f)}</li>`).join("") + "</ul>" +
      "<h3>预测面试题</h3>" +
      data.questions
        .map(
          (q) =>
            `<details><summary>[${esc(q.category)}] ${esc(q.question)}</summary><ul>` +
            q.answerOutline.map((a) => `<li>${esc(a)}</li>`).join("") +
            "</ul></details>",
        )
        .join("") +
      "<h3>冲刺计划</h3><ol>" +
      data.studyPlan.map((d) => `<li>D${d.day}：${esc(d.task)}</li>`).join("") +
      "</ol>";
  } catch (err) {
    out.innerHTML = `<p class="error">${esc(err.message)}</p>`;
  } finally {
    btn.disabled = false;
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
               <pre>${esc(JSON.stringify(r.result, null, 2))}</pre></details>`,
          )
          .join("");
}

async function loadPractice() {
  const view = $("#practiceView");
  const plan = await api("/api/v1/practice-plan");
  if (!plan) {
    view.innerHTML =
      '<p>还没有打卡计划。先在「面试方案」生成方案，然后回来一键生成。</p>' +
      '<button id="genPractice">从最近的面试方案生成打卡计划</button>' +
      '<p class="error" id="practiceError"></p>';
    $("#genPractice").onclick = async () => {
      const btn = $("#genPractice");
      btn.disabled = true;
      try {
        await api("/api/v1/practice-plan", { method: "POST", body: "{}" });
        await loadPractice();
      } catch (err) {
        $("#practiceError").textContent = err.message;
        btn.disabled = false;
      }
    };
    return;
  }
  const doneCount = plan.tasks.filter((t) => t.done).length;
  view.innerHTML =
    `<p class="meta">进度：${doneCount} / ${plan.tasks.length}</p>` +
    '<ul class="practice">' +
    plan.tasks
      .map(
        (t, i) =>
          `<li><label><input type="checkbox" data-index="${i}" ${t.done ? "checked" : ""}> ` +
          `<b>D${esc(t.day)}</b> ${esc(t.task)}${t.done ? `<small>（${esc(new Date(t.completedAt).toLocaleString("zh-CN"))} 完成）</small>` : ""}</label></li>`,
      )
      .join("") +
    '</ul><button id="regenPractice">重新生成（覆盖当前进度）</button><p class="error" id="practiceError"></p>';
  view.querySelectorAll("input[type=checkbox]").forEach((box) => {
    box.onchange = async () => {
      box.disabled = true;
      try {
        await api(`/api/v1/practice-plan/tasks/${box.dataset.index}`, {
          method: "PUT",
          body: JSON.stringify({ done: box.checked }),
        });
      } catch (err) {
        box.checked = !box.checked;
        box.disabled = false;
        $("#practiceError").textContent = err.message;
        return;
      }
      try {
        await loadPractice();
      } catch (err) {
        box.disabled = false;
        $("#practiceError").textContent = `已保存，但刷新失败：${err.message}`;
      }
    };
  });
  $("#regenPractice").onclick = async () => {
    const btn = $("#regenPractice");
    btn.disabled = true;
    try {
      await api("/api/v1/practice-plan", { method: "POST", body: "{}" });
      await loadPractice();
    } catch (err) {
      $("#practiceError").textContent = err.message;
      btn.disabled = false;
    }
  };
}

loadProviders().catch((err) => {
  $("#providerError").textContent = `初始化失败：${err.message}`;
});
