package com.badminton.courtcounter

import android.app.admin.DeviceAdminReceiver

// Android kræver en DeviceAdminReceiver, før appen kan gøres til tablettens
// ejer (adb shell dpm set-device-owner …/.KioskAdminReceiver). Selve
// kiosktilstanden ligger i Kiosk.kt.
class KioskAdminReceiver : DeviceAdminReceiver()
