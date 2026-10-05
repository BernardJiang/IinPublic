package com.iinpublic.app

import android.os.Build
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONArray
import org.json.JSONObject

/** Minimal WebView boundary; emits data-only CustomEvents and exposes no identity authority. */
class NearbyJavascriptBridge(
    private val activity: MainActivity,
    private val webView: WebView,
) : NearbyConnectivityManager.Listener {
    init {
        NodeForegroundService.nearbyListener = this
    }

    private fun withManager(action: (NearbyConnectivityManager) -> Unit) =
        NodeForegroundService.withNearbyManager(action)

    @JavascriptInterface fun capabilities(): String = NodeForegroundService.nearbyCapabilities().toString()
    @JavascriptInterface fun setNearbyExchangeMode(mode: String, roomId: String) =
        activity.updateNearbyForegroundMode(mode, roomId)
    @JavascriptInterface fun requestPermissions() = activity.requestNearbyPermissions()
    @JavascriptInterface fun startNsd(port: Int) = withManager { it.startNsd(port.coerceIn(1, 65535)) }
    /** OPEN-36 offline mode: LAN discovery advertising this phone's rotating nearby id. */
    @JavascriptInterface fun startLanDiscovery(port: Int, nearbyId: String, roomTokenPrefix: String) =
        NodeForegroundService.startLanDiscovery(port, nearbyId, roomTokenPrefix)
    @JavascriptInterface fun stopLanDiscovery() = NodeForegroundService.stopLanDiscovery()
    @JavascriptInterface fun advertiseWifiDirectService(txtJson: String) {
        val txt = runCatching { JSONObject(txtJson) }.getOrNull() ?: return
        val map = txt.keys().asSequence().filter { it.matches(Regex("^[a-z]{1,2}$")) }
            .associateWith { txt.optString(it).take(64) }
        NodeForegroundService.advertiseWifiDirectService(map)
    }
    @JavascriptInterface fun startWifiDirectServiceDiscovery() = NodeForegroundService.setWifiDirectServiceDiscovery(true)
    @JavascriptInterface fun refreshWifiDirectState() = withManager { it.refreshWifiDirectState() }
    @JavascriptInterface fun stopWifiDirectServiceDiscovery() = NodeForegroundService.setWifiDirectServiceDiscovery(false)
    @JavascriptInterface fun nearbyReadiness(): String = NodeForegroundService.nearbyReadiness().toString()
    /** Active Android path health, including NET_CAPABILITY_NOT_METERED. No SSID/location data. */
    @JavascriptInterface fun networkPathState(): String = NodeForegroundService.networkPathState().toString()
    /** Offline presence: `payloadHex` is the 8-byte BLE service-data payload built by JS. */
    @JavascriptInterface fun startBlePresence(payloadHex: String) {
        if (!payloadHex.matches(Regex("^[0-9a-f]{2,24}$")) || payloadHex.length % 2 != 0) return
        NodeForegroundService.startBlePresence(payloadHex.chunked(2).map { it.toInt(16).toByte() }.toByteArray())
    }
    @JavascriptInterface fun stopBlePresence() = NodeForegroundService.stopBlePresence()
    /** Wi-Fi Direct + BLE permissions for offline nearby, in one system prompt. */
    @JavascriptInterface fun requestOfflineNearbyPermission() = activity.requestOfflineNearbyPermission()
    /** Opens the system screen that fixes a readiness gap: "wifi" or "location". */
    @JavascriptInterface fun openNearbySettings(kind: String) = activity.openNearbySettings(kind)
    @JavascriptInterface fun startWifiDirect() = withManager { it.startWifiDirect() }
    @JavascriptInterface fun connectWifiDirect(deviceAddress: String) = withManager { it.connectWifiDirect(deviceAddress) }
    @JavascriptInterface fun requestWifiDirectPermission() = activity.requestWifiDirectPermission()
    @JavascriptInterface fun createWifiDirectGroup(networkName: String, passphrase: String) = withManager { it.createWifiDirectGroup(networkName, passphrase) }
    @JavascriptInterface fun joinWifiDirectGroup(networkName: String, passphrase: String, ownerDeviceAddress: String, frequencyMhz: Int) = withManager { it.joinWifiDirectGroup(networkName, passphrase, ownerDeviceAddress, frequencyMhz.coerceIn(0, 7125)) }
    @JavascriptInterface fun leaveWifiDirectGroup() = withManager { it.leaveWifiDirectGroup() }
    @JavascriptInterface fun wifiDirectState(): String = NodeForegroundService.wifiDirectState().toString()
    @JavascriptInterface fun startWifiAware() = withManager { manager ->
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) manager.startWifiAware() else onStatus("android-wifi-aware", "unsupported", "api-level")
    }
    @JavascriptInterface fun connectWifiAware(transportId: String, passphrase: String) = withManager { manager ->
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) manager.connectWifiAware(transportId, passphrase) else onStatus("android-wifi-aware-path", "unsupported", "api-level")
    }
    @JavascriptInterface fun startBle(seaPub: String) = withManager { it.startBle(seaPub) }
    @JavascriptInterface fun stop() = withManager { it.stop() }

    fun detach() {
        if (NodeForegroundService.nearbyListener === this) NodeForegroundService.nearbyListener = null
    }

    override fun onCandidate(source: String, transportId: String, endpoint: String?, capabilities: List<String>) = emit("iinpublic-nearby-candidate", JSONObject().apply {
        put("version", 1); put("source", source); put("transportId", transportId); put("endpoint", endpoint ?: JSONObject.NULL); put("capabilities", JSONArray(capabilities)); put("authenticated", false)
    })

    override fun onStatus(provider: String, state: String, reason: String?) = emit("iinpublic-nearby-status", JSONObject().apply {
        put("version", 1); put("provider", provider); put("state", state); put("reason", reason ?: JSONObject.NULL)
    })

    override fun onWifiDirectState(state: JSONObject) = emit("iinpublic-nearby-wifi-direct", state)

    override fun onWifiDirectPeers(peers: JSONArray) = emit("iinpublic-nearby-wd-peers", JSONObject().apply {
        put("version", 1); put("peers", peers)
    })

    override fun onBlePresence(payload: ByteArray, rssi: Int) = emit("iinpublic-nearby-ble", JSONObject().apply {
        put("version", 1); put("payload", payload.joinToString("") { "%02x".format(it) }); put("rssi", rssi)
    })

    override fun onWifiDirectService(deviceAddress: String, txt: Map<String, String>) = emit("iinpublic-nearby-wd-service", JSONObject().apply {
        put("version", 1); put("deviceAddress", deviceAddress); put("txt", JSONObject(txt))
    })

    fun permissionResult(grants: Map<String, Boolean>) = emit("iinpublic-nearby-permission", JSONObject().apply {
        put("version", 1); put("granted", grants.values.all { it }); put("results", JSONObject(grants))
    })

    private fun emit(name: String, detail: JSONObject) = activity.runOnUiThread {
        val eventName = JSONObject.quote(name); val json = detail.toString()
        webView.evaluateJavascript("window.dispatchEvent(new CustomEvent($eventName,{detail:$json}));", null)
    }
}
