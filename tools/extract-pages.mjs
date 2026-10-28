/* ════════════════════════════════════════════════════════
   활동지 PDF 한 쌍에서 쪽 그림과 빈칸(자리 + 정답)을 뽑는다.

   전제: 학생용과 교사용을 **같은 원본에서 답 레이어만 켜고 끄고** 두 번 내보낸다.
   그래야 두 파일의 쪽수와 좌표가 같아서 대조가 성립한다.
     교사용에만 있는 텍스트        = 정답
     두 쪽을 그려서 픽셀이 다른 자리 = 빈칸 상자

   이건 빌드 도구라 레포의 '빌드 없음' 규칙 바깥이다. 웹에 나가는 파일이 아니다.

   쓰는 법
     npm i pdfjs-dist @napi-rs/canvas
     node --max-old-space-size=8192 tools/extract-pages.mjs 학생용.pdf 교사용.pdf 출력폴더 20 21 22 23

   나오는 것: 출력폴더에 pNN.webp 여러 장과 pages.json
     pages.json = [{ page, image, w, h, blanks:[{ id, left, top, width, height, answer }] }]
     left/top/width/height는 쪽 그림 대비 %라서 화면 크기가 변해도 그대로 쓴다.
   ════════════════════════════════════════════════════════ */
import fs from 'fs';
import path from 'path';
import { createCanvas } from '@napi-rs/canvas';
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

const RENDER_SCALE = 2;      // 내보낼 쪽 이미지 배율
const DIFF_SCALE   = 1.3;    // 픽셀 대조 배율 (낮춰도 상자는 충분히 잡힌다)
const WEBP_QUALITY = 80;

const [stuPath, teaPath, outDir, ...pageArgs] = process.argv.slice(2);
const pages = pageArgs.map(Number);
fs.mkdirSync(outDir, { recursive: true });

const open = p => pdfjs.getDocument({
  data: new Uint8Array(fs.readFileSync(p)),
  cMapUrl: './node_modules/pdfjs-dist/cmaps/', cMapPacked: true,
  standardFontDataUrl: './node_modules/pdfjs-dist/standard_fonts/',
}).promise;

const stu = await open(stuPath);
const tea = await open(teaPath);
if (stu.numPages !== tea.numPages) throw new Error(`쪽수가 다르다: ${stu.numPages} vs ${tea.numPages}`);

async function raster(doc, n, scale) {
  const page = await doc.getPage(n);
  const vp = page.getViewport({ scale });
  const c = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return { page, vp, canvas: c, ctx };
}

/* 두 쪽의 픽셀 차이로 빈칸 상자를 찾는다 */
function diffBoxes(aCtx, bCtx, W, H) {
  const A = aCtx.getImageData(0, 0, W, H).data;
  const B = bCtx.getImageData(0, 0, W, H).data;
  const d = new Uint8Array(W * H);
  const RX = 6, RY = 3;                       // 글자들을 한 덩이로 붙이는 팽창 반경
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4;
    if (Math.abs(A[o]-B[o]) + Math.abs(A[o+1]-B[o+1]) + Math.abs(A[o+2]-B[o+2]) <= 60) continue;
    for (let dy = -RY; dy <= RY; dy++) for (let dx = -RX; dx <= RX; dx++) {
      const ny = y + dy, nx = x + dx;
      if (ny >= 0 && ny < H && nx >= 0 && nx < W) d[ny * W + nx] = 1;
    }
  }
  const seen = new Uint8Array(W * H), st = new Int32Array(W * H), boxes = [];
  for (let i = 0; i < W * H; i++) {
    if (!d[i] || seen[i]) continue;
    let sp = 0; st[sp++] = i; seen[i] = 1;
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, n = 0;
    while (sp) {
      const p = st[--sp], px = p % W, py = (p - px) / W; n++;
      if (px < x0) x0 = px; if (px > x1) x1 = px;
      if (py < y0) y0 = py; if (py > y1) y1 = py;
      for (const q of [p - 1, p + 1, p - W, p + W])
        if (q >= 0 && q < W * H && d[q] && !seen[q]) { seen[q] = 1; st[sp++] = q; }
    }
    if (n > 120 && x1 - x0 > 12 && y1 - y0 > 6)
      /* x0..x1은 이미 팽창 반경만큼 넓어져 있다. 거기서 또 빼면 상자가 두 배로 번진다 */
      boxes.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  }
  return boxes;
}

