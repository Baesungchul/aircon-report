/* ═══════════════════════════════
   이미지 최적화 (리사이즈 + 압축 + 4:3 크롭)
   - 원본 방향 유지: 세로사진 → 3:4(세로 4:3), 가로사진 → 4:3(가로)
   - 최대 1600px 리사이즈
   - JPEG 품질 0.78
═══════════════════════════════ */
const IMG_MAX_PX  = 1600;
const IMG_QUALITY = 0.78;

function compressImage(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => {
        const origW = img.naturalWidth;
        const origH = img.naturalHeight;
        const origBytes = Math.round(ev.target.result.length * 0.75);

        // ── 가로 4:3 비율로 중앙 크롭 (촬영·보고서와 동일 비율로 통일) ──
        const targetRatio  = 4 / 3;   // W / H = 4:3 (가로)
        const currentRatio = origW / origH;

        let srcX = 0, srcY = 0, srcW = origW, srcH = origH;
        if (currentRatio > targetRatio) {
          srcW = Math.round(origH * targetRatio);
          srcX = Math.round((origW - srcW) / 2);
        } else if (currentRatio < targetRatio) {
          srcH = Math.round(origW / targetRatio);
          srcY = Math.round((origH - srcH) / 2);
        }

        let outW = srcW, outH = srcH;
        const maxSide = Math.max(outW, outH);
        if (maxSide > IMG_MAX_PX) {
          const ratio = IMG_MAX_PX / maxSide;
          outW = Math.round(outW * ratio);
          outH = Math.round(outH * ratio);
        }

        const canvas = document.createElement('canvas');
        canvas.width  = outW;
        canvas.height = outH;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, outW, outH);
        ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, outW, outH);

        const dataUrl   = canvas.toDataURL('image/jpeg', IMG_QUALITY);
        const newBytes  = Math.round(dataUrl.length * 0.75);
        const origKB    = Math.round(origBytes / 1024);
        const newKB     = Math.round(newBytes  / 1024);
        const savedKB   = origKB - newKB;
        const wasCropped = false;

        resolve({ dataUrl, origKB, newKB, savedKB, w: outW, h: outH, wasCropped });
      };
      img.onerror = () => resolve({ dataUrl: ev.target.result, origKB:0, newKB:0, savedKB:0, w:0, h:0, wasCropped:false });
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ═══════════════════════════════════════════════
// 썸네일 생성 (앱 화면용 - 작은 사이즈)
// ═══════════════════════════════════════════════
const THUMB_MAX_PX = 300;       // 썸네일 최대 크기
const THUMB_QUALITY = 0.65;     // 썸네일 품질 (작아도 충분)

// ═══════════════════════════════════════════════
// 썸네일 시스템 사용 여부
// - 1.215 비교 테스트 결과 ON/OFF 체감 차이 거의 없음 → OFF로 유지
// - 향후 디바이스/사진수 따라 재검토하고 싶으면 true로만 바꾸면 부활
// ═══════════════════════════════════════════════
const THUMBNAILS_ENABLED = false;
if (typeof window !== 'undefined') window.THUMBNAILS_ENABLED = THUMBNAILS_ENABLED;

// File/Blob → 썸네일 Blob (JPEG)
function createThumbnailBlob(file) {
  // 비활성화 시 즉시 거부 (호출 측 catch에서 무시됨)
  if (!THUMBNAILS_ENABLED) {
    return Promise.reject(new Error('썸네일 시스템 비활성화'));
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const ratio = Math.min(THUMB_MAX_PX / img.naturalWidth, THUMB_MAX_PX / img.naturalHeight, 1);
      const w = Math.round(img.naturalWidth * ratio);
      const h = Math.round(img.naturalHeight * ratio);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(blob => {
        if (blob) resolve(blob);
        else reject(new Error('썸네일 생성 실패'));
      }, 'image/jpeg', THUMB_QUALITY);
    };
    img.onerror = e => { URL.revokeObjectURL(url); reject(new Error('이미지 로드 실패')); };
    img.src = url;
  });
}
