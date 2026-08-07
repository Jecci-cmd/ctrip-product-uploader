import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMaterial } from '../src/parser.js';

test('未配置 AI 接口时直接报错，不回退本地解析', async () => {
  const modelVerseKey = process.env.MODELVERSE_API_KEY;
  const openAiKey = process.env.OPENAI_API_KEY;
  delete process.env.MODELVERSE_API_KEY;
  delete process.env.OPENAI_API_KEY;

  try {
    await assert.rejects(
      parseMaterial('厦门三日游', 'sample.txt'),
      (error) => error.status === 503 && /AI 接口未配置/.test(error.message),
    );
  } finally {
    if (modelVerseKey === undefined) delete process.env.MODELVERSE_API_KEY;
    else process.env.MODELVERSE_API_KEY = modelVerseKey;
    if (openAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = openAiKey;
  }
});

test('AI 接口不可用时返回上游错误，不回退本地解析', async () => {
  const previous = {
    modelVerseKey: process.env.MODELVERSE_API_KEY,
    openAiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.MODELVERSE_BASE_URL,
  };
  process.env.MODELVERSE_API_KEY = 'test-key';
  delete process.env.OPENAI_API_KEY;
  process.env.MODELVERSE_BASE_URL = 'http://127.0.0.1:1';

  try {
    await assert.rejects(
      parseMaterial('厦门三日游', 'sample.txt'),
      (error) => error.status === 502 && /AI 解析失败（ModelVerse）/.test(error.message),
    );
  } finally {
    for (const [name, value] of [
      ['MODELVERSE_API_KEY', previous.modelVerseKey],
      ['OPENAI_API_KEY', previous.openAiKey],
      ['MODELVERSE_BASE_URL', previous.baseUrl],
    ]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
