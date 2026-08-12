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
    @JavascriptInterface fun startWifiDirect() = activity.runOnUiThread { manager.startWifiDirect() }
    @JavascriptInterface fun connectWifiDirect(deviceAddress: String) = activity.runOnUiThread { manager.connectWifiDirect(deviceAddress) }
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

    fun permissionResult(grants: Map<String, Boolean>) = emit("iinpublic-nearby-permission", JSONObject().apply {
        put("version", 1); put("granted", grants.values.all { it }); put("results", JSONObject(grants))
    })

    private fun emit(name: String, detail: JSONObject) = activity.runOnUiThread {
        val eventName = JSONObject.quote(name); val json = detail.toString()
        webView.evaluateJavascript("window.dispatchEvent(new CustomEvent($eventName,{detail:$json}));", null)
    }
}
