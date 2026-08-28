package com.iinpublic.app

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.wifi.aware.AttachCallback
import android.net.wifi.aware.DiscoverySession
import android.net.wifi.aware.DiscoverySessionCallback
import android.net.wifi.aware.PeerHandle
import android.net.wifi.aware.PublishConfig
import android.net.wifi.aware.SubscribeConfig
import android.net.wifi.aware.WifiAwareManager
import android.net.wifi.aware.WifiAwareNetworkSpecifier
import android.net.wifi.aware.WifiAwareSession
import android.os.Build
import android.os.Handler
import androidx.annotation.RequiresApi
import androidx.core.content.ContextCompat

/**
 * Android 8+ implementation kept in its own class so Android 7 never verifies Wi-Fi Aware types.
 * NearbyConnectivityManager loads this provider reflectively only after checking SDK_INT.
 */
@RequiresApi(Build.VERSION_CODES.O)
internal class WifiAwareConnectivityProvider(
    private val context: Context,
    private val listener: NearbyConnectivityManager.Listener,
    private val handler: Handler,
) : WifiAwareProvider {
    private var awareSession: WifiAwareSession? = null
    private var awareDiscovery: DiscoverySession? = null
    private var requestedNetwork: ConnectivityManager.NetworkCallback? = null
    private val peers = mutableMapOf<String, PeerHandle>()

    override fun start() {
        if (!hasNearbyWifiPermission()) {
            listener.onStatus("android-wifi-aware", "permission-denied")
            return
        }
        val manager = context.getSystemService(WifiAwareManager::class.java)
        if (!manager.isAvailable) {
            listener.onStatus("android-wifi-aware", "unavailable")
            return
        }
        manager.attach(object : AttachCallback() {
            override fun onAttached(session: WifiAwareSession) {
                awareSession = session
                val callback = object : DiscoverySessionCallback() {
                    override fun onPublishStarted(session: android.net.wifi.aware.PublishDiscoverySession) {
                        awareDiscovery = session
                        listener.onStatus("android-wifi-aware", "running")
                    }

                    override fun onSubscribeStarted(session: android.net.wifi.aware.SubscribeDiscoverySession) {
                        awareDiscovery = session
                        listener.onStatus("android-wifi-aware", "running")
                    }

                    override fun onServiceDiscovered(
                        peerHandle: PeerHandle,
                        serviceSpecificInfo: ByteArray?,
                        matchFilter: List<ByteArray>?,
                    ) {
                        val id = "aware:${peerHandle.hashCode()}"
                        peers[id] = peerHandle
                        listener.onCandidate("platform-nearby", id, null, listOf("wifi-aware", "ip-upgrade"))
                    }

                    override fun onSessionConfigFailed() =
                        listener.onStatus("android-wifi-aware", "failed", "configuration")
                }
                session.publish(
                    PublishConfig.Builder().setServiceName(NearbyConnectivityManager.SERVICE_NAME).build(),
                    callback,
                    handler,
                )
                session.subscribe(
                    SubscribeConfig.Builder().setServiceName(NearbyConnectivityManager.SERVICE_NAME).build(),
                    callback,
                    handler,
                )
            }

            override fun onAttachFailed() = listener.onStatus("android-wifi-aware", "failed", "attach")
        }, handler)
    }

    override fun connect(transportId: String, passphrase: String) {
        val session = awareDiscovery
        val peer = peers[transportId]
        if (session == null || peer == null) {
            listener.onStatus("android-wifi-aware-path", "failed", "unknown-peer")
            return
        }
        requestIpPath(session, peer, passphrase)
    }

    override fun stop() {
        awareDiscovery?.close()
        awareDiscovery = null
        awareSession?.close()
        awareSession = null
        peers.clear()
        requestedNetwork?.let { callback ->
            runCatching { context.getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(callback) }
        }
        requestedNetwork = null
    }

    private fun requestIpPath(discoverySession: DiscoverySession, peer: PeerHandle, passphrase: String) {
        if (!hasNearbyWifiPermission()) {
            listener.onStatus("android-wifi-aware-path", "permission-denied")
            return
        }
        val specifier = WifiAwareNetworkSpecifier.Builder(discoverySession, peer)
            .setPskPassphrase(passphrase)
            .build()
        val request = NetworkRequest.Builder()
            .addTransportType(NetworkCapabilities.TRANSPORT_WIFI_AWARE)
            .setNetworkSpecifier(specifier)
            .build()
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) = listener.onCandidate(
                "platform-nearby",
                "aware-network:${network.hashCode()}",
                "network-handle:${network.networkHandle}",
                listOf("wifi-aware", "ip", "gun-websocket"),
            )

            override fun onUnavailable() = listener.onStatus("android-wifi-aware-path", "failed", "unavailable")
            override fun onLost(network: Network) = listener.onStatus("android-wifi-aware-path", "degraded", "lost")
        }
        requestedNetwork = callback
        context.getSystemService(ConnectivityManager::class.java).requestNetwork(request, callback)
    }

    private fun hasNearbyWifiPermission(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.NEARBY_WIFI_DEVICES) ==
            PackageManager.PERMISSION_GRANTED
}
