// Built and run on the host by src/test/unit/android-bounded-stdio-log.test.ts (OPEN-95).
#include "../../../android/app/src/main/cpp/bounded_stdio_log.h"

#include <fcntl.h>
#include <stdio.h>
#include <sys/stat.h>
#include <unistd.h>

#include <fstream>
#include <sstream>
#include <string>

using namespace iinpublic;

static int failures = 0;
#define CHECK(condition) \
    do { if (!(condition)) { printf("FAILED line %d: %s\n", __LINE__, #condition); failures++; } } while (0)

static std::string read_file(const std::string& path) {
    std::ifstream in(path);
    std::stringstream out;
    out << in.rdbuf();
    return out.str();
}

static void write_file(const std::string& path, const std::string& text) {
    std::ofstream(path) << text;
}

int main(int argc, char** argv) {
    if (argc != 2) return 2;
    const std::string log = std::string(argv[1]) + "/node-stdio.log";
    const std::string old = log + ".1";

    // Startup trim keeps the newest whole lines and the file itself.
    write_file(log, "first line that must go\nsecond line that must go\nkept one\nkept two\n");
    trim_stdio_log(log.c_str(), 24);
    CHECK(read_file(log) == "kept one\nkept two\n");

    // A log under the limit is left alone.
    trim_stdio_log(log.c_str(), 1024);
    CHECK(read_file(log) == "kept one\nkept two\n");

    // A missing log is not an error.
    trim_stdio_log((log + ".missing").c_str(), 24);

    // Under the limit, nothing rotates.
    int a = open(log.c_str(), O_WRONLY | O_APPEND);
    int b = dup(a);
    CHECK(!rotate_stdio_log_if_needed(log.c_str(), a, b, 1024));

    // At the limit, both writers move to a fresh file and earlier output stays in .1.
    CHECK(rotate_stdio_log_if_needed(log.c_str(), a, b, 4));
    CHECK(read_file(old) == "kept one\nkept two\n");
    CHECK(read_file(log).empty());
    CHECK(write(a, "from a\n", 7) == 7);
    CHECK(write(b, "from b\n", 7) == 7);
    CHECK(read_file(log) == "from a\nfrom b\n");

    // The next rotation replaces .1, so only two generations ever exist.
    CHECK(rotate_stdio_log_if_needed(log.c_str(), a, b, 4));
    CHECK(read_file(old) == "from a\nfrom b\n");

    // If no fresh file can be made, the current one is emptied so the cap still holds.
    CHECK(write(a, "still capped\n", 13) == 13);
    const std::string blocked = std::string(argv[1]) + "/gone/node-stdio.log";
    CHECK(rotate_stdio_log_if_needed(blocked.c_str(), a, b, 4));
    CHECK(read_file(log).empty());
    CHECK(write(b, "after emptying\n", 15) == 15);
    CHECK(read_file(log) == "after emptying\n");

    close(a);
    close(b);
    if (failures == 0) printf("ok\n");
    return failures == 0 ? 0 : 1;
}
