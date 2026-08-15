package com.veritas.ai

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.webkit.*
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.result.ActivityResultLauncher
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import com.veritas.ai.auth.AuthManager
import com.veritas.ai.camera.CameraHelper
import com.veritas.ai.deep.DeepLinkRouter
import com.veritas.ai.offline.OfflineManager
import kotlinx.coroutines.launch

/**
 * Veritas AI - Main WebView with auth gate, offline detection, camera,
 * deep links, share intent, and settings bridge.
 *
 * Flow:
 * 1. Check AuthManager for valid session token
 * 2. If no valid session, redirect to LoginActivity
 * 3. If valid, load WebView with token injected into localStorage
 * 4. WebView auth interceptor adds Authorization header to all API calls
 * 5. Offline banner shows when connectivity is lost
 * 6. Camera button allows native photo capture
 * 7. Deep links and shared text are injected into the web app
 */
class MainActivity : AppCompatActivity() {

    companion object {
        private const val VERITAS_URL = "https://veritas-ai.pages.dev"
        private const val VERITAS_ORIGIN = "https://veritas-ai.pages.dev"
        private const val FILE_CHOOSER_REQUEST_CODE = 1001
    }

    private lateinit var auth: AuthManager
    private lateinit var webView: WebView
    private lateinit var swipeRefreshLayout: SwipeRefreshLayout
    private lateinit var offlineManager: OfflineManager
    private lateinit var offlineBanner: View
    private var uploadMessage: ValueCallback<Array<Uri>>? = null

    // Activity result launchers
    private lateinit var cameraLauncher: ActivityResultLauncher<Unit>
    private lateinit var galleryLauncher: ActivityResultLauncher<Unit>

    // Pending actions to execute after page load
    private var pendingJs: String? = null
    private var pendingDeepLink: String? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        auth = AuthManager.getInstance(this)

        // Auth gate: redirect to login if no valid session
        if (!auth.isLoggedIn) {
            redirectToLogin()
            return
        }

        // Validate session server-side in background
        lifecycleScope.launch {
            val valid = auth.validateSession()
            if (!valid) {
                auth.clearSession()
                redirectToLogin()
            }
        }

        // Register activity result launchers
        cameraLauncher = registerForActivityResult(CameraHelper.Capture()) { uri ->
            uri?.let { injectImageToChat(it) }
        }
        galleryLauncher = registerForActivityResult(CameraHelper.PickImage()) { uri ->
            uri?.let { injectImageToChat(it) }
        }

        // Setup offline manager
        offlineManager = OfflineManager(this)
        lifecycle.addObserver(offlineManager)
        offlineManager.onConnectivityChanged = { online ->
            runOnUiThread { showOfflineBanner(!online) }
        }

        // Fullscreen immersive
        setupImmersiveMode()
        window.setFlags(
            WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
        )

        // Root layout: offline banner on top, swipe refresh wrapping webview
        val rootLayout = FrameLayout(this)

        // Build offline banner (hidden by default)
        offlineBanner = buildOfflineBanner()
        rootLayout.addView(offlineBanner)

        swipeRefreshLayout = SwipeRefreshLayout(this).apply {
            setColorSchemeColors(Color.parseColor("#50C878"))
            setOnRefreshListener {
                if (offlineManager.isOnline) webView.reload() else isRefreshing = false
            }
        }

        webView = WebView(this).apply {
            setLayerType(View.LAYER_TYPE_HARDWARE, null)
            overScrollMode = View.OVER_SCROLL_NEVER
            isVerticalScrollBarEnabled = false
            isHorizontalScrollBarEnabled = false
        }

        // Camera FAB overlay on top of WebView
        val cameraFab = buildCameraFab()

        configureWebView(webView)
        swipeRefreshLayout.addView(webView)
        rootLayout.addView(swipeRefreshLayout)
        rootLayout.addView(cameraFab)
        setContentView(rootLayout)

        // Handle incoming extras
        handleIntentExtras(intent)

