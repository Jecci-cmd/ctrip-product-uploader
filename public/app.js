const $ = (selector) => document.querySelector(selector);
let currentId = '';
let health = {};
let currentValidation = null;
let currentCtripProductId = '';

async function request(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `请求失败 ${response.status}`);
  return body;
}

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

request('/api/health').then((x) => { health = x; $('#health').textContent = `${x.aiConfigured ? 'AI 已配置' : 'AI 未配置（无法上传）'} · ${x.ctripLoggedIn ? '携程已登录' : '携程未登录'}`; if (currentValidation) renderValidation(currentValidation); }).catch(() => { $('#health').textContent = '服务异常'; });

const restoreRecordId = new URLSearchParams(location.search).get('record');
if (restoreRecordId) request(`/api/products/${encodeURIComponent(restoreRecordId)}`).then(showRecord).catch((error) => { $('#uploadMessage').textContent = `加载审核记录失败：${error.message}`; });
