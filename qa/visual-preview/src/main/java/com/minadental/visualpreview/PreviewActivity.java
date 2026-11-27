package com.minadental.visualpreview;

import android.app.Activity;
import android.os.Bundle;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebSettings;
import android.webkit.ServiceWorkerController;
import android.webkit.ServiceWorkerClient;
import android.widget.LinearLayout;
import android.widget.Button;
import android.widget.TextView;
import androidx.webkit.WebViewAssetLoader;
import java.io.ByteArrayInputStream;

public final class PreviewActivity extends Activity {
    private static final String ORIGIN = "https://appassets.androidplatform.net";
    private WebView web;
    private static boolean local(Uri uri) {
        return uri != null && "https".equals(uri.getScheme()) &&
            "appassets.androidplatform.net".equals(uri.getHost()) &&
            (uri.getPort() == -1 || uri.getPort() == 443);
    }
    private static WebResourceResponse blocked() {
        return new WebResourceResponse("text/plain", "UTF-8", 403, "Offline QA",
            java.util.Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
    }
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
            .addPathHandler("/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setOnApplyWindowInsetsListener((v, i) -> {
            v.setPadding(i.getSystemWindowInsetLeft(), i.getSystemWindowInsetTop(),
                i.getSystemWindowInsetRight(), i.getSystemWindowInsetBottom());
            return i;
        });
        TextView banner = new TextView(this);
        banner.setText("نسخه آزمایشی آفلاین — بدون اتصال به مطب؛ اطلاعات واقعی وارد نکنید");
        banner.setTextColor(0xffffffff);
        banner.setBackgroundColor(0xff142e43);
        banner.setPadding(16, 12, 16, 12);
        root.addView(banner);
        LinearLayout controls = new LinearLayout(this);
        Button gallery = new Button(this); gallery.setText("تصاویر تست");
        Button live = new Button(this); live.setText("رابط برنامه");
        controls.addView(gallery, new LinearLayout.LayoutParams(0, -2, 1));
        controls.addView(live, new LinearLayout.LayoutParams(0, -2, 1));
        root.addView(controls);
        web = new WebView(this);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setBlockNetworkLoads(true);
        settings.setSupportMultipleWindows(false);
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (!local(request.getUrl())) return blocked();
                WebResourceResponse response = loader.shouldInterceptRequest(request.getUrl());
                return response == null ? blocked() : response;
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !local(request.getUrl());
            }
        });
        ServiceWorkerController workers = ServiceWorkerController.getInstance();
        workers.getServiceWorkerWebSettings().setBlockNetworkLoads(true);
        workers.getServiceWorkerWebSettings().setAllowFileAccess(false);
        workers.getServiceWorkerWebSettings().setAllowContentAccess(false);
        workers.setServiceWorkerClient(new ServiceWorkerClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) {
                if (!local(request.getUrl())) return blocked();
                WebResourceResponse response = loader.shouldInterceptRequest(request.getUrl());
                return response == null ? blocked() : response;
            }
        });
        gallery.setOnClickListener(v -> web.loadUrl(ORIGIN + "/qa-gallery/index.html"));
        live.setOnClickListener(v -> web.loadUrl(ORIGIN + "/index.html"));
        root.addView(web, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(root);
        web.loadUrl(ORIGIN + "/qa-gallery/index.html");
    }
    @Override protected void onDestroy() {
        if (web != null) { web.destroy(); web = null; }
        super.onDestroy();
    }
}
