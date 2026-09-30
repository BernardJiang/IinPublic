package com.iinpublic.app

import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.webkit.JavascriptInterface
import org.json.JSONArray
import org.json.JSONObject
import java.security.KeyPairGenerator
import java.security.KeyStore

/**
 * Android hardware Key Attestation bridge — scenario 2 (§16.3 of the Identity & Key Architecture
 * TODO doc): proves this is a genuine, officially-signed build running on real hardware, to the
 * server-side verifier at src/server/routes/attestation-routes.ts.
 *
 * Follows NativeCustodyBridge.kt's exact convention: every @JavascriptInterface method is
 * synchronous and returns a JSON-string envelope ({"ok":true,...} / {"ok":false,"reason":...}),
 * all exceptions caught internally, nothing throws across the JS boundary. Unlike
 * NativeCustodyBridge (a symmetric AES key, encrypt/decrypt), this generates an asymmetric EC
 * keypair with an attestation challenge and returns its certificate chain — the actual evidence
 * the verifier checks.
 *
 * Each call to generateAttestedKey() regenerates the key: Android binds the challenge into the
 * certificate at generation time, so a stale key from a previous (now-expired) challenge can't be
 * reused — this matches the credential's own 24h refresh design (§16.8), not an oversight.
 */
class NativeAttestationBridge(context: Context) {
    private val appContext = context.applicationContext

    private fun ok(fields: JSONObject): String = fields.put("ok", true).toString()
    private fun fail(reason: String): String = JSONObject().put("ok", false).put("reason", reason).toString()

    /**
     * Capability probe — lets the web layer feature-detect before offering any "verify this
     * build" UI action. `available` is false below API 24 (Key Attestation's
     * setAttestationChallenge floor); `strongBoxAvailable` reports whether StrongBox hardware is
     * present (API 28+ and device-dependent) as a hint only — generateAttestedKey() falls back to
     * TEE-level attestation automatically if StrongBox generation fails, same pattern as
     * NativeCustodyBridge's generate(strongBox).
     */
    @JavascriptInterface
    fun describe(): String = try {
        JSONObject()
            .put("version", 1)
            .put("provider", "android-keystore-attestation")
            .put("available", Build.VERSION.SDK_INT >= Build.VERSION_CODES.N)
            .put("strongBoxAvailable", Build.VERSION.SDK_INT >= Build.VERSION_CODES.P &&
                appContext.packageManager.hasSystemFeature(android.content.pm.PackageManager.FEATURE_STRONGBOX_KEYSTORE))
            .toString()
    } catch (e: Exception) {
        JSONObject().put("version", 1).put("provider", "android-keystore-attestation").put("available", false).toString()
    }

    /**
     * Generates a fresh hardware-backed EC (P-256) keypair with the given attestation challenge
     * and returns its certificate chain — the evidence
     * `POST /api/attestation/verify` (src/server/routes/attestation-routes.ts) checks. StrongBox
     * first (falls back to TEE-only on any exception, matching NativeCustodyBridge's precedent),
     * since StrongBox is the stronger evidence tier (evidenceTier: 'strongbox' vs 'tee') but not
     * available on every device.
     */
    @JavascriptInterface
    fun generateAttestedKey(challengeBase64: String): String {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) {
            return fail("key-attestation-unsupported-below-api-24")
        }
        return try {
            val challenge = Base64.decode(challengeBase64, Base64.NO_WRAP)
            val strongBoxCapable = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
            val publicKeyPair = try {
                generate(challenge, strongBox = strongBoxCapable)
            } catch (e: Exception) {
                if (strongBoxCapable) generate(challenge, strongBox = false) else throw e
            }

            val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
            val certChain = keyStore.getCertificateChain(ALIAS)
                ?: return fail("no-certificate-chain-after-generation")
            val certChainDer = JSONArray()
            for (cert in certChain) certChainDer.put(Base64.encodeToString(cert.encoded, Base64.NO_WRAP))

            ok(
                JSONObject()
                    .put("certChainDer", certChainDer)
                    .put("devicePublicKeyDer", Base64.encodeToString(publicKeyPair.public.encoded, Base64.NO_WRAP)),
            )
        } catch (e: Exception) {
            fail(e.javaClass.simpleName + ": " + (e.message ?: "unknown"))
        }
    }

    private fun generate(challenge: ByteArray, strongBox: Boolean): java.security.KeyPair {
        val specBuilder = KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY)
            .setDigests(KeyProperties.DIGEST_SHA256)
            .setAttestationChallenge(challenge)
        if (strongBox) specBuilder.setIsStrongBoxBacked(true)
        val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, ANDROID_KEYSTORE)
        generator.initialize(specBuilder.build())
        return generator.generateKeyPair()
    }

    companion object {
        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        private const val ALIAS = "iinpublic-attestation-key-v1"
    }
}
