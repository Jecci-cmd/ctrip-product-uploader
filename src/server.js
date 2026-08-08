import express from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseMaterial } from './parser.js';
import { extractMaterial } from './material.js';
import { saveCtripDraft, submitItineraryReview } from './ctrip-adapter.js';
import { validateProduct } from './validate.js';
import { createRecord, getRecord, listRecords, updateRecord, updateRecordState } from './store.js';
import { createAccessAuth } from './access-auth.js';
import { CtripLoginManager } from './ctrip-login-manager.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 2 } });
const jobs = new Map();
const access = createAccessAuth();
const ctripLogin = new CtripLoginManager();
const cleanError = (error) => String(error?.message || error).replace(/\u001b\[[0-9;]*m/g, '').replace(/Call log:[\s\S]*/m, '').trim();

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.resolve(here, '..', 'public')));

app.get('/api/access/status', (req, res) => res.json({ authenticationRequired: access.enabled, authenticated: access.authenticated(req) }));
app.post('/api/access/login', (req, res) => access.login(req, res));
app.post('/api/access/logout', (req, res) => access.logout(req, res));
app.use('/api', access.requireAccess);

app.post('/api/ctrip-login/start', async (req, res, next) => {
  try { res.status(201).json(await ctripLogin.start(req.body?.username, req.body?.password)); }
  catch (error) { next(error); }
});
app.post('/api/ctrip-login/:id/code', async (req, res, next) => {
  try { res.json(await ctripLogin.submitCode(req.params.id, req.body?.code)); }
  catch (error) { next(error); }
});
app.post('/api/ctrip-login/:id/send-code', async (req, res, next) => {
  try { res.json(await ctripLogin.sendCode(req.params.id)); }
  catch (error) { next(error); }
});
app.post('/api/ctrip-login/:id/click', async (req, res, next) => {
  try { res.json(await ctripLogin.clickAt(req.params.id, req.body?.x, req.body?.y)); }
  catch (error) { next(error); }
});
app.post('/api/ctrip-login/:id/refresh', async (req, res, next) => {
  try { res.json(await ctripLogin.refresh(req.params.id)); }
  catch (error) { next(error); }
});
app.get('/api/ctrip-login/:id/screenshot', async (req, res, next) => {
  try { res.type('png').set('Cache-Control', 'no-store').send(await ctripLogin.screenshot(req.params.id)); }
  catch (error) { next(error); }
});
app.delete('/api/ctrip-login/:id', async (req, res, next) => {
  try { await ctripLogin.cancel(req.params.id); res.json({ ok: true }); }
  catch (error) { next(error); }
});

app.get('/api/health', async (_req, res) => res.json({
  ok: true,
  aiConfigured: Boolean(process.env.MODELVERSE_API_KEY || process.env.OPENAI_API_KEY),
  aiProvider: process.env.MODELVERSE_API_KEY ? 'modelverse-gemini' : process.env.OPENAI_API_KEY ? 'openai' : 'unconfigured',
  ctripDraftEnabled: true,
  ctripLoggedIn: await fs.access(path.resolve(here, '..', '.auth', 'ctrip.json')).then(() => true).catch(() => false),
}));
app.get('/api/products', async (_req, res, next) => { try { res.json(await listRecords()); } catch (error) { next(error); } });
app.get('/api/products/:id', async (req, res, next) => { try { const record = await getRecord(req.params.id); res.json({ ...record, validation: validateProduct(record.product) }); } catch (error) { next(error); } });

app.post('/api/products', upload.fields([{ name: 'material', maxCount: 1 }, { name: 'cover', maxCount: 1 }]), async (req, res, next) => {
  try {
    const material = req.files?.material?.[0];
    const cover = req.files?.cover?.[0];
    if (!material) return res.status(400).json({ error: '请选择产品资料文件' });
    const rawText = (await extractMaterial(material)).replace(/\r\n?/g, '\n').trim();
    if (!rawText) return res.status(400).json({ error: '文件内容为空' });
    const parsed = await parseMaterial(rawText, material.originalname);
    let record = await createRecord({ ...parsed, rawText });
    if (cover) {
      if (!/^image\/(jpeg|png|webp)$/.test(cover.mimetype)) return res.status(415).json({ error: '封面仅支持 JPG、PNG、WebP' });
      const dir = path.resolve(here, '..', 'uploads', record.id);
      await fs.mkdir(dir, { recursive: true, mode: 0o700 });
      const ext = cover.mimetype === 'image/png' ? '.png' : cover.mimetype === 'image/webp' ? '.webp' : '.jpg';
      const coverPath = path.join(dir, `cover${ext}`);
      await fs.writeFile(coverPath, cover.buffer, { mode: 0o600 });
      record = await updateRecordState(record.id, { attachments: { coverPath, coverName: cover.originalname } });
    }
    res.status(201).json({ ...record, validation: validateProduct(record.product) });
  } catch (error) { next(error); }
});