/* 교사용에만 있는 텍스트 = 정답. 뷰포트 좌표로 바꿔서 돌려준다.
   글자 크기(fontRel)도 같이 들고 나온다: 빈칸 상자 높이로 글자 크기를 정하면
   두 줄이 한 상자로 뭉친 칸에서만 글자가 커진다. 원본 크기를 쓰는 편이 맞다. */
async function answerItems(sPage, tPage, vp, pageHeightPt) {
  const s = (await sPage.getTextContent()).items;
  const t = (await tPage.getTextContent()).items;
  const key = i => `${Math.round(i.transform[4])},${Math.round(i.transform[5])},${i.str}`;
  const sSet = new Set(s.map(key));
  return t.filter(i => !sSet.has(key(i)) && i.str.trim() !== '').map(i => {
    const [x, y] = [i.transform[4], i.transform[5]];
    const [vx0, vy0] = vp.convertToViewportPoint(x, y);
    const [vx1, vy1] = vp.convertToViewportPoint(x + i.width, y + i.height);
    return {
      s: i.str, cx: (vx0 + vx1) / 2, cy: (vy0 + vy1) / 2, x: Math.min(vx0, vx1),
      fontRel: Math.abs(i.height) / pageHeightPt,   // 쪽 높이 대비 글자 크기
    };
  });
}

const out = [];
for (const n of pages) {
  const sD = await raster(stu, n, DIFF_SCALE);
  const tD = await raster(tea, n, DIFF_SCALE);
  const W = sD.canvas.width, H = sD.canvas.height;
  const boxes = diffBoxes(sD.ctx, tD.ctx, W, H);
  const pageHeightPt = sD.page.getViewport({ scale: 1 }).height;
  const answers = await answerItems(sD.page, tD.page, sD.vp, pageHeightPt);

  /* 정답 조각을 담고 있는 상자에 넣는다 (한 상자에 여러 조각이면 x순으로 이어 붙임) */
  const PAD = 4;
  const bucket = boxes.map(() => []);
  const orphans = [];
  for (const a of answers) {
    const bi = boxes.findIndex(b => a.cx >= b.x - PAD && a.cx <= b.x + b.w + PAD
                                 && a.cy >= b.y - PAD && a.cy <= b.y + b.h + PAD);
    if (bi < 0) orphans.push(a); else bucket[bi].push(a);
  }
  const blanks = boxes.map((b, i) => ({
    left:   +(b.x / W * 100).toFixed(3),
    top:    +(b.y / H * 100).toFixed(3),
    width:  +(b.w / W * 100).toFixed(3),
    height: +(b.h / H * 100).toFixed(3),
    font:   +((Math.max(0, ...bucket[i].map(o => o.fontRel)) * 100).toFixed(3)),
    answer: bucket[i].sort((p, q) => p.x - q.x).map(o => o.s).join('').replace(/\s+/g, ' ').trim(),
  })).filter(b => b.answer)
     .sort((p, q) => (p.top - q.top) || (p.left - q.left))
     .map((b, i) => Object.assign({ id: `b${i + 1}` }, b));

  /* 내보낼 쪽 이미지 (학생용, 빈칸이 비어 있는 쪽) */
  const sR = await raster(stu, n, RENDER_SCALE);
  const file = `p${String(n).padStart(2, '0')}.webp`;
  fs.writeFileSync(path.join(outDir, file), await sR.canvas.encode('webp', WEBP_QUALITY));

  out.push({ page: n, image: file, w: sR.canvas.width, h: sR.canvas.height, blanks });
  console.log(`쪽 ${n}: 상자 ${boxes.length}, 정답조각 ${answers.length}, 빈칸 ${blanks.length}, 미매칭 ${orphans.length}`
    + (orphans.length ? ` -> ${orphans.slice(0,6).map(o=>`"${o.s}"`).join(' ')}` : ''));
}
fs.writeFileSync(path.join(outDir, 'pages.json'), JSON.stringify(out, null, 1));
console.log('\n썼다:', path.join(outDir, 'pages.json'));
