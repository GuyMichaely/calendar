package com.guymichaely.calendar;

import android.net.Uri;
import android.os.Bundle;
import android.webkit.ServiceWorkerClient;
import android.webkit.ServiceWorkerController;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(RemindersPlugin.class);
        super.onCreate(savedInstanceState);
        // Capacitor loads the site's pages natively to add its bridge, following redirects itself, so
        // the WebView never takes part. Signing in is a chain of them (Access, Cloudflare's login, back
        // with the cookie), which only works as a browser does it: the server's pages under /sync and
        // Access's under /cdn-cgi aren't the app and need no bridge, so the WebView loads them itself.
        bridge.setWebViewClient(new BridgeWebViewClient(bridge) {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return serverOnly(request.getUrl()) ? null : super.shouldInterceptRequest(view, request);
            }
        });
        ServiceWorkerController.getInstance().setServiceWorkerClient(new ServiceWorkerClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) {
                return serverOnly(request.getUrl()) ? null : bridge.getLocalServer().shouldInterceptRequest(request);
            }
        });
    }

    private static boolean serverOnly(Uri url) {
        String path = url.getPath();
        return Uri.parse(Reminders.SITE).getHost().equalsIgnoreCase(url.getHost()) && path != null
            && (path.equals("/sync") || path.startsWith("/sync/") || path.startsWith("/cdn-cgi/"));
    }
}
