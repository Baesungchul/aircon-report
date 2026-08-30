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
import java.util.HashMap;
import java.util.HashSet;
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

    /** 1-b) 자동백업용 폴더 선택 — 읽기+쓰기 영구 권한 확보 */
    @PluginMethod
    public void pickBackupFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
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
        JSObject ret = new JSObject();
        ret.put("uri", treeUri.toString());
        call.resolve(ret);
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
                    int[] counts = new int[]{0, 0, 0, 0}; // copied, skipped, pruned, fail
                    if (srcRoot.exists() && srcRoot.isDirectory()) {
                        mirror(resolver, treeUri, rootDocId, srcRoot, counts);
                    }
                    JSObject ret = new JSObject();
                    ret.put("copied", counts[0]);
                    ret.put("skipped", counts[1]);
                    ret.put("pruned", counts[2]);
                    ret.put("fail", counts[3]);
                    call.resolve(ret);
                } catch (Exception e) {
                    call.reject("백업 실패: " + e.getMessage(), e);
                }
            }
        }).start();
    }

    // 한 디렉토리를 대상 폴더에 거울 동기화 (재귀)
    private void mirror(ContentResolver resolver, Uri treeUri, String destDocId,
                        File srcDir, int[] counts) {
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
                    if (childId != null) mirror(resolver, treeUri, childId, k, counts);
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
        // prune: 원본에 없는 대상 자식 삭제 (삭제된 작업 · 순서편집 잔재 정리)
        for (Map.Entry<String, String[]> e : destMap.entrySet()) {
            if (!srcNames.contains(e.getKey())) {
                if (deleteDoc(resolver, treeUri, e.getValue()[0])) counts[2]++;
            }
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
                    String[] segs = relPath.split("/");
                    for (String seg : segs) {
                        if (seg == null || seg.isEmpty() || seg.equals("..")) continue;
                        String childId = findChildByName(resolver, treeUri, docId, seg);
                        if (childId == null) {
                            JSObject r0 = new JSObject();
                            r0.put("deleted", false);
                            r0.put("notFound", true);
                            call.resolve(r0);
                            return;
                        }
                        docId = childId;
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

                    int[] counts = new int[]{0, 0, 0}; // ok, skip, fail
                    walk(resolver, treeUri, rootDocId, "", destRoot, counts);

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

    private void walk(ContentResolver resolver, Uri treeUri, String docId, String rel,
                      File destRoot, int[] counts) {
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
                    walk(resolver, treeUri, childId, childRel, destRoot, counts);
                } else {
                    copyOne(resolver, treeUri, childId, childRel, destRoot, counts);
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
