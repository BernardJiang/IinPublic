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
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.p2p.WifiP2pDevice
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.net.Inet4Address
import java.security.MessageDigest
import java.util.UUID

/** API-neutral boundary implemented by the Android 8+ Wi-Fi Aware provider. */
internal interface WifiAwareProvider {
    fun start()
    fun connect(transportId: String, passphrase: String)
    fun stop()
}

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
        fun onWifiDirectState(state: JSONObject) = Unit
        fun onWifiDirectService(deviceAddress: String, txt: Map<String, String>) = Unit
        fun onBlePresence(payload: ByteArray, rssi: Int) = Unit
        /** Wi-Fi P2P peer scan results (address, group-owner flag, primary device type) — no names. */
        fun onWifiDirectPeers(peers: org.json.JSONArray) = Unit
    }

    companion object {
        const val SERVICE_NAME = "iinpublic-v1"
        const val NSD_TYPE = "_iinpublic._tcp."
        val BLE_SERVICE_UUID: UUID = UUID.fromString("7db78a2e-30f4-4e86-9fb7-33a318ea7e81")
    }

    private val handler = Handler(Looper.getMainLooper())
    private var wifiAwareProvider: WifiAwareProvider? = null
    private var nsdListener: NsdManager.DiscoveryListener? = null
    private var nsdRegistration: NsdManager.RegistrationListener? = null
    private var nsdRegisteredName: String? = null
    private val resolveQueue = ArrayDeque<NsdServiceInfo>()
    private var resolving = false
    private val wifiDirect = WifiDirectGroupController(
        context,
        emitState = { listener.onWifiDirectState(it) },
        onPeers = { devices ->
            devices.forEach { device: WifiP2pDevice ->
                listener.onCandidate("platform-nearby", "wifi-direct:${device.deviceAddress}", null, listOf("wifi-direct", "ip-upgrade"))
            }
            listener.onWifiDirectPeers(org.json.JSONArray().apply {
                devices.forEach { device ->
                    put(JSONObject().apply {
                        put("address", device.deviceAddress.orEmpty())
                        put("groupOwner", device.isGroupOwner)
                        put("type", device.primaryDeviceType.orEmpty())
                    })
                }
            })
        },
        hasPermission = { hasNearbyWifiPermission() },
        onServiceRecord = { address, txt -> listener.onWifiDirectService(address, txt) },
    )
    private var bleScanCallback: ScanCallback? = null
    private var bleAdvertiseCallback: AdvertiseCallback? = null

    fun capabilities(): JSONObject = JSONObject().apply {
        put("version", 1)
        put("vendorIndependent", true)
        put("googleNearbyRequired", false)
        put("wifiAware", Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && context.packageManager.hasSystemFeature(PackageManager.FEATURE_WIFI_AWARE))
        put("wifiDirect", wifiDirect.isSupported())
        put("wifiDirectJoinByCredential", wifiDirect.joinByCredentialSupported())
        put("hostScore", hostScore())
        put("nsd", true)
        put("ble", context.packageManager.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE))
        put("bleDataTransport", false)
        put("ipfsOverBle", false)
    }

    /**
     * LAN discovery of other phones' embedded nodes (OPEN-36 offline mode). Each phone registers a
     * unique service name and carries its rotating nearby id in the TXT record; resolves run one at
     * a time (Android < 14 rejects a second concurrent resolve with FAILURE_ALREADY_ACTIVE).
     */
    fun startNsd(port: Int, nearbyId: String = "") {
        stopNsd()
        val manager = context.getSystemService(NsdManager::class.java)
        val suffix = nearbyId.takeIf { it.matches(Regex("^[0-9a-f]{12}$")) } ?: UUID.randomUUID().toString().replace("-", "").take(12)
        val registration = NsdServiceInfo().apply {
            serviceName = "$SERVICE_NAME-$suffix"; serviceType = NSD_TYPE; setPort(port)
            if (nearbyId.isNotEmpty()) setAttribute("id", nearbyId)
            setAttribute("v", "1")
        }
        nsdRegisteredName = registration.serviceName
        nsdRegistration = object : NsdManager.RegistrationListener {
            // The framework may rename on conflict; remember the final name so we skip ourselves.
            override fun onServiceRegistered(serviceInfo: NsdServiceInfo) { nsdRegisteredName = serviceInfo.serviceName; listener.onStatus("android-nsd", "running") }
            override fun onRegistrationFailed(serviceInfo: NsdServiceInfo, errorCode: Int) = listener.onStatus("android-nsd", "failed", "registration:$errorCode")
            override fun onServiceUnregistered(serviceInfo: NsdServiceInfo) = listener.onStatus("android-nsd", "stopped")
            override fun onUnregistrationFailed(serviceInfo: NsdServiceInfo, errorCode: Int) = listener.onStatus("android-nsd", "failed", "unregistration:$errorCode")
        }.also { manager.registerService(registration, NsdManager.PROTOCOL_DNS_SD, it) }
        nsdListener = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(serviceType: String) = listener.onStatus("android-nsd", "running")
            override fun onServiceFound(service: NsdServiceInfo) {
                if (!service.serviceType.startsWith("_iinpublic._tcp")) return
                if (!service.serviceName.startsWith(SERVICE_NAME) || service.serviceName == nsdRegisteredName) return
                handler.post { enqueueResolve(manager, service) }
            }
            override fun onServiceLost(service: NsdServiceInfo) = Unit
            override fun onDiscoveryStopped(serviceType: String) = listener.onStatus("android-nsd", "stopped")
            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) = listener.onStatus("android-nsd", "failed", "start:$errorCode")
            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) = listener.onStatus("android-nsd", "failed", "stop:$errorCode")
        }.also { manager.discoverServices(NSD_TYPE, NsdManager.PROTOCOL_DNS_SD, it) }
    }

    private fun isOwnAddress(address: Inet4Address): Boolean = runCatching {
        java.net.NetworkInterface.getNetworkInterfaces()?.toList().orEmpty()
            .any { iface -> iface.inetAddresses.toList().any { it == address } }
    }.getOrDefault(false)

    fun stopNsd() {
        val manager = context.getSystemService(NsdManager::class.java)
        nsdListener?.let { runCatching { manager.stopServiceDiscovery(it) } }; nsdListener = null
        nsdRegistration?.let { runCatching { manager.unregisterService(it) } }; nsdRegistration = null
        resolveQueue.clear(); resolving = false
    }

    private fun enqueueResolve(manager: NsdManager, service: NsdServiceInfo) {
        if (resolveQueue.none { it.serviceName == service.serviceName }) resolveQueue.addLast(service)
        resolveNext(manager)
    }

    private fun resolveNext(manager: NsdManager) {
        if (resolving) return
        val next = resolveQueue.removeFirstOrNull() ?: return
        resolving = true
        @Suppress("DEPRECATION")
        manager.resolveService(next, object : NsdManager.ResolveListener {
            override fun onResolveFailed(info: NsdServiceInfo, errorCode: Int) {
                handler.post {
                    resolving = false
                    listener.onStatus("android-nsd", "degraded", "resolve:$errorCode")
                    resolveNext(manager)
                }
            }
            override fun onServiceResolved(info: NsdServiceInfo) { handler.post {
                resolving = false
                val address = (info.host as? Inet4Address)
                    ?: if (Build.VERSION.SDK_INT >= 34) info.hostAddresses.firstOrNull { it is Inet4Address } as? Inet4Address else null
                // Never ourselves: a registration from an earlier process of this app (older rotating
                // id, same address) lingers in the mDNS cache after a restart or reinstall.
                if (address != null && !isOwnAddress(address)) {
                    // Android 14 resolves have come back without TXT attributes; the id is also the
                    // service-name suffix (`iinpublic-v1-<id>`).
                    val idPattern = Regex("^[0-9a-f]{12}$")
                    val id = info.attributes["id"]?.decodeToString()?.takeIf { it.matches(idPattern) }
                        ?: info.serviceName.substringAfterLast('-').takeIf { it.matches(idPattern) }
                        ?: info.serviceName
                    listener.onCandidate("mdns", id, "http://${address.hostAddress}:${info.port}/gun", listOf("ip", "gun-websocket"))
                }
                resolveNext(manager)
            } }
        })
    }

    fun startWifiAware() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            listener.onStatus("android-wifi-aware", "unsupported", "api-level")
            return
        }
        loadWifiAwareProvider()?.start()
    }

    fun connectWifiAware(transportId: String, passphrase: String) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            listener.onStatus("android-wifi-aware-path", "unsupported", "api-level")
            return
        }
        loadWifiAwareProvider()?.connect(transportId, passphrase)
    }

    /** Peer scan; devices are reported from WIFI_P2P_PEERS_CHANGED_ACTION, not right after the request. */
    fun startWifiDirect() {
        wifiDirect.discoverPeers { ok, reason ->
            if (ok) listener.onStatus("android-wifi-direct", "running")
            else listener.onStatus("android-wifi-direct", if (reason == "permission-denied") "permission-denied" else "failed", reason)
        }
    }

    /** Classic negotiation with a scanned device; the outcome arrives as a Wi-Fi Direct state event. */
    fun connectWifiDirect(deviceAddress: String) = wifiDirect.connectLegacy(deviceAddress)

    fun createWifiDirectGroup(networkName: String, passphrase: String) = wifiDirect.createGroup(networkName, passphrase)
    fun joinWifiDirectGroup(networkName: String, passphrase: String, ownerDeviceAddress: String, frequencyMhz: Int) =
        wifiDirect.joinGroup(networkName, passphrase, ownerDeviceAddress, frequencyMhz)
    fun leaveWifiDirectGroup() = wifiDirect.leaveGroup()
    fun advertiseWifiDirectService(txt: Map<String, String>) = wifiDirect.advertiseService(txt)
    fun startWifiDirectServiceDiscovery() = wifiDirect.startServiceDiscovery()
    fun refreshWifiDirectState() = wifiDirect.refresh()
    fun stopWifiDirectServiceDiscovery() = wifiDirect.stopServiceDiscovery()

    /**
     * What offline Wi-Fi Direct still needs from the user: the runtime permission, Wi-Fi switched on
     * (the P2P radio rides on it), and on Android 8–12 Location switched on — without it peer and
     * service discovery silently return nothing.
     */
    fun nearbyReadiness(): JSONObject = JSONObject().apply {
        put("version", 1)
        put("permission", hasNearbyWifiPermission())
        val wifi = context.applicationContext.getSystemService(android.net.wifi.WifiManager::class.java)
        put("wifiEnabled", wifi?.isWifiEnabled == true)
        val needsLocation = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
        val location = context.getSystemService(android.location.LocationManager::class.java)
        val locationOn = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) location?.isLocationEnabled == true
            else location?.isProviderEnabled(android.location.LocationManager.NETWORK_PROVIDER) == true || location?.isProviderEnabled(android.location.LocationManager.GPS_PROVIDER) == true
        put("locationRequired", needsLocation)
        put("locationEnabled", !needsLocation || locationOn)
        put("wifiDirect", wifiDirect.isSupported())
        put("joinByCredential", wifiDirect.joinByCredentialSupported())
        put("bluetoothPermission", hasBluetoothPermission())
        put("bluetoothEnabled", context.getSystemService(android.bluetooth.BluetoothManager::class.java)?.adapter?.isEnabled == true)
        put("ble", context.packageManager.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE))
        put("sdk", Build.VERSION.SDK_INT)
    }
    fun wifiDirectState(): JSONObject = wifiDirect.stateJson()

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

    // ── OPEN-36 offline presence over BLE ──────────────────────────────────────────────────────
    // Wi-Fi Direct DNS-SD proved unreliable on hardware (queries time out while the peer is off
    // channel serving its access point), so phones announce themselves over BLE instead and use
    // Wi-Fi Direct only as the IP link. Legacy advertising leaves 10 bytes of service data next to
    // a 128-bit UUID; the payload is 8: version, 6-byte rotating id, flags.

    private var presenceAdvertiseCallback: AdvertiseCallback? = null
    private var presenceScanCallback: ScanCallback? = null

    fun startBlePresence(payload: ByteArray) {
        if (!hasBluetoothPermission()) { listener.onStatus("android-ble-presence", "permission-denied"); return }
        val adapter = context.getSystemService(android.bluetooth.BluetoothManager::class.java)?.adapter
        if (adapter?.isEnabled != true) { listener.onStatus("android-ble-presence", "unavailable", "disabled"); return }
        val parcelUuid = ParcelUuid(BLE_SERVICE_UUID)
        presenceAdvertiseCallback?.let { runCatching { adapter.bluetoothLeAdvertiser?.stopAdvertising(it) } }
        presenceAdvertiseCallback = object : AdvertiseCallback() {
            override fun onStartSuccess(settingsInEffect: AdvertiseSettings) = listener.onStatus("android-ble-presence", "running")
            override fun onStartFailure(errorCode: Int) = listener.onStatus("android-ble-presence", "degraded", "advertise:$errorCode")
        }.also { callback ->
            adapter.bluetoothLeAdvertiser?.startAdvertising(
                AdvertiseSettings.Builder().setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY).setConnectable(false).build(),
                AdvertiseData.Builder().setIncludeDeviceName(false).addServiceData(parcelUuid, payload).build(),
                callback,
            )
        }
        if (presenceScanCallback != null) return
        presenceScanCallback = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult) {
                val bytes = result.scanRecord?.getServiceData(parcelUuid) ?: return
                listener.onBlePresence(bytes, result.rssi)
            }
            override fun onBatchScanResults(results: MutableList<ScanResult>) = results.forEach { onScanResult(0, it) }
            override fun onScanFailed(errorCode: Int) = listener.onStatus("android-ble-presence", "degraded", "scan:$errorCode")
        }.also { callback ->
            adapter.bluetoothLeScanner?.startScan(
                listOf(ScanFilter.Builder().setServiceData(parcelUuid, null).build()),
                ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(),
                callback,
            )
        }
    }

    fun stopBlePresence() {
        val adapter = context.getSystemService(android.bluetooth.BluetoothManager::class.java)?.adapter
        presenceAdvertiseCallback?.let { runCatching { adapter?.bluetoothLeAdvertiser?.stopAdvertising(it) } }; presenceAdvertiseCallback = null
        presenceScanCallback?.let { runCatching { adapter?.bluetoothLeScanner?.stopScan(it) } }; presenceScanCallback = null
    }

    fun stop() {
        stopBlePresence()
        wifiDirect.stopServiceDiscovery(); wifiDirect.leaveGroup(); wifiDirect.stop()
        wifiAwareProvider?.stop(); wifiAwareProvider = null
        stopNsd()
        val adapter: BluetoothAdapter? = context.getSystemService(android.bluetooth.BluetoothManager::class.java).adapter
        bleScanCallback?.let { runCatching { adapter?.bluetoothLeScanner?.stopScan(it) } }; bleScanCallback = null
        bleAdvertiseCallback?.let { runCatching { adapter?.bluetoothLeAdvertiser?.stopAdvertising(it) } }; bleAdvertiseCallback = null
    }

    /**
     * Android 7's verifier resolves framework types mentioned by a loaded class even when every
     * call is guarded by an SDK check. Keep the base manager free of android.net.wifi.aware types
     * and resolve the API-26 implementation by name only after the runtime gate.
     */
    private fun loadWifiAwareProvider(): WifiAwareProvider? {
        wifiAwareProvider?.let { return it }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return null
        return runCatching {
            val providerClass = Class.forName("com.iinpublic.app.WifiAwareConnectivityProvider")
            val constructor = providerClass.getDeclaredConstructor(
                Context::class.java,
                Listener::class.java,
                Handler::class.java,
            )
            constructor.newInstance(context, listener, handler) as WifiAwareProvider
        }.onFailure { error ->
            listener.onStatus("android-wifi-aware", "failed", "provider-load:${error.javaClass.simpleName}")
        }.getOrNull()?.also { wifiAwareProvider = it }
    }

    /** Android 13+: NEARBY_WIFI_DEVICES. Older: Wi-Fi Direct scan/group APIs require fine location. */
    private fun hasNearbyWifiPermission(): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) ContextCompat.checkSelfPermission(context, Manifest.permission.NEARBY_WIFI_DEVICES) == PackageManager.PERMISSION_GRANTED
        else ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
    /** Host preference for Wi-Fi Direct election: charging +2, battery ≥ 50% +1. */
    private fun hostScore(): Int {
        val battery = context.getSystemService(android.os.BatteryManager::class.java) ?: return 0
        val charging = battery.isCharging
        val capacity = battery.getIntProperty(android.os.BatteryManager.BATTERY_PROPERTY_CAPACITY)
        return (if (charging) 2 else 0) + (if (capacity >= 50) 1 else 0)
    }
    private fun hasBluetoothPermission(): Boolean = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || (ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED && ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_ADVERTISE) == PackageManager.PERMISSION_GRANTED)
    private fun rotatingDiscoveryId(seaPub: String): String {
        val epoch = System.currentTimeMillis() / (15 * 60_000)
        return MessageDigest.getInstance("SHA-256").digest("$seaPub:$epoch".toByteArray()).take(12).joinToString("") { "%02x".format(it) }
    }
}
