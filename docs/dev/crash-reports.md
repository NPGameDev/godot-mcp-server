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

- `Program crashed with signal N`, then `-- END OF C++ BACKTRACE --` (`-- END OF BACKTRACE --` on 4.2, 4.3 and 4.4):
  Godot's handler caught a segfault, a bad instruction or a floating-point error, and printed its frames.
- `libc++abi: Pure virtual function called!` and no such banner: an `abort()`. Godot's handler doesn't hook `SIGABRT`, so
  the OS's report is the only stack you get.
- The log stops with neither: read the report below.

How much a stack names depends on the OS. A macOS `.ips` names Godot's own functions. Windows frames from the Godot
binary are the nearest export plus an offset, such as `godot!NoHotPatch+0x3c1884e`, a JIT-compiled .NET frame can be a
bare address, and Linux frames from the Godot binary are bare addresses. On a mono editor, `cdb`'s `PROCESS_NAME` can
name a .NET assembly rather than `godot`, so go by the dump's file name.

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
report, and at least 24 s even when one is already there. A green macOS leg holds the same 24 s, because macOS writes a
crash at exit's report after the process is gone; if one turns up, it waits as a leg that expects a death does. A report
later than that can still be missed. Green Linux and Windows legs spend no wait.

## An excused macOS 4.5.0 job

On macOS, Godot 4.5.0's iOS and visionOS export plugins start a device poll thread, and the editor can abort while
destroying them (`libc++abi: Pure virtual function called!`). Godot 4.5.1 fixed it.

A macOS 4.5.0 job whose three boot attempts all died on that crash, each proven by its own `.ips`, passes with a
`Known engine crash` warning, and its scene wait, smoke, flows and dispatch do not run. The macOS 4.5.2 legs beside it
keep that minor tested. To check one, read each `.ips` in the artifact:

- its `pid` is one of the dead boots';
- its bundle version, `bundleInfo.CFBundleShortVersionString`, is `4.5` (4.5.2's reads `4.5.2`), and its
  `exception.signal` is `SIGABRT`;
- it was written during the boot step: the step passes the whole second it started in, and the matcher skips a report
  whose file was last modified more than 1 s before that second, a margin for timestamp granularity;
- its faulting thread holds `__cxa_pure_virtual`, with `EditorExportPlatformAppleEmbedded::_check_for_changes_poll_thread`
  as the next frame;
- its main thread joins that thread in `Thread::wait_to_finish` under `~EditorExportPlatformAppleEmbedded`, called from
  `DocTools::generate`.

A boot that timed out, a death without such a report, and any other version or OS keep the job red. Besides the
`Known engine crash` warning, an excused job carries three `boot attempt <n>/3 failed` warnings, an `Editor stop`
notice, a `Crash report` warning and an `Editor log completeness unproven` warning.

A crash at exit after a passing smoke already leaves a job green, with only the `Crash report` warning.

## Windows: `.cdb.txt`

The text is what the step ran on the runner, one file per dump, named after it:

```powershell
cdb -z <dump> -lines -c "!analyze -v; ~* k; q"
```

Read `STACK_TEXT` for the crashing thread and the `~* k` output for the others. A file that says `cdb is not at <path>`
means the runner had no `cdb`, so that dump went unread. `cdb did not finish` means it failed to run, hit the 120 s
bound or passed the 16 MiB output cap, and any text below it is what it printed by then.

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
warm-up's editor, which never goes through the launcher. When the build or the self-check ran past its 120 s bound, the
step log holds a `run-bounded:` process snapshot above the warning, or a line saying it did not finish. The snapshot lists
the command's process tree and any process started since it began whose parent had already exited, each row with its
pid, parent, creation time and command line.

## Linux: backtrace text

The file holds one line saying how the step got gdb, then gdb's output. `Program terminated with signal` names the
signal, and the `#0`, `#1`… lines are the stack of the thread that crashed. Godot's handler ends in `abort()`, so expect
`abort` and the handler above the frames that matter. The core itself is gone with the runner.

`kernel.core_pattern` is machine-wide, so the core folder can hold another process's core. gdb's `Core was generated by`
line decides whose it is: a core counts when the basename of that command line's first token starts with `godot`. The
file name doesn't decide, because its `%e` is the crashing thread's name. Another process's core gets one line in
`collected.txt`, naming its executable, and counts for nothing, so a green leg with only such a core uploads nothing and
raises no annotation.

When gdb prints no such line, as when it could not be installed or did not finish, the step keeps the file and counts it,
so this filter never drops an editor crash. That file may belong to another process. In those two cases its text says why
the core went unread.
