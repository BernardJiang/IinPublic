package com.iinpublic.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.os.IBinder
import android.os.Handler
import android.os.Looper
import org.json.JSONArray
import org.json.JSONObject

/**
 * Hosts the embedded Node (Gun P2P) runtime via nodejs-mobile as an Android
 * foreground service.
 *
 * The Node project (platforms/mobile/nodejs-project, copied into assets at
 * build time) boots the SAME embedded local node used on desktop. It dials the
 * hub for discovery only and serves the web SPA on 127.0.0.1:<port>, which
 * MainActivity's WebView then loads.
 *
 * NOTE: `startNodeWithScript` / `startNodeProject` come from the nodejs-mobile
 * AAR (`com.janeasystems:nodejs-mobile:<ver>`). Add that dependency and the
 * `nodejs-mobile-gradle` plugin (see android/app/build.gradle) to resolve it.
 */
class NodeForegroundService : Service() {

    companion object {
        const val CHANNEL_ID = "iinpublic_node"
        const val NOTIF_ID = 1001
        const val LOCAL_PORT = 8088
        const val HUB_GUN_URL = "https://www.iinpublic.com/gun"
        /** Intent extra key MainActivity forwards an adb-supplied hub override under. */
        const val HUB_GUN_URL_EXTRA = "hub_gun_url"
        /** Test-only isolation switch; normal app launches retain LAN peer discovery. */
        const val DISABLE_LAN_DISCOVERY_EXTRA = "disable_lan_discovery"
        const val ACTION_CONFIGURE_NEARBY = "com.iinpublic.app.CONFIGURE_NEARBY"
        const val ACTION_PAUSE_NEARBY = "com.iinpublic.app.PAUSE_NEARBY"
        const val ACTION_STOP_NEARBY = "com.iinpublic.app.STOP_NEARBY"
        const val NEARBY_MODE_EXTRA = "nearby_mode"
        const val ACTIVE_ROOM_EXTRA = "active_room"
        private const val NEARBY_PREFS = "iinpublic_nearby_service_v1"
        private const val NEARBY_MODE_PREF = "mode"
        private const val ACTIVE_ROOM_PREF = "active_room"
        private const val NEARBY_PAUSED_PREF = "paused"
        private const val NSD_PORT_PREF = "nsd_port"
        private const val NSD_ID_PREF = "nsd_id"
        private const val NSD_ROOM_PREFIX_PREF = "nsd_room_prefix"
        private const val WIFI_TXT_PREF = "wifi_txt"
        private const val WIFI_DISCOVERY_PREF = "wifi_discovery"
        private const val BLE_PAYLOAD_PREF = "ble_payload"
        private const val BLE_SCAN_PREF = "ble_scan"
        private const val CHECKPOINT_AT_PREF = "checkpoint_at"
        private const val NEARBY_CHECKPOINT_MAX_AGE_MS = 20 * 60 * 1000L

        @Volatile var nodeStarted = false
        @Volatile private var serviceInstance: NodeForegroundService? = null
        @Volatile var nearbyListener: NearbyConnectivityManager.Listener? = null

        internal fun withNearbyManager(block: (NearbyConnectivityManager) -> Unit) {
            val service = serviceInstance ?: return
            service.mainHandler.post {
                if (service.nearbyMode != "off" && !service.nearbyPaused) block(service.nearbyManager)
            }
        }

        internal fun startLanDiscovery(port: Int, nearbyId: String, roomTokenPrefix: String) {
            serviceInstance?.mainHandler?.post {
                val service = serviceInstance ?: return@post
                if (!service.nearbyEnabled()) return@post
                service.nsdPort = port.coerceIn(1, 65535)
                service.nsdId = nearbyId.take(12)
                service.nsdRoomPrefix = roomTokenPrefix.take(8)
                service.touchNearbyCheckpoint()
                service.persistNearbyState()
                service.nearbyManager.startNsd(service.nsdPort, service.nsdId, service.nsdRoomPrefix)
            }
        }

        internal fun stopLanDiscovery() {
            serviceInstance?.mainHandler?.post {
                val service = serviceInstance ?: return@post
                service.nsdPort = 0; service.nsdId = ""; service.nsdRoomPrefix = ""
                service.persistNearbyState()
                service.nearbyManager.stopNsd()
            }
        }

        internal fun advertiseWifiDirectService(txt: Map<String, String>) {
            serviceInstance?.mainHandler?.post {
                val service = serviceInstance ?: return@post
                if (!service.nearbyEnabled()) return@post
                service.wifiTxtJson = JSONObject(txt).toString()
                service.touchNearbyCheckpoint()
                service.persistNearbyState()
                service.nearbyManager.advertiseWifiDirectService(txt)
            }
        }

        internal fun setWifiDirectServiceDiscovery(enabled: Boolean) {
            serviceInstance?.mainHandler?.post {
                val service = serviceInstance ?: return@post
                service.wifiDiscovery = enabled
                if (enabled) service.touchNearbyCheckpoint()
                service.persistNearbyState()
                if (enabled && service.nearbyEnabled()) service.nearbyManager.startWifiDirectServiceDiscovery()
                else service.nearbyManager.stopWifiDirectServiceDiscovery()
            }
        }

        internal fun startBlePresence(payload: ByteArray, scan: Boolean) {
            serviceInstance?.mainHandler?.post {
                val service = serviceInstance ?: return@post
                if (!service.nearbyEnabled()) return@post
                service.blePayloadHex = payload.joinToString("") { "%02x".format(it) }
                service.bleScan = scan
                service.touchNearbyCheckpoint()
                service.persistNearbyState()
                service.nearbyManager.startBlePresence(payload, scan)
            }
        }

        internal fun stopBlePresence() {
            serviceInstance?.mainHandler?.post {
                val service = serviceInstance ?: return@post
                service.blePayloadHex = ""
                service.bleScan = true
                service.persistNearbyState()
                service.nearbyManager.stopBlePresence()
            }
        }

        internal fun nearbyCapabilities(): JSONObject =
            serviceInstance?.nearbyManager?.capabilities() ?: JSONObject().put("version", 1).put("available", false)

        internal fun nearbyReadiness(): JSONObject =
            serviceInstance?.nearbyManager?.nearbyReadiness() ?: JSONObject().put("version", 1).put("permission", false)

        internal fun wifiDirectState(): JSONObject =
            serviceInstance?.nearbyManager?.wifiDirectState() ?: JSONObject().put("version", 1).put("state", "idle")

        internal fun mailboxWatcherOrNull(): MailboxWatcher? = serviceInstance?.mailboxWatcher

        /** OPEN-38: the page (alive but not visible) asks for the activity notification. */
        internal fun notifyFromPage(text: String) {
            val context = serviceInstance?.applicationContext ?: return
            if (MainActivity.isInForeground) return
            MailboxWatcher.postActivityNotification(context, text)
        }

        /** OPEN-38: the page tells the service whose mailbox to watch while it sleeps. */
        internal fun setMailboxRecipient(userId: String) {
            serviceInstance?.mailboxWatcher?.setRecipient(userId)
        }

        internal fun networkPathState(): JSONObject = serviceInstance?.networkPathState()
            ?: JSONObject().put("version", 1).put("connected", false).put("metered", true)
    }

