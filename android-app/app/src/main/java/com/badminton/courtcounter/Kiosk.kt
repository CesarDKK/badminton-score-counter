package com.badminton.courtcounter

import android.app.Activity
import android.app.ActivityManager
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.os.Build
import android.os.UserManager
import java.security.MessageDigest
import java.security.SecureRandom

// ── Kiosktilstand (tilvalg) ──
// Er appen tablettens ejer (én adb-kommando, se visKioskOpsaetning i
// MainActivity) og slået til med en kode, så:
//  - er appen tablettens startskærm, så den starter, når tabletten tændes
//    (og igen, hvis Android lukker den, fx når WebView opdateres)
//  - er tabletten låst til appen (Androids "lock task"): ingen hjem-knap,
//    oversigt, statuslinje eller notifikationer. Tænd/sluk-menuen virker.
//  - kommer man kun ud med koden (tilbage-knappen → kode).
// Uden ejer-rollen eller med kiosken slået fra opfører appen sig som før.
object Kiosk {
    private const val PREF_TIL = "kiosk_til"
    private const val PREF_KODE = "kiosk_kode"   // "salt:sha256(salt+kode)" i hex

    const val KODE_MIN = 4
    const val KODE_MAX = 8

    private fun dpm(ctx: Context) =
        ctx.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager

    private fun admin(ctx: Context) = ComponentName(ctx, KioskAdminReceiver::class.java)

    // activity-alias i manifestet med HOME-kategori; slået fra, når kiosken er fra
    // (klassens pakke, ikke appens id — de er forskellige i en test-build med suffiks)
    private fun hjem(ctx: Context) =
        ComponentName(ctx, KioskAdminReceiver::class.java.name.substringBeforeLast('.') + ".KioskHome")

    fun adbKommando(ctx: Context) =
        "adb shell dpm set-device-owner ${ctx.packageName}/${KioskAdminReceiver::class.java.name}"

    fun erEjer(ctx: Context) = dpm(ctx).isDeviceOwnerApp(ctx.packageName)

    fun erSlaaetTil(prefs: SharedPreferences) =
        prefs.getBoolean(PREF_TIL, false) && prefs.getString(PREF_KODE, null) != null

    fun erAktiv(ctx: Context, prefs: SharedPreferences) = erSlaaetTil(prefs) && erEjer(ctx)

    // Lås tabletten til appen. Kaldes i onResume: politikkerne sættes igen hver
    // gang (ufarligt), så de også gælder efter en opdatering af appen.
    //
    // Tælleren skal køre som startskærmen (startet via KioskHome). Ellers starter
    // hjem-knappen en ekstra tæller oven på den låste — to WebViews på samme bane.
    // Kører den som almindelig app (fx lige da kiosken blev slået til), startes
    // startskærm-udgaven, og denne lukkes.
    fun laas(activity: Activity, prefs: SharedPreferences) {
        if (!erAktiv(activity, prefs)) return
        try {
            saetPolitikker(activity, true)
            if (!startetSomHjem(activity)) {
                val hjemTil = activity.packageManager
                    .resolveActivity(hjemIntent(), PackageManager.MATCH_DEFAULT_ONLY)
                if (hjemTil?.activityInfo?.packageName == activity.packageName) {
                    activity.startActivity(hjemIntent())
                    activity.finish()
                    return
                }
            }
            val am = activity.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
            if (am.lockTaskModeState == ActivityManager.LOCK_TASK_MODE_NONE) {
                activity.startLockTask()
            }
        } catch (e: Exception) {
            // Fx hvis ejer-rollen lige er fjernet: appen kører bare videre ulåst
        }
    }

    fun slaaTil(activity: Activity, prefs: SharedPreferences, kode: String): Boolean {
        if (!erEjer(activity)) return false
        prefs.edit()
            .putString(PREF_KODE, hashKode(kode))
            .putBoolean(PREF_TIL, true)
            .apply()
        laas(activity, prefs)
        return true
    }

