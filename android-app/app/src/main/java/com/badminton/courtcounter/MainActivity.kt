package com.badminton.courtcounter

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.KeyEvent
import android.view.Menu
import android.view.MenuItem
import android.view.View
import android.webkit.*
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var prefs: android.content.SharedPreferences

    companion object {
        private const val PREF_NAME = "BadmintonCourtCounter"
        private const val PREF_SERVER_URL = "server_url"
        private const val PREF_COURT_ID = "court_id"
        private const val DEFAULT_SERVER_URL = "http://badmintonapp.local"
        private const val DEFAULT_COURT_ID = "1"
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        // Hide action bar for fullscreen experience
        supportActionBar?.hide()

        // Initialize preferences
        prefs = getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)

        // Initialize WebView
        webView = findViewById(R.id.webView)
        setupWebView()

        // Load the court page
        loadCourtPage()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
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

    override fun onCreateOptionsMenu(menu: Menu?): Boolean {
        menuInflater.inflate(R.menu.main_menu, menu)
        return true
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean {
        return when (item.itemId) {
            R.id.action_settings -> {
                startActivity(Intent(this, SettingsActivity::class.java))
                true
            }
            R.id.action_reload -> {
                webView.reload()
                true
            }
            else -> super.onOptionsItemSelected(item)
        }
    }

    // Override back button to prevent navigation
    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            // Show action bar instead of going back
            if (supportActionBar?.isShowing == false) {
                supportActionBar?.show()
                return true
            }
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
        webView.resumeTimers()
    }

    override fun onPause() {
        super.onPause()
        webView.onPause()
        webView.pauseTimers()
    }

    private fun showErrorDialog(message: String) {
        AlertDialog.Builder(this)
            .setTitle("Fejl")
            .setMessage(message)
            .setPositiveButton("Indstillinger") { _, _ ->
                startActivity(Intent(this, SettingsActivity::class.java))
            }
            .setNegativeButton("Prøv Igen") { _, _ ->
                loadCourtPage()
            }
            .setCancelable(false)
            .show()
    }
}
