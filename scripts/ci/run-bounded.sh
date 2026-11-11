# scripts/ci/run-bounded.sh
# Sourced by a Git Bash step on Windows. `run_bounded` runs one command under a time bound that
# still holds when the command leaves a process behind. The output goes to a file, never to a pipe
# the step reads: a process that outlives the command and still holds such a pipe keeps the step
# waiting after the command has ended, on its own or at its bound. On expiry the whole native
# process tree goes, not only the process bash started, and a process snapshot printed first names
# what hung.
#
# Usage: run_bounded <seconds> <output file> <command> [args...]
# Prints a timestamped line naming the command before it starts and one with its exit code after
# (on expiry, a line saying it ran past its bound), then the output file if it is not empty.
# Returns the command's exit code, or 124 when it ran past its bound.
# docs/dev/crash-reports.md says how to read the snapshot.

RUN_BOUNDED_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

run_bounded() {
  local bound="$1" out="$2"
  shift 2
  local started_s pid winpid="" rc
  printf -v started_s '%(%s)T' -1
  local started=$SECONDS
  printf '[%(%H:%M:%S)T] run-bounded: start, bound %s s: %s\n' -1 "$bound" "$*"
  "$@" >"$out" 2>&1 </dev/null &
  pid=$!
  while kill -0 "$pid" 2>/dev/null; do
    # $! is an MSYS pid. taskkill needs the native one, which is readable only while the process lives.
    [ -n "$winpid" ] || read -r winpid 2>/dev/null <"/proc/$pid/winpid"
    if [ $((SECONDS - started)) -ge "$bound" ]; then
      # Read again: an exec inside the command can move its MSYS pid to a new native process.
      read -r winpid 2>/dev/null <"/proc/$pid/winpid"
      printf '[%(%H:%M:%S)T] run-bounded: %s ran past its %s s bound; process snapshot (native pid %s):\n' \
        -1 "$1" "$bound" "${winpid:-unknown}"
      # With no native pid the snapshot still lists the orphans; it only has no tree to walk.
      local root_arg=()
      [ -z "$winpid" ] || root_arg=(-Root "$winpid")
      # Bounded too: the snapshot must not become the next hang. A bare `timeout` can resolve to
      # System32's timeout.exe, a different command.
      "${TIMEOUT_BIN:-/usr/bin/timeout}" 15 powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass \
        -File "$(cygpath -w "$RUN_BOUNDED_DIR/process-snapshot.ps1")" "${root_arg[@]}" -Since "$started_s" \
        </dev/null || echo "run-bounded: the snapshot did not finish"
      # The tree kill goes first: a POSIX kill that ended the top process would leave taskkill no
      # tree to walk. The `kill -0` keeps a pid Windows may have reused since the command exited
      # out of taskkill.
      if [ -n "$winpid" ] && kill -0 "$pid" 2>/dev/null; then
        taskkill //F //T //PID "$winpid" 2>&1 || true
      fi
      kill "$pid" 2>/dev/null || true
      for _ in 1 2 3; do
        kill -0 "$pid" 2>/dev/null || break
        sleep 1
      done
      kill -9 "$pid" 2>/dev/null || true
      if kill -0 "$pid" 2>/dev/null; then
        echo "run-bounded: $1 is still running after the kill"
      else
        wait "$pid" 2>/dev/null || true
      fi
      run_bounded_print_output "$out"
      return 124
    fi
    sleep 0.2
  done
  wait "$pid"
  rc=$?
  printf '[%(%H:%M:%S)T] run-bounded: exit %s after %s s: %s\n' -1 "$rc" "$((SECONDS - started))" "$1"
  run_bounded_print_output "$out"
  return "$rc"
}

run_bounded_print_output() {
  if [ -s "$1" ]; then
    echo "run-bounded: output in $1:"
    cat "$1"
  fi
}
