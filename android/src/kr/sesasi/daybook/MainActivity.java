package kr.sesasi.daybook;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Build;
import android.os.Message;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

public final class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String HOME = "https://" + HOST + "/";
    private WebView web;
    private WebFiles files;
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        files = new WebFiles(this, web);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(true);
        web.getSettings().setSupportMultipleWindows(true);
        web.addJavascriptInterface(files, "SesasiFiles");
        // JavaScript and the bridge run only in pages bundled with this application.
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                return files.choose(callback, params);
            }
            @Override public boolean onCreateWindow(WebView view, boolean dialog, boolean gesture, Message message) {
                if (!gesture) return false;
                WebView popup = new WebView(MainActivity.this);
                popup.setWebViewClient(new WebViewClient() {
                    @Override public boolean shouldOverrideUrlLoading(WebView child, WebResourceRequest request) {
                        openExternal(request.getUrl());
                        child.post(child::destroy);
                        return true;
                    }
                });
                ((WebView.WebViewTransport) message.obj).setWebView(popup);
                message.sendToTarget();
                return true;
            }
        });
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri uri = req.getUrl();
                if (!req.isForMainFrame()) return true;
                if (local(uri)) return false;
                if (req.hasGesture()) openExternal(uri);
                return true;
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                Uri uri = req.getUrl();
                String path = uri.getPath();
                if (!local(uri)) {
                    // Only weather and air-quality requests leave the app.
                    if (!req.isForMainFrame() && req.getMethod().equals("GET") && "https".equals(uri.getScheme())
                        && ("api.open-meteo.com".equals(uri.getHost()) || "air-quality-api.open-meteo.com".equals(uri.getHost()))) return null;
                    return json(403, "{}");
                }
                if (path == null || path.contains("..")) return json(404, "{}");
                try {
                    if (path.endsWith("/")) path += "index.html";
                    else if (!path.substring(path.lastIndexOf('/') + 1).contains(".")) path += "/index.html";
                    InputStream in = getAssets().open(path.substring(1));
                    String type = contentType(path);
                    Map<String,String> headers = new HashMap<>();
                    headers.put("Cache-Control", "no-cache");
                    headers.put("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://api.open-meteo.com https://air-quality-api.open-meteo.com; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'");
                    return new WebResourceResponse(type, "UTF-8", 200, "OK", headers, in);
                } catch (java.io.IOException missing) { return json(404, "{}"); }
                  catch (Exception failure) { return json(500, "{}"); }
            }
        });
        setContentView(web);
        if (state == null || web.restoreState(state) == null) web.loadUrl(HOME);
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::back);
        }
    }
    private static String contentType(String path) {
        if (path.endsWith(".js")) return "application/javascript";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".html")) return "text/html";
        if (path.endsWith(".txt")) return "text/plain";
        if (path.endsWith(".json")) return "application/json";
        if (path.endsWith(".svg")) return "image/svg+xml";
        if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
        if (path.endsWith(".png")) return "image/png";
        if (path.endsWith(".webp")) return "image/webp";
        if (path.endsWith(".ico")) return "image/x-icon";
        if (path.endsWith(".woff2")) return "font/woff2";
        return "application/octet-stream";
    }
    private void openExternal(Uri uri) {
        if (!"https".equals(uri.getScheme()) && !"http".equals(uri.getScheme())) return;
        try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); }
        catch (android.content.ActivityNotFoundException unavailable) {
            Toast.makeText(this, "링크를 열 앱을 찾을 수 없어요.", Toast.LENGTH_SHORT).show();
        }
    }
    private void back() {
        web.evaluateJavascript("(()=>{const dialog=document.querySelector('dialog[open]');if(!dialog)return false;if(dialog.dispatchEvent(new Event('cancel',{cancelable:true})))dialog.close();return true})()", handled -> {
            if ("true".equals(handled)) return;
            if (web.canGoBack()) web.goBack();
            else moveTaskToBack(true);
        });
    }
    @Override public void onBackPressed() { back(); }
    @Override protected void onSaveInstanceState(Bundle state) { web.saveState(state); super.onSaveInstanceState(state); }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        if (!files.result(request, result, data)) super.onActivityResult(request, result, data);
    }
    private static boolean local(Uri uri) {
        return "https".equals(uri.getScheme()) && HOST.equals(uri.getHost()) && uri.getPort() == -1;
    }
    private static WebResourceResponse json(int status, String value) {
        Map<String,String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store");
        return new WebResourceResponse("application/json", "UTF-8", status, status == 200 ? "OK" : "Error", headers,
            new ByteArrayInputStream(value.getBytes(StandardCharsets.UTF_8)));
    }
    @Override public void onDestroy() { files.close(); web.destroy(); super.onDestroy(); }
}
