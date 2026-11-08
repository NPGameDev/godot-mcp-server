# Reading a CI crash report

When an editor dies in a cross-version leg, the `cross-version-behavioral` composite uploads what the OS and Godot
left behind. This page says where to find it and how to read it.

## Finding the artifact

The leg's artifact is named `crash-report-<os>-<godot version>-<language>-attempt-<n>` and lasts 14 days.

```bash
gh run download <run-id> -n crash-report-macos-4.5.0-dotnet-attempt-1 -D <empty folder>
```

A leg uploads when it has a report, a log of a failed boot attempt, a failed or cancelled result, or an editor already
gone at teardown. A green leg with none of these uploads nothing, and no report never fails a job.

| File | What it is |
|---|---|
| `collected.txt` | What the step found, so an artifact without a report explains itself |
| `editor.log` | The last boot's stdout and stderr, from the launch step's redirect (every Godot version, 4.2 included) |
| `editor-attempt-<n>.log` | The log of a boot attempt that failed; the retry would otherwise overwrite it |
| `warmup.log` | The 4.2 class-cache warm-up's output, on 4.2 legs |
| `Godot*.ips` | macOS reports |
| `godot*.dmp` | Windows minidumps, the minimal type |
| `core.*.backtrace.txt` | Linux: `gdb -batch -ex bt` over a core file, run on the runner |

Artifacts on a public repo can be downloaded by any GitHub account, and the editor's memory holds the WS auth token. So
core files and full dumps never leave the runner. Don't widen what the step uploads without checking the result for the
token: `collect-crash-reports.mjs` is the one place that decides.

## Start with the log

Look at the end of `editor.log` or `editor-attempt-<n>.log` first.

- `Program crashed with signal N`, then `-- END OF C++ BACKTRACE --`: Godot's handler caught a segfault, a bad
  instruction or a floating-point error, and printed its frames.
- `libc++abi: Pure virtual function called!` and no banner: an `abort()`. Godot's handler doesn't hook `SIGABRT`, so the
  OS's report is the only stack you get.
- The log stops with neither: read the report below.

Official builds carry no symbols, so most frames are a module and an offset rather than a function name.

## macOS: `.ips`

An `.ips` is two JSON objects, a metadata line and then the body.

- `faultingThread` is the index of the crashing thread in `threads`.
- `threads[n].frames[]` gives `imageIndex`, `imageOffset` and, for system libraries, `symbol`.
- `usedImages[imageIndex].name` says which binary a frame sits in.
- `exception` and `termination` say how it died; `EXC_CRASH (SIGABRT)` means the process called `abort()`.

## Windows: `.dmp`

```powershell
cdb -z <dump> -lines -c "!analyze -v; ~* k; q"
```

`cdb` ships with the Windows SDK's Debugging Tools. WinDbg opens the same file. Exit codes in the job log:
`0xC0000005` access violation, `0xC000001D` illegal instruction, `0xC0000409` fail-fast, `0xC0000374` heap corruption.

## Linux: backtrace text

The file holds gdb's output. `Program terminated with signal` names the signal, and the `#0`, `#1`… lines are the stack
of the thread that crashed. Godot's handler ends in `abort()`, so expect `abort` and the handler above the frames that
matter. The core itself is gone with the runner.
