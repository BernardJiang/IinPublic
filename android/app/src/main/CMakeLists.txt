cmake_minimum_required(VERSION 3.22.1)

project("iinpublic")

# ── libnode headers + prebuilt .so live under android/app/libnode/ ───────
set(LIBNODE_DIR ${CMAKE_SOURCE_DIR}/../../libnode)
include_directories(
    ${LIBNODE_DIR}/include
    ${LIBNODE_DIR}/include/node
)

# Prebuilt libnode.so per ABI (from nodejs-mobile v18.20.4 release)
add_library(libnode SHARED IMPORTED)
set_target_properties(libnode PROPERTIES
    IMPORTED_LOCATION "${LIBNODE_DIR}/lib/${ANDROID_ABI}/libnode.so"
)

# ── JNI shim ─────────────────────────────────────────────────────────────
add_library(native-lib SHARED
    cpp/native-lib.cpp
)

target_link_libraries(native-lib
    libnode
    log
    android
)
