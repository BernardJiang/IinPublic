package com.iinpublic.app

import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import android.util.Base64
import android.webkit.JavascriptInterface
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec

/**
 * Password-free identity custody backed by an Android Keystore AES-256-GCM key.
 * The key is non-exportable; ciphertext lives in app-private SharedPreferences. The public
 * identity is bound as GCM AAD so a record cannot be swapped between identities.
 */
class NativeCustodyBridge(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("iinpublic_identity_custody_v3", Context.MODE_PRIVATE)

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        return generate(strongBox = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P)
    }

    private fun generate(strongBox: Boolean): SecretKey {
        val spec = KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setKeySize(256)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true)
            .apply { if (strongBox && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) setIsStrongBoxBacked(true) }
            .build()
        return try {
            javax.crypto.KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE).apply { init(spec) }.generateKey()
        } catch (e: Exception) {
            if (strongBox) generate(strongBox = false) else throw e
        }
    }

    private fun hardwareBacked(key: SecretKey): Boolean? = try {
        val info = SecretKeyFactory.getInstance(key.algorithm, ANDROID_KEYSTORE).getKeySpec(key, KeyInfo::class.java) as KeyInfo
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) info.securityLevel != KeyProperties.SECURITY_LEVEL_SOFTWARE
        else @Suppress("DEPRECATION") info.isInsideSecureHardware
    } catch (e: Exception) { null }

    private fun ok() = JSONObject().put("ok", true).toString()
    private fun fail(reason: String) = JSONObject().put("ok", false).put("reason", reason).toString()

    private fun aad(pub: String, epub: String) = "iinpublic-custody-v3|$pub|$epub".toByteArray(Charsets.UTF_8)

    @JavascriptInterface fun describe(): String = try {
        JSONObject().put("version", 1).put("provider", "android-keystore").put("available", true)
            .put("hardwareBacked", hardwareBacked(key()) ?: JSONObject.NULL).toString()
    } catch (e: Exception) {
        JSONObject().put("version", 1).put("provider", "android-keystore").put("available", false).put("hardwareBacked", JSONObject.NULL).toString()
    }

    @JavascriptInterface fun read(): String = try { readUnchecked() } catch (e: Exception) {
        JSONObject().put("error", e.javaClass.simpleName).toString()
    }

    private fun readUnchecked(): String {
        val pub = prefs.getString("pub", null) ?: return JSONObject().put("pair", JSONObject.NULL).toString()
        val epub = prefs.getString("epub", null); val iv = prefs.getString("iv", null); val ct = prefs.getString("ct", null)
        if (epub == null || iv == null || ct == null) throw IllegalStateException("Corrupt custody record")
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
            init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)))
            updateAAD(aad(pub, epub))
        }
        val pair = JSONObject(String(cipher.doFinal(Base64.decode(ct, Base64.NO_WRAP)), Charsets.UTF_8))
        if (pair.getString("pub") != pub || pair.getString("epub") != epub) throw IllegalStateException("Custody identity mismatch")
        return JSONObject().put("pair", pair).toString()
    }

    @JavascriptInterface fun write(pairJson: String): String = try {
        val pair = JSONObject(pairJson)
        val pub = pair.getString("pub"); val epub = pair.getString("epub")
        listOf("priv", "epriv").forEach { require(pair.getString(it).isNotEmpty()) }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
            init(Cipher.ENCRYPT_MODE, key()); updateAAD(aad(pub, epub))
        }
        val ct = cipher.doFinal(pair.toString().toByteArray(Charsets.UTF_8))
        val committed = prefs.edit().putString("pub", pub).putString("epub", epub)
            .putString("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            .putString("ct", Base64.encodeToString(ct, Base64.NO_WRAP)).commit()
        if (!committed) fail("commit-failed")
        else {
            val back = JSONObject(readUnchecked()).getJSONObject("pair")
            if (listOf("pub", "epub", "priv", "epriv").all { back.getString(it) == pair.getString(it) }) ok() else fail("verify-failed")
        }
    } catch (e: Exception) { fail(e.javaClass.simpleName) }

    @JavascriptInterface fun remove(pub: String, epub: String): String {
        val stored = prefs.getString("pub", null) ?: return ok()
        if (stored != pub || prefs.getString("epub", null) != epub) return fail("identity-mismatch")
        return if (prefs.edit().clear().commit()) ok() else fail("commit-failed")
    }

    companion object {
        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        private const val ALIAS = "iinpublic-identity-custody-v3"
    }
}
