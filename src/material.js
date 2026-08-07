import mammoth from 'mammoth';
import pdf from 'pdf-parse/lib/pdf-parse.js';

export async function extractMaterial(file) {
  const name = file.originalname || 'material';
  if (/\.(txt|md)$/i.test(name)) return file.buffer.toString('utf8');
  if (/\.docx$/i.test(name)) return (await mammoth.extractRawText({ buffer: file.buffer })).value;
  if (/\.pdf$/i.test(name)) return (await pdf(file.buffer)).text;
  throw Object.assign(new Error('支持 TXT、Markdown、DOCX 和文本型 PDF。'), { status: 415 });
}
