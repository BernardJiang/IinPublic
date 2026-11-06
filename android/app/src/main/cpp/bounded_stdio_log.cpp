#include "bounded_stdio_log.h"

#include <fcntl.h>
#include <pthread.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#include <string>

namespace iinpublic {

void trim_stdio_log(const char* path, off_t keep_bytes) {
    struct stat info;
    if (stat(path, &info) != 0 || info.st_size <= keep_bytes) return;

    int fd = open(path, O_RDWR | O_CLOEXEC);
    if (fd < 0) return;

    char* tail = static_cast<char*>(malloc(static_cast<size_t>(keep_bytes)));
    ssize_t tail_size = tail
        ? pread(fd, tail, static_cast<size_t>(keep_bytes), info.st_size - keep_bytes)
        : -1;

    // Emptying first frees the space that rewriting the tail needs on a full disk.
    if (ftruncate(fd, 0) == 0 && tail_size > 0) {
        const char* newline = static_cast<const char*>(memchr(tail, '\n', tail_size));
        const char* start = newline ? newline + 1 : tail;
        size_t remaining = static_cast<size_t>(tail + tail_size - start);
        off_t offset = 0;
        while (remaining > 0) {
            ssize_t written = pwrite(fd, start, remaining, offset);
            if (written <= 0) break;
            start += written;
            remaining -= static_cast<size_t>(written);
            offset += written;
        }
    }
    free(tail);
    close(fd);
}

bool rotate_stdio_log_if_needed(const char* path, int fd_a, int fd_b, off_t max_bytes) {
    struct stat info;
    if (fstat(fd_a, &info) != 0 || info.st_size < max_bytes) return false;

    const std::string rotated = std::string(path) + ".1";
    rename(path, rotated.c_str());

    int fresh = open(path, O_WRONLY | O_CREAT | O_APPEND | O_CLOEXEC, 0600);
    if (fresh < 0) {
        // O_APPEND writers simply continue from the new end of the emptied file.
        return ftruncate(fd_a, 0) == 0;
    }
    dup2(fresh, fd_a);
    dup2(fresh, fd_b);
    close(fresh);
    return true;
}

namespace {

void* rotation_loop(void* arg) {
    std::string* path = static_cast<std::string*>(arg);
    for (;;) {
        sleep(kStdioLogPollSeconds);
        rotate_stdio_log_if_needed(path->c_str(), STDOUT_FILENO, STDERR_FILENO, kStdioLogMaxBytes);
    }
    return nullptr;
}

}  // namespace

void start_stdio_log_rotation(const char* path) {
    // Owned by the thread, which lives as long as the process.
    std::string* owned_path = new std::string(path);
    pthread_t thread;
    if (pthread_create(&thread, nullptr, rotation_loop, owned_path) == 0) {
        pthread_detach(thread);
    } else {
        delete owned_path;
    }
}

}  // namespace iinpublic
