package com.iinpublic.app

import android.annotation.SuppressLint
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.wifi.WpsInfo
import android.net.wifi.p2p.WifiP2pConfig
import android.net.wifi.p2p.WifiP2pDevice
import android.net.wifi.p2p.WifiP2pGroup
import android.net.wifi.p2p.WifiP2pInfo
import android.net.wifi.p2p.WifiP2pManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.net.Inet4Address
import java.net.NetworkInterface

/**
 * Wi-Fi Direct group lifecycle for the hub-matchmade link upgrade (TODO OPEN-36).
 *
 * Everything is driven by the framework broadcasts, not by ActionListener.onSuccess — that only
 * means "request accepted": peers arrive via WIFI_P2P_PEERS_CHANGED_ACTION and group formation via
 * WIFI_P2P_CONNECTION_CHANGED_ACTION, after which requestConnectionInfo/requestGroupInfo are valid.
 *
 * Host: createGroup (Android 10+: with the caller's network name + passphrase; older: framework
 * generates them and they are read back from the formed group). Client: Android 10+ joins by name +
 * passphrase without the pairing prompt; older Android falls back to classic connect(deviceAddress)
 * negotiation, which prompts on the group owner.
 *
 * All calls run on the main thread (the JS bridge posts to the UI thread).
 */
