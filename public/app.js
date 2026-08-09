import RFB from '/novnc/core/rfb.js';

const $ = (selector) => document.querySelector(selector);
let currentId = '';
let health = {};
let currentValidation = null;
let currentCtripProductId = '';
let ctripLoginTaskId = '';
let remoteRfb = null;
let remoteTaskId = '';
let remotePoll = null;

async function request(url, options) {
  let response;
  try { response = await fetch(url, options); }
  catch (firstError) {
    const method = options?.method || 'GET';
    if (method !== 'GET' && url !== '/api/access/login') throw new Error('无法连接服务器，请检查网络后重试');
    await new Promise((resolve) => setTimeout(resolve, 800));
    try { response = await fetch(url, options); }
    catch { throw new Error('无法连接服务器，Cloudflare临时通道可能正在重连，请稍后刷新页面'); }
  }
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 && !url.startsWith('/api/access/')) showAccessGate();
  if (!response.ok) throw new Error(body.error || `请求失败 ${response.status}`);
  return body;
}

function showAccessGate() {
  $('#accessGate').classList.remove('hidden');
  $('#appShell').classList.add('hidden');
}

function showApp() {
  $('#accessGate').classList.add('hidden');
  $('#appShell').classList.remove('hidden');
}

async function refreshHealth() {
  health = await request('/api/health');
  $('#health').textContent = `${health.aiConfigured ? 'AI 已配置' : 'AI 未配置（无法上传）'} · ${health.ctripLoggedIn ? '携程已登录' : '携程未登录'}`;
  $('#ctripConnectionState').textContent = health.ctripLoggedIn ? '当前服务器已有可复用的携程登录会话' : '请先登录携程，再进行自动录入';
  $('#ctripLoginForm').classList.toggle('hidden', health.ctripLoggedIn);
  if (health.ctripLoggedIn) $('#ctripVerify').classList.add('hidden');
  if (currentValidation) renderValidation(currentValidation);
}

function renderCtripLogin(task) {
  ctripLoginTaskId = task.id || ctripLoginTaskId;
  $('#ctripLoginMessage').textContent = task.message || '';
  $('#ctripPassword').value = '';
  if (task.status === 'success') {
    stopRemoteBrowser();
    $('#ctripVerify').classList.add('hidden');
    refreshHealth().catch((error) => { $('#ctripConnectionState').textContent = error.message; });
    return;
  }
  $('#ctripVerify').classList.remove('hidden');
  if (task.remoteAvailable) startRemoteBrowser(task.id);
  if (ctripLoginTaskId) $('#ctripScreenshot').src = `/api/ctrip-login/${encodeURIComponent(ctripLoginTaskId)}/screenshot?t=${Date.now()}`;
  $('#ctripCodeForm').classList.toggle('hidden', task.status !== 'verification_required');
}

function stopRemoteBrowser() {
  clearInterval(remotePoll); remotePoll = null;
  remoteRfb?.disconnect(); remoteRfb = null; remoteTaskId = '';
  $('#vncScreen').classList.add('hidden');
  $('#vncScreen').replaceChildren();
}

function startRemoteBrowser(taskId) {
  if (remoteRfb && remoteTaskId === taskId) return;
  stopRemoteBrowser();
  remoteTaskId = taskId;
  const screen = $('#vncScreen');
  screen.classList.remove('hidden');
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  remoteRfb = new RFB(screen, `${protocol}://${location.host}/api/ctrip-login/${encodeURIComponent(taskId)}/vnc`, { shared: true });
  remoteRfb.scaleViewport = true;
  remoteRfb.resizeSession = false;
  remoteRfb.viewOnly = false;
  remoteRfb.focusOnClick = true;
  remoteRfb.addEventListener('connect', () => { $('#ctripLoginMessage').textContent = '远程携程浏览器已连接，请人工完成滑动拼图或其他验证'; });
  remoteRfb.addEventListener('securityfailure', () => { $('#ctripLoginMessage').textContent = '远程验证画面连接失败，请刷新后重试'; });
  remoteRfb.addEventListener('disconnect', (event) => { if (!event.detail.clean && remoteTaskId) $('#ctripLoginMessage').textContent = '远程验证画面已断开，请刷新状态或重新登录'; });
  remotePoll = setInterval(async () => {
    if (!remoteTaskId) return;
    try {
      const task = await request(`/api/ctrip-login/${encodeURIComponent(remoteTaskId)}/refresh`, { method: 'POST' });
      if (task.status === 'success') renderCtripLogin(task);
    } catch (error) {
      if (!/不存在|结束/.test(error.message)) $('#ctripLoginMessage').textContent = error.message;
    }
  }, 2500);
}

