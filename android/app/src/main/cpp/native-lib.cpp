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
#include <sys/stat.h>
#include <time.h>
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

/* ── bounded Node stdout/stderr capture ────────────────────────────────
 * Node must never write directly to the on-disk log. A regular-file fd lets the file grow
 * without limit and propagates ENOSPC back into console writes. Instead Node writes to a pipe;
 * this native pump always drains it, rotates at 4 MiB, retains one 4 MiB backup, and drops bytes
 * while storage is unavailable. Logging can therefore fail without taking down the runtime.
 */
static constexpr off_t NODE_STDIO_LOG_MAX_BYTES = 4 * 1024 * 1024;
static constexpr int NODE_STDIO_LOG_RETRY_SECONDS = 5;

struct NodeStdioLogPump {
    int read_fd;
    std::string path;
    std::string rotated_path;
};

static time_t monotonic_seconds() {
    struct timespec now{};
    if (clock_gettime(CLOCK_MONOTONIC, &now) != 0) return 0;
    return now.tv_sec;
}

static int open_bounded_node_log(const NodeStdioLogPump& pump, off_t* size_out) {
    struct stat current{};
    if (stat(pump.path.c_str(), &current) == 0 && current.st_size > NODE_STDIO_LOG_MAX_BYTES) {
        // A legacy unbounded log may already be gigabytes large on a full device. Truncate it in
        // place before trying to create anything else; rename would preserve the storage outage.
        int recovery_fd = open(pump.path.c_str(), O_WRONLY | O_TRUNC | O_CLOEXEC);
        if (recovery_fd >= 0) close(recovery_fd);
    }
    struct stat rotated{};
    if (stat(pump.rotated_path.c_str(), &rotated) == 0
            && rotated.st_size > NODE_STDIO_LOG_MAX_BYTES) {
        unlink(pump.rotated_path.c_str());
    }
    int fd = open(pump.path.c_str(), O_WRONLY | O_CREAT | O_APPEND | O_CLOEXEC, 0600);
    if (fd < 0) return -1;
    struct stat opened{};
    *size_out = fstat(fd, &opened) == 0 ? opened.st_size : 0;
    return fd;
}

static int rotate_node_log(const NodeStdioLogPump& pump, int fd, off_t* size_out) {
    if (fd >= 0) close(fd);
    unlink(pump.rotated_path.c_str());
    if (rename(pump.path.c_str(), pump.rotated_path.c_str()) != 0 && errno != ENOENT) {
        // Rotation is diagnostic only. If metadata updates fail, truncating the current file still
        // enforces the cap and is preferable to allowing logging to threaten app availability.
        int truncate_fd = open(pump.path.c_str(), O_WRONLY | O_TRUNC | O_CLOEXEC);
        if (truncate_fd >= 0) close(truncate_fd);
    }
    int next = open(pump.path.c_str(), O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0600);
    *size_out = 0;
    return next;
}

static bool write_node_log(int fd, const char* bytes, size_t length) {
    size_t offset = 0;
    while (offset < length) {
        const ssize_t written = write(fd, bytes + offset, length - offset);
        if (written > 0) {
            offset += static_cast<size_t>(written);
            continue;
        }
        if (written < 0 && errno == EINTR) continue;
        return false;
    }
    return true;
}

static void* pump_node_stdio(void* raw) {
    NodeStdioLogPump* pump = static_cast<NodeStdioLogPump*>(raw);
    off_t log_size = 0;
    int log_fd = open_bounded_node_log(*pump, &log_size);
    time_t retry_after = log_fd >= 0 ? 0 : monotonic_seconds() + NODE_STDIO_LOG_RETRY_SECONDS;
    char buffer[16 * 1024];
    for (;;) {
        const ssize_t count = read(pump->read_fd, buffer, sizeof(buffer));
        if (count < 0 && errno == EINTR) continue;
        if (count <= 0) break;

        if (log_fd < 0 && monotonic_seconds() >= retry_after) {
            log_fd = open_bounded_node_log(*pump, &log_size);
            retry_after = monotonic_seconds() + NODE_STDIO_LOG_RETRY_SECONDS;
        }
        if (log_fd < 0) continue; // Always drain the pipe; unavailable diagnostics are dropped.

        if (log_size + count > NODE_STDIO_LOG_MAX_BYTES) {
            log_fd = rotate_node_log(*pump, log_fd, &log_size);
        }
        if (log_fd < 0 || !write_node_log(log_fd, buffer, static_cast<size_t>(count))) {
            if (log_fd >= 0) close(log_fd);
            log_fd = -1;
            retry_after = monotonic_seconds() + NODE_STDIO_LOG_RETRY_SECONDS;
            continue;
        }
        log_size += count;
    }
    if (log_fd >= 0) close(log_fd);
    close(pump->read_fd);
    delete pump;
    return nullptr;
}

static void redirect_node_stdio_to_bounded_log(const char* sandbox_dir) {
    int pipe_fds[2];
    if (pipe(pipe_fds) != 0) {
        LOGE("[jni] node stdio pipe failed: errno=%d — stdio left as-is", errno);
        return;
    }
    fcntl(pipe_fds[0], F_SETFD, FD_CLOEXEC);
    fcntl(pipe_fds[1], F_SETFD, FD_CLOEXEC);
    auto* pump = new NodeStdioLogPump{
        pipe_fds[0],
        std::string(sandbox_dir) + "/node-stdio.log",
        std::string(sandbox_dir) + "/node-stdio.log.1",
    };
    pthread_t tid;
    if (pthread_create(&tid, nullptr, pump_node_stdio, pump) != 0) {
        LOGE("[jni] node stdio pump failed: errno=%d — stdio left as-is", errno);
        close(pipe_fds[0]);
        close(pipe_fds[1]);
        delete pump;
        return;
    }
    pthread_detach(tid);
    if (dup2(pipe_fds[1], STDOUT_FILENO) < 0 || dup2(pipe_fds[1], STDERR_FILENO) < 0) {
        LOGE("[jni] node stdio redirect failed: errno=%d — stdio may be partially redirected", errno);
    }
    close(pipe_fds[1]);
    setvbuf(stdout, nullptr, _IONBF, 0);
    setvbuf(stderr, nullptr, _IONBF, 0);
}

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
 *                                  disableLanDiscovery, enablePortableCoreTests,
 *                                  backgroundAgentToken)
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
        jboolean enable_portable_core_tests,
        jstring background_agent_token_j)
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
    const char* background_agent_token = env->GetStringUTFChars(background_agent_token_j, nullptr);
    setenv("IINPUBLIC_BACKGROUND_AGENT_TOKEN", background_agent_token, 1);
    env->ReleaseStringUTFChars(background_agent_token_j, background_agent_token);

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

    // Capture Node's console output without exposing the runtime to disk-full errors. The native
    // pump bounds diagnostics to two 4 MiB files and keeps draining even when storage is unusable.
    redirect_node_stdio_to_bounded_log(sandbox_dir);

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
