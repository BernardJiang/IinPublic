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
#include <fcntl.h>
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
        // nodejs-mobile's device-dependent default old-space ceiling was only
        // ~700 MiB on the C10. Keep a modest explicit allowance above that
        // default, but remain bounded so a persistence regression cannot grow
        // until it starves Android's WebView and adb transport.
        const_cast<char*>("--max-old-space-size=768"),
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
 * Java: NodeBridge.nativeStartNode(dataDir, scriptPath, port, hubUrl,
 *                                  disableLanDiscovery, enablePortableCoreTests)
 *   dataDir    — writable sandbox dir (assets unpacked here)
 *   scriptPath — entry point inside dataDir ("main.js")
 *   port       — loopback HTTP port for Express / WebView
 *   hubUrl     — Gun discovery peer URL
 *   disableLanDiscovery — isolates controlled E2E matrices from unrelated LAN peers
 *   enablePortableCoreTests — debug-only fixed core contract endpoint (no arbitrary eval)
 */
extern "C" JNIEXPORT void JNICALL
Java_com_iinpublic_app_NodeBridge_nativeStartNode(
        JNIEnv* env,
        jobject /* this */,
        jstring data_dir_j,
        jstring script_path_j,
        jint port,
        jstring hub_j,
        jboolean disable_lan_discovery,
        jboolean enable_portable_core_tests)
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
    setenv("IINPUBLIC_LAN_DISCOVERY_ENABLED", disable_lan_discovery ? "0" : "1", 1);
    setenv("IINPUBLIC_E2E_PORTABLE_CORE", enable_portable_core_tests ? "1" : "0", 1);

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
    // data_dir was released above; use setenv's own copy. Reading the released JNI buffer
    // worked by luck until Android 16's tagged heap, where chdir() got garbage and failed.
    const char* sandbox_dir = getenv("IINPUBLIC_DATA_DIR");
    if (chdir(sandbox_dir) != 0) {
        LOGE("[jni] chdir(%s) failed: errno=%d", sandbox_dir, errno);
    }

    // Node's own stdout/stderr (console.log, uncaught-exception stack traces printed
    // right before an early process.exit()) go to whatever fds Zygote gave this process
    // — normally /dev/null — so they never reach logcat. Redirect to a file in the
    // sandbox so a device-side crash-loop with no AndroidRuntime/logcat trace (see
    // 2026-08-08 real-device debugging) can actually be diagnosed via `adb pull`.
    // Append across Android process restarts. A sticky/re-delivered foreground service can
    // restart within a second after Node calls process.exit(), and truncating here erased the
    // only copy of the original boot failure before adb could collect it.
    // A failed freopen() closes fd 1/2 outright; the next open() anywhere in the process
    // (WebView threads included) then lands on a stdio fd and Node aborts in
    // InitializeOncePerProcess / libuv asserts "fd > STDERR_FILENO". Only swap the fds in
    // once the log file is actually open.
    {
        std::string log_path = std::string(sandbox_dir) + "/node-stdio.log";
        int log_fd = open(log_path.c_str(), O_WRONLY | O_CREAT | O_APPEND | O_CLOEXEC, 0600);
        if (log_fd >= 0) {
            dup2(log_fd, STDOUT_FILENO);
            dup2(log_fd, STDERR_FILENO);
            close(log_fd);
            setvbuf(stdout, nullptr, _IONBF, 0);
            setvbuf(stderr, nullptr, _IONBF, 0);
        } else {
            LOGE("[jni] open(%s) failed: errno=%d — Node stdio left as-is", log_path.c_str(), errno);
        }
    }

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
