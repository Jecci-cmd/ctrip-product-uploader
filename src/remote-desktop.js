import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(test, message, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await test().catch(() => false)) return;
    await pause(150);
  }
  throw new Error(message);
}

function tcpReady(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
  });
}

async function terminate(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([new Promise((resolve) => child.once('exit', resolve)), pause(2_000)]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

export async function startRemoteDesktop({ width = 1280, height = 720 } = {}) {
  let unixSockets = true;
  try {
    await fs.mkdir('/tmp/.X11-unix', { recursive: true, mode: 0o1777 });
    await fs.chmod('/tmp/.X11-unix', 0o1777);
  } catch { unixSockets = false; }
  let displayNumber;
  for (let candidate = 90; candidate <= 109; candidate += 1) {
    if (!await fs.access(`/tmp/.X11-unix/X${candidate}`).then(() => true).catch(() => false)) { displayNumber = candidate; break; }
  }
  if (!displayNumber) throw new Error('没有可用的临时显示器');
  const serverDisplay = `:${displayNumber}`;
  const display = unixSockets ? serverDisplay : `127.0.0.1:${displayNumber}`;
  const port = 5900 + (displayNumber - 90);
  const transport = unixSockets ? ['-nolisten', 'tcp'] : ['-nolisten', 'unix', '-listen', 'tcp'];
  const xvfb = spawn('Xvfb', [serverDisplay, '-screen', '0', `${width}x${height}x24`, ...transport, '-ac'], { stdio: 'ignore' });
  try {
    await waitFor(async () => xvfb.exitCode === null && (unixSockets ? fs.access(`/tmp/.X11-unix/X${displayNumber}`).then(() => true) : tcpReady(6000 + displayNumber)), '启动虚拟显示器失败');
    const desktopEnv = { ...process.env, XDG_SESSION_TYPE: 'x11' };
    delete desktopEnv.WAYLAND_DISPLAY;
    const vnc = spawn('x11vnc', ['-display', display, '-rfbport', String(port), '-localhost', '-forever', '-shared', '-nopw', '-noxdamage', '-noshm', '-quiet'], { stdio: 'ignore', env: desktopEnv });
    try {
      await waitFor(async () => vnc.exitCode === null && tcpReady(port), '启动远程验证画面失败');
      return {
        display, port, width, height,
        async stop() { await terminate(vnc); await terminate(xvfb); },
      };
    } catch (error) { await terminate(vnc); throw error; }
  } catch (error) { await terminate(xvfb); throw error; }
}
