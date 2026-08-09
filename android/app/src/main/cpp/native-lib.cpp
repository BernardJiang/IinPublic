/*
 * Android JNI shim for embedded Node.js runtime (nodejs-mobile v18.20.4).
 *
 * Bridges Java's NodeBridge.nativeStartNode(dataDir, scriptPath, port, hubUrl)
 * into the NDK build via CMake + node::Start() so main.js runs on-device;
 * all config flows through env vars (IINPUBLIC_*) that process.env picks up.
 *
 * ┌──────────────┐   HTTP 127.0.0.1:port │   embedded Node
 * │    WebView    │◄────────────────►│    express server → serves dist/web,
 * │  (UI only)    │                  │    Gun mesh peer + radisk persistence
 * └──────────────┘                  │    dials hub for discovery
 */

#include <jni.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <pthread.h>
#include <string.h>
#include <unistd.h>
#include <string>
#include <android/log.h>
#include <node/node.h>            // nodejs-mobile headers live under include/node/

#define TAG "IinPublic-Native"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO,  TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, TAG, __VA_ARGS__)

/* ── thread-local state for the Node run ───────────────────── */
static std::string g_script_path_full;     // full path to main.js
static bool        g_started = false;

// Node.js runs in its own C++ thread to avoid blocking the Java VM.
extern "C" void* run_node(void*) {
    LOGI("[node-thread] calling node::Start with script=%s",
         g_script_path_full.c_str());

    char* args[] = {
        const_cast<char*>("node"),
        const_cast<char*>(g_script_path_full.c_str())
    };
    int argc = sizeof(args) / sizeof(args[0]);

    g_started = true;
    int exit_code = node::Start(argc, args);   // blocks until Node exits
    LOGI("[node-thread] node::Start returned, exit code=%d", exit_code);
    return nullptr;
}

static pthread_mutex_t g_once_lock = PTHREAD_MUTEX_INITIALIZER;

/*
 * Java: NodeBridge.nativeStartNode(dataDir, scriptPath, port, hubUrl)
 *   dataDir    — writable sandbox dir (assets unpacked here)
 *   scriptPath — entry point inside dataDir ("main.js")
 *   port       — loopback HTTP port for Express / WebView
 *   hubUrl     — Gun discovery peer URL
 */
extern "C" JNIEXPORT void JNICALL
Java_com_iinpublic_app_NodeBridge_nativeStartNode(
        JNIEnv* env,
        jobject /* this */,
        jstring data_dir_j,
        jstring script_path_j,
        jint port,
        jstring hub_j)
{
    pthread_mutex_lock(&g_once_lock);

    if (g_started) {
        LOGI("[jni] node already started — skipping duplicate call");
        pthread_mutex_unlock(&g_once_lock);
        return;
    }

    /* ── capture string params into static locals ────────────────────── */
    const char* data_dir   = env->GetStringUTFChars(data_dir_j, nullptr);
    const char* script_path = env->GetStringUTFChars(script_path_j, nullptr);

    // Full path to the entry point (e.g. /data/.../node-data/main.js)
    g_script_path_full.assign(data_dir);
    g_script_path_full.push_back('/');
    g_script_path_full.append(script_path);

    setenv("IINPUBLIC_DATA_DIR",  data_dir, 1);
    env->ReleaseStringUTFChars(data_dir_j,   data_dir);

    const char* hub = env->GetStringUTFChars(hub_j, nullptr);
    setenv("IINPUBLIC_HUB_GUN_URL", hub, 1);
    env->ReleaseStringUTFChars(hub_j, hub);

    // Port (used by embedded-node config resolution)
    {
        char port_str[16];
        snprintf(port_str, sizeof(port_str), "%d", (int)port);
        setenv("IINPUBLIC_LOCAL_PORT", port_str, 1);
        setenv("PORT",                port_str, 0);
    }

    LOGI("[jni] env injected — %s :: %d :: %s",
         getenv("IINPUBLIC_DATA_DIR"), port, getenv("IINPUBLIC_HUB_GUN_URL"));

    /* ── chdir so Gun radisk writes inside app sandbox ──────────────── */
    chdir(data_dir);

    // Node's own stdout/stderr (console.log, uncaught-exception stack traces printed
    // right before an early process.exit()) go to whatever fds Zygote gave this process
    // — normally /dev/null — so they never reach logcat. Redirect to a file in the
    // sandbox so a device-side crash-loop with no AndroidRuntime/logcat trace (see
    // 2026-08-08 real-device debugging) can actually be diagnosed via `adb pull`.
    freopen("node-stdio.log", "w", stdout);
    freopen("node-stdio.log", "a", stderr);
    setvbuf(stdout, nullptr, _IONBF, 0);
    setvbuf(stderr, nullptr, _IONBF, 0);

    env->ReleaseStringUTFChars(script_path_j, script_path);

    /* ── spawn Node runtime on a detached thread ───────────────────── */
    pthread_t tid;
    if (pthread_create(&tid, nullptr, run_node, nullptr) != 0) {
        LOGE("[jni] failed to create node thread: errno=%d", errno);
        pthread_mutex_unlock(&g_once_lock);
        return;
    }
    pthread_detach(tid);

    pthread_mutex_unlock(&g_once_lock);
    LOGI("[jni] nativeStartNode done (thread detached)");
}
