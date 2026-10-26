"use strict";
(() => {
  const token = new URLSearchParams(location.search).get("invite"),
    form = document.querySelector("#friend-questionnaire"),
    result = document.querySelector("#friend-result"),
    button = document.querySelector("#submit-friend");
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      token || "",
    )
  ) {
    button.disabled = true;
    result.textContent =
      "Для анкеты нужна личная ссылка-приглашение от Сабиши.";
    return;
  }
  const client = window.supabase.createClient(
    window.SABISHA_CLOUD.url,
    window.SABISHA_CLOUD.key,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );
  const key = "sabisha-questionnaire-" + token;
  let draft = { id: crypto.randomUUID(), values: {} };
  try {
    const prior = JSON.parse(localStorage.getItem(key));
    if (prior?.id && prior.values) draft = prior;
  } catch {}
  function persist() {
    try {
      localStorage.setItem(key, JSON.stringify(draft));
    } catch {}
  }
  function success() {
    form.hidden = true;
    document.querySelector("#friend-success").hidden = false;
  }
  if (draft.sent) {
    success();
    return;
  }
  for (const field of form.querySelectorAll("input,textarea")) {
    field.value = draft.values[field.name] || "";
    field.addEventListener("input", () => {
      draft.values[field.name] = field.value;
      persist();
    });
  }
  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(form),
      name = f.get("name").trim();
    if (!name) {
      result.textContent = "Напиши своё имя или ник.";
      return;
    }
    button.disabled = true;
    result.textContent = "Отправляем анкету…";
    const answers = {};
    for (const k of [
      "nickname",
      "birthday",
      "music",
      "hobbies",
      "memory",
      "wish",
    ])
      answers[k] = f.get(k).trim();
    try {
      const { data, error } = await client.rpc("sabisha_submit_friend", {
        p_invite: token,
        p_submission_id: draft.id,
        p_name: name,
        p_answers: answers,
      });
      if (error) throw error;
      if (data !== true) throw Error("not_saved");
      draft = { id: draft.id, values: {}, sent: true };
      persist();
      success();
    } catch (error) {
      const text = String(error.message || "");
      result.textContent = text.includes("invalid_invitation")
        ? "Ссылка больше не действует. Попроси Сабишу прислать новую."
        : text.includes("too_many")
          ? "Анкет сейчас слишком много. Попробуй отправить позже."
          : "Не удалось отправить. Текст сохранён на этом устройстве — попробуй ещё раз.";
      button.disabled = false;
    }
  };
})();
