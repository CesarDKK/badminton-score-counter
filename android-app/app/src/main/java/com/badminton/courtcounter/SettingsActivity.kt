package com.badminton.courtcounter

import android.content.Context
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity

class SettingsActivity : AppCompatActivity() {

    private lateinit var linkInput: EditText
    private lateinit var courtIdInput: EditText
    private lateinit var courtIdLabel: TextView
    private lateinit var saveButton: Button
    private lateinit var prefs: android.content.SharedPreferences

    companion object {
        private const val PREF_NAME = "BadmintonCourtCounter"
        private const val PREF_SERVER_URL = "server_url"
        private const val PREF_COURT_ID = "court_id"
        private const val DEFAULT_SERVER_URL = "http://badmintonapp.local"
        private const val DEFAULT_COURT_ID = "1"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_settings)

        supportActionBar?.setDisplayHomeAsUpEnabled(true)

        prefs = getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)

        linkInput    = findViewById(R.id.serverUrlInput)
        courtIdInput = findViewById(R.id.courtIdInput)
        courtIdLabel = findViewById(R.id.courtIdLabel)
        saveButton   = findViewById(R.id.saveButton)

        loadSettings()

        // Skjul banenummer-felt dynamisk ved adgangslink
        linkInput.addTextChangedListener(object : android.text.TextWatcher {
            override fun afterTextChanged(s: android.text.Editable?) = updateCourtVisibility()
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
        })

        saveButton.setOnClickListener { saveSettings() }
    }

    private fun updateCourtVisibility() {
        val isToken = MainActivity.isTokenUrl(linkInput.text.toString().trim())
        courtIdLabel.visibility = if (isToken) View.GONE else View.VISIBLE
        courtIdInput.visibility = if (isToken) View.GONE else View.VISIBLE
    }

    private fun loadSettings() {
        linkInput.setText(prefs.getString(PREF_SERVER_URL, DEFAULT_SERVER_URL))
        courtIdInput.setText(prefs.getString(PREF_COURT_ID, DEFAULT_COURT_ID))
        updateCourtVisibility()
    }

    private fun saveSettings() {
        val link   = linkInput.text.toString().trim()
        val courtId = courtIdInput.text.toString().trim()

        if (link.isEmpty()) {
            Toast.makeText(this, "Link/URL må ikke være tomt", Toast.LENGTH_SHORT).show()
            return
        }

        if (!MainActivity.isTokenUrl(link) && (courtId.isEmpty() || courtId.toIntOrNull() == null)) {
            Toast.makeText(this, "Bane nummer skal være et tal", Toast.LENGTH_SHORT).show()
            return
        }

        prefs.edit().apply {
            putString(PREF_SERVER_URL, link)
            putString(PREF_COURT_ID, courtId.ifEmpty { DEFAULT_COURT_ID })
            apply()
        }

        Toast.makeText(this, "Indstillinger gemt! Genstart appen for at anvende.", Toast.LENGTH_LONG).show()
        finish()
    }

    override fun onSupportNavigateUp(): Boolean {
        finish()
        return true
    }
}
