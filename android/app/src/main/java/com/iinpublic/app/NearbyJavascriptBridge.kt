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
    private val manager = NearbyConnectivityManager(activity, this)

    @JavascriptInterface fun capabilities(): String = manager.capabilities().toString()
    @JavascriptInterface fun requestPermissions() = activity.requestNearbyPermissions()
    @JavascriptInterface fun startNsd(port: Int) = activity.runOnUiThread { manager.startNsd(port.coerceIn(1, 65535)) }
    /** OPEN-36 offline mode: LAN discovery advertising this phone's rotating nearby id. */
    @JavascriptInterface fun startLanDiscovery(port: Int, nearbyId: String) = activity.runOnUiThread { manager.startNsd(port.coerceIn(1, 65535), nearbyId) }
    @JavascriptInterface fun stopLanDiscovery() = activity.runOnUiThread { manager.stopNsd() }
    @JavascriptInterface fun advertiseWifiDirectService(txtJson: String) = activity.runOnUiThread {
        val txt = runCatching { JSONObject(txtJson) }.getOrNull() ?: return@runOnUiThread
        val map = txt.keys().asSequence().filter { it.matches(Regex("^[a-z]{1,2}$")) }
            .associateWith { txt.optString(it).take(64) }
        manager.advertiseWifiDirectService(map)
    }
    @JavascriptInterface fun startWifiDirectServiceDiscovery() = activity.runOnUiThread { manager.startWifiDirectServiceDiscovery() }
    @JavascriptInterface fun refreshWifiDirectState() = activity.runOnUiThread { manager.refreshWifiDirectState() }
    @JavascriptInterface fun stopWifiDirectServiceDiscovery() = activity.runOnUiThread { manager.stopWifiDirectServiceDiscovery() }
    @JavascriptInterface fun nearbyReadiness(): String = manager.nearbyReadiness().toString()
    /** Offline presence: `payloadHex` is the 8-byte BLE service-data payload built by JS. */
    @JavascriptInterface fun startBlePresence(payloadHex: String) = activity.runOnUiThread {
        if (!payloadHex.matches(Regex("^[0-9a-f]{2,20}$")) || payloadHex.length % 2 != 0) return@runOnUiThread
        manager.startBlePresence(payloadHex.chunked(2).map { it.toInt(16).toByte() }.toByteArray())
    }
    @JavascriptInterface fun stopBlePresence() = activity.runOnUiThread { manager.stopBlePresence() }
    /** Wi-Fi Direct + BLE permissions for offline nearby, in one system prompt. */
    @JavascriptInterface fun requestOfflineNearbyPermission() = activity.requestOfflineNearbyPermission()
    /** Opens the system screen that fixes a readiness gap: "wifi" or "location". */
    @JavascriptInterface fun openNearbySettings(kind: String) = activity.openNearbySettings(kind)
    @JavascriptInterface fun startWifiDirect() = activity.runOnUiThread { manager.startWifiDirect() }
    @JavascriptInterface fun connectWifiDirect(deviceAddress: String) = activity.runOnUiThread { manager.connectWifiDirect(deviceAddress) }
    @JavascriptInterface fun requestWifiDirectPermission() = activity.requestWifiDirectPermission()
    @JavascriptInterface fun createWifiDirectGroup(networkName: String, passphrase: String) = activity.runOnUiThread { manager.createWifiDirectGroup(networkName, passphrase) }
    @JavascriptInterface fun joinWifiDirectGroup(networkName: String, passphrase: String, ownerDeviceAddress: String, frequencyMhz: Int) = activity.runOnUiThread { manager.joinWifiDirectGroup(networkName, passphrase, ownerDeviceAddress, frequencyMhz.coerceIn(0, 7125)) }
    @JavascriptInterface fun leaveWifiDirectGroup() = activity.runOnUiThread { manager.leaveWifiDirectGroup() }
    @JavascriptInterface fun wifiDirectState(): String = manager.wifiDirectState().toString()
    @JavascriptInterface fun startWifiAware() = activity.runOnUiThread {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) manager.startWifiAware() else onStatus("android-wifi-aware", "unsupported", "api-level")
    }
    @JavascriptInterface fun connectWifiAware(transportId: String, passphrase: String) = activity.runOnUiThread {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) manager.connectWifiAware(transportId, passphrase) else onStatus("android-wifi-aware-path", "unsupported", "api-level")
    }
    @JavascriptInterface fun startBle(seaPub: String) = activity.runOnUiThread { manager.startBle(seaPub) }
    @JavascriptInterface fun stop() = activity.runOnUiThread { manager.stop() }

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
