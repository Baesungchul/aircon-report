/* ═══════════════════════════════════════════════════════════
   native-fs.js  —  Capacitor(안드로이드 앱) 전용 파일시스템 shim
   ----------------------------------------------------------------
   데스크톱 Chrome의 File System Access API(showDirectoryPicker,
   getDirectoryHandle, getFileHandle, createWritable ...)는
   안드로이드 WebView에 존재하지 않는다.
   이 모듈은 동일한 메서드 시그니처를 가진 "가짜 핸들"을 제공하여
   기존 folder.js / report.js 코드를 거의 수정 없이 동작시킨다.

   저장 위치: Documents/<appFolder>/...
     - Android 11+ 에서 별도 권한 없이 사용 가능 (앱이 만든 파일만 접근)
   ★ index.html에서 folder.js 보다 먼저 로드할 것
═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // Capacitor 저장 디렉토리 상수
  // ★ EXTERNAL = 앱 전용 외부저장소 (/storage/emulated/0/Android/data/<앱>/files/)
  //   - 권한 불필요. 앱 재설치/업데이트 후에도 EACCES 없음. Google Play 정책 안전.
  //   - 공용 Documents는 스코프 저장소 때문에 재설치 시 소유권 상실 → EACCES 발생하던 문제 해결.
  //   - 기존 Documents/work-report 데이터는 1회 마이그레이션(adb 복사 등)으로 이전.
  const DIR = 'EXTERNAL';

  function FS() {
    // 플러그인 등록 확인 (npm i @capacitor/filesystem + npx cap sync 필요)
    const p = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem;
    if (!p) throw new Error('Capacitor Filesystem 플러그인이 등록되지 않았습니다');
    return p;
  }

  function isNative() {
    return !!(window.Capacitor
      && typeof window.Capacitor.isNativePlatform === 'function'
      && window.Capacitor.isNativePlatform());
  }

  /* ── 인코딩 헬퍼 ───────────────────────────── */
  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onloadend = () => {
        const s = String(r.result);
        const i = s.indexOf(',');
        resolve(i >= 0 ? s.slice(i + 1) : s);
      };
      r.onerror = () => reject(r.error || new Error('blob 읽기 실패'));
      r.readAsDataURL(blob);
    });
  }

  function base64ToBlob(b64, mime) {
    const bin = atob(b64 || '');
    const len = bin.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime || 'application/octet-stream' });
  }

  function mimeOf(name) {
    const n = String(name || '').toLowerCase();
    if (n.endsWith('.jpg') || n.endsWith('.jpeg')) return 'image/jpeg';
    if (n.endsWith('.png')) return 'image/png';
    if (n.endsWith('.webp')) return 'image/webp';
    if (n.endsWith('.gif')) return 'image/gif';
    if (n.endsWith('.json')) return 'application/json';
    if (n.endsWith('.txt')) return 'text/plain';
    return 'application/octet-stream';
  }

  /* ── 가짜 파일 핸들 ───────────────────────── */
  class NFile {
    constructor(path, name) {
      this._path = path;
      this.name = name;
      this.kind = 'file';
    }
    async queryPermission() { return 'granted'; }
    async requestPermission() { return 'granted'; }

    // File System Access API의 getFile() 대응 → Blob 반환
    async getFile() {
      const res = await FS().readFile({ path: this._path, directory: DIR });
      const blob = base64ToBlob(res.data, mimeOf(this.name));
      // File처럼 name/lastModified도 부여
      try {
        return new File([blob], this.name, { type: blob.type, lastModified: Date.now() });
      } catch (e) {
        return blob;
      }
    }

    // createWritable() 대응 → write/close 누적 후 한 번에 기록
    async createWritable() {
      const path = this._path;
      const parts = [];
      return {
        async write(data) {
          // data가 { type:'write', data: blob } 형태일 수도 있음
          if (data && typeof data === 'object' && 'data' in data && data.type) {
            parts.push(data.data);
          } else {
            parts.push(data);
          }
        },
        async truncate() { /* no-op */ },
        async seek() { /* no-op */ },
        async close() {
          const blob = new Blob(parts);
          const b64 = await blobToBase64(blob);
          await FS().writeFile({ path: path, data: b64, directory: DIR, recursive: true });
        }
      };
    }
  }

  /* ── 가짜 디렉토리 핸들 ───────────────────── */
  class NDir {
    constructor(path, name) {
      this._path = path;
      this.name = name;
      this.kind = 'directory';
    }
    async queryPermission() { return 'granted'; }
    async requestPermission() { return 'granted'; }

    async getDirectoryHandle(name, opts) {
      const p = this._path + '/' + name;
      if (opts && opts.create) {
        try {
          await FS().mkdir({ path: p, directory: DIR, recursive: true });
        } catch (e) {
          // 이미 존재 → 무시
        }
      } else {
        // 존재 검증 (없으면 throw → FSA의 NotFoundError와 동일 동작)
        await FS().stat({ path: p, directory: DIR });
      }
      return new NDir(p, name);
    }

    async getFileHandle(name, opts) {
      const p = this._path + '/' + name;
      if (!(opts && opts.create)) {
        // 존재 검증 (없으면 throw)
        await FS().stat({ path: p, directory: DIR });
      }
      return new NFile(p, name);
    }

    async removeEntry(name, opts) {
      const p = this._path + '/' + name;
      try {
        if (opts && opts.recursive) {
          await FS().rmdir({ path: p, directory: DIR, recursive: true });
        } else {
          await FS().deleteFile({ path: p, directory: DIR });
        }
      } catch (e) {
        // 폴더일 수 있으니 rmdir 재시도
        try { await FS().rmdir({ path: p, directory: DIR, recursive: true }); } catch (_) {}
      }
    }

    // 디렉토리 순회 (작업기록 읽기 등에서 사용)
    async *entries() {
      let files = [];
      try {
        const r = await FS().readdir({ path: this._path, directory: DIR });
        files = (r && r.files) || [];
      } catch (e) {
        files = [];
      }

      // 1) 이름 + (있으면) 타입 추출
      //    Capacitor 버전에 따라 readdir 반환 형식이 다름:
      //      - 구버전(<5): files = ['name1', ...]  (문자열, 타입 없음)
      //      - 신버전(5+): files = [{ name, type, size, ... }]  (FileInfo 객체)
      const list = files.map(function (f) {
        if (typeof f === 'string') return { name: f, type: null };
        return { name: f.name, type: (f.type || f.kind || null) };
      });

      // 2) 타입 정보가 없으면 stat으로 디렉토리 여부 판별 (구버전 호환 핵심 수정)
      //    타입이 없는데 'directory'인지만 검사하면 날짜 폴더까지 전부 '파일'로
      //    분류되어 작업기록/달력 폴더 스캔이 전부 0건이 되는 버그를 방지한다.
      const self = this;
      await Promise.all(list.map(async function (it) {
        if (it.type === 'directory' || it.type === 'file') return;
        try {
          const st = await FS().stat({ path: self._path + '/' + it.name, directory: DIR });
          it.type = (st && st.type) ? st.type : 'file';
        } catch (e) {
          it.type = 'file';
        }
      }));

      for (const it of list) {
        const cp = this._path + '/' + it.name;
        const isDir = (it.type === 'directory');
        yield [it.name, isDir ? new NDir(cp, it.name) : new NFile(cp, it.name)];
      }
    }
    async *values() {
      for await (const pair of this.entries()) yield pair[1];
    }
    async *keys() {
      for await (const pair of this.entries()) yield pair[0];
    }
  }

  /* ── 루트 핸들 획득 ───────────────────────── */
  // appFolder: Documents 아래에 만들 기본 폴더명
  //   인자를 생략하면 자동 결정(신규='work-report', 기존 데이터는 마이그레이션)

  // 폴더에 데이터(작업 폴더)가 있는지 확인
  async function _folderHasData(name) {
    try {
      const l = await FS().readdir({ path: name, directory: DIR });
      return !!(l && l.files && l.files.length > 0);
    } catch (e) { return false; }
  }

  // 사용할 앱 폴더 결정 (+ 기존 'aircon-report' 데이터를 'work-report'로 1회 이전)
  //   ★ 안전 원칙: 원본(aircon-report)은 절대 지우지 않고 복사만 한다.
  //     복사가 실패하면 기존 폴더를 그대로 사용 → 데이터 손실 0.
  let _resolvedFolder = null;
  async function resolveAppFolder() {
    if (_resolvedFolder) return _resolvedFolder;
    const NEW = 'work-report', OLD = 'aircon-report';
    // 1) 새 폴더에 이미 데이터가 있으면 그대로 사용 (이미 이전됐거나 신규로 시작한 경우)
    if (await _folderHasData(NEW)) { _resolvedFolder = NEW; return NEW; }
    // 2) 기존 폴더에 데이터가 있으면 → 새 폴더로 복사 시도
    if (await _folderHasData(OLD)) {
      try {
        await FS().copy({ from: OLD, to: NEW, directory: DIR, toDirectory: DIR });
        console.log('[마이그레이션] aircon-report → work-report 복사 완료 (원본 보존)');
        _resolvedFolder = NEW;
        return NEW;
      } catch (e) {
        console.warn('[마이그레이션] 복사 실패 → 기존 폴더 그대로 사용(데이터 안전):', e && e.message);
        _resolvedFolder = OLD;   // 폴백: 기존 폴더 사용
        return OLD;
      }
    }
    // 3) 둘 다 없으면 신규 사용자 → 새 폴더
    _resolvedFolder = NEW;
    return NEW;
  }

  async function getRootHandle(appFolder) {
    // 인자 없으면 자동 결정(마이그레이션 포함)
    if (!appFolder) appFolder = await resolveAppFolder();
    try {
      // mkdir이 일부 기기에서 응답을 안 돌려주는 경우 대비 → 8초 타임아웃
      const mkdirP = FS().mkdir({ path: appFolder, directory: DIR, recursive: true });
      const timeoutP = new Promise((_, rej) =>
        setTimeout(() => rej(new Error('mkdir timeout')), 8000));
      await Promise.race([mkdirP, timeoutP]);
    } catch (e) {
      // 이미 존재하거나 타임아웃 → 무시하고 핸들은 반환 (쓰기 시 recursive로 폴더 생성됨)
      console.warn('[NativeFS] mkdir 건너뜀:', e && e.message);
    }
    return new NDir(appFolder, appFolder);
  }

  // 전역 노출
  window.NativeFS = {
    isNative: isNative,
    getRootHandle: getRootHandle,
    resolveAppFolder: resolveAppFolder,
    _NDir: NDir,
    _NFile: NFile
  };

  console.log('[NativeFS] 로드됨, 네이티브:', isNative());
})();
