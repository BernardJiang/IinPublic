package com.iinpublic.app

import android.bluetooth.BluetoothAdapter
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertisingSet
import android.bluetooth.le.AdvertisingSetCallback
import android.bluetooth.le.AdvertisingSetParameters
import android.os.ParcelUuid
import androidx.annotation.RequiresApi

/**
 * Android 8+: the BLE presence advertisement as one advertising set whose data is replaced in
 * place when the rotating id changes, instead of stopping and starting the advertiser each time
 * (OPEN-99: the C10's Bluetooth stack aborted on vendor asserts, twice while advertising was being
 * switched on; a P30 restarted its advertiser 26 times in 31 minutes). Same air format as the
 * legacy advertiser: legacy PDU, not connectable, ~250 ms interval, medium power.
 *
 * Loaded by name only on API 26+ (`NearbyConnectivityManager.loadPresenceAdvertisingSet`): Android
 * 7's verifier would reject the manager if it named these types.
 */
@RequiresApi(26)
class BlePresenceAdvertisingSet(private val events: BlePresenceAdvertiser.Events) : BlePresenceAdvertiser {
    private var adapter: BluetoothAdapter? = null
    private var uuid: ParcelUuid? = null
    private var callback: AdvertisingSetCallback? = null
    private var set: AdvertisingSet? = null
    /** The payload to show: applied when the set has started, if it changed while starting. */
    private var payload: ByteArray? = null
    private var shown: ByteArray? = null

    override val active: Boolean get() = callback != null

    private fun data(uuid: ParcelUuid, payload: ByteArray): AdvertiseData =
        AdvertiseData.Builder().setIncludeDeviceName(false).addServiceData(uuid, payload).build()

    override fun start(adapter: BluetoothAdapter, uuid: ParcelUuid, payload: ByteArray) {
        stop(adapter)
        val advertiser = adapter.bluetoothLeAdvertiser ?: run { events.failed("advertise:no-advertiser"); return }
        this.adapter = adapter
        this.uuid = uuid
        this.payload = payload.copyOf()
        this.shown = payload.copyOf()
        val parameters = AdvertisingSetParameters.Builder()
            .setLegacyMode(true)
            .setConnectable(false)
            .setScannable(false)
            .setInterval(AdvertisingSetParameters.INTERVAL_MEDIUM)
            .setTxPowerLevel(AdvertisingSetParameters.TX_POWER_MEDIUM)
            .build()
        val started = object : AdvertisingSetCallback() {
            override fun onAdvertisingSetStarted(advertisingSet: AdvertisingSet?, txPower: Int, status: Int) {
                if (callback !== this) return
                if (status != ADVERTISE_SUCCESS || advertisingSet == null) {
                    clear()
                    events.failed("advertise:$status")
                    return
                }
                set = advertisingSet
                events.running()
                applyLatest()
            }

            override fun onAdvertisingDataSet(advertisingSet: AdvertisingSet?, status: Int) {
                if (callback !== this || status == ADVERTISE_SUCCESS) return
                // The update was refused: start over with the latest payload (the old way).
                val latest = this@BlePresenceAdvertisingSet.payload ?: return
                val a = this@BlePresenceAdvertisingSet.adapter ?: return
                val u = this@BlePresenceAdvertisingSet.uuid ?: return
                events.restarted("data:$status")
                start(a, u, latest)
            }

            override fun onAdvertisingSetStopped(advertisingSet: AdvertisingSet?) {
                if (callback === this) clear()
            }
        }
        callback = started
        runCatching { advertiser.startAdvertisingSet(parameters, data(uuid, payload), null, null, null, started) }
            .onFailure { error -> clear(); events.failed("advertise:${error.javaClass.simpleName}") }
    }

    override fun update(payload: ByteArray) {
        this.payload = payload.copyOf()
        applyLatest()
    }

    private fun applyLatest() {
        val s = set ?: return // still starting: applied once started
        val latest = payload ?: return
        val u = uuid ?: return
        if (shown?.contentEquals(latest) == true) return
        shown = latest.copyOf()
        runCatching { s.setAdvertisingData(data(u, latest)) }
    }

    override fun stop(adapter: BluetoothAdapter?) {
        val running = callback ?: return
        clear()
        runCatching { (adapter ?: this.adapter)?.bluetoothLeAdvertiser?.stopAdvertisingSet(running) }
    }

    private fun clear() {
        callback = null
        set = null
        shown = null
    }
}
