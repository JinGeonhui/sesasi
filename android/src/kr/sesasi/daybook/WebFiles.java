package kr.sesasi.daybook;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.widget.Toast;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class WebFiles {
    private static final int PICK_FILE = 100;
    private static final int SAVE_BACKUP = 101;
    private static final long MAX_BACKUP_SIZE = 150L * 1024 * 1024;
    private final Activity activity;
    private final WebView web;
    private final ExecutorService writes = Executors.newSingleThreadExecutor();
    private ValueCallback<Uri[]> selection;
    private File backup;
    private Writer writer;
    private String filename;
    private long characters;
    private boolean closed;

    WebFiles(Activity activity, WebView web) {
        this.activity = activity;
        this.web = web;
    }

    boolean choose(ValueCallback<Uri[]> callback, WebChromeClient.FileChooserParams params) {
        if (selection != null) selection.onReceiveValue(null);
        selection = callback;
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        // Only the user's selected content URIs are granted to the WebView.
        intent.setType("*/*");
        ArrayList<String> types = new ArrayList<>();
        for (String accept : params.getAcceptTypes()) {
            for (String type : accept.split(",")) if (type.trim().contains("/")) types.add(type.trim());
        }
        if (!types.isEmpty()) intent.putExtra(Intent.EXTRA_MIME_TYPES, types.toArray(new String[0]));
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE);
        try { activity.startActivityForResult(intent, PICK_FILE); }
        catch (android.content.ActivityNotFoundException unavailable) {
            selection.onReceiveValue(null);
            selection = null;
            Toast.makeText(activity, "파일 선택기를 열 수 없어요.", Toast.LENGTH_SHORT).show();
        }
        return true;
    }

    @JavascriptInterface public synchronized boolean beginBackup(String name) {
        if (closed || backup != null || name == null || !name.matches("sesasi-[0-9-]+\\.json")) return false;
        try {
            backup = File.createTempFile("sesasi-backup-", ".json", activity.getCacheDir());
            writer = new OutputStreamWriter(new FileOutputStream(backup), StandardCharsets.UTF_8);
            filename = name;
            characters = 0;
            return true;
        } catch (IOException failure) { cancelBackup(); return false; }
    }

    @JavascriptInterface public synchronized boolean appendBackup(String text) {
        if (closed || writer == null || text == null || characters + text.length() > MAX_BACKUP_SIZE) return false;
        try {
            writer.write(text);
            characters += text.length();
            return true;
        } catch (IOException failure) { cancelBackup(); return false; }
    }

    @JavascriptInterface public synchronized void finishBackup() {
        try {
            if (writer == null) throw new IOException("No pending backup");
            writer.close();
            writer = null;
            if (backup.length() > MAX_BACKUP_SIZE) throw new IOException("Backup too large");
            activity.runOnUiThread(() -> {
                if (closed) return;
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("application/json");
                intent.putExtra(Intent.EXTRA_TITLE, filename);
                try { activity.startActivityForResult(intent, SAVE_BACKUP); }
                catch (android.content.ActivityNotFoundException unavailable) { complete("error"); }
            });
        } catch (IOException failure) { complete("error"); }
    }

    @JavascriptInterface public synchronized void cancelBackup() {
        try { if (writer != null) writer.close(); } catch (IOException ignored) {}
        writer = null;
        if (backup != null) backup.delete();
        backup = null;
    }

    boolean result(int request, int result, Intent data) {
        if (request == PICK_FILE) {
            if (selection != null) {
                Uri[] uris = WebChromeClient.FileChooserParams.parseResult(result, data);
                // Decline file:// and other schemes even if a third-party picker returns them.
                if (uris != null) for (Uri uri : uris) {
                    if (!"content".equals(uri.getScheme())) { uris = null; break; }
                }
                selection.onReceiveValue(uris);
                selection = null;
            }
            return true;
        }
        if (request != SAVE_BACKUP) return false;
        if (result != Activity.RESULT_OK || data == null || data.getData() == null) {
            complete("cancelled");
            return true;
        }
        Uri destination = data.getData();
        if (!"content".equals(destination.getScheme())) { complete("error"); return true; }
        writes.execute(() -> {
            // Serialize with cleanup if Android destroys the activity during a write.
            synchronized (this) {
                if (backup == null || closed) return;
                try (FileInputStream input = new FileInputStream(backup);
                     OutputStream output = activity.getContentResolver().openOutputStream(destination, "wt")) {
                    if (output == null) throw new IOException("Destination unavailable");
                    byte[] buffer = new byte[65536];
                    int length;
                    while ((length = input.read(buffer)) != -1) output.write(buffer, 0, length);
                } catch (IOException failure) { complete("error"); return; }
                complete("saved");
            }
        });
        return true;
    }

    private void complete(String status) {
        cancelBackup();
        activity.runOnUiThread(() -> {
            if (!closed) web.evaluateJavascript("window.dispatchEvent(new CustomEvent('sesasi-backup-result',{detail:'" + status + "'}))", null);
        });
    }

    void close() {
        synchronized (this) {
            closed = true;
            cancelBackup();
        }
        if (selection != null) selection.onReceiveValue(null);
        selection = null;
        writes.shutdown();
    }
}