$('#accessForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.submitter; button.disabled = true;
  try {
    await request('/api/access/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: $('#accessPassword').value }) });
    $('#accessPassword').value = ''; $('#accessMessage').textContent = ''; showApp(); await refreshHealth(); restoreRecord();
  } catch (error) { $('#accessMessage').textContent = error.message; }
  finally { button.disabled = false; }
});

$('#ctripLoginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.submitter; button.disabled = true; $('#ctripConnectionState').textContent = '正在登录携程…';
  try {
    const task = await request('/api/ctrip-login/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: $('#ctripUsername').value, password: $('#ctripPassword').value }) });
    renderCtripLogin(task); $('#ctripConnectionState').textContent = task.message;
  } catch (error) { $('#ctripPassword').value = ''; $('#ctripConnectionState').textContent = error.message; }
  finally { button.disabled = false; }
});

$('#ctripCodeForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.submitter; button.disabled = true;
  try {
    const task = await request(`/api/ctrip-login/${encodeURIComponent(ctripLoginTaskId)}/code`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: $('#ctripCode').value }) });
    $('#ctripCode').value = ''; renderCtripLogin(task);
  } catch (error) { $('#ctripLoginMessage').textContent = error.message; }
  finally { button.disabled = false; }
});

$('#sendCtripCode').addEventListener('click', async (event) => {
  const button = event.currentTarget; button.disabled = true;
  try { renderCtripLogin(await request(`/api/ctrip-login/${encodeURIComponent(ctripLoginTaskId)}/send-code`, { method: 'POST' })); }
  catch (error) { $('#ctripLoginMessage').textContent = error.message; }
  finally { button.disabled = false; }
});

$('#ctripScreenshot').addEventListener('click', async (event) => {
  if (!ctripLoginTaskId || !event.currentTarget.naturalWidth) return;
  const image = event.currentTarget;
  const rect = image.getBoundingClientRect();
  const x = (event.clientX - rect.left) * image.naturalWidth / rect.width;
  const y = (event.clientY - rect.top) * image.naturalHeight / rect.height;
  $('#ctripLoginMessage').textContent = '正在操作携程验证画面…';
  try {
    renderCtripLogin(await request(`/api/ctrip-login/${encodeURIComponent(ctripLoginTaskId)}/click`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ x, y }) }));
  } catch (error) { $('#ctripLoginMessage').textContent = error.message; }
});

$('#refreshCtripLogin').addEventListener('click', async () => {
  try { renderCtripLogin(await request(`/api/ctrip-login/${encodeURIComponent(ctripLoginTaskId)}/refresh`, { method: 'POST' })); }
  catch (error) { $('#ctripLoginMessage').textContent = error.message; }
});

function renderValidation(validation) {
  currentValidation = validation;
  const { counts, issues, canCreateDraft } = validation;
  $('#summary').innerHTML = `<div class="score ${canCreateDraft ? 'pass' : ''}">${canCreateDraft ? '可进入自动录入' : '需要处理'}<span>阻止 ${counts.blocker} · 确认 ${counts.confirm} · 提醒 ${counts.warning}</span></div>`;
  $('#issues').innerHTML = issues.length ? issues.map((x) => `<article class="issue ${x.severity}"><b>${x.severity === 'blocker' ? '阻止' : x.severity === 'confirm' ? '确认' : '提醒'}</b><code>${x.field}</code><p>${x.message}</p></article>`).join('') : '<p class="empty">没有发现问题</p>';
  $('#ctripDraft').disabled = !canCreateDraft || !health.ctripDraftEnabled || !health.ctripLoggedIn;
}

function showRecord(record) {
  currentId = record.id;
  $('#workspace').classList.remove('hidden');
  $('#parser').textContent = record.parser === 'modelverse-gemini' ? 'Gemini结构化' : record.parser === 'openai' ? 'OpenAI结构化' : '规则解析';
  $('#title').textContent = record.product.basic.title || '未命名产品';
  $('#warning').textContent = record.warning || '';
  $('#jsonEditor').value = JSON.stringify(record.product, null, 2);
  renderValidation(record.validation);
  if (record.ctrip?.productId) {
    currentCtripProductId = String(record.ctrip.productId);
    $('#ctripProductId').value = currentCtripProductId;
  }
  if (record.status === 'ctrip_draft' && record.ctrip?.reviewUrl) {
    const todos = (record.ctrip.manualTodos || []).map((x) => `<li>${x}</li>`).join('');
    $('#job').classList.remove('hidden');
    $('#job').innerHTML = `<b>携程草稿已保存</b><p>产品ID：${record.ctrip.productId}</p><a href="${record.ctrip.reviewUrl}" target="_blank" rel="noopener">打开携程人工审核页面</a><h3>员工待办</h3><ul>${todos}</ul><p>${record.ctrip.safety || ''}</p>`;
    $('#employeeApproval').classList.remove('hidden');
  }
}

