package com.iinpublic.app

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.aware.AttachCallback
import android.net.wifi.aware.DiscoverySession
import android.net.wifi.aware.DiscoverySessionCallback
import android.net.wifi.aware.PeerHandle
import android.net.wifi.aware.PublishConfig
import android.net.wifi.aware.SubscribeConfig
import android.net.wifi.aware.WifiAwareManager
import android.net.wifi.aware.WifiAwareNetworkSpecifier
import android.net.wifi.aware.WifiAwareSession
import android.net.wifi.p2p.WifiP2pDevice
import android.net.wifi.p2p.WifiP2pConfig
import android.net.wifi.p2p.WifiP2pManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import androidx.annotation.RequiresApi
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.security.MessageDigest
import java.util.UUID

/**
 * Open Android implementation of IinPublic's platform-adapter boundary.
 *
 * It uses only documented Android framework APIs. Discovery output is an
 * untrusted transport hint; JavaScript still requires a SEA-signed binding
 * before treating a candidate as a person or authorizing Gun synchronization.
 */
class NearbyConnectivityManager(
    private val context: Context,
    private val listener: Listener,
) {
    interface Listener {
        fun onCandidate(source: String, transportId: String, endpoint: String?, capabilities: List<String>)
        fun onStatus(provider: String, state: String, reason: String? = null)
    }

    companion object {
        const val SERVICE_NAME = "iinpublic-v1"
        const val NSD_TYPE = "_iinpublic._tcp."
        val BLE_SERVICE_UUID: UUID = UUID.fromString("7db78a2e-30f4-4e86-9fb7-33a318ea7e81")
    }

    private val handler = Handler(Looper.getMainLooper())
    private var awareSession: WifiAwareSession? = null
    private var awareDiscovery: DiscoverySession? = null
    private var requestedAwareNetwork: ConnectivityManager.NetworkCallback? = null
    private var nsdListener: NsdManager.DiscoveryListener? = null
    private var p2pChannel: WifiP2pManager.Channel? = null
    private var bleScanCallback: ScanCallback? = null
    private var bleAdvertiseCallback: AdvertiseCallback? = null
    private val awarePeers = mutableMapOf<String, PeerHandle>()

    fun capabilities(): JSONObject = JSONObject().apply {
        put("version", 1)
        put("vendorIndependent", true)
        put("googleNearbyRequired", false)
        put("wifiAware", Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && context.packageManager.hasSystemFeature(PackageManager.FEATURE_WIFI_AWARE))
        put("wifiDirect", context.packageManager.hasSystemFeature(PackageManager.FEATURE_WIFI_DIRECT))
        put("nsd", true)
        put("ble", context.packageManager.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE))
        put("bleDataTransport", false)
        put("ipfsOverBle", false)
    }

    fun startNsd(port: Int) {
        val manager = context.getSystemService(NsdManager::class.java)
        val registration = NsdServiceInfo().apply { serviceName = SERVICE_NAME; serviceType = NSD_TYPE; setPort(port) }
        manager.registerService(registration, NsdManager.PROTOCOL_DNS_SD, object : NsdManager.RegistrationListener {
            override fun onServiceRegistered(serviceInfo: NsdServiceInfo) = listener.onStatus("android-nsd", "running")
            override fun onRegistrationFailed(serviceInfo: NsdServiceInfo, errorCode: Int) = listener.onStatus("android-nsd", "failed", "registration:$errorCode")
            override fun onServiceUnregistered(serviceInfo: NsdServiceInfo) = listener.onStatus("android-nsd", "stopped")
            override fun onUnregistrationFailed(serviceInfo: NsdServiceInfo, errorCode: Int) = listener.onStatus("android-nsd", "failed", "unregistration:$errorCode")
        })
        nsdListener = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(serviceType: String) = listener.onStatus("android-nsd", "running")
            override fun onServiceFound(service: NsdServiceInfo) {
                if (service.serviceType == NSD_TYPE && service.serviceName != SERVICE_NAME) {
                    manager.resolveService(service, object : NsdManager.ResolveListener {
                        override fun onResolveFailed(info: NsdServiceInfo, errorCode: Int) = listener.onStatus("android-nsd", "degraded", "resolve:$errorCode")
                        @Suppress("DEPRECATION")
                        override fun onServiceResolved(info: NsdServiceInfo) = listener.onCandidate("mdns", info.serviceName, "http://${info.host.hostAddress}:${info.port}/gun", listOf("ip", "gun-websocket"))
                    })
                }
            }
            override fun onServiceLost(service: NsdServiceInfo) = Unit
            override fun onDiscoveryStopped(serviceType: String) = listener.onStatus("android-nsd", "stopped")
            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) = listener.onStatus("android-nsd", "failed", "start:$errorCode")
            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) = listener.onStatus("android-nsd", "failed", "stop:$errorCode")
        }.also { manager.discoverServices(NSD_TYPE, NsdManager.PROTOCOL_DNS_SD, it) }
    }

    @RequiresApi(Build.VERSION_CODES.O)
    fun startWifiAware() {
        if (!hasNearbyWifiPermission()) { listener.onStatus("android-wifi-aware", "permission-denied"); return }
        val manager = context.getSystemService(WifiAwareManager::class.java)
        if (!manager.isAvailable) { listener.onStatus("android-wifi-aware", "unavailable"); return }
        manager.attach(object : AttachCallback() {
            override fun onAttached(session: WifiAwareSession) {
                awareSession = session
                val callback = object : DiscoverySessionCallback() {
                    override fun onPublishStarted(session: android.net.wifi.aware.PublishDiscoverySession) { awareDiscovery = session; listener.onStatus("android-wifi-aware", "running") }
                    override fun onSubscribeStarted(session: android.net.wifi.aware.SubscribeDiscoverySession) { awareDiscovery = session; listener.onStatus("android-wifi-aware", "running") }
                    override fun onServiceDiscovered(peerHandle: PeerHandle, serviceSpecificInfo: ByteArray?, matchFilter: List<ByteArray>?) {
                        val id = "aware:${peerHandle.hashCode()}"; awarePeers[id] = peerHandle
                        listener.onCandidate("platform-nearby", id, null, listOf("wifi-aware", "ip-upgrade"))
                    }
                    override fun onSessionConfigFailed() = listener.onStatus("android-wifi-aware", "failed", "configuration")
                }
                session.publish(PublishConfig.Builder().setServiceName(SERVICE_NAME).build(), callback, handler)
                session.subscribe(SubscribeConfig.Builder().setServiceName(SERVICE_NAME).build(), callback, handler)
            }
            override fun onAttachFailed() = listener.onStatus("android-wifi-aware", "failed", "attach")
        }, handler)
    }

    @RequiresApi(Build.VERSION_CODES.O)
    fun requestWifiAwareIpPath(discoverySession: DiscoverySession, peer: PeerHandle, passphrase: String) {
        if (!hasNearbyWifiPermission()) { listener.onStatus("android-wifi-aware-path", "permission-denied"); return }
        val specifier = WifiAwareNetworkSpecifier.Builder(discoverySession, peer).setPskPassphrase(passphrase).build()
        val request = NetworkRequest.Builder().addTransportType(NetworkCapabilities.TRANSPORT_WIFI_AWARE).setNetworkSpecifier(specifier).build()
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) = listener.onCandidate("platform-nearby", "aware-network:${network.hashCode()}", "network-handle:${network.networkHandle}", listOf("wifi-aware", "ip", "gun-websocket"))
            override fun onUnavailable() = listener.onStatus("android-wifi-aware-path", "failed", "unavailable")
            override fun onLost(network: Network) = listener.onStatus("android-wifi-aware-path", "degraded", "lost")
        }
        requestedAwareNetwork = callback
        context.getSystemService(ConnectivityManager::class.java).requestNetwork(request, callback)
    }

    @RequiresApi(Build.VERSION_CODES.O)
    fun connectWifiAware(transportId: String, passphrase: String) {
        val session = awareDiscovery
        val peer = awarePeers[transportId]
        if (session == null || peer == null) { listener.onStatus("android-wifi-aware-path", "failed", "unknown-peer"); return }
        requestWifiAwareIpPath(session, peer, passphrase)
    }

    fun startWifiDirect() {
        if (!hasNearbyWifiPermission()) { listener.onStatus("android-wifi-direct", "permission-denied"); return }
        val manager = context.getSystemService(WifiP2pManager::class.java)
        val channel = manager.initialize(context, Looper.getMainLooper(), null).also { p2pChannel = it }
        manager.discoverPeers(channel, object : WifiP2pManager.ActionListener {
            override fun onSuccess() = listener.onStatus("android-wifi-direct", "running")
            override fun onFailure(reason: Int) = listener.onStatus("android-wifi-direct", "failed", reason.toString())
        })
        manager.requestPeers(channel) { peers -> peers.deviceList.forEach { device: WifiP2pDevice -> listener.onCandidate("platform-nearby", "wifi-direct:${device.deviceAddress}", null, listOf("wifi-direct", "ip-upgrade")) } }
        manager.requestGroupInfo(channel) { group -> group?.owner?.deviceAddress?.let { listener.onCandidate("platform-nearby", "wifi-direct:$it", if (group.isGroupOwner) "http://127.0.0.1:${NodeForegroundService.LOCAL_PORT}/gun" else null, listOf("wifi-direct", "temporary-gun-endpoint")) } }
    }

    fun connectWifiDirect(deviceAddress: String) {
        if (!hasNearbyWifiPermission()) { listener.onStatus("android-wifi-direct", "permission-denied"); return }
        val manager = context.getSystemService(WifiP2pManager::class.java)
        val channel = p2pChannel ?: manager.initialize(context, Looper.getMainLooper(), null).also { p2pChannel = it }
        manager.connect(channel, WifiP2pConfig().apply { this.deviceAddress = deviceAddress }, object : WifiP2pManager.ActionListener {
            override fun onSuccess() = manager.requestConnectionInfo(channel) { info ->
                val host = info.groupOwnerAddress?.hostAddress
                listener.onCandidate("platform-nearby", "wifi-direct:$deviceAddress", host?.let { "http://$it:${NodeForegroundService.LOCAL_PORT}/gun" }, listOf("wifi-direct", "ip", "temporary-gun-endpoint"))
            }
            override fun onFailure(reason: Int) = listener.onStatus("android-wifi-direct", "failed", "connect:$reason")
        })
    }

    fun startBle(seaPub: String) {
        if (!hasBluetoothPermission()) { listener.onStatus("android-ble", "permission-denied"); return }
        val adapter = context.getSystemService(android.bluetooth.BluetoothManager::class.java).adapter
        if (adapter?.isEnabled != true) { listener.onStatus("android-ble", "unavailable", "disabled"); return }
        val rotatingId = rotatingDiscoveryId(seaPub)
        val parcelUuid = ParcelUuid(BLE_SERVICE_UUID)
        bleAdvertiseCallback = object : AdvertiseCallback() {
            override fun onStartSuccess(settingsInEffect: AdvertiseSettings) = listener.onStatus("android-ble", "running")
            override fun onStartFailure(errorCode: Int) = listener.onStatus("android-ble", "degraded", "advertise:$errorCode")
        }.also { callback -> adapter.bluetoothLeAdvertiser?.startAdvertising(AdvertiseSettings.Builder().setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_POWER).setConnectable(false).build(), AdvertiseData.Builder().addServiceUuid(parcelUuid).addServiceData(parcelUuid, rotatingId.toByteArray()).build(), callback) }
        bleScanCallback = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult) {
                val bytes = result.scanRecord?.getServiceData(parcelUuid) ?: return
                listener.onCandidate("platform-nearby", "ble:${bytes.decodeToString()}", null, listOf("ble-discovery", "upgrade-required"))
            }
            override fun onScanFailed(errorCode: Int) = listener.onStatus("android-ble", "degraded", "scan:$errorCode")
        }.also { callback -> adapter.bluetoothLeScanner?.startScan(listOf(ScanFilter.Builder().setServiceUuid(parcelUuid).build()), ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_POWER).build(), callback) }
    }

    fun stop() {
        awareDiscovery?.close(); awareDiscovery = null; awareSession?.close(); awareSession = null; awarePeers.clear()
        requestedAwareNetwork?.let { runCatching { context.getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(it) } }; requestedAwareNetwork = null
        nsdListener?.let { runCatching { context.getSystemService(NsdManager::class.java).stopServiceDiscovery(it) } }; nsdListener = null
        val adapter: BluetoothAdapter? = context.getSystemService(android.bluetooth.BluetoothManager::class.java).adapter
        bleScanCallback?.let { runCatching { adapter?.bluetoothLeScanner?.stopScan(it) } }; bleScanCallback = null
        bleAdvertiseCallback?.let { runCatching { adapter?.bluetoothLeAdvertiser?.stopAdvertising(it) } }; bleAdvertiseCallback = null
    }

    private fun hasNearbyWifiPermission(): Boolean = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || ContextCompat.checkSelfPermission(context, Manifest.permission.NEARBY_WIFI_DEVICES) == PackageManager.PERMISSION_GRANTED
    private fun hasBluetoothPermission(): Boolean = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || (ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED && ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_ADVERTISE) == PackageManager.PERMISSION_GRANTED)
    private fun rotatingDiscoveryId(seaPub: String): String {
        val epoch = System.currentTimeMillis() / (15 * 60_000)
        return MessageDigest.getInstance("SHA-256").digest("$seaPub:$epoch".toByteArray()).take(12).joinToString("") { "%02x".format(it) }
    }
}
