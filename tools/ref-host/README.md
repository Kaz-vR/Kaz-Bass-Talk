# ref-host (dev only)

A minimal headless VST2 host for measuring reference plugins as black boxes: test signals or MIDI notes in, audio out.
Nothing here ships, and the reference plugins themselves are never stored in the repository or disassembled; only
what they output is measured.

    apt-get install wine64 mingw-w64 xvfb
    x86_64-w64-mingw32-g++ -O2 -static -o host.exe tools/ref-host/host.cpp
    Xvfb :99 &
    # Wine needs a clean environment in the cloud container (its variables crash it at start-up):
    env -i HOME=/root PATH=/usr/bin:/bin WINEPREFIX=/tmp/wpfx WINEDEBUG=-all DISPLAY=:99 \
      /usr/lib/wine/wine64 host.exe <plugin_x64.dll> list
    ... host.exe <plugin.dll> render <in.wav | note:<midi>:<seconds>:<velocity>> <out.wav> <rate> [p<index>=<0..1> ...] [tail=<s>]

Works with 64-bit VST2 plugins (Serum, OTT, ValhallaVintageVerb tested). 32-bit plugins need wine32; VST3-only ones
need a VST3 host (not built yet).
