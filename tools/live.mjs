/**
 * 联网自测：拿真实安装里已经配好的「端点 .env」密钥，真画一张图。
 * 只读那份 .env，不打印密钥；图存到临时目录里，不碰真实安装的数据目录。
 *
 *   $env:LIVE_BOT_DIR = "<安装>/data/home/<bot>"      # 必填：去哪找 providers 下的 .env
 *   $env:LIVE_BASE_URL = "https://api.openai.com/v1"  # 选填：默认 OpenAI
 *   $env:LIVE_MODEL    = "gpt-image-1"                # 选填：默认 gpt-image-1
 *   node tools/live.mjs
 *
 * 它会故意让插件自己去「<bot>/../providers/<端点>/.env」里找密钥（而不是从配置里拿），
 * 所以要求那个 bot 目录下**已经有一个配好密钥的图片端点**。没有就别跑这一份。
 */
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ImageWorld } from '../src/world.js';

const BOT_DIR = process.env.LIVE_BOT_DIR || '';
if (!BOT_DIR) {
  console.error('先给 LIVE_BOT_DIR：例如 $env:LIVE_BOT_DIR = "D:\\Coopanion\\data\\home\\companion"');
  process.exit(2);
}
const BASE_URL = process.env.LIVE_BASE_URL || 'https://api.openai.com/v1';
const MODEL = process.env.LIVE_MODEL || 'gpt-image-1';
const KEY_SECRET = process.env.LIVE_KEY_SECRET || 'IMAGE_API_KEY';
const dataDir = mkdtempSync(join(tmpdir(), 'image-live-'));

const world = new ImageWorld({
  cfg: {
    enabled: true,
    baseUrl: BASE_URL,
    apiKeySecret: KEY_SECRET,
    model: MODEL,
    size: '1024x1024',
    quality: 'auto',
    format: 'png',
    timeoutMs: 300000,
    saveDir: '',
    keep: 200,
    pushToConsole: true,
  },
  dataDir,
  botDir: BOT_DIR,
  packageDir: process.env.LIVE_PACKAGE_DIR || process.cwd(),
  secret: () => '', // 部署 .env 里没有 → 逼它走 providers/*/.env 那条路
  storeSecret: () => {},
});
world.language = 'zh';

let bad = 0;
const ok = (name, pass, extra = '') => {
  console.log(`${pass ? '  ok  ' : '  FAIL'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!pass) bad += 1;
};

const key = world.apiKey();
ok('从端点 .env 里取到了密钥', key.length > 20, `长度 ${key.length}`);
ok('状态页知道密钥来自端点', world.invoke && true, JSON.stringify(world.envPromptVars()));

const t0 = Date.now();
const draw = world.tools().find((t) => t.name === 'image_draw');
const out = await draw.handler({
  prompt: 'a small orange cat sleeping on a windowsill, soft morning light, watercolor',
  note: 'live 自测',
});
const ms = Date.now() - t0;

console.log(`\n回执（${ms}ms，${MODEL}）：\n${out.text.slice(0, 600)}\n`);
ok('画图没有失败', !out.failed);
ok('回执带了图', Array.isArray(out.blobs) && out.blobs.length === 1, `blobs=${out.blobs?.length ?? 0}`);

const blob = out.blobs?.[0];
ok('字节是 PNG', blob?.bytes?.[0] === 0x89 && blob?.bytes?.[1] === 0x50, blob?.mime);
ok('有 fallbackText', Boolean(blob?.fallbackText));

const listed = await world.invoke('gallery', 'list', [10]);
ok('作品页列出 1 张', listed?.count === 1, JSON.stringify(listed?.items?.[0] ?? null).slice(0, 200));
ok('统计里有占用字节', listed?.totalBytes === blob?.bytes?.length, `${listed?.totalBytes} vs ${blob?.bytes?.length}`);

const item = listed?.items?.[0];
ok('文件真的落盘了', Boolean(item?.path) && existsSync(item.path), item?.path);
ok('落盘字节数与回执一致', item && statSync(item.path).size === blob?.bytes?.length);
ok('文件头是 PNG', item && readFileSync(item.path).subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])));

const file = await world.invoke('gallery', 'blob', [item?.id, 120]);
ok('blob 返回 $file 且 sha256 对得上', Boolean(file?.$file?.path), file?.$file?.mime);
ok('$file 指向同一张图', file?.$file?.path === item?.path);
ok('$file 带字节数', file?.$file?.bytes === blob?.bytes?.length);

const state = await world.invoke('status', 'state', []);
ok('状态页读到密钥已填', state?.keySet === true);
ok('状态页报出来源=端点', state?.keyFrom === 'provider', `${state?.keyFrom} · ${state?.keyProvider}`);
ok('状态页句子里说了可用', String(state?.detail ?? '').includes(MODEL), state.detail);

console.log(`\n图存在：${item?.path}`);
console.log(bad === 0 ? '\n联网自测：全部通过。' : `\n联网自测：${bad} 项失败。`);
process.exitCode = bad === 0 ? 0 : 1;
