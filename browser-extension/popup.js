const serverUrl = document.querySelector('#serverUrl');
const accessPassword = document.querySelector('#accessPassword');
const syncButton = document.querySelector('#sync');
const message = document.querySelector('#message');

chrome.storage.local.get(['serverUrl'], (stored) => { if (stored.serverUrl) serverUrl.value = stored.serverUrl; });

function show(text, kind = '') {
  message.textContent = text;
  message.className = kind;
}

document.querySelector('#openCtrip').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://vbooking.ctrip.com/ivbk/accountV2/login' });
});

syncButton.addEventListener('click', async () => {
  const base = serverUrl.value.trim().replace(/\/+$/, '');
  const password = accessPassword.value;
  if (!/^https?:\/\//i.test(base)) return show('请输入完整的录入助手网址，例如 https://example.com', 'error');
  if (!password) return show('请输入内部访问密码', 'error');
  syncButton.disabled = true;
  show('正在读取并验证本机携程会话…');
  try {
    const serverOrigin = `${new URL(base).origin}/*`;
    const granted = await chrome.permissions.request({ origins: [serverOrigin] });
    if (!granted) throw new Error('需要授权扩展连接录入助手服务器');
    await chrome.storage.local.set({ serverUrl: base });
    const cookies = await chrome.cookies.getAll({ url: 'https://vbooking.ctrip.com/' });
    if (!cookies.length) throw new Error('当前浏览器没有携程 Cookie，请先登录携程供应商后台');
    const tabs = await chrome.tabs.query({ url: 'https://vbooking.ctrip.com/*' });
    let origins = [];
    if (tabs[0]?.id) {
      const [{ result: localStorage = [] }] = await chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: () => Object.keys(window.localStorage).map((name) => ({ name, value: window.localStorage.getItem(name) })),
      });
      origins = [{ origin: 'https://vbooking.ctrip.com', localStorage }];
    }
    const response = await fetch(`${base}/api/ctrip-session/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Access-Password': password },
      body: JSON.stringify({ cookies, origins }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `服务器返回 ${response.status}`);
    accessPassword.value = '';
    show(result.message || '同步成功，可以回到录入助手继续操作', 'success');
  } catch (error) {
    show(error.message === 'Failed to fetch' ? '无法连接录入助手服务器，请检查网址、HTTPS证书和服务器状态' : error.message, 'error');
  } finally {
    syncButton.disabled = false;
  }
});