class WifiDirectGroupController(
    private val context: Context,
    private val emitState: (JSONObject) -> Unit,
    private val onPeers: (List<WifiP2pDevice>) -> Unit = {},
    private val hasPermission: () -> Boolean,
) {
    companion object {
        /** Neither join path reports "gave up" (wpa_supplicant stops after ~30 s with no
         *  broadcast), so the controller fails the join itself. */
        private const val JOIN_TIMEOUT_MS = 35_000L
    }

    private val handler = Handler(Looper.getMainLooper())
    private val manager: WifiP2pManager? = context.getSystemService(WifiP2pManager::class.java)
    private var channel: WifiP2pManager.Channel? = null
    private var receiverRegistered = false

    private var state = "idle"
    private var reason: String? = null
    private var group: WifiP2pGroup? = null
    private var ownerIp: String? = null
    /** Legacy (< Android 10) join waits for the owner to appear in a peer scan. */
    private var pendingLegacyOwner: String? = null
    private var pendingJoinName: String? = null
    /** Android 10+ join retried once without the frequency hint (see joinTimeout). */
    private var pendingHintedJoin: Triple<String, String, String>? = null
    private val joinTimeout = Runnable {
        if (state == "joining") {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) channel?.let { manager?.cancelConnect(it, null) }
            val retry = pendingHintedJoin
            pendingHintedJoin = null
            if (retry != null) {
                // A wrong hint (owner reported a stale channel right after re-forming) makes the
                // supplicant scan only that channel and give up; a full scan still finds the group.
                joinGroup(retry.first, retry.second, retry.third, 0)
                return@Runnable
            }
            pendingLegacyOwner = null
            pendingJoinName = null
            setState("failed", "join-timeout")
        }
    }

    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context, intent: Intent) {
            when (intent.action) {
                WifiP2pManager.WIFI_P2P_STATE_CHANGED_ACTION -> {
                    val enabled = intent.getIntExtra(WifiP2pManager.EXTRA_WIFI_STATE, -1) == WifiP2pManager.WIFI_P2P_STATE_ENABLED
                    if (!enabled && state != "idle") { clearGroup(); setState("failed", "p2p-disabled") }
                }
                WifiP2pManager.WIFI_P2P_PEERS_CHANGED_ACTION -> refreshPeers()
                WifiP2pManager.WIFI_P2P_CONNECTION_CHANGED_ACTION -> refreshConnection()
            }
        }
    }

    fun isSupported(): Boolean = manager != null &&
        context.packageManager.hasSystemFeature(android.content.pm.PackageManager.FEATURE_WIFI_DIRECT)

    fun joinByCredentialSupported(): Boolean = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q

    fun stateJson(): JSONObject = JSONObject().apply {
        put("version", 1)
        put("state", state)
        reason?.let { put("reason", it) }
        val current = group
        if (current != null && (state == "owner" || state == "client")) {
            current.networkName?.let { put("networkName", it) }
            // The passphrase is exposed only to the owner, which hands it to SEA-verified peers
            // over the DTLS DataChannel; the framework returns it only to the owner anyway.
            if (state == "owner") current.passphrase?.let { put("passphrase", it) }
            // Android 10+ hides the real address from apps (02:00:00:00:00:00); never advertise that.
            current.owner?.deviceAddress?.lowercase()?.takeIf { it != "02:00:00:00:00:00" }?.let { put("ownerDeviceAddress", it) }
            groupFrequencyMhz(current).takeIf { it > 0 }?.let { put("frequencyMhz", it) }
            put("clientCount", current.clientList?.size ?: 0)
            ownerIp?.let { put("ownerIp", it) }
            localGroupIp(current)?.let { put("localIp", it) }
        }
    }

    @SuppressLint("MissingPermission")
    fun createGroup(networkName: String, passphrase: String) {
        val m = manager ?: return setState("failed", "unsupported")
        if (!hasPermission()) return setState("failed", "permission-denied")
        val ch = ensureChannel()
        setState("forming")
        val create = {
            val listener = actionListener("create")
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val config = WifiP2pConfig.Builder()
                    .setNetworkName(networkName)
                    .setPassphrase(passphrase)
                    .enablePersistentMode(false)
                    .setGroupOperatingBand(WifiP2pConfig.GROUP_OWNER_BAND_AUTO)
                    .build()
                m.createGroup(ch, config, listener)
            } else {
                m.createGroup(ch, listener)
            }
        }
        // createGroup fails with BUSY while any group exists; drop a stale one first.
        m.requestGroupInfo(ch) { existing ->
            if (existing == null) create() else m.removeGroup(ch, object : WifiP2pManager.ActionListener {
                override fun onSuccess() { handler.postDelayed({ create() }, 500) }
                override fun onFailure(code: Int) = create()
            })
        }
    }

    @SuppressLint("MissingPermission")
    fun joinGroup(networkName: String, passphrase: String, ownerDeviceAddress: String, frequencyMhz: Int) {
        val m = manager ?: return setState("failed", "unsupported")
        if (!hasPermission()) return setState("failed", "permission-denied")
        val ch = ensureChannel()
        pendingJoinName = networkName
        pendingHintedJoin = null
        setState("joining")
        handler.removeCallbacks(joinTimeout)
        handler.postDelayed(joinTimeout, JOIN_TIMEOUT_MS)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val builder = WifiP2pConfig.Builder()
                .setNetworkName(networkName)
                .setPassphrase(passphrase)
                .enablePersistentMode(false)
            // No setDeviceAddress: wpa_supplicant then matches the group by *BSSID*, and the owner's
            // P2P device address differs from its group-interface BSSID (Honor 8: …:53:53 vs
            // …:d3:53), so the join never finds the group. Name + frequency is enough.
            // For a client the frequency restricts the owner scan to one channel: <1 s when right,
            // never found when stale — joinTimeout then retries once with a full scan (~6 s).
            if (frequencyMhz > 0 && runCatching { builder.setGroupOperatingFrequency(frequencyMhz) }.isSuccess) {
                pendingHintedJoin = Triple(networkName, passphrase, ownerDeviceAddress)
            }
            val config = builder.build()
            // connect() fails BUSY while any group exists — including a stale client group Android
            // keeps after the owner removed it (seen on hardware). Drop it first, as createGroup does.
            m.requestGroupInfo(ch) { existing ->
                if (existing == null) m.connect(ch, config, actionListener("join"))
                else m.removeGroup(ch, object : WifiP2pManager.ActionListener {
                    override fun onSuccess() { handler.postDelayed({ m.connect(ch, config, actionListener("join")) }, 500) }
                    override fun onFailure(code: Int) = m.connect(ch, config, actionListener("join"))
                })
            }
            return
        }
        if (ownerDeviceAddress.isBlank()) return setState("failed", "legacy-join-needs-owner-address")
        pendingLegacyOwner = ownerDeviceAddress.lowercase()
        m.discoverPeers(ch, actionListener("discover"))
    }

    fun leaveGroup() {
        val m = manager ?: return
        // ensureChannel, not `channel ?: return`: a freshly started process has no channel yet but
        // the system may still hold the group this app formed before it was killed (seen on Honor 8).
        if (!hasPermission()) return
        val ch = ensureChannel()
        pendingLegacyOwner = null
        pendingJoinName = null
        pendingHintedJoin = null
        handler.removeCallbacks(joinTimeout)
        m.removeGroup(ch, object : WifiP2pManager.ActionListener {
            override fun onSuccess() { clearGroup(); setState("idle") }
            override fun onFailure(code: Int) { clearGroup(); setState("idle", "remove:$code") }
        })
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) m.cancelConnect(ch, null)
    }

    /** Peer discovery for the nearby candidate stream (results arrive via PEERS_CHANGED). */
    @SuppressLint("MissingPermission")
    fun discoverPeers(onResult: (Boolean, String?) -> Unit) {
        val m = manager ?: return onResult(false, "unsupported")
        if (!hasPermission()) return onResult(false, "permission-denied")
        m.discoverPeers(ensureChannel(), object : WifiP2pManager.ActionListener {
            override fun onSuccess() = onResult(true, null)
            override fun onFailure(code: Int) = onResult(false, code.toString())
        })
    }

    /** Classic negotiation with a discovered device (used by the legacy candidate path). */
    @SuppressLint("MissingPermission")
    fun connectLegacy(deviceAddress: String) {
        val m = manager ?: return setState("failed", "unsupported")
        if (!hasPermission()) return setState("failed", "permission-denied")
        setState("joining")
        val config = WifiP2pConfig().apply {
            this.deviceAddress = deviceAddress
            groupOwnerIntent = 0
            wps.setup = WpsInfo.PBC
        }
        m.connect(ensureChannel(), config, actionListener("connect"))
    }

    fun stop() {
        handler.removeCallbacks(joinTimeout)
        if (receiverRegistered) runCatching { context.unregisterReceiver(receiver) }
        receiverRegistered = false
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) channel?.close()
        channel = null
    }

    private fun ensureChannel(): WifiP2pManager.Channel {
        channel?.let { return it }
        val ch = manager!!.initialize(context, Looper.getMainLooper()) {
            channel = null
            if (state != "idle") { clearGroup(); setState("failed", "channel-lost") }
        }
        channel = ch
        if (!receiverRegistered) {
            val filter = IntentFilter().apply {
                addAction(WifiP2pManager.WIFI_P2P_STATE_CHANGED_ACTION)
                addAction(WifiP2pManager.WIFI_P2P_PEERS_CHANGED_ACTION)
                addAction(WifiP2pManager.WIFI_P2P_CONNECTION_CHANGED_ACTION)
            }
            ContextCompat.registerReceiver(context, receiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
            receiverRegistered = true
        }
        return ch
    }

    @SuppressLint("MissingPermission")
    private fun refreshPeers() {
        val m = manager ?: return
        val ch = channel ?: return
        if (!hasPermission()) return
        m.requestPeers(ch) { list ->
            val devices = list?.deviceList?.toList().orEmpty()
            onPeers(devices)
            val owner = pendingLegacyOwner ?: return@requestPeers
            if (devices.any { it.deviceAddress.equals(owner, ignoreCase = true) }) {
                pendingLegacyOwner = null
                connectLegacy(owner)
            }
        }
    }

    @SuppressLint("MissingPermission")
    private fun refreshConnection() {
        val m = manager ?: return
        val ch = channel ?: return
        m.requestConnectionInfo(ch) { info: WifiP2pInfo? ->
            if (info == null || !info.groupFormed) {
                // Not (or no longer) in a group. Formation in progress keeps its state.
                if (state == "owner" || state == "client") { clearGroup(); setState("idle", "group-removed") }
                return@requestConnectionInfo
            }
            if (!hasPermission()) return@requestConnectionInfo
            m.requestGroupInfo(ch) { formed ->
                if (formed == null) return@requestGroupInfo
                group = formed
                ownerIp = info.groupOwnerAddress?.hostAddress
                if (info.isGroupOwner) {
                    setState("owner")
                } else {
                    handler.removeCallbacks(joinTimeout)
                    pendingHintedJoin = null
                    val expected = pendingJoinName
                    pendingJoinName = null
                    setState("client", if (expected != null && expected != formed.networkName) "joined-unexpected-group" else null)
                }
            }
        }
    }

    private fun actionListener(step: String) = object : WifiP2pManager.ActionListener {
        override fun onSuccess() = Unit
        override fun onFailure(code: Int) {
            pendingLegacyOwner = null
            handler.removeCallbacks(joinTimeout)
            setState("failed", "$step:${failureName(code)}")
        }
    }

    private fun failureName(code: Int): String = when (code) {
        WifiP2pManager.P2P_UNSUPPORTED -> "unsupported"
        WifiP2pManager.BUSY -> "busy"
        WifiP2pManager.ERROR -> "error"
        else -> code.toString()
    }

    private fun clearGroup() {
        group = null
        ownerIp = null
    }

    private fun setState(next: String, why: String? = null) {
        state = next
        reason = why
        emitState(stateJson())
    }

    /** Android 10+ reports the group frequency. Older owners run the group on their station
     *  channel (single-channel concurrency), so the current Wi-Fi frequency is a good hint. */
    @Suppress("DEPRECATION")
    private fun groupFrequencyMhz(current: WifiP2pGroup): Int {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) return current.frequency
        if (state != "owner") return 0
        val wifi = context.applicationContext.getSystemService(android.net.wifi.WifiManager::class.java) ?: return 0
        return runCatching { wifi.connectionInfo?.frequency ?: 0 }.getOrDefault(0).coerceAtLeast(0)
    }

    private fun localGroupIp(current: WifiP2pGroup): String? {
        val name = current.`interface` ?: return null
        return runCatching {
            NetworkInterface.getByName(name)?.inetAddresses?.toList()
                ?.firstOrNull { it is Inet4Address && !it.isLoopbackAddress }?.hostAddress
        }.getOrNull()
    }
}
