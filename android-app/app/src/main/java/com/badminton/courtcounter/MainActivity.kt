package com.badminton.courtcounter

import android.annotation.SuppressLint
import android.content.Context
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.view.WindowManager
import android.webkit.*
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var prefs: android.content.SharedPreferences
    private val handler = Handler(Looper.getMainLooper())
    private var screenTimeoutRunnable: Runnable? = null

    companion object {
        private const val PREF_NAME = "BadmintonCourtCounter"
        private const val PREF_SERVER_URL = "server_url"
        private const val PREF_COURT_ID = "court_id"
        private const val PREF_FIRST_RUN = "first_run"
        private const val DEFAULT_SERVER_URL = "http://badmintonapp.local"
        private const val DEFAULT_COURT_ID = "1"
        private const val SCREEN_TIMEOUT_MS = 10 * 60 * 1000L // 10 minutes
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        // Hide action bar for fullscreen experience
        supportActionBar?.hide()

        // Keep screen on initially
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        // Initialize preferences
        prefs = getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)

        // Initialize WebView
        webView = findViewById(R.id.webView)
        setupWebView()

        // Setup back button handler
        setupBackButtonHandler()

        // Check if this is first run
        val isFirstRun = prefs.getBoolean(PREF_FIRST_RUN, true)

        if (isFirstRun) {
            // Show setup dialog on first run
            showFirstTimeSetup()
        } else {
            // Load the court page with saved settings
            loadCourtPage()
        }

        // Start screen timeout timer
        startScreenTimeoutTimer()
    }

    private fun startScreenTimeoutTimer() {
        // Cancel any existing timer
        screenTimeoutRunnable?.let { handler.removeCallbacks(it) }

        // Create new runnable
        screenTimeoutRunnable = Runnable {
            // Turn off keep screen on after 10 minutes
            window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            Toast.makeText(this, "Skærm timeout aktiveret efter 10 minutter", Toast.LENGTH_SHORT).show()
        }

        // Schedule timeout after 10 minutes
        screenTimeoutRunnable?.let { handler.postDelayed(it, SCREEN_TIMEOUT_MS) }
    }

    private fun resetScreenTimeout() {
        // Re-enable keep screen on
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        // Restart the timer
        startScreenTimeoutTimer()
    }

    private fun setupBackButtonHandler() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                AlertDialog.Builder(this@MainActivity)
                    .setTitle("Afslut app")
                    .setMessage("Vil du afslutte appen?")
                    .setPositiveButton("Ja") { _, _ ->
                        finish()
                    }
                    .setNegativeButton("Nej") { _, _ ->
                        // Reset screen timeout when user interacts
                        resetScreenTimeout()
                    }
                    .show()
            }
        })
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

        // Set WebViewClient to handle navigation
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url?.toString() ?: return false

                // Reset screen timeout on any interaction
                resetScreenTimeout()

                // Only allow navigation within the court page
                // Block navigation to landing.html, admin.html, etc.
                return if (url.contains("/court.html") || url.contains("/court-script") ||
                          url.contains("/styles.css") || url.contains("/js/") ||
                          url.contains("/api/")) {
                    false // Allow loading
                } else {
                    // Block navigation to other pages
                    Toast.makeText(this@MainActivity,
                        "Navigation blokeret - brug kun tæller funktioner",
                        Toast.LENGTH_SHORT).show()
                    true // Block loading
                }
            }

            override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                super.onReceivedError(view, request, error)
                showErrorDialog("Kunne ikke indlæse siden. Tjek din forbindelse og server URL i indstillingerne.")
            }
        }

        // Set WebChromeClient for console logs and alerts
        webView.webChromeClient = WebChromeClient()
    }

    private fun loadCourtPage() {
        val serverUrl = prefs.getString(PREF_SERVER_URL, DEFAULT_SERVER_URL)
        val courtId = prefs.getString(PREF_COURT_ID, DEFAULT_COURT_ID)
        val url = "$serverUrl/court.html?court=$courtId"
        webView.loadUrl(url)
    }

    private fun showFirstTimeSetup() {
        // Create input fields
        val serverUrlInput = EditText(this).apply {
            setText(DEFAULT_SERVER_URL)
            hint = "f.eks. http://192.168.1.100:8080"
            setSingleLine()
        }

        val courtIdInput = EditText(this).apply {
            setText(DEFAULT_COURT_ID)
            hint = "f.eks. 1"
            inputType = InputType.TYPE_CLASS_NUMBER
            setSingleLine()
        }

        // Create layout
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(60, 20, 60, 20)

            addView(android.widget.TextView(this@MainActivity).apply {
                text = "Velkommen til Badminton Tæller!"
                textSize = 18f
                setPadding(0, 0, 0, 30)
                setTypeface(null, android.graphics.Typeface.BOLD)
            })

            addView(android.widget.TextView(this@MainActivity).apply {
                text = "Server URL:"
                setPadding(0, 10, 0, 10)
            })
            addView(serverUrlInput)

            addView(android.widget.TextView(this@MainActivity).apply {
                text = "Bane nummer:"
                setPadding(0, 30, 0, 10)
            })
            addView(courtIdInput)

            addView(android.widget.TextView(this@MainActivity).apply {
                text = "\nDisse indstillinger kan kun ændres ved at slette app data."
                textSize = 12f
                setPadding(0, 20, 0, 0)
                setTextColor(android.graphics.Color.GRAY)
            })
        }

        AlertDialog.Builder(this)
            .setTitle("Opsætning")
            .setView(layout)
            .setCancelable(false)
            .setPositiveButton("Start") { _, _ ->
                val serverUrl = serverUrlInput.text.toString().trim()
                val courtId = courtIdInput.text.toString().trim()

                if (serverUrl.isEmpty()) {
                    Toast.makeText(this, "Server URL må ikke være tom", Toast.LENGTH_SHORT).show()
                    showFirstTimeSetup() // Show again
                    return@setPositiveButton
                }

                if (courtId.isEmpty()) {
                    Toast.makeText(this, "Bane nummer må ikke være tomt", Toast.LENGTH_SHORT).show()
                    showFirstTimeSetup() // Show again
                    return@setPositiveButton
                }

                // Save settings and mark as not first run
                prefs.edit().apply {
                    putString(PREF_SERVER_URL, serverUrl)
                    putString(PREF_COURT_ID, courtId)
                    putBoolean(PREF_FIRST_RUN, false)
                    apply()
                }

                Toast.makeText(this, "Indstillinger gemt!", Toast.LENGTH_SHORT).show()

                // Load the court page
                loadCourtPage()

                // Start screen timeout timer after setup
                startScreenTimeoutTimer()
            }
            .show()
    }


    override fun onResume() {
        super.onResume()
        webView.onResume()
        webView.resumeTimers()
        // Reset screen timeout when app is resumed
        resetScreenTimeout()
    }

    override fun onPause() {
        super.onPause()
        webView.onPause()
        webView.pauseTimers()
    }

    override fun onDestroy() {
        super.onDestroy()
        // Clean up handler callbacks
        screenTimeoutRunnable?.let { handler.removeCallbacks(it) }
    }

    private fun showErrorDialog(message: String) {
        AlertDialog.Builder(this)
            .setTitle("Fejl")
            .setMessage("$message\n\nFor at ændre indstillinger skal du slette app data i Android indstillinger.")
            .setPositiveButton("Prøv Igen") { _, _ ->
                loadCourtPage()
            }
            .setNegativeButton("Luk App") { _, _ ->
                finish()
            }
            .setCancelable(false)
            .show()
    }
}