$('#material').addEventListener('change', (event) => { $('#fileLabel').textContent = event.target.files[0]?.name || '选择产品资料'; });
$('#cover').addEventListener('change', (event) => { $('#coverLabel').textContent = event.target.files[0]?.name || '可选：授权封面图'; });
$('#uploadForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true; $('#uploadMessage').textContent = '正在读取和结构化资料…';
  try { const data = await request('/api/products', { method: 'POST', body: new FormData(event.currentTarget) }); showRecord(data); $('#uploadMessage').textContent = '草稿生成完成'; }
  catch (error) { $('#uploadMessage').textContent = error.message; }
  finally { button.disabled = false; }
});

$('#save').addEventListener('click', async () => {
  try {
    const product = JSON.parse($('#jsonEditor').value);
    const data = await request(`/api/products/${currentId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ product }) });
    showRecord(data); $('#uploadMessage').textContent = '内部草稿已保存并重新校验';
  } catch (error) { $('#uploadMessage').textContent = `保存失败：${error.message}`; }
});

async function monitorJob(jobId) {
  const panel = $('#job');
  panel.classList.remove('hidden');
  while (true) {
    const job = await request(`/api/jobs/${jobId}`);
    panel.innerHTML = `<b>${job.status === 'running' ? '正在写入携程草稿' : job.status === 'done' ? '携程草稿已保存' : '携程写入失败'}</b><p>${job.currentStep || job.error || ''}</p>`;
    if (job.status === 'done') {
      currentCtripProductId = job.result.productId;
      if (job.type === 'employee_approved_continue') {
        panel.innerHTML += `<p>产品ID：${job.result.productId}</p><p>${job.result.safety}</p><strong>第二阶段已经解锁，可以继续自动填写后续模块。</strong>`;
        $('#employeeApproval').classList.add('hidden');
      } else {
        const todos = (job.result.manualTodos || []).map((x) => `<li>${x}</li>`).join('');
        panel.innerHTML += `<p>产品ID：${job.result.productId}</p><a href="${job.result.reviewUrl}" target="_blank" rel="noopener">打开携程人工审核页面</a><h3>员工待办</h3><ul>${todos}</ul><p>${job.result.safety}</p>`;
        $('#employeeApproval').classList.remove('hidden');
      }
      break;
    }
    if (job.status === 'failed') { panel.innerHTML += `<p>${job.error}</p>`; break; }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  $('#ctripDraft').disabled = !currentValidation?.canCreateDraft;
}

$('#ctripDraft').addEventListener('click', async () => {
  const button = $('#ctripDraft');
  button.disabled = true;
  try {
    const productId = $('#ctripProductId').value.trim();
    const job = await request(`/api/products/${currentId}/ctrip-draft`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId: productId || undefined }) });
    await monitorJob(job.id);
  } catch (error) { $('#job').classList.remove('hidden'); $('#job').textContent = error.message; button.disabled = false; }
});

$('#approvalCheck').addEventListener('change', (event) => { $('#continueStage2').disabled = !event.target.checked; });
$('#continueStage2').addEventListener('click', async () => {
  if (!$('#approvalCheck').checked) return;
  const button = $('#continueStage2');
  button.disabled = true;
  try {
    const productId = currentCtripProductId || $('#ctripProductId').value.trim();
    const job = await request(`/api/products/${currentId}/ctrip-continue`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approved: true, productId }) });
    await monitorJob(job.id);
  } catch (error) { $('#job').classList.remove('hidden'); $('#job').textContent = error.message; button.disabled = false; }
});

const restoreRecordId = new URLSearchParams(location.search).get('record');
let restored = false;
function restoreRecord() {
  if (!restoreRecordId || restored) return;
  restored = true;
  request(`/api/products/${encodeURIComponent(restoreRecordId)}`).then(showRecord).catch((error) => { $('#uploadMessage').textContent = `加载审核记录失败：${error.message}`; });
}

request('/api/access/status').then(async (status) => {
  if (!status.authenticated) return showAccessGate();
  showApp(); await refreshHealth(); restoreRecord();
}).catch(() => { showAccessGate(); $('#accessMessage').textContent = '服务异常，请联系管理员'; });
