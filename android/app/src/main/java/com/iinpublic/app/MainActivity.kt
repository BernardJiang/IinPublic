package com.iinpublic.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import java.net.HttpURLConnection
import java.net.URL

/**
 * Hosts the reused web SPA in a system WebView.
 *
 * Flow:
 *   1. Start NodeForegroundService → boots the embedded Gun P2P node on
 *      127.0.0.1:LOCAL_PORT (discovery via hub, on-device persistence).
 *   2. Poll the local port until the node is listening.
 *   3. Load http://127.0.0.1:LOCAL_PORT/ — the SAME web UI as the browser.
 *
 * Because the WebView is UI-only and the Node process is the actual peer, the
 * limited WebRTC support in some WebViews does not block P2P: the node owns the
 * Gun mesh / direct transport.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var nearbyBridge: NearbyJavascriptBridge
    @Volatile private var nodeLoadScheduled = false

    // Android 13+ (API 33, TIRAMISU) requires POST_NOTIFICATIONS to be granted
    // at runtime — declaring it in the manifest alone is not enough. Without
    // it, NodeForegroundService.startForeground() still runs the service (the
    // peer node keeps working), but the "peer node running" notification is
    // silently suppressed, which makes the long-running service look like it
    // could be killed by the OS sooner since the user has no visible cue it's
    // active. We ask once, before starting the service, and proceed either way
    // (the foreground service must start regardless of the answer).
    private val notificationPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { _ ->
            // Granted or denied — either way, start the node now so the app
            // doesn't block its core function on a notification preference.
            startNodeService()
            waitForNodeThenLoad()
        }
    private val nearbyPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { grants ->
            nearbyBridge.permissionResult(grants)
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Debug builds only: lets Playwright's _android module (or chrome://inspect)
        // attach to this WebView over adb via Chrome DevTools Protocol. Without this
        // call the WebView is opaque to any external automation regardless of the
        // build's own debuggable flag — see docs/testing/manual-platform-test-plan.md's
        // Android e2e section.
        if (BuildConfig.DEBUG) {
            WebView.setWebContentsDebuggingEnabled(true)
        }

        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            webViewClient = WebViewClient()
        }
        nearbyBridge = NearbyJavascriptBridge(this, webView)
        webView.addJavascriptInterface(nearbyBridge, "IinPublicNearby")
        setContentView(webView)

        ensureNotificationPermissionThenStart()
    }

    fun requestNearbyPermissions() {
        val permissions = mutableListOf<String>()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) permissions += Manifest.permission.NEARBY_WIFI_DEVICES
        else permissions += Manifest.permission.ACCESS_FINE_LOCATION
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) permissions += listOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_ADVERTISE, Manifest.permission.BLUETOOTH_CONNECT)
        val missing = permissions.distinct().filter { ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isEmpty()) nearbyBridge.permissionResult(permissions.associateWith { true }) else nearbyPermissionLauncher.launch(missing.toTypedArray())
    }

    private fun ensureNotificationPermissionThenStart() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            // Pre-Android 13: POST_NOTIFICATIONS is a normal (install-time)
            // permission, nothing to request at runtime.
            startNodeService()
            waitForNodeThenLoad()
            return
        }
        val granted = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.POST_NOTIFICATIONS,
        ) == PackageManager.PERMISSION_GRANTED
        if (granted) {
            startNodeService()
            waitForNodeThenLoad()
        } else {
            notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    private fun startNodeService() {
        val intent = Intent(this, NodeForegroundService::class.java)
        // e2e/manual multi-device testing: `adb shell am start -n com.iinpublic.app/.MainActivity
        // --es hub_gun_url "http://<host>:<port>/gun"` overrides the production default so this
        // device dials a local/test hub instead — see docs/testing/manual-platform-test-plan.md.
        // Absent in normal (Play Store / sideloaded) launches, so production behavior is unchanged.
        this.intent?.getStringExtra(NodeForegroundService.HUB_GUN_URL_EXTRA)?.let { override ->
            intent.putExtra(NodeForegroundService.HUB_GUN_URL_EXTRA, override)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent)
        } else {
            startService(intent)
        }
    }

    private fun waitForNodeThenLoad() {
        // Permission callbacks and activity lifecycle delivery can both reach this method. Only
        // one poller may own the eventual loadUrl, otherwise the SPA boots and joins Global twice.
        synchronized(this) {
            if (nodeLoadScheduled) return
            nodeLoadScheduled = true
        }
        val port = NodeForegroundService.LOCAL_PORT
        Thread {
            // First launch on older phones can spend 30–45 seconds unpacking the embedded
            // Node project before the loopback health endpoint opens. A 20-second deadline
            // stranded otherwise healthy Android 7 devices on the connecting screen forever.
            val deadline = System.currentTimeMillis() + 90_000
            while (System.currentTimeMillis() < deadline) {
                if (portOpen(port)) {
                    runOnUiThread {
                        webView.loadUrl(
                            "http://127.0.0.1:$port/?native_platform=android&app_version=${BuildConfig.VERSION_NAME}"
                        )
                    }
                    return@Thread
                }
                Thread.sleep(300)
            }
            runOnUiThread {
                webView.loadData(
                    "<h2>IinPublic node did not start</h2>",
                    "text/html", "utf-8"
                )
            }
        }.start()
    }

    private fun portOpen(port: Int): Boolean = try {
        val conn = URL("http://127.0.0.1:$port/health").openConnection() as HttpURLConnection
        conn.connectTimeout = 500
        conn.readTimeout = 500
        conn.requestMethod = "GET"
        val code = conn.responseCode
        conn.disconnect()
        code in 200..499
    } catch (_: Exception) {
        false
    }

    override fun onDestroy() {
        nearbyBridge.stop()
        webView.destroy()
        super.onDestroy()
    }
}
