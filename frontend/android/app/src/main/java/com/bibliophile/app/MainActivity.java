package com.bibliophile.app;

import android.annotation.SuppressLint;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private boolean selectionJavascriptBridgeInstalled = false;

    @Override
    @SuppressLint("SetJavaScriptEnabled")
    public void onStart() {
        super.onStart();
        configureReaderSelectionOverride();
    }

    private void configureReaderSelectionOverride() {
        if (getBridge() == null) {
            return;
        }

        WebView webView = getBridge().getWebView();
        if (webView == null) {
            return;
        }

        if (WebViewFeature.isFeatureSupported(WebViewFeature.DISABLED_ACTION_MODE_MENU_ITEMS)) {
            WebSettingsCompat.setDisabledActionModeMenuItems(
                webView.getSettings(),
                WebSettings.MENU_ITEM_SHARE | WebSettings.MENU_ITEM_WEB_SEARCH | WebSettings.MENU_ITEM_PROCESS_TEXT
            );
        }

        if (!selectionJavascriptBridgeInstalled && webView instanceof BibliophileWebView bibliophileWebView) {
            webView.addJavascriptInterface(new ReaderSelectionJavascriptBridge(bibliophileWebView), "BibliophileSelectionAndroid");
            selectionJavascriptBridgeInstalled = true;
        }
    }

    private static final class ReaderSelectionJavascriptBridge {

        private final BibliophileWebView webView;

        private ReaderSelectionJavascriptBridge(BibliophileWebView webView) {
            this.webView = webView;
        }

        @JavascriptInterface
        public void setReaderSelectionOverrideEnabled(boolean enabled) {
            webView.post(() -> webView.setReaderSelectionOverrideEnabled(enabled));
        }
    }
}