        if (savedInstanceState == null) {
            webView.loadUrl(VERITAS_URL)
        }
    }

    // --- Offline Banner ---

    private fun buildOfflineBanner(): FrameLayout {
        return FrameLayout(this).apply {
            setBackgroundColor(0xFF1E293B.toInt())
            visibility = View.GONE
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.WRAP_CONTENT
            )

            val content = LinearLayout(this@MainActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(dp(16), dp(10), dp(16), dp(10))
            }

            val icon = TextView(this@MainActivity).apply {
                text = "!"
                setTextColor(0xFFFBBF24.toInt())
                textSize = 14f
                typeface = Typeface.DEFAULT_BOLD
                setBackgroundColor(0xFFFBBF24.toInt())
                setPadding(dp(6), dp(2), dp(6), dp(2))
                setTextColor(0xFF0A0F1C.toInt())
            }

            val text = TextView(this@MainActivity).apply {
                text = "  Sin conexion a Internet"
                setTextColor(0xFFFBBF24.toInt())
                textSize = 13f
                setPadding(dp(12), 0, 0, 0)
            }

            content.addView(icon)
            content.addView(text)
            addView(content)
        }
    }

    private fun showOfflineBanner(show: Boolean) {
        offlineBanner.visibility = if (show) View.VISIBLE else View.GONE
    }

    // --- Camera FAB ---

    private fun buildCameraFab(): FrameLayout {
        val fabSize = dp(56)
        return FrameLayout(this).apply {
            layoutParams = FrameLayout.LayoutParams(fabSize, fabSize).apply {
                gravity = Gravity.BOTTOM or Gravity.END
                rightMargin = dp(16)
                bottomMargin = dp(72)
                elevation = 8f
            }

            background = android.graphics.drawable.GradientDrawable().apply {
                shape = android.graphics.drawable.GradientDrawable.OVAL
                setColor(0xFF50C878.toInt())
                setCornerRadius(fabSize.toFloat() / 2)
            }
            isClickable = true
            isFocusable = true

            val icon = ImageView(this@MainActivity).apply {
                setImageResource(android.R.drawable.ic_menu_camera)
                setColorFilter(0xFF04140D.toInt())
                layoutParams = FrameLayout.LayoutParams(dp(28), dp(28)).apply {
                    gravity = Gravity.CENTER
                }
            }

            addView(icon)
            setOnClickListener { showCameraOptions() }
        }
    }

    private fun showCameraOptions() {
        val options = arrayOf("Tomar foto", "Galeria", "Subir archivo")
        android.app.AlertDialog.Builder(this)
            .setTitle("Agregar al analisis")
            .setItems(options) { _, which ->
                when (which) {
                    0 -> cameraLauncher.launch(Unit)
                    1 -> galleryLauncher.launch(Unit)
                    2 -> {
                        // Use the standard file chooser via deprecated onActivityResult fallback
                        openFileChooserFromFileFab()
                    }
                }
            }
            .show()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun openFileChooserFromFileFab() {
        uploadMessage = object : ValueCallback<Array<Uri>> {
            override fun onReceiveValue(value: Array<Uri>?) {
                value?.firstOrNull()?.let { injectImageToChat(it) }
            }
        }
        val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
            type = "*/*"
            addCategory(Intent.CATEGORY_OPENABLE)
            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
        }
        @Suppress("DEPRECATION")
        startActivityForResult(intent, FILE_CHOOSER_REQUEST_CODE)
    }

    private fun injectImageToChat(uri: Uri) {
        CameraHelper.uriToDataUrl(this, uri) { dataUrl ->
            if (dataUrl != null) {
                val js = """
                    (function() {
                        var input = document.querySelector('input[type="file"], textarea, [contenteditable]');
                        if (!input) input = document.querySelector('#chat-input, .chat-input, [data-role="input"]');
                        if (input) {
                            // Dispatch a custom event with the image
                            window.dispatchEvent(new CustomEvent('veritas:image-captured', {
                                detail: { dataUrl: '$dataUrl' }
                            }));
                        }
                        console.log('[Veritas Android] Imagen capturada: ${uri.lastPathSegment}');
                    })();
                """.trimIndent()
                webView.evaluateJavascript(js, null)
            }
        }
    }

    // --- Intent extras handling ---

    private fun handleIntentExtras(intent: Intent) {
        // Deep link
        val deepLink = intent.getStringExtra("deep_link")
        if (deepLink != null) {
            val route = DeepLinkRouter.parse(Uri.parse(deepLink))
            if (route is DeepLinkRouter.Route.Settings) {
                startActivity(Intent(this, SettingsActivity::class.java))
                return
            }
            val js = DeepLinkRouter.toJavaScript(route)
            if (js != null) pendingJs = js
            return
        }

        // Shared text from other apps
        val sharedText = intent.getStringExtra("shared_text")
        if (!sharedText.isNullOrBlank()) {
            val safeText = sharedText.replace("\\", "\\\\").replace("'", "\\'").replace("\n", " ")
            pendingJs = """
                (function() {
                    var input = document.querySelector('textarea, [contenteditable]');
                    if (!input) input = document.querySelector('#chat-input, .chat-input, [data-role="input"]');
                    if (input && typeof input.value !== 'undefined') {
                        input.value = '$safeText';
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                    } else if (input) {
                        input.textContent = '$safeText';
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                    console.log('[Veritas Android] Texto compartido inyectado');
                })();
            """.trimIndent()
        }
    }

    // --- Navigation ---

    private fun redirectToLogin() {
        startActivity(Intent(this, LoginActivity::class.java))
        finish()
    }

    private fun openSettings() {
        startActivity(Intent(this, SettingsActivity::class.java))
    }

    /**
     * Generate JavaScript to inject the session token into the web app's localStorage.
     */
    private fun buildTokenInjectionScript(): String {
        val token = auth.getToken() ?: return ""
        val email = auth.currentUserEmail ?: return ""
        val safeToken = token.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "")
        val safeEmail = email.replace("\\", "\\\\").replace("'", "\\'")
        return """
            (function() {
                try {
                    localStorage.setItem('veritas_token', '${safeToken}');
                    localStorage.setItem('veritas_user', '${safeEmail}');
                    console.log('[Veritas Android] Token inyectado para: ${safeEmail}');
                } catch(e) {
                    console.error('[Veritas Android] Error inyectando token:', e);
                }
            })();
        """.trimIndent()
    }

    /**
     * Build the Android bridge JS that overrides fetch, adds settings/camera hooks,
     * and listens for logout events from the web.
     */
    private fun buildBridgeScript(): String {
        return """
            (function() {
                window.__veritasAndroid = true;
                document.documentElement.style.setProperty('--safe-area-top', '0px');
                document.documentElement.style.setProperty('--safe-area-bottom', '0px');

                // Override fetch to add auth header to all API calls
                const _origFetch = window.fetch;
                window.fetch = function(url, options) {
                    options = options || {};
                    if (url && String(url).includes('/api/')) {
                        options.headers = options.headers || {};
                        if (options.headers instanceof Headers) {
                            if (!options.headers.has('Authorization')) {
                                options.headers.set('Authorization', 'Bearer ' + localStorage.getItem('veritas_token'));
                            }
                        } else {
                            options.headers = Object.assign({}, options.headers);
                            if (!options.headers['Authorization']) {
                                options.headers['Authorization'] = 'Bearer ' + localStorage.getItem('veritas_token');
                            }
                        }
                    }
                    return _origFetch.call(this, url, options);
                };

                // Listen for logout event from web UI
                var _origRemoveItem = localStorage.removeItem;
                localStorage.removeItem = function(key) {
                    _origRemoveItem.call(this, key);
                    if (key === 'veritas_token' || key === 'veritas_session') {
                        console.log('[Veritas Android] Web logout detected');
                        try { AndroidBridge.onWebLogout(); } catch(e) {}
                    }
                };

                console.log('[Veritas Android] Bridge + fetch interceptor listo');
            })();
        """.trimIndent()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView(wv: WebView) {
        val settings = wv.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.allowFileAccess = true
        settings.allowContentAccess = true
        settings.mediaPlaybackRequiresUserGesture = false
        settings.cacheMode = WebSettings.LOAD_DEFAULT
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        settings.userAgentString = settings.userAgentString + " VeritasAI/2.8.0-Android"
        settings.useWideViewPort = true
        settings.loadWithOverviewMode = true
        settings.setSupportZoom(false)

        CookieManager.getInstance().apply {
            setAcceptThirdPartyCookies(wv, true)
            setAcceptCookie(true)
        }

        // JS bridge for web-to-native communication
        wv.addJavascriptInterface(object : Any() {
            @JavascriptInterface
            fun openSettings() {
                runOnUiThread { this@MainActivity.openSettings() }
            }

            @JavascriptInterface
            fun openCamera() {
                runOnUiThread { cameraLauncher.launch(Unit) }
            }

            @JavascriptInterface
            fun onWebLogout() {
                runOnUiThread {
                    auth.clearSession()
                    redirectToLogin()
                }
            }
        }, "AndroidBridge")

        wv.webViewClient = object : WebViewClient() {

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url.toString()

                // Keep Veritas navigation inside the WebView
                if (url.startsWith(VERITAS_ORIGIN)) return false

                // OAuth callbacks - keep inside WebView
                if (url.contains("oauth") || url.contains("callback")
                    || url.startsWith("https://github.com/login/oauth")) {
                    return false
                }

                // External links open in browser
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                } catch (_: Exception) {}
                return true
            }

            override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
                if (url == VERITAS_URL || url == "$VERITAS_URL/") {
                    view.evaluateJavascript(buildTokenInjectionScript(), null)
                }
            }

            override fun onPageFinished(view: WebView, url: String?) {
                swipeRefreshLayout.isRefreshing = false

                if (url == VERITAS_URL || url == "$VERITAS_URL/") {
                    // Inject token
                    view.evaluateJavascript(buildTokenInjectionScript(), null)

                    // Inject Android bridge
                    view.evaluateJavascript(buildBridgeScript(), null)

                    // Execute any pending JS (deep link, shared text)
                    pendingJs?.let {
                        view.postDelayed({ view.evaluateJavascript(it, null) }, 500)
                        pendingJs = null
                    }

                    // Inject shared text if came from ShareReceiverActivity
                    pendingDeepLink?.let {
                        val route = DeepLinkRouter.parse(Uri.parse(it))
                        DeepLinkRouter.toJavaScript(route)?.let { js ->
                            view.postDelayed({ view.evaluateJavascript(js, null) }, 500)
                        }
                        pendingDeepLink = null
                    }
                }
            }

            override fun onReceivedError(
                view: WebView?, request: WebResourceRequest?, error: WebResourceError?
            ) {
                if (request?.isForMainFrame == true) {
                    swipeRefreshLayout.isRefreshing = false
                }
            }

            override fun onReceivedSslError(
                view: WebView?,
                handler: SslErrorHandler?,
                error: android.net.http.SslError?
            ) {
                handler?.cancel()
            }
        }

        wv.webChromeClient = object : WebChromeClient() {

            override fun onShowFileChooser(
                webView: WebView,
                filePathCallback: ValueCallback<Array<Uri>>,
                fileChooserParams: FileChooserParams
            ): Boolean {
                uploadMessage?.onReceiveValue(null)
                uploadMessage = filePathCallback

                val intent = fileChooserParams.createIntent().apply {
                    type = "*/*"
                    addCategory(Intent.CATEGORY_OPENABLE)
                    putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                }

                try {
                    @Suppress("DEPRECATION")
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST_CODE)
                } catch (e: Exception) {
                    uploadMessage = null
                    return false
                }
                return true
            }

            override fun onConsoleMessage(message: ConsoleMessage?): Boolean {
                message?.let {
                    android.util.Log.d("VeritasWebView", "${it.messageLevel()}: ${it.message()} (${it.sourceId()}:${it.lineNumber()})")
                }
                return true
            }

            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                if (newProgress == 100) swipeRefreshLayout.isRefreshing = false
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntentExtras(intent)
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else {
            @Suppress("DEPRECATION")
            super.onBackPressed()
        }
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK && webView.canGoBack()) {
            webView.goBack()
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    @Deprecated("Use Activity Result API where possible")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == FILE_CHOOSER_REQUEST_CODE) {
            val results = WebChromeClient.FileChooserParams.parseResult(resultCode, data)
            uploadMessage?.onReceiveValue(results ?: arrayOf())
            uploadMessage = null
        }
    }

    private fun setupImmersiveMode() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(false)
            window.insetsController?.let { controller ->
                controller.hide(WindowInsets.Type.statusBars() or WindowInsets.Type.navigationBars())
                controller.systemBarsBehavior =
                    WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = (
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        or View.SYSTEM_UI_FLAG_FULLSCREEN
                )
        }
    }

    override fun onResume() {
        super.onResume()
        setupImmersiveMode()
        // Re-check auth on resume
        if (!auth.isLoggedIn) {
            redirectToLogin()
        }
        // Update offline banner
        showOfflineBanner(!offlineManager.isOnline)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        webView.saveState(outState)
        super.onSaveInstanceState(outState)
    }

    override fun onRestoreInstanceState(savedInstanceState: Bundle) {
        super.onRestoreInstanceState(savedInstanceState)
        webView.restoreState(savedInstanceState)
    }

    override fun onPause() {
        super.onPause()
        webView.onPause()
    }

    override fun onResumeFragments() {
        super.onResumeFragments()
        webView.onResume()
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()
}
