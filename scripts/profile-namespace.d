#pragma D option quiet
#pragma D option strsize=1024
#pragma D option bufsize=4m

BEGIN
{
  printf("READY\t%lld\n", walltimestamp);
}

syscall::mkdir:entry,
syscall::mkdir_extended:entry,
syscall::rmdir:entry
/strstr(copyinstr(arg0), "browser-2d-closed-recovery-") != NULL ||
 (strlen(copyinstr(arg0)) == 36 &&
  substr(copyinstr(arg0), 8, 1) == "-" &&
  substr(copyinstr(arg0), 13, 1) == "-" &&
  substr(copyinstr(arg0), 18, 1) == "-" &&
  substr(copyinstr(arg0), 23, 1) == "-")/
{
  self->profile_path = copyinstr(arg0);
  self->profile_call = probefunc;
  self->profile_dirfd = -2;
  printf("ENTRY\t%lld\t%s\t%d\t%d\t%d\t%d\t%s\t%d\t%s\n", walltimestamp, execname, pid, curpsinfo->pr_ppid, curpsinfo->pr_pgid, tid, probefunc, self->profile_dirfd, self->profile_path);
}

syscall::mkdirat:entry
/strstr(copyinstr(arg1), "browser-2d-closed-recovery-") != NULL ||
 (strlen(copyinstr(arg1)) == 36 &&
  substr(copyinstr(arg1), 8, 1) == "-" &&
  substr(copyinstr(arg1), 13, 1) == "-" &&
  substr(copyinstr(arg1), 18, 1) == "-" &&
  substr(copyinstr(arg1), 23, 1) == "-")/
{
  self->profile_path = copyinstr(arg1);
  self->profile_call = probefunc;
  self->profile_dirfd = arg0;
  printf("ENTRY\t%lld\t%s\t%d\t%d\t%d\t%d\t%s\t%d\t%s\n", walltimestamp, execname, pid, curpsinfo->pr_ppid, curpsinfo->pr_pgid, tid, probefunc, self->profile_dirfd, self->profile_path);
}

syscall::rename:entry
/strstr(copyinstr(arg1), "browser-2d-closed-recovery-") != NULL ||
 (strlen(copyinstr(arg1)) == 36 &&
  substr(copyinstr(arg1), 8, 1) == "-" &&
  substr(copyinstr(arg1), 13, 1) == "-" &&
  substr(copyinstr(arg1), 18, 1) == "-" &&
  substr(copyinstr(arg1), 23, 1) == "-")/
{
  self->profile_path = copyinstr(arg1);
  self->profile_call = probefunc;
  self->profile_dirfd = -2;
  printf("ENTRY\t%lld\t%s\t%d\t%d\t%d\t%d\t%s\t%d\t%s\n", walltimestamp, execname, pid, curpsinfo->pr_ppid, curpsinfo->pr_pgid, tid, probefunc, self->profile_dirfd, self->profile_path);
}

syscall::renameat:entry,
syscall::renameatx_np:entry
/strstr(copyinstr(arg3), "browser-2d-closed-recovery-") != NULL ||
 (strlen(copyinstr(arg3)) == 36 &&
  substr(copyinstr(arg3), 8, 1) == "-" &&
  substr(copyinstr(arg3), 13, 1) == "-" &&
  substr(copyinstr(arg3), 18, 1) == "-" &&
  substr(copyinstr(arg3), 23, 1) == "-")/
{
  self->profile_path = copyinstr(arg3);
  self->profile_call = probefunc;
  self->profile_dirfd = arg2;
  printf("ENTRY\t%lld\t%s\t%d\t%d\t%d\t%d\t%s\t%d\t%s\n", walltimestamp, execname, pid, curpsinfo->pr_ppid, curpsinfo->pr_pgid, tid, probefunc, self->profile_dirfd, self->profile_path);
}

syscall::mkdir:return,
syscall::mkdir_extended:return,
syscall::rmdir:return,
syscall::mkdirat:return,
syscall::rename:return,
syscall::renameat:return,
syscall::renameatx_np:return
/self->profile_path != NULL/
{
  printf("RETURN\t%lld\t%s\t%d\t%d\t%d\t%d\t%s\t%d\t%d\t%d\t%s\n", walltimestamp, execname, pid, curpsinfo->pr_ppid, curpsinfo->pr_pgid, tid, self->profile_call, self->profile_dirfd, arg0, errno, self->profile_path);
  self->profile_path = 0;
  self->profile_call = 0;
  self->profile_dirfd = 0;
}

tick-600s
{
  printf("TIMEOUT\t%lld\n", walltimestamp);
  exit(0);
}
