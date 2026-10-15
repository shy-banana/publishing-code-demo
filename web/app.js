(() => {
  const $ = id => document.getElementById(id);
  const routes = { checks: '/checks', reports: '/reports' };
  let busy = false;
  let requestId = 0;
  function clearData() {
    $('records').replaceChildren(); $('count').textContent = '—'; $('latest').textContent = '';
    $('checks').hidden = true; $('reports').hidden = true;
  }
  function status(text, error = false) {
    $('status').textContent = text; $('status').classList.toggle('error', error);
    $('status').setAttribute('role', error ? 'alert' : 'status');
  }
  function blocked(error) {
    clearData(); $('menus').replaceChildren();
    status(error.status === 403 ? '应用或菜单使用权已变化，请联系应用负责人。' : error.status === 401 ? '请重新完成公司登录。' : '权限或应用暂不可用，已清除本页数据，请稍后重试。', true);
  }
  async function request(path, options = {}) {
    let response;
    try { response = await fetch(path, { ...options, credentials: 'same-origin', headers: { Accept: 'application/json', ...options.headers } }); }
    catch { throw { status: 503 }; }
    const body = await response.json().catch(() => null);
    if (!response.ok || !body) throw { status: response.ok ? 503 : response.status, message: body?.message };
    return body;
  }
  function renderRecords(records) {
    $('records').replaceChildren();
    if (!records.length) { const item = document.createElement('li'); item.textContent = '暂无本人记录'; $('records').append(item); }
    for (const record of records) {
      const item = document.createElement('li'); item.textContent = record.title;
      const time = document.createElement('small'); time.textContent = new Date(record.created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
      item.append(time); $('records').append(item);
    }
  }
  async function load() {
    const current = ++requestId;
    clearData(); $('menus').replaceChildren(); status('正在检查权限…');
    try {
      const permissions = await request('/_platform/permissions');
      if (current !== requestId) return;
      const menus = Array.isArray(permissions.menus) ? permissions.menus.filter(menu => routes[menu.id]) : [];
      if (!menus.length) throw { status: 403 };
      const wanted = Object.keys(routes).find(id => routes[id] === location.pathname);
      if (wanted && !menus.some(menu => menu.id === wanted)) throw { status: 403 };
      const selected = wanted || menus[0].id;
      if (!wanted) history.replaceState(null, '', routes[selected]);
      for (const menu of menus) { const link = document.createElement('a'); link.href = routes[menu.id]; link.textContent = menu.name; if (menu.id === selected) link.setAttribute('aria-current', 'page'); $('menus').append(link); }
      const data = await request(selected === 'checks' ? '/api/checks' : '/api/reports');
      if (current !== requestId) return;
      if (selected === 'checks') { renderRecords(data.records); $('checks').hidden = false; }
      else { $('count').textContent = data.summary.count; $('latest').textContent = data.summary.latest_created_at ? '最近保存：' + new Date(data.summary.latest_created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '暂无本人记录'; $('reports').hidden = false; }
      status('已按当前菜单权限载入本人数据。');
    } catch (error) { if (current === requestId) blocked(error); }
  }
  $('refresh').addEventListener('click', load);
  $('check-form').addEventListener('submit', async event => {
    event.preventDefault(); if (busy) return;
    busy = true; $('save').disabled = true;
    const current = ++requestId;
    try {
      await request('/api/checks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: $('title').value }) });
      if (current !== requestId) return;
      $('title').value = ''; await load();
      if (!$('checks').hidden) status('记录已保存，刷新后仍可查看。');
    } catch (error) {
      if (current !== requestId) return;
      if ([401, 403, 503].includes(error.status)) blocked(error);
      else status(error.message || '保存失败，请检查填写内容后重试。', true);
    } finally { busy = false; $('save').disabled = false; }
  });
  load();
})();
