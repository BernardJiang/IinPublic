package com.iinpublic.app

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.content.res.Configuration
import android.widget.FrameLayout
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
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

    private val activityLaunchEpochMs = System.currentTimeMillis()
    private lateinit var webView: WebView
    private lateinit var nearbyBridge: NearbyJavascriptBridge
    @Volatile private var nodeLoadScheduled = false

    // Android 13+ (API 33, TIRAMISU) requires POST_NOTIFICATIONS to be granted
    // at runtime — declaring it in the manifest alone is not enough. Without
    // it, NodeForegroundService.startForeground() still runs the service (the
    // peer node keeps working), but the "peer node running" notification is
    // silently suppressed, which makes the long-running service look like it
    // could be killed by the OS sooner since the user has no visible cue it's
    // active. We ask before starting the service, and proceed either way
    // (the foreground service must start regardless of the answer).
    //
    // Location is asked in the same sheet, ONCE per install (first launch only): Nearby rooms and
    // the map need a position, but the WebView's own geolocation callback never prompts (see
    // onGeolocationPermissionsShowPrompt), so without this a fresh Android 13+ install never got
    // a location and sat in Contacts only with the map on (0, 0).
    private val startupPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { grants ->
            if (grants.any { (permission, granted) -> granted && permission in LOCATION_PERMISSIONS }) {
                notifyPageLocationGranted()
            }
            // Granted or denied — either way, start the node now so the app
            // doesn't block its core function on a permission preference.
            startNodeService()
            waitForNodeThenLoad()
        }
    /** OPEN-54: asked again from Settings. A denial Android no longer shows a dialog for (denied
     *  twice, or "Don't ask again") opens the app's settings page instead; onResume then notices a
     *  grant made there. */
    private val locationPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { grants ->
            if (grants.any { (permission, granted) -> granted && permission in LOCATION_PERMISSIONS }) {
                notifyPageLocationGranted()
            } else if (LOCATION_PERMISSIONS.none { shouldShowRequestPermissionRationale(it) }) {
                awaitingLocationFromSettings = true
                openNearbySettings("app")
            }
        }
    private var awaitingLocationFromSettings = false

    private val nearbyPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { grants ->
            nearbyBridge.permissionResult(grants)
        }

    // ── WebView → Android permission / picker bridge ────────────────────────────────────────────
    // A bare WebViewClient handles none of these: getUserMedia is silently denied ("Camera access
    // was denied" in the web UI), <input type=file> never opens a picker, and navigator.geolocation
    // is denied without a prompt. Each request is answered from the WebChromeClient below.

    // getUserMedia (camera) — one outstanding request at a time; a newer one denies the older.
    private var pendingWebPermissionRequest: PermissionRequest? = null
    private val cameraPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            val request = pendingWebPermissionRequest
            pendingWebPermissionRequest = null
            if (request != null) {
                if (granted) request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) else request.deny()
            }
        }

    // <input type="file"> (headshot "Choose photo", talk media attachment, conversation attach)
    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null
    private val fileChooserLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val callback = fileChooserCallback
            fileChooserCallback = null
            callback?.onReceiveValue(
                WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
            )
        }

    /** Only the app's own embedded node origin may use device capabilities. */
    private fun isTrustedOrigin(origin: Uri?): Boolean =
        origin != null && (origin.host == "127.0.0.1" || origin.host == "localhost")

    private val appChromeClient = object : WebChromeClient() {
        override fun onPermissionRequest(request: PermissionRequest) {
            runOnUiThread {
                // Video only. The web app never records audio, and RECORD_AUDIO is deliberately not
                // declared — an audio request is denied rather than silently widened.
                val wantsVideoOnly = request.resources.isNotEmpty() &&
                    request.resources.all { it == PermissionRequest.RESOURCE_VIDEO_CAPTURE }
                if (!isTrustedOrigin(request.origin) || !wantsVideoOnly) {
                    request.deny()
                    return@runOnUiThread
                }
                if (ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.CAMERA) ==
                    PackageManager.PERMISSION_GRANTED
                ) {
                    request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE))
                } else {
                    pendingWebPermissionRequest?.deny()
                    pendingWebPermissionRequest = request
                    cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
                }
            }
        }

        override fun onPermissionRequestCanceled(request: PermissionRequest) {
            if (pendingWebPermissionRequest === request) pendingWebPermissionRequest = null
        }

        // web/index.ts's location bootstrap calls navigator.geolocation automatically on every
        // boot, deliberately unprompted by any user gesture ("Cache-first UI: never block first
        // paint on geolocation... resolves the real fix in the background"). A bare WebViewClient
        // (before this WebChromeClient existed) silently denied this with no dialog, which is
        // exactly the fallback-gracefully behavior that bootstrap is designed around. Raising a
        // REAL native permission dialog here — as onPermissionRequest correctly does for the
        // user-gesture-triggered camera case — instead surfaced a blocking, unscriptable system
        // dialog on every fresh install/data-clear, found via real-device E2E (18-android-
        // keystore-custody, 06-seven-client-real-device-matrix both hung on it). Only grant
        // silently when a permission already exists from some other flow; never prompt.
        override fun onGeolocationPermissionsShowPrompt(
            origin: String,
            callback: GeolocationPermissions.Callback,
        ) {
            runOnUiThread {
                val granted = isTrustedOrigin(Uri.parse(origin)) && listOf(
                    Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION,
                ).any { ContextCompat.checkSelfPermission(this@MainActivity, it) == PackageManager.PERMISSION_GRANTED }
                callback.invoke(origin, granted, false)
            }
        }

        override fun onShowFileChooser(
            webView: WebView,
            filePathCallback: ValueCallback<Array<Uri>>,
            fileChooserParams: FileChooserParams,
        ): Boolean {
            // A page can re-trigger before the previous chooser returns; the WebView requires the
            // old callback to be completed (with null) or the input stays wedged.
            fileChooserCallback?.onReceiveValue(null)
            fileChooserCallback = filePathCallback
            return try {
                // System document picker (ACTION_GET_CONTENT / OpenDocument): needs no storage permission.
                fileChooserLauncher.launch(fileChooserParams.createIntent())
                true
            } catch (_: ActivityNotFoundException) {
                fileChooserCallback = null
                filePathCallback.onReceiveValue(null)
                false
            }
        }
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
            // Android's system "Font size" accessibility setting inflates WebView text via
            // font-boosting independent of layout — icons/badges/card widths stay put while
            // text balloons and wraps, breaking fixed-width UI like the chatroom list (seen on
            // a real device with a larger-than-default system font size, 2026-09-29). Pin
            // textZoom to 100 so our own CSS font sizes are always what actually render; users
            // who need larger text should use the in-app UI (none currently exposed) rather
            // than the OS setting silently reflowing a layout that wasn't designed for it.
            settings.textZoom = 100
            webViewClient = WebViewClient()
            webChromeClient = appChromeClient
        }
        nearbyBridge = NearbyJavascriptBridge(this, webView)
        webView.addJavascriptInterface(nearbyBridge, "IinPublicNearby")
        webView.addJavascriptInterface(NativeCustodyBridge(this), "IinPublicCustody")
        webView.addJavascriptInterface(NativeAttestationBridge(this), "IinPublicAttestation")
        // targetSdk 35+ forces edge-to-edge on Android 15+: without this the top bar sits under
        // the status bar / camera cutout and the bottom nav under the gesture bar. Pad a container
        // by the system-bar + cutout insets (and the keyboard, which adjustResize no longer
        // handles edge-to-edge) so the WebView only gets the safe area.
        val root = FrameLayout(this).apply {
            setBackgroundColor(if (isNightMode()) 0xFF121212.toInt() else 0xFFFFFFFF.toInt())
            addView(webView, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        }
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            view.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
            WindowInsetsCompat.CONSUMED
        }
        setContentView(root)
        WindowCompat.getInsetsController(window, root).apply {
            isAppearanceLightStatusBars = !isNightMode()
            isAppearanceLightNavigationBars = !isNightMode()
        }

        ensureNotificationPermissionThenStart()
    }

    private fun isNightMode(): Boolean =
        (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES

    private fun hasLocationPermission(): Boolean = LOCATION_PERMISSIONS.any {
        ContextCompat.checkSelfPermission(this, it) == PackageManager.PERMISSION_GRANTED
    }

    fun requestLocationPermission() = runOnUiThread {
        if (hasLocationPermission()) notifyPageLocationGranted()
        else locationPermissionLauncher.launch(LOCATION_PERMISSIONS.toTypedArray())
    }

    fun requestNearbyPermissions() {
        val permissions = mutableListOf<String>()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) permissions += Manifest.permission.NEARBY_WIFI_DEVICES
        else permissions += Manifest.permission.ACCESS_FINE_LOCATION
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) permissions += listOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_ADVERTISE, Manifest.permission.BLUETOOTH_CONNECT)
        val missing = permissions.distinct().filter { ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isEmpty()) nearbyBridge.permissionResult(permissions.associateWith { true }) else nearbyPermissionLauncher.launch(missing.toTypedArray())
    }

    fun updateNearbyForegroundMode(mode: String, roomId: String) {
        val safeMode = if (mode in listOf("off", "while-open", "always")) mode else "while-open"
        val serviceIntent = Intent(this, NodeForegroundService::class.java).apply {
            action = NodeForegroundService.ACTION_CONFIGURE_NEARBY
            putExtra(NodeForegroundService.NEARBY_MODE_EXTRA, safeMode)
            putExtra(NodeForegroundService.ACTIVE_ROOM_EXTRA, roomId.take(128))
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(serviceIntent)
        else startService(serviceIntent)
    }

    /** Only what Wi-Fi Direct needs (no Bluetooth prompts): asked in context, on the first upgrade. */
    fun requestWifiDirectPermission() = runOnUiThread {
        val permission = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) Manifest.permission.NEARBY_WIFI_DEVICES else Manifest.permission.ACCESS_FINE_LOCATION
        if (ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED) nearbyBridge.permissionResult(mapOf(permission to true))
        else nearbyPermissionLauncher.launch(arrayOf(permission))
    }

    fun openNearbySettings(kind: String) = runOnUiThread {
        val intent = when (kind) {
            "wifi" -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) Intent(android.provider.Settings.Panel.ACTION_WIFI)
                else Intent(android.provider.Settings.ACTION_WIFI_SETTINGS)
            "location" -> Intent(android.provider.Settings.ACTION_LOCATION_SOURCE_SETTINGS)
            "bluetooth" -> Intent(android.provider.Settings.ACTION_BLUETOOTH_SETTINGS)
            "app" -> Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null))
            else -> return@runOnUiThread
        }
        try { startActivity(intent) } catch (_: ActivityNotFoundException) { /* no settings screen */ }
    }

    /** OPEN-36 offline nearby: Wi-Fi Direct + BLE presence. Android 12+ shows these as one
     *  "Nearby devices" prompt; Android 10–11 need only Location (BLE there is install-time). */
    fun requestOfflineNearbyPermission() = runOnUiThread {
        val permissions = mutableListOf<String>()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) permissions += Manifest.permission.NEARBY_WIFI_DEVICES
        else permissions += Manifest.permission.ACCESS_FINE_LOCATION
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) permissions += listOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_ADVERTISE)
        val missing = permissions.filter { ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isEmpty()) nearbyBridge.permissionResult(permissions.associateWith { true }) else nearbyPermissionLauncher.launch(missing.toTypedArray())
    }

    private fun ensureNotificationPermissionThenStart() {
        val missing = mutableListOf<String>()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            // Pre-Android 13 POST_NOTIFICATIONS is install-time; nothing to ask.
            missing += Manifest.permission.POST_NOTIFICATIONS
        }
        val prefs = getSharedPreferences(FIRST_LAUNCH_PREFS, MODE_PRIVATE)
        if (!prefs.getBoolean(LOCATION_ASKED_PREF, false)) {
            // Recorded up front: asked once, whatever the answer. Automation (no human to answer
            // the sheet) passes skip_first_launch_location and is treated as already asked.
            prefs.edit().putBoolean(LOCATION_ASKED_PREF, true).apply()
            val skip = intent?.getBooleanExtra(SKIP_FIRST_LAUNCH_LOCATION_EXTRA, false) == true
            if (!skip) {
                missing += LOCATION_PERMISSIONS.filter {
                    ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
                }
            }
        }
        if (missing.isEmpty()) {
            startNodeService()
            waitForNodeThenLoad()
        } else {
            startupPermissionLauncher.launch(missing.toTypedArray())
        }
    }

    /** The page may have booted while the sheet was open; its background fix was denied then. */
    private fun notifyPageLocationGranted() {
        if (!::webView.isInitialized) return
        webView.post {
            webView.evaluateJavascript("window.dispatchEvent(new Event('iinpublic-location-granted'))", null)
        }
    }

    private fun startNodeService() {
        val intent = Intent(this, NodeForegroundService::class.java)
        // e2e/manual multi-device testing: `adb shell am start -n com.iinpublic.app/.MainActivity
        // --es hub_gun_url "http://<host>:<port>/gun"` overrides the production default so this
        // device dials a local/test hub instead — see docs/testing/manual-platform-test-plan.md.
        // Absent in normal (Play Store / sideloaded) launches, so production behavior is unchanged.
        // Test-only network isolation must never alter a production launch. MainActivity is the
        // exported launcher, so merely documenting these Intent extras as "debug only" is not a
        // security boundary: another app could otherwise redirect the relay or suppress LAN.
        AndroidLaunchNetworkPolicy.hubOverride(
            BuildConfig.DEBUG,
            this.intent?.getStringExtra(NodeForegroundService.HUB_GUN_URL_EXTRA),
        )?.let { override ->
            intent.putExtra(NodeForegroundService.HUB_GUN_URL_EXTRA, override)
        }
        if (AndroidLaunchNetworkPolicy.disableLanDiscovery(
                BuildConfig.DEBUG,
                this.intent?.getBooleanExtra(NodeForegroundService.DISABLE_LAN_DISCOVERY_EXTRA, false) == true,
            )) {
            intent.putExtra(NodeForegroundService.DISABLE_LAN_DISCOVERY_EXTRA, true)
        }
        if (BuildConfig.DEBUG
            && this.intent?.getBooleanExtra(NodeForegroundService.PORTABLE_CORE_TESTS_EXTRA, false) == true) {
            intent.putExtra(NodeForegroundService.PORTABLE_CORE_TESTS_EXTRA, true)
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
            // Past this point show a "still starting" note but keep waiting: a node that was only
            // slow (seen once on the C10 tablet right after an update) used to strand the user on a
            // permanent "did not start" page even though it came up moments later.
            val noticeAt = System.currentTimeMillis() + 90_000
            val deadline = System.currentTimeMillis() + 10 * 60_000
            var noticeShown = false
            while (System.currentTimeMillis() < deadline) {
                if (!noticeShown && System.currentTimeMillis() >= noticeAt) {
                    noticeShown = true
                    runOnUiThread {
                        webView.loadData(
                            "<h2>IinPublic is still starting…</h2><p>This can take a while after an update. It will open by itself.</p>",
                            "text/html", "utf-8"
                        )
                    }
                }
                if (portOpen(port)) {
                    val nodeHealthReadyEpochMs = System.currentTimeMillis()
                    runOnUiThread {
                        webView.loadUrl(
                            "http://127.0.0.1:$port/?native_platform=android" +
                                "&app_version=${BuildConfig.VERSION_NAME}" +
                                // Debug APKs use the small debug Place-creation threshold (CONFIG).
                                (if (BuildConfig.DEBUG) "&app_debug=1" else "") +
                                "&perf_process_launch_ms=$activityLaunchEpochMs" +
                                "&perf_node_health_ready_ms=$nodeHealthReadyEpochMs" +
                                wifiDirectLinkQuery()
                        )
                    }
                    return@Thread
                }
                Thread.sleep(if (noticeShown) 1_000 else 300)
            }
            runOnUiThread {
                webView.loadData(
                    "<h2>IinPublic node did not start</h2><p>Close the app and open it again.</p>",
                    "text/html", "utf-8"
                )
            }
        }.start()
    }

    /** Device testing: `adb shell am start ... --ez wifi_direct_link true|false` toggles the
     *  OPEN-36 Wi-Fi Direct link flag (the web side persists it in localStorage). */
    internal companion object {
        private const val FIRST_LAUNCH_PREFS = "iinpublic_first_launch_v1"
        private const val LOCATION_ASKED_PREF = "location_asked"
        /** Test harness: no human can answer the first-launch location sheet. */
        const val SKIP_FIRST_LAUNCH_LOCATION_EXTRA = "skip_first_launch_location"
        // FINE is declared with maxSdkVersion 32 — on 33+ asking for it would be auto-denied.
        private val LOCATION_PERMISSIONS =
            if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.S_V2)
                listOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
            else listOf(Manifest.permission.ACCESS_COARSE_LOCATION)
        private const val WIFI_DIRECT_LINK_EXTRA = "wifi_direct_link"
        private const val DROP_REMOTE_CANDIDATES_EXTRA = "p2p_drop_remote_candidates"

        /** OPEN-38: true while the UI is visible — MailboxWatcher stays quiet then. */
        @Volatile
        internal var isInForeground = false
    }

    private fun wifiDirectLinkQuery(): String {
        // Every query override below exists only to isolate physical E2E paths. A release always
        // boots with the production defaults: internet relay, LAN, Wi-Fi Direct, and BLE enabled;
        // the user's persisted Settings choices are then applied by the web app.
        if (!AndroidLaunchNetworkPolicy.allowsTestOverrides(BuildConfig.DEBUG)) return ""
        val launch = intent ?: return ""
        var query = ""
        if (launch.hasExtra(WIFI_DIRECT_LINK_EXTRA)) {
            query += "&wifi_direct_link=" + (if (launch.getBooleanExtra(WIFI_DIRECT_LINK_EXTRA, false)) "1" else "0")
        }
        // Debug only (`--es p2p_drop_remote_candidates 192.168.10.`): simulate different networks
        // on a shared LAN so the Wi-Fi Direct upgrade can be exercised on a desk.
        launch.getStringExtra(DROP_REMOTE_CANDIDATES_EXTRA)?.takeIf { it.matches(Regex("^[0-9a-fA-F.:]{2,40}$")) }?.let {
            query += "&p2p_drop_remote_candidates=" + Uri.encode(it)
        }
        // Debug only (`--ez disable_lan_discovery true`): also skip the page's NSD LAN discovery,
        // so phones on one LAN exercise the offline Wi-Fi Direct path.
        if (launch.getBooleanExtra(NodeForegroundService.DISABLE_LAN_DISCOVERY_EXTRA, false)) query += "&nearby_lan=0"
        // Debug only (`--ez disable_ble_presence true`): exercise the Wi-Fi-only discovery paths.
        if (launch.getBooleanExtra("disable_ble_presence", false)) query += "&nearby_ble=0"
        return query
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

    override fun onResume() {
        super.onResume()
        isInForeground = true
        if (awaitingLocationFromSettings && hasLocationPermission()) {
            awaitingLocationFromSettings = false
            notifyPageLocationGranted()
        }
        // Android WebView does not consistently emit the browser visibilitychange event when an
        // Activity returns from HOME (observed on Android 14 hardware). Tell the SPA explicitly so
        // it can rebuild stale WebRTC room links and drain pending encrypted mailbox work.
        if (::webView.isInitialized) {
            webView.post {
                webView.evaluateJavascript("window.dispatchEvent(new Event('iinpublic-native-resume'));", null)
            }
        }
    }

    override fun onPause() {
        isInForeground = false
        super.onPause()
    }

    override fun onDestroy() {
        // The connected-device foreground service, not this Activity, owns nearby discovery.
        // Detach only the UI event sink; "Always" mode continues across Activity recreation.
        nearbyBridge.detach()
        webView.destroy()
        super.onDestroy()
    }
}