    private var nearbyMode = "while-open"
    private var activeRoom = ""
    private var nearbyPaused = false
    private var nsdPort = 0
    private var nsdId = ""
    private var nsdRoomPrefix = ""
    private var wifiTxtJson = ""
    private var wifiDiscovery = false
    private var blePayloadHex = ""
    private var bleScan = true
    private var nearbyCheckpointAt = 0L
    private val mainHandler = Handler(Looper.getMainLooper())
    private val nearbyExpiryRunnable = Runnable {
        if (nearbyCheckpointAt > 0L
            && System.currentTimeMillis() - nearbyCheckpointAt >= NEARBY_CHECKPOINT_MAX_AGE_MS) {
            nearbyManager.stop()
            clearNearbyCheckpoint()
            persistNearbyState()
        }
    }
    private lateinit var nearbyManager: NearbyConnectivityManager
    private var mailboxWatcher: MailboxWatcher? = null

    override fun onCreate() {
        super.onCreate()
        serviceInstance = this
        getSharedPreferences(NEARBY_PREFS, Context.MODE_PRIVATE).let { prefs ->
            nearbyMode = prefs.getString(NEARBY_MODE_PREF, "while-open")
                ?.takeIf { it in listOf("off", "while-open", "always") } ?: "while-open"
            activeRoom = prefs.getString(ACTIVE_ROOM_PREF, "")?.take(128).orEmpty()
            nearbyPaused = prefs.getBoolean(NEARBY_PAUSED_PREF, false)
            nsdPort = prefs.getInt(NSD_PORT_PREF, 0)
            nsdId = prefs.getString(NSD_ID_PREF, "")?.take(12).orEmpty()
            nsdRoomPrefix = prefs.getString(NSD_ROOM_PREFIX_PREF, "")?.take(8).orEmpty()
            wifiTxtJson = prefs.getString(WIFI_TXT_PREF, "").orEmpty()
            wifiDiscovery = prefs.getBoolean(WIFI_DISCOVERY_PREF, false)
            blePayloadHex = prefs.getString(BLE_PAYLOAD_PREF, "").orEmpty()
            bleScan = prefs.getBoolean(BLE_SCAN_PREF, true)
            nearbyCheckpointAt = prefs.getLong(CHECKPOINT_AT_PREF, 0L)
        }
        nearbyManager = NearbyConnectivityManager(applicationContext, object : NearbyConnectivityManager.Listener {
            override fun onCandidate(source: String, transportId: String, endpoint: String?, capabilities: List<String>) =
                nearbyListener?.onCandidate(source, transportId, endpoint, capabilities) ?: Unit
            override fun onStatus(provider: String, state: String, reason: String?) =
                nearbyListener?.onStatus(provider, state, reason) ?: Unit
            override fun onWifiDirectState(state: JSONObject) = nearbyListener?.onWifiDirectState(state) ?: Unit
            override fun onWifiDirectPeers(peers: JSONArray) = nearbyListener?.onWifiDirectPeers(peers) ?: Unit
            override fun onBlePresence(payload: ByteArray, rssi: Int) = nearbyListener?.onBlePresence(payload, rssi) ?: Unit
            override fun onWifiDirectService(deviceAddress: String, txt: Map<String, String>) =
                nearbyListener?.onWifiDirectService(deviceAddress, txt) ?: Unit
        })
        mailboxWatcher = MailboxWatcher(applicationContext, LOCAL_PORT).also { it.start() }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_CONFIGURE_NEARBY -> {
                val previousRoom = activeRoom
                nearbyMode = intent.getStringExtra(NEARBY_MODE_EXTRA)?.takeIf { it in listOf("off", "while-open", "always") } ?: nearbyMode
                activeRoom = intent.getStringExtra(ACTIVE_ROOM_EXTRA)?.take(128).orEmpty()
                nearbyPaused = false
                if (nearbyMode == "off" || (previousRoom.isNotEmpty() && previousRoom != activeRoom)) {
                    nearbyManager.stop()
                    clearNearbyCheckpoint()
                }
            }
            ACTION_PAUSE_NEARBY -> {
                nearbyPaused = true
                nearbyManager.stop()
            }
            ACTION_STOP_NEARBY -> {
                nearbyMode = "off"
                nearbyPaused = false
                nearbyManager.stop()
                clearNearbyCheckpoint()
            }
        }
        persistNearbyState()
        startForeground(NOTIF_ID, buildNotification())
        if (nearbyMode == "always" && !nearbyPaused) restoreNearbyCheckpoint()
        if (!nodeStarted) {
            nodeStarted = true
            // nodeStarted latches for the life of this process — a later onStartCommand
            // with a different override is a no-op (matches NodeBridge.startProject's own
            // `started` latch below it). Fine for e2e: force-stop the app between runs
            // that need a different hub, same as any fresh launch.
            val hubUrl = intent?.getStringExtra(HUB_GUN_URL_EXTRA)?.takeIf { it.isNotBlank() } ?: HUB_GUN_URL
            val disableLanDiscovery = intent?.getBooleanExtra(DISABLE_LAN_DISCOVERY_EXTRA, false) == true
            startEmbeddedNode(hubUrl, disableLanDiscovery)
        }
        // Preserve the launch configuration if Android restarts this process. START_STICKY
        // supplies a null Intent, which silently changed an adb-selected test hub back to the
        // production hub after a process restart. Redelivery keeps the original hub_gun_url;
        // an ordinary later app launch still sends its own fresh, production-default Intent.
        return START_REDELIVER_INTENT
    }

    override fun onDestroy() {
        mailboxWatcher?.stop()
        nearbyManager.stop()
        if (serviceInstance === this) serviceInstance = null
        super.onDestroy()
    }

    private fun startEmbeddedNode(hubUrl: String, disableLanDiscovery: Boolean) {
        val dataDir = filesDir.absolutePath + "/node-data"
        java.io.File(dataDir).mkdirs()

        Thread {
            // NodeBridge.startProject unpacks assets then calls the JNI shim.
            // The native side sets IINPUBLIC_* env vars and spawns a pthread
            // that runs node::Start().
            NodeBridge.startProject(this, "main.js", LOCAL_PORT, dataDir, hubUrl, disableLanDiscovery)
        }.start()
    }

    private fun persistNearbyState() {
        getSharedPreferences(NEARBY_PREFS, Context.MODE_PRIVATE).edit()
            .putString(NEARBY_MODE_PREF, nearbyMode)
            .putString(ACTIVE_ROOM_PREF, activeRoom)
            .putBoolean(NEARBY_PAUSED_PREF, nearbyPaused)
            .putInt(NSD_PORT_PREF, nsdPort)
            .putString(NSD_ID_PREF, nsdId)
            .putString(NSD_ROOM_PREFIX_PREF, nsdRoomPrefix)
            .putString(WIFI_TXT_PREF, wifiTxtJson)
            .putBoolean(WIFI_DISCOVERY_PREF, wifiDiscovery)
            .putString(BLE_PAYLOAD_PREF, blePayloadHex)
            .putBoolean(BLE_SCAN_PREF, bleScan)
            .putLong(CHECKPOINT_AT_PREF, nearbyCheckpointAt)
            .apply()
    }

    private fun nearbyEnabled(): Boolean = nearbyMode != "off" && !nearbyPaused

    private fun clearNearbyCheckpoint() {
        nsdPort = 0; nsdId = ""; nsdRoomPrefix = ""
        wifiTxtJson = ""; wifiDiscovery = false; blePayloadHex = ""; bleScan = true
        nearbyCheckpointAt = 0L
        mainHandler.removeCallbacks(nearbyExpiryRunnable)
    }

    private fun restoreNearbyCheckpoint() {
        if (!nearbyEnabled()) return
        val age = System.currentTimeMillis() - nearbyCheckpointAt
        if (nearbyCheckpointAt <= 0L || age !in 0..NEARBY_CHECKPOINT_MAX_AGE_MS) {
            nearbyManager.stop()
            clearNearbyCheckpoint()
            persistNearbyState()
            return
        }
        scheduleNearbyCheckpointExpiry()
        if (nsdPort in 1..65535 && nsdId.matches(Regex("^[0-9a-f]{12}$"))
            && nsdRoomPrefix.matches(Regex("^[0-9a-f]{8}$"))) {
            nearbyManager.startNsd(nsdPort, nsdId, nsdRoomPrefix)
        }
        if (wifiTxtJson.isNotEmpty()) {
            runCatching { JSONObject(wifiTxtJson) }.getOrNull()?.let { json ->
                val txt = json.keys().asSequence().associateWith { json.optString(it).take(64) }
                nearbyManager.advertiseWifiDirectService(txt)
            }
        }
        if (wifiDiscovery) nearbyManager.startWifiDirectServiceDiscovery()
        if (blePayloadHex.matches(Regex("^[0-9a-f]{2,24}$")) && blePayloadHex.length % 2 == 0) {
            nearbyManager.startBlePresence(
                blePayloadHex.chunked(2).map { it.toInt(16).toByte() }.toByteArray(),
                bleScan,
            )
        }
    }

    private fun touchNearbyCheckpoint() {
        nearbyCheckpointAt = System.currentTimeMillis()
        scheduleNearbyCheckpointExpiry()
    }

    private fun scheduleNearbyCheckpointExpiry() {
        mainHandler.removeCallbacks(nearbyExpiryRunnable)
        if (nearbyCheckpointAt <= 0L) return
        val remaining = (NEARBY_CHECKPOINT_MAX_AGE_MS - (System.currentTimeMillis() - nearbyCheckpointAt))
            .coerceAtLeast(1L)
        mainHandler.postDelayed(nearbyExpiryRunnable, remaining)
    }

    private fun networkPathState(): JSONObject {
        val connectivity = getSystemService(ConnectivityManager::class.java)
        val network = connectivity.activeNetwork
        val capabilities = network?.let { connectivity.getNetworkCapabilities(it) }
        val transports = JSONArray().apply {
            if (capabilities?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true) put("wifi")
            if (capabilities?.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) == true) put("cellular")
            if (capabilities?.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) == true) put("ethernet")
            if (capabilities?.hasTransport(NetworkCapabilities.TRANSPORT_BLUETOOTH) == true) put("bluetooth")
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && capabilities?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI_AWARE) == true) put("wifi-aware")
        }
        return JSONObject().apply {
            put("version", 1)
            put("connected", capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true)
            put("validated", capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) == true)
            put("metered", capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED) != true)
            put("transports", transports)
        }
    }

    private fun buildNotification(): Notification {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val mgr = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            mgr.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_ID,
                    "IinPublic peer node",
                    NotificationManager.IMPORTANCE_LOW,
                )
            )
        }
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            Notification.Builder(this, CHANNEL_ID) else Notification.Builder(this)
        val pauseIntent = PendingIntent.getService(
            this,
            1,
            Intent(this, NodeForegroundService::class.java).setAction(ACTION_PAUSE_NEARBY),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val stopIntent = PendingIntent.getService(
            this,
            2,
            Intent(this, NodeForegroundService::class.java).setAction(ACTION_STOP_NEARBY),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val status = when {
            nearbyMode == "off" -> "Nearby exchange off · peer node running"
            nearbyPaused -> "Nearby exchange paused · $activeRoom"
            activeRoom.isNotBlank() -> "Exchanging in $activeRoom · $nearbyMode"
            else -> "Peer node running · nearby $nearbyMode"
        }
        return builder
            .setContentTitle("IinPublic")
            .setContentText(status)
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setOngoing(true)
            .addAction(android.R.drawable.ic_media_pause, "Pause nearby", pauseIntent)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Stop nearby", stopIntent)
            .build()
    }
}