app.put('/api/products/:id', async (req, res, next) => {
  try {
    if (!req.body?.product) return res.status(400).json({ error: '缺少 product' });
    const record = await updateRecord(req.params.id, req.body.product);
    res.json({ ...record, validation: validateProduct(record.product) });
  } catch (error) { next(error); }
});

app.post('/api/products/:id/validate', async (req, res, next) => { try { const record = await getRecord(req.params.id); res.json(validateProduct(record.product)); } catch (error) { next(error); } });
app.post('/api/products/:id/ctrip-draft', async (req, res, next) => {
  try {
    const record = await getRecord(req.params.id);
    const validation = validateProduct(record.product);
    if (!validation.canCreateDraft) return res.status(409).json({ error: '存在阻止项，请先修正后再写入携程草稿', validation });
    if ([...jobs.values()].some((x) => x.recordId === record.id && x.status === 'running')) return res.status(409).json({ error: '该产品已有携程任务正在执行' });
    const jobId = randomUUID();
    const job = { id: jobId, recordId: record.id, status: 'running', currentStep: '等待启动', createdAt: new Date().toISOString() };
    jobs.set(jobId, job);
    res.status(202).json(job);
    saveCtripDraft({
      product: structuredClone(record.product),
      productId: req.body?.productId || record.ctrip?.productId,
      coverPath: record.attachments?.coverPath,
      onProgress: (currentStep) => Object.assign(job, { currentStep, updatedAt: new Date().toISOString() }),
      onProductCreated: async (productId) => {
        job.productId = productId;
        await updateRecordState(record.id, { ctrip: { ...(record.ctrip || {}), productId } });
      },
    }).then(async (result) => {
      Object.assign(job, { status: 'done', currentStep: '携程草稿已保存', result, updatedAt: new Date().toISOString() });
      await updateRecordState(record.id, { status: 'ctrip_draft', ctrip: result });
    }).catch(async (error) => {
      const message = cleanError(error);
      Object.assign(job, { status: 'failed', error: message, updatedAt: new Date().toISOString() });
      await updateRecordState(record.id, { status: 'ctrip_failed', ctripError: message }).catch(() => {});
    });
  } catch (error) { next(error); }
});
app.get('/api/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: '任务不存在或服务已重启' });
  res.json(job);
});
app.post('/api/products/:id/ctrip-continue', async (req, res, next) => {
  try {
    if (req.body?.approved !== true) return res.status(400).json({ error: '必须由员工明确确认“行程审核通过”' });
    const record = await getRecord(req.params.id);
    const productId = req.body?.productId || record.ctrip?.productId;
    if (!productId) return res.status(400).json({ error: '缺少携程产品ID，请先完成第一阶段' });
    const jobId = randomUUID();
    const job = { id: jobId, recordId: record.id, type: 'employee_approved_continue', status: 'running', currentStep: '等待启动', createdAt: new Date().toISOString() };
    jobs.set(jobId, job);
    res.status(202).json(job);
    submitItineraryReview({ productId, onProgress: (currentStep) => Object.assign(job, { currentStep, updatedAt: new Date().toISOString() }) })
      .then(async (result) => {
        Object.assign(job, { status: 'done', currentStep: '携程后续配置已完成', result, updatedAt: new Date().toISOString() });
        await updateRecordState(record.id, { status: result.status || 'stage2_unlocked', ctrip: { ...(record.ctrip || {}), ...result, productId } });
      })
      .catch(async (error) => {
        const message = cleanError(error);
        Object.assign(job, { status: 'failed', error: message, updatedAt: new Date().toISOString() });
        await updateRecordState(record.id, { status: 'stage2_failed', ctripError: message }).catch(() => {});
      });
  } catch (error) { next(error); }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  const status = error.status || (error.code === 'ENOENT' ? 404 : error instanceof multer.MulterError ? 400 : 500);
  res.status(status).json({ error: status === 500 ? '服务器处理失败，请查看日志' : error.message });
});

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
if (!['127.0.0.1', 'localhost', '::1'].includes(host) && !access.enabled) {
  throw new Error('非本机部署必须配置 APP_ACCESS_PASSWORD，拒绝启动未受保护的服务');
}
app.listen(port, host, () => console.log(`团队游录入助手：http://${host}:${port}`));
