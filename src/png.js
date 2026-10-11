/**
 * 零依赖 PNG 编码器，只用于离线自检样图：不联网也能验证
 * 「落盘 → 索引 → 控制台取图 → 页面显示」这条链路。
 */
import { deflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** 一个 PNG 块：长度 + 类型 + 数据 + CRC。 */
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

/**
 * 8 位 RGBA 编码成 PNG。
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array} rgba 长度必须是 width * height * 4
 * @returns {Buffer}
 */
export function encodePng(width, height, rgba) {
  const stride = width * 4;
  if (rgba.length !== stride * height) throw new Error('像素数据长度与尺寸不匹配');
  const raw = Buffer.allocUnsafe((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour with alpha
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * 一张看得出门道的样图：青色到紫色的渐变、白色网格、四角边框，
 * 一眼能认出来是自检产物而不是模型画的。
 */
export function samplePng(width = 768, height = 480) {
  const w = Math.max(16, Math.round(width));
  const h = Math.max(16, Math.round(height));
  const px = new Uint8Array(w * h * 4);
  const grid = 48;
  for (let y = 0; y < h; y += 1) {
    const ty = y / (h - 1);
    for (let x = 0; x < w; x += 1) {
      const tx = x / (w - 1);
      const i = (y * w + x) * 4;
      // 对角渐变：左上青，右下紫，中间透出暖色。
      const mix = Math.min(1, Math.max(0, (tx + ty) / 2));
      let r = Math.round(40 + 190 * mix + 30 * (1 - tx));
      let g = Math.round(200 - 120 * mix);
      let b = Math.round(190 + 60 * mix);
      if (x % grid === 0 || y % grid === 0) {
        r = Math.min(255, r + 40);
        g = Math.min(255, g + 40);
        b = Math.min(255, b + 40);
      }
      const border = x < 6 || y < 6 || x >= w - 6 || y >= h - 6;
      if (border) {
        r = 250;
        g = 250;
        b = 250;
      }
      px[i] = r;
      px[i + 1] = g;
      px[i + 2] = b;
      px[i + 3] = 255;
    }
  }
  return encodePng(w, h, px);
}
