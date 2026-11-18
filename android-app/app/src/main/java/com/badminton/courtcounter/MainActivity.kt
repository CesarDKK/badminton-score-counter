package com.badminton.courtcounter

import android.annotation.SuppressLint
import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.text.InputType
import android.view.View
import android.view.ViewGroup
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
    private lateinit var offlineTitle: TextView
    private lateinit var offlineMessage: TextView
    private var pageFailed = false
    private var failedUrl: String? = null
    private var isActive = false
    private var networkCallback: ConnectivityManager.NetworkCallback? = null
    private val retryRunnable = Runnable { retryNow() }

    // WebView'en gik ned (se genskabWebView)
    private val nedbrud = ArrayDeque<Long>()
    private var genindlaesVedResume = false

    companion object {
        private const val PREF_NAME = "BadmintonCourtCounter"
        private const val PREF_SERVER_URL = "server_url"
        private const val PREF_COURT_ID = "court_id"
        private const val PREF_FIRST_RUN = "first_run"
        private const val DEFAULT_SERVER_URL = "http://badmintonapp.local"
        private const val DEFAULT_COURT_ID = "1"
        private const val SCREEN_TIMEOUT_MS = 10 * 60 * 1000L
        private const val RETRY_MS = 5_000L

        // WebView'en går ned så mange gange inden for NEDBRUD_VINDUE_MS: stop og vis en knap
        private const val NEDBRUD_MAX = 3
        private const val NEDBRUD_VINDUE_MS = 2 * 60 * 1000L

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

            // Android 8+: WebView'ens proces gik ned (eller blev lukket for at spare
            // hukommelse, mens skærmen var slukket). Uden dette lukker hele appen,
            // og tabletten står på startskærmen
            override fun onRenderProcessGone(view: WebView?, detail: RenderProcessGoneDetail?): Boolean {
                genskabWebView(view)
                return true
            }
        }

        webView.webChromeClient = WebChromeClient()
    }

    // redigerer = åbnet fra kioskens menu: udfyldt med de nuværende værdier og
    // med en Annullér-knap (i kiosken kan app-data ikke slettes for at skifte link)
    private fun showFirstTimeSetup(redigerer: Boolean = false) {
        val linkInput = EditText(this).apply {
            setText(if (redigerer) prefs.getString(PREF_SERVER_URL, DEFAULT_SERVER_URL) else DEFAULT_SERVER_URL)
            hint = "http://192.168.1.100 eller http://…/t/TOKEN"
            setSingleLine()
        }

        val courtLabel = android.widget.TextView(this).apply {
            text = "Bane nummer (kun ved server URL — ikke nødvendigt ved adgangslink):"
            setPadding(0, 30, 0, 10)
        }

        val courtInput = EditText(this).apply {
            setText(if (redigerer) prefs.getString(PREF_COURT_ID, DEFAULT_COURT_ID) else DEFAULT_COURT_ID)
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

        val dialog = AlertDialog.Builder(this)
            .setTitle("Opsætning")
            .setView(layout)
            .setCancelable(false)
            .setPositiveButton("Start") { _, _ ->
                val link = linkInput.text.toString().trim()
                val court = courtInput.text.toString().trim()

                if (link.isEmpty()) {
                    Toast.makeText(this, "Link/URL må ikke være tomt", Toast.LENGTH_SHORT).show()
                    showFirstTimeSetup(redigerer); return@setPositiveButton
                }

                if (!isTokenUrl(link) && (court.isEmpty() || court.toIntOrNull() == null)) {
                    Toast.makeText(this, "Bane nummer skal være et tal", Toast.LENGTH_SHORT).show()
                    showFirstTimeSetup(redigerer); return@setPositiveButton
                }

                prefs.edit().apply {
                    putString(PREF_SERVER_URL, link)
                    putString(PREF_COURT_ID, court.ifEmpty { DEFAULT_COURT_ID })
                    putBoolean(PREF_FIRST_RUN, false)
                    apply()
                }

                Toast.makeText(this, "Indstillinger gemt!", Toast.LENGTH_SHORT).show()
                failedUrl = null
                loadPage()
                startScreenTimeoutTimer()
            }
        if (redigerer) dialog.setNegativeButton("Annullér") { _, _ -> resetScreenTimeout() }
        dialog.show()
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
                resetScreenTimeout()
                if (Kiosk.erAktiv(this@MainActivity, prefs)) {
                    visKodeDialog()
                    return
                }
                AlertDialog.Builder(this@MainActivity)
                    .setTitle("Afslut app")
                    .setMessage("Vil du afslutte appen?")
                    .setPositiveButton("Ja") { _, _ -> finish() }
                    .setNegativeButton("Nej") { _, _ -> resetScreenTimeout() }
                    .setNeutralButton("Kiosktilstand…") { _, _ -> visKioskOpsaetning() }
                    .show()
            }
        })
    }

    // ── Kiosktilstand (se Kiosk.kt) ──

    private var forkerteKoder = 0
    private var kodeSpaerretTil = 0L

    private fun kodeFelt(hint: String) = EditText(this).apply {
        this.hint = hint
        inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
        filters = arrayOf(android.text.InputFilter.LengthFilter(Kiosk.KODE_MAX))
        setSingleLine()
    }

    private fun dialogLayout(vararg views: View) = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(60, 20, 60, 0)
        views.forEach { addView(it) }
    }

    private fun tekst(t: String, lille: Boolean = false) = TextView(this).apply {
        text = t
        textSize = if (lille) 13f else 15f
        setPadding(0, 0, 0, 16)
        setTextIsSelectable(true)
    }

    // Kiosken er slået fra: forklar opsætningen, eller slå den til med en ny kode
    private fun visKioskOpsaetning() {
        if (!Kiosk.erEjer(this)) {
            AlertDialog.Builder(this)
                .setTitle("Kiosktilstand")
                .setView(dialogLayout(
                    tekst("I kiosktilstand starter tælleren, når tabletten tændes, og man kan kun forlade den med en kode."),
                    tekst("Det kræver en engangsopsætning med en PC:"),
                    tekst("1. Tabletten må ikke have nogen konti (fx Google-konto) — nulstil den, og spring kontoen over.\n" +
                          "2. Slå USB-fejlfinding til (Indstillinger → Om tabletten → tryk 7 gange på Build-nummer → Indstillinger for udviklere).\n" +
                          "3. Sæt tabletten til PC'en og kør:", lille = true),
                    tekst(Kiosk.adbKommando(this), lille = true).apply { setTypeface(android.graphics.Typeface.MONOSPACE) },
                    tekst("Åbn derefter appen, tryk tilbage → Kiosktilstand… igen og vælg en kode.", lille = true)
                ))
                .setPositiveButton("OK") { _, _ -> resetScreenTimeout() }
                .show()
            return
        }

        val kode1 = kodeFelt("Kode (${Kiosk.KODE_MIN}–${Kiosk.KODE_MAX} cifre)")
        val kode2 = kodeFelt("Gentag koden")
        AlertDialog.Builder(this)
            .setTitle("Slå kiosktilstand til")
            .setView(dialogLayout(
                tekst("Tælleren bliver tablettens startskærm og starter, når tabletten tændes. " +
                      "Hjem-knap, oversigt og notifikationer spærres. Man kommer ud med tilbage-knappen og koden."),
                kode1, kode2
            ))
            .setPositiveButton("Slå til") { _, _ ->
                val k = kode1.text.toString()
                when {
                    !Kiosk.gyldigKode(k) -> {
                        Toast.makeText(this, "Koden skal være ${Kiosk.KODE_MIN}–${Kiosk.KODE_MAX} cifre", Toast.LENGTH_LONG).show()
                        visKioskOpsaetning()
                    }
                    k != kode2.text.toString() -> {
                        Toast.makeText(this, "De to koder er ikke ens", Toast.LENGTH_LONG).show()
                        visKioskOpsaetning()
                    }
                    Kiosk.slaaTil(this, prefs, k) ->
                        Toast.makeText(this, "Kiosktilstand er slået til", Toast.LENGTH_LONG).show()
                    else ->
                        Toast.makeText(this, "Kunne ikke slå kiosktilstand til", Toast.LENGTH_LONG).show()
                }
            }
            .setNegativeButton("Annullér") { _, _ -> resetScreenTimeout() }
            .setNeutralButton("Giv tabletten fri…") { _, _ -> visFjernEjer() }
            .show()
    }

    private fun visFjernEjer() {
        AlertDialog.Builder(this)
            .setTitle("Giv tabletten fri")
            .setMessage("Appen holder op med at være tablettens ejer, og tabletten kan bruges som normalt igen. " +
                        "Kiosktilstand kræver derefter adb-kommandoen fra PC'en igen.")
            .setPositiveButton("Giv fri") { _, _ ->
                Kiosk.fjernEjer(this, prefs)
                Toast.makeText(this, "Tabletten er givet fri", Toast.LENGTH_LONG).show()
            }
            .setNegativeButton("Annullér", null)
            .show()
    }

    // Kiosken er aktiv: tilbage-knappen beder om koden
    private fun visKodeDialog() {
        val nu = SystemClock.elapsedRealtime()
        if (nu < kodeSpaerretTil) {
            val sek = (kodeSpaerretTil - nu + 999) / 1000
            Toast.makeText(this, "For mange forkerte koder. Prøv igen om $sek s", Toast.LENGTH_SHORT).show()
            return
        }
        val felt = kodeFelt("Kode")
        val dialog = AlertDialog.Builder(this)
            .setTitle("Tast koden")
            .setView(dialogLayout(felt))
            .setPositiveButton("OK") { _, _ ->
                if (Kiosk.kodePasser(prefs, felt.text.toString())) {
                    forkerteKoder = 0
                    visKioskMenu()
                } else {
                    forkerteKoder++
                    if (forkerteKoder >= 5) {
                        forkerteKoder = 0
                        kodeSpaerretTil = SystemClock.elapsedRealtime() + 60_000L
                    }
                    Toast.makeText(this, "Forkert kode", Toast.LENGTH_SHORT).show()
                }
                resetScreenTimeout()
            }
            .setNegativeButton("Annullér") { _, _ -> resetScreenTimeout() }
            .create()
        dialog.window?.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE)
        // Tastaturets OK/Færdig-knap sender koden (tastaturet kan dække dialogens knap)
        felt.imeOptions = android.view.inputmethod.EditorInfo.IME_ACTION_DONE
        felt.setOnEditorActionListener { _, _, _ ->
            dialog.getButton(AlertDialog.BUTTON_POSITIVE)?.performClick()
            true
        }
        dialog.show()
        felt.requestFocus()
    }

    private fun visKioskMenu() {
        AlertDialog.Builder(this)
            .setTitle("Kiosktilstand")
            .setItems(arrayOf("Skift link / bane", "Slå kiosktilstand fra", "Annullér")) { _, valg ->
                when (valg) {
                    0 -> showFirstTimeSetup(redigerer = true)
                    1 -> {
                        Kiosk.slaaFra(this, prefs)
                        Toast.makeText(this, "Kiosktilstand er slået fra", Toast.LENGTH_LONG).show()
                    }
                }
                resetScreenTimeout()
            }
            .show()
    }

    override fun onResume() {
        super.onResume()
        Kiosk.laas(this, prefs)
        isActive = true
        webView.onResume()
        webView.resumeTimers()
        resetScreenTimeout()
        // Skærmen tændt igen efter en fejl: prøv straks (og derefter hvert RETRY_MS)
        if (pageFailed) retryNow()
        else if (genindlaesVedResume) loadPage()
        genindlaesVedResume = false
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
        offlineTitle = findViewById(R.id.offlineTitle)
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
        offlineTitle.setText(R.string.offline_title)
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

    // ── WebView'en gik ned ──
    // Den døde WebView kan ikke bruges igen: skift den ud med en ny på samme plads
    // (under "Ingen forbindelse"-skærmen) og indlæs tælleren forfra. Stillingen
    // ligger på serveren; kun et point, der ikke nåede at blive gemt, er væk.
    // Går den ned igen og igen, stopper appen og viser en knap i stedet for at
    // genstarte i ring.

    private fun genskabWebView(doed: WebView?) {
        if (doed != null && doed !== webView) {
            doed.destroy()
            return
        }
        val gammel = webView
        val foraelder = gammel.parent as ViewGroup
        val plads = foraelder.indexOfChild(gammel)
        val params = gammel.layoutParams
        foraelder.removeView(gammel)
        gammel.destroy()

        webView = WebView(this).apply { id = R.id.webView }
        foraelder.addView(webView, plads, params)
        setupWebView()
        if (!isActive) webView.onPause()

        val nu = SystemClock.elapsedRealtime()
        nedbrud.addLast(nu)
        while (nedbrud.first() < nu - NEDBRUD_VINDUE_MS) nedbrud.removeFirst()

        if (nedbrud.size >= NEDBRUD_MAX) {
            handler.removeCallbacks(retryRunnable)
            pageFailed = true
            failedUrl = null           // "Genindlæs" starter forfra med loadPage()
            offlineTitle.setText(R.string.crash_title)
            offlineMessage.setText(R.string.crash_message)
            offlineOverlay.visibility = View.VISIBLE
        } else if (isActive) {
            loadPage()
        } else {
            genindlaesVedResume = true  // skærmen er slukket: indlæs, når den tændes
        }
    }
}
