# 携程团队游产品录入助手

员工上传产品资料后，系统完成 AI 结构化、合规校验，并把可可靠确定的内容保存到携程未提交产品。员工最后在携程人工核对 POI、图片、行程卡片、套餐、班期和条款，再自行提交审核和发布。

## 已实现流程

1. 上传 TXT、Markdown、DOCX 或文本型 PDF，可选上传一张已获授权的封面图。
2. 使用 UCloud ModelVerse Gemini 兼容接口（或 OpenAI 接口）抽取产品信息；未配置、超时或接口异常时直接报错，不使用本地规则解析。
3. 检查联系方式、绝对承诺、促销金额、天数一致性、推荐理由数量等规则。
4. 保存内部草稿，可在网页中修改 JSON 并重新校验。
5. 后台任务创建新携程产品，或填写员工指定的现有产品 ID。
6. 分步保存产品信息、推荐理由、产品特色、可选封面和每日行程草稿。
7. 返回携程人工审核链接；员工在网页勾选确认后，系统代为提交行程审核。
8. 行程校验通过后，继续保存套餐、测试价格库存班期、费用条款和高级设置。
9. 自动化始终保持套餐无效、产品下线；最终发布仍需员工在携程后台人工完成。

## 启动

```bash
npm install
cp .env.example .env
# 编辑 .env，填写 MODELVERSE_API_KEY
./scripts/start-local.sh
```

打开 `http://127.0.0.1:3000`。公网或局域网部署时将 `.env` 中的 `HOST` 改为 `0.0.0.0`，并必须设置高强度 `APP_ACCESS_PASSWORD`；未设置时服务会拒绝对外启动。公网域名必须通过 HTTPS 反向代理访问，并设置 `COOKIE_SECURE=1`。

## 员工登录与携程登录

推荐使用 `browser-extension/` 中的 Edge/Chrome 扩展：员工在自己电脑的浏览器中正常登录携程并人工完成安全验证，然后通过扩展把已登录会话同步给服务器。服务器会访问真实携程后台验证会话，通过后才保存；扩展不会读取携程密码或验证码。

Edge 安装：打开 `edge://extensions`，启用“开发人员模式”，点击“加载解压缩的扩展”，选择本项目的 `browser-extension` 文件夹。Chrome 对应打开 `chrome://extensions`。扩展中填写录入助手网址和内部访问密码，然后点击“检查并同步登录状态”。

员工先在网页输入 `APP_ACCESS_PASSWORD` 进入内部系统。携程首次登录或会话过期时，可以直接在网页“连接携程账号”区域输入携程账号和密码；密码只用于当前登录请求，不写入磁盘，登录成功后仅将携程 Cookie 保存到 `.auth/ctrip.json`。

携程要求安全验证时，系统会启动临时 Xvfb可视化桌面，并通过受员工会话保护的 noVNC连接把真实 Chromium嵌入网页。员工可亲手拖动拼图、图片点选、点击发送短信验证码并输入验证码；AI不识别或绕过验证码。登录成功后系统只保存携程 Cookie，并关闭临时浏览器和远程桌面。命令行备用登录方式为：

```bash
read 'CTRIP_USERNAME?携程账号: '
read -s 'CTRIP_PASSWORD?携程密码: '
export CTRIP_USERNAME CTRIP_PASSWORD
HEADLESS=0 npm run login
```

验证码在弹出的浏览器中人工完成。会话保存在 `.auth/ctrip.json`，不会进入 Git。不要把账号、密码、内部访问密码或 API Key 写入代码。

## 员工操作

1. 输入内部访问密码进入系统；首次使用或携程会话过期时，在网页连接携程账号。
2. 上传产品资料和可选封面。
3. 查看阻止项、确认项和提醒项；必要时编辑结构化草稿并保存。
4. 新产品直接点击“保存到携程草稿”；更新已有产品时先填携程产品 ID。
5. 等待任务完成，点击系统返回的“打开携程人工审核页面”。
6. 在携程补齐并核对图片、POI、酒店、交通、餐饮等字段。
7. 员工确认无误后，在本系统明确勾选授权并继续后续配置；最终上线仍由员工决定。

## 安全边界

- 永不点击“提交审核并下一步”“设为有效”“开班”“上线”或“发布”。
- 没有阻止项才允许创建携程草稿；班期、库存等确认项可以留到人工阶段。
- 图片仅在员工主动上传时使用，并默认不授权共享到携程公共图库。
- 自动化失败时保留已保存步骤和错误信息，可修正后重试。
- 产品资料、封面和浏览器会话分别保存在 `data/`、`uploads/`、`.auth/`，都已被 Git 忽略。
- 携程账号密码和验证码不保存；Gemini不接触登录凭据，也不用于识别或绕过验证码。

## 验证与诊断

```bash
npm test
node --check src/server.js
node --check src/ctrip-adapter.js
```

页面改版时可运行 `npm run inspect`。真实端到端测试脚本 `scripts/e2e-test-draft.js` 只应对明确的测试产品使用；它不会提交审核或上线。

## Linux 服务器运行

仓库的 `deploy/` 目录提供 systemd 和 Nginx模板。应用由专用 `ctripapp` 用户运行，Node.js仅监听 `127.0.0.1:3000`，Nginx负责公网入口。将配置分别安装为：

```text
/etc/systemd/system/ctrip-uploader.service
/etc/nginx/sites-available/ctrip-uploader
/etc/ctrip-uploader/app.env
/etc/ctrip-uploader/access.env
```

服务器需要安装 `chromium xvfb x11vnc`。使用 Chromium时，在 `app.env` 设置 `CHROME_PATH=/usr/bin/chromium`。绑定 Cloudflare HTTPS 域名后，将 `COOKIE_SECURE` 改为 `1`。noVNC WebSocket复用应用端口并受内部员工会话鉴权，不应单独开放 VNC端口。

`deploy/cloudflared-quick.service` 仅用于尚未绑定域名时的临时 HTTPS验证，生成的 `trycloudflare.com` 地址可能在服务重启后变化；生产环境应改用 Cloudflare命名隧道和自有域名。
