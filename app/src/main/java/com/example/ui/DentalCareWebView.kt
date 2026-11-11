package com.example.ui

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun DentalCareWebView(
    url: String,
    modifier: Modifier = Modifier,
    onWebViewCreated: ((WebView) -> Unit)? = null
) {
    val context = LocalContext.current
    var webViewInstance by remember { mutableStateOf<WebView?>(null) }
    var loadingProgress by remember { mutableIntStateOf(0) }
    var isLoading by remember { mutableStateOf(true) }
    var uploadMessage by remember { mutableStateOf<ValueCallback<Array<Uri>>?>(null) }

    val filePickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            val uri = result.data?.data
            val clipData = result.data?.clipData
            val results = when {
                clipData != null -> Array(clipData.itemCount) { i -> clipData.getItemAt(i).uri }
                uri != null -> arrayOf(uri)
                else -> null
            }
            uploadMessage?.onReceiveValue(results)
        } else {
            uploadMessage?.onReceiveValue(null)
        }
        uploadMessage = null
    }

    // Handle back button for in-app web navigation
    BackHandler(enabled = webViewInstance?.canGoBack() == true) {
        webViewInstance?.goBack()
    }

    Box(modifier = modifier.fillMaxSize()) {
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { ctx ->
                WebView(ctx).apply {
                    layoutParams = ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT
                    )
                    setBackgroundColor(android.graphics.Color.parseColor("#0a0e27"))

                    settings.apply {
                        javaScriptEnabled = true
                        domStorageEnabled = true
                        databaseEnabled = true
                        allowFileAccess = true
                        allowContentAccess = true
                        allowFileAccessFromFileURLs = true
                        allowUniversalAccessFromFileURLs = true
                        loadWithOverviewMode = true
                        useWideViewPort = true
                        setSupportZoom(false)
                        cacheMode = WebSettings.LOAD_NO_CACHE
                        mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
                    }
                    clearCache(true)

                    webViewClient = object : WebViewClient() {
                        override fun shouldInterceptRequest(
                            view: WebView?,
                            request: WebResourceRequest?
                        ): android.webkit.WebResourceResponse? {
                            val reqUrl = request?.url ?: return super.shouldInterceptRequest(view, request)
                            val host = reqUrl.host ?: ""
                            if (host == "127.0.0.1" || host == "localhost" || host == "appassets.androidplatform.net") {
                                var path = reqUrl.path ?: "/index.html"
                                if (path == "/" || path.isEmpty()) path = "/index.html"
                                while (path.startsWith("/") || path.startsWith("./")) {
                                    path = if (path.startsWith("./")) path.substring(2) else path.substring(1)
                                }
                                if (path.isEmpty()) path = "index.html"
                                val assetPath = "www/$path"
                                val isStatic = path.contains(".") && !path.endsWith(".html")

                                val mime = when {
                                    path.endsWith(".html") -> "text/html"
                                    path.endsWith(".js") || path.endsWith(".mjs") -> "application/javascript"
                                    path.endsWith(".css") -> "text/css"
                                    path.endsWith(".svg") -> "image/svg+xml"
                                    path.endsWith(".json") || path.endsWith(".webmanifest") -> "application/json"
                                    path.endsWith(".png") -> "image/png"
                                    path.endsWith(".jpg") || path.endsWith(".jpeg") -> "image/jpeg"
                                    path.endsWith(".ico") -> "image/x-icon"
                                    path.endsWith(".woff2") -> "font/woff2"
                                    path.endsWith(".woff") -> "font/woff"
                                    path.endsWith(".ttf") -> "font/ttf"
                                    path.endsWith(".apk") -> "application/vnd.android.package-archive"
                                    path.endsWith(".mobileconfig") -> "application/x-apple-aspen-config"
                                    else -> "text/html"
                                }

                                val stream = try {
                                    ctx.assets.open(assetPath)
                                } catch (e: Exception) {
                                    if (isStatic) null else {
                                        try { ctx.assets.open("www/index.html") } catch (e2: Exception) { null }
                                    }
                                }

                                if (stream != null) {
                                    val headers = mapOf(
                                        "Access-Control-Allow-Origin" to "*",
                                        "Cache-Control" to "no-store, no-cache, must-revalidate"
                                    )
                                    return android.webkit.WebResourceResponse(
                                        mime,
                                        "UTF-8",
                                        200,
                                        "OK",
                                        headers,
                                        stream
                                    )
                                }
                            }
                            return super.shouldInterceptRequest(view, request)
                        }

                        override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                            isLoading = true
                        }

                        override fun onPageFinished(view: WebView?, url: String?) {
                            isLoading = false
                        }

                        override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                            return false
                        }

                        override fun onReceivedError(
                            view: WebView?,
                            request: WebResourceRequest?,
                            error: android.webkit.WebResourceError?
                        ) {
                            super.onReceivedError(view, request, error)
                            if (request?.isForMainFrame == true) {
                                android.util.Log.e("DentalCareWebView", "Main frame load error: ${error?.description}")
                                view?.postDelayed({
                                    view.reload()
                                }, 400)
                            }
                        }
                    }

                    webChromeClient = object : WebChromeClient() {
                        override fun onProgressChanged(view: WebView?, newProgress: Int) {
                            loadingProgress = newProgress
                            if (newProgress >= 100) isLoading = false
                        }

                        override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
                            return true
                        }

                        override fun onShowFileChooser(
                            view: WebView?,
                            filePathCallback: ValueCallback<Array<Uri>>?,
                            fileChooserParams: FileChooserParams?
                        ): Boolean {
                            uploadMessage?.onReceiveValue(null)
                            uploadMessage = filePathCallback
                            val intent = fileChooserParams?.createIntent() ?: Intent(Intent.ACTION_GET_CONTENT).apply {
                                type = "*/*"
                                addCategory(Intent.CATEGORY_OPENABLE)
                            }
                            try {
                                filePickerLauncher.launch(intent)
                            } catch (e: Exception) {
                                uploadMessage?.onReceiveValue(null)
                                uploadMessage = null
                                return false
                            }
                            return true
                        }
                    }

                    loadUrl(url)
                    webViewInstance = this
                    onWebViewCreated?.invoke(this)
                }
            },
            update = { view ->
                // Keep view active
            }
        )
    }

    DisposableEffect(Unit) {
        onDispose {
            webViewInstance?.destroy()
        }
    }
}
