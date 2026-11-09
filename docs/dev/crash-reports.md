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

| File                     | What it is                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------ |
| `collected.txt`          | What the step found, so an artifact without a report explains itself                                   |
| `editor.log`             | The last boot's stdout and stderr, from the launch step's redirect (every Godot version, 4.2 included) |
| `editor-attempt-<n>.log` | The log of a boot attempt that failed; the retry would otherwise overwrite it                          |
| `warmup.log`             | The 4.2 class-cache warm-up's output, on 4.2 legs                                                      |
| `Godot*.ips`             | macOS reports                                                                                          |
| `godot*.cdb.txt`         | Windows: `cdb` over a minidump, run on the runner                                                      |
| `core.*.backtrace.txt`   | Linux: `gdb -batch -ex bt` over an editor core, run on the runner                                      |

Artifacts on a public repo can be downloaded by any GitHub account, and the editor's memory holds the WS auth token. So
Windows dumps and Linux core files never leave the runner, and neither can be re-read once it is gone. Don't widen what
the step uploads without checking the result for the token: `collect-crash-reports.mjs` is the one place that decides. A
clean scan says little beyond its own crash: the one we ran covered a single crash site, so it is no general promise that
a report holds no token.

## Start with the log

Look at the end of `editor.log` or `editor-attempt-<n>.log` first.

- `Program crashed with signal N`, then `-- END OF C++ BACKTRACE --`: Godot's handler caught a segfault, a bad
  instruction or a floating-point error, and printed its frames.
- `libc++abi: Pure virtual function called!` and no such banner: an `abort()`. Godot's handler doesn't hook `SIGABRT`, so
  the OS's report is the only stack you get.
- The log stops with neither: read the report below.

How much a stack names depends on the OS. A macOS `.ips` names Godot's own functions. Windows frames are the nearest
export plus an offset, such as `godot!NoHotPatch+0x3c1884e`, and Linux frames from the Godot binary are bare addresses.

## macOS: `.ips`

An `.ips` is two JSON objects, a metadata line and then the body.

- `pid` and `captureTime` in the body identify a crash. File names carry the time the report was written, which can come
  18 s after the crash and doesn't sort by it: two boots' reports can swap order.
- `faultingThread` is the index of the crashing thread in `threads`.
- `threads[n].frames[]` gives `imageIndex`, `imageOffset` and `symbol`, with `symbolLocation` as the offset into it.
- `usedImages[imageIndex].name` says which binary a frame sits in. A managed .NET frame has no image: its entry has no
  `name` and a `size` of 0, the frame has no `symbol`, and its `imageOffset` is an absolute address.
- `exception` and `termination` say how it died; `EXC_CRASH (SIGABRT)` means the process called `abort()`.

A report took up to 18.5 s to appear on a hosted runner, so a leg that expects a death waits up to 60 s for the first
report, and at least 24 s even when one is already there. A report later than that can still be missed.

## Windows: `.cdb.txt`

The text is what the step ran on the runner, one file per dump, named after it:

```powershell
cdb -z <dump> -lines -c "!analyze -v; ~* k; q"
```

Read `STACK_TEXT` for the crashing thread and the `~* k` output for the others. A file that says `cdb is not at <path>`
means the runner had no `cdb`, so that dump went unread. `cdb did not finish` means it failed to run or hit the 120 s
bound, and any text below it is what it printed by then.

Git Bash starts its children with an error mode that stops Windows Error Reporting, so the composite starts the editor
through `scripts/ci/editor-launcher.c`, which clears the mode. The launcher also prints the exit code, the last line of
`editor.log` or `editor-attempt-<n>.log`:

```text
editor-launcher: child_exit=0xC000001D
```

That line is the only raw code you get. Bash's own status isn't one: it reports an access violation as 139 and reduces a
code it has no signal for, `0xC0000602` among them, to 127. Common codes: `0xC0000005` access violation, `0xC000001D`
illegal instruction, `0xC0000409` fail-fast, `0xC0000374` heap corruption.

A leg with no launcher, because it did not compile or run, says so in an `Editor launcher` warning on the run. Its editor
starts directly, so a crash there leaves no dump and no `child_exit=` line. The same goes for the 4.2 class-cache
warm-up's editor, which never goes through the launcher.

## Linux: backtrace text

The file holds gdb's output. `Program terminated with signal` names the signal, and the `#0`, `#1`… lines are the stack
of the thread that crashed. Godot's handler ends in `abort()`, so expect `abort` and the handler above the frames that
matter. The core itself is gone with the runner.

`kernel.core_pattern` is machine-wide, so the core folder can hold another process's core. gdb's `Core was generated by`
line decides whose it is: a core counts when the basename of that command line's first token starts with `godot`. The
file name doesn't decide, because its `%e` is the crashing thread's name. Another process's core gets one line in
`collected.txt`, naming its executable, and counts for nothing, so a green leg with only such a core uploads nothing and
raises no annotation.

When gdb prints no such line, as when it could not be installed or did not finish, the step keeps the file and counts it,
so this filter never drops an editor crash. That file may belong to another process. In those two cases its text says why
the core went unread.
