# Building Eden for macOS with the multicore fix

Eden 0.2.1 crashes on Apple Silicon within seconds to minutes of starting a game when
Multicore CPU Emulation is on (Eden Issue-Reports #636). The kernel caches a `thread_local`
address across a guest fiber's move to another host thread, so two cores re-enter one Dynarmic
JIT; the log shows `assert !is_executing`, register-allocator asserts and unmapped reads, then
Eden aborts inside the JIT compiler. The fix is Eden PR #4497, unmerged as of 2026-10-07.
`0001-kernel-fresh-tls-lookup.patch` is that change rebased onto the v0.2.1 tag.

This recipe reproduces the official macOS release build (Apple Clang, static bundled Qt 6.7.3,
bundled MoltenVK, `-mcpu=apple-m1`) with the patch applied. It was verified on an M3 Pro running
macOS 27 with Xcode 27 on 2026-10-07.

## Dependencies

```sh
brew install ninja boost glslang hidapi libusb lz4 nlohmann-json openssl speexdsp zstd catch2 \
  spirv-tools spirv-headers vulkan-utility-libraries enet opus autoconf automake libtool pkg-config
```

## Source and patch

```sh
git clone --depth 1 --branch v0.2.1 https://git.eden-emu.dev/eden-emu/eden.git eden-build
cd eden-build
git apply ../0001-kernel-fresh-tls-lookup.patch
```

## Configure

```sh
cmake -S . -B build -G Ninja -DBUILD_TESTING=OFF -DYUZU_TESTS=OFF -DCMAKE_BUILD_TYPE=Release \
  -DYUZU_USE_BUNDLED_QT=ON -DYUZU_USE_QT_MULTIMEDIA=OFF -DYUZU_USE_QT_WEB_ENGINE=OFF \
  -DENABLE_QT_TRANSLATION=OFF -DENABLE_UPDATE_CHECKER=OFF -DUSE_DISCORD_PRESENCE=OFF -DENABLE_LTO=OFF \
  -DYUZU_USE_BUNDLED_SIRIT=ON -DYUZU_USE_BUNDLED_MOLTENVK=ON -DYUZU_DISABLE_LLVM=ON -DYUZU_STATIC_BUILD=ON \
  -DYUZU_CMD=OFF -DYUZU_ROOM_STANDALONE=OFF -DYUZU_USE_BUNDLED_SDL2=ON -DYUZU_USE_BUNDLED_SDL3=ON \
  -DBUILD_ID=m1 -DCMAKE_C_FLAGS='-mcpu=apple-m1' -DCMAKE_CXX_FLAGS='-mcpu=apple-m1' \
  -DCMAKE_OSX_SYSROOT=$(xcrun --show-sdk-path)
```

Two fetched dependencies need a touch-up before building; both live under `.cache/cpm` after configure.

1. cpp-httplib (unpinned, 0.37.0 at the time) does not compile against the bundled OpenSSL 3.6:
   in `.cache/cpm/httplib/<ver>/httplib.h`, change `X509_NAME *name = X509_get_subject_name(cert);`
   to `const X509_NAME *name = ...`.
2. The macOS 26+ SDK no longer ships the AGL framework, but Qt 6.7's
   `.cache/cpm/qt6/macos-universal-6.7.3/lib/cmake/Qt6/FindWrapOpenGL.cmake` still links it. Delete
   the `find_library(WrapOpenGL_AGL ...)` block and the `-framework AGL` fallback, so only
   `-framework OpenGL` is linked. Nothing in the static Qt libraries references AGL symbols.
   Then rerun `cmake -U WrapOpenGL_AGL -S . -B build`.

## Build, sign, install

```sh
cmake --build build
codesign --deep --force --sign - build/bin/eden.app
```

The app is `build/bin/eden.app` (about 62 MB, MoltenVK inside `Contents/Frameworks`). To use it with
RetroDesk, move the downloaded `~/RetroDesk Data/emulators/eden/eden.app` somewhere outside that folder
and put the built app in its place; RetroDesk only replaces it when you install Eden again from its UI.
With this build in place, turn Multicore CPU Emulation back on in Eden (RetroDesk's macOS default of
single-core is only for the stock 0.2.1 build and does not touch a value you set yourself).

Result on the M3 Pro: Mario Tennis Aces, Mario Kart 8 Deluxe and Super Mario Bros. Wonder ran with
multicore on, no Dynarmic asserts and no unmapped reads, where stock 0.2.1 died in 5 to 24 seconds.
