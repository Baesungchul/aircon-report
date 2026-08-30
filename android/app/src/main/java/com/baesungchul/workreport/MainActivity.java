package com.baesungchul.workreport;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register MediaStore-based gallery save plugin
        registerPlugin(GallerySaverPlugin.class);
        // Register SAF folder-restore plugin (백업 폴더 직접 선택 복원)
        registerPlugin(BackupFolderPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
