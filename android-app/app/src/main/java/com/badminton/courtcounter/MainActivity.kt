package com.badminton.courtcounter

import android.annotation.SuppressLint
import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.view.View
import android.view.WindowManager
import android.webkit.*
import android.widget.*
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var prefs: android.content.SharedPreferences
    private val handler = Handler(Looper.getMainLooper())
    private var screenTimeoutRunnable: Runnable? = null

    private lateinit var offlineOverlay: View
    private lateinit var offlineMessage: TextView
    private var pageFailed = false
    private var failedUrl: String? = null
    private var isActive = false
    private var networkCallback: ConnectivityManager.NetworkCallback? = null
    private val retryRunnable = Runnable { retryNow() }

    companion object {
        private const val PREF_NAME = "BadmintonCourtCounter"
        private const val PREF_SERVER_URL = "server_url"
        private const val PREF_COURT_ID = "court_id"
        private const val PREF_FIRST_RUN = "first_run"
        private const val DEFAULT_SERVER_URL = "http://badmintonapp.local"
        private const val DEFAULT_COURT_ID = "1"
        private const val SCREEN_TIMEOUT_MS = 10 * 60 * 1000L
        private const val RETRY_MS = 5_000L

        // Et adgangslink indeholder /t/ i URL'en
        fun isTokenUrl(url: String) = url.contains("/t/")
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        supportActionBar?.hide()
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        prefs = getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
        webView = findViewById(R.id.webView)
        setupOfflineOverlay()
        setupWebView()
        setupBackButtonHandler()

        if (prefs.getBoolean(PREF_FIRST_RUN, true)) {
            showFirstTimeSetup()
        } else {
            loadPage()
        }

        startScreenTimeoutTimer()
    }

    private fun loadPage() {
        val serverUrl = prefs.getString(PREF_SERVER_URL, DEFAULT_SERVER_URL) ?: DEFAULT_SERVER_URL
        val courtId   = prefs.getString(PREF_COURT_ID,  DEFAULT_COURT_ID)   ?: DEFAULT_COURT_ID

        if (isTokenUrl(serverUrl)) {
            // Adgangslink — indlæs direkte, siden håndterer redirect selv
            runOnUiThread { webView.loadUrl(serverUrl) }
        } else {
            // Legacy: server URL + banenummer. Tælleren findes kun i én version
            // (court-v3.html) — den gamle version-vælger og court.html er udfaset,
            // så vi loader v3 direkte uden at slå version op i /api/settings.
            val url = "$serverUrl/court-v3.html?id=$courtId"
            runOnUiThread { webView.loadUrl(url) }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            cacheMode = WebSettings.LOAD_DEFAULT
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            useWideViewPort = true
            loadWithOverviewMode = true
            builtInZoomControls = false
            displayZoomControls = false
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url?.toString() ?: return false
                resetScreenTimeout()

                // Tillad alt relateret til appen: adgangslinks, court-sider, API og ressourcer
                val allowed = url.contains("/t/") ||
                              url.contains("/court.html") ||
                              url.contains("/court-v3.html") ||
                              url.contains("/court-script") ||
                              url.contains("/styles.css") ||
                              url.contains("/js/") ||
                              url.contains("/api/")

                return if (allowed) {
                    false // Tillad
                } else {
                    Toast.makeText(this@MainActivity, "Navigation blokeret", Toast.LENGTH_SHORT).show()
                    true // Blokér
                }
            }

            override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
                super.onPageStarted(view, url, favicon)
                pageFailed = false
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                if (!pageFailed) hideOffline()
            }

            // Kun selve siden tæller. Fejler et API-kald eller et billede (fx de
            // første sekunder efter skærmen tændes, mens wifi kommer på igen),
            // klarer siden det selv med sit offline-mærke — før gav hvert fejlet
            // kald en fejlboks, der ikke kunne lukkes.
            override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                super.onReceivedError(view, request, error)
                if (request?.isForMainFrame != true) return
                showOffline(request.url.toString(), R.string.offline_message)
            }

            override fun onReceivedHttpError(view: WebView?, request: WebResourceRequest?, errorResponse: WebResourceResponse?) {
                super.onReceivedHttpError(view, request, errorResponse)
                if (request?.isForMainFrame != true) return
                if ((errorResponse?.statusCode ?: 0) >= 500) {
                    showOffline(request.url.toString(), R.string.offline_message_server)
                }
            }
        }

        webView.webChromeClient = WebChromeClient()
    }

    private fun showFirstTimeSetup() {
        val linkInput = EditText(this).apply {
            setText(DEFAULT_SERVER_URL)
            hint = "http://192.168.1.100 eller http://…/t/TOKEN"
            setSingleLine()
        }

        val courtLabel = android.widget.TextView(this).apply {
            text = "Bane nummer (kun ved server URL — ikke nødvendigt ved adgangslink):"
            setPadding(0, 30, 0, 10)
        }

        val courtInput = EditText(this).apply {
            setText(DEFAULT_COURT_ID)
            hint = "f.eks. 1"
            inputType = InputType.TYPE_CLASS_NUMBER
            setSingleLine()
        }

        // Skjul banenummer-feltet når /t/ detekteres
        fun updateVisibility() {
            val hide = isTokenUrl(linkInput.text.toString().trim())
            courtLabel.visibility = if (hide) android.view.View.GONE else android.view.View.VISIBLE
            courtInput.visibility = if (hide) android.view.View.GONE else android.view.View.VISIBLE
        }

        linkInput.addTextChangedListener(object : android.text.TextWatcher {
            override fun afterTextChanged(s: android.text.Editable?) = updateVisibility()
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
        })

        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(60, 20, 60, 20)

            addView(android.widget.TextView(this@MainActivity).apply {
                text = "Velkommen til Badminton Tæller!"
                textSize = 18f
                setPadding(0, 0, 0, 20)
                setTypeface(null, android.graphics.Typeface.BOLD)
            })
            addView(android.widget.TextView(this@MainActivity).apply {
                text = "Indtast enten et adgangslink (fra Admin → Adgangslinks) eller en server URL:"
                textSize = 13f
                setPadding(0, 0, 0, 16)
                setTextColor(android.graphics.Color.LTGRAY)
            })
            addView(android.widget.TextView(this@MainActivity).apply {
                text = "Link / Server URL:"
                setPadding(0, 10, 0, 10)
            })
            addView(linkInput)
            addView(courtLabel)
            addView(courtInput)
        }

        AlertDialog.Builder(this)
            .setTitle("Opsætning")
            .setView(layout)
            .setCancelable(false)
            .setPositiveButton("Start") { _, _ ->
                val link = linkInput.text.toString().trim()
                val court = courtInput.text.toString().trim()

                if (link.isEmpty()) {
                    Toast.makeText(this, "Link/URL må ikke være tomt", Toast.LENGTH_SHORT).show()
                    showFirstTimeSetup(); return@setPositiveButton
                }

                if (!isTokenUrl(link) && (court.isEmpty() || court.toIntOrNull() == null)) {
                    Toast.makeText(this, "Bane nummer skal være et tal", Toast.LENGTH_SHORT).show()
                    showFirstTimeSetup(); return@setPositiveButton
                }

                prefs.edit().apply {
                    putString(PREF_SERVER_URL, link)
                    putString(PREF_COURT_ID, court.ifEmpty { DEFAULT_COURT_ID })
                    putBoolean(PREF_FIRST_RUN, false)
                    apply()
                }

                Toast.makeText(this, "Indstillinger gemt!", Toast.LENGTH_SHORT).show()
                loadPage()
                startScreenTimeoutTimer()
            }
            .show()
    }

    private fun startScreenTimeoutTimer() {
        screenTimeoutRunnable?.let { handler.removeCallbacks(it) }
        screenTimeoutRunnable = Runnable {
            window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
        screenTimeoutRunnable?.let { handler.postDelayed(it, SCREEN_TIMEOUT_MS) }
    }

    private fun resetScreenTimeout() {
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        startScreenTimeoutTimer()
    }

    private fun setupBackButtonHandler() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                AlertDialog.Builder(this@MainActivity)
                    .setTitle("Afslut app")
                    .setMessage("Vil du afslutte appen?")
                    .setPositiveButton("Ja") { _, _ -> finish() }
                    .setNegativeButton("Nej") { _, _ -> resetScreenTimeout() }
                    .show()
            }
        })
    }

    override fun onResume() {
        super.onResume()
        isActive = true
        webView.onResume()
        webView.resumeTimers()
        resetScreenTimeout()
        // Skærmen tændt igen efter en fejl: prøv straks (og derefter hvert RETRY_MS)
        if (pageFailed) retryNow()
    }

    override fun onPause() {
        super.onPause()
        isActive = false
        handler.removeCallbacks(retryRunnable)
        webView.onPause()
        webView.pauseTimers()
    }

    override fun onDestroy() {
        super.onDestroy()
        screenTimeoutRunnable?.let { handler.removeCallbacks(it) }
        handler.removeCallbacks(retryRunnable)
        networkCallback?.let {
            try {
                (getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager).unregisterNetworkCallback(it)
            } catch (e: Exception) {}
        }
    }

    // ── Ingen forbindelse ──
    // Kan siden ikke hentes, dækker en skærm WebView'ets egen fejlside. Den
    // prøver igen hvert RETRY_MS og straks når Android melder netværk tilbage;
    // "Genindlæs" prøver med det samme. Ingen dialog og ingen genstart af appen.

    private fun setupOfflineOverlay() {
        offlineOverlay = findViewById(R.id.offlineOverlay)
        offlineMessage = findViewById(R.id.offlineMessage)
        findViewById<Button>(R.id.offlineReload).setOnClickListener { retryNow() }

        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                // Giv wifi et øjeblik til at få adresse og DNS, før vi prøver
                handler.postDelayed({ if (pageFailed && isActive) retryNow() }, 1500)
            }
        }
        try {
            cm.registerDefaultNetworkCallback(callback)
            networkCallback = callback
        } catch (e: Exception) {
            // Uden callback prøver timeren stadig igen hvert RETRY_MS
        }
    }

    private fun showOffline(url: String, messageRes: Int) {
        pageFailed = true
        failedUrl = url
        offlineMessage.setText(messageRes)
        offlineOverlay.visibility = View.VISIBLE
        scheduleRetry()
    }

    private fun hideOffline() {
        handler.removeCallbacks(retryRunnable)
        offlineOverlay.visibility = View.GONE
    }

    private fun scheduleRetry() {
        handler.removeCallbacks(retryRunnable)
        if (isActive) handler.postDelayed(retryRunnable, RETRY_MS)
    }

    private fun retryNow() {
        handler.removeCallbacks(retryRunnable)
        val url = failedUrl
        if (url != null) webView.loadUrl(url) else loadPage()
        resetScreenTimeout()
    }
}
