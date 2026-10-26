/* Supabase persistence adapter. The website itself remains static on GitHub Pages. */
(() => {
  "use strict";
  const app = window.SabishaApp,
    cfg = window.SABISHA_CLOUD;
  if (!app || !cfg?.url || !cfg?.key || !window.supabase) return;
  const client = window.supabase.createClient(cfg.url, cfg.key, {auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  const META = "sabisha-cloud-meta-v1";
  let meta = { owner: null, revision: 0, dirty: false };
  try {
    const m = JSON.parse(localStorage.getItem(META));
    if (m && Number.isInteger(m.revision)) meta = m;
  } catch {}
  let password = null;
  let session = null,
    loadedOwner = null,
    busy = false,
    queued,
    changes = 0,
    conflict = null,
    invite = null,
    recovery = false;
  let status = "Облако подключается автоматически",
    signUpMode = false;
  const rootUrl = new URL("./", location.href).href;
  const $ = (s) => document.querySelector(s);
  const esc = app.escape;
  function remember() {
    try {
      localStorage.setItem(META, JSON.stringify(meta));
    } catch {
      app.notify("Не удалось сохранить состояние синхронизации на устройстве.");
    }
  }
  function statusText(text) {
    status = text;
    document
      .querySelectorAll("[data-cloud-status]")
      .forEach((el) => (el.textContent = text));
  }
  function changed() {
    changes++;
    meta.dirty = true;
    remember();
    statusText(
      session
        ? "Сохранено на устройстве · отправляем в облако…"
        : "Сохранено только на устройстве",
    );
    clearTimeout(queued);
    queued = setTimeout(sync, 900);
  }
  function isEmpty(d) {
    return (
      !["friends", "enemies", "tasks", "notes", "dreams", "quests", "stars"].some(
        (k) => d[k].length,
      ) &&
      !Object.keys(d.drafts).length && !d.game && !d.puzzleState && !d.capsule &&
      !d.drawing &&
      !Object.keys(d.moods).length
    );
  }
  async function rpc(action, extra={}) {
    const {data,error}=await client.rpc("sabisha_world",{p_password:password,p_action:action,...extra}).abortSignal(AbortSignal.timeout(10000));
    if(error) throw error;
    return data;
  }
  async function remoteWorld(){return rpc("open");}
  function acceptRemote(world) {
    app.replaceState(world.content);
    meta = {
      owner: session.user.id,
      revision: Number(world.revision),
      dirty: false,
    };
    remember();
    app.refresh();
  }
  async function initialize(next) {
    if (!next) {
      session = null;
      loadedOwner = null;
      invite = null;
      statusText("Сохранено только на устройстве · облако не подключено");
      mount();
      return;
    }
    session = next;
    if (loadedOwner === session.user.id) return;
    if (busy) {
      setTimeout(() => initialize(next), 500);
      return;
    }
    busy = true;
    try {
      statusText("Подключаем твою вселенную…");
      const world = await remoteWorld();
      invite = world.invite_token;
      const sameOwner = meta.owner === session.user.id;
      if (
        world.content &&
        ((!sameOwner && !isEmpty(app.getState())) ||
          (sameOwner && meta.dirty && meta.revision !== Number(world.revision)))
      ) {
        conflict = world;
        statusText("Есть две версии записей · выбери в настройках");
      } else if (world.content && (!sameOwner || !meta.dirty)) {
        acceptRemote(world);
        statusText("Облако подключено · записи восстановлены");
      } else {
        meta.owner = session.user.id;
        meta.revision = Number(world.revision);
        meta.dirty = true;
        remember();
      }
      loadedOwner = session.user.id;
      mount();
    } catch (error) {
      statusText("Облако недоступно · записи остаются на устройстве");
      app.notify(message(error));
    } finally {
      busy = false;
    }
    if (loadedOwner) sync();
  }
  function message(){return "Нет связи с облаком. Изменения ждут отправки на устройстве.";}
  async function sync() {
    if(password && !loadedOwner && !busy && navigator.onLine){await initialize({user:{id:"sabisha"}});return;}
    if (!session || !loadedOwner || conflict || !navigator.onLine) return;
    if (busy) {
      clearTimeout(queued);
      queued = setTimeout(sync, 1000);
      return;
    }
    busy = true;
    try {
      const head = await remoteWorld();
      invite = head.invite_token;
      if (Number(head.revision) !== meta.revision) {
        const remote = await remoteWorld();
        if (meta.dirty) {
          conflict = remote;
          statusText("Есть изменения на другом устройстве · открой настройки");
          mount();
          return;
        }
        acceptRemote(remote);
      }
      if (meta.dirty) {
        const generation = changes,
          snapshot = app.getState();
        let revision, saveError;
        try {revision=await rpc("save",{p_content:snapshot,p_revision:meta.revision});}
        catch(e){saveError=e;}
        if (saveError) {
          if (String(saveError.message).includes("revision_conflict")) {
            conflict = await remoteWorld();
            statusText("Две версии записей · открой настройки");
            mount();
            return;
          }
          throw saveError;
        }
        meta.revision = Number(revision);
        meta.owner = session.user.id;
        meta.dirty = changes !== generation;
        remember();
      }
      const requests = await rpc("inbox");
      const count = app.receiveFriends(requests || []);
      if (count)
        app.notify(`Новых анкет: ${count}. Друзья уже в твоём списке ♡`);
      statusText(
        meta.dirty
          ? "Сохранено на устройстве · синхронизируем…"
          : "Сохранено в облаке ✓",
      );
      updateInvitation();
    } catch (error) {
      statusText("Пока только на устройстве · облако недоступно");
    } finally {
      busy = false;
      if (meta.dirty && !conflict) {
        clearTimeout(queued);
        queued = setTimeout(sync, 10000);
      }
    }
  }
  function invitationUrl() {
    if (!invite) return "";
    const url = new URL("friend.html", rootUrl);
    url.searchParams.set("invite", invite);
    return url.href;
  }
  async function copyLink() {
    const url = invitationUrl();
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      app.notify("Ссылка на анкету скопирована ♡");
    } catch {
      const input = $("#friend-link");
      if (input) {
        input.focus();
        input.select();
        app.notify("Выделила ссылку — скопируй её.");
      }
    }
  }
  function updateInvitation() {
    const area = $("#friend-cloud");
    if (!area) return;
    if (!session || !invite) {
      area.innerHTML =
        '<h2>Анкета для друзей ♡</h2><p>Друг заполнит анкету по ссылке, и она сама появится здесь.</p><button class="button lime" data-nav="settings">Подключить облако ↗</button>';
      return;
    }
    const current = $("#friend-link");
    if (current) {
      current.value = invitationUrl();
      return;
    }
    area.innerHTML = `<h2>Анкета для друзей ♡</h2><p>Отправь эту ссылку другу. Ему не нужен пароль от твоего мира: только заполнить и нажать «Отправить».</p><label for="friend-link">Ссылка на анкету</label><div class="input-row"><input id="friend-link" readonly value="${esc(invitationUrl())}"><button id="copy-friend-link" class="button pink">Копировать</button></div><div class="settings-actions" style="margin-top:15px"><button class="button" id="share-friend-link">Поделиться ↗</button><button class="text-button" id="refresh-friends">Проверить ответы</button></div><p class="small">Ответы появляются автоматически, пока сайт открыт. <span data-cloud-status>${esc(status)}</span></p>`;
    $("#copy-friend-link").onclick = copyLink;
    $("#share-friend-link").onclick = async () => {
      if (navigator.share) {
        try {
          await navigator.share({
            title: "Анкета для Сабиши ♡",
            text: "Заполни мою маленькую анкету!",
            url: invitationUrl(),
          });
        } catch (error) {
          if (error.name !== "AbortError") copyLink();
        }
      } else copyLink();
    };
    $("#refresh-friends").onclick = sync;
  }
  function mount(){
    updateInvitation();
    const host=$("#cloud-panel"); if(!host)return;
    host.innerHTML=`<h2>Твоя вселенная в облаке ☁</h2><p data-cloud-status>${esc(status)}</p><p>На любом устройстве введи 2610 — и твои записи появятся здесь. Без интернета изменения сохраняются на устройстве и отправятся, когда связь вернётся.</p><div class="settings-actions"><button id="cloud-sync" class="button lime">Синхронизировать</button><button id="cloud-backups" class="button">История сохранений</button></div><div id="backup-list"></div><p class="help">Храним последние 30 версий для восстановления.</p>${conflict?'<div class="prompt-box"><h3>На устройствах разные версии</h3><p>Скачай местную копию перед выбором версии.</p><button id="conflict-export" class="button">Скачать копию</button><button id="use-cloud" class="button">Взять облачную</button><button id="use-local" class="button">Сохранить местную</button></div>':''}`;
    $("#cloud-sync").onclick=sync; $("#cloud-backups").onclick=showBackups;
    if(conflict){
      $("#conflict-export").onclick=app.downloadState;
      $("#use-cloud").onclick=async()=>{if(!await app.confirm("Заменить местные записи облачными?"))return;const w=conflict;conflict=null;acceptRemote(w);mount();sync();};
      $("#use-local").onclick=async()=>{if(!await app.confirm("Сохранить местную версию? Облачная останется в истории."))return;meta.revision=Number(conflict.revision);meta.owner="sabisha";meta.dirty=true;conflict=null;remember();mount();sync();};
    }
  }
  async function showBackups() {
    const target = $("#backup-list");
    target.textContent = "Загружаем историю…";
    let rows;
    try{rows=await rpc("history");}catch(e){target.textContent=message(e);return;}
    target.innerHTML = rows.length
      ? rows
          .map(
            (row) =>
              `<div class="list-item"><span class="grow">Версия ${row.revision}<br><span class="small">${new Date(row.created_at).toLocaleString("ru-RU")}</span></span><button class="button" data-restore="${row.revision}">Восстановить</button></div>`,
          )
          .join("")
      : "Предыдущие версии появятся после следующих сохранений.";
    target.querySelectorAll("[data-restore]").forEach(
      (b) =>
        (b.onclick = async () => {
          if (
            !(await app.confirm(
              "Восстановить эту версию? Текущая облачная версия останется в истории.",
            ))
          )
            return;
          let content;try{content=await rpc("backup",{p_revision:Number(b.dataset.restore)});}catch(e){app.notify(message(e));return;}
          try {
            app.replaceState(content);
            app.refresh();
            changed();
            await sync();
          } catch {
            app.notify("Эту версию не удалось прочитать.");
          }
        }),
    );
  }
  window.SabishaCloud = { changed, mount, sync, unlock: async(code)=>{password=code; await initialize({user:{id:"sabisha"}});}, lock:()=>{password=null;session=null;loadedOwner=null;} };
  window.addEventListener("online", () => {
    statusText("Связь появилась · синхронизируем…");
    sync();
  });
  window.addEventListener("offline", () =>
    statusText("Без интернета · изменения сохраняются на устройстве"),
  );
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) sync();
  });
  setInterval(() => {
    if (!document.hidden) sync();
  }, 15000);
  mount();
})();