    fun slaaFra(activity: Activity, prefs: SharedPreferences) {
        prefs.edit().putBoolean(PREF_TIL, false).remove(PREF_KODE).apply()
        try { activity.stopLockTask() } catch (e: Exception) {}
        // Kørte tælleren som startskærm, så start den som almindelig app igen.
        // Det skal ske i en ny opgave og FØR KioskHome slås fra: Android lukker
        // startskærmens opgave, når KioskHome slås fra — med alt, der ligger i den.
        val somHjem = startetSomHjem(activity)
        if (somHjem) {
            activity.startActivity(
                Intent(activity, MainActivity::class.java)
                    .setAction(Intent.ACTION_MAIN)
                    .addCategory(Intent.CATEGORY_LAUNCHER)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_MULTIPLE_TASK)
            )
        }
        if (erEjer(activity)) {
            try { saetPolitikker(activity, false) } catch (e: Exception) {}
        }
        if (somHjem) activity.finish()
    }

    private fun hjemIntent() = Intent(Intent.ACTION_MAIN)
        .addCategory(Intent.CATEGORY_HOME)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    private fun startetSomHjem(activity: Activity) =
        activity.intent?.hasCategory(Intent.CATEGORY_HOME) == true

    // Giv tabletten helt tilbage (så kan den bruges som normalt igen uden nulstilling)
    @Suppress("DEPRECATION")
    fun fjernEjer(activity: Activity, prefs: SharedPreferences) {
        slaaFra(activity, prefs)
        try { dpm(activity).clearDeviceOwnerApp(activity.packageName) } catch (e: Exception) {}
    }

    fun kodePasser(prefs: SharedPreferences, kode: String): Boolean {
        val gemt = prefs.getString(PREF_KODE, null) ?: return false
        val salt = gemt.substringBefore(':', "")
        if (salt.isEmpty()) return false
        return MessageDigest.isEqual(gemt.toByteArray(), hashKode(kode, salt).toByteArray())
    }

    fun gyldigKode(kode: String) = kode.length in KODE_MIN..KODE_MAX && kode.all { it.isDigit() }

    private fun hashKode(kode: String, salt: String = nytSalt()): String {
        val sha = MessageDigest.getInstance("SHA-256").digest((salt + kode).toByteArray())
        return salt + ":" + sha.joinToString("") { "%02x".format(it) }
    }

    private fun nytSalt(): String {
        val b = ByteArray(16)
        SecureRandom().nextBytes(b)
        return b.joinToString("") { "%02x".format(it) }
    }

    private fun saetPolitikker(ctx: Context, til: Boolean) {
        val dpm = dpm(ctx)
        val admin = admin(ctx)
        val pm = ctx.packageManager

        if (til) {
            dpm.setLockTaskPackages(admin, arrayOf(ctx.packageName))
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                // Kun tænd/sluk-menuen (genstart/sluk) er tilladt i låsen
                dpm.setLockTaskFeatures(admin, DevicePolicyManager.LOCK_TASK_FEATURE_GLOBAL_ACTIONS)
            }
            pm.setComponentEnabledSetting(
                hjem(ctx),
                PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
                PackageManager.DONT_KILL_APP
            )
            val filter = IntentFilter(Intent.ACTION_MAIN).apply {
                addCategory(Intent.CATEGORY_HOME)
                addCategory(Intent.CATEGORY_DEFAULT)
            }
            dpm.addPersistentPreferredActivity(admin, filter, hjem(ctx))
            // Ingen låseskærm (virker kun, når tabletten ikke har pinkode/mønster)
            dpm.setKeyguardDisabled(admin, true)
            // Fejlsikret tilstand ville starte uden appen
            dpm.addUserRestriction(admin, UserManager.DISALLOW_SAFE_BOOT)
        } else {
            dpm.clearPackagePersistentPreferredActivities(admin, ctx.packageName)
            pm.setComponentEnabledSetting(
                hjem(ctx),
                PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                PackageManager.DONT_KILL_APP
            )
            dpm.setKeyguardDisabled(admin, false)
            dpm.clearUserRestriction(admin, UserManager.DISALLOW_SAFE_BOOT)
            dpm.setLockTaskPackages(admin, arrayOf())
        }
    }
}
