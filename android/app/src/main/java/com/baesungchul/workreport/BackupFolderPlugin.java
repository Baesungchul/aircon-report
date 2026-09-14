package com.baesungchul.workreport;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * BackupFolder — SAF(ACTION_OPEN_DOCUMENT_TREE) 기반 폴더 복원.
 *
 *  배경: 앱이 공용 Documents에 만든 백업을 재설치 후 Capacitor Filesystem으로
 *  직접 읽으면 EACCES(Permission denied)가 난다(MediaStore 소유권 상실).
 *  WebView는 webkitdirectory 폴더 선택도 막는 기기가 많다.
 *  → 사용자가 SAF 폴더 선택기로 백업 폴더를 직접 고르면 읽기 권한이 부여되어
 *    그 안의 파일을 앱 전용 저장소(EXTERNAL = getExternalFilesDir/work-report)로
 *    복사할 수 있다. 파일을 네이티브에서 스트림 복사하므로 메모리(OOM) 위험도 없다.
 */
@CapacitorPlugin(name = "BackupFolder")
public class BackupFolderPlugin extends Plugin {

    /** 1) 폴더 선택기를 띄우고, 선택된 폴더의 영구 읽기 권한을 확보한 뒤 uri 반환 */
    @PluginMethod
    public void pickFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, intent, "folderPicked");
    }

    @ActivityCallback
    private void folderPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK
                || result.getData() == null
                || result.getData().getData() == null) {
            JSObject ret = new JSObject();
            ret.put("cancelled", true);
            call.resolve(ret);
            return;
        }
        Uri treeUri = result.getData().getData();
        try {
            getContext().getContentResolver().takePersistableUriPermission(
                    treeUri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (Exception ignored) {}
        JSObject ret = new JSObject();
        ret.put("uri", treeUri.toString());
        call.resolve(ret);
    }

    /** 1-b) 자동백업용 폴더 선택 — 읽기+쓰기 영구 권한 확보
     *
     *  ☠️ 2026-09-13 사고의 출발점: 여기서 시작 폴더를 지정하지 않아, 시스템 폴더
     *     선택기가 '자기가 마지막에 보던 곳'에서 열렸다. 그게 DCIM/Camera 였던 사용자는
     *     「다음」 한 번으로 카메라 폴더를 백업 폴더로 지정해 버렸다.
     *     → EXTRA_INITIAL_URI 로 항상 Documents(또는 이미 쓰던 백업 폴더)에서 열리게 한다.
     *     ★ 시작 위치 지정을 없애지 말 것.
     */
    @PluginMethod
    public void pickBackupFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        try {
            /* 이미 쓰던 백업 폴더가 있으면 그 자리에서, 없으면 Documents 에서 열린다.
               Documents 자체를 골라도 위의 isSystemMediaDir 가 막으므로, 사용자는
               그 안에 폴더를 새로 만들거나 기존 백업 폴더로 들어가게 된다. */
            String cur = call.getString("currentUri");
            Uri initial = null;
            if (cur != null && !cur.isEmpty()) {
                try {
                    Uri t = Uri.parse(cur);
                    initial = DocumentsContract.buildDocumentUriUsingTree(
                            t, DocumentsContract.getTreeDocumentId(t));
                } catch (Exception ignored) {}
            }
            if (initial == null) {
                initial = DocumentsContract.buildDocumentUri(
                        "com.android.externalstorage.documents", "primary:Documents");
            }
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                intent.putExtra(DocumentsContract.EXTRA_INITIAL_URI, initial);
            }
        } catch (Exception ignored) {}
        startActivityForResult(call, intent, "backupFolderPicked");
    }

    @ActivityCallback
    private void backupFolderPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK
                || result.getData() == null
                || result.getData().getData() == null) {
            JSObject ret = new JSObject();
            ret.put("cancelled", true);
            call.resolve(ret);
            return;
        }
        Uri treeUri = result.getData().getData();
        try {
            getContext().getContentResolver().takePersistableUriPermission(
                    treeUri, Intent.FLAG_GRANT_READ_URI_PERMISSION
                            | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        } catch (Exception ignored) {}
        /* ★ 2026-09-13 — 고른 폴더가 안전한지 같이 알려준다.
             사고: 사용자가 DCIM/Camera 를 백업 폴더로 골랐다 → mirror() 의 prune 이
             "앱 폴더에 없는 이름"인 기존 카메라 사진을 전부 삭제. 되돌릴 수 없었다.
             그래서 고른 즉시 (a) 시스템 미디어 폴더인지 (b) 남의 파일이 들어 있는지를
             JS 로 넘겨, JS 가 거부하거나 경고하게 한다.
             ☠️ 폴더 훑기는 사진 수천 장이면 시간이 걸린다 — 메인 스레드에서 하면 ANR 이다. */
        final Uri picked = treeUri;
        new Thread(new Runnable() {
            public void run() {
                JSObject ret = new JSObject();
                ret.put("uri", picked.toString());
                try {
                    String rel = relPathOfTree(picked);
                    ret.put("relPath", rel == null ? "" : rel);
                    ret.put("isSystemDir", isSystemMediaDir(rel));
                    JSObject scan = scanForeign(picked);
                    ret.put("foreignCount", scan.getInteger("foreignCount", 0));
                    ret.put("foreignSample", scan.getString("foreignSample", ""));
                } catch (Exception ignored) {}
                call.resolve(ret);
            }
        }).start();
    }

    /** 앱이 쓰는 전용 백업 폴더 이름 — 시스템 폴더를 골랐을 때 그 안에 이걸 만들어 쓴다 */
    /* ☠️ 2026-09-14 — 한글 이름을 쓰지 않는다.
         한글은 기기·파일시스템에 따라 자모가 분리된 형태(NFD)로 저장되는 경우가 있어,
         우리가 적은 이름("작업보고서백업", NFC)과 글자로는 같아도 문자열 비교가 어긋난다.
         그러면 (1) 앱을 켤 때마다 같은 폴더를 못 찾아 새로 만들고,
                (2) isSystemMediaDir 의 '우리 폴더' 예외도 빗나가 그 안에 또 만들어서
                    사용자 사진 폴더에 폴더가 끝없이 겹쳐 들어간다.
         앱 폴더 이름(work-report)·기본 백업 경로(work-report-backups)와도 맞는 ASCII 이름을 쓴다.
         ★ 여기를 한글이나 공백·특수문자가 든 이름으로 바꾸지 말 것. */
    static final String OUR_BACKUP_DIR = "work-report-backups";

    /** 1-b2) 고른 폴더 안에 전용 백업 폴더를 만들고(있으면 그대로) 그 폴더의 트리 uri 를 돌려준다.
     *
     *  사용자 요청(2026-09-13): "기본폴더를 도큐멘트로 해주고 그대로 선택하면 backup용 새폴더를
     *  만들어서 사용하게끔". Documents 처럼 남의 파일이 있는 곳을 골라도, 실제 백업은 그 아래
     *  전용 폴더에서만 이뤄지게 해 사고를 구조적으로 막는다.
     *  부모 폴더에 받은 영구 권한이 자식 트리에도 적용되므로(ExternalStorageProvider 의
     *  isChildDocument) 자식 트리 uri 를 그대로 저장해 쓸 수 있다. 그래도 실제로 읽히는지
     *  한 번 확인한 뒤에만 ok=true 로 돌려준다. */
    @PluginMethod
    public void ensureChildDir(final PluginCall call) {
        final String uriStr = call.getString("uri");
        final String name = call.getString("name", OUR_BACKUP_DIR);
        if (uriStr == null || uriStr.isEmpty()) { call.reject("uri가 없습니다"); return; }
        new Thread(new Runnable() {
            public void run() {
                try {
                    ContentResolver resolver = getContext().getContentResolver();
                    Uri treeUri = Uri.parse(uriStr);

                    /* ☠️ 겹쳐 만들기 방지 — 이미 우리 전용 폴더 안이면 그 자리를 그대로 쓴다.
                         이 검사가 없으면 이름 비교가 한 번만 어긋나도 앱을 켤 때마다
                         work-report-backups/work-report-backups/… 로 끝없이 파고든다. */
                    String parentRel = relPathOfTree(treeUri);
                    if (endsWithOurDir(parentRel)) {
                        JSObject same = new JSObject();
                        same.put("ok", true);
                        same.put("uri", uriStr);
                        same.put("name", name);
                        same.put("created", false);
                        same.put("alreadyOurs", true);
                        same.put("relPath", parentRel);
                        call.resolve(same);
                        return;
                    }

                    String parentId = DocumentsContract.getTreeDocumentId(treeUri);
                    String childId = findChildDir(resolver, treeUri, parentId, name);
                    boolean created = false;
                    if (childId == null) {
                        childId = createDir(resolver, treeUri, parentId, name);
                        created = (childId != null);
                        /* 만든 직후 이름을 다시 확인한다 — 제공자가 이름을 바꿨을 수 있다
                           (중복이면 'name (1)', 특수문자 치환 등). 그때는 만들어진 것을 그대로 찾아 쓴다. */
                        if (childId == null) childId = findChildDir(resolver, treeUri, parentId, name);
                    }
                    JSObject ret = new JSObject();
                    if (childId == null) {
                        ret.put("ok", false);
                        ret.put("uri", "");
                        call.resolve(ret);
                        return;
                    }
                    Uri childTree = DocumentsContract.buildTreeDocumentUri(treeUri.getAuthority(), childId);
                    /* 확인: 그 트리로 정말 읽히는가 (안 되면 부모를 그대로 쓰게 두고 JS 가 안내한다) */
                    boolean usable = false;
                    Cursor c = null;
                    try {
                        c = resolver.query(
                                DocumentsContract.buildChildDocumentsUriUsingTree(childTree, childId),
                                new String[]{ DocumentsContract.Document.COLUMN_DOCUMENT_ID },
                                null, null, null);
                        usable = (c != null);
                    } catch (Exception ignored) {
                    } finally { if (c != null) try { c.close(); } catch (Exception ignored) {} }
                    ret.put("ok", usable);
                    ret.put("uri", usable ? childTree.toString() : "");
                    ret.put("name", name);
                    ret.put("created", created);
                    String rel = relPathOfTree(usable ? childTree : treeUri);
                    ret.put("relPath", rel == null ? "" : rel);
                    call.resolve(ret);
                } catch (Exception e) {
                    call.reject("백업 폴더 준비 실패: " + e.getMessage(), e);
                }
            }
        }).start();
    }

    /** 1-c) 이미 저장해 둔 백업 폴더가 안전한지 검사 (앱 켤 때 한 번 — 옛 빌드에서 잘못 지정된 폴더 구제) */
    @PluginMethod
    public void inspectFolder(final PluginCall call) {
        final String uriStr = call.getString("uri");
        if (uriStr == null || uriStr.isEmpty()) { call.reject("uri가 없습니다"); return; }
        new Thread(new Runnable() {
            public void run() {
                try {
                    Uri treeUri = Uri.parse(uriStr);
                    String rel = relPathOfTree(treeUri);
                    JSObject ret = new JSObject();
                    ret.put("relPath", rel == null ? "" : rel);
                    ret.put("isSystemDir", isSystemMediaDir(rel));
                    JSObject scan = scanForeign(treeUri);
                    ret.put("foreignCount", scan.getInteger("foreignCount", 0));
                    ret.put("foreignSample", scan.getString("foreignSample", ""));
                    call.resolve(ret);
                } catch (Exception e) {
                    call.reject("폴더 검사 실패: " + e.getMessage(), e);
                }
            }
        }).start();
    }

    /** 트리 uri 의 내장저장소 기준 상대경로 ("DCIM/Camera"). 기본 저장소가 아니면 null */
    private String relPathOfTree(Uri treeUri) {
        try {
            String docId = DocumentsContract.getTreeDocumentId(treeUri);
            String[] split = docId.split(":");
            if (split.length >= 1 && "primary".equalsIgnoreCase(split[0])) {
                String tail = (split.length > 1 && split[1] != null) ? split[1] : "";
                while (tail.startsWith("/")) tail = tail.substring(1);
                while (tail.endsWith("/")) tail = tail.substring(0, tail.length() - 1);
                return tail;
            }
        } catch (Exception ignored) {}
        return null;
    }

    /** 이 경로의 마지막 칸이 우리 전용 백업 폴더인가 (대소문자 구분 없이 — 파일시스템이 바꿔 줄 수 있다) */
    private static boolean endsWithOurDir(String path) {
        if (path == null) return false;
        int i = path.lastIndexOf('/');
        String last = (i >= 0) ? path.substring(i + 1) : path;
        return last.equalsIgnoreCase(OUR_BACKUP_DIR);
    }

    /** 안드로이드가 쓰는 공용/시스템 미디어 폴더인가 (그 자체 또는 저장소 루트) */
    private boolean isSystemMediaDir(String rel) {
        if (rel == null) return false;              // 기본 저장소가 아니면 판단 불가 — 막지 않는다
        String r = rel.trim();
        while (r.endsWith("/")) r = r.substring(0, r.length() - 1);
        if (r.isEmpty()) return true;               // 저장소 루트
        /* 우리가 만든 전용 폴더는 어디에 있어도 안전하다 (Documents/작업보고서백업 등).
           이 예외가 없으면 방금 만든 우리 폴더를 우리가 다시 거부한다. */
        if (endsWithOurDir(r)) return false;
        String low = r.toLowerCase();
        /* ① 공용 최상위 폴더 그 자체는 모두 막는다 (Documents 를 그대로 골라도 그 안에 전용 폴더를 만든다) */
        String[] tops = {"dcim", "pictures", "movies", "music", "download", "downloads",
                         "documents", "alarms", "ringtones", "notifications", "podcasts",
                         "android", "recordings", "audiobooks"};
        for (String t : tops) {
            if (low.equals(t)) return true;
        }
        /* ② 사진·영상 앨범의 1단계 하위도 막는다 (DCIM/Camera, Pictures/Screenshots).
              갤러리가 앨범으로 보여 주는 자리라, 여기에 .nomedia 를 두면 사용자 갤러리가 빈다.
              Documents / Download 아래는 사용자가 직접 만드는 자리라 막지 않는다 —
              막으면 Documents/내백업 을 골라도 한 단계 더 파고들어가 번거로워진다.
              그런 폴더에 남의 파일이 있으면 foreignCount 쪽에서 전용 폴더를 만들어 쓴다. */
        String[] albums = {"dcim", "pictures", "movies", "music"};
        for (String t : albums) {
            if (low.startsWith(t + "/") && low.indexOf('/', t.length() + 1) < 0) return true;
        }
        return false;
    }

    /** 고른 폴더 안에 '우리 것이 아닌' 항목이 몇 개나 있는지 (사진 유실 사고 예방용) */
    private JSObject scanForeign(Uri treeUri) {
        JSObject out = new JSObject();
        int foreign = 0;
        StringBuilder sample = new StringBuilder();
        ContentResolver resolver = getContext().getContentResolver();
        String rootDocId = DocumentsContract.getTreeDocumentId(treeUri);
        Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, rootDocId);
        Cursor c = null;
        try {
            c = resolver.query(childrenUri, new String[]{
                    DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                    DocumentsContract.Document.COLUMN_MIME_TYPE }, null, null, null);
            if (c != null) {
                while (c.moveToNext()) {
                    String nm = c.getString(0);
                    if (nm == null || ".nomedia".equals(nm)) continue;
                    boolean isDir = DocumentsContract.Document.MIME_TYPE_DIR.equals(c.getString(1));
                    if (isOursTopLevel(nm, isDir)) continue;
                    foreign++;
                    if (sample.length() < 120) {
                        if (sample.length() > 0) sample.append(", ");
                        sample.append(nm);
                    }
                }
            }
        } catch (Exception ignored) {
        } finally {
            if (c != null) try { c.close(); } catch (Exception ignored) {}
        }
        out.put("foreignCount", foreign);
        out.put("foreignSample", sample.toString());
        return out;
    }

    /**
     * 백업 폴더 '맨 위'에서 우리가 만든 것인가 — 이름 + 종류(폴더/파일)를 함께 본다.
     *
     *   앱 폴더(work-report)의 최상위에는 **폴더**(날짜/작업 YYYY-MM-DD…, _shared, m_…)와
     *   **.json 파일** 말고는 아무것도 없다. 사진·영상 파일이 맨 위에 놓이는 일은 없다.
     *
     *   ☠️ 그래서 맨 위의 prune 은 '폴더이거나 .json 인 것'만 대상으로 한다. 이름만 보면
     *      '2026-09-05 14.30.12.jpg' 처럼 날짜로 시작하는 카메라 파일이 우리 작업 폴더로
     *      오인돼 지워진다 — 일부 카메라·메신저 앱이 실제로 이런 이름을 쓴다.
     *      2026-09-13 사진 유실 사고의 재발 방지 — 이 게이트를 느슨하게 고치지 말 것.
     */
    private static boolean isOursTopLevel(String name, boolean isDir) {
        if (name == null || name.isEmpty()) return false;
        if (".nomedia".equals(name)) return false;          // 우리가 뒀지만 지우지 않는다
        if (name.toLowerCase().endsWith(".json")) return true;
        if (!isDir) return false;                           // ★ 폴더가 아니면 우리 것이 아니다
        if (name.charAt(0) == '_') return true;             // _shared …
        if (name.startsWith("m_")) return true;             // 수동일정
        if (name.length() < 10) return false;
        for (int i = 0; i < 10; i++) {
            char ch = name.charAt(i);
            boolean dash = (i == 4 || i == 7);
            if (dash ? (ch != '-') : (ch < '0' || ch > '9')) return false;
        }
        return true;                                        // YYYY-MM-DD…
    }

    /** 3) EXTERNAL/<appFolder> 를 선택된 폴더(uri)에 거울 백업 (증분 복사 + orphan 삭제) */
    @PluginMethod
    public void backupTree(final PluginCall call) {
        final String uriStr = call.getString("uri");
        if (uriStr == null || uriStr.isEmpty()) { call.reject("uri가 없습니다"); return; }
        final String appFolder = call.getString("appFolder", "work-report");

        new Thread(new Runnable() {
            public void run() {
                try {
                    ContentResolver resolver = getContext().getContentResolver();
                    Uri treeUri = Uri.parse(uriStr);
                    String rootDocId = DocumentsContract.getTreeDocumentId(treeUri);
                    File srcRoot = new File(getContext().getExternalFilesDir(null), appFolder);
                    int[] counts = new int[]{0, 0, 0, 0, 0}; // copied, skipped, pruned, fail, kept(남의 파일)
                    if (srcRoot.exists() && srcRoot.isDirectory()) {
                        mirror(resolver, treeUri, rootDocId, srcRoot, counts, true);
                    }
                    JSObject ret = new JSObject();
                    ret.put("copied", counts[0]);
                    ret.put("skipped", counts[1]);
                    ret.put("pruned", counts[2]);
                    ret.put("fail", counts[3]);
                    ret.put("kept", counts[4]);   // 백업 폴더 맨 위에서 보호한 남의 항목 수
                    call.resolve(ret);
                } catch (Exception e) {
                    call.reject("백업 실패: " + e.getMessage(), e);
                }
            }
        }).start();
    }

    // 한 디렉토리를 대상 폴더에 거울 동기화 (재귀)
    private void mirror(ContentResolver resolver, Uri treeUri, String destDocId,
                        File srcDir, int[] counts, boolean isRoot) {
        // 대상 자식 목록 (name -> [docId, mime, sizeStr])
        Map<String, String[]> destMap = new HashMap<>();
        Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, destDocId);
        Cursor c = null;
        try {
            c = resolver.query(childrenUri, new String[]{
                    DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                    DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                    DocumentsContract.Document.COLUMN_MIME_TYPE,
                    DocumentsContract.Document.COLUMN_SIZE
            }, null, null, null);
            if (c != null) {
                while (c.moveToNext()) {
                    String did = c.getString(0);
                    String nm = c.getString(1);
                    String mime = c.getString(2);
                    String size = c.isNull(3) ? "" : String.valueOf(c.getLong(3));
                    if (nm != null) destMap.put(nm, new String[]{did, mime, size});
                }
            }
        } catch (Exception e) {
            if (c != null) try { c.close(); } catch (Exception ignored) {}
            return;
        } finally {
            if (c != null) try { c.close(); } catch (Exception ignored) {}
        }

        Set<String> srcNames = new HashSet<>();
        File[] kids = srcDir.listFiles();
        if (kids != null) {
            for (File k : kids) {
                String name = k.getName();
                srcNames.add(name);
                String[] ci = destMap.get(name);
                if (k.isDirectory()) {
                    String childId = null;
                    if (ci == null) {
                        childId = createDir(resolver, treeUri, destDocId, name);
                    } else if (!DocumentsContract.Document.MIME_TYPE_DIR.equals(ci[1])) {
                        deleteDoc(resolver, treeUri, ci[0]);
                        childId = createDir(resolver, treeUri, destDocId, name);
                    } else {
                        childId = ci[0];
                    }
                    if (childId != null) mirror(resolver, treeUri, childId, k, counts, false);
                } else {
                    boolean need;
                    if (ci == null) {
                        need = true;
                    } else if (DocumentsContract.Document.MIME_TYPE_DIR.equals(ci[1])) {
                        deleteDoc(resolver, treeUri, ci[0]); // 폴더였는데 이제 파일
                        ci = null;
                        need = true;
                    } else {
                        long dsize = -1;
                        try { if (ci[2] != null && ci[2].length() > 0) dsize = Long.parseLong(ci[2]); } catch (Exception ignored) {}
                        boolean isJson = name.toLowerCase().endsWith(".json");
                        need = (dsize != k.length()) || isJson; // json(세션/인덱스)은 항상 최신화
                    }
                    if (need) {
                        if (ci != null) deleteDoc(resolver, treeUri, ci[0]);
                        String newId = createFile(resolver, treeUri, destDocId, mimeOf(name), name);
                        if (newId != null && writeDoc(resolver, treeUri, newId, k)) counts[0]++;
                        else counts[3]++;
                    } else {
                        counts[1]++;
                    }
                }
            }
        }
        /* prune: 원본에 없는 대상 자식 삭제 (삭제된 작업 · 순서편집 잔재 정리)
           ☠️ 2026-09-13 — 맨 위(백업 폴더 그 자체)에서는 '우리가 만든 이름'만 지운다.
              사용자가 DCIM/Camera 를 백업 폴더로 고른 사고가 있었다. 그때 이 루프가
              기존 카메라 사진을 전부 삭제했다(되돌릴 수 없었다). 하위 폴더는 우리가
              만든 작업 폴더 안이므로 그대로 거울 동기화한다.
              ★ isOursTopLevel 게이트를 없애거나 느슨하게 고치지 말 것. */
        for (Map.Entry<String, String[]> e : destMap.entrySet()) {
            String nm = e.getKey();
            if (srcNames.contains(nm)) continue;
            boolean isDir = DocumentsContract.Document.MIME_TYPE_DIR.equals(e.getValue()[1]);
            if (isRoot && !isOursTopLevel(nm, isDir)) {
                counts[4]++;                      // 남의 파일 — 건드리지 않고 세어만 둔다
                continue;
            }
            if (deleteDoc(resolver, treeUri, e.getValue()[0])) counts[2]++;
        }
    }

    private String createDir(ContentResolver resolver, Uri treeUri, String parentDocId, String name) {
        try {
            Uri parent = DocumentsContract.buildDocumentUriUsingTree(treeUri, parentDocId);
            Uri created = DocumentsContract.createDocument(resolver, parent,
                    DocumentsContract.Document.MIME_TYPE_DIR, name);
            return created == null ? null : DocumentsContract.getDocumentId(created);
        } catch (Exception e) { return null; }
    }

    private String createFile(ContentResolver resolver, Uri treeUri, String parentDocId, String mime, String name) {
        try {
            Uri parent = DocumentsContract.buildDocumentUriUsingTree(treeUri, parentDocId);
            Uri created = DocumentsContract.createDocument(resolver, parent, mime, name);
            return created == null ? null : DocumentsContract.getDocumentId(created);
        } catch (Exception e) { return null; }
    }

    /**
     * 3-0) 백업 폴더를 갤러리(사진앱)에서 숨긴다.
     *
     *  왜 필요한가 (2026-09-07 사용자 신고: "자동백업과 갤러리저장을 같이 쓰면 갤러리에 사진이 중복으로 보인다"):
     *    「갤러리 저장」은 Pictures/작업보고서 앨범에 **일부러** 넣는 것이라 보여야 맞다.
     *    반면 자동백업 폴더는 '앱이 관리하는 사본'인데, 안드로이드 미디어 스캐너는 폴더 용도를
     *    구분하지 않고 사진이면 다 색인해서 백업본까지 갤러리에 뜬다 → 같은 사진이 두 번 보인다.
     *
     *  방법: 폴더 맨 위에 빈 `.nomedia` 파일을 하나 둔다. 안드로이드는 그 폴더(와 하위)를
     *        미디어 색인에서 제외한다. 파일 자체는 그대로 남아 복원에는 영향이 없다.
     *
     *  ☠️ .nomedia 를 만들어도 **이미 색인된 사진은 바로 안 사라진다** — "앞으로 색인하지 마라"는
     *     표시일 뿐이다. 그래서 만든 직후 그 폴더를 다시 훑으라고 스캐너에 신호를 보내고,
     *     이미 등록된 줄도 지워 본다(남의 앱 소유면 예외가 나므로 조용히 넘어간다).
     *  ☠️ 삼성 갤러리처럼 자체 색인을 쓰는 앱은 반영이 한 박자 늦을 수 있다.
     */
    @PluginMethod
    public void hideFromGallery(final PluginCall call) {
        final String uriStr = call.getString("uri");      // SAF 백업 폴더 (선택)
        final String absPath = call.getString("path");    // 절대경로 폴더 (선택)
        new Thread(new Runnable() {
            public void run() {
                JSObject ret = new JSObject();
                boolean created = false, existed = false;
                List<String> scanned = new ArrayList<>();
                try {
                    ContentResolver resolver = getContext().getContentResolver();

                    // ── SAF 폴더 ──
                    /* ☠️ 2026-09-13 — 시스템 미디어 폴더(DCIM, DCIM/Camera, Pictures …)에는
                         절대 .nomedia 를 두지 않는다. 두면 사용자의 갤러리가 통째로 빈다.
                         실제로 백업 폴더를 DCIM/Camera 로 고른 사고에서 이 일이 났다. */
                    boolean safBlocked = false;
                    if (uriStr != null && !uriStr.isEmpty()
                            && isSystemMediaDir(relPathOfTree(Uri.parse(uriStr)))) {
                        safBlocked = true;
                        ret.put("blocked", true);
                    }
                    if (!safBlocked && uriStr != null && !uriStr.isEmpty()) {
                        Uri treeUri = Uri.parse(uriStr);
                        String rootId = DocumentsContract.getTreeDocumentId(treeUri);
                        if (findChildByName(resolver, treeUri, rootId, ".nomedia") != null) existed = true;
                        else {
                            // 일부 제공자는 확장자를 덧붙이므로 만든 뒤 이름을 다시 확인한다
                            createFile(resolver, treeUri, rootId, "application/octet-stream", ".nomedia");
                            if (findChildByName(resolver, treeUri, rootId, ".nomedia") != null) created = true;
                        }
                        String p = pathFromTreeUri(treeUri);
                        if (p != null) scanned.add(p);
                    }

                    // ── 절대경로 폴더 (공용 문서 쪽 백업) ──
                    if (absPath != null && !absPath.isEmpty()) {
                        File dir = new File(absPath);
                        if (dir.isDirectory()) {
                            File nm = new File(dir, ".nomedia");
                            if (nm.exists()) existed = true;
                            else { try { if (nm.createNewFile()) created = true; } catch (Exception ignored) {} }
                            if (!scanned.contains(absPath)) scanned.add(absPath);
                        }
                    }

                    // ── 이미 색인된 것 정리 + 다시 훑기 ──
                    List<String> toScan = new ArrayList<>();
                    for (String p : scanned) {
                        purgeMediaStore(resolver, p);
                        toScan.add(p);
                        toScan.add(p + "/.nomedia");
                    }
                    if (!toScan.isEmpty()) {
                        try {
                            android.media.MediaScannerConnection.scanFile(
                                    getContext(), toScan.toArray(new String[0]), null, null);
                        } catch (Exception ignored) {}
                    }

                    ret.put("created", created);
                    ret.put("existed", existed);
                    ret.put("scanned", android.text.TextUtils.join(", ", scanned));
                    call.resolve(ret);
                } catch (Exception e) {
                    call.reject("갤러리 숨기기 실패: " + e.getMessage(), e);
                }
            }
        }).start();
    }

    /** SAF 트리 uri → 내장저장소 절대경로 (기본 저장소일 때만, 아니면 null) */
    private String pathFromTreeUri(Uri treeUri) {
        try {
            String docId = DocumentsContract.getTreeDocumentId(treeUri);
            String[] split = docId.split(":");
            if (split.length >= 1 && "primary".equalsIgnoreCase(split[0])) {
                String tail = (split.length > 1 && split[1] != null && !split[1].isEmpty()) ? ("/" + split[1]) : "";
                return android.os.Environment.getExternalStorageDirectory().getAbsolutePath() + tail;
            }
        } catch (Exception ignored) {}
        return null;
    }

    /** 그 폴더 아래로 이미 등록된 미디어 줄을 지운다. 남의 앱이 등록한 줄은 못 지우므로 조용히 넘어간다. */
    private int purgeMediaStore(ContentResolver resolver, String absDir) {
        try {
            return resolver.delete(
                    android.provider.MediaStore.Files.getContentUri("external"),
                    android.provider.MediaStore.MediaColumns.DATA + " LIKE ?",
                    new String[]{ absDir + "/%" });
        } catch (Exception e) {
            // SecurityException(소유권) 등 — .nomedia 와 재스캔만으로도 결국 빠진다
            return 0;
        }
    }

    /** 3-1) 지정 백업 폴더(uri) 안의 상대경로 문서를 즉시 삭제 (작업 삭제 시 백업 부활 방지) */
    @PluginMethod
    public void deletePath(final PluginCall call) {
        final String uriStr = call.getString("uri");
        final String relPath = call.getString("path");
        if (uriStr == null || uriStr.isEmpty()) { call.reject("uri가 없습니다"); return; }
        if (relPath == null || relPath.isEmpty()) { call.reject("path가 없습니다"); return; }
        new Thread(new Runnable() {
            public void run() {
                try {
                    ContentResolver resolver = getContext().getContentResolver();
                    Uri treeUri = Uri.parse(uriStr);
                    String docId = DocumentsContract.getTreeDocumentId(treeUri);
                    /* ☠️ 2026-09-13 — 한 칸도 내려가지 않으면 백업 폴더 자체를 지우게 된다.
                         '/' · '.' · '..' 같은 값이 들어오면 아래 루프가 전부 건너뛰고
                         docId 가 루트인 채로 삭제가 돌았다. 내려간 칸을 세서 막는다.
                         ★ 이 검사를 지우지 말 것. */
                    int depth = 0;
                    String[] segs = relPath.replace('\\', '/').split("/");
                    for (String seg : segs) {
                        if (seg == null || seg.isEmpty() || seg.equals(".") || seg.equals("..")) continue;
                        String childId = findChildByName(resolver, treeUri, docId, seg);
                        if (childId == null) {
                            JSObject r0 = new JSObject();
                            r0.put("deleted", false);
                            r0.put("notFound", true);
                            call.resolve(r0);
                            return;
                        }
                        docId = childId;
                        depth++;
                    }
                    if (depth == 0) {           // 한 칸도 못 내려갔다 = 백업 폴더 자체 → 절대 안 지운다
                        JSObject r0 = new JSObject();
                        r0.put("deleted", false);
                        r0.put("refused", true);
                        call.resolve(r0);
                        return;
                    }
                    boolean ok = deleteDoc(resolver, treeUri, docId);
                    JSObject ret = new JSObject();
                    ret.put("deleted", ok);
                    call.resolve(ret);
                } catch (Exception e) {
                    call.reject("백업 삭제 실패: " + e.getMessage(), e);
                }
            }
        }).start();
    }

    /** 부모 docId 의 자식 **폴더** 중 이름이 같은 것 (대소문자 무시 — 파일시스템이 바꿔 줄 수 있다).
     *  ☠️ 전용 백업 폴더를 찾을 때만 쓴다. 정확히 일치하는 것을 먼저 보고, 없으면 대소문자만 다른 것을 받는다.
     *     이게 없으면 제공자가 'Work-Report-Backups' 로 돌려줄 때 같은 폴더를 매번 새로 만든다. */
    private String findChildDir(ContentResolver resolver, Uri treeUri, String parentDocId, String name) {
        Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, parentDocId);
        Cursor c = null;
        String loose = null;
        try {
            c = resolver.query(childrenUri, new String[]{
                    DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                    DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                    DocumentsContract.Document.COLUMN_MIME_TYPE
            }, null, null, null);
            if (c != null) {
                while (c.moveToNext()) {
                    String nm = c.getString(1);
                    if (nm == null) continue;
                    if (!DocumentsContract.Document.MIME_TYPE_DIR.equals(c.getString(2))) continue;
                    if (name.equals(nm)) return c.getString(0);
                    if (loose == null && name.equalsIgnoreCase(nm)) loose = c.getString(0);
                }
            }
        } catch (Exception ignored) {
        } finally {
            if (c != null) try { c.close(); } catch (Exception ignored) {}
        }
        return loose;
    }

    // 부모 docId의 자식 중 이름이 일치하는 문서 docId 반환 (없으면 null)
    private String findChildByName(ContentResolver resolver, Uri treeUri, String parentDocId, String name) {
        Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, parentDocId);
        Cursor c = null;
        try {
            c = resolver.query(childrenUri, new String[]{
                    DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                    DocumentsContract.Document.COLUMN_DISPLAY_NAME
            }, null, null, null);
            if (c != null) {
                while (c.moveToNext()) {
                    String did = c.getString(0);
                    String nm = c.getString(1);
                    if (name.equals(nm)) return did;
                }
            }
        } catch (Exception ignored) {
        } finally {
            if (c != null) try { c.close(); } catch (Exception ignored) {}
        }
        return null;
    }

    private boolean deleteDoc(ContentResolver resolver, Uri treeUri, String docId) {
        try {
            Uri u = DocumentsContract.buildDocumentUriUsingTree(treeUri, docId);
            return DocumentsContract.deleteDocument(resolver, u);
        } catch (Exception e) { return false; }
    }

    private boolean writeDoc(ContentResolver resolver, Uri treeUri, String docId, File src) {
        InputStream in = null;
        OutputStream out = null;
        try {
            Uri u = DocumentsContract.buildDocumentUriUsingTree(treeUri, docId);
            in = new FileInputStream(src);
            out = resolver.openOutputStream(u, "w");
            if (out == null) return false;
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            out.flush();
            return true;
        } catch (Exception e) {
            return false;
        } finally {
            try { if (out != null) out.close(); } catch (Exception ignored) {}
            try { if (in != null) in.close(); } catch (Exception ignored) {}
        }
    }

    private String mimeOf(String name) {
        String n = name.toLowerCase();
        if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
        if (n.endsWith(".png")) return "image/png";
        if (n.endsWith(".json")) return "application/json";
        if (n.endsWith(".txt")) return "text/plain";
        return "application/octet-stream";
    }

    /** 2) 선택된 폴더(uri)를 walk하며 모든 파일을 EXTERNAL/<appFolder>로 복사 */
    @PluginMethod
    public void restoreTree(final PluginCall call) {
        final String uriStr = call.getString("uri");
        if (uriStr == null || uriStr.isEmpty()) { call.reject("uri가 없습니다"); return; }
        final String appFolder = call.getString("appFolder", "work-report");

        new Thread(new Runnable() {
            public void run() {
                try {
                    ContentResolver resolver = getContext().getContentResolver();
                    File destRoot = new File(getContext().getExternalFilesDir(null), appFolder);
                    if (!destRoot.exists()) destRoot.mkdirs();

                    Uri treeUri = Uri.parse(uriStr);
                    String rootDocId = DocumentsContract.getTreeDocumentId(treeUri);

                    // ★ 1단계: 목록만 먼저 모아 전체 개수 파악 (진행률 표시용, 바이트 복사 없음 → 상대적으로 빠름)
                    List<String[]> files = new ArrayList<>(); // [childId, childRel]
                    collectFiles(resolver, treeUri, rootDocId, "", files);
                    int total = files.size();
                    notifyProgress(0, total);

                    // ★ 2단계: 실제 복사, 진행 상황을 주기적으로 JS에 알림
                    int[] counts = new int[]{0, 0, 0}; // ok, skip, fail
                    long lastNotify = System.currentTimeMillis();
                    for (int i = 0; i < files.size(); i++) {
                        String[] f = files.get(i);
                        copyOne(resolver, treeUri, f[0], f[1], destRoot, counts);
                        int done = i + 1;
                        long now = System.currentTimeMillis();
                        // 200ms 마다 + 마지막 항목은 반드시 알림 (너무 자주 알리면 JS 쪽 부담)
                        if (done == total || now - lastNotify >= 200) {
                            notifyProgress(done, total);
                            lastNotify = now;
                        }
                    }

                    JSObject ret = new JSObject();
                    ret.put("ok", counts[0]);
                    ret.put("skip", counts[1]);
                    ret.put("fail", counts[2]);
                    call.resolve(ret);
                } catch (Exception e) {
                    call.reject("복원 실패: " + e.getMessage(), e);
                }
            }
        }).start();
    }

    // 진행률 이벤트: JS 쪽에서 BackupFolder.addListener('restoreProgress', cb) 로 받는다
    private void notifyProgress(int done, int total) {
        JSObject data = new JSObject();
        data.put("done", done);
        data.put("total", total);
        notifyListeners("restoreProgress", data);
    }

    // 폴더 트리를 훑어 파일(디렉토리 아님) 목록만 수집 — 복사 없이 목록 조회만 하므로 가볍다
    private void collectFiles(ContentResolver resolver, Uri treeUri, String docId, String rel,
                              List<String[]> out) {
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, docId);
        Cursor c = null;
        try {
            c = resolver.query(children, new String[]{
                    DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                    DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                    DocumentsContract.Document.COLUMN_MIME_TYPE
            }, null, null, null);
            if (c == null) return;
            while (c.moveToNext()) {
                String childId = c.getString(0);
                String name = c.getString(1);
                String mime = c.getString(2);
                String childRel = rel.isEmpty() ? name : rel + "/" + name;
                if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) {
                    collectFiles(resolver, treeUri, childId, childRel, out);
                } else {
                    out.add(new String[]{childId, childRel});
                }
            }
        } catch (Exception e) {
            // 폴더 단위 오류는 건너뜀
        } finally {
            if (c != null) try { c.close(); } catch (Exception ignored) {}
        }
    }

    private void copyOne(ContentResolver resolver, Uri treeUri, String docId,
                         String childRel, File destRoot, int[] counts) {
        String appRel = stripToDateRoot(childRel);
        if (appRel == null || appRel.isEmpty()) return;
        File dest = new File(destRoot, appRel);
        // ★ 비파괴: 이미 있는 파일은 건너뜀 (지금 데이터 보호, 없는 것만 채움)
        if (dest.exists()) { counts[1]++; return; }
        File parent = dest.getParentFile();
        if (parent != null && !parent.exists()) parent.mkdirs();

        InputStream in = null;
        FileOutputStream out = null;
        try {
            Uri docUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, docId);
            in = resolver.openInputStream(docUri);
            if (in == null) { counts[2]++; return; }
            out = new FileOutputStream(dest);
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            out.flush();
            counts[0]++;
        } catch (Exception e) {
            counts[2]++;
            try { if (dest.exists()) dest.delete(); } catch (Exception ignored) {}
        } finally {
            try { if (out != null) out.close(); } catch (Exception ignored) {}
            try { if (in != null) in.close(); } catch (Exception ignored) {}
        }
    }

    /** backup.js의 _relFromZipPath와 동일 규칙: 첫 YYYY-MM-DD 세그먼트부터 잘라냄 */
    private String stripToDateRoot(String path) {
        String p = path.replaceAll("^/+", "");
        String[] parts = p.split("/");
        for (int i = 0; i < parts.length; i++) {
            if (parts[i].matches("\\d{4}-\\d{2}-\\d{2}.*")) {
                StringBuilder sb = new StringBuilder();
                for (int j = i; j < parts.length; j++) {
                    if (sb.length() > 0) sb.append("/");
                    sb.append(parts[j]);
                }
                return sb.toString();
            }
        }
        String rel = p.replaceFirst("^(work-report|aircon-report)/", "");
        rel = rel.replaceFirst("^backup_[^/]+/", "");
        return rel;
    }
}
