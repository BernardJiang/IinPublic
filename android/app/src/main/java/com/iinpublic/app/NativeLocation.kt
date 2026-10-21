package com.iinpublic.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Looper
import androidx.core.content.ContextCompat
import org.json.JSONObject

/**
 * Android's own location, for when the WebView's `navigator.geolocation` never answers. The WebView
 * asks Google Play services' fused provider; on the Huawei P30 that call timed out every time while
 * the platform GPS had a 5 m fix (found 2026-10-20), so the page stayed at a random Traveler point.
 * This reads the platform providers directly: the newest last-known fix, and one fresh GPS/network
 * update so the next read is current. Coordinates go only to the page, which blurs them itself.
 */
internal object NativeLocation {
    private fun granted(context: Context): Boolean = listOf(
        Manifest.permission.ACCESS_FINE_LOCATION,
        Manifest.permission.ACCESS_COARSE_LOCATION,
    ).any { ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED }

    /** `{latitude, longitude, accuracy, timeMs}` of the newest fix any provider holds, or null. */
    @SuppressLint("MissingPermission")
    fun lastFix(context: Context): JSONObject? {
        if (!granted(context)) return null
        val manager = context.getSystemService(LocationManager::class.java) ?: return null
        val best = manager.getProviders(true).mapNotNull { provider ->
            try { manager.getLastKnownLocation(provider) } catch (_: Exception) { null }
        }.maxByOrNull { it.time } ?: return null
        return JSONObject()
            .put("latitude", best.latitude)
            .put("longitude", best.longitude)
            .put("accuracy", if (best.hasAccuracy()) best.accuracy.toDouble() else 1000.0)
            .put("timeMs", best.time)
    }

    /** Ask the enabled GPS and network providers for one fresh fix (answered into lastFix). */
    @SuppressLint("MissingPermission")
    fun requestFresh(context: Context) {
        if (!granted(context)) return
        val manager = context.getSystemService(LocationManager::class.java) ?: return
        for (provider in listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)) {
            try {
                if (!manager.isProviderEnabled(provider)) continue
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    manager.getCurrentLocation(provider, null, ContextCompat.getMainExecutor(context)) { _: Location? -> }
                } else {
                    @Suppress("DEPRECATION")
                    manager.requestSingleUpdate(provider, object : LocationListener {
                        override fun onLocationChanged(location: Location) {}
                        @Deprecated("Deprecated in Java")
                        override fun onStatusChanged(provider: String?, status: Int, extras: android.os.Bundle?) {}
                        override fun onProviderEnabled(provider: String) {}
                        override fun onProviderDisabled(provider: String) {}
                    }, Looper.getMainLooper())
                }
            } catch (_: Exception) {
                // Provider unavailable: the other one, or the last-known fix, answers.
            }
        }
    }
}
