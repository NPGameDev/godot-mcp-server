/* scripts/ci/editor-launcher.c
 * Starts the cross-version composite's editor on Windows so that a crash reaches Windows Error
 * Reporting and its exit code stays readable. Git Bash starts its children with error mode 0x3, and
 * a process with that mode writes no dump; a child inherits its parent's mode, so this clears it
 * first. Bash also reduces an NTSTATUS it has no signal for to 127, so this prints the child's raw
 * exit code as `child_exit=0x...` on stdout, which the composite redirects into editor.log.
 *
 * The child's command line stays exactly as bash built it, so the editor gets the arguments a direct
 * launch gives it. This process only waits: its life matches the child's, and the composite kills
 * the two as a tree. docs/dev/crash-reports.md explains how to read what a crash leaves.
 *
 * Usage: editor-launcher.exe <child's full path, extension included if it has one> [args...]
 * Exit codes: the child's, or 126 when it could not be started.
 */
#include <stdio.h>
#include <string.h>
#include <wchar.h>
#include <windows.h>

#define COMMAND_LINE_CHARS 32768

static wchar_t token[COMMAND_LINE_CHARS];

/* Copies one command-line token, without its quotes, and returns what follows it. */
static const wchar_t *take_token(const wchar_t *p, wchar_t *out) {
  int quoted = 0;
  for (; *p && (quoted || (*p != L' ' && *p != L'\t')); p++) {
    if (*p == L'"') {
      quoted = !quoted;
    } else {
      *out++ = *p;
    }
  }
  *out = 0;
  while (*p == L' ' || *p == L'\t') {
    p++;
  }
  return p;
}

int main(void) {
  static wchar_t image[COMMAND_LINE_CHARS];
  static wchar_t command[COMMAND_LINE_CHARS];
  STARTUPINFOW si;
  PROCESS_INFORMATION pi;
  DWORD code = 0;
  const wchar_t *child = take_token(GetCommandLineW(), token);

  SetErrorMode(0);
  wcsncpy(command, child, COMMAND_LINE_CHARS - 1);
  take_token(child, image);

  memset(&si, 0, sizeof(si));
  memset(&pi, 0, sizeof(pi));
  si.cb = sizeof(si);
  si.dwFlags = STARTF_USESTDHANDLES;
  si.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
  si.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE);
  si.hStdError = GetStdHandle(STD_ERROR_HANDLE);
  /* By image rather than by search: setup-godot's hard link to the editor has no extension, and a
     search would add .exe. */
  if (!CreateProcessW(image, command, NULL, NULL, TRUE, 0, NULL, NULL, &si, &pi)) {
    printf("editor-launcher: could not start %ls, GetLastError=%lu\n", image, (unsigned long)GetLastError());
    fflush(stdout);
    return 126;
  }
  WaitForSingleObject(pi.hProcess, INFINITE);
  GetExitCodeProcess(pi.hProcess, &code);
  printf("editor-launcher: child_exit=0x%08lX\n", (unsigned long)code);
  fflush(stdout);
  ExitProcess(code);
}
