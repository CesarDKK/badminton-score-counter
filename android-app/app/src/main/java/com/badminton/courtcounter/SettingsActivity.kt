package com.badminton.courtcounter

import android.content.Context
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity

class SettingsActivity : AppCompatActivity() {

    private lateinit var serverUrlInput: EditText
    private lateinit var courtIdInput: EditText
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

        // Enable back button in action bar
        supportActionBar?.setDisplayHomeAsUpEnabled(true)

        prefs = getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)

        serverUrlInput = findViewById(R.id.serverUrlInput)
        courtIdInput = findViewById(R.id.courtIdInput)
        saveButton = findViewById(R.id.saveButton)

        // Load current settings
        loadSettings()

        // Save button click
        saveButton.setOnClickListener {
            saveSettings()
        }
    }

    private fun loadSettings() {
        val serverUrl = prefs.getString(PREF_SERVER_URL, DEFAULT_SERVER_URL)
        val courtId = prefs.getString(PREF_COURT_ID, DEFAULT_COURT_ID)

        serverUrlInput.setText(serverUrl)
        courtIdInput.setText(courtId)
    }

    private fun saveSettings() {
        val serverUrl = serverUrlInput.text.toString().trim()
        val courtId = courtIdInput.text.toString().trim()

        if (serverUrl.isEmpty()) {
            Toast.makeText(this, "Server URL må ikke være tom", Toast.LENGTH_SHORT).show()
            return
        }

        if (courtId.isEmpty() || courtId.toIntOrNull() == null) {
            Toast.makeText(this, "Bane nummer skal være et tal", Toast.LENGTH_SHORT).show()
            return
        }

        prefs.edit().apply {
            putString(PREF_SERVER_URL, serverUrl)
            putString(PREF_COURT_ID, courtId)
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
