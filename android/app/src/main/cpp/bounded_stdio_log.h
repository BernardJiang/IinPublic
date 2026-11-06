/*
 * Keeps the embedded Node's stdio log (node-stdio.log) bounded (OPEN-95).
 *
 * Node, WebRTC and native libraries all write straight to fds 1/2, so the cap has to sit under
 * them. Those fds stay plain O_APPEND files rather than a pipe: each write reaches the file
 * synchronously, so the last lines before a native abort survive for `adb pull`.
 *
 * Plain POSIX, no JNI: src/test/unit/android-bounded-stdio-log.test.ts builds this on the host.
 */
#pragma once

#include <sys/types.h>

namespace iinpublic {

// One file plus one rotated generation: at most about twice this, plus one poll of output.
// Stays under the 8 MiB the native E2E harness accepts when it reads the log back.
constexpr off_t kStdioLogMaxBytes = 4 * 1024 * 1024;
constexpr unsigned kStdioLogPollSeconds = 10;

// Shrinks an existing log to its last `keep_bytes`, starting at a line boundary. Works on a full
// disk: the tail is held in memory while the file is emptied. Run before the log is opened.
void trim_stdio_log(const char* path, off_t keep_bytes);

// When the file behind `fd_a` has reached `max_bytes`, moves `path` to `path`.1 and atomically
// points `fd_a` and `fd_b` at a fresh file. If the fresh file cannot be created (disk full), the
// current file is emptied instead, so the cap holds. Returns true if it rotated or emptied.
bool rotate_stdio_log_if_needed(const char* path, int fd_a, int fd_b, off_t max_bytes);

// Starts the detached thread that applies rotate_stdio_log_if_needed to fds 1 and 2.
void start_stdio_log_rotation(const char* path);

}  // namespace iinpublic
