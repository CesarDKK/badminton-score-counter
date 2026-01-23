package com.badminton.courtcounter

import android.annotation.SuppressLint
import android.content.Context
import android.os.Bundle
import android.text.InputType
import android.view.Menu
import android.view.MenuItem
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

    companion object {
        private const val PREF_NAME = "BadmintonCourtCounter"
        private const val PREF_SERVER_URL = "server_url"
        private const val PREF_COURT_ID = "court_id"
        private const val DEFAULT_SERVER_URL = "http://badmintonapp.local"
        private const val DEFAULT_COURT_ID = "1"
        private const val ADMIN_PASSWORD = "admin123"
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        // Show action bar with menu
        supportActionBar?.show()
        supportActionBar?.setDisplayShowTitleEnabled(false)

        // Initialize preferences
        prefs = getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)

        // Initialize WebView
        webView = findViewById(R.id.webView)
        setupWebView()

        // Setup back button handler
        setupBackButtonHandler()

        // Load the court page
        loadCourtPage()
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
                    .setNegativeButton("Nej", null)
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
                showPasswordDialog()
                true
            }
            R.id.action_reload -> {
                webView.reload()
                true
            }
            else -> super.onOptionsItemSelected(item)
        }
    }

    private fun showPasswordDialog() {
        val passwordInput = EditText(this).apply {
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            hint = "Indtast adgangskode"
        }

        AlertDialog.Builder(this)
            .setTitle("Adgangskode påkrævet")
            .setMessage("Indtast adgangskode for at ændre indstillinger")
            .setView(passwordInput)
            .setPositiveButton("OK") { _, _ ->
                val enteredPassword = passwordInput.text.toString()
                if (enteredPassword == ADMIN_PASSWORD) {
                    showSettingsDialog()
                } else {
                    Toast.makeText(this, "Forkert adgangskode", Toast.LENGTH_SHORT).show()
                }
            }
            .setNegativeButton("Annuller", null)
            .show()
    }

    private fun showSettingsDialog() {
        val currentServerUrl = prefs.getString(PREF_SERVER_URL, DEFAULT_SERVER_URL) ?: DEFAULT_SERVER_URL
        val currentCourtId = prefs.getString(PREF_COURT_ID, DEFAULT_COURT_ID) ?: DEFAULT_COURT_ID

        // Create input fields
        val serverUrlInput = EditText(this).apply {
            setText(currentServerUrl)
            hint = "f.eks. http://192.168.1.100:8080"
            setSingleLine()
        }

        val courtIdInput = EditText(this).apply {
            setText(currentCourtId)
            hint = "f.eks. 1"
            inputType = InputType.TYPE_CLASS_NUMBER
            setSingleLine()
        }

        // Create layout
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(60, 20, 60, 20)

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
        }

        AlertDialog.Builder(this)
            .setTitle("Indstillinger")
            .setView(layout)
            .setPositiveButton("Gem") { _, _ ->
                val newServerUrl = serverUrlInput.text.toString().trim()
                val newCourtId = courtIdInput.text.toString().trim()

                if (newServerUrl.isEmpty()) {
                    Toast.makeText(this, "Server URL må ikke være tom", Toast.LENGTH_SHORT).show()
                    return@setPositiveButton
                }

                if (newCourtId.isEmpty()) {
                    Toast.makeText(this, "Bane nummer må ikke være tomt", Toast.LENGTH_SHORT).show()
                    return@setPositiveButton
                }

                // Save settings
                prefs.edit().apply {
                    putString(PREF_SERVER_URL, newServerUrl)
                    putString(PREF_COURT_ID, newCourtId)
                    apply()
                }

                Toast.makeText(this, "Indstillinger gemt. Genindlæser...", Toast.LENGTH_SHORT).show()

                // Reload the page with new settings
                loadCourtPage()
            }
            .setNegativeButton("Annuller", null)
            .show()
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
                showPasswordDialog()
            }
            .setNegativeButton("Prøv Igen") { _, _ ->
                loadCourtPage()
            }
            .setCancelable(false)
            .show()
    }
}
